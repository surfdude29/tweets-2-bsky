import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new Database(path.join(DB_DIR, 'database.sqlite'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// --- Migration Support ---
const tableInfo = db.prepare('PRAGMA table_info(processed_tweets)').all() as any[];

if (tableInfo.length > 0) {
  let schemaChanged = false;
  const hasBskyIdentifier = tableInfo.some((col) => col.name === 'bsky_identifier');
  const hasTweetText = tableInfo.some((col) => col.name === 'tweet_text');
  const hasTailUri = tableInfo.some((col) => col.name === 'bsky_tail_uri');

  if (!hasBskyIdentifier || !hasTweetText || !hasTailUri) {
    console.log('🔄 Upgrading database schema...');
    
    // SQLite doesn't support easy PK changes, so we recreate the table if identifier is missing
    // Or if we just need to add a column, we can do ALTER TABLE if it's not the PK.
    // However, since we might need to do both or one, let's just do the full migration pattern
    // to be safe and consistent.
    
    db.transaction(() => {
      // 1. Rename existing table
      db.exec(`ALTER TABLE processed_tweets RENAME TO processed_tweets_old;`);

      // 2. Create new table with all columns
      db.exec(`
        CREATE TABLE processed_tweets (
          twitter_id TEXT NOT NULL,
          twitter_username TEXT NOT NULL,
          bsky_identifier TEXT NOT NULL,
          tweet_text TEXT,
          bsky_uri TEXT,
          bsky_cid TEXT,
          bsky_root_uri TEXT,
          bsky_root_cid TEXT,
          bsky_tail_uri TEXT,
          bsky_tail_cid TEXT,
          status TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (twitter_id, bsky_identifier)
        );
      `);

      // 3. Migrate data
      // Handle the case where the old table might not have had bsky_identifier
      const oldColumns = tableInfo.map((c) => c.name);
      
      // Construct the SELECT part based on available old columns
      // If old table didn't have bsky_identifier, we default to 'unknown'
      const identifierSelect = oldColumns.includes('bsky_identifier') ? 'bsky_identifier' : "'unknown'";
      
      // If old table didn't have tweet_text, we default to NULL
      const textSelect = oldColumns.includes('tweet_text') ? 'tweet_text' : "NULL";

      const tailUriSelect = oldColumns.includes('bsky_tail_uri') ? 'bsky_tail_uri' : "NULL";
      const tailCidSelect = oldColumns.includes('bsky_tail_cid') ? 'bsky_tail_cid' : "NULL";

      db.exec(`
        INSERT INTO processed_tweets (
          twitter_id, 
          twitter_username, 
          bsky_identifier, 
          tweet_text,
          bsky_uri, 
          bsky_cid, 
          bsky_root_uri, 
          bsky_root_cid,
          bsky_tail_uri,
          bsky_tail_cid, 
          status, 
          created_at
        )
        SELECT 
          twitter_id, 
          twitter_username, 
          ${identifierSelect}, 
          ${textSelect},
          bsky_uri, 
          bsky_cid, 
          bsky_root_uri, 
          bsky_root_cid,
          ${tailUriSelect},
          ${tailCidSelect}, 
          status, 
          created_at
        FROM processed_tweets_old;
      `);

      // 4. Drop old table
      db.exec(`DROP TABLE processed_tweets_old;`);
    })();
    console.log('✅ Database upgraded successfully.');
  }
} else {
  // Initialize fresh schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_tweets (
      twitter_id TEXT NOT NULL,
      twitter_username TEXT NOT NULL,
      bsky_identifier TEXT NOT NULL,
      tweet_text TEXT,
      bsky_uri TEXT,
      bsky_cid TEXT,
      bsky_root_uri TEXT,
      bsky_root_cid TEXT,
      bsky_tail_uri TEXT,
      bsky_tail_cid TEXT,
      status TEXT NOT NULL, -- 'migrated', 'skipped', 'failed'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (twitter_id, bsky_identifier)
    );
  `);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_twitter_username ON processed_tweets(twitter_username);
  CREATE INDEX IF NOT EXISTS idx_bsky_identifier ON processed_tweets(bsky_identifier);
`);

export interface ProcessedTweet {
  twitter_id: string;
  twitter_username: string;
  bsky_identifier: string;
  tweet_text?: string;
  bsky_uri?: string;
  bsky_cid?: string;
  bsky_root_uri?: string;
  bsky_root_cid?: string;
  bsky_tail_uri?: string;
  bsky_tail_cid?: string;
  status: 'migrated' | 'skipped' | 'failed';
  created_at?: string;
}

export interface ProcessedTweetSearchResult extends ProcessedTweet {
  score: number;
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@#._\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchValue(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.split(' ').filter((token) => token.length > 0);
}

function orderedSubsequenceScore(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0;
  }

  let matched = 0;
  let searchIndex = 0;
  for (const char of query) {
    const foundIndex = candidate.indexOf(char, searchIndex);
    if (foundIndex === -1) {
      continue;
    }
    matched += 1;
    searchIndex = foundIndex + 1;
  }

  return matched / query.length;
}

function buildBigrams(value: string): Set<string> {
  const result = new Set<string>();
  if (value.length < 2) {
    if (value.length === 1) {
      result.add(value);
    }
    return result;
  }

  for (let i = 0; i < value.length - 1; i += 1) {
    result.add(value.slice(i, i + 2));
  }

  return result;
}

function diceCoefficient(a: string, b: string): number {
  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
}

function scoreCandidateField(query: string, tokens: string[], candidateValue?: string): number {
  const candidate = normalizeSearchValue(candidateValue || '');
  if (!query || !candidate) {
    return 0;
  }

  let score = 0;
  if (candidate === query) {
    score += 170;
  } else if (candidate.startsWith(query)) {
    score += 140;
  } else if (candidate.includes(query)) {
    score += 112;
  }

  let matchedTokens = 0;
  for (const token of tokens) {
    if (candidate.includes(token)) {
      matchedTokens += 1;
      score += token.length >= 4 ? 18 : 12;
    }
  }

  if (tokens.length > 0) {
    score += (matchedTokens / tokens.length) * 48;
  }

  score += orderedSubsequenceScore(query, candidate) * 46;
  score += diceCoefficient(query, candidate) * 55;

  return score;
}

function scoreProcessedTweet(tweet: ProcessedTweet, query: string, tokens: string[]): number {
  const usernameScore = scoreCandidateField(query, tokens, tweet.twitter_username) * 1.25;
  const identifierScore = scoreCandidateField(query, tokens, tweet.bsky_identifier) * 1.18;
  const textScore = scoreCandidateField(query, tokens, tweet.tweet_text) * 0.98;
  const idScore = scoreCandidateField(query, tokens, tweet.twitter_id) * 0.72;

  const maxScore = Math.max(usernameScore, identifierScore, textScore, idScore);
  const blendedScore = maxScore + (usernameScore + identifierScore + textScore + idScore - maxScore) * 0.22;

  const recencyBoost = (() => {
    if (!tweet.created_at) return 0;
    const timestamp = Date.parse(tweet.created_at);
    if (!Number.isFinite(timestamp)) return 0;
    const ageDays = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
    return Math.max(0, 7 - ageDays);
  })();

  return blendedScore + recencyBoost;
}

export const dbService = {
  getTweet(twitterId: string, bskyIdentifier: string): ProcessedTweet | null {
    const stmt = db.prepare('SELECT * FROM processed_tweets WHERE twitter_id = ? AND bsky_identifier = ?');
    const row = stmt.get(twitterId, bskyIdentifier) as any;
    if (!row) return null;
    return {
      twitter_id: row.twitter_id,
      twitter_username: row.twitter_username,
      bsky_identifier: row.bsky_identifier,
      tweet_text: row.tweet_text,
      bsky_uri: row.bsky_uri,
      bsky_cid: row.bsky_cid,
      bsky_root_uri: row.bsky_root_uri,
      bsky_root_cid: row.bsky_root_cid,
      bsky_tail_uri: row.bsky_tail_uri,
      bsky_tail_cid: row.bsky_tail_cid,
      status: row.status,
      created_at: row.created_at
    };
  },

  saveTweet(tweet: ProcessedTweet) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO processed_tweets 
      (twitter_id, twitter_username, bsky_identifier, tweet_text, bsky_uri, bsky_cid, bsky_root_uri, bsky_root_cid, bsky_tail_uri, bsky_tail_cid, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      tweet.twitter_id,
      tweet.twitter_username,
      tweet.bsky_identifier,
      tweet.tweet_text || null,
      tweet.bsky_uri || null,
      tweet.bsky_cid || null,
      tweet.bsky_root_uri || null,
      tweet.bsky_root_cid || null,
      tweet.bsky_tail_uri || null,
      tweet.bsky_tail_cid || null,
      tweet.status,
    );
  },

  getTweetsByBskyIdentifier(bskyIdentifier: string): Record<string, any> {
    const stmt = db.prepare('SELECT * FROM processed_tweets WHERE bsky_identifier = ?');
    const rows = stmt.all(bskyIdentifier.toLowerCase()) as any[];
    const map: Record<string, any> = {};
    for (const row of rows) {
      map[row.twitter_id] = {
        uri: row.bsky_uri,
        cid: row.bsky_cid,
        root: row.bsky_root_uri ? { uri: row.bsky_root_uri, cid: row.bsky_root_cid } : undefined,
        tail: (row.bsky_tail_uri && row.bsky_tail_cid) ? { uri: row.bsky_tail_uri, cid: row.bsky_tail_cid } : undefined,
        migrated: row.status === 'migrated',
        skipped: row.status === 'skipped',
      };
    }
    return map;
  },

  getTweetsByUsername(username: string): Record<string, any> {
    const stmt = db.prepare('SELECT * FROM processed_tweets WHERE twitter_username = ?');
    const rows = stmt.all(username.toLowerCase()) as any[];
    const map: Record<string, any> = {};
    for (const row of rows) {
      map[row.twitter_id] = {
        uri: row.bsky_uri,
        cid: row.bsky_cid,
        root: row.bsky_root_uri ? { uri: row.bsky_root_uri, cid: row.bsky_root_cid } : undefined,
        tail: (row.bsky_tail_uri && row.bsky_tail_cid) ? { uri: row.bsky_tail_uri, cid: row.bsky_tail_cid } : undefined,
        migrated: row.status === 'migrated',
        skipped: row.status === 'skipped'
      };
    }
    return map;
  },

  getRecentProcessedTweets(limit = 50): ProcessedTweet[] {
    const stmt = db.prepare('SELECT * FROM processed_tweets ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?');
    return stmt.all(limit) as ProcessedTweet[];
  },

  searchMigratedTweets(query: string, limit = 60, scanLimit = 3000): ProcessedTweetSearchResult[] {
    const normalizedQuery = normalizeSearchValue(query || '');
    if (!normalizedQuery) {
      return [];
    }

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 60;
    const safeScanLimit = Number.isFinite(scanLimit) ? Math.max(safeLimit, Math.min(scanLimit, 8000)) : 3000;
    const tokens = tokenizeSearchValue(normalizedQuery);

    const stmt = db.prepare(
      'SELECT * FROM processed_tweets WHERE status = "migrated" ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?',
    );
    const rows = stmt.all(safeScanLimit) as ProcessedTweet[];

    return rows
      .map((row) => ({
        ...row,
        score: scoreProcessedTweet(row, normalizedQuery, tokens),
      }))
      .filter((row) => row.score >= 22)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const aTime = a.created_at ? Date.parse(a.created_at) : 0;
        const bTime = b.created_at ? Date.parse(b.created_at) : 0;
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      })
      .slice(0, safeLimit);
  },

  deleteTweetsByUsername(username: string) {
    const stmt = db.prepare('DELETE FROM processed_tweets WHERE twitter_username = ?');
    stmt.run(username.toLowerCase());
  },

  deleteTweetsByBskyIdentifier(bskyIdentifier: string) {
    const stmt = db.prepare('DELETE FROM processed_tweets WHERE bsky_identifier = ?');
    stmt.run(bskyIdentifier.toLowerCase());
  },

  repairUnknownIdentifiers(twitterUsername: string, bskyIdentifier: string) {
    const stmt = db.prepare(
      'UPDATE processed_tweets SET bsky_identifier = ? WHERE bsky_identifier = "unknown" AND twitter_username = ?',
    );
    stmt.run(bskyIdentifier.toLowerCase(), twitterUsername.toLowerCase());
  },

  clearAll() {
    db.prepare('DELETE FROM processed_tweets').run();
  },
};
