import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

export interface TwitterConfig {
  authToken: string;
  ct0: string;
}

export interface WebUser {
  email: string;
  passwordHash: string;
}

export interface AccountMapping {
  id: string;
  twitterUsernames: string[];
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl?: string;
  enabled: boolean;
  owner?: string;
}

export interface AppConfig {
  twitter: TwitterConfig;
  mappings: AccountMapping[];
  users: WebUser[];
  checkIntervalMinutes: number;
}

export function getConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      twitter: { authToken: '', ct0: '' },
      mappings: [],
      users: [],
      checkIntervalMinutes: 5,
    };
  }
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!config.users) config.users = [];
    
    // Migration: twitterUsername (string) -> twitterUsernames (string[])
    // biome-ignore lint/suspicious/noExplicitAny: migration logic
    config.mappings = config.mappings.map((m: any) => {
      if (m.twitterUsername && !m.twitterUsernames) {
        return {
          ...m,
          twitterUsernames: [m.twitterUsername],
        };
      }
      return m;
    });

    return config;
  } catch (err) {
    console.error('Error reading config:', err);
    return {
      twitter: { authToken: '', ct0: '' },
      mappings: [],
      users: [],
      checkIntervalMinutes: 5,
    };
  }
}
export function saveConfig(config: AppConfig): void {
  // biome-ignore lint/suspicious/noExplicitAny: cleanup before save
  const configToSave = { ...config } as any;
  
  // Remove legacy field from saved file
  configToSave.mappings = configToSave.mappings.map((m: any) => {
    const { twitterUsername, ...rest } = m;
    return rest;
  });

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
}

export function addMapping(mapping: Omit<AccountMapping, 'id' | 'enabled'>): void {
  const config = getConfig();
  const newMapping: AccountMapping = {
    ...mapping,
    id: Math.random().toString(36).substring(7),
    enabled: true,
  };
  config.mappings.push(newMapping);
  saveConfig(config);
}

export function updateMapping(id: string, updates: Partial<Omit<AccountMapping, 'id'>>): void {
  const config = getConfig();
  const index = config.mappings.findIndex((m) => m.id === id);
  const existing = config.mappings[index];
  
  if (index !== -1 && existing) {
    config.mappings[index] = { ...existing, ...updates };
    saveConfig(config);
  }
}

export function removeMapping(id: string): void {
  const config = getConfig();
  config.mappings = config.mappings.filter((m) => m.id !== id);
  saveConfig(config);
}

export function updateTwitterConfig(twitter: TwitterConfig): void {
  const config = getConfig();
  config.twitter = twitter;
  saveConfig(config);
}
