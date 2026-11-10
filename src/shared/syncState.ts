import { normalizeStoreData } from './storage';
import type { SyncActivityState, SyncRuntimeState } from './types';

export const SYNC_RUNTIME_STORAGE_KEY = 'autosynctab_sync_runtime_v1';

export const DEFAULT_SYNC_RUNTIME_STATE: SyncRuntimeState = {
  status: 'idle',
  pendingLocalChanges: false,
  lastCheckedAt: null,
  lastError: null,
  conflict: null,
};

function isSyncActivityState(value: unknown): value is SyncActivityState {
  return (
    value === 'idle' ||
    value === 'syncing' ||
    value === 'conflict' ||
    value === 'auth-expired' ||
    value === 'error'
  );
}

function normalizeSyncRuntimeState(raw: unknown): SyncRuntimeState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SYNC_RUNTIME_STATE };
  }

  const candidate = raw as Partial<SyncRuntimeState>;
  const status: SyncActivityState = isSyncActivityState(candidate.status)
    ? candidate.status
    : 'idle';

  const conflict =
    candidate.conflict &&
    typeof candidate.conflict === 'object' &&
    Array.isArray(candidate.conflict.items)
      ? {
          detectedAt:
            typeof candidate.conflict.detectedAt === 'number'
              ? candidate.conflict.detectedAt
              : Date.now(),
          fileId: typeof candidate.conflict.fileId === 'string' ? candidate.conflict.fileId : '',
          remoteModifiedTime:
            typeof candidate.conflict.remoteModifiedTime === 'string'
              ? candidate.conflict.remoteModifiedTime
              : null,
          items: candidate.conflict.items,
          remoteBackup: normalizeStoreData(candidate.conflict.remoteBackup),
        }
      : null;

  return {
    status,
    pendingLocalChanges: Boolean(candidate.pendingLocalChanges),
    lastCheckedAt:
      typeof candidate.lastCheckedAt === 'number' && Number.isFinite(candidate.lastCheckedAt)
        ? candidate.lastCheckedAt
        : null,
    lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
    conflict,
  };
}

export async function loadSyncRuntimeState(): Promise<SyncRuntimeState> {
  const result = await chrome.storage.local.get(SYNC_RUNTIME_STORAGE_KEY);
  return normalizeSyncRuntimeState(result[SYNC_RUNTIME_STORAGE_KEY]);
}

export async function saveSyncRuntimeState(
  patch: Partial<SyncRuntimeState>
): Promise<SyncRuntimeState> {
  const current = await loadSyncRuntimeState();
  const next: SyncRuntimeState = {
    ...current,
    ...patch,
  };
  await chrome.storage.local.set({ [SYNC_RUNTIME_STORAGE_KEY]: next });
  return next;
}

export function subscribeSyncRuntimeChanges(
  listener: (nextState: SyncRuntimeState) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local' || !changes[SYNC_RUNTIME_STORAGE_KEY]) return;
    listener(normalizeSyncRuntimeState(changes[SYNC_RUNTIME_STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => {
    chrome.storage.onChanged.removeListener(handleChange);
  };
}
