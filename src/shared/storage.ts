import type {
  AppStoreData,
  DeletedGroupTombstone,
  ExtensionSettings,
  SyncAuthState,
  SyncMetadata,
  SyncRestoreMode,
  TabGroup,
  TabItem,
  ThemeMode,
} from './types';

export const STORAGE_KEY = 'autosynctab_store_v1';
export const AUTH_STORAGE_KEY = 'autosynctab_auth_v1';
export const CURRENT_SCHEMA_VERSION = 1;
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOMBSTONES = 300;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  ignorePinnedTabs: true,
  removeOnRestore: true,
  openManagerAfterStash: true,
  deduplicateOnStash: true,
  autoSync: true,
  autoCaptureBookmarks: true,
  theme: 'system',
};

export const DEFAULT_SYNC_METADATA: SyncMetadata = {
  provider: 'google-drive',
  enabled: false,
  lastSyncedAt: null,
  lastSyncedHash: null,
  remoteFileId: null,
  remoteModifiedTime: null,
  accountEmail: null,
};

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultStore(now = Date.now()): AppStoreData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: now,
    groups: [],
    deletedGroups: [],
    settings: { ...DEFAULT_SETTINGS },
    sync: { ...DEFAULT_SYNC_METADATA },
  };
}

function normalizeTheme(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_SETTINGS.theme;
}

function normalizeTabItem(raw: unknown): TabItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) return null;

  const url = candidate.url.trim();
  const title =
    typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : url;

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('tab'),
    url,
    title,
    favIconUrl:
      typeof candidate.favIconUrl === 'string' && candidate.favIconUrl
        ? candidate.favIconUrl
        : undefined,
    pinned: typeof candidate.pinned === 'boolean' ? candidate.pinned : undefined,
  };
}

function normalizeTabGroup(raw: unknown, now: number): TabGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const rawTabs = Array.isArray(candidate.tabs) ? candidate.tabs : [];
  const tabs = rawTabs
    .map((item) => normalizeTabItem(item))
    .filter((item): item is TabItem => item !== null);

  if (tabs.length === 0) return null;

  const createdAt =
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : now;
  const updatedAt =
    typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : createdAt;

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('grp'),
    title: typeof candidate.title === 'string' ? candidate.title.trim() : '',
    createdAt,
    updatedAt,
    locked: Boolean(candidate.locked),
    tabs,
  };
}

export function pruneDeletedGroups(
  tombstones: DeletedGroupTombstone[],
  now = Date.now()
): DeletedGroupTombstone[] {
  const cutoff = now - TOMBSTONE_RETENTION_MS;
  const latestById = new Map<string, number>();

  for (const item of tombstones) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    if (typeof item.deletedAt !== 'number' || !Number.isFinite(item.deletedAt)) continue;
    if (item.deletedAt < cutoff) continue;
    const prev = latestById.get(item.id);
    if (prev === undefined || item.deletedAt > prev) {
      latestById.set(item.id, item.deletedAt);
    }
  }

  return Array.from(latestById.entries())
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_TOMBSTONES);
}

export function mergeDeletedTombstones(
  local: DeletedGroupTombstone[],
  remote: DeletedGroupTombstone[],
  now = Date.now()
): DeletedGroupTombstone[] {
  return pruneDeletedGroups([...local, ...remote], now);
}

function recordGroupDeletion(
  tombstones: DeletedGroupTombstone[],
  groupId: string,
  deletedAt: number
): DeletedGroupTombstone[] {
  return pruneDeletedGroups([...tombstones, { id: groupId, deletedAt }], deletedAt);
}

function removeGroupTombstone(
  tombstones: DeletedGroupTombstone[],
  groupId: string
): DeletedGroupTombstone[] {
  return tombstones.filter((item) => item.id !== groupId);
}

export function normalizeStoreData(raw: unknown, now = Date.now()): AppStoreData {
  if (!raw || typeof raw !== 'object') {
    return createDefaultStore(now);
  }

  const candidate = raw as Record<string, unknown>;
  const rawSettings =
    candidate.settings && typeof candidate.settings === 'object'
      ? (candidate.settings as Partial<ExtensionSettings>)
      : {};
  const rawSync =
    candidate.sync && typeof candidate.sync === 'object'
      ? (candidate.sync as Partial<SyncMetadata>)
      : {};
  const rawGroups = Array.isArray(candidate.groups) ? candidate.groups : [];
  const rawDeleted = Array.isArray(candidate.deletedGroups) ? candidate.deletedGroups : [];

  const groups = rawGroups
    .map((grp) => normalizeTabGroup(grp, now))
    .filter((grp): grp is TabGroup => grp !== null);

  const deletedGroups = pruneDeletedGroups(
    rawDeleted.filter(
      (item): item is DeletedGroupTombstone =>
        Boolean(item) &&
        typeof (item as DeletedGroupTombstone).id === 'string' &&
        typeof (item as DeletedGroupTombstone).deletedAt === 'number'
    ),
    now
  );

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : now,
    groups,
    deletedGroups,
    settings: {
      ignorePinnedTabs:
        typeof rawSettings.ignorePinnedTabs === 'boolean'
          ? rawSettings.ignorePinnedTabs
          : DEFAULT_SETTINGS.ignorePinnedTabs,
      removeOnRestore:
        typeof rawSettings.removeOnRestore === 'boolean'
          ? rawSettings.removeOnRestore
          : DEFAULT_SETTINGS.removeOnRestore,
      openManagerAfterStash:
        typeof rawSettings.openManagerAfterStash === 'boolean'
          ? rawSettings.openManagerAfterStash
          : DEFAULT_SETTINGS.openManagerAfterStash,
      deduplicateOnStash:
        typeof rawSettings.deduplicateOnStash === 'boolean'
          ? rawSettings.deduplicateOnStash
          : DEFAULT_SETTINGS.deduplicateOnStash,
      autoSync:
        typeof rawSettings.autoSync === 'boolean'
          ? rawSettings.autoSync
          : DEFAULT_SETTINGS.autoSync,
      autoCaptureBookmarks:
        typeof rawSettings.autoCaptureBookmarks === 'boolean'
          ? rawSettings.autoCaptureBookmarks
          : DEFAULT_SETTINGS.autoCaptureBookmarks,
      theme: normalizeTheme(rawSettings.theme),
    },
    sync: {
      provider: 'google-drive',
      enabled: Boolean(rawSync.enabled),
      lastSyncedAt:
        typeof rawSync.lastSyncedAt === 'number' && Number.isFinite(rawSync.lastSyncedAt)
          ? rawSync.lastSyncedAt
          : null,
      lastSyncedHash: typeof rawSync.lastSyncedHash === 'string' ? rawSync.lastSyncedHash : null,
      remoteFileId: typeof rawSync.remoteFileId === 'string' ? rawSync.remoteFileId : null,
      remoteModifiedTime:
        typeof rawSync.remoteModifiedTime === 'string' ? rawSync.remoteModifiedTime : null,
      accountEmail: typeof rawSync.accountEmail === 'string' ? rawSync.accountEmail : null,
    },
  };
}

export function hashCanonicalString(canonical: string): string {
  // Dual 32-bit FNV-1a hash for a compact deterministic content fingerprint.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function computeContentDigest(store: Pick<AppStoreData, 'groups' | 'deletedGroups' | 'settings'>): string {
  const canonical = JSON.stringify({
    groups: store.groups.map((g) => ({
      id: g.id,
      title: g.title,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      locked: g.locked,
      tabs: g.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        favIconUrl: t.favIconUrl ?? null,
        pinned: Boolean(t.pinned),
      })),
    })),
    deletedGroups: [...store.deletedGroups]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => ({ id: d.id, deletedAt: d.deletedAt })),
    settings: {
      ignorePinnedTabs: store.settings.ignorePinnedTabs,
      removeOnRestore: store.settings.removeOnRestore,
      openManagerAfterStash: store.settings.openManagerAfterStash,
      deduplicateOnStash: store.settings.deduplicateOnStash,
      autoSync: store.settings.autoSync,
      autoCaptureBookmarks: store.settings.autoCaptureBookmarks,
      theme: store.settings.theme,
    },
  });

  return hashCanonicalString(canonical);
}

export function prependGroup(
  store: AppStoreData,
  tabs: TabItem[],
  title = '',
  now = Date.now()
): { nextStore: AppStoreData; group: TabGroup | null } {
  if (tabs.length === 0) {
    return { nextStore: store, group: null };
  }

  const group: TabGroup = {
    id: createId('grp'),
    title: title.trim(),
    createdAt: now,
    updatedAt: now,
    locked: false,
    tabs,
  };

  return {
    group,
    nextStore: {
      ...store,
      updatedAt: now,
      groups: [group, ...store.groups],
      deletedGroups: removeGroupTombstone(store.deletedGroups, group.id),
    },
  };
}

export function removeTabFromGroup(
  store: AppStoreData,
  groupId: string,
  tabId: string,
  now = Date.now()
): AppStoreData {
  let removedGroup = false;
  let changed = false;

  const nextGroups = store.groups
    .map((group) => {
      if (group.id !== groupId) return group;
      const filteredTabs = group.tabs.filter((tab) => tab.id !== tabId);
      if (filteredTabs.length === group.tabs.length) return group;
      changed = true;
      if (filteredTabs.length === 0) {
        removedGroup = true;
      }
      return {
        ...group,
        updatedAt: now,
        tabs: filteredTabs,
      };
    })
    .filter((group) => group.tabs.length > 0);

  if (!changed) return store;

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
    deletedGroups: removedGroup
      ? recordGroupDeletion(store.deletedGroups, groupId, now)
      : store.deletedGroups,
  };
}

export function removeGroupFromStore(
  store: AppStoreData,
  groupId: string,
  now = Date.now()
): AppStoreData {
  const nextGroups = store.groups.filter((group) => group.id !== groupId);
  if (nextGroups.length === store.groups.length) return store;

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
    deletedGroups: recordGroupDeletion(store.deletedGroups, groupId, now),
  };
}

export function updateGroupInStore(
  store: AppStoreData,
  groupId: string,
  patch: Partial<Pick<TabGroup, 'title' | 'locked'>>,
  now = Date.now()
): AppStoreData {
  let changed = false;
  const nextGroups = store.groups.map((group) => {
    if (group.id !== groupId) return group;
    changed = true;
    return {
      ...group,
      title: typeof patch.title === 'string' ? patch.title.trim() : group.title,
      locked: typeof patch.locked === 'boolean' ? patch.locked : group.locked,
      updatedAt: now,
    };
  });

  if (!changed) return store;
  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
  };
}

export function reorderGroupsInStore(
  store: AppStoreData,
  sourceGroupId: string,
  targetGroupId: string,
  now = Date.now()
): AppStoreData {
  if (sourceGroupId === targetGroupId) return store;
  const sourceIndex = store.groups.findIndex((g) => g.id === sourceGroupId);
  const targetIndex = store.groups.findIndex((g) => g.id === targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0) return store;

  const nextGroups = [...store.groups];
  const [moved] = nextGroups.splice(sourceIndex, 1);
  nextGroups.splice(targetIndex, 0, moved);

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
  };
}

export function moveTabInStore(
  store: AppStoreData,
  sourceGroupId: string,
  tabId: string,
  targetGroupId: string,
  targetTabId?: string,
  position: 'before' | 'after' = 'before',
  now = Date.now()
): AppStoreData {
  const sourceGroup = store.groups.find((g) => g.id === sourceGroupId);
  const targetGroup = store.groups.find((g) => g.id === targetGroupId);
  if (!sourceGroup || !targetGroup) return store;
  if (sourceGroup.locked || targetGroup.locked) return store;

  const sourceTabIndex = sourceGroup.tabs.findIndex((t) => t.id === tabId);
  if (sourceTabIndex < 0) return store;
  const movedTab = sourceGroup.tabs[sourceTabIndex];

  if (sourceGroupId === targetGroupId) {
    if (targetTabId === tabId) return store;
    const remaining = sourceGroup.tabs.filter((t) => t.id !== tabId);
    let insertIndex = remaining.length;
    if (targetTabId) {
      const idx = remaining.findIndex((t) => t.id === targetTabId);
      if (idx >= 0) {
        insertIndex = position === 'after' ? idx + 1 : idx;
      }
    }
    const nextTabs = [...remaining];
    nextTabs.splice(insertIndex, 0, movedTab);

    if (nextTabs.every((t, i) => t.id === sourceGroup.tabs[i]?.id)) {
      return store;
    }

    return {
      ...store,
      updatedAt: now,
      groups: store.groups.map((g) =>
        g.id === sourceGroupId ? { ...g, updatedAt: now, tabs: nextTabs } : g
      ),
    };
  }

  // Cross-group move
  const remainingSourceTabs = sourceGroup.tabs.filter((t) => t.id !== tabId);
  const targetTabs = [...targetGroup.tabs];
  let insertIndex = targetTabs.length;
  if (targetTabId) {
    const idx = targetTabs.findIndex((t) => t.id === targetTabId);
    if (idx >= 0) {
      insertIndex = position === 'after' ? idx + 1 : idx;
    }
  }
  targetTabs.splice(insertIndex, 0, movedTab);

  const nextGroups = store.groups
    .map((g) => {
      if (g.id === sourceGroupId) {
        return { ...g, updatedAt: now, tabs: remainingSourceTabs };
      }
      if (g.id === targetGroupId) {
        return { ...g, updatedAt: now, tabs: targetTabs };
      }
      return g;
    })
    .filter((g) => g.tabs.length > 0);

  const deletedGroups =
    remainingSourceTabs.length === 0
      ? recordGroupDeletion(store.deletedGroups, sourceGroupId, now)
      : store.deletedGroups;

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
    deletedGroups,
  };
}

export function updateSettingsInStore(
  store: AppStoreData,
  patch: Partial<ExtensionSettings>,
  now = Date.now()
): AppStoreData {
  return {
    ...store,
    updatedAt: now,
    settings: {
      ...store.settings,
      ...patch,
    },
  };
}

export function mergeImportedGroups(
  store: AppStoreData,
  importedGroups: TabGroup[],
  mode: 'prepend' | 'replace',
  now = Date.now()
): AppStoreData {
  const freshGroups = importedGroups.map((group) => ({
    ...group,
    id: createId('grp'),
    tabs: group.tabs.map((tab) => ({
      ...tab,
      id: createId('tab'),
    })),
  }));

  const deletedGroups =
    mode === 'replace'
      ? store.groups.reduce(
          (acc, grp) => recordGroupDeletion(acc, grp.id, now),
          store.deletedGroups
        )
      : store.deletedGroups;

  return {
    ...store,
    updatedAt: now,
    groups: mode === 'replace' ? freshGroups : [...freshGroups, ...store.groups],
    deletedGroups,
  };
}

export function updateSyncInStore(
  store: AppStoreData,
  patch: Partial<SyncMetadata>,
  now?: number
): AppStoreData {
  return {
    ...store,
    updatedAt: typeof now === 'number' ? now : store.updatedAt,
    sync: {
      ...store.sync,
      ...patch,
    },
  };
}

export function mergeRemoteGroups(
  localGroups: TabGroup[],
  remoteGroups: TabGroup[]
): TabGroup[] {
  const byId = new Map<string, TabGroup>();

  for (const group of localGroups) {
    byId.set(group.id, group);
  }

  for (const remoteGroup of remoteGroups) {
    const existing = byId.get(remoteGroup.id);
    if (!existing || remoteGroup.updatedAt > existing.updatedAt) {
      byId.set(remoteGroup.id, remoteGroup);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function applyRemoteBackup(
  store: AppStoreData,
  remoteBackup: AppStoreData,
  mode: SyncRestoreMode,
  now = Date.now()
): AppStoreData {
  const nextGroups =
    mode === 'replace'
      ? remoteBackup.groups
      : mergeRemoteGroups(store.groups, remoteBackup.groups);

  const nextDeletedGroups =
    mode === 'replace'
      ? pruneDeletedGroups(remoteBackup.deletedGroups, now)
      : mergeDeletedTombstones(store.deletedGroups, remoteBackup.deletedGroups, now);

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
    deletedGroups: nextDeletedGroups.filter(
      (del) => !nextGroups.some((g) => g.id === del.id && g.updatedAt >= del.deletedAt)
    ),
    settings: mode === 'replace' ? remoteBackup.settings : store.settings,
  };
}

export const DEFAULT_GOOGLE_CLIENT_ID =
  '813169183999-7h25nq6u6rcf0lhf69gmknd65ogji42p.apps.googleusercontent.com';

export const DEFAULT_OAUTH_PROXY_URL = 'https://autosynctab-oauth.zz1018784543.workers.dev';

export function getDefaultAuthState(): SyncAuthState {
  const envClientId =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID
      ? String(import.meta.env.VITE_GOOGLE_CLIENT_ID).trim()
      : '';
  const envProxyUrl =
    typeof import.meta !== 'undefined' && typeof import.meta.env?.VITE_OAUTH_PROXY_URL === 'string'
      ? String(import.meta.env.VITE_OAUTH_PROXY_URL).trim()
      : DEFAULT_OAUTH_PROXY_URL;

  return {
    clientId: envClientId || DEFAULT_GOOGLE_CLIENT_ID,
    oauthProxyUrl: envProxyUrl.replace(/\/+$/, ''),
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    accountEmail: null,
  };
}

export async function loadAuthState(): Promise<SyncAuthState> {
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  const raw = result[AUTH_STORAGE_KEY];
  const defaults = getDefaultAuthState();

  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const candidate = raw as Partial<SyncAuthState>;
  return {
    clientId:
      typeof candidate.clientId === 'string' && candidate.clientId.trim()
        ? candidate.clientId.trim()
        : defaults.clientId,
    oauthProxyUrl:
      typeof candidate.oauthProxyUrl === 'string'
        ? candidate.oauthProxyUrl.trim().replace(/\/+$/, '')
        : defaults.oauthProxyUrl,
    accessToken: typeof candidate.accessToken === 'string' ? candidate.accessToken : null,
    refreshToken: typeof candidate.refreshToken === 'string' ? candidate.refreshToken : null,
    tokenExpiresAt:
      typeof candidate.tokenExpiresAt === 'number' && Number.isFinite(candidate.tokenExpiresAt)
        ? candidate.tokenExpiresAt
        : null,
    accountEmail: typeof candidate.accountEmail === 'string' ? candidate.accountEmail : null,
  };
}

export async function saveAuthState(patch: Partial<SyncAuthState>): Promise<SyncAuthState> {
  const current = await loadAuthState();
  const next: SyncAuthState = {
    ...current,
    ...patch,
  };
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: next });
  return next;
}

export async function clearAuthSession(): Promise<SyncAuthState> {
  return saveAuthState({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    accountEmail: null,
  });
}

let mutationQueue: Promise<unknown> = Promise.resolve();

export async function loadStore(): Promise<AppStoreData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeStoreData(result[STORAGE_KEY]);
}

export async function saveStore(data: AppStoreData): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export function mutateStore(
  updater: (current: AppStoreData) => AppStoreData
): Promise<AppStoreData> {
  const nextOperation = mutationQueue.then(async () => {
    const current = await loadStore();
    const updated = updater(current);
    await saveStore(updated);
    return updated;
  });

  mutationQueue = nextOperation.catch(() => undefined);
  return nextOperation;
}

export function subscribeStoreChanges(listener: (nextStore: AppStoreData) => void): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    listener(normalizeStoreData(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => {
    chrome.storage.onChanged.removeListener(handleChange);
  };
}
