import axios from 'axios';
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Folder,
  Heart,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  Newspaper,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Repeat2,
  Save,
  Settings2,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { cn } from './lib/utils';

type ThemeMode = 'system' | 'light' | 'dark';
type AuthView = 'login' | 'register';
type DashboardTab = 'overview' | 'accounts' | 'posts' | 'activity' | 'settings';
type SettingsSection = 'account' | 'users' | 'twitter' | 'ai' | 'data';

type AppState = 'idle' | 'checking' | 'backfilling' | 'pacing' | 'processing';

interface AccountMapping {
  id: string;
  twitterUsernames: string[];
  bskyIdentifier: string;
  bskyPassword?: string;
  bskyServiceUrl?: string;
  enabled: boolean;
  owner?: string;
  groupName?: string;
  groupEmoji?: string;
  createdByUserId?: string;
  createdByLabel?: string;
  createdByUser?: {
    id: string;
    username?: string;
    email?: string;
    role: 'admin' | 'user';
  };
}

interface AccountGroup {
  name: string;
  emoji?: string;
}

interface TwitterConfig {
  authToken: string;
  ct0: string;
  backupAuthToken?: string;
  backupCt0?: string;
}

interface AIConfig {
  provider: 'gemini' | 'openai' | 'anthropic' | 'custom';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface ActivityLog {
  twitter_id: string;
  twitter_username: string;
  bsky_identifier: string;
  tweet_text?: string;
  bsky_uri?: string;
  status: 'migrated' | 'skipped' | 'failed';
  created_at?: string;
}

interface BskyFacetFeatureLink {
  $type: 'app.bsky.richtext.facet#link';
  uri: string;
}

interface BskyFacetFeatureMention {
  $type: 'app.bsky.richtext.facet#mention';
  did: string;
}

interface BskyFacetFeatureTag {
  $type: 'app.bsky.richtext.facet#tag';
  tag: string;
}

type BskyFacetFeature = BskyFacetFeatureLink | BskyFacetFeatureMention | BskyFacetFeatureTag;

interface BskyFacet {
  index?: {
    byteStart?: number;
    byteEnd?: number;
  };
  features?: BskyFacetFeature[];
}

interface EnrichedPostMedia {
  type: 'image' | 'video' | 'external';
  url?: string;
  thumb?: string;
  alt?: string;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
}

interface EnrichedPost {
  bskyUri: string;
  bskyCid?: string;
  bskyIdentifier: string;
  twitterId: string;
  twitterUsername: string;
  twitterUrl?: string;
  postUrl?: string;
  createdAt?: string;
  text: string;
  facets: BskyFacet[];
  author: {
    did?: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  stats: {
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    engagement: number;
  };
  media: EnrichedPostMedia[];
}

interface LocalPostSearchResult {
  twitterId: string;
  twitterUsername: string;
  bskyIdentifier: string;
  tweetText?: string;
  bskyUri?: string;
  bskyCid?: string;
  createdAt?: string;
  postUrl?: string;
  twitterUrl?: string;
  score: number;
}

interface BskyProfileView {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

interface PendingBackfill {
  id: string;
  limit?: number;
  queuedAt: number;
  sequence: number;
  requestId: string;
  position: number;
}

interface StatusState {
  state: AppState;
  currentAccount?: string;
  processedCount?: number;
  totalCount?: number;
  message?: string;
  backfillMappingId?: string;
  backfillRequestId?: string;
  lastUpdate: number;
}

interface StatusResponse {
  lastCheckTime: number;
  nextCheckTime: number;
  nextCheckMinutes: number;
  checkIntervalMinutes: number;
  pendingBackfills: PendingBackfill[];
  currentStatus: StatusState;
}

interface UserPermissions {
  viewAllMappings: boolean;
  manageOwnMappings: boolean;
  manageAllMappings: boolean;
  manageGroups: boolean;
  queueBackfills: boolean;
  runNow: boolean;
}

interface AuthUser {
  id: string;
  username?: string;
  email?: string;
  isAdmin: boolean;
  permissions: UserPermissions;
}

interface ManagedUser {
  id: string;
  username?: string;
  email?: string;
  role: 'admin' | 'user';
  isAdmin: boolean;
  permissions: UserPermissions;
  createdAt: string;
  updatedAt: string;
  mappingCount: number;
  activeMappingCount: number;
  mappings: AccountMapping[];
}

interface BootstrapStatus {
  bootstrapOpen: boolean;
}

interface RuntimeVersionInfo {
  version: string;
  commit?: string;
  branch?: string;
  startedAt: number;
}

interface UpdateStatusInfo {
  running: boolean;
  pid?: number;
  startedAt?: number;
  startedBy?: string;
  finishedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  logFile?: string;
  logTail?: string[];
}

interface Notice {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface MappingFormState {
  owner: string;
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl: string;
  groupName: string;
  groupEmoji: string;
}

interface UserFormState {
  username: string;
  email: string;
  password: string;
  isAdmin: boolean;
  permissions: UserPermissions;
}

interface AccountSecurityEmailState {
  currentEmail: string;
  newEmail: string;
  password: string;
}

interface AccountSecurityPasswordState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const defaultMappingForm = (): MappingFormState => ({
  owner: '',
  bskyIdentifier: '',
  bskyPassword: '',
  bskyServiceUrl: 'https://bsky.social',
  groupName: '',
  groupEmoji: '📁',
});

const defaultUserForm = (): UserFormState => ({
  username: '',
  email: '',
  password: '',
  isAdmin: false,
  permissions: { ...DEFAULT_USER_PERMISSIONS },
});

const DEFAULT_GROUP_NAME = 'Ungrouped';
const DEFAULT_GROUP_EMOJI = '📁';
const DEFAULT_GROUP_KEY = 'ungrouped';
const TAB_PATHS: Record<DashboardTab, string> = {
  overview: '/',
  accounts: '/accounts',
  posts: '/posts',
  activity: '/activity',
  settings: '/settings',
};
const ADD_ACCOUNT_STEP_COUNT = 4;
const ADD_ACCOUNT_STEPS = ['Owner', 'Sources', 'Bluesky', 'Confirm'] as const;
const ACCOUNT_SEARCH_MIN_SCORE = 22;
const DEFAULT_BACKFILL_LIMIT = 15;
const DEFAULT_USER_PERMISSIONS: UserPermissions = {
  viewAllMappings: false,
  manageOwnMappings: true,
  manageAllMappings: false,
  manageGroups: false,
  queueBackfills: true,
  runNow: true,
};
const PERMISSION_OPTIONS: Array<{
  key: keyof UserPermissions;
  label: string;
  help: string;
}> = [
  { key: 'viewAllMappings', label: 'View all mappings', help: 'See every mapped account, post, and activity row.' },
  { key: 'manageOwnMappings', label: 'Manage own mappings', help: 'Create, edit, and delete mappings this user owns.' },
  { key: 'manageAllMappings', label: 'Manage all mappings', help: 'Edit/delete mappings created by any user.' },
  { key: 'manageGroups', label: 'Manage groups', help: 'Create, rename, and delete account groups.' },
  { key: 'queueBackfills', label: 'Queue backfills', help: 'Queue backfills for mappings they can manage.' },
  { key: 'runNow', label: 'Run checks now', help: 'Trigger an immediate scheduler run.' },
];

const selectClassName =
  'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const serverMessage = error.response?.data?.error;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) {
      return serverMessage;
    }
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
  }
  return fallback;
}

function formatState(state: AppState): string {
  switch (state) {
    case 'checking':
      return 'Checking';
    case 'backfilling':
      return 'Backfilling';
    case 'pacing':
      return 'Pacing';
    case 'processing':
      return 'Processing';
    default:
      return 'Idle';
  }
}

function getBskyPostUrl(activity: ActivityLog): string | null {
  if (!activity.bsky_uri || !activity.bsky_identifier) {
    return null;
  }

  const postId = activity.bsky_uri.split('/').filter(Boolean).pop();
  if (!postId) {
    return null;
  }

  return `https://bsky.app/profile/${activity.bsky_identifier}/post/${postId}`;
}

function normalizeTwitterUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function normalizeGroupName(value?: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_GROUP_NAME;
}

function normalizeGroupEmoji(value?: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_GROUP_EMOJI;
}

function getGroupKey(groupName?: string): string {
  return normalizeGroupName(groupName).toLowerCase();
}

function getGroupMeta(groupName?: string, groupEmoji?: string) {
  const name = normalizeGroupName(groupName);
  const emoji = normalizeGroupEmoji(groupEmoji);
  return {
    key: getGroupKey(name),
    name,
    emoji,
  };
}

function getMappingGroupMeta(mapping?: Pick<AccountMapping, 'groupName' | 'groupEmoji'>) {
  return getGroupMeta(mapping?.groupName, mapping?.groupEmoji);
}

function getTwitterPostUrl(twitterUsername?: string, twitterId?: string): string | undefined {
  if (!twitterUsername || !twitterId) {
    return undefined;
  }
  return `https://x.com/${normalizeTwitterUsername(twitterUsername)}/status/${twitterId}`;
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized.length === 0 ? '/' : normalized;
}

function getTabFromPath(pathname: string): DashboardTab | null {
  const normalized = normalizePath(pathname);
  const entry = (Object.entries(TAB_PATHS) as Array<[DashboardTab, string]>).find(([, path]) => path === normalized);
  return entry ? entry[0] : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function getUserLabel(user?: Pick<AuthUser, 'username' | 'email'>): string {
  return user?.username || user?.email || 'user';
}

function normalizePermissions(permissions?: Partial<UserPermissions>): UserPermissions {
  return {
    ...DEFAULT_USER_PERMISSIONS,
    ...(permissions || {}),
  };
}

function addTwitterUsernames(current: string[], value: string): string[] {
  const candidates = value
    .split(/[\s,]+/)
    .map(normalizeTwitterUsername)
    .filter((username) => username.length > 0);
  if (candidates.length === 0) {
    return current;
  }

  const seen = new Set(current.map(normalizeTwitterUsername));
  const next = [...current];
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    next.push(candidate);
  }

  return next;
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

function scoreSearchField(query: string, tokens: string[], candidateValue?: string): number {
  const candidate = normalizeSearchValue(candidateValue || '');
  if (!query || !candidate) {
    return 0;
  }

  let score = 0;
  if (candidate === query) {
    score += 170;
  } else if (candidate.startsWith(query)) {
    score += 138;
  } else if (candidate.includes(query)) {
    score += 108;
  }

  let matchedTokens = 0;
  for (const token of tokens) {
    if (candidate.includes(token)) {
      matchedTokens += 1;
      score += token.length >= 4 ? 18 : 12;
    }
  }
  if (tokens.length > 0) {
    score += (matchedTokens / tokens.length) * 46;
  }

  score += orderedSubsequenceScore(query, candidate) * 45;
  score += diceCoefficient(query, candidate) * 52;
  return score;
}

function scoreAccountMapping(mapping: AccountMapping, query: string, tokens: string[]): number {
  const usernameScores = mapping.twitterUsernames.map((username) => scoreSearchField(query, tokens, username) * 1.24);
  const bestUsernameScore = usernameScores.length > 0 ? Math.max(...usernameScores) : 0;
  const identifierScore = scoreSearchField(query, tokens, mapping.bskyIdentifier) * 1.2;
  const ownerScore = scoreSearchField(query, tokens, mapping.owner) * 0.92;
  const groupScore = scoreSearchField(query, tokens, mapping.groupName) * 0.72;
  const combined = [bestUsernameScore, identifierScore, ownerScore, groupScore];
  const maxScore = Math.max(...combined);
  return maxScore + (combined.reduce((total, value) => total + value, 0) - maxScore) * 0.24;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const compactNumberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

type FacetSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'mention'; text: string; href: string }
  | { type: 'tag'; text: string; href: string };

function sliceByBytes(bytes: Uint8Array, start: number, end: number): string {
  return textDecoder.decode(bytes.slice(start, end));
}

function buildFacetSegments(text: string, facets: BskyFacet[]): FacetSegment[] {
  const bytes = textEncoder.encode(text);
  const sortedFacets = [...facets].sort((a, b) => (a.index?.byteStart || 0) - (b.index?.byteStart || 0));
  const segments: FacetSegment[] = [];
  let cursor = 0;

  for (const facet of sortedFacets) {
    const start = Number(facet.index?.byteStart);
    const end = Number(facet.index?.byteEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < cursor || end <= start || end > bytes.length) continue;

    if (start > cursor) {
      segments.push({ type: 'text', text: sliceByBytes(bytes, cursor, start) });
    }

    const rawText = sliceByBytes(bytes, start, end);
    const feature = facet.features?.[0];
    if (!feature) {
      segments.push({ type: 'text', text: rawText });
    } else if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
      segments.push({ type: 'link', text: rawText, href: feature.uri });
    } else if (feature.$type === 'app.bsky.richtext.facet#mention' && feature.did) {
      segments.push({ type: 'mention', text: rawText, href: `https://bsky.app/profile/${feature.did}` });
    } else if (feature.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
      segments.push({
        type: 'tag',
        text: rawText,
        href: `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`,
      });
    } else {
      segments.push({ type: 'text', text: rawText });
    }

    cursor = end;
  }

  if (cursor < bytes.length) {
    segments.push({ type: 'text', text: sliceByBytes(bytes, cursor, bytes.length) });
  }

  if (segments.length === 0) {
    return [{ type: 'text', text }];
  }

  return segments;
}

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(Math.max(0, value));
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [authView, setAuthView] = useState<AuthView>('login');
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme-mode');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    return 'system';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [enrichedPosts, setEnrichedPosts] = useState<EnrichedPost[]>([]);
  const [profilesByActor, setProfilesByActor] = useState<Record<string, BskyProfileView>>({});
  const [twitterConfig, setTwitterConfig] = useState<TwitterConfig>({ authToken: '', ct0: '' });
  const [aiConfig, setAiConfig] = useState<AIConfig>({ provider: 'gemini', apiKey: '', model: '', baseUrl: '' });
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<RuntimeVersionInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusInfo | null>(null);
  const [countdown, setCountdown] = useState('--');
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const fromPath = getTabFromPath(window.location.pathname);
    if (fromPath) {
      return fromPath;
    }

    const saved = localStorage.getItem('dashboard-tab');
    if (
      saved === 'overview' ||
      saved === 'accounts' ||
      saved === 'posts' ||
      saved === 'activity' ||
      saved === 'settings'
    ) {
      return saved;
    }
    return 'overview';
  });

  const [me, setMe] = useState<AuthUser | null>(null);
  const [editingMapping, setEditingMapping] = useState<AccountMapping | null>(null);
  const [newMapping, setNewMapping] = useState<MappingFormState>(defaultMappingForm);
  const [newTwitterUsers, setNewTwitterUsers] = useState<string[]>([]);
  const [newTwitterInput, setNewTwitterInput] = useState('');
  const [editForm, setEditForm] = useState<MappingFormState>(defaultMappingForm);
  const [editTwitterUsers, setEditTwitterUsers] = useState<string[]>([]);
  const [editTwitterInput, setEditTwitterInput] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState(DEFAULT_GROUP_EMOJI);
  const [isAddAccountSheetOpen, setIsAddAccountSheetOpen] = useState(false);
  const [addAccountStep, setAddAccountStep] = useState(1);
  const [settingsSectionOverrides, setSettingsSectionOverrides] = useState<Partial<Record<SettingsSection, boolean>>>(
    {},
  );
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Record<string, boolean>>(() => {
    const raw = localStorage.getItem('accounts-collapsed-groups');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [accountsViewMode, setAccountsViewMode] = useState<'grouped' | 'global'>('grouped');
  const [accountsSearchQuery, setAccountsSearchQuery] = useState('');
  const [postsGroupFilter, setPostsGroupFilter] = useState('all');
  const [postsSearchQuery, setPostsSearchQuery] = useState('');
  const [localPostSearchResults, setLocalPostSearchResults] = useState<LocalPostSearchResult[]>([]);
  const [isSearchingLocalPosts, setIsSearchingLocalPosts] = useState(false);
  const [activityGroupFilter, setActivityGroupFilter] = useState('all');
  const [groupDraftsByKey, setGroupDraftsByKey] = useState<Record<string, { name: string; emoji: string }>>({});
  const [isGroupActionBusy, setIsGroupActionBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [accountsCreatorFilter, setAccountsCreatorFilter] = useState('all');
  const [newUserForm, setNewUserForm] = useState<UserFormState>(defaultUserForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserForm, setEditingUserForm] = useState<UserFormState>(defaultUserForm);
  const [emailForm, setEmailForm] = useState<AccountSecurityEmailState>({
    currentEmail: '',
    newEmail: '',
    password: '',
  });
  const [passwordForm, setPasswordForm] = useState<AccountSecurityPasswordState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [isBusy, setIsBusy] = useState(false);
  const [isUpdateBusy, setIsUpdateBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const noticeTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const postsSearchRequestRef = useRef(0);
  const statusRequestRef = useRef(0);
  const statusMutationRef = useRef(0);

  const isAdmin = me?.isAdmin ?? false;
  const effectivePermissions = useMemo<UserPermissions>(() => normalizePermissions(me?.permissions), [me?.permissions]);
  const canManageAllMappings = isAdmin || effectivePermissions.manageAllMappings;
  const canManageOwnMappings = isAdmin || effectivePermissions.manageOwnMappings;
  const canCreateMappings = canManageAllMappings || canManageOwnMappings;
  const canManageGroupsPermission = isAdmin || effectivePermissions.manageGroups;
  const canQueueBackfillsPermission = isAdmin || effectivePermissions.queueBackfills;
  const canRunNowPermission = isAdmin || effectivePermissions.runNow;
  const hasCurrentEmail = Boolean(me?.email && me.email.trim().length > 0);
  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  const showNotice = useCallback((tone: Notice['tone'], message: string) => {
    setNotice({ tone, message });
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 4200);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setMe(null);
    setMappings([]);
    setGroups([]);
    setEnrichedPosts([]);
    setProfilesByActor({});
    setStatus(null);
    setRuntimeVersion(null);
    setUpdateStatus(null);
    setRecentActivity([]);
    setEditingMapping(null);
    setNewTwitterUsers([]);
    setEditTwitterUsers([]);
    setNewGroupName('');
    setNewGroupEmoji(DEFAULT_GROUP_EMOJI);
    setIsAddAccountSheetOpen(false);
    setAddAccountStep(1);
    setSettingsSectionOverrides({});
    setAccountsViewMode('grouped');
    setAccountsSearchQuery('');
    setPostsSearchQuery('');
    setLocalPostSearchResults([]);
    setIsSearchingLocalPosts(false);
    setGroupDraftsByKey({});
    setIsGroupActionBusy(false);
    setIsUpdateBusy(false);
    setManagedUsers([]);
    setAccountsCreatorFilter('all');
    setNewUserForm(defaultUserForm());
    setEditingUserId(null);
    setEditingUserForm(defaultUserForm());
    setEmailForm({ currentEmail: '', newEmail: '', password: '' });
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    postsSearchRequestRef.current = 0;
    setAuthView('login');
  }, []);

  const handleAuthFailure = useCallback(
    (error: unknown, fallbackMessage: string) => {
      if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
        handleLogout();
        return;
      }
      showNotice('error', getApiErrorMessage(error, fallbackMessage));
    },
    [handleLogout, showNotice],
  );

  const fetchBootstrapStatus = useCallback(async () => {
    try {
      const response = await axios.get<BootstrapStatus>('/api/auth/bootstrap-status');
      setBootstrapOpen(Boolean(response.data?.bootstrapOpen));
    } catch {
      setBootstrapOpen(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    const requestToken = ++statusRequestRef.current;
    const mutationTokenAtStart = statusMutationRef.current;

    try {
      const response = await axios.get<StatusResponse>('/api/status', { headers: authHeaders });
      if (requestToken !== statusRequestRef.current) {
        return;
      }
      if (mutationTokenAtStart !== statusMutationRef.current) {
        return;
      }
      setStatus(response.data);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch status.');
    }
  }, [authHeaders, handleAuthFailure]);

  const fetchRecentActivity = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<ActivityLog[]>('/api/recent-activity?limit=20', { headers: authHeaders });
      setRecentActivity(response.data);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch activity.');
    }
  }, [authHeaders, handleAuthFailure]);

  const fetchEnrichedPosts = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<EnrichedPost[]>('/api/posts/enriched?limit=36', { headers: authHeaders });
      setEnrichedPosts(response.data);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch Bluesky posts.');
    }
  }, [authHeaders, handleAuthFailure]);

  const fetchGroups = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<AccountGroup[]>('/api/groups', { headers: authHeaders });
      setGroups(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch account groups.');
    }
  }, [authHeaders, handleAuthFailure]);

  const fetchRuntimeVersion = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<RuntimeVersionInfo>('/api/version', { headers: authHeaders });
      setRuntimeVersion(response.data);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch app version.');
    }
  }, [authHeaders, handleAuthFailure]);

  const fetchUpdateStatus = useCallback(async () => {
    if (!authHeaders || !isAdmin) {
      return;
    }

    try {
      const response = await axios.get<UpdateStatusInfo>('/api/update-status', { headers: authHeaders });
      setUpdateStatus(response.data);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch update status.');
    }
  }, [authHeaders, handleAuthFailure, isAdmin]);

  const fetchManagedUsers = useCallback(async () => {
    if (!authHeaders || !isAdmin) {
      setManagedUsers([]);
      return;
    }

    try {
      const response = await axios.get<ManagedUser[]>('/api/admin/users', { headers: authHeaders });
      setManagedUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      handleAuthFailure(error, 'Failed to fetch dashboard users.');
    }
  }, [authHeaders, handleAuthFailure, isAdmin]);

  const fetchProfiles = useCallback(
    async (actors: string[]) => {
      if (!authHeaders) {
        return;
      }

      const normalizedActors = [...new Set(actors.map(normalizeTwitterUsername).filter((actor) => actor.length > 0))];
      if (normalizedActors.length === 0) {
        setProfilesByActor({});
        return;
      }

      try {
        const response = await axios.post<Record<string, BskyProfileView>>(
          '/api/bsky/profiles',
          { actors: normalizedActors },
          { headers: authHeaders },
        );
        setProfilesByActor(response.data || {});
      } catch (error) {
        handleAuthFailure(error, 'Failed to resolve Bluesky profiles.');
      }
    },
    [authHeaders, handleAuthFailure],
  );

  const fetchData = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const [meResponse, mappingsResponse, groupsResponse] = await Promise.all([
        axios.get<AuthUser>('/api/me', { headers: authHeaders }),
        axios.get<AccountMapping[]>('/api/mappings', { headers: authHeaders }),
        axios.get<AccountGroup[]>('/api/groups', { headers: authHeaders }),
      ]);

      const profile = meResponse.data;
      const mappingData = Array.isArray(mappingsResponse.data) ? mappingsResponse.data : [];
      const groupData = Array.isArray(groupsResponse.data) ? groupsResponse.data : [];
      setMe({
        ...profile,
        permissions: normalizePermissions(profile.permissions),
      });
      setMappings(mappingData);
      setGroups(groupData);
      setEmailForm((previous) => ({
        ...previous,
        currentEmail: profile.email || '',
      }));
      const versionResponse = await axios.get<RuntimeVersionInfo>('/api/version', { headers: authHeaders });
      setRuntimeVersion(versionResponse.data);

      if (profile.isAdmin) {
        const [twitterResponse, aiResponse, updateStatusResponse, usersResponse] = await Promise.all([
          axios.get<TwitterConfig>('/api/twitter-config', { headers: authHeaders }),
          axios.get<AIConfig>('/api/ai-config', { headers: authHeaders }),
          axios.get<UpdateStatusInfo>('/api/update-status', { headers: authHeaders }),
          axios.get<ManagedUser[]>('/api/admin/users', { headers: authHeaders }),
        ]);

        setTwitterConfig({
          authToken: twitterResponse.data.authToken || '',
          ct0: twitterResponse.data.ct0 || '',
          backupAuthToken: twitterResponse.data.backupAuthToken || '',
          backupCt0: twitterResponse.data.backupCt0 || '',
        });

        setAiConfig({
          provider: aiResponse.data.provider || 'gemini',
          apiKey: aiResponse.data.apiKey || '',
          model: aiResponse.data.model || '',
          baseUrl: aiResponse.data.baseUrl || '',
        });
        setUpdateStatus(updateStatusResponse.data);
        setManagedUsers(Array.isArray(usersResponse.data) ? usersResponse.data : []);
      } else {
        setUpdateStatus(null);
        setManagedUsers([]);
      }

      await Promise.all([fetchStatus(), fetchRecentActivity(), fetchEnrichedPosts()]);
      await fetchProfiles(mappingData.map((mapping) => mapping.bskyIdentifier));
    } catch (error) {
      handleAuthFailure(error, 'Failed to load dashboard data.');
    }
  }, [authHeaders, fetchEnrichedPosts, fetchProfiles, fetchRecentActivity, fetchStatus, handleAuthFailure]);

  useEffect(() => {
    localStorage.setItem('theme-mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem('dashboard-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    const expectedPath = TAB_PATHS[activeTab];
    const currentPath = normalizePath(window.location.pathname);
    if (currentPath !== expectedPath) {
      window.history.pushState({ tab: activeTab }, '', expectedPath);
    }
  }, [activeTab]);

  useEffect(() => {
    const onPopState = () => {
      const tabFromPath = getTabFromPath(window.location.pathname);
      if (tabFromPath) {
        setActiveTab(tabFromPath);
      } else {
        setActiveTab('overview');
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('accounts-collapsed-groups', JSON.stringify(collapsedGroupKeys));
  }, [collapsedGroupKeys]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const next = themeMode === 'system' ? (media.matches ? 'dark' : 'light') : themeMode;
      setResolvedTheme(next);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(next);
    };

    applyTheme();
    media.addEventListener('change', applyTheme);

    return () => {
      media.removeEventListener('change', applyTheme);
    };
  }, [themeMode]);

  useEffect(() => {
    if (!token) {
      void fetchBootstrapStatus();
      return;
    }

    void fetchData();
  }, [token, fetchBootstrapStatus, fetchData]);

  useEffect(() => {
    if (!bootstrapOpen && authView === 'register') {
      setAuthView('login');
    }
  }, [authView, bootstrapOpen]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const statusInterval = window.setInterval(() => {
      void fetchStatus();
    }, 2000);

    const activityInterval = window.setInterval(() => {
      void fetchRecentActivity();
    }, 7000);

    const postsInterval = window.setInterval(() => {
      void fetchEnrichedPosts();
    }, 12000);

    return () => {
      window.clearInterval(statusInterval);
      window.clearInterval(activityInterval);
      window.clearInterval(postsInterval);
    };
  }, [token, fetchEnrichedPosts, fetchRecentActivity, fetchStatus]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const versionInterval = window.setInterval(() => {
      void fetchRuntimeVersion();
      if (isAdmin) {
        void fetchUpdateStatus();
      }
    }, 15000);

    return () => {
      window.clearInterval(versionInterval);
    };
  }, [token, isAdmin, fetchRuntimeVersion, fetchUpdateStatus]);

  useEffect(() => {
    if (!status?.nextCheckTime) {
      setCountdown('--');
      return;
    }

    const updateCountdown = () => {
      const ms = status.nextCheckTime - Date.now();
      if (ms <= 0) {
        setCountdown('Checking...');
        return;
      }

      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      setCountdown(`${minutes}m ${String(seconds).padStart(2, '0')}s`);
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status?.nextCheckTime]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAddAccountSheetOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAddAccountSheet();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isAddAccountSheetOpen]);

  const pendingBackfills = status?.pendingBackfills ?? [];
  const currentStatus = status?.currentStatus;
  const latestActivity = recentActivity[0];
  const dashboardTabs = useMemo(
    () => [
      { id: 'overview' as DashboardTab, label: 'Overview', icon: LayoutDashboard },
      { id: 'accounts' as DashboardTab, label: 'Accounts', icon: Users },
      { id: 'posts' as DashboardTab, label: 'Posts', icon: Newspaper },
      { id: 'activity' as DashboardTab, label: 'Activity', icon: History },
      { id: 'settings' as DashboardTab, label: 'Settings', icon: Settings2 },
    ],
    [],
  );
  const postedActivity = useMemo(() => enrichedPosts.slice(0, 12), [enrichedPosts]);
  const engagementByAccount = useMemo(() => {
    const map = new Map<string, { identifier: string; score: number; posts: number }>();
    for (const post of enrichedPosts) {
      const key = normalizeTwitterUsername(post.bskyIdentifier);
      const existing = map.get(key) || {
        identifier: post.bskyIdentifier,
        score: 0,
        posts: 0,
      };
      existing.score += post.stats.engagement || 0;
      existing.posts += 1;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.score - a.score);
  }, [enrichedPosts]);
  const topAccount = engagementByAccount[0];
  const getProfileForActor = useCallback(
    (actor: string) => profilesByActor[normalizeTwitterUsername(actor)],
    [profilesByActor],
  );
  const topAccountProfile = topAccount ? getProfileForActor(topAccount.identifier) : undefined;
  const mappingsByBskyIdentifier = useMemo(() => {
    const map = new Map<string, AccountMapping>();
    for (const mapping of mappings) {
      map.set(normalizeTwitterUsername(mapping.bskyIdentifier), mapping);
    }
    return map;
  }, [mappings]);
  const mappingsByTwitterUsername = useMemo(() => {
    const map = new Map<string, AccountMapping>();
    for (const mapping of mappings) {
      for (const username of mapping.twitterUsernames) {
        map.set(normalizeTwitterUsername(username), mapping);
      }
    }
    return map;
  }, [mappings]);
  const groupOptions = useMemo(() => {
    const options = new Map<string, { key: string; name: string; emoji: string }>();
    for (const group of groups) {
      const meta = getGroupMeta(group.name, group.emoji);
      if (meta.key === DEFAULT_GROUP_KEY) {
        continue;
      }
      options.set(meta.key, meta);
    }
    for (const mapping of mappings) {
      const group = getMappingGroupMeta(mapping);
      options.set(group.key, options.get(group.key) || group);
    }
    return [...options.values()].sort((a, b) => {
      const aUngrouped = a.name === DEFAULT_GROUP_NAME;
      const bUngrouped = b.name === DEFAULT_GROUP_NAME;
      if (aUngrouped && !bUngrouped) return 1;
      if (!aUngrouped && bUngrouped) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [groups, mappings]);
  const groupOptionsByKey = useMemo(() => new Map(groupOptions.map((group) => [group.key, group])), [groupOptions]);
  const reusableGroupOptions = useMemo(
    () => groupOptions.filter((group) => group.key !== DEFAULT_GROUP_KEY),
    [groupOptions],
  );
  const managedUsersById = useMemo(() => new Map(managedUsers.map((user) => [user.id, user])), [managedUsers]);
  const accountMappingsForView = useMemo(() => {
    if (!isAdmin || accountsCreatorFilter === 'all') {
      return mappings;
    }
    return mappings.filter((mapping) => mapping.createdByUserId === accountsCreatorFilter);
  }, [accountsCreatorFilter, isAdmin, mappings]);
  const groupedMappings = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; emoji: string; mappings: AccountMapping[] }>();
    for (const option of groupOptions) {
      groups.set(option.key, {
        ...option,
        mappings: [],
      });
    }
    for (const mapping of accountMappingsForView) {
      const group = getMappingGroupMeta(mapping);
      const existing = groups.get(group.key);
      if (!existing) {
        groups.set(group.key, { ...group, mappings: [mapping] });
        continue;
      }
      existing.mappings.push(mapping);
    }

    return [...groups.values()]
      .sort((a, b) => {
        const aUngrouped = a.name === DEFAULT_GROUP_NAME;
        const bUngrouped = b.name === DEFAULT_GROUP_NAME;
        if (aUngrouped && !bUngrouped) return 1;
        if (!aUngrouped && bUngrouped) return -1;
        return a.name.localeCompare(b.name);
      })
      .map((group) => ({
        ...group,
        mappings: [...group.mappings].sort((a, b) =>
          `${(a.owner || '').toLowerCase()}-${a.bskyIdentifier.toLowerCase()}`.localeCompare(
            `${(b.owner || '').toLowerCase()}-${b.bskyIdentifier.toLowerCase()}`,
          ),
        ),
      }));
  }, [accountMappingsForView, groupOptions]);
  const normalizedAccountsQuery = useMemo(() => normalizeSearchValue(accountsSearchQuery), [accountsSearchQuery]);
  const accountSearchTokens = useMemo(() => tokenizeSearchValue(normalizedAccountsQuery), [normalizedAccountsQuery]);
  const accountSearchScores = useMemo(() => {
    const scores = new Map<string, number>();
    if (!normalizedAccountsQuery) {
      return scores;
    }

    for (const mapping of accountMappingsForView) {
      scores.set(mapping.id, scoreAccountMapping(mapping, normalizedAccountsQuery, accountSearchTokens));
    }
    return scores;
  }, [accountMappingsForView, accountSearchTokens, normalizedAccountsQuery]);
  const filteredGroupedMappings = useMemo(() => {
    const hasQuery = normalizedAccountsQuery.length > 0;
    const sortByScore = (items: AccountMapping[]) => {
      if (!hasQuery) {
        return items;
      }
      return [...items].sort((a, b) => {
        const scoreDelta = (accountSearchScores.get(b.id) || 0) - (accountSearchScores.get(a.id) || 0);
        if (scoreDelta !== 0) return scoreDelta;
        return `${(a.owner || '').toLowerCase()}-${a.bskyIdentifier.toLowerCase()}`.localeCompare(
          `${(b.owner || '').toLowerCase()}-${b.bskyIdentifier.toLowerCase()}`,
        );
      });
    };

    const withSearch = groupedMappings
      .map((group) => {
        const mappingsForGroup = hasQuery
          ? group.mappings.filter((mapping) => (accountSearchScores.get(mapping.id) || 0) >= ACCOUNT_SEARCH_MIN_SCORE)
          : group.mappings;
        return {
          ...group,
          mappings: sortByScore(mappingsForGroup),
        };
      })
      .filter((group) => !hasQuery || group.mappings.length > 0);

    if (accountsViewMode === 'grouped') {
      return withSearch;
    }

    const allMappings = sortByScore(
      hasQuery
        ? accountMappingsForView.filter(
            (mapping) => (accountSearchScores.get(mapping.id) || 0) >= ACCOUNT_SEARCH_MIN_SCORE,
          )
        : [...accountMappingsForView].sort((a, b) =>
            `${(a.owner || '').toLowerCase()}-${a.bskyIdentifier.toLowerCase()}`.localeCompare(
              `${(b.owner || '').toLowerCase()}-${b.bskyIdentifier.toLowerCase()}`,
            ),
          ),
    );

    return [
      {
        key: '__all__',
        name: hasQuery ? 'Search Results' : 'All Accounts',
        emoji: hasQuery ? '🔎' : '🌐',
        mappings: allMappings,
      },
    ];
  }, [accountMappingsForView, accountSearchScores, accountsViewMode, groupedMappings, normalizedAccountsQuery]);
  const accountMatchesCount = useMemo(
    () => filteredGroupedMappings.reduce((total, group) => total + group.mappings.length, 0),
    [filteredGroupedMappings],
  );
  const groupKeysForCollapse = useMemo(() => groupedMappings.map((group) => group.key), [groupedMappings]);
  const allGroupsCollapsed = useMemo(
    () =>
      groupKeysForCollapse.length > 0 &&
      groupKeysForCollapse.every((groupKey) => collapsedGroupKeys[groupKey] === true),
    [collapsedGroupKeys, groupKeysForCollapse],
  );
  const resolveMappingForLocalPost = useCallback(
    (post: LocalPostSearchResult) =>
      mappingsByBskyIdentifier.get(normalizeTwitterUsername(post.bskyIdentifier)) ||
      mappingsByTwitterUsername.get(normalizeTwitterUsername(post.twitterUsername)),
    [mappingsByBskyIdentifier, mappingsByTwitterUsername],
  );
  const resolveMappingForPost = useCallback(
    (post: EnrichedPost) =>
      mappingsByBskyIdentifier.get(normalizeTwitterUsername(post.bskyIdentifier)) ||
      mappingsByTwitterUsername.get(normalizeTwitterUsername(post.twitterUsername)),
    [mappingsByBskyIdentifier, mappingsByTwitterUsername],
  );
  const resolveMappingForActivity = useCallback(
    (activity: ActivityLog) =>
      mappingsByBskyIdentifier.get(normalizeTwitterUsername(activity.bsky_identifier)) ||
      mappingsByTwitterUsername.get(normalizeTwitterUsername(activity.twitter_username)),
    [mappingsByBskyIdentifier, mappingsByTwitterUsername],
  );
  const filteredPostedActivity = useMemo(
    () =>
      postedActivity.filter((post) => {
        if (postsGroupFilter === 'all') return true;
        const mapping = resolveMappingForPost(post);
        return getMappingGroupMeta(mapping).key === postsGroupFilter;
      }),
    [postedActivity, postsGroupFilter, resolveMappingForPost],
  );
  const filteredLocalPostSearchResults = useMemo(
    () =>
      localPostSearchResults.filter((post) => {
        if (postsGroupFilter === 'all') return true;
        const mapping = resolveMappingForLocalPost(post);
        return getMappingGroupMeta(mapping).key === postsGroupFilter;
      }),
    [localPostSearchResults, postsGroupFilter, resolveMappingForLocalPost],
  );
  const filteredRecentActivity = useMemo(
    () =>
      recentActivity.filter((activity) => {
        if (activityGroupFilter === 'all') return true;
        const mapping = resolveMappingForActivity(activity);
        return getMappingGroupMeta(mapping).key === activityGroupFilter;
      }),
    [activityGroupFilter, recentActivity, resolveMappingForActivity],
  );
  const canManageMapping = useCallback(
    (mapping: AccountMapping) =>
      canManageAllMappings ||
      (canManageOwnMappings && (!mapping.createdByUserId || mapping.createdByUserId === me?.id)),
    [canManageAllMappings, canManageOwnMappings, me?.id],
  );
  const twitterConfigured = Boolean(twitterConfig.authToken && twitterConfig.ct0);
  const aiConfigured = Boolean(aiConfig.apiKey);
  const sectionDefaultExpanded = useMemo<Record<SettingsSection, boolean>>(
    () => ({
      account: true,
      users: true,
      twitter: !twitterConfigured,
      ai: !aiConfigured,
      data: false,
    }),
    [aiConfigured, twitterConfigured],
  );
  const isSettingsSectionExpanded = useCallback(
    (section: SettingsSection) => settingsSectionOverrides[section] ?? sectionDefaultExpanded[section],
    [sectionDefaultExpanded, settingsSectionOverrides],
  );
  const toggleSettingsSection = (section: SettingsSection) => {
    setSettingsSectionOverrides((previous) => ({
      ...previous,
      [section]: !(previous[section] ?? sectionDefaultExpanded[section]),
    }));
  };

  useEffect(() => {
    if (postsGroupFilter !== 'all' && !groupOptions.some((group) => group.key === postsGroupFilter)) {
      setPostsGroupFilter('all');
    }
    if (activityGroupFilter !== 'all' && !groupOptions.some((group) => group.key === activityGroupFilter)) {
      setActivityGroupFilter('all');
    }
  }, [activityGroupFilter, groupOptions, postsGroupFilter]);

  useEffect(() => {
    if (!isAdmin) {
      if (accountsCreatorFilter !== 'all') {
        setAccountsCreatorFilter('all');
      }
      return;
    }

    if (accountsCreatorFilter !== 'all' && !managedUsers.some((user) => user.id === accountsCreatorFilter)) {
      setAccountsCreatorFilter('all');
    }
  }, [accountsCreatorFilter, isAdmin, managedUsers]);

  useEffect(() => {
    setGroupDraftsByKey((previous) => {
      const next: Record<string, { name: string; emoji: string }> = {};
      for (const group of reusableGroupOptions) {
        const existing = previous[group.key];
        next[group.key] = {
          name: existing?.name ?? group.name,
          emoji: existing?.emoji ?? group.emoji,
        };
      }
      return next;
    });
  }, [reusableGroupOptions]);

  useEffect(() => {
    if (!authHeaders) {
      setIsSearchingLocalPosts(false);
      setLocalPostSearchResults([]);
      return;
    }

    const query = postsSearchQuery.trim();
    if (!query) {
      postsSearchRequestRef.current += 1;
      setIsSearchingLocalPosts(false);
      setLocalPostSearchResults([]);
      return;
    }

    const requestId = postsSearchRequestRef.current + 1;
    postsSearchRequestRef.current = requestId;
    setIsSearchingLocalPosts(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await axios.get<LocalPostSearchResult[]>('/api/posts/search', {
          params: { q: query, limit: 120 },
          headers: authHeaders,
        });
        if (postsSearchRequestRef.current !== requestId) {
          return;
        }
        setLocalPostSearchResults(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        if (postsSearchRequestRef.current !== requestId) {
          return;
        }
        setLocalPostSearchResults([]);
        handleAuthFailure(error, 'Failed to search local post history.');
      } finally {
        if (postsSearchRequestRef.current === requestId) {
          setIsSearchingLocalPosts(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authHeaders, handleAuthFailure, postsSearchQuery]);

  const isBackfillQueued = useCallback(
    (mappingId: string) => pendingBackfills.some((entry) => entry.id === mappingId),
    [pendingBackfills],
  );

  const getBackfillEntry = useCallback(
    (mappingId: string) => pendingBackfills.find((entry) => entry.id === mappingId),
    [pendingBackfills],
  );

  const isBackfillActive = useCallback(
    (mappingId: string) => currentStatus?.state === 'backfilling' && currentStatus.backfillMappingId === mappingId,
    [currentStatus],
  );

  const progressPercent = useMemo(() => {
    if (!currentStatus?.totalCount || currentStatus.totalCount <= 0) {
      return 0;
    }
    const processed = currentStatus.processedCount || 0;
    return Math.max(0, Math.min(100, Math.round((processed / currentStatus.totalCount) * 100)));
  }, [currentStatus]);

  const cycleThemeMode = () => {
    setThemeMode((prev) => {
      if (prev === 'system') return 'light';
      if (prev === 'light') return 'dark';
      return 'system';
    });
  };

  const themeIcon =
    themeMode === 'system' ? (
      <SunMoon className="h-4 w-4" />
    ) : themeMode === 'light' ? (
      <Sun className="h-4 w-4" />
    ) : (
      <Moon className="h-4 w-4" />
    );

  const themeLabel = themeMode === 'system' ? `Theme: system (${resolvedTheme})` : `Theme: ${themeMode}`;
  const runtimeVersionLabel = runtimeVersion
    ? `v${runtimeVersion.version}${runtimeVersion.commit ? ` (${runtimeVersion.commit})` : ''}`
    : 'v--';
  const runtimeBranchLabel = runtimeVersion?.branch ? `branch ${runtimeVersion.branch}` : null;
  const updateStateLabel = updateStatus?.running
    ? 'Update in progress'
    : updateStatus?.finishedAt
      ? updateStatus.exitCode === 0
        ? 'Last update succeeded'
        : 'Last update failed'
      : 'No update run recorded';

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setIsBusy(true);

    const data = new FormData(event.currentTarget);
    const identifier = String(data.get('identifier') || '').trim();
    const password = String(data.get('password') || '');

    try {
      const response = await axios.post<{ token: string }>('/api/login', { identifier, password });
      localStorage.setItem('token', response.data.token);
      setToken(response.data.token);
      showNotice('success', 'Logged in.');
    } catch (error) {
      setAuthError(getApiErrorMessage(error, 'Invalid credentials.'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setIsBusy(true);

    const data = new FormData(event.currentTarget);
    const username = String(data.get('username') || '').trim();
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');

    try {
      await axios.post('/api/register', { username, email, password });
      setAuthView('login');
      showNotice('success', 'Registration successful. Please log in.');
      await fetchBootstrapStatus();
    } catch (error) {
      setAuthError(getApiErrorMessage(error, 'Registration failed.'));
    } finally {
      setIsBusy(false);
    }
  };

  const runNow = async () => {
    if (!authHeaders) {
      return;
    }
    if (!canRunNowPermission) {
      showNotice('error', 'You do not have permission to run checks now.');
      return;
    }

    try {
      statusMutationRef.current += 1;
      setStatus((previous) =>
        previous
          ? {
              ...previous,
              nextCheckTime: Date.now() + 1000,
              currentStatus: {
                ...previous.currentStatus,
                state: 'checking',
                message: 'Manual run requested...',
                lastUpdate: Date.now(),
                backfillMappingId: undefined,
                backfillRequestId: undefined,
              },
            }
          : previous,
      );
      await axios.post('/api/run-now', {}, { headers: authHeaders });
      showNotice('info', 'Check triggered.');
      await fetchStatus();
    } catch (error) {
      handleAuthFailure(error, 'Failed to trigger a check.');
    }
  };

  const clearAllBackfills = async () => {
    if (!authHeaders) {
      return;
    }

    const confirmed = window.confirm('Stop all pending and active backfills?');
    if (!confirmed) {
      return;
    }

    try {
      statusMutationRef.current += 1;
      setStatus((previous) =>
        previous
          ? {
              ...previous,
              pendingBackfills: [],
              currentStatus: {
                ...previous.currentStatus,
                state: 'idle',
                message: 'Backfill queue cleared',
                backfillMappingId: undefined,
                backfillRequestId: undefined,
                lastUpdate: Date.now(),
              },
            }
          : previous,
      );
      await axios.post('/api/backfill/clear-all', {}, { headers: authHeaders });
      showNotice('success', 'Backfill queue cleared.');
      await fetchStatus();
    } catch (error) {
      handleAuthFailure(error, 'Failed to clear backfill queue.');
    }
  };

  const cancelQueuedBackfill = async (mappingId: string) => {
    if (!authHeaders) {
      return;
    }

    const mapping = mappings.find((entry) => entry.id === mappingId);
    if (!mapping || !canManageMapping(mapping)) {
      showNotice('error', 'You do not have permission to cancel this queue entry.');
      return;
    }

    try {
      statusMutationRef.current += 1;
      setStatus((previous) => {
        if (!previous) {
          return previous;
        }

        const nextPending = previous.pendingBackfills
          .filter((entry) => entry.id !== mappingId)
          .map((entry, index) => ({ ...entry, position: index + 1 }));
        return {
          ...previous,
          pendingBackfills: nextPending,
        };
      });
      await axios.delete(`/api/backfill/${mappingId}`, { headers: authHeaders });
      showNotice('success', 'Queue entry cancelled.');
      await fetchStatus();
    } catch (error) {
      handleAuthFailure(error, 'Failed to cancel queue entry.');
    }
  };

  const requestBackfill = async (mappingId: string, mode: 'normal' | 'reset') => {
    if (!authHeaders) {
      return;
    }
    const mapping = mappings.find((entry) => entry.id === mappingId);
    if (!mapping || !canQueueBackfillsPermission || !canManageMapping(mapping)) {
      showNotice('error', 'You do not have permission to queue backfill for this account.');
      return;
    }

    const busy = pendingBackfills.length > 0 || currentStatus?.state === 'backfilling';
    if (busy) {
      const proceed = window.confirm(
        'Backfill is already queued or active. This request will replace the existing queue item for this account. Continue?',
      );
      if (!proceed) {
        return;
      }
    }
    const safeLimit = DEFAULT_BACKFILL_LIMIT;

    try {
      if (mode === 'reset') {
        if (!isAdmin) {
          showNotice('error', 'Only admins can reset cache before backfill.');
          return;
        }
        await axios.delete(`/api/mappings/${mappingId}/cache`, { headers: authHeaders });
      }

      statusMutationRef.current += 1;
      setStatus((previous) => {
        if (!previous) {
          return previous;
        }

        const now = Date.now();
        const existing = previous.pendingBackfills.filter((entry) => entry.id !== mappingId);
        const nextPending = [
          ...existing,
          {
            id: mappingId,
            limit: safeLimit,
            queuedAt: now,
            sequence: now,
            requestId: `ui-${now}`,
            position: existing.length + 1,
          },
        ].map((entry, index) => ({ ...entry, position: index + 1 }));

        return {
          ...previous,
          pendingBackfills: nextPending,
        };
      });
      await axios.post(`/api/backfill/${mappingId}`, { limit: safeLimit }, { headers: authHeaders });
      showNotice(
        'success',
        mode === 'reset'
          ? `Cache reset and backfill queued (${safeLimit} tweets).`
          : `Backfill queued (${safeLimit} tweets).`,
      );
      await fetchStatus();
    } catch (error) {
      handleAuthFailure(error, 'Failed to queue backfill.');
    }
  };

  const handleDeleteAllPosts = async (mappingId: string) => {
    if (!authHeaders) {
      return;
    }

    const firstConfirm = window.confirm(
      'Danger: this deletes all posts on the mapped Bluesky account and clears local cache. Continue?',
    );

    if (!firstConfirm) {
      return;
    }

    const finalConfirm = window.prompt('Type DELETE to confirm:');
    if (finalConfirm !== 'DELETE') {
      return;
    }

    try {
      const response = await axios.post<{ message: string }>(
        `/api/mappings/${mappingId}/delete-all-posts`,
        {},
        { headers: authHeaders },
      );
      showNotice('success', response.data.message);
    } catch (error) {
      handleAuthFailure(error, 'Failed to delete posts.');
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    if (!authHeaders) {
      return;
    }
    const mapping = mappings.find((entry) => entry.id === mappingId);
    if (!mapping || !canManageMapping(mapping)) {
      showNotice('error', 'You do not have permission to delete this mapping.');
      return;
    }

    const confirmed = window.confirm('Delete this mapping?');
    if (!confirmed) {
      return;
    }

    try {
      await axios.delete(`/api/mappings/${mappingId}`, { headers: authHeaders });
      setMappings((prev) => prev.filter((mapping) => mapping.id !== mappingId));
      showNotice('success', 'Mapping deleted.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to delete mapping.');
    }
  };

  const addNewTwitterUsername = () => {
    setNewTwitterUsers((previous) => addTwitterUsernames(previous, newTwitterInput));
    setNewTwitterInput('');
  };

  const removeNewTwitterUsername = (username: string) => {
    setNewTwitterUsers((previous) =>
      previous.filter((existing) => normalizeTwitterUsername(existing) !== normalizeTwitterUsername(username)),
    );
  };

  const addEditTwitterUsername = () => {
    setEditTwitterUsers((previous) => addTwitterUsernames(previous, editTwitterInput));
    setEditTwitterInput('');
  };

  const removeEditTwitterUsername = (username: string) => {
    setEditTwitterUsers((previous) =>
      previous.filter((existing) => normalizeTwitterUsername(existing) !== normalizeTwitterUsername(username)),
    );
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroupKeys((previous) => ({
      ...previous,
      [groupKey]: !previous[groupKey],
    }));
  };

  const toggleCollapseAllGroups = () => {
    const shouldCollapse = !allGroupsCollapsed;
    setCollapsedGroupKeys((previous) => {
      const next = { ...previous };
      for (const groupKey of groupKeysForCollapse) {
        next[groupKey] = shouldCollapse;
      }
      return next;
    });
  };

  const handleCreateGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
      return;
    }
    if (!canManageGroupsPermission) {
      showNotice('error', 'You do not have permission to create groups.');
      return;
    }

    const name = newGroupName.trim();
    const emoji = newGroupEmoji.trim() || DEFAULT_GROUP_EMOJI;
    if (!name) {
      showNotice('error', 'Enter a group name first.');
      return;
    }

    setIsBusy(true);
    try {
      await axios.post('/api/groups', { name, emoji }, { headers: authHeaders });
      setNewGroupName('');
      setNewGroupEmoji(DEFAULT_GROUP_EMOJI);
      await fetchGroups();
      showNotice('success', `Group "${name}" created.`);
    } catch (error) {
      handleAuthFailure(error, 'Failed to create group.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAssignMappingGroup = async (mapping: AccountMapping, groupKey: string) => {
    if (!authHeaders) {
      return;
    }
    if (!canManageMapping(mapping)) {
      showNotice('error', 'You do not have permission to update this mapping.');
      return;
    }

    const selectedGroup = groupOptionsByKey.get(groupKey);
    const nextGroupName = selectedGroup?.name || '';
    const nextGroupEmoji = selectedGroup?.emoji || '';

    try {
      await axios.put(
        `/api/mappings/${mapping.id}`,
        {
          groupName: nextGroupName,
          groupEmoji: nextGroupEmoji,
        },
        { headers: authHeaders },
      );

      setMappings((previous) =>
        previous.map((entry) =>
          entry.id === mapping.id
            ? {
                ...entry,
                groupName: nextGroupName || undefined,
                groupEmoji: nextGroupEmoji || undefined,
              }
            : entry,
        ),
      );

      if (nextGroupName) {
        setGroups((previous) => {
          const key = getGroupKey(nextGroupName);
          if (previous.some((group) => getGroupKey(group.name) === key)) {
            return previous;
          }
          return [...previous, { name: nextGroupName, ...(nextGroupEmoji ? { emoji: nextGroupEmoji } : {}) }];
        });
      }
    } catch (error) {
      handleAuthFailure(error, 'Failed to move account to folder.');
    }
  };

  const updateGroupDraft = (groupKey: string, field: 'name' | 'emoji', value: string) => {
    setGroupDraftsByKey((previous) => ({
      ...previous,
      [groupKey]: {
        name: previous[groupKey]?.name ?? '',
        emoji: previous[groupKey]?.emoji ?? '',
        [field]: value,
      },
    }));
  };

  const handleRenameGroup = async (groupKey: string) => {
    if (!authHeaders) {
      return;
    }
    if (!canManageGroupsPermission) {
      showNotice('error', 'You do not have permission to rename groups.');
      return;
    }

    const draft = groupDraftsByKey[groupKey];
    if (!draft || !draft.name.trim()) {
      showNotice('error', 'Group name is required.');
      return;
    }

    setIsGroupActionBusy(true);
    try {
      await axios.put(
        `/api/groups/${encodeURIComponent(groupKey)}`,
        {
          name: draft.name.trim(),
          emoji: draft.emoji.trim(),
        },
        { headers: authHeaders },
      );
      showNotice('success', 'Group updated.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to update group.');
    } finally {
      setIsGroupActionBusy(false);
    }
  };

  const handleDeleteGroup = async (groupKey: string) => {
    if (!authHeaders) {
      return;
    }
    if (!canManageGroupsPermission) {
      showNotice('error', 'You do not have permission to delete groups.');
      return;
    }

    const group = groupOptionsByKey.get(groupKey);
    if (!group) {
      showNotice('error', 'Group not found.');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${group.name}"? Mappings in this folder will move to ${DEFAULT_GROUP_NAME}.`,
    );
    if (!confirmed) {
      return;
    }

    setIsGroupActionBusy(true);
    try {
      const response = await axios.delete<{ reassignedCount?: number }>(`/api/groups/${encodeURIComponent(groupKey)}`, {
        headers: authHeaders,
      });
      const reassignedCount = response.data?.reassignedCount || 0;
      showNotice('success', `Group deleted. ${reassignedCount} account${reassignedCount === 1 ? '' : 's'} moved.`);
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to delete group.');
    } finally {
      setIsGroupActionBusy(false);
    }
  };

  const resetAddAccountDraft = () => {
    setNewMapping({
      ...defaultMappingForm(),
      owner: getUserLabel(me),
    });
    setNewTwitterUsers([]);
    setNewTwitterInput('');
    setAddAccountStep(1);
  };

  const openAddAccountSheet = () => {
    if (!canCreateMappings) {
      showNotice('error', 'You do not have permission to add mappings.');
      return;
    }
    resetAddAccountDraft();
    setIsAddAccountSheetOpen(true);
  };

  const closeAddAccountSheet = () => {
    setIsAddAccountSheetOpen(false);
    resetAddAccountDraft();
  };

  const applyGroupPresetToNewMapping = (groupKey: string) => {
    const group = groupOptionsByKey.get(groupKey);
    if (!group || group.key === DEFAULT_GROUP_KEY) {
      return;
    }
    setNewMapping((previous) => ({
      ...previous,
      groupName: group.name,
      groupEmoji: group.emoji,
    }));
  };

  const submitNewMapping = async () => {
    if (!authHeaders) {
      return;
    }
    if (!canCreateMappings) {
      showNotice('error', 'You do not have permission to add mappings.');
      return;
    }

    if (newTwitterUsers.length === 0) {
      showNotice('error', 'Add at least one Twitter username.');
      return;
    }

    setIsBusy(true);

    try {
      await axios.post(
        '/api/mappings',
        {
          owner: newMapping.owner.trim(),
          twitterUsernames: newTwitterUsers,
          bskyIdentifier: newMapping.bskyIdentifier.trim(),
          bskyPassword: newMapping.bskyPassword,
          bskyServiceUrl: newMapping.bskyServiceUrl.trim(),
          groupName: newMapping.groupName.trim(),
          groupEmoji: newMapping.groupEmoji.trim(),
        },
        { headers: authHeaders },
      );

      setNewMapping(defaultMappingForm());
      setNewTwitterUsers([]);
      setNewTwitterInput('');
      setIsAddAccountSheetOpen(false);
      setAddAccountStep(1);
      showNotice('success', 'Account mapping added.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to add account mapping.');
    } finally {
      setIsBusy(false);
    }
  };

  const advanceAddAccountStep = () => {
    if (addAccountStep === 1) {
      if (!newMapping.owner.trim()) {
        showNotice('error', 'Owner is required.');
        return;
      }
      setAddAccountStep(2);
      return;
    }

    if (addAccountStep === 2) {
      if (newTwitterUsers.length === 0) {
        showNotice('error', 'Add at least one Twitter username.');
        return;
      }
      setAddAccountStep(3);
      return;
    }

    if (addAccountStep === 3) {
      if (!newMapping.bskyIdentifier.trim() || !newMapping.bskyPassword.trim()) {
        showNotice('error', 'Bluesky identifier and app password are required.');
        return;
      }
      setAddAccountStep(4);
    }
  };

  const retreatAddAccountStep = () => {
    setAddAccountStep((previous) => Math.max(1, previous - 1));
  };

  const startEditMapping = (mapping: AccountMapping) => {
    if (!canManageMapping(mapping)) {
      showNotice('error', 'You do not have permission to edit this mapping.');
      return;
    }
    setEditingMapping(mapping);
    setEditForm({
      owner: mapping.owner || '',
      bskyIdentifier: mapping.bskyIdentifier,
      bskyPassword: '',
      bskyServiceUrl: mapping.bskyServiceUrl || 'https://bsky.social',
      groupName: mapping.groupName || '',
      groupEmoji: mapping.groupEmoji || '📁',
    });
    setEditTwitterUsers(mapping.twitterUsernames);
    setEditTwitterInput('');
  };

  const handleUpdateMapping = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders || !editingMapping) {
      return;
    }
    if (!canManageMapping(editingMapping)) {
      showNotice('error', 'You do not have permission to edit this mapping.');
      return;
    }

    if (editTwitterUsers.length === 0) {
      showNotice('error', 'At least one Twitter username is required.');
      return;
    }

    setIsBusy(true);

    try {
      await axios.put(
        `/api/mappings/${editingMapping.id}`,
        {
          owner: editForm.owner.trim(),
          twitterUsernames: editTwitterUsers,
          bskyIdentifier: editForm.bskyIdentifier.trim(),
          bskyPassword: editForm.bskyPassword,
          bskyServiceUrl: editForm.bskyServiceUrl.trim(),
          groupName: editForm.groupName.trim(),
          groupEmoji: editForm.groupEmoji.trim(),
        },
        { headers: authHeaders },
      );

      setEditingMapping(null);
      setEditForm(defaultMappingForm());
      setEditTwitterUsers([]);
      setEditTwitterInput('');
      showNotice('success', 'Mapping updated.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to update mapping.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveTwitterConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
      return;
    }

    setIsBusy(true);

    try {
      await axios.post(
        '/api/twitter-config',
        {
          authToken: twitterConfig.authToken,
          ct0: twitterConfig.ct0,
          backupAuthToken: twitterConfig.backupAuthToken,
          backupCt0: twitterConfig.backupCt0,
        },
        { headers: authHeaders },
      );
      showNotice('success', 'Twitter credentials saved.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to save Twitter credentials.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveAiConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
      return;
    }

    setIsBusy(true);

    try {
      await axios.post(
        '/api/ai-config',
        {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          baseUrl: aiConfig.baseUrl,
        },
        { headers: authHeaders },
      );
      showNotice('success', 'AI settings saved.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to save AI settings.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportConfig = async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<Blob>('/api/config/export', {
        headers: authHeaders,
        responseType: 'blob',
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `tweets-2-bsky-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      showNotice('success', 'Configuration exported.');
    } catch (error) {
      handleAuthFailure(error, 'Failed to export configuration.');
    }
  };

  const handleImportConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!authHeaders) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const confirmed = window.confirm(
      'This will overwrite accounts/settings (except user logins). Continue with import?',
    );

    if (!confirmed) {
      event.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      await axios.post('/api/config/import', json, { headers: authHeaders });
      showNotice('success', 'Configuration imported.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to import configuration.');
    } finally {
      event.target.value = '';
    }
  };

  const handleRunUpdate = async () => {
    if (!authHeaders || !isAdmin) {
      return;
    }

    const confirmed = window.confirm(
      'Run ./update.sh now? The service may restart automatically after update completes.',
    );
    if (!confirmed) {
      return;
    }

    setIsUpdateBusy(true);
    try {
      const response = await axios.post<{ message?: string }>('/api/update', {}, { headers: authHeaders });
      showNotice('info', response.data?.message || 'Update started. Service may restart soon.');
      await Promise.all([fetchRuntimeVersion(), fetchUpdateStatus()]);
    } catch (error) {
      handleAuthFailure(error, 'Failed to start update.');
    } finally {
      setIsUpdateBusy(false);
    }
  };

  const beginEditUser = (user: ManagedUser) => {
    setEditingUserId(user.id);
    setEditingUserForm({
      username: user.username || '',
      email: user.email || '',
      password: '',
      isAdmin: user.isAdmin,
      permissions: normalizePermissions(user.permissions),
    });
  };

  const resetEditingUser = () => {
    setEditingUserId(null);
    setEditingUserForm(defaultUserForm());
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders || !isAdmin) {
      return;
    }

    const username = normalizeUsername(newUserForm.username);
    const email = normalizeEmail(newUserForm.email);
    if (!username && !email) {
      showNotice('error', 'Provide at least a username or email.');
      return;
    }
    if (!newUserForm.password || newUserForm.password.length < 8) {
      showNotice('error', 'Password must be at least 8 characters.');
      return;
    }

    setIsBusy(true);
    try {
      await axios.post(
        '/api/admin/users',
        {
          username: username || undefined,
          email: email || undefined,
          password: newUserForm.password,
          isAdmin: newUserForm.isAdmin,
          permissions: newUserForm.permissions,
        },
        { headers: authHeaders },
      );
      setNewUserForm(defaultUserForm());
      showNotice('success', 'User account created.');
      await fetchManagedUsers();
    } catch (error) {
      handleAuthFailure(error, 'Failed to create user.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveEditedUser = async (userId: string) => {
    if (!authHeaders || !isAdmin) {
      return;
    }

    const username = normalizeUsername(editingUserForm.username);
    const email = normalizeEmail(editingUserForm.email);
    if (!username && !email) {
      showNotice('error', 'Provide at least a username or email.');
      return;
    }

    setIsBusy(true);
    try {
      await axios.put(
        `/api/admin/users/${userId}`,
        {
          username: username || undefined,
          email: email || undefined,
          isAdmin: editingUserForm.isAdmin,
          permissions: editingUserForm.permissions,
        },
        { headers: authHeaders },
      );
      showNotice('success', 'User updated.');
      resetEditingUser();
      await Promise.all([fetchManagedUsers(), fetchData()]);
    } catch (error) {
      handleAuthFailure(error, 'Failed to update user.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    if (!authHeaders || !isAdmin) {
      return;
    }

    const newPassword = window.prompt('Enter a new password (min 8 chars):');
    if (!newPassword) {
      return;
    }
    if (newPassword.length < 8) {
      showNotice('error', 'Password must be at least 8 characters.');
      return;
    }

    setIsBusy(true);
    try {
      await axios.post(
        `/api/admin/users/${userId}/reset-password`,
        {
          newPassword,
        },
        { headers: authHeaders },
      );
      showNotice('success', 'Password reset.');
    } catch (error) {
      handleAuthFailure(error, 'Failed to reset password.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteUser = async (user: ManagedUser) => {
    if (!authHeaders || !isAdmin) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${user.username || user.email || user.id}? Their mapped accounts will be disabled.`,
    );
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    try {
      await axios.delete(`/api/admin/users/${user.id}`, { headers: authHeaders });
      showNotice('success', 'User deleted and owned mappings disabled.');
      if (accountsCreatorFilter === user.id) {
        setAccountsCreatorFilter('all');
      }
      await Promise.all([fetchManagedUsers(), fetchData()]);
    } catch (error) {
      handleAuthFailure(error, 'Failed to delete user.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleChangeOwnEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
      return;
    }

    if (!emailForm.newEmail.trim() || !emailForm.password || (hasCurrentEmail && !emailForm.currentEmail.trim())) {
      showNotice('error', hasCurrentEmail ? 'Fill in current email, new email, and password.' : 'Fill in new email and password.');
      return;
    }

    setIsBusy(true);
    try {
      const response = await axios.post<{ token?: string; me?: AuthUser }>(
        '/api/me/change-email',
        {
          currentEmail: emailForm.currentEmail,
          newEmail: emailForm.newEmail,
          password: emailForm.password,
        },
        { headers: authHeaders },
      );

      if (response.data?.token) {
        localStorage.setItem('token', response.data.token);
        setToken(response.data.token);
      }
      if (response.data?.me) {
        setMe({
          ...response.data.me,
          permissions: normalizePermissions(response.data.me.permissions),
        });
      }
      setEmailForm((previous) => ({
        currentEmail: previous.newEmail,
        newEmail: '',
        password: '',
      }));
      showNotice('success', 'Email updated.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to update email.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleChangeOwnPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      showNotice('error', 'Complete all password fields.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showNotice('error', 'New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showNotice('error', 'New password and confirmation do not match.');
      return;
    }

    setIsBusy(true);
    try {
      await axios.post(
        '/api/me/change-password',
        {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        },
        { headers: authHeaders },
      );
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showNotice('success', 'Password updated.');
    } catch (error) {
      handleAuthFailure(error, 'Failed to update password.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md animate-slide-up border-border/80 bg-card/95">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Tweets-2-Bsky</CardTitle>
            <CardDescription>
              {authView === 'login'
                ? 'Sign in to manage mappings, status, and account settings.'
                : 'Create your first dashboard account.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authError ? (
              <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
                {authError}
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={authView === 'login' ? handleLogin : handleRegister}>
              {authView === 'login' ? (
                <div className="space-y-2">
                  <Label htmlFor="identifier">Email or Username</Label>
                  <Input id="identifier" name="identifier" autoComplete="username" required />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input id="username" name="username" autoComplete="username" placeholder="optional" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" autoComplete="email" placeholder="optional" />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>

              <Button className="w-full" type="submit" disabled={isBusy}>
                {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {authView === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </form>

            {bootstrapOpen || authView === 'register' ? (
              <Button
                className="mt-4 w-full"
                variant="ghost"
                onClick={() => {
                  setAuthError('');
                  setAuthView(authView === 'login' ? 'register' : 'login');
                }}
                type="button"
              >
                {authView === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
              </Button>
            ) : (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Account creation is disabled. Ask an admin to create your user.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 animate-slide-up">
        <Card className="border-border/80 bg-card/90">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Dashboard</p>
              <h1 className="text-xl font-semibold sm:text-2xl">Tweets-2-Bsky Control Panel</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Next run in <span className="font-mono text-foreground">{countdown}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Version <span className="font-mono text-foreground">{runtimeVersionLabel}</span>
                {runtimeBranchLabel ? <span className="ml-2">{runtimeBranchLabel}</span> : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={cycleThemeMode} title={themeLabel}>
                {themeIcon}
                <span className="ml-2 hidden sm:inline">{themeLabel}</span>
              </Button>
              {canCreateMappings ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveTab('settings');
                    openAddAccountSheet();
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add account
                </Button>
              ) : null}
              <Button size="sm" onClick={runNow} disabled={!canRunNowPermission}>
                <Play className="mr-2 h-4 w-4" />
                Run now
              </Button>
              {isAdmin && pendingBackfills.length > 0 ? (
                <Button size="sm" variant="destructive" onClick={clearAllBackfills}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear queue
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {notice ? (
        <div
          className={cn(
            'mb-5 animate-pop-in rounded-md border px-4 py-2 text-sm',
            notice.tone === 'success' &&
              'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300',
            notice.tone === 'error' &&
              'border-red-500/40 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300',
            notice.tone === 'info' && 'border-border bg-muted text-muted-foreground',
          )}
        >
          {notice.message}
        </div>
      ) : null}

      {currentStatus && currentStatus.state !== 'idle' ? (
        <Card className="mb-6 animate-fade-in border-border/80">
          <div className="h-1 overflow-hidden rounded-t-xl bg-muted">
            <div
              className={cn(
                'h-full transition-all duration-300',
                currentStatus.state === 'backfilling' ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              style={{ width: `${progressPercent || 100}%` }}
            />
          </div>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{formatState(currentStatus.state)} in progress</p>
              <p className="text-sm text-muted-foreground">
                {currentStatus.currentAccount ? `@${currentStatus.currentAccount} • ` : ''}
                {currentStatus.message || 'Working through account queue.'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">{progressPercent || 0}%</p>
              <p className="text-xs text-muted-foreground">
                {(currentStatus.processedCount || 0).toLocaleString()} /{' '}
                {(currentStatus.totalCount || 0).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 animate-fade-in overflow-x-auto pb-1">
        <div className="inline-flex min-w-full gap-2 rounded-xl border border-border/70 bg-card/90 p-2 sm:min-w-0">
          {dashboardTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={cn(
                  'inline-flex h-11 min-w-[8rem] touch-manipulation items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[transform,background-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none motion-safe:hover:-translate-y-0.5',
                  isActive
                    ? 'bg-foreground text-background shadow-sm'
                    : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm',
                )}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'overview' ? (
        <section className="space-y-6 animate-fade-in">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="animate-slide-up">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Mapped Accounts</p>
                <p className="mt-2 text-2xl font-semibold">{mappings.length}</p>
              </CardContent>
            </Card>
            <Card className="animate-slide-up">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Backfill Queue</p>
                <p className="mt-2 text-2xl font-semibold">{pendingBackfills.length}</p>
              </CardContent>
            </Card>
            <Card className="animate-slide-up">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current State</p>
                <p className="mt-2 text-2xl font-semibold">{formatState(currentStatus?.state || 'idle')}</p>
              </CardContent>
            </Card>
            <Card className="animate-slide-up">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest Activity</p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {latestActivity?.created_at
                    ? new Date(latestActivity.created_at).toLocaleString()
                    : 'No activity yet'}
                </p>
              </CardContent>
            </Card>
            <Card className="animate-slide-up">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Top Account (Engagement)</p>
                {topAccount ? (
                  <div className="mt-2 flex items-center gap-3">
                    {topAccountProfile?.avatar ? (
                      <img
                        className="h-9 w-9 rounded-full border border-border/70 object-cover"
                        src={topAccountProfile.avatar}
                        alt={topAccountProfile.handle || topAccount.identifier}
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground">
                        <UserRound className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        @{topAccountProfile?.handle || topAccount.identifier}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatCompactNumber(topAccount.score)} interactions • {topAccount.posts} posts
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No engagement data yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="animate-slide-up">
            <CardHeader>
              <CardTitle>Quick Navigation</CardTitle>
              <CardDescription>Use tabs to focus one workflow at a time, especially on mobile.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              {dashboardTabs
                .filter((tab) => tab.id !== 'overview')
                .map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button key={`overview-${tab.id}`} variant="outline" onClick={() => setActiveTab(tab.id)}>
                      <Icon className="mr-2 h-4 w-4" />
                      Open {tab.label}
                    </Button>
                  );
                })}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === 'accounts' ? (
        <section className="space-y-6 animate-fade-in">
          <Card className="animate-slide-up">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle>Active Accounts</CardTitle>
                  <CardDescription>Organize mappings into folders and collapse/expand groups.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {canCreateMappings ? (
                    <Button size="sm" variant="outline" onClick={openAddAccountSheet}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add account
                    </Button>
                  ) : null}
                  <Badge variant="outline">{accountMappingsForView.length} configured</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {canManageGroupsPermission ? (
                <form
                  className="rounded-lg border border-border/70 bg-muted/30 p-3"
                  onSubmit={(event) => {
                    void handleCreateGroup(event);
                  }}
                >
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Create Folder
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1 space-y-1">
                      <Label htmlFor="accounts-group-name">Folder name</Label>
                      <Input
                        id="accounts-group-name"
                        value={newGroupName}
                        onChange={(event) => setNewGroupName(event.target.value)}
                        placeholder="Gaming, News, Sports..."
                      />
                    </div>
                    <div className="w-20 space-y-1">
                      <Label htmlFor="accounts-group-emoji">Emoji</Label>
                      <Input
                        id="accounts-group-emoji"
                        value={newGroupEmoji}
                        onChange={(event) => setNewGroupEmoji(event.target.value)}
                        placeholder="📁"
                        maxLength={8}
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={isBusy || newGroupName.trim().length === 0}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create
                    </Button>
                  </div>
                </form>
              ) : null}

              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor="accounts-search">Search accounts</Label>
                  <Input
                    id="accounts-search"
                    value={accountsSearchQuery}
                    onChange={(event) => setAccountsSearchQuery(event.target.value)}
                    placeholder="Find by @username, owner, Bluesky handle, or folder"
                  />
                  {normalizedAccountsQuery ? (
                    <p className="text-xs text-muted-foreground">
                      {accountMatchesCount} result{accountMatchesCount === 1 ? '' : 's'} ranked by relevance
                    </p>
                  ) : null}
                  {isAdmin ? (
                    <div className="mt-2 space-y-1">
                      <Label htmlFor="accounts-creator-filter">Created by user</Label>
                      <select
                        id="accounts-creator-filter"
                        className={cn(selectClassName, 'h-9 text-xs')}
                        value={accountsCreatorFilter}
                        onChange={(event) => setAccountsCreatorFilter(event.target.value)}
                      >
                        <option value="all">All users</option>
                        {managedUsers.map((user) => (
                          <option key={`creator-filter-${user.id}`} value={user.id}>
                            {user.username || user.email || user.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-end justify-end gap-2">
                  {accountsViewMode === 'grouped' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={toggleCollapseAllGroups}
                      disabled={groupKeysForCollapse.length === 0}
                    >
                      {allGroupsCollapsed ? 'Expand all' : 'Collapse all'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAccountsViewMode((previous) => (previous === 'grouped' ? 'global' : 'grouped'))}
                  >
                    {accountsViewMode === 'grouped' ? 'View all' : 'Grouped view'}
                  </Button>
                </div>
              </div>

              {filteredGroupedMappings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                  {normalizedAccountsQuery ? 'No accounts matched this search.' : 'No mappings yet.'}
                  {canCreateMappings ? (
                    <div className="mt-3">
                      <Button size="sm" variant="outline" onClick={openAddAccountSheet}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create your first account
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGroupedMappings.map((group, groupIndex) => {
                    const canCollapseGroup = accountsViewMode === 'grouped';
                    const collapsed = canCollapseGroup ? collapsedGroupKeys[group.key] === true : false;

                    return (
                      <div
                        key={group.key}
                        className="overflow-hidden rounded-lg border border-border/70 bg-card/70 animate-slide-up [animation-fill-mode:both]"
                        style={{ animationDelay: `${Math.min(groupIndex * 45, 220)}ms` }}
                      >
                        <button
                          className={cn(
                            'group flex w-full items-center justify-between bg-muted/40 px-3 py-2 text-left transition-[background-color,padding] duration-200',
                            canCollapseGroup ? 'hover:bg-muted/70' : '',
                          )}
                          onClick={() => {
                            if (canCollapseGroup) {
                              toggleGroupCollapsed(group.key);
                            }
                          }}
                          type="button"
                        >
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-muted-foreground" />
                            <span className="text-base">{group.emoji}</span>
                            <span className="font-medium">{group.name}</span>
                            <Badge variant="outline">{group.mappings.length}</Badge>
                          </div>
                          {canCollapseGroup ? (
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform duration-200 motion-reduce:transition-none',
                                collapsed ? '-rotate-90' : 'rotate-0',
                              )}
                            />
                          ) : null}
                        </button>

                        <div
                          className={cn(
                            'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
                            collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
                          )}
                        >
                          <div className="min-h-0 overflow-hidden">
                            {group.mappings.length === 0 ? (
                              <div className="border-t border-border/60 p-4 text-sm text-muted-foreground">
                                No accounts in this folder yet.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-sm">
                                  <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                      <th className="px-2 py-3">Owner</th>
                                      {isAdmin ? <th className="px-2 py-3">Created By</th> : null}
                                      <th className="px-2 py-3">Twitter Sources</th>
                                      <th className="px-2 py-3">Bluesky Target</th>
                                      <th className="px-2 py-3">Status</th>
                                      <th className="px-2 py-3 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.mappings.map((mapping) => {
                                      const queued = isBackfillQueued(mapping.id);
                                      const active = isBackfillActive(mapping.id);
                                      const queuePosition = getBackfillEntry(mapping.id)?.position;
                                      const profile = getProfileForActor(mapping.bskyIdentifier);
                                      const profileHandle = profile?.handle || mapping.bskyIdentifier;
                                      const profileName = profile?.displayName || profileHandle;
                                      const mappingGroup = getMappingGroupMeta(mapping);

                                      return (
                                        <tr
                                          key={mapping.id}
                                          className="interactive-row border-b border-border/60 last:border-0"
                                        >
                                          <td className="px-2 py-3 align-top">
                                            <div className="flex items-center gap-2 font-medium">
                                              <UserRound className="h-4 w-4 text-muted-foreground" />
                                              {mapping.owner || 'System'}
                                            </div>
                                          </td>
                                          {isAdmin ? (
                                            <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                                              {mapping.createdByLabel ||
                                                mapping.createdByUser?.username ||
                                                mapping.createdByUser?.email ||
                                                '--'}
                                            </td>
                                          ) : null}
                                          <td className="px-2 py-3 align-top">
                                            <div className="flex flex-wrap gap-2">
                                              {mapping.twitterUsernames.map((username) => (
                                                <Badge key={username} variant="secondary">
                                                  @{username}
                                                </Badge>
                                              ))}
                                            </div>
                                          </td>
                                          <td className="px-2 py-3 align-top">
                                            <div className="flex items-center gap-2">
                                              {profile?.avatar ? (
                                                <img
                                                  className="h-8 w-8 rounded-full border border-border/70 object-cover"
                                                  src={profile.avatar}
                                                  alt={profileName}
                                                  loading="lazy"
                                                />
                                              ) : (
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground">
                                                  <UserRound className="h-4 w-4" />
                                                </div>
                                              )}
                                              <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">{profileName}</p>
                                                <p className="truncate font-mono text-xs text-muted-foreground">
                                                  {profileHandle}
                                                </p>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-2 py-3 align-top">
                                            {active ? (
                                              <Badge variant="warning">Backfilling</Badge>
                                            ) : queued ? (
                                              <Badge variant="warning">
                                                Queued {queuePosition ? `#${queuePosition}` : ''}
                                              </Badge>
                                            ) : (
                                              <Badge variant="success">Active</Badge>
                                            )}
                                          </td>
                                          <td className="px-2 py-3 align-top">
                                            <div className="flex flex-wrap justify-end gap-1">
                                              <select
                                                className={cn(selectClassName, 'h-9 w-44 px-2 py-1 text-xs')}
                                                value={mappingGroup.key}
                                                disabled={!canManageMapping(mapping) || !canManageGroupsPermission}
                                                onChange={(event) => {
                                                  void handleAssignMappingGroup(mapping, event.target.value);
                                                }}
                                              >
                                                <option value={DEFAULT_GROUP_KEY}>
                                                  {DEFAULT_GROUP_EMOJI} {DEFAULT_GROUP_NAME}
                                                </option>
                                                {groupOptions
                                                  .filter((option) => option.key !== DEFAULT_GROUP_KEY)
                                                  .map((option) => (
                                                    <option
                                                      key={`group-move-${mapping.id}-${option.key}`}
                                                      value={option.key}
                                                    >
                                                      {option.emoji} {option.name}
                                                    </option>
                                                  ))}
                                              </select>
                                              {canManageMapping(mapping) ? (
                                                <>
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => startEditMapping(mapping)}
                                                  >
                                                    Edit
                                                  </Button>
                                                  {canQueueBackfillsPermission ? (
                                                    <>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                          void requestBackfill(mapping.id, 'normal');
                                                        }}
                                                      >
                                                        Add to queue
                                                      </Button>
                                                      {queued && !active ? (
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          onClick={() => {
                                                            void cancelQueuedBackfill(mapping.id);
                                                          }}
                                                        >
                                                          Cancel queue
                                                        </Button>
                                                      ) : null}
                                                      {isAdmin ? (
                                                        <Button
                                                          variant="subtle"
                                                          size="sm"
                                                          onClick={() => {
                                                            void requestBackfill(mapping.id, 'reset');
                                                          }}
                                                        >
                                                          Reset + Backfill
                                                        </Button>
                                                      ) : null}
                                                    </>
                                                  ) : null}
                                                  {isAdmin ? (
                                                    <Button
                                                      variant="destructive"
                                                      size="sm"
                                                      onClick={() => {
                                                        void handleDeleteAllPosts(mapping.id);
                                                      }}
                                                    >
                                                      Delete Posts
                                                    </Button>
                                                  ) : null}
                                                </>
                                              ) : null}
                                              {canManageMapping(mapping) ? (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => {
                                                    void handleDeleteMapping(mapping.id);
                                                  }}
                                                >
                                                  <Trash2 className="mr-1 h-4 w-4" />
                                                  Remove
                                                </Button>
                                              ) : null}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {canManageGroupsPermission ? (
            <Card className="animate-slide-up">
              <CardHeader className="pb-3">
                <CardTitle>Group Manager</CardTitle>
                <CardDescription>Edit folder names/emojis or delete a group.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {reusableGroupOptions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    No custom folders yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reusableGroupOptions.map((group) => {
                      const draft = groupDraftsByKey[group.key] || { name: group.name, emoji: group.emoji };
                      return (
                        <div
                          key={`group-manager-${group.key}`}
                          className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 md:grid-cols-[90px_minmax(0,1fr)_auto_auto]"
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`group-manager-emoji-${group.key}`}>Emoji</Label>
                            <Input
                              id={`group-manager-emoji-${group.key}`}
                              value={draft.emoji}
                              onChange={(event) => updateGroupDraft(group.key, 'emoji', event.target.value)}
                              maxLength={8}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`group-manager-name-${group.key}`}>Name</Label>
                            <Input
                              id={`group-manager-name-${group.key}`}
                              value={draft.name}
                              onChange={(event) => updateGroupDraft(group.key, 'name', event.target.value)}
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="self-end"
                            disabled={isGroupActionBusy || !draft.name.trim()}
                            onClick={() => {
                              void handleRenameGroup(group.key);
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="self-end text-red-600 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200"
                            disabled={isGroupActionBusy}
                            onClick={() => {
                              void handleDeleteGroup(group.key);
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Deleting a folder keeps mappings intact and moves them to {DEFAULT_GROUP_NAME}.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'posts' ? (
        <section className="space-y-6 animate-fade-in">
          <Card className="animate-slide-up">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Already Posted</CardTitle>
                  <CardDescription>
                    Native-styled feed plus local SQLite search across all crossposted history.
                  </CardDescription>
                </div>
                <div className="grid w-full gap-2 md:max-w-2xl md:grid-cols-[1fr_240px]">
                  <div className="space-y-1">
                    <Label htmlFor="posts-search">Search crossposted posts</Label>
                    <div className="relative">
                      <Input
                        id="posts-search"
                        value={postsSearchQuery}
                        onChange={(event) => setPostsSearchQuery(event.target.value)}
                        placeholder="Search by text, @username, tweet id, or Bluesky handle"
                      />
                      {isSearchingLocalPosts ? (
                        <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="posts-group-filter">Filter group</Label>
                    <select
                      id="posts-group-filter"
                      className={selectClassName}
                      value={postsGroupFilter}
                      onChange={(event) => setPostsGroupFilter(event.target.value)}
                    >
                      <option value="all">All folders</option>
                      {groupOptions.map((group) => (
                        <option key={`posts-filter-${group.key}`} value={group.key}>
                          {group.emoji} {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {postsSearchQuery.trim() ? (
                filteredLocalPostSearchResults.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                    {isSearchingLocalPosts ? 'Searching local history...' : 'No local crossposted posts matched.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredLocalPostSearchResults.map((post) => {
                      const mapping = resolveMappingForLocalPost(post);
                      const groupMeta = getMappingGroupMeta(mapping);
                      const sourceTweetUrl = post.twitterUrl || getTwitterPostUrl(post.twitterUsername, post.twitterId);
                      const postUrl =
                        post.postUrl ||
                        (post.bskyUri
                          ? `https://bsky.app/profile/${post.bskyIdentifier}/post/${
                              post.bskyUri.split('/').filter(Boolean).pop() || ''
                            }`
                          : undefined);

                      return (
                        <article
                          key={`${post.twitterId}-${post.bskyIdentifier}-${post.bskyCid || post.createdAt || 'result'}`}
                          className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                @{post.bskyIdentifier}{' '}
                                <span className="text-muted-foreground">from @{post.twitterUsername}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {post.createdAt ? new Date(post.createdAt).toLocaleString() : 'Unknown time'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {groupMeta.emoji} {groupMeta.name}
                              </Badge>
                              <Badge variant="secondary">Relevance {Math.round(post.score)}</Badge>
                            </div>
                          </div>
                          <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {post.tweetText || 'No local tweet text stored for this record.'}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-mono">Tweet ID: {post.twitterId}</span>
                            {sourceTweetUrl ? (
                              <a
                                className="inline-flex items-center text-foreground underline-offset-4 hover:underline"
                                href={sourceTweetUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                              </a>
                            ) : null}
                            {postUrl ? (
                              <a
                                className="inline-flex items-center text-foreground underline-offset-4 hover:underline"
                                href={postUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Bluesky
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                              </a>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : filteredPostedActivity.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                  No posted entries yet.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filteredPostedActivity.map((post, index) => {
                    const postUrl =
                      post.postUrl ||
                      (post.bskyUri
                        ? `https://bsky.app/profile/${post.bskyIdentifier}/post/${
                            post.bskyUri.split('/').filter(Boolean).pop() || ''
                          }`
                        : undefined);
                    const sourceTweetUrl = post.twitterUrl || getTwitterPostUrl(post.twitterUsername, post.twitterId);
                    const segments = buildFacetSegments(post.text, post.facets || []);
                    const mapping = resolveMappingForPost(post);
                    const groupMeta = getMappingGroupMeta(mapping);
                    const statItems: Array<{
                      key: 'likes' | 'reposts' | 'replies' | 'quotes';
                      value: number;
                      icon: typeof Heart;
                    }> = [
                      { key: 'likes', value: post.stats.likes, icon: Heart },
                      { key: 'reposts', value: post.stats.reposts, icon: Repeat2 },
                      { key: 'replies', value: post.stats.replies, icon: MessageCircle },
                      { key: 'quotes', value: post.stats.quotes, icon: Quote },
                    ].filter((item) => item.value > 0);
                    const authorAvatar = post.author.avatar || getProfileForActor(post.author.handle)?.avatar;
                    const authorHandle = post.author.handle || post.bskyIdentifier;
                    const authorName = post.author.displayName || authorHandle;

                    return (
                      <article
                        key={post.bskyUri || `${post.bskyCid || 'post'}-${post.createdAt || index}`}
                        className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out motion-reduce:transition-none motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-md animate-slide-up [animation-fill-mode:both]"
                        style={{ animationDelay: `${Math.min(index * 45, 260)}ms` }}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {authorAvatar ? (
                              <img
                                className="h-9 w-9 rounded-full border border-border/70 object-cover"
                                src={authorAvatar}
                                alt={authorName}
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground">
                                <UserRound className="h-4 w-4" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-semibold">{authorName}</p>
                              <p className="text-xs text-muted-foreground">
                                @{authorHandle} • from @{post.twitterUsername}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {groupMeta.emoji} {groupMeta.name}
                            </Badge>
                            <Badge variant="success">Posted</Badge>
                          </div>
                        </div>

                        <p className="mb-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                          {segments.map((segment, segmentIndex) => {
                            if (segment.type === 'text') {
                              return <span key={`${post.bskyUri}-segment-${segmentIndex}`}>{segment.text}</span>;
                            }

                            const linkTone =
                              segment.type === 'mention'
                                ? 'text-cyan-600 hover:text-cyan-500 dark:text-cyan-300 dark:hover:text-cyan-200'
                                : segment.type === 'tag'
                                  ? 'text-indigo-600 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200'
                                  : 'text-sky-600 hover:text-sky-500 dark:text-sky-300 dark:hover:text-sky-200';

                            return (
                              <a
                                key={`${post.bskyUri}-segment-${segmentIndex}`}
                                className={cn(
                                  'underline decoration-transparent transition hover:decoration-current',
                                  linkTone,
                                )}
                                href={segment.href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {segment.text}
                              </a>
                            );
                          })}
                        </p>

                        {post.media.length > 0 ? (
                          <div className="mb-3 space-y-2">
                            {post.media.map((media, mediaIndex) => {
                              if (media.type === 'image') {
                                const imageSrc = media.url || media.thumb;
                                if (!imageSrc) return null;
                                return (
                                  <a
                                    key={`${post.bskyUri}-media-${mediaIndex}`}
                                    className="group block overflow-hidden rounded-lg border border-border/70 bg-muted"
                                    href={imageSrc}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <img
                                      className="h-56 w-full object-cover transition-transform duration-300 ease-out motion-reduce:transition-none motion-safe:group-hover:scale-[1.02]"
                                      src={imageSrc}
                                      alt={media.alt || 'Bluesky media'}
                                      loading="lazy"
                                    />
                                  </a>
                                );
                              }

                              if (media.type === 'video') {
                                const videoHref = media.url || media.thumb;
                                return (
                                  <div
                                    key={`${post.bskyUri}-media-${mediaIndex}`}
                                    className="group overflow-hidden rounded-lg border border-border/70 bg-muted"
                                  >
                                    {media.thumb ? (
                                      <img
                                        className="h-56 w-full object-cover transition-transform duration-300 ease-out motion-reduce:transition-none motion-safe:group-hover:scale-[1.02]"
                                        src={media.thumb}
                                        alt={media.alt || 'Video thumbnail'}
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                                        Video attachment
                                      </div>
                                    )}
                                    {videoHref ? (
                                      <div className="border-t border-border/70 p-2 text-right">
                                        <a
                                          className="inline-flex items-center text-xs text-foreground underline-offset-4 hover:underline"
                                          href={videoHref}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Open video
                                          <ArrowUpRight className="ml-1 h-3 w-3" />
                                        </a>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              }

                              if (media.type === 'external') {
                                if (!media.url) return null;
                                return (
                                  <a
                                    key={`${post.bskyUri}-media-${mediaIndex}`}
                                    className="group block overflow-hidden rounded-lg border border-border/70 bg-background transition-colors hover:bg-muted/60"
                                    href={media.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {media.thumb ? (
                                      <img
                                        className="h-40 w-full object-cover transition-transform duration-300 ease-out motion-reduce:transition-none motion-safe:group-hover:scale-[1.02]"
                                        src={media.thumb}
                                        alt={media.title || media.url}
                                        loading="lazy"
                                      />
                                    ) : null}
                                    <div className="space-y-1 p-3">
                                      <p className="truncate text-sm font-medium">{media.title || media.url}</p>
                                      {media.description ? (
                                        <p className="max-h-10 overflow-hidden text-xs text-muted-foreground">
                                          {media.description}
                                        </p>
                                      ) : null}
                                    </div>
                                  </a>
                                );
                              }

                              return null;
                            })}
                          </div>
                        ) : null}

                        {statItems.length > 0 ? (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {statItems.map((stat) => {
                              const Icon = stat.icon;
                              return (
                                <span
                                  key={`${post.bskyUri}-stat-${stat.key}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-1 text-xs text-muted-foreground"
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  {formatCompactNumber(stat.value)}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}

                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{post.createdAt ? new Date(post.createdAt).toLocaleString() : 'Unknown time'}</span>
                          <div className="flex items-center gap-3">
                            {sourceTweetUrl ? (
                              <a
                                className="inline-flex items-center text-foreground underline-offset-4 hover:underline"
                                href={sourceTweetUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                              </a>
                            ) : null}
                            {postUrl ? (
                              <a
                                className="inline-flex items-center text-foreground underline-offset-4 hover:underline"
                                href={postUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Bluesky
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                              </a>
                            ) : (
                              <span>Missing URI</span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === 'activity' ? (
        <section className="space-y-6 animate-fade-in">
          <Card className="animate-slide-up">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Recent Activity
                  </CardTitle>
                  <CardDescription>Latest migration outcomes from the processing database.</CardDescription>
                </div>
                <div className="w-full max-w-xs">
                  <Label htmlFor="activity-group-filter">Filter group</Label>
                  <select
                    id="activity-group-filter"
                    className={selectClassName}
                    value={activityGroupFilter}
                    onChange={(event) => setActivityGroupFilter(event.target.value)}
                  >
                    <option value="all">All folders</option>
                    {groupOptions.map((group) => (
                      <option key={`activity-filter-${group.key}`} value={group.key}>
                        {group.emoji} {group.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-3">Time</th>
                      <th className="px-2 py-3">Twitter User</th>
                      <th className="px-2 py-3">Group</th>
                      <th className="px-2 py-3">Status</th>
                      <th className="px-2 py-3">Details</th>
                      <th className="px-2 py-3 text-right">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecentActivity.map((activity, index) => {
                      const href = getBskyPostUrl(activity);
                      const sourceTweetUrl = getTwitterPostUrl(activity.twitter_username, activity.twitter_id);
                      const mapping = resolveMappingForActivity(activity);
                      const groupMeta = getMappingGroupMeta(mapping);

                      return (
                        <tr
                          key={`${activity.twitter_id}-${activity.created_at || index}`}
                          className="interactive-row border-b border-border/60 last:border-0"
                        >
                          <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                            {activity.created_at
                              ? new Date(activity.created_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '--'}
                          </td>
                          <td className="px-2 py-3 align-top font-medium">@{activity.twitter_username}</td>
                          <td className="px-2 py-3 align-top">
                            <Badge variant="outline">
                              {groupMeta.emoji} {groupMeta.name}
                            </Badge>
                          </td>
                          <td className="px-2 py-3 align-top">
                            {activity.status === 'migrated' ? (
                              <Badge variant="success">Migrated</Badge>
                            ) : activity.status === 'skipped' ? (
                              <Badge variant="outline">Skipped</Badge>
                            ) : (
                              <Badge variant="danger">Failed</Badge>
                            )}
                          </td>
                          <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                            <div className="max-w-[340px] truncate">
                              {activity.tweet_text || `Tweet ID: ${activity.twitter_id}`}
                            </div>
                          </td>
                          <td className="px-2 py-3 align-top text-right">
                            <div className="flex flex-col items-end gap-1">
                              {sourceTweetUrl ? (
                                <a
                                  className="inline-flex items-center text-xs text-foreground underline-offset-4 hover:underline"
                                  href={sourceTweetUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Source
                                  <ArrowUpRight className="ml-1 h-3 w-3" />
                                </a>
                              ) : null}
                              {href ? (
                                <a
                                  className="inline-flex items-center text-xs text-foreground underline-offset-4 hover:underline"
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Bluesky
                                  <ArrowUpRight className="ml-1 h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRecentActivity.length === 0 ? (
                      <tr>
                        <td className="px-2 py-6 text-center text-sm text-muted-foreground" colSpan={6}>
                          No activity for this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === 'settings' ? (
        <section className="space-y-6 animate-fade-in">
          <Card className="animate-slide-up">
            <button
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              onClick={() => toggleSettingsSection('account')}
              type="button"
            >
              <div>
                <p className="text-sm font-semibold">Account Security</p>
                <p className="text-xs text-muted-foreground">Update your own email/password with verification.</p>
              </div>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-200',
                  isSettingsSectionExpanded('account') ? 'rotate-0' : '-rotate-90',
                )}
              />
            </button>
            <div
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                isSettingsSectionExpanded('account') ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <CardContent className="grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-2">
                  <form className="space-y-3" onSubmit={handleChangeOwnEmail}>
                    <p className="text-sm font-semibold">Change Email</p>
                    <div className="space-y-2">
                      <Label htmlFor="account-current-email">Current Email</Label>
                      <Input
                        id="account-current-email"
                        type="email"
                        value={emailForm.currentEmail}
                        onChange={(event) => {
                          setEmailForm((previous) => ({ ...previous, currentEmail: event.target.value }));
                        }}
                        placeholder={hasCurrentEmail ? undefined : 'No current email on this account'}
                        required={hasCurrentEmail}
                        disabled={!hasCurrentEmail}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-new-email">New Email</Label>
                      <Input
                        id="account-new-email"
                        type="email"
                        value={emailForm.newEmail}
                        onChange={(event) => {
                          setEmailForm((previous) => ({ ...previous, newEmail: event.target.value }));
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-email-password">Current Password</Label>
                      <Input
                        id="account-email-password"
                        type="password"
                        value={emailForm.password}
                        onChange={(event) => {
                          setEmailForm((previous) => ({ ...previous, password: event.target.value }));
                        }}
                        required
                      />
                    </div>
                    <Button className="w-full sm:w-auto" size="sm" type="submit" disabled={isBusy}>
                      <Save className="mr-2 h-4 w-4" />
                      Save Email
                    </Button>
                  </form>

                  <form className="space-y-3" onSubmit={handleChangeOwnPassword}>
                    <p className="text-sm font-semibold">Change Password</p>
                    <div className="space-y-2">
                      <Label htmlFor="account-current-password">Current Password</Label>
                      <Input
                        id="account-current-password"
                        type="password"
                        value={passwordForm.currentPassword}
                        onChange={(event) => {
                          setPasswordForm((previous) => ({ ...previous, currentPassword: event.target.value }));
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-new-password">New Password</Label>
                      <Input
                        id="account-new-password"
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) => {
                          setPasswordForm((previous) => ({ ...previous, newPassword: event.target.value }));
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-confirm-password">Confirm New Password</Label>
                      <Input
                        id="account-confirm-password"
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) => {
                          setPasswordForm((previous) => ({ ...previous, confirmPassword: event.target.value }));
                        }}
                        required
                      />
                    </div>
                    <Button className="w-full sm:w-auto" size="sm" type="submit" disabled={isBusy}>
                      <Save className="mr-2 h-4 w-4" />
                      Save Password
                    </Button>
                  </form>
                </CardContent>
              </div>
            </div>
          </Card>

          {isAdmin ? (
            <>
              <Card className="animate-slide-up">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Admin Settings
                  </CardTitle>
                  <CardDescription>Configured sections stay collapsed so adding accounts is one click.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">Running Version</p>
                        <p className="font-mono text-sm text-foreground">{runtimeVersionLabel}</p>
                        {runtimeBranchLabel ? (
                          <p className="text-xs text-muted-foreground">{runtimeBranchLabel}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">{updateStateLabel}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            void handleRunUpdate();
                          }}
                          disabled={isUpdateBusy || updateStatus?.running}
                        >
                          {isUpdateBusy || updateStatus?.running ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          {updateStatus?.running ? 'Updating...' : 'Update'}
                        </Button>
                        {canCreateMappings ? (
                          <Button className="w-full sm:w-auto" onClick={openAddAccountSheet}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Account
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {updateStatus?.logTail && updateStatus.logTail.length > 0 ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          Update log
                        </summary>
                        <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {updateStatus.logTail.join('\n')}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="animate-slide-up">
                <button
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  onClick={() => toggleSettingsSection('users')}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-semibold">User Access Manager</p>
                    <p className="text-xs text-muted-foreground">Create users and control what they can see/manage.</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 transition-transform duration-200',
                      isSettingsSectionExpanded('users') ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                    isSettingsSectionExpanded('users') ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <CardContent className="space-y-4 border-t border-border/70 pt-4">
                      <form
                        className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3"
                        onSubmit={handleCreateUser}
                      >
                        <p className="text-sm font-semibold">Create User</p>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="new-user-username">Username</Label>
                            <Input
                              id="new-user-username"
                              value={newUserForm.username}
                              onChange={(event) => {
                                setNewUserForm((previous) => ({ ...previous, username: event.target.value }));
                              }}
                              placeholder="operator"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="new-user-email">Email</Label>
                            <Input
                              id="new-user-email"
                              type="email"
                              value={newUserForm.email}
                              onChange={(event) => {
                                setNewUserForm((previous) => ({ ...previous, email: event.target.value }));
                              }}
                              placeholder="operator@example.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="new-user-password">Password</Label>
                            <Input
                              id="new-user-password"
                              type="password"
                              value={newUserForm.password}
                              onChange={(event) => {
                                setNewUserForm((previous) => ({ ...previous, password: event.target.value }));
                              }}
                              placeholder="Minimum 8 characters"
                              required
                            />
                          </div>
                        </div>

                        <label className="inline-flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={newUserForm.isAdmin}
                            onChange={(event) => {
                              setNewUserForm((previous) => ({
                                ...previous,
                                isAdmin: event.target.checked,
                              }));
                            }}
                          />
                          Make admin
                        </label>

                        {!newUserForm.isAdmin ? (
                          <div className="grid gap-2 md:grid-cols-2">
                            {PERMISSION_OPTIONS.map((permission) => (
                              <label
                                key={`new-user-permission-${permission.key}`}
                                className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-xs"
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{permission.label}</span>
                                  <input
                                    type="checkbox"
                                    checked={newUserForm.permissions[permission.key]}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setNewUserForm((previous) => ({
                                        ...previous,
                                        permissions: {
                                          ...previous.permissions,
                                          [permission.key]: checked,
                                        },
                                      }));
                                    }}
                                  />
                                </span>
                                <span className="mt-1 block text-muted-foreground">{permission.help}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Admins always get full access.</p>
                        )}

                        <Button size="sm" type="submit" disabled={isBusy}>
                          <Plus className="mr-2 h-4 w-4" />
                          Create user
                        </Button>
                      </form>

                      {managedUsers.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                          No user accounts created yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {managedUsers.map((user) => {
                            const isEditing = editingUserId === user.id;
                            const displayName = user.username || user.email || user.id;
                            return (
                              <div
                                key={`managed-user-${user.id}`}
                                className="rounded-lg border border-border/70 bg-card/60 p-3"
                              >
                                {isEditing ? (
                                  <div className="space-y-3">
                                    <div className="grid gap-3 md:grid-cols-2">
                                      <div className="space-y-1">
                                        <Label htmlFor={`edit-user-username-${user.id}`}>Username</Label>
                                        <Input
                                          id={`edit-user-username-${user.id}`}
                                          value={editingUserForm.username}
                                          onChange={(event) => {
                                            setEditingUserForm((previous) => ({
                                              ...previous,
                                              username: event.target.value,
                                            }));
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label htmlFor={`edit-user-email-${user.id}`}>Email</Label>
                                        <Input
                                          id={`edit-user-email-${user.id}`}
                                          type="email"
                                          value={editingUserForm.email}
                                          onChange={(event) => {
                                            setEditingUserForm((previous) => ({
                                              ...previous,
                                              email: event.target.value,
                                            }));
                                          }}
                                        />
                                      </div>
                                    </div>

                                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                                      <input
                                        type="checkbox"
                                        checked={editingUserForm.isAdmin}
                                        onChange={(event) => {
                                          setEditingUserForm((previous) => ({
                                            ...previous,
                                            isAdmin: event.target.checked,
                                          }));
                                        }}
                                      />
                                      Admin access
                                    </label>

                                    {!editingUserForm.isAdmin ? (
                                      <div className="grid gap-2 md:grid-cols-2">
                                        {PERMISSION_OPTIONS.map((permission) => (
                                          <label
                                            key={`edit-user-permission-${user.id}-${permission.key}`}
                                            className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-xs"
                                          >
                                            <span className="flex items-center justify-between gap-2">
                                              <span className="font-medium">{permission.label}</span>
                                              <input
                                                type="checkbox"
                                                checked={editingUserForm.permissions[permission.key]}
                                                onChange={(event) => {
                                                  const checked = event.target.checked;
                                                  setEditingUserForm((previous) => ({
                                                    ...previous,
                                                    permissions: {
                                                      ...previous.permissions,
                                                      [permission.key]: checked,
                                                    },
                                                  }));
                                                }}
                                              />
                                            </span>
                                            <span className="mt-1 block text-muted-foreground">{permission.help}</span>
                                          </label>
                                        ))}
                                      </div>
                                    ) : null}

                                    <div className="flex flex-wrap justify-end gap-2">
                                      <Button size="sm" variant="ghost" onClick={resetEditingUser} type="button">
                                        Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          void handleSaveEditedUser(user.id);
                                        }}
                                        type="button"
                                        disabled={isBusy}
                                      >
                                        Save user
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="space-y-1">
                                        <p className="text-sm font-semibold">{displayName}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {user.email ? `Email: ${user.email}` : 'No email set'}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {user.mappingCount} mappings ({user.activeMappingCount} active)
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <Badge variant={user.isAdmin ? 'success' : 'outline'}>
                                          {user.isAdmin ? 'Admin' : 'User'}
                                        </Badge>
                                        {user.id === me?.id ? <Badge variant="secondary">You</Badge> : null}
                                      </div>
                                    </div>

                                    {!user.isAdmin ? (
                                      <div className="flex flex-wrap gap-2">
                                        {PERMISSION_OPTIONS.filter(
                                          (permission) => user.permissions[permission.key],
                                        ).map((permission) => (
                                          <Badge key={`user-perm-${user.id}-${permission.key}`} variant="outline">
                                            {permission.label}
                                          </Badge>
                                        ))}
                                      </div>
                                    ) : null}

                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setAccountsCreatorFilter(user.id);
                                          setActiveTab('accounts');
                                        }}
                                      >
                                        View Accounts
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => beginEditUser(user)}>
                                        Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          void handleResetUserPassword(user.id);
                                        }}
                                      >
                                        Reset Password
                                      </Button>
                                      {user.id !== me?.id ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="text-red-600 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200"
                                          onClick={() => {
                                            void handleDeleteUser(user);
                                          }}
                                        >
                                          Delete
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </div>
                </div>
              </Card>

              <Card className="animate-slide-up">
                <button
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  onClick={() => toggleSettingsSection('twitter')}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-semibold">Twitter Credentials</p>
                    <p className="text-xs text-muted-foreground">Primary and backup cookie values.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={twitterConfigured ? 'success' : 'outline'}>
                      {twitterConfigured ? 'Configured' : 'Missing'}
                    </Badge>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        isSettingsSectionExpanded('twitter') ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                  </div>
                </button>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                    isSettingsSectionExpanded('twitter') ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <CardContent className="space-y-3 border-t border-border/70 pt-4">
                      <form className="space-y-3" onSubmit={handleSaveTwitterConfig}>
                        <div className="space-y-2">
                          <Label htmlFor="authToken">Primary Auth Token</Label>
                          <Input
                            id="authToken"
                            value={twitterConfig.authToken}
                            onChange={(event) => {
                              setTwitterConfig((prev) => ({ ...prev, authToken: event.target.value }));
                            }}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ct0">Primary CT0</Label>
                          <Input
                            id="ct0"
                            value={twitterConfig.ct0}
                            onChange={(event) => {
                              setTwitterConfig((prev) => ({ ...prev, ct0: event.target.value }));
                            }}
                            required
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="backupAuthToken">Backup Auth Token</Label>
                            <Input
                              id="backupAuthToken"
                              value={twitterConfig.backupAuthToken || ''}
                              onChange={(event) => {
                                setTwitterConfig((prev) => ({ ...prev, backupAuthToken: event.target.value }));
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="backupCt0">Backup CT0</Label>
                            <Input
                              id="backupCt0"
                              value={twitterConfig.backupCt0 || ''}
                              onChange={(event) => {
                                setTwitterConfig((prev) => ({ ...prev, backupCt0: event.target.value }));
                              }}
                            />
                          </div>
                        </div>

                        <Button className="w-full sm:w-auto" size="sm" type="submit" disabled={isBusy}>
                          <Save className="mr-2 h-4 w-4" />
                          Save Twitter Credentials
                        </Button>
                      </form>
                    </CardContent>
                  </div>
                </div>
              </Card>

              <Card className="animate-slide-up">
                <button
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  onClick={() => toggleSettingsSection('ai')}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-semibold">AI Settings</p>
                    <p className="text-xs text-muted-foreground">Optional enrichment and rewrite provider config.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={aiConfigured ? 'success' : 'outline'}>
                      {aiConfigured ? 'Configured' : 'Optional'}
                    </Badge>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        isSettingsSectionExpanded('ai') ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                  </div>
                </button>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                    isSettingsSectionExpanded('ai') ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <CardContent className="space-y-3 border-t border-border/70 pt-4">
                      <form className="space-y-3" onSubmit={handleSaveAiConfig}>
                        <div className="space-y-2">
                          <Label htmlFor="provider">Provider</Label>
                          <select
                            className={selectClassName}
                            id="provider"
                            value={aiConfig.provider}
                            onChange={(event) => {
                              setAiConfig((prev) => ({
                                ...prev,
                                provider: event.target.value as AIConfig['provider'],
                              }));
                            }}
                          >
                            <option value="gemini">Google Gemini</option>
                            <option value="openai">OpenAI / OpenRouter</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="custom">Custom</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="apiKey">API Key</Label>
                          <Input
                            id="apiKey"
                            type="password"
                            value={aiConfig.apiKey || ''}
                            onChange={(event) => {
                              setAiConfig((prev) => ({ ...prev, apiKey: event.target.value }));
                            }}
                          />
                        </div>
                        {aiConfig.provider !== 'gemini' ? (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="model">Model ID</Label>
                              <Input
                                id="model"
                                value={aiConfig.model || ''}
                                onChange={(event) => {
                                  setAiConfig((prev) => ({ ...prev, model: event.target.value }));
                                }}
                                placeholder="gpt-4o"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="baseUrl">Base URL</Label>
                              <Input
                                id="baseUrl"
                                value={aiConfig.baseUrl || ''}
                                onChange={(event) => {
                                  setAiConfig((prev) => ({ ...prev, baseUrl: event.target.value }));
                                }}
                                placeholder="https://api.example.com/v1"
                              />
                            </div>
                          </>
                        ) : null}

                        <Button className="w-full sm:w-auto" size="sm" type="submit" disabled={isBusy}>
                          <Bot className="mr-2 h-4 w-4" />
                          Save AI Settings
                        </Button>
                      </form>
                    </CardContent>
                  </div>
                </div>
              </Card>

              <Card className="animate-slide-up">
                <button
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  onClick={() => toggleSettingsSection('data')}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-semibold">Data Management</p>
                    <p className="text-xs text-muted-foreground">Export/import mappings and provider settings.</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 transition-transform duration-200',
                      isSettingsSectionExpanded('data') ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                    isSettingsSectionExpanded('data') ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <CardContent className="space-y-3 border-t border-border/70 pt-4">
                      <Button className="w-full sm:w-auto" variant="outline" onClick={handleExportConfig}>
                        <Download className="mr-2 h-4 w-4" />
                        Export configuration
                      </Button>
                      <input
                        ref={importInputRef}
                        className="hidden"
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) => {
                          void handleImportConfig(event);
                        }}
                      />
                      <Button
                        className="w-full sm:w-auto"
                        variant="outline"
                        onClick={() => {
                          importInputRef.current?.click();
                        }}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Import configuration
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Imports preserve dashboard users and passwords while replacing mappings, provider keys, and
                        scheduler settings.
                      </p>
                    </CardContent>
                  </div>
                </div>
              </Card>
            </>
          ) : (
            <Card className="animate-slide-up">
              <CardHeader>
                <CardTitle>Access Scope</CardTitle>
                <CardDescription>Your current account permissions.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {PERMISSION_OPTIONS.filter((permission) => effectivePermissions[permission.key]).map((permission) => (
                  <Badge key={`self-perm-${permission.key}`} variant="outline">
                    {permission.label}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </section>
      ) : null}
      {isAddAccountSheetOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-stretch sm:justify-end"
          onClick={closeAddAccountSheet}
        >
          <aside
            className="flex h-[95vh] w-full max-w-xl flex-col rounded-t-2xl border border-border/80 bg-card shadow-2xl sm:h-full sm:rounded-none sm:rounded-l-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border/70 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Add Account</p>
                <h2 className="text-lg font-semibold">Create Crosspost Mapping</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={closeAddAccountSheet} aria-label="Close add account flow">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b border-border/70 px-5 py-3">
              <div className="flex items-center gap-2">
                {ADD_ACCOUNT_STEPS.map((label, index) => {
                  const step = index + 1;
                  const active = step === addAccountStep;
                  const complete = step < addAccountStep;
                  return (
                    <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                      <div
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                          complete && 'border-foreground bg-foreground text-background',
                          active && 'border-foreground text-foreground',
                          !active && !complete && 'border-border text-muted-foreground',
                        )}
                      >
                        {step}
                      </div>
                      <span
                        className={cn(
                          'truncate text-xs',
                          active ? 'text-foreground' : complete ? 'text-foreground/90' : 'text-muted-foreground',
                        )}
                      >
                        {label}
                      </span>
                      {step < ADD_ACCOUNT_STEP_COUNT ? <div className="h-px flex-1 bg-border/70" /> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {addAccountStep === 1 ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Who owns this mapping?</p>
                    <p className="text-xs text-muted-foreground">Set a label so account rows stay easy to scan.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-account-owner">Owner</Label>
                    <Input
                      id="add-account-owner"
                      value={newMapping.owner}
                      onChange={(event) => {
                        setNewMapping((previous) => ({ ...previous, owner: event.target.value }));
                      }}
                      placeholder="jack"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Use Existing Folder (Optional)</Label>
                    {reusableGroupOptions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                        No folders yet. Create one below or from the Accounts tab.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {reusableGroupOptions.map((group) => {
                          const selected = getGroupKey(newMapping.groupName) === group.key;
                          return (
                            <button
                              key={`preset-group-${group.key}`}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors',
                                selected
                                  ? 'border-foreground bg-foreground text-background'
                                  : 'border-border bg-background text-foreground hover:bg-muted',
                              )}
                              onClick={() => applyGroupPresetToNewMapping(group.key)}
                              type="button"
                            >
                              <span>{group.emoji}</span>
                              <span>{group.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <Label htmlFor="add-account-group-name">Folder / Group Name (Optional)</Label>
                      <Input
                        id="add-account-group-name"
                        value={newMapping.groupName}
                        onChange={(event) => {
                          setNewMapping((previous) => ({ ...previous, groupName: event.target.value }));
                        }}
                        placeholder="Gaming, News, Sports..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="add-account-group-emoji">Emoji</Label>
                      <Input
                        id="add-account-group-emoji"
                        value={newMapping.groupEmoji}
                        onChange={(event) => {
                          setNewMapping((previous) => ({ ...previous, groupEmoji: event.target.value }));
                        }}
                        maxLength={8}
                        placeholder={DEFAULT_GROUP_EMOJI}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {addAccountStep === 2 ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Choose Twitter sources</p>
                    <p className="text-xs text-muted-foreground">
                      Add one or many usernames. Press Enter or comma to add quickly.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-account-twitter-usernames">Twitter Usernames</Label>
                    <div className="flex gap-2">
                      <Input
                        id="add-account-twitter-usernames"
                        value={newTwitterInput}
                        onChange={(event) => {
                          setNewTwitterInput(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault();
                            addNewTwitterUsername();
                          }
                        }}
                        placeholder="@accountname"
                      />
                      <Button
                        variant="outline"
                        type="button"
                        disabled={normalizeTwitterUsername(newTwitterInput).length === 0}
                        onClick={addNewTwitterUsername}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                  <div className="flex min-h-7 flex-wrap gap-2">
                    {newTwitterUsers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No source usernames added yet.</p>
                    ) : (
                      newTwitterUsers.map((username) => (
                        <Badge key={`new-${username}`} variant="secondary" className="gap-1 pr-1">
                          @{username}
                          <button
                            type="button"
                            className="rounded-full px-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                            onClick={() => removeNewTwitterUsername(username)}
                            aria-label={`Remove @${username}`}
                          >
                            ×
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {addAccountStep === 3 ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Target Bluesky account</p>
                    <p className="text-xs text-muted-foreground">Use an app password for the destination account.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-account-bsky-identifier">Bluesky Identifier</Label>
                    <Input
                      id="add-account-bsky-identifier"
                      value={newMapping.bskyIdentifier}
                      onChange={(event) => {
                        setNewMapping((previous) => ({ ...previous, bskyIdentifier: event.target.value }));
                      }}
                      placeholder="example.bsky.social"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-account-bsky-password">Bluesky App Password</Label>
                    <Input
                      id="add-account-bsky-password"
                      type="password"
                      value={newMapping.bskyPassword}
                      onChange={(event) => {
                        setNewMapping((previous) => ({ ...previous, bskyPassword: event.target.value }));
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-account-bsky-url">Bluesky Service URL</Label>
                    <Input
                      id="add-account-bsky-url"
                      value={newMapping.bskyServiceUrl}
                      onChange={(event) => {
                        setNewMapping((previous) => ({ ...previous, bskyServiceUrl: event.target.value }));
                      }}
                      placeholder="https://bsky.social"
                    />
                  </div>
                </div>
              ) : null}

              {addAccountStep === 4 ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Review and create</p>
                    <p className="text-xs text-muted-foreground">Confirm details before saving this mapping.</p>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                    <p>
                      <span className="font-medium">Owner:</span> {newMapping.owner || '--'}
                    </p>
                    <p>
                      <span className="font-medium">Twitter Sources:</span>{' '}
                      {newTwitterUsers.length > 0 ? newTwitterUsers.map((username) => `@${username}`).join(', ') : '--'}
                    </p>
                    <p>
                      <span className="font-medium">Bluesky Target:</span> {newMapping.bskyIdentifier || '--'}
                    </p>
                    <p>
                      <span className="font-medium">Folder:</span>{' '}
                      {newMapping.groupName.trim()
                        ? `${newMapping.groupEmoji.trim() || DEFAULT_GROUP_EMOJI} ${newMapping.groupName.trim()}`
                        : `${DEFAULT_GROUP_EMOJI} ${DEFAULT_GROUP_NAME}`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/70 px-5 py-4">
              <Button variant="outline" onClick={retreatAddAccountStep} disabled={addAccountStep === 1 || isBusy}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              {addAccountStep < ADD_ACCOUNT_STEP_COUNT ? (
                <Button onClick={advanceAddAccountStep}>
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void submitNewMapping()} disabled={isBusy}>
                  {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Create Account
                </Button>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {editingMapping ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-xl animate-slide-up border-border/90 bg-card">
            <CardHeader>
              <CardTitle>Edit Mapping</CardTitle>
              <CardDescription>Update ownership, handles, and target credentials.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleUpdateMapping}>
                <div className="space-y-2">
                  <Label htmlFor="edit-owner">Owner</Label>
                  <Input
                    id="edit-owner"
                    value={editForm.owner}
                    onChange={(event) => {
                      setEditForm((prev) => ({ ...prev, owner: event.target.value }));
                    }}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="edit-groupName">Folder / Group Name</Label>
                    <Input
                      id="edit-groupName"
                      value={editForm.groupName}
                      onChange={(event) => {
                        setEditForm((prev) => ({ ...prev, groupName: event.target.value }));
                      }}
                      placeholder="Gaming, News, Sports..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-groupEmoji">Emoji</Label>
                    <Input
                      id="edit-groupEmoji"
                      value={editForm.groupEmoji}
                      onChange={(event) => {
                        setEditForm((prev) => ({ ...prev, groupEmoji: event.target.value }));
                      }}
                      placeholder="📁"
                      maxLength={8}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-twitterUsernames">Twitter Usernames</Label>
                  <div className="flex gap-2">
                    <Input
                      id="edit-twitterUsernames"
                      value={editTwitterInput}
                      onChange={(event) => {
                        setEditTwitterInput(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          addEditTwitterUsername();
                        }
                      }}
                      placeholder="@accountname"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={normalizeTwitterUsername(editTwitterInput).length === 0}
                      onClick={addEditTwitterUsername}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="flex min-h-7 flex-wrap gap-2">
                    {editTwitterUsers.map((username) => (
                      <Badge key={`edit-${username}`} variant="secondary" className="gap-1 pr-1">
                        @{username}
                        <button
                          type="button"
                          className="rounded-full px-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                          onClick={() => removeEditTwitterUsername(username)}
                          aria-label={`Remove @${username}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-bskyIdentifier">Bluesky Identifier</Label>
                  <Input
                    id="edit-bskyIdentifier"
                    value={editForm.bskyIdentifier}
                    onChange={(event) => {
                      setEditForm((prev) => ({ ...prev, bskyIdentifier: event.target.value }));
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-bskyPassword">New App Password (optional)</Label>
                  <Input
                    id="edit-bskyPassword"
                    type="password"
                    value={editForm.bskyPassword}
                    onChange={(event) => {
                      setEditForm((prev) => ({ ...prev, bskyPassword: event.target.value }));
                    }}
                    placeholder="Leave blank to keep existing"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-bskyServiceUrl">Service URL</Label>
                  <Input
                    id="edit-bskyServiceUrl"
                    value={editForm.bskyServiceUrl}
                    onChange={(event) => {
                      setEditForm((prev) => ({ ...prev, bskyServiceUrl: event.target.value }));
                    }}
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditingMapping(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isBusy}>
                    {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

export default App;
