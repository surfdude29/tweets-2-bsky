import { BskyAgent } from '@atproto/api';
import type { BlobRef } from '@atproto/api';
import { Scraper, type Profile as TwitterProfile } from '@the-convocation/twitter-scraper';
import axios from 'axios';
import sharp from 'sharp';
import { getConfig } from './config-manager.js';

const PROFILE_IMAGE_MAX_BYTES = 1_000_000;
const PROFILE_IMAGE_TARGET_BYTES = 950 * 1024;
const DEFAULT_BSKY_SERVICE_URL = 'https://bsky.social';
const BSKY_SETTINGS_URL = 'https://bsky.app/settings/account';
const MIRROR_SUFFIX = '{UNOFFICIAL}';

type ProfileImageKind = 'avatar' | 'banner';

interface TwitterCookieSet {
  label: string;
  authToken: string;
  ct0: string;
}

interface ProcessedProfileImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface TwitterMirrorProfile {
  username: string;
  profileUrl: string;
  name?: string;
  biography?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  mirroredDisplayName: string;
  mirroredDescription: string;
}

export interface BlueskyCredentialValidation {
  did: string;
  handle: string;
  email?: string;
  emailConfirmed: boolean;
  serviceUrl: string;
  settingsUrl: string;
}

export interface MirrorProfileSyncResult {
  twitterProfile: TwitterMirrorProfile;
  bsky: BlueskyCredentialValidation;
  avatarSynced: boolean;
  bannerSynced: boolean;
  warnings: string[];
}

const normalizeTwitterUsername = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeBskyServiceUrl = (value?: string): string => {
  const raw = normalizeOptionalString(value) || DEFAULT_BSKY_SERVICE_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  return url.toString().replace(/\/$/, '');
};

const getGraphemeSegments = (value: string): string[] => {
  const SegmenterCtor = (globalThis.Intl as any).Segmenter as
    | (new (
        locale: string,
        options: { granularity: 'grapheme' },
      ) => {
        segment: (input: string) => Iterable<{ segment: string }>;
      })
    | undefined;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor('en', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((segment) => segment.segment);
  }
  return Array.from(value);
};

const truncateGraphemes = (value: string, limit: number): string => {
  if (limit <= 0) return '';
  const segments = getGraphemeSegments(value);
  if (segments.length <= limit) {
    return value;
  }
  return segments.slice(0, limit).join('');
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeTwitterAvatarUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  return url.replace('_normal.', '_400x400.');
};

const normalizeTwitterBannerUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  if (/\/\d+x\d+(?:$|\?)/.test(url)) {
    return url;
  }
  return `${url}/1500x500`;
};

const inferImageMimeTypeFromUrl = (url: string): 'image/jpeg' | 'image/png' => {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  return 'image/jpeg';
};

const detectImageMimeType = (contentType: unknown, url: string): 'image/jpeg' | 'image/png' => {
  if (typeof contentType === 'string') {
    const normalized = contentType.split(';')[0]?.trim().toLowerCase();
    if (normalized === 'image/png') return 'image/png';
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg';
  }
  return inferImageMimeTypeFromUrl(url);
};

const getProfileImagePreset = (kind: ProfileImageKind) => {
  if (kind === 'avatar') {
    return {
      width: 640,
      height: 640,
    };
  }
  return {
    width: 1500,
    height: 500,
  };
};

const compressProfileImage = async (
  sourceBuffer: Buffer,
  sourceMimeType: 'image/jpeg' | 'image/png',
  kind: ProfileImageKind,
): Promise<ProcessedProfileImage> => {
  const preset = getProfileImagePreset(kind);
  const metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
  const hasAlpha = Boolean(metadata.hasAlpha);
  const scales = [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.54, 0.46];
  const jpegQualities = [92, 88, 84, 80, 76, 72, 68, 64];
  const basePng = sourceMimeType === 'image/png' && hasAlpha;

  let best: ProcessedProfileImage | null = null;

  for (let i = 0; i < scales.length; i += 1) {
    const scale = scales[i] || 1;
    const jpegQuality = jpegQualities[i] || 70;
    const width = Math.max(kind === 'avatar' ? 256 : 800, Math.round(preset.width * scale));
    const height = Math.max(kind === 'avatar' ? 256 : 260, Math.round(preset.height * scale));

    const resized = sharp(sourceBuffer, { failOn: 'none' }).rotate().resize(width, height, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
    });

    const pngBuffer = basePng
      ? await resized
          .clone()
          .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: true,
            quality: 90,
          })
          .toBuffer()
      : null;

    if (pngBuffer) {
      if (pngBuffer.length <= PROFILE_IMAGE_TARGET_BYTES) {
        return {
          buffer: pngBuffer,
          mimeType: 'image/png',
        };
      }
      if (pngBuffer.length <= PROFILE_IMAGE_MAX_BYTES) {
        if (!best || pngBuffer.length < best.buffer.length) {
          best = {
            buffer: pngBuffer,
            mimeType: 'image/png',
          };
        }
      }
    }

    const jpegBuffer = await resized
      .clone()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    if (jpegBuffer.length <= PROFILE_IMAGE_TARGET_BYTES) {
      return {
        buffer: jpegBuffer,
        mimeType: 'image/jpeg',
      };
    }

    if (jpegBuffer.length <= PROFILE_IMAGE_MAX_BYTES) {
      if (!best || jpegBuffer.length < best.buffer.length) {
        best = {
          buffer: jpegBuffer,
          mimeType: 'image/jpeg',
        };
      }
    }
  }

  if (best) {
    return best;
  }

  throw new Error('Could not compress image under Bluesky profile limit (1MB).');
};

const buildTwitterCookieSets = (): TwitterCookieSet[] => {
  const config = getConfig();
  const sets: TwitterCookieSet[] = [];

  if (config.twitter.authToken && config.twitter.ct0) {
    sets.push({
      label: 'primary',
      authToken: config.twitter.authToken,
      ct0: config.twitter.ct0,
    });
  }

  if (config.twitter.backupAuthToken && config.twitter.backupCt0) {
    sets.push({
      label: 'backup',
      authToken: config.twitter.backupAuthToken,
      ct0: config.twitter.backupCt0,
    });
  }

  return sets;
};

const fetchTwitterProfileWithCookies = async (
  username: string,
  cookieSet: TwitterCookieSet,
): Promise<TwitterProfile> => {
  const scraper = new Scraper();
  await scraper.setCookies([`auth_token=${cookieSet.authToken}`, `ct0=${cookieSet.ct0}`]);
  return scraper.getProfile(username);
};

export const buildMirroredDisplayName = (name: string | undefined, username: string): string => {
  const baseName = normalizeWhitespace(name || '') || `@${normalizeTwitterUsername(username)}`;
  const lowerSuffix = MIRROR_SUFFIX.toLowerCase();
  const merged = baseName.toLowerCase().endsWith(lowerSuffix) ? baseName : `${baseName} ${MIRROR_SUFFIX}`;
  return truncateGraphemes(merged, 64);
};

export const buildMirroredDescription = (biography: string | undefined, username: string): string => {
  const normalizedUsername = normalizeTwitterUsername(username);
  const intro = `Unofficial mirror account of https://x.com/${normalizedUsername} from Twitter`;
  const bio = normalizeWhitespace(biography || '');
  if (!bio) {
    return truncateGraphemes(intro, 256);
  }

  const full = `${intro}\n\n"${bio}"`;
  if (getGraphemeSegments(full).length <= 256) {
    return full;
  }

  const reserved = getGraphemeSegments(`${intro}\n\n""`).length;
  const maxBioLength = Math.max(0, 256 - reserved);
  const truncatedBio = truncateGraphemes(bio, maxBioLength);
  return `${intro}\n\n"${truncatedBio}"`;
};

export const fetchTwitterMirrorProfile = async (inputUsername: string): Promise<TwitterMirrorProfile> => {
  const username = normalizeTwitterUsername(inputUsername);
  if (!username) {
    throw new Error('Twitter username is required.');
  }

  const cookieSets = buildTwitterCookieSets();
  if (cookieSets.length === 0) {
    throw new Error('Twitter cookies are not configured. Save auth_token and ct0 in settings first.');
  }

  let lastError: unknown;
  for (const cookieSet of cookieSets) {
    try {
      const profile = await fetchTwitterProfileWithCookies(username, cookieSet);
      const resolvedUsername = normalizeTwitterUsername(profile.username || username);
      const cleanedName = normalizeOptionalString(profile.name);
      const cleanedBio = normalizeOptionalString(profile.biography);

      return {
        username: resolvedUsername,
        profileUrl: `https://x.com/${resolvedUsername}`,
        name: cleanedName,
        biography: cleanedBio,
        avatarUrl: normalizeTwitterAvatarUrl(profile.avatar),
        bannerUrl: normalizeTwitterBannerUrl(profile.banner),
        mirroredDisplayName: buildMirroredDisplayName(cleanedName, resolvedUsername),
        mirroredDescription: buildMirroredDescription(cleanedBio, resolvedUsername),
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error && lastError.message) {
    throw new Error(`Failed to fetch Twitter profile: ${lastError.message}`);
  }
  throw new Error('Failed to fetch Twitter profile.');
};

export const validateBlueskyCredentials = async (args: {
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl?: string;
}): Promise<BlueskyCredentialValidation> => {
  const identifier = normalizeOptionalString(args.bskyIdentifier);
  const password = normalizeOptionalString(args.bskyPassword);
  if (!identifier || !password) {
    throw new Error('Bluesky identifier and app password are required.');
  }

  const serviceUrl = normalizeBskyServiceUrl(args.bskyServiceUrl);
  const agent = new BskyAgent({ service: serviceUrl });
  await agent.login({ identifier, password });

  const sessionResponse = await agent.com.atproto.server.getSession();
  const session = sessionResponse.data;
  return {
    did: session.did,
    handle: session.handle,
    email: session.email,
    emailConfirmed: Boolean(session.emailConfirmed),
    serviceUrl,
    settingsUrl: BSKY_SETTINGS_URL,
  };
};

const uploadProfileImage = async (agent: BskyAgent, url: string, kind: ProfileImageKind): Promise<BlobRef> => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 20_000,
    maxContentLength: 10 * 1024 * 1024,
  });

  const mimeType = detectImageMimeType(response.headers?.['content-type'], url);
  const sourceBuffer = Buffer.from(response.data);
  const processed = await compressProfileImage(sourceBuffer, mimeType, kind);
  const { data } = await agent.uploadBlob(processed.buffer, {
    encoding: processed.mimeType,
  });
  return data.blob;
};

export const syncBlueskyProfileFromTwitter = async (args: {
  twitterUsername: string;
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl?: string;
}): Promise<MirrorProfileSyncResult> => {
  const twitterProfile = await fetchTwitterMirrorProfile(args.twitterUsername);
  const bsky = await validateBlueskyCredentials({
    bskyIdentifier: args.bskyIdentifier,
    bskyPassword: args.bskyPassword,
    bskyServiceUrl: args.bskyServiceUrl,
  });

  const agent = new BskyAgent({ service: bsky.serviceUrl });
  await agent.login({
    identifier: args.bskyIdentifier,
    password: args.bskyPassword,
  });

  const warnings: string[] = [];
  let avatarBlob: BlobRef | undefined;
  let bannerBlob: BlobRef | undefined;

  if (twitterProfile.avatarUrl) {
    try {
      avatarBlob = await uploadProfileImage(agent, twitterProfile.avatarUrl, 'avatar');
    } catch (error) {
      warnings.push(`Avatar sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('No Twitter avatar found for this profile.');
  }

  if (twitterProfile.bannerUrl) {
    try {
      bannerBlob = await uploadProfileImage(agent, twitterProfile.bannerUrl, 'banner');
    } catch (error) {
      warnings.push(`Banner sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('No Twitter banner found for this profile.');
  }

  await agent.upsertProfile((existing) => ({
    ...(existing || {}),
    displayName: twitterProfile.mirroredDisplayName,
    description: twitterProfile.mirroredDescription,
    ...(avatarBlob ? { avatar: avatarBlob } : {}),
    ...(bannerBlob ? { banner: bannerBlob } : {}),
  }));

  return {
    twitterProfile,
    bsky,
    avatarSynced: Boolean(avatarBlob),
    bannerSynced: Boolean(bannerBlob),
    warnings,
  };
};
