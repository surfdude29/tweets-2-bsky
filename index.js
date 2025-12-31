require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const { TwitterClient } = require('@steipete/bird/dist/lib/twitter-client');
const franc = require('franc-min');
const iso6391 = require('iso-639-1');
const { exec } = require('child_process');

// Configuration
const TWITTER_AUTH_TOKEN = process.env.TWITTER_AUTH_TOKEN;
const TWITTER_CT0 = process.env.TWITTER_CT0;
const TWITTER_TARGET_USERNAME = process.env.TWITTER_TARGET_USERNAME; // Optional target
const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER;
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD;
const BLUESKY_SERVICE_URL = process.env.BLUESKY_SERVICE_URL || 'https://bsky.social';
const CHECK_INTERVAL_MINUTES = process.env.CHECK_INTERVAL_MINUTES || 5;
const PROCESSED_TWEETS_FILE = path.join(__dirname, 'processed_tweets.json');

// State Management
// Format: { "twitter_id": { uri: "bsky_uri", cid: "bsky_cid", root: { uri, cid } } }
let processedTweets = {};

function loadProcessedTweets() {
    try {
        if (fs.existsSync(PROCESSED_TWEETS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(PROCESSED_TWEETS_FILE, 'utf8'));
            if (Array.isArray(raw)) {
                // Migration from v1 (Array of IDs) to v2 (Object map)
                console.log("Migrating processed_tweets.json from v1 to v2...");
                processedTweets = raw.reduce((acc, id) => {
                    acc[id] = { migrated: true }; // Marker for old tweets (can't reply to them easily)
                    return acc;
                }, {});
                saveProcessedTweets();
            } else {
                processedTweets = raw;
            }
        }
    } catch (err) {
        console.error('Error loading processed tweets:', err);
    }
}

function saveProcessedTweets() {
    try {
        fs.writeFileSync(PROCESSED_TWEETS_FILE, JSON.stringify(processedTweets, null, 2));
    } catch (err) {
        console.error('Error saving processed tweets:', err);
    }
}

loadProcessedTweets();

// Bluesky Agent
const agent = new BskyAgent({
    service: BLUESKY_SERVICE_URL,
});

// Custom Twitter Client
class CustomTwitterClient extends TwitterClient {
    mapTweetResult(result) {
        const mapped = super.mapTweetResult(result);
        if (mapped && result.legacy) {
            mapped.entities = result.legacy.entities;
            mapped.extended_entities = result.legacy.extended_entities;
            mapped.quoted_status_id_str = result.legacy.quoted_status_id_str;
            mapped.is_quote_status = result.legacy.is_quote_status;
            mapped.in_reply_to_status_id_str = result.legacy.in_reply_to_status_id_str;
            mapped.in_reply_to_user_id_str = result.legacy.in_reply_to_user_id_str;
        }
        return mapped;
    }
}

const twitter = new CustomTwitterClient({
    cookies: {
        authToken: TWITTER_AUTH_TOKEN,
        ct0: TWITTER_CT0
    }
});

// --- Helper Functions ---

function detectLanguage(text) {
    if (!text || text.trim().length === 0) return ['en'];
    try {
        const code3 = franc(text);
        if (code3 === 'und') return ['en']; // Undetermined
        const code2 = iso6391.getCode(code3);
        return code2 ? [code2] : ['en'];
    } catch (e) {
        return ['en'];
    }
}

async function expandUrl(shortUrl) {
    try {
        const response = await axios.head(shortUrl, {
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (err) {
        try {
            const response = await axios.get(shortUrl, {
                responseType: 'stream',
                maxRedirects: 10
            });
            response.data.destroy(); 
            return response.request.res.responseUrl || shortUrl;
        } catch (e) {
            // console.warn(`Failed to expand URL ${shortUrl}:`, e.message);
            return shortUrl;
        }
    }
}

async function downloadMedia(url) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer'
    });
    return {
        buffer: Buffer.from(response.data),
        mimeType: response.headers['content-type']
    };
}

async function uploadToBluesky(buffer, mimeType) {
    const { data } = await agent.uploadBlob(buffer, { encoding: mimeType });
    return data.blob;
}

async function getUsername() {
    if (TWITTER_TARGET_USERNAME) return TWITTER_TARGET_USERNAME;
    try {
        const res = await twitter.getCurrentUser();
        if (res.success && res.user) {
            return res.user.username;
        }
    } catch (e) {
        console.warn("Failed to get 'whoami'. defaulting to 'me'.", e.message);
    }
    return "me";
}

function getRandomDelay(min = 1000, max = 4000) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function refreshQueryIds() {
    return new Promise((resolve) => {
        console.log("⚠️  Attempting to refresh Twitter Query IDs via 'bird' CLI...");
        exec('./node_modules/.bin/bird query-ids --fresh', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error refreshing IDs: ${error.message}`);
                console.error(`Stderr: ${stderr}`);
            } else {
                console.log("✅ Query IDs refreshed successfully.");
            }
            resolve();
        });
    });
}

/**
 * Wraps twitter.search with auto-recovery for stale Query IDs
 */
async function safeSearch(query, limit) {
    try {
        const result = await twitter.search(query, limit);
        // Sometimes it returns success: false but no throw
        if (!result.success && result.error && 
            (result.error.toString().includes('GraphQL') || result.error.toString().includes('404'))) {
            throw new Error(result.error);
        }
        return result;
    } catch (err) {
        console.warn(`Search encountered an error: ${err.message || err}`);
        if (err.message && (err.message.includes('GraphQL') || err.message.includes('404') || err.message.includes('Bad Guest Token'))) {
            await refreshQueryIds();
            console.log("Retrying search...");
            return await twitter.search(query, limit);
        }
        return { success: false, error: err };
    }
}

// --- Main Processing Logic ---

async function processTweets(tweets) {
    // Ensure chronological order
    tweets.reverse();

    for (const tweet of tweets) {
        const tweetId = tweet.id_str || tweet.id;
        if (processedTweets[tweetId]) {
            continue;
        }

        // --- Filter Replies (unless we are maintaining a thread) ---
        // If it's a reply, but the parent IS in our DB, we want to post it as a reply.
        // If it's a reply to someone else (or a thread we missed), we skip it based on user preference (only original tweets).
        
        const replyStatusId = tweet.in_reply_to_status_id_str || tweet.in_reply_to_status_id;
        const replyUserId = tweet.in_reply_to_user_id_str || tweet.in_reply_to_user_id;
        const isReply = !!replyStatusId || !!replyUserId || (tweet.full_text || tweet.text || "").trim().startsWith('@');
        
        let replyParentInfo = null;

        if (isReply) {
             if (replyStatusId && processedTweets[replyStatusId] && !processedTweets[replyStatusId].migrated) {
                 // We have the parent! We can thread this.
                 console.log(`Threading reply to ${replyStatusId}`);
                 replyParentInfo = processedTweets[replyStatusId];
             } else {
                 // Reply to unknown or external -> Skip
                 console.log(`Skipping reply: ${tweetId}`);
                 processedTweets[tweetId] = { skipped: true }; // Mark as skipped
                 saveProcessedTweets();
                 continue;
             }
        }

        console.log(`Processing tweet: ${tweetId}`);

        let text = tweet.full_text || tweet.text || "";
        
        // --- 1. Link Expansion ---
        const urls = tweet.entities?.urls || [];
        for (const urlEntity of urls) {
            const tco = urlEntity.url;
            const expanded = urlEntity.expanded_url;
            if (tco && expanded) {
                text = text.replace(tco, expanded);
            }
        }

        // Manual cleanup of remaining t.co
        const tcoRegex = /https:\/\/t\.co\/[a-zA-Z0-9]+/g;
        const matches = text.match(tcoRegex) || [];
        for (const tco of matches) {
            const resolved = await expandUrl(tco);
            if (resolved !== tco) {
                text = text.replace(tco, resolved);
            }
        }

        // --- 2. Media Handling ---
        let images = [];
        let videoBlob = null;
        let videoAspectRatio = null;
        
        const mediaEntities = tweet.extended_entities?.media || tweet.entities?.media || [];
        let mediaLinksToRemove = [];

        for (const media of mediaEntities) {
            if (media.url) {
                mediaLinksToRemove.push(media.url);
                if (media.expanded_url) mediaLinksToRemove.push(media.expanded_url);
            }

            // Aspect Ratio Extraction
            let aspectRatio = undefined;
            if (media.sizes?.large) {
                aspectRatio = { width: media.sizes.large.w, height: media.sizes.large.h };
            } else if (media.original_info) {
                 aspectRatio = { width: media.original_info.width, height: media.original_info.height };
            }

            if (media.type === 'photo') {
                const url = media.media_url_https;
                try {
                    const { buffer, mimeType } = await downloadMedia(url);
                    const blob = await uploadToBluesky(buffer, mimeType);
                    images.push({
                        alt: media.ext_alt_text || "Image from Twitter",
                        image: blob,
                        aspectRatio: aspectRatio 
                    });
                } catch (err) {
                    console.error(`Failed to upload image ${url}:`, err.message);
                }
            } else if (media.type === 'video' || media.type === 'animated_gif') {
                const variants = media.video_info?.variants || [];
                const mp4s = variants.filter(v => v.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                
                if (mp4s.length > 0) {
                    const videoUrl = mp4s[0].url;
                    try {
                        const { buffer, mimeType } = await downloadMedia(videoUrl);
                        
                        if (buffer.length > 95 * 1024 * 1024) { 
                            console.warn("Video too large (>95MB). Linking instead.");
                            text += `\n[Video: ${media.media_url_https}]`;
                            continue;
                        }

                        const blob = await uploadToBluesky(buffer, mimeType);
                        videoBlob = blob;
                        videoAspectRatio = aspectRatio;
                        break; 
                    } catch (err) {
                        console.error(`Failed to upload video ${videoUrl}:`, err.message);
                        text += `\n${media.media_url_https}`;
                    }
                }
            }
        }

        // Remove media links from text
        for (const link of mediaLinksToRemove) {
            text = text.split(link).join('').trim();
        }
        text = text.replace(/\n\s*\n/g, '\n\n').trim();

        // --- 3. Quoting Logic ---
        let quoteEmbed = null;
        if (tweet.is_quote_status && tweet.quoted_status_id_str) {
            const quoteId = tweet.quoted_status_id_str;
            if (processedTweets[quoteId] && !processedTweets[quoteId].migrated) {
                const ref = processedTweets[quoteId];
                quoteEmbed = {
                    $type: 'app.bsky.embed.record',
                    record: {
                        uri: ref.uri,
                        cid: ref.cid
                    }
                };
            }
        }

        // --- 4. Construct Post ---
        const rt = new RichText({ text });
        await rt.detectFacets(agent);
        const detectedLangs = detectLanguage(text);

        const postRecord = {
            text: rt.text,
            facets: rt.facets,
            langs: detectedLangs,
            createdAt: tweet.created_at ? new Date(tweet.created_at).toISOString() : new Date().toISOString()
        };

        // Attach Embeds
        if (videoBlob) {
            postRecord.embed = {
                $type: 'app.bsky.embed.video',
                video: videoBlob,
                aspectRatio: videoAspectRatio
            };
        } else if (images.length > 0) {
            const imagesEmbed = {
                $type: 'app.bsky.embed.images',
                images: images
            };

            if (quoteEmbed) {
                postRecord.embed = {
                    $type: 'app.bsky.embed.recordWithMedia',
                    media: imagesEmbed,
                    record: quoteEmbed
                };
            } else {
                postRecord.embed = imagesEmbed;
            }
        } else if (quoteEmbed) {
            postRecord.embed = quoteEmbed;
        }

        // Attach Reply info
        if (replyParentInfo) {
            postRecord.reply = {
                root: replyParentInfo.root || { uri: replyParentInfo.uri, cid: replyParentInfo.cid },
                parent: { uri: replyParentInfo.uri, cid: replyParentInfo.cid }
            };
        }

        // --- 5. Post & Save ---
        try {
            const response = await agent.post(postRecord);
            // console.log(`Posted: ${tweetId}`);
            
            const newEntry = {
                uri: response.uri,
                cid: response.cid,
                root: postRecord.reply ? postRecord.reply.root : { uri: response.uri, cid: response.cid }
            };
            
            processedTweets[tweetId] = newEntry;
            saveProcessedTweets();

            // Random Pacing (1s - 4s)
            const sleepTime = getRandomDelay(1000, 4000);
            // console.log(`Sleeping ${sleepTime}ms...`);
            await new Promise(r => setTimeout(r, sleepTime));

        } catch (err) {
            console.error(`Failed to post ${tweetId}:`, err);
        }
    }
}

async function checkAndPost() {
    console.log(`[${new Date().toISOString()}] Checking...`);

    try {
        const username = await getUsername();
        
        // Use safeSearch with auto-refresh for IDs
        const query = `from:${username}`;
        const result = await safeSearch(query, 30);
        
        if (!result.success) {
            console.error("Failed to fetch tweets:", result.error);
            return;
        }

        const tweets = result.tweets || [];
        if (tweets.length === 0) return;

        await processTweets(tweets);

    } catch (err) {
        console.error("Error in checkAndPost:", err);
    }
}

async function importHistory() {
    console.log("Starting full history import...");
    const username = await getUsername();
    console.log(`Importing history for: ${username}`);

    let maxId = null;
    let keepGoing = true;
    const count = 100;
    let allFoundTweets = [];
    const seenIds = new Set();

    while (keepGoing) {
        let query = `from:${username}`;
        if (maxId) {
            query += ` max_id:${maxId}`;
        }
        
        console.log(`Fetching batch... (Collected: ${allFoundTweets.length})`);
        
        const result = await safeSearch(query, count);
        
        if (!result.success) {
            console.error("Fetch failed:", result.error);
            break;
        }

        const tweets = result.tweets || [];
        if (tweets.length === 0) break;

        let newOnes = 0;
        for (const t of tweets) {
            const tid = t.id_str || t.id;
            if (!processedTweets[tid] && !seenIds.has(tid)) {
                allFoundTweets.push(t);
                seenIds.add(tid);
                newOnes++;
            }
        }

        if (newOnes === 0 && tweets.length > 0) {
            const lastId = tweets[tweets.length - 1].id_str || tweets[tweets.length - 1].id;
            if (lastId === maxId) break;
        }

        const lastTweet = tweets[tweets.length - 1];
        maxId = lastTweet.id_str || lastTweet.id;
        
        // Rate limit protection
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`Fetch complete. Found ${allFoundTweets.length} new tweets to import.`);
    
    if (allFoundTweets.length > 0) {
        console.log("Starting processing (Oldest -> Newest) with random pacing...");
        await processTweets(allFoundTweets); 
        console.log("History import complete.");
    } else {
        console.log("Nothing new to import.");
    }
}

// Start
(async () => {
    if (!TWITTER_AUTH_TOKEN || !TWITTER_CT0 || !BLUESKY_IDENTIFIER || !BLUESKY_PASSWORD) {
        console.error("Missing credentials in .env file.");
        process.exit(1);
    }

    try {
        await agent.login({ identifier: BLUESKY_IDENTIFIER, password: BLUESKY_PASSWORD });
        console.log("Logged in to Bluesky.");
    } catch (err) {
        console.error("Failed to login to Bluesky:", err);
        process.exit(1);
    }

    if (process.argv.includes('--import-history')) {
        await importHistory();
        process.exit(0);
    }

    // Refresh IDs on startup just to be safe/fresh
    // await refreshQueryIds(); 

    await checkAndPost();

    console.log(`Scheduling check every ${CHECK_INTERVAL_MINUTES} minutes.`);
    cron.schedule(`*/${CHECK_INTERVAL_MINUTES} * * * *`, checkAndPost);
})();