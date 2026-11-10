import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeContentDigest,
  createDefaultStore,
  loadStore,
  mergeImportedGroups,
  moveTabInStore,
  mutateStore,
  normalizeStoreData,
  prependGroup,
  removeGroupFromStore,
  removeTabFromGroup,
  reorderGroupsInStore,
  updateGroupInStore,
  updateSettingsInStore,
  updateSyncInStore,
} from '../shared/storage';
import { chromeMockControls } from './setup';

describe('storage helpers', () => {
  beforeEach(() => {
    chromeMockControls.reset();
  });

  it('normalizes invalid or partial raw store payloads safely', () => {
    const empty = normalizeStoreData(null, 1000);
    expect(empty.groups).toEqual([]);
    expect(empty.deletedGroups).toEqual([]);
    expect(empty.settings.ignorePinnedTabs).toBe(true);
    expect(empty.settings.autoSync).toBe(true);
    expect(empty.settings.theme).toBe('system');
    expect(empty.sync.provider).toBe('google-drive');

    const partial = normalizeStoreData(
      {
        groups: [
          { tabs: [] },
          { title: '学习资料', tabs: [{ url: 'https://react.dev', title: 'React' }] },
        ],
        settings: { ignorePinnedTabs: false, theme: 'dark', autoSync: false },
      },
      2000
    );

    expect(partial.groups).toHaveLength(1);
    expect(partial.groups[0].title).toBe('学习资料');
    expect(partial.settings.ignorePinnedTabs).toBe(false);
    expect(partial.settings.removeOnRestore).toBe(true);
    expect(partial.settings.theme).toBe('dark');
    expect(partial.settings.autoSync).toBe(false);
  });

  it('prepends groups, updates metadata, and records tombstones on deletion', () => {
    const base = createDefaultStore(100);
    const { nextStore, group } = prependGroup(
      base,
      [
        { id: 't1', url: 'https://a.com', title: 'A' },
        { id: 't2', url: 'https://b.com', title: 'B' },
      ],
      '工作区',
      200
    );

    expect(group).not.toBeNull();
    expect(nextStore.groups).toHaveLength(1);

    const renamed = updateGroupInStore(nextStore, group!.id, { title: '新分组', locked: true }, 300);
    expect(renamed.groups[0].title).toBe('新分组');
    expect(renamed.groups[0].locked).toBe(true);

    const afterRemoveOne = removeTabFromGroup(renamed, group!.id, 't1', 400);
    expect(afterRemoveOne.groups[0].tabs).toHaveLength(1);
    expect(afterRemoveOne.deletedGroups).toHaveLength(0);

    const afterRemoveLast = removeTabFromGroup(afterRemoveOne, group!.id, 't2', 500);
    expect(afterRemoveLast.groups).toHaveLength(0);
    expect(afterRemoveLast.deletedGroups).toEqual([{ id: group!.id, deletedAt: 500 }]);
  });

  it('removes groups, updates settings, and merges imported groups', () => {
    const s1 = createDefaultStore(100);
    const { nextStore: s2, group } = prependGroup(s1, [
      { id: 't1', url: 'https://a.com', title: 'A' },
    ]);

    const s3 = updateSettingsInStore(s2, { removeOnRestore: false });
    expect(s3.settings.removeOnRestore).toBe(false);

    const imported = mergeImportedGroups(
      s3,
      [
        {
          id: 'old-id',
          title: '导入组',
          createdAt: 50,
          updatedAt: 50,
          locked: false,
          tabs: [{ id: 'old-tab', url: 'https://c.com', title: 'C' }],
        },
      ],
      'prepend'
    );
    expect(imported.groups).toHaveLength(2);
    expect(imported.groups[0].id).not.toBe('old-id');

    const afterDelete = removeGroupFromStore(imported, group!.id, 900);
    expect(afterDelete.groups).toHaveLength(1);
    expect(afterDelete.deletedGroups).toContainEqual({ id: group!.id, deletedAt: 900 });
  });

  it('reorders groups, moves tabs within/across unlocked groups, and respects lock protection', () => {
    let store = createDefaultStore(100);
    const g1Res = prependGroup(
      store,
      [
        { id: 't1', url: 'https://one.com', title: 'One' },
        { id: 't2', url: 'https://two.com', title: 'Two' },
      ],
      'Group 1',
      200
    );
    store = g1Res.nextStore;
    const g2Res = prependGroup(
      store,
      [{ id: 't3', url: 'https://three.com', title: 'Three' }],
      'Group 2',
      300
    );
    store = g2Res.nextStore;

    // Currently [Group 2, Group 1]
    const reordered = reorderGroupsInStore(store, g1Res.group!.id, g2Res.group!.id, 400);
    expect(reordered.groups.map((g) => g.id)).toEqual([g1Res.group!.id, g2Res.group!.id]);

    // Move t1 after t2 within Group 1
    const withinGroup = moveTabInStore(
      reordered,
      g1Res.group!.id,
      't1',
      g1Res.group!.id,
      't2',
      'after',
      500
    );
    expect(withinGroup.groups[0].tabs.map((t) => t.id)).toEqual(['t2', 't1']);

    // Move t3 from Group 2 into Group 1 before t1 -> Group 2 becomes empty and is removed + tombstoned
    const crossGroup = moveTabInStore(
      withinGroup,
      g2Res.group!.id,
      't3',
      g1Res.group!.id,
      't1',
      'before',
      600
    );
    expect(crossGroup.groups).toHaveLength(1);
    expect(crossGroup.groups[0].tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
    expect(crossGroup.deletedGroups).toContainEqual({ id: g2Res.group!.id, deletedAt: 600 });

    // Locked group prevents tab moves
    const lockedStore = updateGroupInStore(crossGroup, g1Res.group!.id, { locked: true }, 700);
    const blocked = moveTabInStore(
      lockedStore,
      g1Res.group!.id,
      't2',
      g1Res.group!.id,
      't1',
      'after',
      800
    );
    expect(blocked.groups[0].tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('computes content digest independent of sync metadata', () => {
    const base = createDefaultStore(100);
    const { nextStore } = prependGroup(base, [{ id: 't1', url: 'https://a.com', title: 'A' }], 'G', 200);
    const d1 = computeContentDigest(nextStore);

    const syncMetaUpdated = updateSyncInStore(nextStore, {
      lastSyncedAt: 999,
      remoteFileId: 'file_abc',
      lastSyncedHash: d1,
    });
    expect(computeContentDigest(syncMetaUpdated)).toBe(d1);

    const contentChanged = updateSettingsInStore(syncMetaUpdated, { theme: 'dark' }, 300);
    expect(computeContentDigest(contentChanged)).not.toBe(d1);
  });

  it('persists mutations via chrome.storage.local', async () => {
    const initial = await loadStore();
    expect(initial.groups).toEqual([]);

    await mutateStore(
      (current) =>
        prependGroup(current, [{ id: 't1', url: 'https://vitest.dev', title: 'Vitest' }]).nextStore
    );

    const loaded = await loadStore();
    expect(loaded.groups).toHaveLength(1);
    expect(loaded.groups[0].tabs[0].url).toBe('https://vitest.dev');
  });
});
