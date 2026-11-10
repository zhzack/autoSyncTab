import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureBrowserBookmarks,
  collectBookmarkFolders,
  collectFolderBookmarksAsTabs,
  computeBookmarkDigest,
  createBookmarkFolder,
  createBookmarkItem,
  createDefaultBookmarkStore,
  exportBookmarksToHtml,
  filterBookmarkTree,
  findDuplicateBookmarkUrls,
  loadBookmarkStore,
  moveBookmarkEntry,
  removeBookmarkEntry,
  saveBookmarkStore,
  saveTabGroupAsBookmarkFolder,
  updateBookmarkEntry,
} from '../shared/bookmarks';
import { createDefaultStore, saveAuthState, saveStore, updateSyncInStore } from '../shared/storage';
import { GoogleDriveSyncAdapter } from '../shared/syncAdapter';
import { chromeMockControls } from './setup';

const TEST_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('bookmarks capture, CRUD, filtering & Drive sync', () => {
  beforeEach(() => {
    chromeMockControls.reset();
    chromeMockControls.bookmarkTree = [
      {
        id: '0',
        title: '',
        syncing: false,
        children: [
          {
            id: '1',
            parentId: '0',
            title: '书签栏',
            syncing: false,
            children: [
              {
                id: '10',
                parentId: '1',
                title: 'React',
                url: 'https://react.dev',
                dateAdded: 1000,
                syncing: false,
              },
              {
                id: '11',
                parentId: '1',
                title: '前端资料',
                syncing: false,
                children: [
                  {
                    id: '12',
                    parentId: '11',
                    title: 'React Duplicate',
                    url: 'https://react.dev',
                    dateAdded: 2000,
                    syncing: false,
                  },
                  {
                    id: '13',
                    parentId: '11',
                    title: 'Vite',
                    url: 'https://vite.dev',
                    dateAdded: 3000,
                    syncing: false,
                  },
                ],
              },
            ],
          },
          {
            id: '2',
            parentId: '0',
            title: '其他书签',
            syncing: false,
            children: [
              {
                id: '20',
                parentId: '2',
                title: '小工具',
                url: 'javascript:alert(1)',
                dateAdded: 4000,
                syncing: false,
              },
            ],
          },
        ],
      },
    ];
  });

  it('captures Chrome bookmark tree, detects duplicates, filters, exports HTML, and converts folders', async () => {
    const captured = await captureBrowserBookmarks(5000);
    expect(captured.totalCount).toBe(4);
    expect(captured.folderCount).toBe(1);
    expect(captured.roots[0].role).toBe('bookmarks_bar');

    const dups = findDuplicateBookmarkUrls(captured.roots);
    expect(dups.has('https://react.dev')).toBe(true);
    expect(dups.has('https://vite.dev')).toBe(false);

    const onlyDupTree = filterBookmarkTree(captured.roots, '', true);
    expect(onlyDupTree).toHaveLength(1);

    const queryTree = filterBookmarkTree(captured.roots, 'vite', false);
    expect(queryTree).toHaveLength(1);

    const folders = collectBookmarkFolders(captured.roots);
    expect(folders.map((f) => f.pathLabel)).toEqual(['书签栏', '书签栏 / 前端资料', '其他书签']);

    const html = exportBookmarksToHtml(captured.roots);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('HREF="https://react.dev"');

    const converted = collectFolderBookmarksAsTabs(captured.roots, '11');
    expect(converted?.folderTitle).toBe('前端资料');
    expect(converted?.tabs.map((t) => t.url)).toEqual(['https://react.dev', 'https://vite.dev']);
  });

  it('creates, edits, moves, and removes bookmarks & folders against Chrome bookmarks API', async () => {
    await captureBrowserBookmarks(1000);

    const afterFolder = await createBookmarkFolder('1', '新建收藏夹');
    const newFolder = afterFolder.roots[0].children?.find((c) => c.title === '新建收藏夹');
    expect(newFolder).toBeDefined();

    const afterItem = await createBookmarkItem(newFolder!.id, 'TypeScript', 'https://typescriptlang.org');
    const addedItem = afterItem.roots[0].children
      ?.find((c) => c.id === newFolder!.id)
      ?.children?.find((c) => c.url === 'https://typescriptlang.org');
    expect(addedItem).toBeDefined();

    const afterEdit = await updateBookmarkEntry(addedItem!.id, {
      title: 'TS Docs',
      url: 'https://www.typescriptlang.org',
    });
    expect(JSON.stringify(afterEdit.roots)).toContain('TS Docs');

    const afterMove = await moveBookmarkEntry(addedItem!.id, '2');
    expect(afterMove.roots[1].children?.some((c) => c.id === addedItem!.id)).toBe(true);

    const afterRemove = await removeBookmarkEntry(newFolder!.id, true);
    expect(afterRemove.roots[0].children?.some((c) => c.id === newFolder!.id)).toBe(false);
  });

  it('protects cloud-sourced bookmarks from being overwritten by empty local browser on startup capture', async () => {
    chromeMockControls.bookmarkTree = [
      {
        id: '0',
        title: '',
        syncing: false,
        children: [{ id: '1', parentId: '0', title: '书签栏', syncing: false, children: [] }],
      },
    ];

    const cloudStore = {
      ...createDefaultBookmarkStore(100),
      source: 'cloud' as const,
      totalCount: 1,
      roots: [
        {
          id: '1',
          title: '书签栏',
          role: 'bookmarks_bar' as const,
          children: [{ id: 'b1', title: 'Cloud BM', url: 'https://cloud.example.com' }],
        },
      ],
    };
    await saveBookmarkStore(cloudStore);

    const result = await captureBrowserBookmarks(200, { skipIfEmptyCloud: true });
    expect(result.source).toBe('cloud');
    expect(result.totalCount).toBe(1);
  });

  it('syncs bookmarks to and from Google Drive autosynctab-bookmarks.json', async () => {
    await captureBrowserBookmarks(1000);
    let store = createDefaultStore(1000);
    store = updateSyncInStore(store, { enabled: true, accountEmail: 'dev@gmail.com' });
    await saveStore(store);
    await saveAuthState({
      clientId: TEST_CLIENT_ID,
      accessToken: 'tok_valid',
      tokenExpiresAt: Date.now() + 3_600_000,
      accountEmail: 'dev@gmail.com',
    });

    let remoteBookmarkJson = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
        return jsonResponse({
          files: remoteBookmarkJson
            ? [{ id: 'bm_file_1', modifiedTime: '2026-11-11T01:00:00Z' }]
            : [],
        });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
        const rawBody = String(init?.body ?? '');
        const parts = rawBody.split('\r\n\r\n');
        remoteBookmarkJson = parts[2].split('\r\n--')[0];
        return jsonResponse({ id: 'bm_file_1', modifiedTime: '2026-11-11T01:00:00Z' });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/bm_file_1?fields=')) {
        return jsonResponse({
          id: 'bm_file_1',
          modifiedTime: '2026-11-11T01:00:00Z',
          trashed: false,
        });
      }
      if (url === 'https://www.googleapis.com/drive/v3/files/bm_file_1?alt=media') {
        return new Response(remoteBookmarkJson, { status: 200 });
      }
      return jsonResponse({ error: { message: `Unhandled ${url}` } }, 500);
    });

    const adapter = new GoogleDriveSyncAdapter(fetchMock as typeof fetch);

    // 1. Auto sync uploads local bookmarks
    const uploadRes = await adapter.syncBookmarksAuto();
    expect(uploadRes.outcome).toBe('uploaded');
    expect(remoteBookmarkJson).toContain('https://react.dev');

    // 2. Second auto sync is up-to-date
    const upToDate = await adapter.syncBookmarksAuto();
    expect(upToDate.outcome).toBe('up-to-date');

    // 3. On an empty secondary browser, syncBookmarksAuto pulls cloud bookmarks cleanly
    await saveBookmarkStore(createDefaultBookmarkStore(2000));
    const pullRes = await adapter.syncBookmarksAuto();
    expect(pullRes.outcome).toBe('pulled');
    const pulled = await loadBookmarkStore();
    expect(pulled.source).toBe('cloud');
    expect(pulled.totalCount).toBe(4);
    expect(computeBookmarkDigest(pulled.roots)).toBe(pulled.lastSyncedHash);
  });

  it('saves a tab group into a named bookmark folder and deduplicates repeated saves', async () => {
    await captureBrowserBookmarks(1000);
    const group = {
      id: 'grp_save',
      title: '常用技术站',
      createdAt: 1000,
      updatedAt: 1000,
      locked: false,
      tabs: [
        { id: 't1', url: 'https://react.dev', title: 'React 官方' },
        { id: 't2', url: 'https://vuejs.org', title: 'Vue 官方' },
      ],
    };

    const first = await saveTabGroupAsBookmarkFolder(group);
    expect(first.folderTitle).toBe('常用技术站');
    expect(first.addedCount).toBe(2);
    expect(first.skippedCount).toBe(0);

    const bar = first.store.roots[0];
    const createdFolder = bar.children?.find((c) => c.title === '常用技术站');
    expect(createdFolder?.children?.map((c) => c.url)).toEqual([
      'https://react.dev',
      'https://vuejs.org',
    ]);

    // Second save with an extra tab reuses the folder and skips existing URLs
    const second = await saveTabGroupAsBookmarkFolder({
      ...group,
      tabs: [
        ...group.tabs,
        { id: 't3', url: 'https://svelte.dev', title: 'Svelte' },
      ],
    });
    expect(second.addedCount).toBe(1);
    expect(second.skippedCount).toBe(2);
  });
});
