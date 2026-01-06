import { Command } from 'commander';
import inquirer from 'inquirer';
import { addMapping, getConfig, removeMapping, saveConfig, updateTwitterConfig } from './config-manager.js';

const program = new Command();

program
  .name('tweets-2-bsky-cli')
  .description('CLI to manage Twitter to Bluesky crossposting mappings')
  .version('1.0.0');

program
  .command('setup-twitter')
  .description('Setup Twitter auth cookies')
  .action(async () => {
    const config = getConfig();
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'authToken',
        message: 'Enter Twitter auth_token:',
        default: config.twitter.authToken,
      },
      {
        type: 'input',
        name: 'ct0',
        message: 'Enter Twitter ct0:',
        default: config.twitter.ct0,
      },
    ]);
    updateTwitterConfig(answers);
    console.log('Twitter config updated!');
  });

program
  .command('add-mapping')
  .description('Add a new Twitter to Bluesky mapping')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'twitterUsernames',
        message: 'Twitter username(s) to watch (comma separated, without @):',
      },
      {
        type: 'input',
        name: 'bskyIdentifier',
        message: 'Bluesky identifier (handle or email):',
      },
      {
        type: 'password',
        name: 'bskyPassword',
        message: 'Bluesky app password:',
      },
      {
        type: 'input',
        name: 'bskyServiceUrl',
        message: 'Bluesky service URL:',
        default: 'https://bsky.social',
      },
    ]);
    
    const usernames = answers.twitterUsernames.split(',').map((u: string) => u.trim()).filter((u: string) => u.length > 0);
    
    addMapping({
      ...answers,
      twitterUsernames: usernames,
    });
    console.log('Mapping added successfully!');
  });

program
  .command('edit-mapping')
  .description('Edit an existing mapping')
  .action(async () => {
    const config = getConfig();
    if (config.mappings.length === 0) {
      console.log('No mappings found.');
      return;
    }
    
    const { id } = await inquirer.prompt([
      {
        type: 'list',
        name: 'id',
        message: 'Select a mapping to edit:',
        choices: config.mappings.map((m) => ({
          name: `${m.twitterUsernames.join(', ')} -> ${m.bskyIdentifier}`,
          value: m.id,
        })),
      },
    ]);

    const mapping = config.mappings.find((m) => m.id === id);
    if (!mapping) return;

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'twitterUsernames',
        message: 'Twitter username(s) (comma separated):',
        default: mapping.twitterUsernames.join(', '),
      },
      {
        type: 'input',
        name: 'bskyIdentifier',
        message: 'Bluesky identifier:',
        default: mapping.bskyIdentifier,
      },
      {
        type: 'password',
        name: 'bskyPassword',
        message: 'Bluesky app password (leave empty to keep current):',
      },
      {
        type: 'input',
        name: 'bskyServiceUrl',
        message: 'Bluesky service URL:',
        default: mapping.bskyServiceUrl || 'https://bsky.social',
      },
    ]);

    const usernames = answers.twitterUsernames.split(',').map((u: string) => u.trim()).filter((u: string) => u.length > 0);

    // Update the mapping directly
    const index = config.mappings.findIndex(m => m.id === id);
    const existingMapping = config.mappings[index];
    
    if (index !== -1 && existingMapping) {
       const updatedMapping = {
         ...existingMapping,
         twitterUsernames: usernames,
         bskyIdentifier: answers.bskyIdentifier,
         bskyServiceUrl: answers.bskyServiceUrl,
       };
       
       if (answers.bskyPassword && answers.bskyPassword.trim().length > 0) {
         updatedMapping.bskyPassword = answers.bskyPassword;
       }
       
       config.mappings[index] = updatedMapping;
       saveConfig(config);
       console.log('Mapping updated successfully!');
    }
  });

program
  .command('list')
  .description('List all mappings')
  .action(() => {
    const config = getConfig();
    if (config.mappings.length === 0) {
      console.log('No mappings found.');
      return;
    }
    console.table(
      config.mappings.map((m) => ({
        id: m.id,
        twitter: m.twitterUsernames.join(', '),
        bsky: m.bskyIdentifier,
        enabled: m.enabled,
      })),
    );
  });

program
  .command('remove')
  .description('Remove a mapping')
  .action(async () => {
    const config = getConfig();
    if (config.mappings.length === 0) {
      console.log('No mappings to remove.');
      return;
    }
    const { id } = await inquirer.prompt([
      {
        type: 'list',
        name: 'id',
        message: 'Select a mapping to remove:',
        choices: config.mappings.map((m) => ({
          name: `${m.twitterUsernames.join(', ')} -> ${m.bskyIdentifier}`,
          value: m.id,
        })),
      },
    ]);
    removeMapping(id);
    console.log('Mapping removed.');
  });

program
  .command('import-history')
  .description('Import history for a specific mapping')
  .action(async () => {
    const config = getConfig();
    if (config.mappings.length === 0) {
      console.log('No mappings found.');
      return;
    }
    const { id } = await inquirer.prompt([
      {
        type: 'list',
        name: 'id',
        message: 'Select a mapping to import history for:',
        choices: config.mappings.map((m) => ({
          name: `${m.twitterUsernames.join(', ')} -> ${m.bskyIdentifier}`,
          value: m.id,
        })),
      },
    ]);

    const mapping = config.mappings.find((m) => m.id === id);
    if (!mapping) return;

    console.log(`
To import history, run one of the following commands:`);
    for (const username of mapping.twitterUsernames) {
      console.log(`  npm run import -- --username ${username}`);
    }
    console.log(`
You can also use additional flags:`);
    console.log('  --limit <number>  Limit the number of tweets to import');
    console.log('  --dry-run         Fetch and show tweets without posting');
    console.log(`
Example:`);
    console.log(`  npm run import -- --username ${mapping.twitterUsernames[0]} --limit 10 --dry-run
`);
  });

program
  .command('set-interval')
  .description('Set check interval in minutes')
  .argument('<minutes>', 'Interval in minutes')
  .action((minutes) => {
    const config = getConfig();
    config.checkIntervalMinutes = Number.parseInt(minutes, 10);
    saveConfig(config);
    console.log(`Interval set to ${minutes} minutes.`);
  });

program.parse();
