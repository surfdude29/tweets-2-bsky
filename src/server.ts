import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { deleteAllPosts } from './bsky.js';
import { getConfig, saveConfig } from './config-manager.js';
import { dbService } from './db.js';
import type { ProcessedTweet } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const WEB_DIST_DIR = path.join(__dirname, '..', 'web', 'dist');
const LEGACY_PUBLIC_DIR = path.join(__dirname, '..', 'public');
const staticAssetsDir = fs.existsSync(path.join(WEB_DIST_DIR, 'index.html')) ? WEB_DIST_DIR : LEGACY_PUBLIC_DIR;
const BSKY_APPVIEW_URL = process.env.BSKY_APPVIEW_URL || 'https://public.api.bsky.app';
const POST_VIEW_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface BskyProfileView {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

interface EnrichedPostMedia {
  type: 'image' | 'video' | 'external';
  url?: string;
  thumb?: string;
  alt?: string;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
}

interface EnrichedPost {
  bskyUri: string;
  bskyCid?: string;
  bskyIdentifier: string;
  twitterId: string;
  twitterUsername: string;
  twitterUrl?: string;
  postUrl?: string;
  createdAt?: string;
  text: string;
  facets: unknown[];
  author: {
    did?: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  stats: {
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    engagement: number;
  };
  media: EnrichedPostMedia[];
}

const postViewCache = new Map<string, CacheEntry<any>>();
const profileCache = new Map<string, CacheEntry<BskyProfileView>>();

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function nowMs() {
  return Date.now();
}

function buildPostUrl(identifier: string, uri?: string): string | undefined {
  if (!uri) return undefined;
  const rkey = uri.split('/').filter(Boolean).pop();
  if (!rkey) return undefined;
  return `https://bsky.app/profile/${identifier}/post/${rkey}`;
}

function buildTwitterPostUrl(username: string, twitterId: string): string | undefined {
  if (!username || !twitterId) return undefined;
  return `https://x.com/${normalizeActor(username)}/status/${twitterId}`;
}

function normalizeActor(actor: string): string {
  return actor.trim().replace(/^@/, '').toLowerCase();
}

function extractMediaFromEmbed(embed: any): EnrichedPostMedia[] {
  if (!embed || typeof embed !== 'object') {
    return [];
  }

  const type = embed.$type;
  if (type === 'app.bsky.embed.images#view') {
    const images = Array.isArray(embed.images) ? embed.images : [];
    return images.map((image: any) => ({
      type: 'image' as const,
      url: typeof image.fullsize === 'string' ? image.fullsize : undefined,
      thumb: typeof image.thumb === 'string' ? image.thumb : undefined,
      alt: typeof image.alt === 'string' ? image.alt : undefined,
      width: typeof image.aspectRatio?.width === 'number' ? image.aspectRatio.width : undefined,
      height: typeof image.aspectRatio?.height === 'number' ? image.aspectRatio.height : undefined,
    }));
  }

  if (type === 'app.bsky.embed.video#view') {
    return [
      {
        type: 'video',
        url: typeof embed.playlist === 'string' ? embed.playlist : undefined,
        thumb: typeof embed.thumbnail === 'string' ? embed.thumbnail : undefined,
        alt: typeof embed.alt === 'string' ? embed.alt : undefined,
        width: typeof embed.aspectRatio?.width === 'number' ? embed.aspectRatio.width : undefined,
        height: typeof embed.aspectRatio?.height === 'number' ? embed.aspectRatio.height : undefined,
      },
    ];
  }

  if (type === 'app.bsky.embed.external#view') {
    const external = embed.external || {};
    return [
      {
        type: 'external',
        url: typeof external.uri === 'string' ? external.uri : undefined,
        thumb: typeof external.thumb === 'string' ? external.thumb : undefined,
        title: typeof external.title === 'string' ? external.title : undefined,
        description: typeof external.description === 'string' ? external.description : undefined,
      },
    ];
  }

  if (type === 'app.bsky.embed.recordWithMedia#view') {
    return extractMediaFromEmbed(embed.media);
  }

  return [];
}

async function fetchPostViewsByUri(uris: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const uniqueUris = [...new Set(uris.filter((uri) => typeof uri === 'string' && uri.length > 0))];
  const pendingUris: string[] = [];

  for (const uri of uniqueUris) {
    const cached = postViewCache.get(uri);
    if (cached && cached.expiresAt > nowMs()) {
      result.set(uri, cached.value);
      continue;
    }
    pendingUris.push(uri);
  }

  for (const chunk of chunkArray(pendingUris, 25)) {
    if (chunk.length === 0) continue;
    const params = new URLSearchParams();
    for (const uri of chunk) params.append('uris', uri);

    try {
      const response = await axios.get(`${BSKY_APPVIEW_URL}/xrpc/app.bsky.feed.getPosts?${params.toString()}`, {
        timeout: 12_000,
      });
      const posts = Array.isArray(response.data?.posts) ? response.data.posts : [];
      for (const post of posts) {
        const uri = typeof post?.uri === 'string' ? post.uri : undefined;
        if (!uri) continue;
        postViewCache.set(uri, {
          value: post,
          expiresAt: nowMs() + POST_VIEW_CACHE_TTL_MS,
        });
        result.set(uri, post);
      }
    } catch (error) {
      console.warn('Failed to fetch post views from Bluesky appview:', error);
    }
  }

  return result;
}

async function fetchProfilesByActor(actors: string[]): Promise<Record<string, BskyProfileView>> {
  const uniqueActors = [...new Set(actors.map(normalizeActor).filter((actor) => actor.length > 0))];
  const result: Record<string, BskyProfileView> = {};
  const pendingActors: string[] = [];

  for (const actor of uniqueActors) {
    const cached = profileCache.get(actor);
    if (cached && cached.expiresAt > nowMs()) {
      result[actor] = cached.value;
      continue;
    }
    pendingActors.push(actor);
  }

  for (const chunk of chunkArray(pendingActors, 25)) {
    if (chunk.length === 0) continue;
    const params = new URLSearchParams();
    for (const actor of chunk) params.append('actors', actor);

    try {
      const response = await axios.get(`${BSKY_APPVIEW_URL}/xrpc/app.bsky.actor.getProfiles?${params.toString()}`, {
        timeout: 12_000,
      });
      const profiles = Array.isArray(response.data?.profiles) ? response.data.profiles : [];
      for (const profile of profiles) {
        const view: BskyProfileView = {
          did: typeof profile?.did === 'string' ? profile.did : undefined,
          handle: typeof profile?.handle === 'string' ? profile.handle : undefined,
          displayName: typeof profile?.displayName === 'string' ? profile.displayName : undefined,
          avatar: typeof profile?.avatar === 'string' ? profile.avatar : undefined,
        };

        const keys = [
          typeof view.handle === 'string' ? normalizeActor(view.handle) : '',
          typeof view.did === 'string' ? normalizeActor(view.did) : '',
        ].filter((key) => key.length > 0);

        for (const key of keys) {
          profileCache.set(key, { value: view, expiresAt: nowMs() + PROFILE_CACHE_TTL_MS });
          result[key] = view;
        }
      }
    } catch (error) {
      console.warn('Failed to fetch profiles from Bluesky appview:', error);
    }
  }

  for (const actor of uniqueActors) {
    const cached = profileCache.get(actor);
    if (cached && cached.expiresAt > nowMs()) {
      result[actor] = cached.value;
    }
  }

  return result;
}

function buildEnrichedPost(activity: ProcessedTweet, postView: any): EnrichedPost {
  const record = postView?.record || {};
  const author = postView?.author || {};
  const likes = Number(postView?.likeCount) || 0;
  const reposts = Number(postView?.repostCount) || 0;
  const replies = Number(postView?.replyCount) || 0;
  const quotes = Number(postView?.quoteCount) || 0;

  const identifier =
    (typeof activity.bsky_identifier === 'string' && activity.bsky_identifier.length > 0
      ? activity.bsky_identifier
      : typeof author.handle === 'string'
        ? author.handle
        : 'unknown') || 'unknown';

  return {
    bskyUri: activity.bsky_uri || '',
    bskyCid: typeof postView?.cid === 'string' ? postView.cid : activity.bsky_cid,
    bskyIdentifier: identifier,
    twitterId: activity.twitter_id,
    twitterUsername: activity.twitter_username,
    twitterUrl: buildTwitterPostUrl(activity.twitter_username, activity.twitter_id),
    postUrl: buildPostUrl(identifier, activity.bsky_uri),
    createdAt:
      (typeof record.createdAt === 'string' ? record.createdAt : undefined) ||
      activity.created_at ||
      (typeof postView?.indexedAt === 'string' ? postView.indexedAt : undefined),
    text:
      (typeof record.text === 'string' ? record.text : undefined) ||
      activity.tweet_text ||
      `Tweet ID: ${activity.twitter_id}`,
    facets: Array.isArray(record.facets) ? record.facets : [],
    author: {
      did: typeof author.did === 'string' ? author.did : undefined,
      handle:
        typeof author.handle === 'string' && author.handle.length > 0 ? author.handle : activity.bsky_identifier,
      displayName: typeof author.displayName === 'string' ? author.displayName : undefined,
      avatar: typeof author.avatar === 'string' ? author.avatar : undefined,
    },
    stats: {
      likes,
      reposts,
      replies,
      quotes,
      engagement: likes + reposts + replies + quotes,
    },
    media: extractMediaFromEmbed(postView?.embed),
  };
}

// In-memory state for triggers and scheduling
let lastCheckTime = Date.now();
let nextCheckTime = Date.now() + (getConfig().checkIntervalMinutes || 5) * 60 * 1000;
export interface PendingBackfill {
  id: string;
  limit?: number;
  queuedAt: number;
  sequence: number;
  requestId: string;
}
let pendingBackfills: PendingBackfill[] = [];
let backfillSequence = 0;

interface AppStatus {
  state: 'idle' | 'checking' | 'backfilling' | 'pacing' | 'processing';
  currentAccount?: string;
  processedCount?: number;
  totalCount?: number;
  message?: string;
  backfillMappingId?: string;
  backfillRequestId?: string;
  lastUpdate: number;
}

let currentAppStatus: AppStatus = {
  state: 'idle',
  lastUpdate: Date.now(),
};

app.use(cors());
app.use(express.json());

app.use(express.static(staticAssetsDir));

// Middleware to protect routes
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Middleware to require admin access
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// --- Auth Routes ---

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  const config = getConfig();

  if (config.users.find((u) => u.email === email)) {
    res.status(400).json({ error: 'User already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  config.users.push({ email, passwordHash });
  saveConfig(config);

  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const config = getConfig();
  const user = config.users.find((u) => u.email === email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const userIndex = config.users.findIndex((u) => u.email === email);
  const isAdmin = userIndex === 0;
  const token = jwt.sign({ email: user.email, isAdmin }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, isAdmin });
});

app.get('/api/me', authenticateToken, (req: any, res) => {
  res.json({ email: req.user.email, isAdmin: req.user.isAdmin });
});

// --- Mapping Routes ---

app.get('/api/mappings', authenticateToken, (_req, res) => {
  const config = getConfig();
  res.json(config.mappings);
});

app.post('/api/mappings', authenticateToken, (req, res) => {
  const { twitterUsernames, bskyIdentifier, bskyPassword, bskyServiceUrl, owner, groupName, groupEmoji } = req.body;
  const config = getConfig();

  // Handle both array and comma-separated string
  let usernames: string[] = [];
  if (Array.isArray(twitterUsernames)) {
    usernames = twitterUsernames;
  } else if (typeof twitterUsernames === 'string') {
    usernames = twitterUsernames
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }

  const normalizedGroupName = typeof groupName === 'string' ? groupName.trim() : '';
  const normalizedGroupEmoji = typeof groupEmoji === 'string' ? groupEmoji.trim() : '';

  const newMapping = {
    id: Math.random().toString(36).substring(7),
    twitterUsernames: usernames,
    bskyIdentifier,
    bskyPassword,
    bskyServiceUrl: bskyServiceUrl || 'https://bsky.social',
    enabled: true,
    owner,
    groupName: normalizedGroupName || undefined,
    groupEmoji: normalizedGroupEmoji || undefined,
  };

  config.mappings.push(newMapping);
  saveConfig(config);
  res.json(newMapping);
});

app.put('/api/mappings/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { twitterUsernames, bskyIdentifier, bskyPassword, bskyServiceUrl, owner, groupName, groupEmoji } = req.body;
  const config = getConfig();

  const index = config.mappings.findIndex((m) => m.id === id);
  const existingMapping = config.mappings[index];

  if (index === -1 || !existingMapping) {
    res.status(404).json({ error: 'Mapping not found' });
    return;
  }

  let usernames: string[] = existingMapping.twitterUsernames;
  if (twitterUsernames !== undefined) {
    if (Array.isArray(twitterUsernames)) {
      usernames = twitterUsernames;
    } else if (typeof twitterUsernames === 'string') {
      usernames = twitterUsernames
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
    }
  }

  let nextGroupName = existingMapping.groupName;
  if (groupName !== undefined) {
    const normalizedGroupName = typeof groupName === 'string' ? groupName.trim() : '';
    nextGroupName = normalizedGroupName || undefined;
  }

  let nextGroupEmoji = existingMapping.groupEmoji;
  if (groupEmoji !== undefined) {
    const normalizedGroupEmoji = typeof groupEmoji === 'string' ? groupEmoji.trim() : '';
    nextGroupEmoji = normalizedGroupEmoji || undefined;
  }

  const updatedMapping = {
    ...existingMapping,
    twitterUsernames: usernames,
    bskyIdentifier: bskyIdentifier || existingMapping.bskyIdentifier,
    // Only update password if provided
    bskyPassword: bskyPassword || existingMapping.bskyPassword,
    bskyServiceUrl: bskyServiceUrl || existingMapping.bskyServiceUrl,
    owner: owner || existingMapping.owner,
    groupName: nextGroupName,
    groupEmoji: nextGroupEmoji,
  };

  config.mappings[index] = updatedMapping;
  saveConfig(config);
  res.json(updatedMapping);
});

app.delete('/api/mappings/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const config = getConfig();
  config.mappings = config.mappings.filter((m) => m.id !== id);
  saveConfig(config);
  res.json({ success: true });
});

app.delete('/api/mappings/:id/cache', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const config = getConfig();
  const mapping = config.mappings.find((m) => m.id === id);
  if (!mapping) {
    res.status(404).json({ error: 'Mapping not found' });
    return;
  }

  for (const username of mapping.twitterUsernames) {
    dbService.deleteTweetsByUsername(username);
  }

  res.json({ success: true, message: 'Cache cleared for all associated accounts' });
});

app.post('/api/mappings/:id/delete-all-posts', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const config = getConfig();
  const mapping = config.mappings.find((m) => m.id === id);
  if (!mapping) {
    res.status(404).json({ error: 'Mapping not found' });
    return;
  }

  try {
    const deletedCount = await deleteAllPosts(id);
    
    // Clear local cache to stay in sync
    dbService.deleteTweetsByBskyIdentifier(mapping.bskyIdentifier);
    
    res.json({ 
        success: true, 
        message: `Deleted ${deletedCount} posts from ${mapping.bskyIdentifier} and cleared local cache.` 
    });
  } catch (err) {
    console.error('Failed to delete all posts:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Twitter Config Routes (Admin Only) ---

app.get('/api/twitter-config', authenticateToken, requireAdmin, (_req, res) => {
  const config = getConfig();
  res.json(config.twitter);
});

app.post('/api/twitter-config', authenticateToken, requireAdmin, (req, res) => {
  const { authToken, ct0, backupAuthToken, backupCt0 } = req.body;
  const config = getConfig();
  config.twitter = { authToken, ct0, backupAuthToken, backupCt0 };
  saveConfig(config);
  res.json({ success: true });
});

app.get('/api/ai-config', authenticateToken, requireAdmin, (_req, res) => {
  const config = getConfig();
  // Return legacy gemini key as part of new structure if needed
  const aiConfig = config.ai || {
    provider: 'gemini',
    apiKey: config.geminiApiKey || '',
  };
  res.json(aiConfig);
});

app.post('/api/ai-config', authenticateToken, requireAdmin, (req, res) => {
  const { provider, apiKey, model, baseUrl } = req.body;
  const config = getConfig();

  config.ai = {
    provider,
    apiKey,
    model: model || undefined,
    baseUrl: baseUrl || undefined,
  };

  // Clear legacy key to avoid confusion
  delete config.geminiApiKey;

  saveConfig(config);
  res.json({ success: true });
});

// --- Status & Actions Routes ---

app.get('/api/status', authenticateToken, (_req, res) => {
  const config = getConfig();
  const now = Date.now();
  const checkIntervalMs = (config.checkIntervalMinutes || 5) * 60 * 1000;
  const nextRunMs = Math.max(0, nextCheckTime - now);

  res.json({
    lastCheckTime,
    nextCheckTime,
    nextCheckMinutes: Math.ceil(nextRunMs / 60000),
    checkIntervalMinutes: config.checkIntervalMinutes,
    pendingBackfills: pendingBackfills
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((backfill, index) => ({
        ...backfill,
        position: index + 1,
      })),
    currentStatus: currentAppStatus,
  });
});

app.post('/api/run-now', authenticateToken, (_req, res) => {
  lastCheckTime = 0;
  nextCheckTime = Date.now() + 1000;
  res.json({ success: true, message: 'Check triggered' });
});

app.post('/api/backfill/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { limit } = req.body;
  const config = getConfig();
  const mapping = config.mappings.find((m) => m.id === id);

  if (!mapping) {
    res.status(404).json({ error: 'Mapping not found' });
    return;
  }

  const queuedAt = Date.now();
  const sequence = backfillSequence++;
  const requestId = Math.random().toString(36).slice(2);
  pendingBackfills = pendingBackfills.filter((b) => b.id !== id);
  pendingBackfills.push({
    id,
    limit: limit ? Number(limit) : undefined,
    queuedAt,
    sequence,
    requestId,
  });
  pendingBackfills.sort((a, b) => a.sequence - b.sequence);

  // Do not force a global run; the scheduler loop will pick up the pending backfill in ~5s
  res.json({
    success: true,
    message: `Backfill queued for @${mapping.twitterUsernames.join(', ')}`,
    requestId,
  });
});

app.delete('/api/backfill/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  pendingBackfills = pendingBackfills.filter((bid) => bid.id !== id);
  res.json({ success: true });
});

app.post('/api/backfill/clear-all', authenticateToken, requireAdmin, (_req, res) => {
  pendingBackfills = [];
  updateAppStatus({
    state: 'idle',
    message: 'All backfills cleared',
    backfillMappingId: undefined,
    backfillRequestId: undefined,
  });
  res.json({ success: true, message: 'All backfills cleared' });
});

// --- Config Management Routes ---

app.get('/api/config/export', authenticateToken, requireAdmin, (_req, res) => {
  const config = getConfig();
  // Create a copy without user data (passwords)
  const { users, ...cleanConfig } = config;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=tweets-2-bsky-config.json');
  res.json(cleanConfig);
});

app.post('/api/config/import', authenticateToken, requireAdmin, (req, res) => {
  try {
    const importData = req.body;
    const currentConfig = getConfig();

    // Validate minimal structure
    if (!importData.mappings || !Array.isArray(importData.mappings)) {
        res.status(400).json({ error: 'Invalid config format: missing mappings array' });
        return;
    }

    // Merge logic:
    // 1. Keep current users (don't overwrite admin/passwords)
    // 2. Overwrite mappings, twitter, ai config from import
    // 3. Keep current values if import is missing them (optional, but safer to just replace sections)
    
    const newConfig = {
        ...currentConfig,
        mappings: importData.mappings,
        twitter: importData.twitter || currentConfig.twitter,
        ai: importData.ai || currentConfig.ai,
        checkIntervalMinutes: importData.checkIntervalMinutes || currentConfig.checkIntervalMinutes
    };

    saveConfig(newConfig);
    res.json({ success: true, message: 'Configuration imported successfully' });
  } catch (err) {
    console.error('Import failed:', err);
    res.status(500).json({ error: 'Failed to process import file' });
  }
});

app.get('/api/recent-activity', authenticateToken, (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const tweets = dbService.getRecentProcessedTweets(limit);
  res.json(tweets);
});

app.post('/api/bsky/profiles', authenticateToken, async (req, res) => {
  const actors = Array.isArray(req.body?.actors)
    ? req.body.actors.filter((actor: unknown) => typeof actor === 'string')
    : [];

  if (actors.length === 0) {
    res.json({});
    return;
  }

  const limitedActors = actors.slice(0, 200);
  const profiles = await fetchProfilesByActor(limitedActors);
  res.json(profiles);
});

app.get('/api/posts/enriched', authenticateToken, async (req, res) => {
  const requestedLimit = req.query.limit ? Number(req.query.limit) : 24;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 80)) : 24;

  const recent = dbService.getRecentProcessedTweets(limit * 4);
  const migratedWithUri = recent.filter((row) => row.status === 'migrated' && row.bsky_uri);

  const deduped: ProcessedTweet[] = [];
  const seenUris = new Set<string>();
  for (const row of migratedWithUri) {
    const uri = row.bsky_uri;
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }

  const uris = deduped.map((row) => row.bsky_uri).filter((uri): uri is string => typeof uri === 'string');
  const postViewsByUri = await fetchPostViewsByUri(uris);
  const enriched = deduped.map((row) => buildEnrichedPost(row, row.bsky_uri ? postViewsByUri.get(row.bsky_uri) : null));

  res.json(enriched);
});

// Export for use by index.ts
export function updateLastCheckTime() {
  const config = getConfig();
  lastCheckTime = Date.now();
  nextCheckTime = lastCheckTime + (config.checkIntervalMinutes || 5) * 60 * 1000;
}

export function updateAppStatus(status: Partial<AppStatus>) {
  currentAppStatus = {
    ...currentAppStatus,
    ...status,
    lastUpdate: Date.now(),
  };
}

export function getPendingBackfills(): PendingBackfill[] {
  return [...pendingBackfills].sort((a, b) => a.sequence - b.sequence);
}

export function getNextCheckTime(): number {
  return nextCheckTime;
}

export function clearBackfill(id: string, requestId?: string) {
  if (requestId) {
    pendingBackfills = pendingBackfills.filter((bid) => !(bid.id === id && bid.requestId === requestId));
    return;
  }
  pendingBackfills = pendingBackfills.filter((bid) => bid.id !== id);
}

// Serve the frontend for any other route (middleware approach for Express 5)
app.use((_req, res) => {
  res.sendFile(path.join(staticAssetsDir, 'index.html'));
});

export function startServer() {
  app.listen(PORT, '0.0.0.0' as any, () => {
    console.log(`🚀 Web interface running at http://localhost:${PORT}`);
    console.log('📡 Accessible on your local network/Tailscale via your IP.');
  });
}
