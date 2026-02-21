import { Scraper } from '@the-convocation/twitter-scraper';
import { getConfig } from '../src/config-manager.js';

interface CookieSet {
  label: string;
  authToken: string;
  ct0: string;
}

const normalizeHandle = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

const handles = process.argv
  .slice(2)
  .map(normalizeHandle)
  .filter((value) => value.length > 0);

if (handles.length === 0) {
  console.error('Usage: npm run test:twitter-metadata -- <twitter-handle> [<twitter-handle> ...]');
  process.exit(1);
}

const config = getConfig();
const cookieSets: CookieSet[] = [];

if (config.twitter.authToken && config.twitter.ct0) {
  cookieSets.push({
    label: 'primary',
    authToken: config.twitter.authToken,
    ct0: config.twitter.ct0,
  });
}

if (config.twitter.backupAuthToken && config.twitter.backupCt0) {
  cookieSets.push({
    label: 'backup',
    authToken: config.twitter.backupAuthToken,
    ct0: config.twitter.backupCt0,
  });
}

if (cookieSets.length === 0) {
  console.error('No Twitter cookies configured. Run setup-twitter first.');
  process.exit(1);
}

const run = async () => {
  const errors: string[] = [];

  for (const handle of handles) {
    let resolved = false;
    for (const cookieSet of cookieSets) {
      const scraper = new Scraper();
      try {
        await scraper.setCookies([`auth_token=${cookieSet.authToken}`, `ct0=${cookieSet.ct0}`]);
        const profile = await scraper.getProfile(handle);
        const avatar = profile.avatar || '';
        const banner = profile.banner || '';
        const name = profile.name || '';
        const biography = profile.biography || '';

        console.log(`\n[${handle}] via ${cookieSet.label} cookies`);
        console.log(`  username: ${profile.username || handle}`);
        console.log(`  name: ${name || '(none)'}`);
        console.log(`  biography: ${biography ? JSON.stringify(biography) : '(none)'}`);
        console.log(`  avatar: ${avatar || '(none)'}`);
        console.log(`  banner: ${banner || '(none)'}`);
        resolved = true;
        break;
      } catch (error) {
        errors.push(`[${handle}] ${cookieSet.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!resolved) {
      console.error(`\n[${handle}] Failed to fetch profile with all configured cookie sets.`);
    }
  }

  if (errors.length > 0) {
    console.log('\nDetailed errors:');
    for (const error of errors) {
      console.log(`  - ${error}`);
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
