import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BskyAgent, RichText } from '@atproto/api';
import type { BlobRef } from '@atproto/api';
import { Scraper } from '@the-convocation/twitter-scraper';
import type { Tweet as ScraperTweet } from '@the-convocation/twitter-scraper';
import axios from 'axios';
import { Command } from 'commander';
import * as francModule from 'franc-min';
import iso6391 from 'iso-639-1';
import puppeteer from 'puppeteer-core';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { generateAltText } from './ai-manager.js';

import { getConfig } from './config-manager.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================ 
// Type Definitions
// ============================================================================ 

interface ProcessedTweetEntry {
  uri?: string;
  cid?: string;
  root?: { uri: string; cid: string };
  migrated?: boolean;
  skipped?: boolean;
}

interface ProcessedTweetsMap {
  [twitterId: string]: ProcessedTweetEntry;
}

interface UrlEntity {
  url?: string;
  expanded_url?: string;
}

interface MediaSize {
  w: number;
  h: number;
}

interface MediaSizes {
  large?: MediaSize;
}

interface OriginalInfo {
  width: number;
  height: number;
}

interface VideoVariant {
  content_type: string;
  url: string;
  bitrate?: number;
}

interface VideoInfo {
  variants?: VideoVariant[];
  duration_millis?: number;
}

interface MediaEntity {
  url?: string;
  expanded_url?: string;
  media_url_https?: string;
  type?: 'photo' | 'video' | 'animated_gif';
  ext_alt_text?: string;
  sizes?: MediaSizes;
  original_info?: OriginalInfo;
  video_info?: VideoInfo;
}

interface TweetEntities {
  urls?: UrlEntity[];
  media?: MediaEntity[];
}

interface Tweet {
  id?: string;
  id_str?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  entities?: TweetEntities;
  extended_entities?: TweetEntities;
  quoted_status_id_str?: string;
  is_quote_status?: boolean;
  in_reply_to_status_id_str?: string;
  in_reply_to_status_id?: string;
  in_reply_to_user_id_str?: string;
  in_reply_to_user_id?: string;
}

interface AspectRatio {
  width: number;
  height: number;
}

interface ImageEmbed {
  alt: string;
  image: BlobRef;
  aspectRatio?: AspectRatio;
}

import { dbService } from './db.js';

// ============================================================================ 
// State Management
// ============================================================================ 

const PROCESSED_DIR = path.join(__dirname, '..', 'processed');

async function migrateJsonToSqlite() {
  if (!fs.existsSync(PROCESSED_DIR)) return;
  
  const files = fs.readdirSync(PROCESSED_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return;

  console.log(`📦 Found ${files.length} legacy cache files. Migrating to SQLite...`);
  const config = getConfig();
  
  for (const file of files) {
    const username = file.replace('.json', '').toLowerCase();
    // Try to find a matching bskyIdentifier from config
    const mapping = config.mappings.find(m => m.twitterUsernames.map(u => u.toLowerCase()).includes(username));
    const bskyIdentifier = mapping?.bskyIdentifier || 'unknown';

    try {
      const filePath = path.join(PROCESSED_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProcessedTweetsMap;
      
      for (const [twitterId, entry] of Object.entries(data)) {
        dbService.saveTweet({
          twitter_id: twitterId,
          twitter_username: username,
          bsky_identifier: bskyIdentifier,
          bsky_uri: entry.uri,
          bsky_cid: entry.cid,
          bsky_root_uri: entry.root?.uri,
          bsky_root_cid: entry.root?.cid,
          status: entry.migrated ? 'migrated' : (entry.skipped ? 'skipped' : 'failed')
        });
      }
      // Move file to backup
      const backupDir = path.join(PROCESSED_DIR, 'backup');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
      fs.renameSync(filePath, path.join(backupDir, file));
    } catch (err) {
      console.error(`❌ Failed to migrate ${file}:`, err);
    }
  }

  // REPAIR STEP: Fix any 'unknown' records in SQLite that came from the broken schema migration
  for (const mapping of config.mappings) {
    for (const username of mapping.twitterUsernames) {
      dbService.repairUnknownIdentifiers(username, mapping.bskyIdentifier);
    }
  }
  
  console.log('✅ Migration complete.');
}

function loadProcessedTweets(bskyIdentifier: string): ProcessedTweetsMap {
  return dbService.getTweetsByBskyIdentifier(bskyIdentifier);
}

function saveProcessedTweet(twitterUsername: string, bskyIdentifier: string, twitterId: string, entry: ProcessedTweetEntry): void {
  dbService.saveTweet({
    twitter_id: twitterId,
    twitter_username: twitterUsername.toLowerCase(),
    bsky_identifier: bskyIdentifier.toLowerCase(),
    bsky_uri: entry.uri,
    bsky_cid: entry.cid,
    bsky_root_uri: entry.root?.uri,
    bsky_root_cid: entry.root?.cid,
    status: entry.migrated || (entry.uri && entry.cid) ? 'migrated' : (entry.skipped ? 'skipped' : 'failed')
  });
}

// ============================================================================ 
// Custom Twitter Client
// ============================================================================ 

let scraper: Scraper | null = null;
let currentTwitterCookies = { authToken: '', ct0: '' };

async function getTwitterScraper(): Promise<Scraper | null> {
  const config = getConfig();
  if (!config.twitter.authToken || !config.twitter.ct0) return null;
  
  // Re-initialize if config changed or not yet initialized
  if (!scraper || 
      currentTwitterCookies.authToken !== config.twitter.authToken || 
      currentTwitterCookies.ct0 !== config.twitter.ct0) {
    
    scraper = new Scraper();
    await scraper.setCookies([
        `auth_token=${config.twitter.authToken}`,
        `ct0=${config.twitter.ct0}`
    ]);

    currentTwitterCookies = { 
      authToken: config.twitter.authToken, 
      ct0: config.twitter.ct0 
    };
  }
  return scraper;
}

function mapScraperTweetToLocalTweet(scraperTweet: ScraperTweet): Tweet {
    const raw = scraperTweet.__raw_UNSTABLE;
    if (!raw) {
        // Fallback if raw data is missing (shouldn't happen for timeline tweets usually)
        return {
            id: scraperTweet.id,
            id_str: scraperTweet.id,
            text: scraperTweet.text,
            full_text: scraperTweet.text,
            // Construct minimal entities from parsed data
            entities: {
                urls: scraperTweet.urls.map(url => ({ url, expanded_url: url })),
                media: scraperTweet.photos.map(p => ({
                    url: p.url,
                    expanded_url: p.url,
                    media_url_https: p.url,
                    type: 'photo',
                    ext_alt_text: p.alt_text,
                })),
            },
            created_at: scraperTweet.timeParsed?.toUTCString()
        };
    }
  
    return {
      id: raw.id_str,
      id_str: raw.id_str,
      text: raw.full_text,
      full_text: raw.full_text,
      created_at: raw.created_at,
      // biome-ignore lint/suspicious/noExplicitAny: raw types match compatible structure
      entities: raw.entities as any,
      // biome-ignore lint/suspicious/noExplicitAny: raw types match compatible structure
      extended_entities: raw.extended_entities as any,
      quoted_status_id_str: raw.quoted_status_id_str,
      is_quote_status: !!raw.quoted_status_id_str,
      in_reply_to_status_id_str: raw.in_reply_to_status_id_str,
      // biome-ignore lint/suspicious/noExplicitAny: missing in LegacyTweetRaw type
      in_reply_to_user_id_str: (raw as any).in_reply_to_user_id_str,
    };
}

// ============================================================================ 
// Helper Functions
// ============================================================================ 

function detectLanguage(text: string): string[] {
  if (!text || text.trim().length === 0) return ['en'];
  try {
    const code3 = (francModule as unknown as (text: string) => string)(text);
    if (code3 === 'und') return ['en'];
    const code2 = iso6391.getCode(code3);
    return code2 ? [code2] : ['en'];
  } catch {
    return ['en'];
  }
}

async function expandUrl(shortUrl: string): Promise<string> {
  try {
    const response = await axios.head(shortUrl, {
      maxRedirects: 10,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    // biome-ignore lint/suspicious/noExplicitAny: axios internal types
    return (response.request as any)?.res?.responseUrl || shortUrl;
  } catch {
    try {
      const response = await axios.get(shortUrl, {
        responseType: 'stream',
        maxRedirects: 10,
      });
      response.data.destroy();
      // biome-ignore lint/suspicious/noExplicitAny: axios internal types
      return (response.request as any)?.res?.responseUrl || shortUrl;
    } catch {
      return shortUrl;
    }
  }
}

interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
}

async function downloadMedia(url: string): Promise<DownloadedMedia> {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return {
    buffer: Buffer.from(response.data as ArrayBuffer),
    mimeType: (response.headers['content-type'] as string) || 'application/octet-stream',
  };
}

async function uploadToBluesky(agent: BskyAgent, buffer: Buffer, mimeType: string): Promise<BlobRef> {
  let finalBuffer = buffer;
  let finalMimeType = mimeType;
  const MAX_SIZE = 950 * 1024;

  const isPng = mimeType === 'image/png';
  const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
  const isWebp = mimeType === 'image/webp';
  const isGif = mimeType === 'image/gif';
  const isAnimation = isGif || isWebp;

  if ((buffer.length > MAX_SIZE && (mimeType.startsWith('image/') || mimeType === 'application/octet-stream')) || (isPng && buffer.length > MAX_SIZE)) {
    console.log(`[UPLOAD] ⚖️ Image too large (${(buffer.length / 1024).toFixed(2)} KB). Optimizing...`);
    try {
      let image = sharp(buffer);
      const metadata = await image.metadata();
      let currentBuffer = buffer;
      let width = metadata.width || 2000;
      let quality = 90;

      // Iterative compression loop
      let attempts = 0;
      while (currentBuffer.length > MAX_SIZE && attempts < 5) {
        attempts++;
        console.log(`[UPLOAD] 📉 Compression attempt ${attempts}: Width ${width}, Quality ${quality}...`);
        
        if (isAnimation) {
             // For animations (GIF/WebP), we can only do so much without losing frames
             // Try to convert to WebP if it's a GIF, or optimize WebP
             image = sharp(buffer, { animated: true });
             if (isGif) {
                 // Convert GIF to WebP for better compression
                 image = image.webp({ quality: Math.max(quality, 50), effort: 6 });
                 finalMimeType = 'image/webp';
             } else {
                 image = image.webp({ quality: Math.max(quality, 50), effort: 6 });
             }
             // Resize if really big
             if (metadata.width && metadata.width > 800) {
                 image = image.resize({ width: 800, withoutEnlargement: true });
             }
        } else {
            // Static images
            if (width > 1600) width = 1600;
            else if (attempts > 1) width = Math.floor(width * 0.8);
            
            quality = Math.max(50, quality - 10);
            
            image = sharp(buffer)
                .resize({ width, withoutEnlargement: true })
                .jpeg({ quality, mozjpeg: true });
            
            finalMimeType = 'image/jpeg';
        }
        
        currentBuffer = await image.toBuffer();
        if (currentBuffer.length <= MAX_SIZE) {
            finalBuffer = currentBuffer;
            console.log(`[UPLOAD] ✅ Optimized to ${(finalBuffer.length / 1024).toFixed(2)} KB`);
            break;
        }
      }
      
      if (finalBuffer.length > MAX_SIZE) {
          console.warn(`[UPLOAD] ⚠️ Could not compress below limit. Current: ${(finalBuffer.length / 1024).toFixed(2)} KB. Upload might fail.`);
      }

    } catch (err) {
      console.warn(`[UPLOAD] ⚠️ Optimization failed, attempting original upload:`, (err as Error).message);
      finalBuffer = buffer;
      finalMimeType = mimeType;
    }
  }

  const { data } = await agent.uploadBlob(finalBuffer, { encoding: finalMimeType });
  return data.blob;
}

async function captureTweetScreenshot(tweetUrl: string): Promise<Buffer | null> {
  const browserPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  const executablePath = browserPaths.find(p => fs.existsSync(p));
  
  if (!executablePath) {
    console.warn(`[SCREENSHOT] ⏩ Skipping screenshot (no Chrome/Chromium found at common paths).`);
    return null;
  }

  console.log(`[SCREENSHOT] 📸 Capturing screenshot for: ${tweetUrl} using ${executablePath}`);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            margin: 0; 
            padding: 20px; 
            background: #ffffff; 
            display: flex; 
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          #container { width: 550px; }
        </style>
      </head>
      <body>
        <div id="container">
          <blockquote class="twitter-tweet" data-dnt="true">
            <a href="${tweetUrl}"></a>
          </blockquote>
          <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Wait for the twitter iframe to load and render
    try {
      await page.waitForSelector('iframe', { timeout: 10000 });
      // Small extra wait for images inside iframe
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.warn(`[SCREENSHOT] ⚠️ Timeout waiting for tweet iframe, taking screenshot anyway.`);
    }

    const element = await page.$('#container');
    if (element) {
      const buffer = await element.screenshot({ type: 'png', omitBackground: true });
      console.log(`[SCREENSHOT] ✅ Captured successfully (${(buffer.length / 1024).toFixed(2)} KB)`);
      return buffer as Buffer;
    }
  } catch (err) {
    console.error(`[SCREENSHOT] ❌ Error capturing tweet:`, (err as Error).message);
  } finally {
    if (browser) await browser.close();
  }
  return null;
}

async function pollForVideoProcessing(agent: BskyAgent, jobId: string): Promise<BlobRef> {
  console.log(`[VIDEO] ⏳ Polling for processing completion (this can take a minute)...`);
  let attempts = 0;
  let blob: BlobRef | undefined;

  while (!blob) {
    attempts++;
    const statusUrl = new URL("https://video.bsky.app/xrpc/app.bsky.video.getJobStatus");
    statusUrl.searchParams.append("jobId", jobId);

    const statusResponse = await fetch(statusUrl);
    if (!statusResponse.ok) {
      console.warn(`[VIDEO] ⚠️ Job status fetch failed (${statusResponse.status}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    const statusData = (await statusResponse.json()) as any;
    const state = statusData.jobStatus.state;
    const progress = statusData.jobStatus.progress || 0;

    console.log(`[VIDEO] 🔄 Job ${jobId}: ${state} (${progress}%)`);

    if (statusData.jobStatus.blob) {
      blob = statusData.jobStatus.blob;
      console.log(`[VIDEO] 🎉 Video processing complete! Blob ref obtained.`);
    } else if (state === "JOB_STATE_FAILED") {
      throw new Error(`Video processing failed: ${statusData.jobStatus.error || "Unknown error"}`);
    } else {
      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    if (attempts > 60) {
      // ~5 minute timeout
      throw new Error("Video processing timed out after 5 minutes.");
    }
  }
  return blob!;
}

async function fetchEmbedUrlCard(agent: BskyAgent, url: string): Promise<any> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    });
    
    const $ = cheerio.load(response.data);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    let thumbBlob: BlobRef | undefined;

    let imageUrl = $('meta[property="og:image"]').attr('content');
    if (imageUrl) {
        if (!imageUrl.startsWith('http')) {
            const baseUrl = new URL(url);
            imageUrl = new URL(imageUrl, baseUrl.origin).toString();
        }
        try {
            const { buffer, mimeType } = await downloadMedia(imageUrl);
            thumbBlob = await uploadToBluesky(agent, buffer, mimeType);
        } catch (e) {
            console.warn(`Failed to upload thumbnail for ${url}:`, e);
        }
    }

    if (!title && !description) return null;

    const external: any = {
        uri: url,
        title: title || url,
        description: description,
    };

    if (thumbBlob) {
        external.thumb = thumbBlob;
    }

    return {
        $type: 'app.bsky.embed.external',
        external,
    };

  } catch (err) {
    console.warn(`Failed to fetch embed card for ${url}:`, err);
    return null;
  }
}

async function uploadVideoToBluesky(agent: BskyAgent, buffer: Buffer, filename: string): Promise<BlobRef> {
  const sanitizedFilename = filename.split("?")[0] || "video.mp4";
  console.log(
    `[VIDEO] 🟢 Starting upload process for ${sanitizedFilename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
  );

  try {
    // 1. Get Service Auth
    // We need to resolve the actual PDS host for this DID
    console.log(`[VIDEO] 🔍 Resolving PDS host for DID: ${agent.session!.did}...`);
    const { data: repoDesc } = await agent.com.atproto.repo.describeRepo({ repo: agent.session!.did! });

    // didDoc might be present in repoDesc
    const pdsService = (repoDesc as any).didDoc?.service?.find(
      (s: any) => s.id === "#atproto_pds" || s.type === "AtProtoPds",
    );
    const pdsUrl = pdsService?.serviceEndpoint;
    const pdsHost = pdsUrl ? new URL(pdsUrl).host : "bsky.social";

    console.log(`[VIDEO] 🌐 PDS Host detected: ${pdsHost}`);
    console.log(`[VIDEO] 🔑 Requesting service auth token for audience: did:web:${pdsHost}...`);

    const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
      aud: `did:web:${pdsHost}`,
      lxm: "com.atproto.repo.uploadBlob",
      exp: Math.floor(Date.now() / 1000) + 60 * 30,
    });
    console.log(`[VIDEO] ✅ Service auth token obtained.`);

    const token = serviceAuth.token;

    // 2. Upload to Video Service
    const uploadUrl = new URL("https://video.bsky.app/xrpc/app.bsky.video.uploadVideo");
    uploadUrl.searchParams.append("did", agent.session!.did!);
    uploadUrl.searchParams.append("name", sanitizedFilename);

    console.log(`[VIDEO] 📤 Uploading to ${uploadUrl.href}...`);
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "video/mp4",
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`[VIDEO] ❌ Server responded with ${uploadResponse.status}: ${errorText}`);

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error === "already_exists" && errorJson.jobId) {
          console.log(`[VIDEO] ♻️ Video already exists. Resuming with Job ID: ${errorJson.jobId}`);
          return await pollForVideoProcessing(agent, errorJson.jobId);
        }
        if (errorJson.error === "unconfirmed_email" || (errorJson.jobStatus && errorJson.jobStatus.error === "unconfirmed_email")) {
            console.error(`[VIDEO] 🛑 BLUESKY ERROR: Your email is unconfirmed. You MUST verify your email on Bluesky to upload videos.`);
            throw new Error("Bluesky Email Unconfirmed - Video Upload Rejected");
        }
      } catch (e) {
        // Not JSON or missing fields, proceed with throwing
      }

      throw new Error(`Video upload failed: ${uploadResponse.status} ${errorText}`);
    }

    const jobStatus = (await uploadResponse.json()) as any;
    console.log(`[VIDEO] 📦 Upload accepted. Job ID: ${jobStatus.jobId}, State: ${jobStatus.state}`);

    if (jobStatus.blob) {
      return jobStatus.blob;
    }

    // 3. Poll for processing status
    return await pollForVideoProcessing(agent, jobStatus.jobId);
  } catch (err) {
    console.error(`[VIDEO] ❌ Error in uploadVideoToBluesky:`, (err as Error).message);
    throw err;
  }
}

function splitText(text: string, limit = 300): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split by paragraph
    let splitIndex = remaining.lastIndexOf('\n\n', limit);
    if (splitIndex === -1) {
      // Try to split by sentence
      splitIndex = remaining.lastIndexOf('. ', limit);
      if (splitIndex === -1) {
        // Try to split by space
        splitIndex = remaining.lastIndexOf(' ', limit);
        if (splitIndex === -1) {
          // Force split
          splitIndex = limit;
        }
      } else {
        splitIndex += 1; // Include the period
      }
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

// Replaced safeSearch with fetchUserTweets to use UserTweets endpoint instead of Search
async function fetchUserTweets(username: string, limit: number): Promise<Tweet[]> {
  const client = await getTwitterScraper();
  if (!client) return [];
  
  const tweets: Tweet[] = [];
  try {
    const generator = client.getTweets(username, limit);
    for await (const t of generator) {
      tweets.push(mapScraperTweetToLocalTweet(t));
      if (tweets.length >= limit) break;
    }
  } catch (e) {
    console.warn(`Error fetching tweets for ${username}:`, e);
  }
  return tweets;
}

// ============================================================================ 
// Main Processing Logic
// ============================================================================ 

// ============================================================================ 
// Main Processing Logic
// ============================================================================ 

async function processTweets(
  agent: BskyAgent,
  twitterUsername: string,
  bskyIdentifier: string,
  tweets: Tweet[],
  dryRun = false,
): Promise<void> {
  const processedTweets = loadProcessedTweets(bskyIdentifier);
  const toProcess = tweets.filter(t => !processedTweets[t.id_str || t.id || '']);
  
  if (toProcess.length === 0) {
    console.log(`[${twitterUsername}] ✅ No new tweets to process for ${bskyIdentifier}.`);
    return;
  }

  console.log(`[${twitterUsername}] 🚀 Processing ${toProcess.length} new tweets for ${bskyIdentifier}...`);
  
  tweets.reverse();
  let count = 0;
  for (const tweet of tweets) {
    count++;
    const tweetId = tweet.id_str || tweet.id;
    if (!tweetId) continue;

    if (processedTweets[tweetId]) continue;

    console.log(`\n[${twitterUsername}] 🕒 Processing tweet: ${tweetId}`);
    updateAppStatus({
      state: 'processing',
      currentAccount: twitterUsername,
      processedCount: count,
      totalCount: tweets.length,
      message: `Processing tweet ${tweetId}`,
    });

    const replyStatusId = tweet.in_reply_to_status_id_str || tweet.in_reply_to_status_id;
    const replyUserId = tweet.in_reply_to_user_id_str || tweet.in_reply_to_user_id;
    const tweetText = tweet.full_text || tweet.text || '';
    const isReply = !!replyStatusId || !!replyUserId || tweetText.trim().startsWith('@');

    let replyParentInfo: ProcessedTweetEntry | null = null;

    if (isReply) {
      if (replyStatusId && processedTweets[replyStatusId]) {
        console.log(`[${twitterUsername}] 🧵 Threading reply to post in ${bskyIdentifier}: ${replyStatusId}`);
        replyParentInfo = processedTweets[replyStatusId] ?? null;
      } else {
        console.log(`[${twitterUsername}] ⏩ Skipping external/unknown reply.`);
        if (!dryRun) {
          saveProcessedTweet(twitterUsername, bskyIdentifier, tweetId, { skipped: true });
        }
        continue;
      }
    }

    // Removed early dryRun continue to allow verifying logic
    
    let text = tweetText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // 1. Link Expansion
    console.log(`[${twitterUsername}] 🔗 Expanding links...`);
    const urls = tweet.entities?.urls || [];
    for (const urlEntity of urls) {
      const tco = urlEntity.url;
      const expanded = urlEntity.expanded_url;
      if (tco && expanded) text = text.replace(tco, expanded);
    }

    // Fallback: Regex for t.co links (if entities failed or missed one)
    const tcoRegex = /https:\/\/t\.co\/[a-zA-Z0-9]+/g;
    const matches = text.match(tcoRegex) || [];
    for (const tco of matches) {
      // Avoid re-resolving if we already handled it via entities
      if (urls.some(u => u.url === tco)) continue;

      console.log(`[${twitterUsername}] 🔍 Resolving fallback link: ${tco}`);
      const resolved = await expandUrl(tco);
      if (resolved !== tco) {
          text = text.replace(tco, resolved);
          // Add to urls array so it can be used for card embedding later
          urls.push({ url: tco, expanded_url: resolved });
      }
    }

    // 2. Media Handling
    const images: ImageEmbed[] = [];
    let videoBlob: BlobRef | null = null;
    let videoAspectRatio: AspectRatio | undefined;
    const mediaEntities = tweet.extended_entities?.media || tweet.entities?.media || [];
    const mediaLinksToRemove: string[] = [];

    console.log(`[${twitterUsername}] 🖼️ Found ${mediaEntities.length} media entities.`);

    for (const media of mediaEntities) {
      if (media.url) {
        mediaLinksToRemove.push(media.url);
        if (media.expanded_url) mediaLinksToRemove.push(media.expanded_url);
      }
      
      let aspectRatio: AspectRatio | undefined;
      if (media.sizes?.large) {
        aspectRatio = { width: media.sizes.large.w, height: media.sizes.large.h };
      } else if (media.original_info) {
        aspectRatio = { width: media.original_info.width, height: media.original_info.height };
      }

      if (media.type === 'photo') {
        const url = media.media_url_https;
        if (!url) continue;
        try {
          const highQualityUrl = url.includes('?') ? url.replace('?', ':orig?') : url + ':orig';
          console.log(`[${twitterUsername}] 📥 Downloading image (high quality): ${path.basename(highQualityUrl)}`);
          updateAppStatus({ message: `Downloading high quality image...` });
          const { buffer, mimeType } = await downloadMedia(highQualityUrl);
          
          let blob: BlobRef;
          if (dryRun) {
             console.log(`[${twitterUsername}] 🧪 [DRY RUN] Would upload image (${(buffer.length/1024).toFixed(2)} KB)`);
             blob = { ref: { toString: () => 'mock-blob' }, mimeType, size: buffer.length } as any;
          } else {
             console.log(`[${twitterUsername}] 📤 Uploading image to Bluesky...`);
             updateAppStatus({ message: `Uploading image to Bluesky...` });
             blob = await uploadToBluesky(agent, buffer, mimeType);
          }
          
          let altText = media.ext_alt_text;
          if (!altText) {
             console.log(`[${twitterUsername}] 🤖 Generating alt text via Gemini...`);
             // Use original tweet text for context, not the modified/cleaned one
             altText = await generateAltText(buffer, mimeType, tweetText);
             if (altText) console.log(`[${twitterUsername}] ✅ Alt text generated: ${altText.substring(0, 50)}...`);
          }

          images.push({ alt: altText || 'Image from Twitter', image: blob, aspectRatio });
          console.log(`[${twitterUsername}] ✅ Image uploaded.`);
        } catch (err) {
          console.error(`[${twitterUsername}] ❌ High quality upload failed:`, (err as Error).message);
          try {
            console.log(`[${twitterUsername}] 🔄 Retrying with standard quality...`);
            updateAppStatus({ message: `Retrying with standard quality...` });
            const { buffer, mimeType } = await downloadMedia(url);
            const blob = await uploadToBluesky(agent, buffer, mimeType);
            images.push({ alt: media.ext_alt_text || 'Image from Twitter', image: blob, aspectRatio });
            console.log(`[${twitterUsername}] ✅ Image uploaded on retry.`);
          } catch (retryErr) {
            console.error(`[${twitterUsername}] ❌ Retry also failed:`, (retryErr as Error).message);
          }
        }
      } else if (media.type === 'video' || media.type === 'animated_gif') {
        const variants = media.video_info?.variants || [];
        const duration = media.video_info?.duration_millis || 0;
        
        if (duration > 180000) { // 3 minutes
           console.warn(`[${twitterUsername}] ⚠️ Video too long (${(duration / 1000).toFixed(1)}s). Fallback to link.`);
           const tweetUrl = `https://twitter.com/${twitterUsername}/status/${tweetId}`;
           if (!text.includes(tweetUrl)) text += `\n\nVideo: ${tweetUrl}`;
           continue;
        }

        const mp4s = variants
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (mp4s.length > 0) {
          const firstVariant = mp4s[0];
          if (firstVariant) {
            const videoUrl = firstVariant.url;
            try {
              console.log(`[${twitterUsername}] 📥 Downloading video: ${videoUrl}`);
              updateAppStatus({ message: `Downloading video: ${path.basename(videoUrl)}` });
              const { buffer, mimeType } = await downloadMedia(videoUrl);
              
              if (buffer.length <= 90 * 1024 * 1024) {
                const filename = videoUrl.split('/').pop() || 'video.mp4';
                if (dryRun) {
                    console.log(`[${twitterUsername}] 🧪 [DRY RUN] Would upload video: ${filename} (${(buffer.length/1024/1024).toFixed(2)} MB)`);
                    videoBlob = { ref: { toString: () => 'mock-video-blob' }, mimeType: 'video/mp4', size: buffer.length } as any;
                } else {
                    updateAppStatus({ message: `Uploading video to Bluesky...` });
                    videoBlob = await uploadVideoToBluesky(agent, buffer, filename);
                }
                videoAspectRatio = aspectRatio;
                console.log(`[${twitterUsername}] ✅ Video upload process complete.`);
                break; // Prioritize first video
              }
              
              console.warn(`[${twitterUsername}] ⚠️ Video too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB). Fallback to link.`);
              const tweetUrl = `https://twitter.com/${twitterUsername}/status/${tweetId}`;
              if (!text.includes(tweetUrl)) text += `\n\nVideo: ${tweetUrl}`;
            } catch (err) {
              console.error(`[${twitterUsername}] ❌ Failed video upload flow:`, (err as Error).message);
              const tweetUrl = `https://twitter.com/${twitterUsername}/status/${tweetId}`;
              if (!text.includes(tweetUrl)) text += `\n\nVideo: ${tweetUrl}`;
            }
          }
        }
      }
    }

    // Cleanup text
    for (const link of mediaLinksToRemove) text = text.split(link).join('').trim();
    text = text.replace(/\n\s*\n/g, '\n\n').trim();

    // 3. Quoting Logic
    let quoteEmbed: { $type: string; record: { uri: string; cid: string } } | null = null;
    let externalQuoteUrl: string | null = null;
    let linkCard: any = null;

    if (tweet.is_quote_status && tweet.quoted_status_id_str) {
      const quoteId = tweet.quoted_status_id_str;
      const quoteRef = processedTweets[quoteId];
      if (quoteRef && !quoteRef.migrated && quoteRef.uri && quoteRef.cid) {
        console.log(`[${twitterUsername}] 🔄 Found quoted tweet in local history. Natively embedding.`);
        quoteEmbed = { $type: 'app.bsky.embed.record', record: { uri: quoteRef.uri, cid: quoteRef.cid } };
      } else {
        const quoteUrlEntity = urls.find((u) => u.expanded_url?.includes(quoteId));
        const qUrl = quoteUrlEntity?.expanded_url || `https://twitter.com/i/status/${quoteId}`;
        
        // Check if it's a self-quote (same user)
        const isSelfQuote = qUrl.toLowerCase().includes(`twitter.com/${twitterUsername.toLowerCase()}/`) || 
                           qUrl.toLowerCase().includes(`x.com/${twitterUsername.toLowerCase()}/`);
        
        if (!isSelfQuote) {
          externalQuoteUrl = qUrl;
          console.log(`[${twitterUsername}] 🔗 Quoted tweet is external: ${externalQuoteUrl}`);
          
          // Try to capture screenshot for external QTs if we have space for images
          if (images.length < 4 && !videoBlob) {
            const ssBuffer = await captureTweetScreenshot(externalQuoteUrl);
            if (ssBuffer) {
              try {
                let blob: BlobRef;
                if (dryRun) {
                    console.log(`[${twitterUsername}] 🧪 [DRY RUN] Would upload screenshot for quote (${(ssBuffer.length/1024).toFixed(2)} KB)`);
                    blob = { ref: { toString: () => 'mock-ss-blob' }, mimeType: 'image/png', size: ssBuffer.length } as any;
                } else {
                    blob = await uploadToBluesky(agent, ssBuffer, 'image/png');
                }
                images.push({ alt: `Quote Tweet: ${externalQuoteUrl}`, image: blob });
              } catch (e) {
                console.warn(`[${twitterUsername}] ⚠️ Failed to upload screenshot blob.`);
              }
            }
          }
        } else {
          console.log(`[${twitterUsername}] 🔁 Quoted tweet is a self-quote, skipping link.`);
        }
      }
    } else if (images.length === 0 && !videoBlob) {
        // If no media and no quote, check for external links to embed
        // We prioritize the LAST link found as it's often the main content
        const potentialLinks = urls
            .map(u => u.expanded_url)
            .filter(u => u && !u.includes('twitter.com') && !u.includes('x.com')) as string[];
        
        if (potentialLinks.length > 0) {
            const linkToEmbed = potentialLinks[potentialLinks.length - 1];
            if (linkToEmbed) {
                console.log(`[${twitterUsername}] 🃏 Fetching link card for: ${linkToEmbed}`);
                linkCard = await fetchEmbedUrlCard(agent, linkToEmbed);
            }
        }
    }

    // Only append link for external quotes IF we couldn't natively embed it OR screenshot it
    const hasScreenshot = images.some(img => img.alt.startsWith('Quote Tweet:'));
    if (externalQuoteUrl && !quoteEmbed && !hasScreenshot && !text.includes(externalQuoteUrl)) {
      text += `\n\nQT: ${externalQuoteUrl}`;
    }

    // 4. Threading and Posting
    const chunks = splitText(text);
    console.log(`[${twitterUsername}] 📝 Splitting text into ${chunks.length} chunks.`);
    
    let lastPostInfo: ProcessedTweetEntry | null = replyParentInfo;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as string;
      console.log(`[${twitterUsername}] 📤 Posting chunk ${i + 1}/${chunks.length}...`);
      updateAppStatus({ message: `Posting chunk ${i + 1}/${chunks.length}...` });
      
      const rt = new RichText({ text: chunk });
      await rt.detectFacets(agent);
      const detectedLangs = detectLanguage(chunk);

      // biome-ignore lint/suspicious/noExplicitAny: dynamic record construction
      const postRecord: Record<string, any> = {
        text: rt.text,
        facets: rt.facets,
        langs: detectedLangs,
        createdAt: tweet.created_at ? new Date(tweet.created_at).toISOString() : new Date().toISOString(),
      };

      if (i === 0) {
        if (videoBlob) {
          const videoEmbed: any = {
            $type: 'app.bsky.embed.video',
            video: videoBlob,
          };
          if (videoAspectRatio) videoEmbed.aspectRatio = videoAspectRatio;
          postRecord.embed = videoEmbed;
        } else if (images.length > 0) {
          const imagesEmbed = { $type: 'app.bsky.embed.images', images };
          if (quoteEmbed) {
            postRecord.embed = { $type: 'app.bsky.embed.recordWithMedia', media: imagesEmbed, record: quoteEmbed };
          } else {
            postRecord.embed = imagesEmbed;
          }
        } else if (quoteEmbed) {
          postRecord.embed = quoteEmbed;
        } else if (linkCard) {
          postRecord.embed = linkCard;
        }
      }

      if (lastPostInfo?.uri && lastPostInfo?.cid) {
        postRecord.reply = {
          root: lastPostInfo.root || { uri: lastPostInfo.uri, cid: lastPostInfo.cid },
          parent: { uri: lastPostInfo.uri, cid: lastPostInfo.cid },
        };
      }

      try {
        // Retry logic for network/socket errors
        let response: any;
        let retries = 3;
        
        if (dryRun) {
             console.log(`[${twitterUsername}] 🧪 [DRY RUN] Would post chunk ${i + 1}/${chunks.length}`);
             if (postRecord.embed) console.log(`   - With embed: ${postRecord.embed.$type}`);
             if (postRecord.reply) console.log(`   - As reply to: ${postRecord.reply.parent.uri}`);
             response = { uri: 'at://did:plc:mock/app.bsky.feed.post/mock', cid: 'mock-cid' };
        } else {
            while (retries > 0) {
              try {
                response = await agent.post(postRecord);
                break;
              } catch (err: any) {
                retries--;
                if (retries === 0) throw err;
                console.warn(`[${twitterUsername}] ⚠️ Post failed (Socket/Network), retrying in 5s... (${retries} retries left)`);
                await new Promise(r => setTimeout(r, 5000));
              }
            }
        }
        
        const currentPostInfo = {
          uri: response.uri,
          cid: response.cid,
          root: postRecord.reply ? postRecord.reply.root : { uri: response.uri, cid: response.cid },
        };

        if (i === 0) {
          saveProcessedTweet(twitterUsername, bskyIdentifier, tweetId, currentPostInfo);
        }
        
        lastPostInfo = currentPostInfo;
        console.log(`[${twitterUsername}] ✅ Chunk ${i + 1} posted successfully.`);
        
        if (chunks.length > 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        console.error(`[${twitterUsername}] ❌ Failed to post ${tweetId} (chunk ${i + 1}):`, err);
        break;
      }
    }
    
    const wait = 10000;
    console.log(`[${twitterUsername}] 😴 Pacing: Waiting ${wait / 1000}s before next tweet.`);
    updateAppStatus({ state: 'pacing', message: `Pacing: Waiting ${wait / 1000}s...` });
    await new Promise((r) => setTimeout(r, wait));
  }
}

const activeAgents = new Map<string, BskyAgent>();

async function getAgent(mapping: {
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl?: string;
}): Promise<BskyAgent | null> {
  const serviceUrl = mapping.bskyServiceUrl || 'https://bsky.social';
  const cacheKey = `${mapping.bskyIdentifier}-${serviceUrl}`;
  const existing = activeAgents.get(cacheKey);
  if (existing) return existing;

  const agent = new BskyAgent({ service: serviceUrl });
  try {
    await agent.login({ identifier: mapping.bskyIdentifier, password: mapping.bskyPassword });
    activeAgents.set(cacheKey, agent);
    return agent;
  } catch (err) {
    console.error(`Failed to login to Bluesky for ${mapping.bskyIdentifier} on ${serviceUrl}:`, err);
    return null;
  }
}



async function importHistory(twitterUsername: string, bskyIdentifier: string, limit = 15, dryRun = false, ignoreCancellation = false): Promise<void> {
  const config = getConfig();
  const mapping = config.mappings.find((m) => m.twitterUsernames.map(u => u.toLowerCase()).includes(twitterUsername.toLowerCase()));
  if (!mapping) {
    console.error(`No mapping found for twitter username: ${twitterUsername}`);
    return;
  }

  let agent = await getAgent(mapping);
  if (!agent) {
      if (dryRun) {
          console.log("⚠️  Could not login to Bluesky, but proceeding with MOCK AGENT for Dry Run.");
          // biome-ignore lint/suspicious/noExplicitAny: mock agent
          agent = {
              post: async (record: any) => ({ uri: 'at://mock/post', cid: 'mock-cid' }),
              uploadBlob: async (data: any) => ({ data: { blob: { ref: { toString: () => 'mock-blob' } } } }),
              // Add other necessary methods if they are called outside of the already mocked dryRun blocks
              // But since we mocked the calls inside processTweets for dryRun, we just need the object to exist.
              session: { did: 'did:plc:mock' },
              com: { atproto: { repo: { describeRepo: async () => ({ data: {} }) } } }
          } as any;
      } else {
          return;
      }
  }

  console.log(`Starting full history import for ${twitterUsername} -> ${mapping.bskyIdentifier}...`);

  const allFoundTweets: Tweet[] = [];
  const seenIds = new Set<string>();
  const processedTweets = loadProcessedTweets(bskyIdentifier);

  console.log(`Fetching tweets for ${twitterUsername}...`);
  updateAppStatus({ message: `Fetching tweets...` });
  
  const client = await getTwitterScraper();
  if (client) {
      try {
          // Use getTweets which reliably fetches user timeline
          // limit defaults to 15 in function signature, but for history import we might want more.
          // However, the generator will fetch as much as we ask.
          const fetchLimit = limit || 100;
          const generator = client.getTweets(twitterUsername, fetchLimit);
          
          for await (const scraperTweet of generator) {
              if (!ignoreCancellation) {
                  const stillPending = getPendingBackfills().some(b => b.id === mapping.id);
                  if (!stillPending) {
                      console.log(`[${twitterUsername}] 🛑 Backfill cancelled.`);
                      break;
                  }
              }

              const t = mapScraperTweetToLocalTweet(scraperTweet);
              const tid = t.id_str || t.id;
              if (!tid) continue;
              
              if (!processedTweets[tid] && !seenIds.has(tid)) {
                  allFoundTweets.push(t);
                  seenIds.add(tid);
              }
              
              if (allFoundTweets.length >= fetchLimit) break;
          }
      } catch(e) {
          console.warn("Error during history fetch:", e);
      }
  }

  console.log(`Fetch complete. Found ${allFoundTweets.length} new tweets to import.`);
  if (allFoundTweets.length > 0) {
    await processTweets(agent as BskyAgent, twitterUsername, bskyIdentifier, allFoundTweets, dryRun);
    console.log('History import complete.');
  }
}

// Task management
const activeTasks = new Map<string, Promise<void>>();

async function runAccountTask(mapping: AccountMapping, forceBackfill = false, dryRun = false) {
    if (activeTasks.has(mapping.id)) return; // Already running

    const task = (async () => {
        try {
            const agent = await getAgent(mapping);
            if (!agent) return;

            const backfillReq = getPendingBackfills().find(b => b.id === mapping.id);
            
            if (forceBackfill || backfillReq) {
                const limit = backfillReq?.limit || 15;
                console.log(`[${mapping.bskyIdentifier}] Running backfill for ${mapping.twitterUsernames.length} accounts (limit ${limit})...`);
                
                for (const twitterUsername of mapping.twitterUsernames) {
                    try {
                        updateAppStatus({ state: 'backfilling', currentAccount: twitterUsername, message: `Starting backfill (limit ${limit})...` });
                        await importHistory(twitterUsername, mapping.bskyIdentifier, limit, dryRun);
                    } catch (err) {
                        console.error(`❌ Error backfilling ${twitterUsername}:`, err);
                    }
                }
                clearBackfill(mapping.id);
                console.log(`[${mapping.bskyIdentifier}] Backfill complete.`);
            } else {
                for (const twitterUsername of mapping.twitterUsernames) {
                    try {
                        updateAppStatus({ state: 'checking', currentAccount: twitterUsername, message: 'Fetching latest tweets...' });
                        
                        // Use fetchUserTweets instead of safeSearch
                        const tweets = await fetchUserTweets(twitterUsername, 30);
                        
                        if (!tweets || tweets.length === 0) continue;
                        await processTweets(agent, twitterUsername, mapping.bskyIdentifier, tweets, dryRun);
                    } catch (err) {
                        console.error(`❌ Error checking ${twitterUsername}:`, err);
                    }
                }
            }
        } catch (err) {
            console.error(`Error processing mapping ${mapping.bskyIdentifier}:`, err);
        } finally {
            activeTasks.delete(mapping.id);
        }
    })();

    activeTasks.set(mapping.id, task);
}

import {
  startServer,
  updateLastCheckTime,
  getPendingBackfills,
  clearBackfill,
  getNextCheckTime,
  updateAppStatus,
} from './server.js';
import { AccountMapping } from './config-manager.js';

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('tweets-2-bsky')
    // ... existing options ...
    .description('Crosspost tweets to Bluesky')
    .option('--dry-run', 'Fetch tweets but do not post to Bluesky', false)
    .option('--no-web', 'Disable the web interface')
    .option('--import-history', 'Run in history import mode')
    .option('--username <username>', 'Twitter username for history import')
    .option('--limit <number>', 'Limit the number of tweets to import', (val) => Number.parseInt(val, 10))
    .parse(process.argv);

  const options = program.opts();

  const config = getConfig();

  await migrateJsonToSqlite();

  if (!options.web) {
    console.log('🌐 Web interface is disabled.');
  } else {
    startServer();
    if (config.users.length === 0) {
      console.log('ℹ️  No users found. Please register on the web interface to get started.');
    }
  }

  if (options.importHistory) {
    // ... existing import history logic ...
    if (!options.username) {
      console.error('Please specify a username with --username <username>');
      process.exit(1);
    }
    const client = await getTwitterScraper();
    if (!client) {
      console.error('Twitter credentials not set. Cannot import history.');
      process.exit(1);
    }
    const mapping = config.mappings.find(m => m.twitterUsernames.map(u => u.toLowerCase()).includes(options.username.toLowerCase()));
    if (!mapping) {
      console.error(`No mapping found for ${options.username}`);
      process.exit(1);
    }
    await importHistory(options.username, mapping.bskyIdentifier, options.limit, options.dryRun, true);
    process.exit(0);
  }

  if (options.dryRun) {
    console.log('Dry run complete. Exiting.');
    process.exit(0);
  }

  console.log(`Scheduler started. Base interval: ${config.checkIntervalMinutes} minutes.`);
  updateLastCheckTime(); // Initialize next time

  // Main loop
  while (true) {
    const now = Date.now();
    const config = getConfig(); // Reload config to get new mappings/settings
    const nextTime = getNextCheckTime();
    
    // Check if it's time for a scheduled run OR if we have pending backfills
    const isScheduledRun = now >= nextTime;
    const pendingBackfills = getPendingBackfills();
    
    if (isScheduledRun) {
        console.log(`[${new Date().toISOString()}] ⏰ Scheduled check triggered.`);
        updateLastCheckTime();
    }

    for (const mapping of config.mappings) {
        if (!mapping.enabled) continue;
        
        const hasPendingBackfill = pendingBackfills.some(b => b.id === mapping.id);
        
        // Run if scheduled OR backfill requested
        if (isScheduledRun || hasPendingBackfill) {
            runAccountTask(mapping, hasPendingBackfill, options.dryRun);
        }
    }
    
    // Sleep for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

main();
