import {
  computeContentDigest,
  createId,
  mutateStore,
  normalizeStoreData,
} from './storage';
import type { AppStoreData, SnapshotReason, StoreSnapshot } from './types';

export const SNAPSHOTS_STORAGE_KEY = 'autosynctab_snapshots_v1';
export const MAX_SNAPSHOTS = 15;

function normalizeSnapshot(raw: unknown): StoreSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<StoreSnapshot>;
  if (typeof candidate.id !== 'string' || !candidate.id) return null;
  if (!candidate.store || typeof candidate.store !== 'object') return null;

  const normalizedStore = normalizeStoreData(candidate.store);
  const groupCount = normalizedStore.groups.length;
  const tabCount = normalizedStore.groups.reduce((sum, g) => sum + g.tabs.length, 0);

  return {
    id: candidate.id,
    createdAt:
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
        ? candidate.createdAt
        : Date.now(),
    reason:
      candidate.reason === 'manual' ||
      candidate.reason === 'pre-restore' ||
      candidate.reason === 'pre-auto-sync' ||
      candidate.reason === 'pre-conflict' ||
      candidate.reason === 'pre-import'
        ? candidate.reason
        : 'manual',
    note: typeof candidate.note === 'string' ? candidate.note : undefined,
    groupCount,
    tabCount,
    store: {
      schemaVersion: normalizedStore.schemaVersion,
      updatedAt: normalizedStore.updatedAt,
      groups: normalizedStore.groups,
      deletedGroups: normalizedStore.deletedGroups,
      settings: normalizedStore.settings,
    },
  };
}

export async function loadSnapshots(): Promise<StoreSnapshot[]> {
  const result = await chrome.storage.local.get(SNAPSHOTS_STORAGE_KEY);
  const raw = result[SNAPSHOTS_STORAGE_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => normalizeSnapshot(item))
    .filter((item): item is StoreSnapshot => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SNAPSHOTS);
}

async function saveSnapshots(snapshots: StoreSnapshot[]): Promise<void> {
  await chrome.storage.local.set({
    [SNAPSHOTS_STORAGE_KEY]: snapshots.slice(0, MAX_SNAPSHOTS),
  });
}

export async function createSnapshot(
  store: AppStoreData,
  reason: SnapshotReason,
  note?: string,
  now = Date.now()
): Promise<StoreSnapshot | null> {
  const existing = await loadSnapshots();
  const currentDigest = computeContentDigest(store);

  // Deduplicate consecutive automatic snapshots with identical content.
  if (reason !== 'manual' && existing.length > 0) {
    const latestDigest = computeContentDigest(existing[0].store);
    if (latestDigest === currentDigest) {
      return null;
    }
  }

  const cloned = structuredClone({
    schemaVersion: store.schemaVersion,
    updatedAt: store.updatedAt,
    groups: store.groups,
    deletedGroups: store.deletedGroups,
    settings: store.settings,
  });

  const snapshot: StoreSnapshot = {
    id: createId('snap'),
    createdAt: now,
    reason,
    note,
    groupCount: cloned.groups.length,
    tabCount: cloned.groups.reduce((sum, g) => sum + g.tabs.length, 0),
    store: cloned,
  };

  await saveSnapshots([snapshot, ...existing]);
  return snapshot;
}

export async function deleteSnapshot(snapshotId: string): Promise<StoreSnapshot[]> {
  const existing = await loadSnapshots();
  const next = existing.filter((item) => item.id !== snapshotId);
  await saveSnapshots(next);
  return next;
}

export async function restoreSnapshot(
  snapshotId: string,
  mode: 'replace' | 'merge',
  now = Date.now()
): Promise<AppStoreData> {
  const snapshots = await loadSnapshots();
  const target = snapshots.find((item) => item.id === snapshotId);
  if (!target) {
    throw new Error('未找到指定的历史快照');
  }

  return mutateStore((current) => {
    if (mode === 'replace') {
      return {
        ...current,
        updatedAt: now,
        groups: structuredClone(target.store.groups),
        deletedGroups: structuredClone(target.store.deletedGroups),
        settings: { ...target.store.settings },
      };
    }

    // Merge mode: preserve existing groups and add missing/newer groups from snapshot.
    const byId = new Map(current.groups.map((g) => [g.id, g]));
    for (const snapGroup of target.store.groups) {
      const existing = byId.get(snapGroup.id);
      if (!existing || snapGroup.updatedAt > existing.updatedAt) {
        byId.set(snapGroup.id, structuredClone(snapGroup));
      }
    }

    const mergedGroups = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    return {
      ...current,
      updatedAt: now,
      groups: mergedGroups,
    };
  });
}
