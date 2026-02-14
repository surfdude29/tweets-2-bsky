import axios from 'axios';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChevronDown,
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
  Repeat2,
  Save,
  Settings2,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  UserRound,
  Users,
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

type AppState = 'idle' | 'checking' | 'backfilling' | 'pacing' | 'processing';

interface AccountMapping {
  id: string;
  twitterUsernames: string[];
  bskyIdentifier: string;
  bskyPassword: string;
  bskyServiceUrl?: string;
  enabled: boolean;
  owner?: string;
  groupName?: string;
  groupEmoji?: string;
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

interface AuthUser {
  email: string;
  isAdmin: boolean;
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

const defaultMappingForm = (): MappingFormState => ({
  owner: '',
  bskyIdentifier: '',
  bskyPassword: '',
  bskyServiceUrl: 'https://bsky.social',
  groupName: '',
  groupEmoji: '📁',
});

const DEFAULT_GROUP_NAME = 'Ungrouped';
const DEFAULT_GROUP_EMOJI = '📁';

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

function getMappingGroupMeta(mapping?: Pick<AccountMapping, 'groupName' | 'groupEmoji'>) {
  const name = normalizeGroupName(mapping?.groupName);
  const emoji = normalizeGroupEmoji(mapping?.groupEmoji);
  const key = `${name.toLowerCase()}::${emoji}`;
  return { key, name, emoji };
}

function getTwitterPostUrl(twitterUsername?: string, twitterId?: string): string | undefined {
  if (!twitterUsername || !twitterId) {
    return undefined;
  }
  return `https://x.com/${normalizeTwitterUsername(twitterUsername)}/status/${twitterId}`;
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
      segments.push({ type: 'tag', text: rawText, href: `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}` });
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme-mode');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    return 'system';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [enrichedPosts, setEnrichedPosts] = useState<EnrichedPost[]>([]);
  const [profilesByActor, setProfilesByActor] = useState<Record<string, BskyProfileView>>({});
  const [twitterConfig, setTwitterConfig] = useState<TwitterConfig>({ authToken: '', ct0: '' });
  const [aiConfig, setAiConfig] = useState<AIConfig>({ provider: 'gemini', apiKey: '', model: '', baseUrl: '' });
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [countdown, setCountdown] = useState('--');
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
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
  const [postsGroupFilter, setPostsGroupFilter] = useState('all');
  const [activityGroupFilter, setActivityGroupFilter] = useState('all');
  const [notice, setNotice] = useState<Notice | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const noticeTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = me?.isAdmin ?? false;
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
    setEnrichedPosts([]);
    setProfilesByActor({});
    setStatus(null);
    setRecentActivity([]);
    setEditingMapping(null);
    setNewTwitterUsers([]);
    setEditTwitterUsers([]);
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

  const fetchStatus = useCallback(async () => {
    if (!authHeaders) {
      return;
    }

    try {
      const response = await axios.get<StatusResponse>('/api/status', { headers: authHeaders });
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
      const [meResponse, mappingsResponse] = await Promise.all([
        axios.get<AuthUser>('/api/me', { headers: authHeaders }),
        axios.get<AccountMapping[]>('/api/mappings', { headers: authHeaders }),
      ]);

      const profile = meResponse.data;
      const mappingData = mappingsResponse.data;
      setMe(profile);
      setMappings(mappingData);

      if (profile.isAdmin) {
        const [twitterResponse, aiResponse] = await Promise.all([
          axios.get<TwitterConfig>('/api/twitter-config', { headers: authHeaders }),
          axios.get<AIConfig>('/api/ai-config', { headers: authHeaders }),
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
    localStorage.setItem('accounts-collapsed-groups', JSON.stringify(collapsedGroupKeys));
  }, [collapsedGroupKeys]);

  useEffect(() => {
    if (!isAdmin && activeTab === 'settings') {
      setActiveTab('overview');
    }
  }, [activeTab, isAdmin]);

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
      return;
    }

    void fetchData();
  }, [token, fetchData]);

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

  const pendingBackfills = status?.pendingBackfills ?? [];
  const currentStatus = status?.currentStatus;
  const latestActivity = recentActivity[0];
  const dashboardTabs = useMemo(
    () =>
      [
        { id: 'overview' as DashboardTab, label: 'Overview', icon: LayoutDashboard },
        { id: 'accounts' as DashboardTab, label: 'Accounts', icon: Users },
        { id: 'posts' as DashboardTab, label: 'Posts', icon: Newspaper },
        { id: 'activity' as DashboardTab, label: 'Activity', icon: History },
        { id: 'settings' as DashboardTab, label: 'Settings', icon: Settings2, adminOnly: true },
      ].filter((tab) => (tab.adminOnly ? isAdmin : true)),
    [isAdmin],
  );
  const postedActivity = useMemo(
    () => enrichedPosts.slice(0, 12),
    [enrichedPosts],
  );
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
    for (const mapping of mappings) {
      const group = getMappingGroupMeta(mapping);
      if (!options.has(group.key)) {
        options.set(group.key, group);
      }
    }
    return [...options.values()].sort((a, b) => {
      const aUngrouped = a.name === DEFAULT_GROUP_NAME;
      const bUngrouped = b.name === DEFAULT_GROUP_NAME;
      if (aUngrouped && !bUngrouped) return 1;
      if (!aUngrouped && bUngrouped) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [mappings]);
  const groupedMappings = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; emoji: string; mappings: AccountMapping[] }>();
    for (const mapping of mappings) {
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
  }, [mappings]);
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
  const filteredRecentActivity = useMemo(
    () =>
      recentActivity.filter((activity) => {
        if (activityGroupFilter === 'all') return true;
        const mapping = resolveMappingForActivity(activity);
        return getMappingGroupMeta(mapping).key === activityGroupFilter;
      }),
    [activityGroupFilter, recentActivity, resolveMappingForActivity],
  );

  useEffect(() => {
    if (postsGroupFilter !== 'all' && !groupOptions.some((group) => group.key === postsGroupFilter)) {
      setPostsGroupFilter('all');
    }
    if (activityGroupFilter !== 'all' && !groupOptions.some((group) => group.key === activityGroupFilter)) {
      setActivityGroupFilter('all');
    }
  }, [activityGroupFilter, groupOptions, postsGroupFilter]);

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
    themeMode === 'system' ? <SunMoon className="h-4 w-4" /> : themeMode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />;

  const themeLabel =
    themeMode === 'system' ? `Theme: system (${resolvedTheme})` : `Theme: ${themeMode}`;

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setIsBusy(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');

    try {
      const response = await axios.post<{ token: string }>('/api/login', { email, password });
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
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');

    try {
      await axios.post('/api/register', { email, password });
      setAuthView('login');
      showNotice('success', 'Registration successful. Please log in.');
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

    try {
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
      await axios.post('/api/backfill/clear-all', {}, { headers: authHeaders });
      showNotice('success', 'Backfill queue cleared.');
      await fetchStatus();
    } catch (error) {
      handleAuthFailure(error, 'Failed to clear backfill queue.');
    }
  };

  const requestBackfill = async (mappingId: string, mode: 'normal' | 'reset') => {
    if (!authHeaders) {
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

    const limitInput = window.prompt(`How many tweets should be backfilled for this account?`, '15');
    if (limitInput === null) {
      return;
    }

    const limit = Number.parseInt(limitInput, 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 15;

    try {
      if (mode === 'reset') {
        await axios.delete(`/api/mappings/${mappingId}/cache`, { headers: authHeaders });
      }

      await axios.post(`/api/backfill/${mappingId}`, { limit: safeLimit }, { headers: authHeaders });
      showNotice('success', mode === 'reset' ? 'Cache reset and backfill queued.' : 'Backfill queued.');
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

  const handleAddMapping = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authHeaders) {
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
      showNotice('success', 'Account mapping added.');
      await fetchData();
    } catch (error) {
      handleAuthFailure(error, 'Failed to add account mapping.');
    } finally {
      setIsBusy(false);
    }
  };

  const startEditMapping = (mapping: AccountMapping) => {
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
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>

              <Button className="w-full" type="submit" disabled={isBusy}>
                {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {authView === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </form>

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
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={cycleThemeMode} title={themeLabel}>
                {themeIcon}
                <span className="ml-2 hidden sm:inline">{themeLabel}</span>
              </Button>
              <Button size="sm" onClick={runNow}>
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
            notice.tone === 'info' &&
              'border-border bg-muted text-muted-foreground',
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
                {(currentStatus.processedCount || 0).toLocaleString()} / {(currentStatus.totalCount || 0).toLocaleString()}
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
                  {latestActivity?.created_at ? new Date(latestActivity.created_at).toLocaleString() : 'No activity yet'}
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
                <Badge variant="outline">{mappings.length} configured</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {mappings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                  No mappings yet. Add one from the settings panel.
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedMappings.map((group, groupIndex) => {
                    const collapsed = collapsedGroupKeys[group.key] === true;

                    return (
                      <div
                        key={group.key}
                        className="overflow-hidden rounded-lg border border-border/70 bg-card/70 animate-slide-up [animation-fill-mode:both]"
                        style={{ animationDelay: `${Math.min(groupIndex * 45, 220)}ms` }}
                      >
                        <button
                          className="group flex w-full items-center justify-between bg-muted/40 px-3 py-2 text-left transition-[background-color,padding] duration-200 hover:bg-muted/70"
                          onClick={() => toggleGroupCollapsed(group.key)}
                          type="button"
                        >
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-muted-foreground" />
                            <span className="text-base">{group.emoji}</span>
                            <span className="font-medium">{group.name}</span>
                            <Badge variant="outline">{group.mappings.length}</Badge>
                          </div>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform duration-200 motion-reduce:transition-none',
                              collapsed ? '-rotate-90' : 'rotate-0',
                            )}
                          />
                        </button>

                        <div
                          className={cn(
                            'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
                            collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
                          )}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-3">Owner</th>
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

                                  return (
                                    <tr key={mapping.id} className="interactive-row border-b border-border/60 last:border-0">
                                      <td className="px-2 py-3 align-top">
                                        <div className="flex items-center gap-2 font-medium">
                                          <UserRound className="h-4 w-4 text-muted-foreground" />
                                          {mapping.owner || 'System'}
                                        </div>
                                      </td>
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
                                            <p className="truncate font-mono text-xs text-muted-foreground">{profileHandle}</p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-2 py-3 align-top">
                                        {active ? (
                                          <Badge variant="warning">Backfilling</Badge>
                                        ) : queued ? (
                                          <Badge variant="warning">Queued {queuePosition ? `#${queuePosition}` : ''}</Badge>
                                        ) : (
                                          <Badge variant="success">Active</Badge>
                                        )}
                                      </td>
                                      <td className="px-2 py-3 align-top">
                                        <div className="flex flex-wrap justify-end gap-1">
                                          {isAdmin ? (
                                            <>
                                              <Button variant="outline" size="sm" onClick={() => startEditMapping(mapping)}>
                                                Edit
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  void requestBackfill(mapping.id, 'normal');
                                                }}
                                              >
                                                Backfill
                                              </Button>
                                              <Button
                                                variant="subtle"
                                                size="sm"
                                                onClick={() => {
                                                  void requestBackfill(mapping.id, 'reset');
                                                }}
                                              >
                                                Reset + Backfill
                                              </Button>
                                              <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => {
                                                  void handleDeleteAllPosts(mapping.id);
                                                }}
                                              >
                                                Delete Posts
                                              </Button>
                                            </>
                                          ) : null}
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
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === 'posts' ? (
        <section className="space-y-6 animate-fade-in">
          <Card className="animate-slide-up">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Already Posted</CardTitle>
                  <CardDescription>Native-styled feed of successfully posted Bluesky entries.</CardDescription>
                </div>
                <div className="w-full max-w-xs">
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
            </CardHeader>
            <CardContent className="pt-0">
              {filteredPostedActivity.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                  No posted entries yet.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filteredPostedActivity.map((post, index) => {
                    const postUrl =
                      post.postUrl ||
                      (post.bskyUri
                        ? `https://bsky.app/profile/${post.bskyIdentifier}/post/${post.bskyUri
                            .split('/')
                            .filter(Boolean)
                            .pop() || ''}`
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
                                className={cn('underline decoration-transparent transition hover:decoration-current', linkTone)}
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
                                      <p className="truncate text-sm font-medium">
                                        {media.title || media.url}
                                      </p>
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
                              ? new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
                            <div className="max-w-[340px] truncate">{activity.tweet_text || `Tweet ID: ${activity.twitter_id}`}</div>
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
        isAdmin ? (
          <section className="space-y-6 animate-fade-in">
            <Card className="animate-slide-up">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Admin Settings
                </CardTitle>
                <CardDescription>Credentials, provider setup, and account onboarding.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <form className="space-y-3" onSubmit={handleSaveTwitterConfig}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Twitter Credentials</h3>
                    <Badge variant={twitterConfig.authToken && twitterConfig.ct0 ? 'success' : 'outline'}>
                      {twitterConfig.authToken && twitterConfig.ct0 ? 'Configured' : 'Missing'}
                    </Badge>
                  </div>
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

                  <Button className="w-full" size="sm" type="submit" disabled={isBusy}>
                    <Save className="mr-2 h-4 w-4" />
                    Save Twitter Credentials
                  </Button>
                </form>

                <form className="space-y-3 border-t border-border pt-6" onSubmit={handleSaveAiConfig}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">AI Settings</h3>
                    <Badge variant={aiConfig.apiKey ? 'success' : 'outline'}>
                      {aiConfig.apiKey ? 'Configured' : 'Optional'}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="provider">Provider</Label>
                    <select
                      className={selectClassName}
                      id="provider"
                      value={aiConfig.provider}
                      onChange={(event) => {
                        setAiConfig((prev) => ({ ...prev, provider: event.target.value as AIConfig['provider'] }));
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

                  <Button className="w-full" size="sm" type="submit" disabled={isBusy}>
                    <Bot className="mr-2 h-4 w-4" />
                    Save AI Settings
                  </Button>
                </form>

                <form className="space-y-3 border-t border-border pt-6" onSubmit={handleAddMapping}>
                  <h3 className="text-sm font-semibold">Add Account Mapping</h3>
                  <div className="space-y-2">
                    <Label htmlFor="owner">Owner</Label>
                    <Input
                      id="owner"
                      value={newMapping.owner}
                      onChange={(event) => {
                        setNewMapping((prev) => ({ ...prev, owner: event.target.value }));
                      }}
                      required
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <Label htmlFor="groupName">Folder / Group Name</Label>
                      <Input
                        id="groupName"
                        value={newMapping.groupName}
                        onChange={(event) => {
                          setNewMapping((prev) => ({ ...prev, groupName: event.target.value }));
                        }}
                        placeholder="Gaming, News, Sports..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="groupEmoji">Emoji</Label>
                      <Input
                        id="groupEmoji"
                        value={newMapping.groupEmoji}
                        onChange={(event) => {
                          setNewMapping((prev) => ({ ...prev, groupEmoji: event.target.value }));
                        }}
                        placeholder="📁"
                        maxLength={8}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="twitterUsernames">Twitter Usernames</Label>
                    <div className="flex gap-2">
                      <Input
                        id="twitterUsernames"
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
                        placeholder="@accountname (press Enter to add)"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={normalizeTwitterUsername(newTwitterInput).length === 0}
                        onClick={addNewTwitterUsername}
                      >
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Press Enter or comma to add multiple handles quickly.</p>
                    <div className="flex min-h-7 flex-wrap gap-2">
                      {newTwitterUsers.map((username) => (
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
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bskyIdentifier">Bluesky Identifier</Label>
                    <Input
                      id="bskyIdentifier"
                      value={newMapping.bskyIdentifier}
                      onChange={(event) => {
                        setNewMapping((prev) => ({ ...prev, bskyIdentifier: event.target.value }));
                      }}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bskyPassword">Bluesky App Password</Label>
                    <Input
                      id="bskyPassword"
                      type="password"
                      value={newMapping.bskyPassword}
                      onChange={(event) => {
                        setNewMapping((prev) => ({ ...prev, bskyPassword: event.target.value }));
                      }}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bskyServiceUrl">Bluesky Service URL</Label>
                    <Input
                      id="bskyServiceUrl"
                      value={newMapping.bskyServiceUrl}
                      onChange={(event) => {
                        setNewMapping((prev) => ({ ...prev, bskyServiceUrl: event.target.value }));
                      }}
                      placeholder="https://bsky.social"
                    />
                  </div>

                  <Button className="w-full" size="sm" type="submit" disabled={isBusy}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Mapping
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="animate-slide-up">
              <CardHeader>
                <CardTitle>Data Management</CardTitle>
                <CardDescription>Export/import account and provider config without login credentials.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" variant="outline" onClick={handleExportConfig}>
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
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    importInputRef.current?.click();
                  }}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Import configuration
                </Button>
                <p className="text-xs text-muted-foreground">
                  Imports preserve dashboard users and passwords while replacing mappings, provider keys, and scheduler
                  settings.
                </p>
              </CardContent>
            </Card>
          </section>
        ) : null
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

      {!isAdmin ? (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Admin-only settings are hidden for this account.
          </p>
        </div>
      ) : null}
    </main>
  );
}

export default App;
