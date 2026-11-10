import { formatDateTime } from './formatters';
import { createId, hashCanonicalString } from './storage';
import type { BookmarkNode, BookmarkRootRole, BookmarkStoreData, TabGroup, TabItem } from './types';

export const BOOKMARKS_STORAGE_KEY = 'autosynctab_bookmarks_v1';
export const BOOKMARK_SCHEMA_VERSION = 1;

export function createDefaultBookmarkStore(now = Date.now()): BookmarkStoreData {
  return {
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    updatedAt: now,
    source: 'browser',
    totalCount: 0,
    folderCount: 0,
    roots: [],
    lastCapturedAt: null,
    lastSyncedAt: null,
    lastSyncedHash: null,
    remoteFileId: null,
    remoteModifiedTime: null,
  };
}

export function countBookmarksAndFolders(roots: BookmarkNode[]): {
  bookmarkCount: number;
  folderCount: number;
} {
  let bookmarkCount = 0;
  let folderCount = 0;

  const walk = (nodes: BookmarkNode[], isRootLevel: boolean) => {
    for (const node of nodes) {
      if (typeof node.url === 'string' && node.url.trim()) {
        bookmarkCount += 1;
      } else {
        if (!isRootLevel) {
          folderCount += 1;
        }
        if (Array.isArray(node.children)) {
          walk(node.children, false);
        }
      }
    }
  };

  walk(roots, true);
  return { bookmarkCount, folderCount };
}

function normalizeRole(raw: unknown): BookmarkRootRole | undefined {
  if (raw === 'bookmarks_bar' || raw === 'other' || raw === 'mobile') {
    return raw;
  }
  return undefined;
}

function normalizeBookmarkNode(raw: unknown): BookmarkNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('bm');
  const title = typeof candidate.title === 'string' ? candidate.title : '';
  const parentId = typeof candidate.parentId === 'string' ? candidate.parentId : undefined;
  const dateAdded =
    typeof candidate.dateAdded === 'number' && Number.isFinite(candidate.dateAdded)
      ? candidate.dateAdded
      : undefined;
  const index =
    typeof candidate.index === 'number' && Number.isFinite(candidate.index)
      ? candidate.index
      : undefined;

  if (typeof candidate.url === 'string' && candidate.url.trim()) {
    return {
      id,
      parentId,
      title: title.trim() || candidate.url.trim(),
      url: candidate.url.trim(),
      dateAdded,
      index,
    };
  }

  const rawChildren = Array.isArray(candidate.children) ? candidate.children : [];
  const children = rawChildren
    .map((child) => normalizeBookmarkNode(child))
    .filter((child): child is BookmarkNode => child !== null);

  return {
    id,
    parentId,
    title: title.trim() || '未命名文件夹',
    role: normalizeRole(candidate.role),
    dateAdded,
    index,
    children,
  };
}

export function normalizeBookmarkStoreData(raw: unknown, now = Date.now()): BookmarkStoreData {
  if (!raw || typeof raw !== 'object') {
    return createDefaultBookmarkStore(now);
  }
  const candidate = raw as Record<string, unknown>;
  const rawRoots = Array.isArray(candidate.roots) ? candidate.roots : [];
  const roots = rawRoots
    .map((root) => normalizeBookmarkNode(root))
    .filter((root): root is BookmarkNode => root !== null);

  const counts = countBookmarksAndFolders(roots);
  const source =
    candidate.source === 'browser' || candidate.source === 'cloud' || candidate.source === 'manual'
      ? candidate.source
      : 'browser';

  return {
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : now,
    source,
    totalCount: counts.bookmarkCount,
    folderCount: counts.folderCount,
    roots,
    lastCapturedAt:
      typeof candidate.lastCapturedAt === 'number' && Number.isFinite(candidate.lastCapturedAt)
        ? candidate.lastCapturedAt
        : null,
    lastSyncedAt:
      typeof candidate.lastSyncedAt === 'number' && Number.isFinite(candidate.lastSyncedAt)
        ? candidate.lastSyncedAt
        : null,
    lastSyncedHash: typeof candidate.lastSyncedHash === 'string' ? candidate.lastSyncedHash : null,
    remoteFileId: typeof candidate.remoteFileId === 'string' ? candidate.remoteFileId : null,
    remoteModifiedTime:
      typeof candidate.remoteModifiedTime === 'string' ? candidate.remoteModifiedTime : null,
  };
}

function inferChromeRootRole(
  node: chrome.bookmarks.BookmarkTreeNode,
  idx: number
): BookmarkRootRole | undefined {
  const folderType = (node as { folderType?: string }).folderType;
  if (folderType === 'bookmarks-bar' || node.id === '1') return 'bookmarks_bar';
  if (folderType === 'other' || node.id === '2') return 'other';
  if (folderType === 'mobile' || node.id === '3') return 'mobile';
  if (idx === 0) return 'bookmarks_bar';
  if (idx === 1) return 'other';
  if (idx === 2) return 'mobile';
  return undefined;
}

function defaultRootTitle(role?: BookmarkRootRole): string {
  switch (role) {
    case 'bookmarks_bar':
      return '书签栏';
    case 'other':
      return '其他书签';
    case 'mobile':
      return '移动设备书签';
    default:
      return '书签目录';
  }
}

function convertChromeNode(
  node: chrome.bookmarks.BookmarkTreeNode,
  role?: BookmarkRootRole
): BookmarkNode | null {
  if (typeof node.url === 'string' && node.url.trim()) {
    return {
      id: node.id,
      parentId: node.parentId,
      title: node.title?.trim() || node.url.trim(),
      url: node.url.trim(),
      dateAdded: node.dateAdded,
      index: node.index,
    };
  }

  const children = (node.children ?? [])
    .map((child) => convertChromeNode(child))
    .filter((child): child is BookmarkNode => child !== null);

  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title?.trim() || defaultRootTitle(role),
    role,
    dateAdded: node.dateAdded,
    index: node.index,
    children,
  };
}

export function normalizeChromeBookmarkTree(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkNode[] {
  const topLevel = tree[0]?.children ?? tree;
  return topLevel
    .map((node, idx) => convertChromeNode(node, inferChromeRootRole(node, idx)))
    .filter((node): node is BookmarkNode => node !== null);
}

export function computeBookmarkDigest(roots: BookmarkNode[]): string {
  const stripVolatileFields = (node: BookmarkNode): unknown => {
    if (typeof node.url === 'string') {
      return { title: node.title, url: node.url };
    }
    return {
      title: node.title,
      role: node.role ?? null,
      children: (node.children ?? []).map(stripVolatileFields),
    };
  };
  return hashCanonicalString(JSON.stringify(roots.map(stripVolatileFields)));
}

export interface BookmarkFolderOption {
  id: string;
  title: string;
  pathLabel: string;
  role?: BookmarkRootRole;
}

export function collectBookmarkFolders(roots: BookmarkNode[]): BookmarkFolderOption[] {
  const list: BookmarkFolderOption[] = [];

  const walk = (nodes: BookmarkNode[], prefix: string[]) => {
    for (const node of nodes) {
      if (typeof node.url === 'string') continue;
      const pathParts = [...prefix, node.title];
      list.push({
        id: node.id,
        title: node.title,
        pathLabel: pathParts.join(' / '),
        role: node.role,
      });
      if (node.children) {
        walk(node.children, pathParts);
      }
    }
  };

  walk(roots, []);
  return list;
}

export function findDuplicateBookmarkUrls(roots: BookmarkNode[]): Set<string> {
  const counts = new Map<string, number>();

  const walk = (nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      if (typeof node.url === 'string') {
        counts.set(node.url, (counts.get(node.url) ?? 0) + 1);
      } else if (node.children) {
        walk(node.children);
      }
    }
  };

  walk(roots);
  const duplicates = new Set<string>();
  for (const [url, count] of counts.entries()) {
    if (count > 1) duplicates.add(url);
  }
  return duplicates;
}

export function filterBookmarkTree(
  roots: BookmarkNode[],
  rawQuery: string,
  onlyDuplicates = false
): BookmarkNode[] {
  const query = rawQuery.trim().toLowerCase();
  const duplicateUrls = onlyDuplicates ? findDuplicateBookmarkUrls(roots) : null;

  if (!query && !onlyDuplicates) {
    return roots;
  }

  const filterNode = (node: BookmarkNode, forceIncludeDescendants: boolean): BookmarkNode | null => {
    if (typeof node.url === 'string') {
      if (duplicateUrls && !duplicateUrls.has(node.url)) {
        return null;
      }
      if (!query || forceIncludeDescendants) {
        return node;
      }
      const matches =
        node.title.toLowerCase().includes(query) || node.url.toLowerCase().includes(query);
      return matches ? node : null;
    }

    const folderMatches = Boolean(query) && node.title.toLowerCase().includes(query);
    const nextChildren = (node.children ?? [])
      .map((child) => filterNode(child, forceIncludeDescendants || (folderMatches && !onlyDuplicates)))
      .filter((child): child is BookmarkNode => child !== null);

    if (nextChildren.length === 0 && !(folderMatches && !onlyDuplicates && !node.role)) {
      return null;
    }

    return {
      ...node,
      children: nextChildren,
    };
  };

  return roots
    .map((root) => filterNode(root, false))
    .filter((root): root is BookmarkNode => root !== null);
}

export function collectFolderBookmarksAsTabs(
  roots: BookmarkNode[],
  folderId: string
): { folderTitle: string; tabs: TabItem[] } | null {
  const findFolder = (nodes: BookmarkNode[]): BookmarkNode | null => {
    for (const node of nodes) {
      if (typeof node.url === 'string') continue;
      if (node.id === folderId) return node;
      if (node.children) {
        const found = findFolder(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  const folder = findFolder(roots);
  if (!folder) return null;

  const tabs: TabItem[] = [];
  const collect = (nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      if (typeof node.url === 'string' && /^https?:|^file:|^ftp:/i.test(node.url)) {
        tabs.push({
          id: createId('tab'),
          url: node.url,
          title: node.title || node.url,
        });
      } else if (node.children) {
        collect(node.children);
      }
    }
  };
  collect(folder.children ?? []);

  return { folderTitle: folder.title, tabs };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportBookmarksToHtml(roots: BookmarkNode[]): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  const writeNodes = (nodes: BookmarkNode[], indent: string) => {
    for (const node of nodes) {
      if (typeof node.url === 'string') {
        const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : Math.floor(Date.now() / 1000);
        lines.push(
          `${indent}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${addDate}">${escapeHtml(node.title)}</A>`
        );
      } else {
        const attr = node.role === 'bookmarks_bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
        lines.push(`${indent}<DT><H3${attr}>${escapeHtml(node.title)}</H3>`);
        lines.push(`${indent}<DL><p>`);
        writeNodes(node.children ?? [], `${indent}    `);
        lines.push(`${indent}</DL><p>`);
      }
    }
  };

  writeNodes(roots, '    ');
  lines.push('</DL><p>');
  return lines.join('\n');
}

export function insertBookmarkNodeInTree(
  roots: BookmarkNode[],
  parentId: string,
  newNode: BookmarkNode
): BookmarkNode[] {
  return roots.map((node) => {
    if (typeof node.url === 'string') return node;
    if (node.id === parentId) {
      return {
        ...node,
        children: [...(node.children ?? []), { ...newNode, parentId }],
      };
    }
    if (node.children) {
      return {
        ...node,
        children: insertBookmarkNodeInTree(node.children, parentId, newNode),
      };
    }
    return node;
  });
}

export function updateBookmarkNodeInTree(
  roots: BookmarkNode[],
  nodeId: string,
  patch: { title?: string; url?: string }
): BookmarkNode[] {
  return roots.map((node) => {
    if (node.id === nodeId) {
      return {
        ...node,
        title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : node.title,
        url: typeof node.url === 'string' && typeof patch.url === 'string' && patch.url.trim()
          ? patch.url.trim()
          : node.url,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: updateBookmarkNodeInTree(node.children, nodeId, patch),
      };
    }
    return node;
  });
}

export function removeBookmarkNodeInTree(roots: BookmarkNode[], nodeId: string): BookmarkNode[] {
  const result: BookmarkNode[] = [];
  for (const node of roots) {
    if (node.id === nodeId && !node.role) {
      continue;
    }
    if (node.children) {
      result.push({
        ...node,
        children: removeBookmarkNodeInTree(node.children, nodeId),
      });
    } else {
      result.push(node);
    }
  }
  return result;
}

export function moveBookmarkNodeInTree(
  roots: BookmarkNode[],
  nodeId: string,
  targetParentId: string
): BookmarkNode[] {
  let extracted: BookmarkNode | null = null;

  const strip = (nodes: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const node of nodes) {
      if (node.id === nodeId && !node.role) {
        extracted = node;
        continue;
      }
      if (node.children) {
        out.push({ ...node, children: strip(node.children) });
      } else {
        out.push(node);
      }
    }
    return out;
  };

  const withoutNode = strip(roots);
  if (!extracted) return roots;
  return insertBookmarkNodeInTree(withoutNode, targetParentId, extracted);
}

export async function loadBookmarkStore(): Promise<BookmarkStoreData> {
  const result = await chrome.storage.local.get(BOOKMARKS_STORAGE_KEY);
  return normalizeBookmarkStoreData(result[BOOKMARKS_STORAGE_KEY]);
}

export async function saveBookmarkStore(data: BookmarkStoreData): Promise<void> {
  const counts = countBookmarksAndFolders(data.roots);
  await chrome.storage.local.set({
    [BOOKMARKS_STORAGE_KEY]: {
      ...data,
      totalCount: counts.bookmarkCount,
      folderCount: counts.folderCount,
    },
  });
}

export function subscribeBookmarkStoreChanges(
  listener: (nextStore: BookmarkStoreData) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local' || !changes[BOOKMARKS_STORAGE_KEY]) return;
    listener(normalizeBookmarkStoreData(changes[BOOKMARKS_STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => {
    chrome.storage.onChanged.removeListener(handleChange);
  };
}

function updateStoreWithRoots(
  current: BookmarkStoreData,
  roots: BookmarkNode[],
  now = Date.now(),
  source: BookmarkStoreData['source'] = current.source
): BookmarkStoreData {
  const counts = countBookmarksAndFolders(roots);
  return {
    ...current,
    updatedAt: now,
    source,
    totalCount: counts.bookmarkCount,
    folderCount: counts.folderCount,
    roots,
  };
}

export async function captureBrowserBookmarks(
  now = Date.now(),
  options: { skipIfEmptyCloud?: boolean } = {}
): Promise<BookmarkStoreData> {
  const current = await loadBookmarkStore();
  if (typeof chrome === 'undefined' || !chrome.bookmarks?.getTree) {
    return current;
  }

  const tree = await chrome.bookmarks.getTree();
  const roots = normalizeChromeBookmarkTree(tree);
  const counts = countBookmarksAndFolders(roots);

  if (
    options.skipIfEmptyCloud &&
    counts.bookmarkCount === 0 &&
    current.source === 'cloud' &&
    current.totalCount > 0
  ) {
    return current;
  }

  const next: BookmarkStoreData = {
    ...current,
    updatedAt: now,
    source: 'browser',
    totalCount: counts.bookmarkCount,
    folderCount: counts.folderCount,
    roots,
    lastCapturedAt: now,
  };

  await saveBookmarkStore(next);
  return next;
}

export async function createBookmarkItem(
  parentId: string,
  title: string,
  url: string
): Promise<BookmarkStoreData> {
  const cleanTitle = title.trim() || url.trim();
  const cleanUrl = url.trim();
  const now = Date.now();

  if (typeof chrome !== 'undefined' && chrome.bookmarks?.create) {
    try {
      await chrome.bookmarks.create({ parentId, title: cleanTitle, url: cleanUrl });
      return captureBrowserBookmarks(now);
    } catch {
      // Fall back to plugin-local store if parentId only exists in cloud snapshot.
    }
  }

  const current = await loadBookmarkStore();
  const nextRoots = insertBookmarkNodeInTree(current.roots, parentId, {
    id: createId('bm'),
    parentId,
    title: cleanTitle,
    url: cleanUrl,
    dateAdded: now,
  });
  const next = updateStoreWithRoots(current, nextRoots, now);
  await saveBookmarkStore(next);
  return next;
}

export async function createBookmarkFolder(
  parentId: string,
  title: string
): Promise<BookmarkStoreData> {
  const cleanTitle = title.trim() || '新建文件夹';
  const now = Date.now();

  if (typeof chrome !== 'undefined' && chrome.bookmarks?.create) {
    try {
      await chrome.bookmarks.create({ parentId, title: cleanTitle });
      return captureBrowserBookmarks(now);
    } catch {
      // Fall back to plugin-local store if parentId only exists in cloud snapshot.
    }
  }

  const current = await loadBookmarkStore();
  const nextRoots = insertBookmarkNodeInTree(current.roots, parentId, {
    id: createId('fld'),
    parentId,
    title: cleanTitle,
    dateAdded: now,
    children: [],
  });
  const next = updateStoreWithRoots(current, nextRoots, now);
  await saveBookmarkStore(next);
  return next;
}

export async function updateBookmarkEntry(
  id: string,
  patch: { title?: string; url?: string }
): Promise<BookmarkStoreData> {
  const now = Date.now();

  if (typeof chrome !== 'undefined' && chrome.bookmarks?.update) {
    try {
      await chrome.bookmarks.update(id, {
        ...(typeof patch.title === 'string' ? { title: patch.title.trim() } : {}),
        ...(typeof patch.url === 'string' ? { url: patch.url.trim() } : {}),
      });
      return captureBrowserBookmarks(now);
    } catch {
      // Fall back to plugin-local store if ID only exists in cloud snapshot.
    }
  }

  const current = await loadBookmarkStore();
  const nextRoots = updateBookmarkNodeInTree(current.roots, id, patch);
  const next = updateStoreWithRoots(current, nextRoots, now);
  await saveBookmarkStore(next);
  return next;
}

export async function moveBookmarkEntry(
  id: string,
  targetParentId: string
): Promise<BookmarkStoreData> {
  const now = Date.now();

  if (typeof chrome !== 'undefined' && chrome.bookmarks?.move) {
    try {
      await chrome.bookmarks.move(id, { parentId: targetParentId });
      return captureBrowserBookmarks(now);
    } catch {
      // Fall back to plugin-local store if IDs only exist in cloud snapshot.
    }
  }

  const current = await loadBookmarkStore();
  const nextRoots = moveBookmarkNodeInTree(current.roots, id, targetParentId);
  const next = updateStoreWithRoots(current, nextRoots, now);
  await saveBookmarkStore(next);
  return next;
}

export async function removeBookmarkEntry(
  id: string,
  isFolder: boolean
): Promise<BookmarkStoreData> {
  const now = Date.now();

  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    try {
      if (isFolder && chrome.bookmarks.removeTree) {
        await chrome.bookmarks.removeTree(id);
        return captureBrowserBookmarks(now);
      }
      if (!isFolder && chrome.bookmarks.remove) {
        await chrome.bookmarks.remove(id);
        return captureBrowserBookmarks(now);
      }
    } catch {
      // Fall back to plugin-local store if ID only exists in cloud snapshot.
    }
  }

  const current = await loadBookmarkStore();
  const nextRoots = removeBookmarkNodeInTree(current.roots, id);
  const next = updateStoreWithRoots(current, nextRoots, now);
  await saveBookmarkStore(next);
  return next;
}

export interface SaveGroupToBookmarksResult {
  store: BookmarkStoreData;
  folderId: string;
  folderTitle: string;
  addedCount: number;
  skippedCount: number;
}

export async function saveTabGroupAsBookmarkFolder(
  group: TabGroup,
  targetParentId?: string
): Promise<SaveGroupToBookmarksResult> {
  const now = Date.now();
  const folderTitle = group.title.trim() || `未命名分组 (${formatDateTime(group.createdAt)})`;

  if (typeof chrome !== 'undefined' && chrome.bookmarks?.getTree && chrome.bookmarks?.create) {
    try {
      const tree = await chrome.bookmarks.getTree();
      const topLevel = tree[0]?.children ?? tree;
      const parentNode =
        (targetParentId ? topLevel.find((node) => node.id === targetParentId) : undefined) ??
        topLevel.find((node, idx) => inferChromeRootRole(node, idx) === 'bookmarks_bar') ??
        topLevel[0];

      if (parentNode) {
        const existingFolder = (parentNode.children ?? []).find(
          (child) => !child.url && child.title === folderTitle
        );

        let folderId: string;
        const existingUrls = new Set<string>();

        if (existingFolder) {
          folderId = existingFolder.id;
          for (const item of existingFolder.children ?? []) {
            if (item.url) existingUrls.add(item.url);
          }
        } else {
          const created = await chrome.bookmarks.create({
            parentId: parentNode.id,
            title: folderTitle,
          });
          folderId = created.id;
        }

        let addedCount = 0;
        let skippedCount = 0;

        for (const tab of group.tabs) {
          if (existingUrls.has(tab.url)) {
            skippedCount += 1;
            continue;
          }
          await chrome.bookmarks.create({
            parentId: folderId,
            title: tab.title || tab.url,
            url: tab.url,
          });
          existingUrls.add(tab.url);
          addedCount += 1;
        }

        const store = await captureBrowserBookmarks(now);
        return { store, folderId, folderTitle, addedCount, skippedCount };
      }
    } catch {
      // Fall back to plugin-local bookmark store if native Chrome bookmarks API fails.
    }
  }

  const current = await loadBookmarkStore();
  let roots = current.roots;
  if (roots.length === 0) {
    roots = [
      {
        id: '1',
        title: '书签栏',
        role: 'bookmarks_bar',
        children: [],
      },
    ];
  }

  const parentRoot =
    (targetParentId ? roots.find((r) => r.id === targetParentId) : undefined) ??
    roots.find((r) => r.role === 'bookmarks_bar') ??
    roots[0];

  const existingFolder = (parentRoot.children ?? []).find(
    (child) => typeof child.url !== 'string' && child.title === folderTitle
  );
  const folderId = existingFolder ? existingFolder.id : createId('fld');

  if (!existingFolder) {
    roots = insertBookmarkNodeInTree(roots, parentRoot.id, {
      id: folderId,
      parentId: parentRoot.id,
      title: folderTitle,
      dateAdded: now,
      children: [],
    });
  }

  const existingUrls = new Set(
    (existingFolder?.children ?? [])
      .map((item) => item.url)
      .filter((url): url is string => typeof url === 'string')
  );

  let addedCount = 0;
  let skippedCount = 0;
  for (const tab of group.tabs) {
    if (existingUrls.has(tab.url)) {
      skippedCount += 1;
      continue;
    }
    roots = insertBookmarkNodeInTree(roots, folderId, {
      id: createId('bm'),
      parentId: folderId,
      title: tab.title || tab.url,
      url: tab.url,
      dateAdded: now,
    });
    existingUrls.add(tab.url);
    addedCount += 1;
  }

  const next = updateStoreWithRoots(current, roots, now, current.source);
  await saveBookmarkStore(next);
  return { store: next, folderId, folderTitle, addedCount, skippedCount };
}
