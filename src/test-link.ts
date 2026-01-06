import 'dotenv/config';
import { TwitterClient } from '@steipete/bird/dist/lib/twitter-client.js';

// Provided credentials
const AUTH_TOKEN = '30f5905989c9984bef1ca849910db8c84ae31c04';
const CT0 = '012bae351eeebe4a19df0a21c73d5705d887246beee09c96da2a5a6935495688d3479b8e3fa963433a43b3b37675c16f4a192d018dd388108a6d6aa3ed3d9ba3233238bc71830583a1613ec042d3ba55';

async function main() {
  console.log('🧪 Starting Link Extraction Test...');

  const client = new TwitterClient({
    cookies: {
      authToken: AUTH_TOKEN,
      ct0: CT0,
    },
  });

  const username = 'NVIDIANetworkng';
  // Searching for the specific tweet ID: 2003547578848206861
  // Note: search usually doesn't find by ID directly unless we use specific operators or search from user
  // Let's try searching from user and look for the ID.
  
  console.log(`🔍 Fetching tweets for @${username}...`);

  try {
    const result = (await client.search(`from:${username}`, 20)) as any;
    
    if (!result.success || !result.tweets) {
      console.error('❌ Failed to fetch tweets:', result.error);
      return;
    }

    const targetId = '2003547578848206861';
    const targetTweet = result.tweets.find((t: any) => (t.id_str || t.id) === targetId);

    if (targetTweet) {
        console.log('✅ Found target tweet!');
        console.log('--- RAW TWEET OBJECT ---');
        console.log(JSON.stringify(targetTweet, null, 2));
        console.log('------------------------');
        
        console.log('--- Entities ---');
        console.log(JSON.stringify(targetTweet.entities, null, 2));
        
        if (targetTweet.card) {
             console.log('--- Card Data (Bird internal?) ---');
             console.log(JSON.stringify(targetTweet.card, null, 2));
        }
    } else {
        console.log(`❌ Target tweet ${targetId} not found in last 20 results.`);
        // Just print the first one to see structure anyway
        if (result.tweets.length > 0) {
            console.log('Printing first tweet for structure analysis:');
            console.log(JSON.stringify(result.tweets[0], null, 2));
        }
    }

  } catch (err) {
    console.error('❌ Error:', err);
  }
}

main();
