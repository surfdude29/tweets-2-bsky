import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { getConfig, saveConfig } from './config-manager.js';
import { dbService } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// In-memory state for triggers and scheduling
let lastCheckTime = Date.now();
let nextCheckTime = Date.now() + (getConfig().checkIntervalMinutes || 5) * 60 * 1000;
interface PendingBackfill {
  id: string;
  limit?: number;
}
let pendingBackfills: PendingBackfill[] = [];

interface AppStatus {
  state: 'idle' | 'checking' | 'backfilling' | 'pacing' | 'processing';
  currentAccount?: string;
  processedCount?: number;
  totalCount?: number;
  message?: string;
  lastUpdate: number;
}

let currentAppStatus: AppStatus = {
  state: 'idle',
  lastUpdate: Date.now(),
};

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));

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
  const { twitterUsernames, bskyIdentifier, bskyPassword, bskyServiceUrl, owner } = req.body;
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

  const newMapping = {
    id: Math.random().toString(36).substring(7),
    twitterUsernames: usernames,
    bskyIdentifier,
    bskyPassword,
    bskyServiceUrl: bskyServiceUrl || 'https://bsky.social',
    enabled: true,
    owner,
  };

  config.mappings.push(newMapping);
  saveConfig(config);
  res.json(newMapping);
});

app.put('/api/mappings/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { twitterUsernames, bskyIdentifier, bskyPassword, bskyServiceUrl, owner } = req.body;
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

  const updatedMapping = {
    ...existingMapping,
    twitterUsernames: usernames,
    bskyIdentifier: bskyIdentifier || existingMapping.bskyIdentifier,
    // Only update password if provided
    bskyPassword: bskyPassword || existingMapping.bskyPassword,
    bskyServiceUrl: bskyServiceUrl || existingMapping.bskyServiceUrl,
    owner: owner || existingMapping.owner,
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
    pendingBackfills,
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

  if (!pendingBackfills.find((b) => b.id === id)) {
    pendingBackfills.push({ id, limit: limit ? Number(limit) : undefined });
  }

  // Do not force a global run; the scheduler loop will pick up the pending backfill in ~5s
  res.json({ success: true, message: `Backfill queued for @${mapping.twitterUsernames.join(', ')}` });
});

app.delete('/api/backfill/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  pendingBackfills = pendingBackfills.filter((bid) => bid.id !== id);
  res.json({ success: true });
});

app.post('/api/backfill/clear-all', authenticateToken, requireAdmin, (_req, res) => {
  pendingBackfills = [];
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
  return [...pendingBackfills];
}

export function getNextCheckTime(): number {
  return nextCheckTime;
}

export function clearBackfill(id: string) {
  pendingBackfills = pendingBackfills.filter((bid) => bid.id !== id);
}

// Serve the frontend for any other route (middleware approach for Express 5)
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

export function startServer() {
  app.listen(PORT, '0.0.0.0' as any, () => {
    console.log(`🚀 Web interface running at http://localhost:${PORT}`);
    console.log('📡 Accessible on your local network/Tailscale via your IP.');
  });
}
