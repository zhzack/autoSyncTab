import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportToJson } from '../shared/formatters';
import {
  createSnapshot,
  deleteSnapshot,
  loadSnapshots,
  MAX_SNAPSHOTS,
  restoreSnapshot,
} from '../shared/snapshots';
import {
  computeContentDigest,
  createDefaultStore,
  loadStore,
  prependGroup,
  removeGroupFromStore,
  saveAuthState,
  saveStore,
  updateGroupInStore,
  updateSyncInStore,
} from '../shared/storage';
import { GoogleDriveSyncAdapter } from '../shared/syncAdapter';
import { mergeConflictingGroup, reconcileStores } from '../shared/syncMerge';
import { loadSyncRuntimeState } from '../shared/syncState';
import type { AppStoreData, TabGroup } from '../shared/types';
import { chromeMockControls } from './setup';

const TEST_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGroup(id: string, title: string, updatedAt: number, urls: string[]): TabGroup {
  return {
    id,
    title,
    createdAt: 100,
    updatedAt,
    locked: false,
    tabs: urls.map((url, idx) => ({ id: `${id}_t${idx}`, url, title: `${title}-${idx}` })),
  };
}

describe('syncMerge, snapshots & GoogleDriveSyncAdapter auto-sync', () => {
  beforeEach(() => {
    chromeMockControls.reset();
  });

  it('reconciles disjoint multi-device changes and tombstones without conflicts', () => {
    const sharedGroup = makeGroup('g_shared', '共享分组', 100, ['https://shared.com']);
    const deletedOnRemote = makeGroup('g_del_remote', '远端已删', 100, ['https://old.com']);
    const localNew = makeGroup('g_local_new', '设备A新增', 300, ['https://a.com']);
    const remoteNew = makeGroup('g_remote_new', '设备B新增', 350, ['https://b.com']);

    const localStore: AppStoreData = {
      ...createDefaultStore(300),
      groups: [localNew, sharedGroup, deletedOnRemote],
      sync: {
        provider: 'google-drive',
        enabled: true,
        lastSyncedAt: 200,
        lastSyncedHash: 'stale_hash',
        remoteFileId: 'file_1',
        remoteModifiedTime: '2026-11-10T00:00:00Z',
        accountEmail: 'dev@gmail.com',
      },
    };

    const remoteStore: AppStoreData = {
      ...createDefaultStore(350),
      groups: [remoteNew, sharedGroup],
      deletedGroups: [{ id: 'g_del_remote', deletedAt: 280 }],
    };

    const result = reconcileStores(localStore, remoteStore, 200, 400);
    expect(result.conflicts).toHaveLength(0);
    expect(result.hasChangesForLocal).toBe(true);
    expect(result.hasChangesForRemote).toBe(true);
    expect(result.mergedStore.groups.map((g) => g.id)).toEqual([
      'g_remote_new',
      'g_local_new',
      'g_shared',
    ]);
    expect(result.mergedStore.deletedGroups).toContainEqual({ id: 'g_del_remote', deletedAt: 280 });
  });

  it('detects concurrent edits on the same group and merges union of tabs losslessly', () => {
    const localEdited = makeGroup('g_same', '本地新标题', 260, [
      'https://common.com',
      'https://local-added.com',
    ]);
    const remoteEdited = makeGroup('g_same', '云端标题', 250, [
      'https://common.com',
      'https://remote-added.com',
    ]);

    const localStore: AppStoreData = {
      ...createDefaultStore(260),
      groups: [localEdited],
      sync: {
        provider: 'google-drive',
        enabled: true,
        lastSyncedAt: 200,
        lastSyncedHash: 'old',
        remoteFileId: 'file_1',
        remoteModifiedTime: null,
        accountEmail: 'dev@gmail.com',
      },
    };
    const remoteStore: AppStoreData = {
      ...createDefaultStore(250),
      groups: [remoteEdited],
    };

    const result = reconcileStores(localStore, remoteStore, 200, 300);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe('both-modified');

    const mergedGroup = mergeConflictingGroup(localEdited, remoteEdited);
    expect(mergedGroup.title).toBe('本地新标题');
    expect(mergedGroup.tabs.map((t) => t.url)).toEqual([
      'https://common.com',
      'https://local-added.com',
      'https://remote-added.com',
    ]);
  });

  it('creates, deduplicates, caps, restores, and deletes snapshots', async () => {
    let store = createDefaultStore(100);
    store = prependGroup(store, [{ id: 't1', url: 'https://a.com', title: 'A' }], '初始组', 100)
      .nextStore;
    await saveStore(store);

    const s1 = await createSnapshot(store, 'pre-auto-sync', '自动快照1', 1000);
    expect(s1).not.toBeNull();

    // Duplicate automatic snapshot with identical content is skipped
    const dup = await createSnapshot(store, 'pre-restore', '重复内容', 1100);
    expect(dup).toBeNull();

    // Manual snapshots are always allowed
    const manual = await createSnapshot(store, 'manual', '手动快照', 1200);
    expect(manual).not.toBeNull();

    // Mutate current store then restore snapshot in replace mode
    const modified = removeGroupFromStore(store, store.groups[0].id, 1300);
    await saveStore(modified);
    expect((await loadStore()).groups).toHaveLength(0);

    const restored = await restoreSnapshot(manual!.id, 'replace', 1400);
    expect(restored.groups).toHaveLength(1);
    expect(restored.groups[0].title).toBe('初始组');

    // Delete snapshot
    const afterDel = await deleteSnapshot(manual!.id);
    expect(afterDel.some((s) => s.id === manual!.id)).toBe(false);

    // Cap at MAX_SNAPSHOTS
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i += 1) {
      await createSnapshot(store, 'manual', `snap-${i}`, 2000 + i);
    }
    expect(await loadSnapshots()).toHaveLength(MAX_SNAPSHOTS);
  });

  it('auto-syncs seamlessly when clean/disjoint and resolves overlapping conflicts safely', async () => {
    let store = createDefaultStore(100);
    store = prependGroup(store, [{ id: 't1', url: 'https://base.com', title: 'Base' }], '基础组', 100)
      .nextStore;
    const baseGroupId = store.groups[0].id;
    const baseDigest = computeContentDigest(store);
    store = updateSyncInStore(store, {
      enabled: true,
      accountEmail: 'dev@gmail.com',
      remoteFileId: 'file_1',
      remoteModifiedTime: '2026-11-10T01:00:00Z',
      lastSyncedAt: 200,
      lastSyncedHash: baseDigest,
    });
    await saveStore(store);
    await saveAuthState({
      clientId: TEST_CLIENT_ID,
      accessToken: 'tok_valid',
      tokenExpiresAt: Date.now() + 3_600_000,
      accountEmail: 'dev@gmail.com',
    });

    // Remote has an updated version of the same group AND local also edited the same group
    const remoteStore: AppStoreData = {
      ...createDefaultStore(300),
      groups: [
        {
          ...store.groups[0],
          title: '远端改名',
          updatedAt: 300,
          tabs: [
            ...store.groups[0].tabs,
            { id: 't_remote', url: 'https://remote.dev', title: 'Remote' },
          ],
        },
      ],
    };

    let remoteJson = exportToJson(remoteStore);
    let remoteModifiedTime = '2026-11-10T02:00:00Z';

    // Local edits the same group concurrently
    const localEdited = updateGroupInStore(store, baseGroupId, { title: '本地改名' }, 310);
    await saveStore(localEdited);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/file_1?fields=')) {
        return jsonResponse({ id: 'file_1', modifiedTime: remoteModifiedTime, trashed: false });
      }
      if (url === 'https://www.googleapis.com/drive/v3/files/file_1?alt=media') {
        return new Response(remoteJson, { status: 200 });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files/file_1?uploadType=media')) {
        remoteJson = String(init?.body ?? '');
        remoteModifiedTime = '2026-11-10T03:00:00Z';
        return jsonResponse({ id: 'file_1', modifiedTime: remoteModifiedTime });
      }
      return jsonResponse({ error: { message: `Unhandled ${url}` } }, 500);
    });

    const adapter = new GoogleDriveSyncAdapter(fetchMock as typeof fetch);

    // 1. Auto-sync detects overlapping conflict, saves pre-conflict snapshot, does NOT overwrite remote
    const syncRes = await adapter.syncAuto({ checkRemote: true });
    expect(syncRes.outcome).toBe('conflict');
    expect(syncRes.conflictCount).toBe(1);

    const runtime = await loadSyncRuntimeState();
    expect(runtime.status).toBe('conflict');
    expect(runtime.conflict?.items).toHaveLength(1);
    expect((await loadSnapshots()).some((s) => s.reason === 'pre-conflict')).toBe(true);

    // 2. Resolve conflict with 'merge' -> keeps both local title (newer) and remote tab, uploads merged JSON
    const resolved = await adapter.resolveConflict('merge');
    expect(resolved.outcome).toBe('merged');

    const finalStore = await loadStore();
    expect(finalStore.groups[0].title).toBe('本地改名');
    expect(finalStore.groups[0].tabs.map((t) => t.url)).toEqual([
      'https://base.com',
      'https://remote.dev',
    ]);
    expect((await loadSyncRuntimeState()).status).toBe('idle');
    expect((await loadSyncRuntimeState()).conflict).toBeNull();

    // 3. Subsequent sync with unchanged local & remote reports up-to-date without uploading
    const cleanSync = await adapter.syncAuto({ checkRemote: true });
    expect(cleanSync.outcome).toBe('up-to-date');
  });

  it('marks auth-expired silently during background sync when token expired', async () => {
    let store = createDefaultStore(100);
    store = updateSyncInStore(store, { enabled: true, accountEmail: 'dev@gmail.com' });
    await saveStore(store);
    await saveAuthState({
      clientId: TEST_CLIENT_ID,
      accessToken: 'expired',
      tokenExpiresAt: Date.now() - 10_000,
      accountEmail: 'dev@gmail.com',
    });

    const adapter = new GoogleDriveSyncAdapter(vi.fn() as typeof fetch);
    const result = await adapter.syncAuto({ silent: true });
    expect(result.outcome).toBe('auth-expired');
    expect((await loadSyncRuntimeState()).status).toBe('auth-expired');
  });
});
