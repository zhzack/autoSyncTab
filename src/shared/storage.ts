import type {
  AppStoreData,
  ExtensionSettings,
  SyncAuthState,
  SyncMetadata,
  SyncRestoreMode,
  TabGroup,
  TabItem,
} from './types';

export const STORAGE_KEY = 'autosynctab_store_v1';
export const AUTH_STORAGE_KEY = 'autosynctab_auth_v1';
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  ignorePinnedTabs: true,
  removeOnRestore: true,
  openManagerAfterStash: true,
  deduplicateOnStash: true,
};

export const DEFAULT_SYNC_METADATA: SyncMetadata = {
  provider: 'google-drive',
  enabled: false,
  lastSyncedAt: null,
  remoteFileId: null,
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
    settings: { ...DEFAULT_SETTINGS },
    sync: { ...DEFAULT_SYNC_METADATA },
  };
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

  const groups = rawGroups
    .map((grp) => normalizeTabGroup(grp, now))
    .filter((grp): grp is TabGroup => grp !== null);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : now,
    groups,
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
    },
    sync: {
      provider: 'google-drive',
      enabled: Boolean(rawSync.enabled),
      lastSyncedAt:
        typeof rawSync.lastSyncedAt === 'number' && Number.isFinite(rawSync.lastSyncedAt)
          ? rawSync.lastSyncedAt
          : null,
      remoteFileId: typeof rawSync.remoteFileId === 'string' ? rawSync.remoteFileId : null,
      accountEmail: typeof rawSync.accountEmail === 'string' ? rawSync.accountEmail : null,
    },
  };
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
    },
  };
}

export function removeTabFromGroup(
  store: AppStoreData,
  groupId: string,
  tabId: string,
  now = Date.now()
): AppStoreData {
  const nextGroups = store.groups
    .map((group) => {
      if (group.id !== groupId) return group;
      const filteredTabs = group.tabs.filter((tab) => tab.id !== tabId);
      if (filteredTabs.length === group.tabs.length) return group;
      return {
        ...group,
        updatedAt: now,
        tabs: filteredTabs,
      };
    })
    .filter((group) => group.tabs.length > 0);

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
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

  return {
    ...store,
    updatedAt: now,
    groups: mode === 'replace' ? freshGroups : [...freshGroups, ...store.groups],
  };
}

export function updateSyncInStore(
  store: AppStoreData,
  patch: Partial<SyncMetadata>,
  now = Date.now()
): AppStoreData {
  return {
    ...store,
    updatedAt: now,
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

  return {
    ...store,
    updatedAt: now,
    groups: nextGroups,
    settings: mode === 'replace' ? remoteBackup.settings : store.settings,
  };
}

export const DEFAULT_GOOGLE_CLIENT_ID =
  '813169183999-7h25nq6u6rcf0lhf69gmknd65ogji42p.apps.googleusercontent.com';

export function getDefaultAuthState(): SyncAuthState {
  const envClientId =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID
      ? String(import.meta.env.VITE_GOOGLE_CLIENT_ID).trim()
      : '';

  return {
    clientId: envClientId || DEFAULT_GOOGLE_CLIENT_ID,
    accessToken: null,
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
    accessToken: typeof candidate.accessToken === 'string' ? candidate.accessToken : null,
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
