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
