import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultStore,
  loadStore,
  mergeImportedGroups,
  mutateStore,
  normalizeStoreData,
  prependGroup,
  removeGroupFromStore,
  removeTabFromGroup,
  updateGroupInStore,
  updateSettingsInStore,
} from '../shared/storage';
import { chromeMockControls } from './setup';

describe('storage helpers', () => {
  beforeEach(() => {
    chromeMockControls.reset();
  });

  it('normalizes invalid or partial raw store payloads safely', () => {
    const empty = normalizeStoreData(null, 1000);
    expect(empty.groups).toEqual([]);
    expect(empty.settings.ignorePinnedTabs).toBe(true);
    expect(empty.sync.provider).toBe('google-drive');

    const partial = normalizeStoreData(
      {
        groups: [
          { tabs: [] },
          { title: '学习资料', tabs: [{ url: 'https://react.dev', title: 'React' }] },
        ],
        settings: { ignorePinnedTabs: false },
      },
      2000
    );

    expect(partial.groups).toHaveLength(1);
    expect(partial.groups[0].title).toBe('学习资料');
    expect(partial.settings.ignorePinnedTabs).toBe(false);
    expect(partial.settings.removeOnRestore).toBe(true);
  });

  it('prepends groups, updates metadata, and removes empty groups automatically', () => {
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

    const afterRemoveLast = removeTabFromGroup(afterRemoveOne, group!.id, 't2', 500);
    expect(afterRemoveLast.groups).toHaveLength(0);
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

    const afterDelete = removeGroupFromStore(imported, group!.id);
    expect(afterDelete.groups).toHaveLength(1);
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
