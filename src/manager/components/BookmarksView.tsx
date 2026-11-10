import { useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  captureBrowserBookmarks,
  collectBookmarkFolders,
  collectFolderBookmarksAsTabs,
  createBookmarkFolder,
  createBookmarkItem,
  exportBookmarksToHtml,
  filterBookmarkTree,
  findDuplicateBookmarkUrls,
  moveBookmarkEntry,
  removeBookmarkEntry,
  updateBookmarkEntry,
  type BookmarkFolderOption,
} from '../../shared/bookmarks';
import { formatDateTime, getDomain } from '../../shared/formatters';
import { cloudSyncAdapter } from '../../shared/syncAdapter';
import type { BookmarkNode, BookmarkStoreData, TabItem } from '../../shared/types';
import { SiteFavicon } from './SiteFavicon';

interface BookmarksViewProps {
  bookmarkStore: BookmarkStoreData;
  searchQuery: string;
  autoCaptureEnabled: boolean;
  syncEnabled: boolean;
  hasValidToken: boolean;
  onStoreChange: (next: BookmarkStoreData) => void;
  onConvertFolderToGroup: (folderTitle: string, tabs: TabItem[]) => Promise<void>;
}

function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function collectAllFolderIds(nodes: BookmarkNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (typeof node.url === 'string') continue;
    ids.push(node.id);
    if (node.children) {
      ids.push(...collectAllFolderIds(node.children));
    }
  }
  return ids;
}

function countBookmarksInSubtree(node: BookmarkNode): number {
  let count = 0;
  for (const child of node.children ?? []) {
    if (typeof child.url === 'string') count += 1;
    else count += countBookmarksInSubtree(child);
  }
  return count;
}

interface FolderBranchProps {
  node: BookmarkNode;
  parentId: string;
  depth: number;
  forceExpand: boolean;
  expandedIds: Set<string>;
  duplicateUrls: Set<string>;
  folderOptions: BookmarkFolderOption[];
  copiedId: string | null;
  busy: boolean;
  onToggleExpand: (id: string) => void;
  onOpenAllInFolder: (folder: BookmarkNode) => void;
  onConvertToGroup: (folderId: string) => void;
  onQuickAddInFolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, title: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onOpenBookmark: (url: string) => void;
  onCopyUrl: (id: string, url: string) => void;
  onUpdateBookmark: (
    id: string,
    currentParentId: string,
    title: string,
    url: string,
    nextParentId: string
  ) => Promise<void>;
  onDeleteBookmark: (id: string) => Promise<void>;
}

function FolderBranch({
  node,
  parentId,
  depth,
  forceExpand,
  expandedIds,
  duplicateUrls,
  folderOptions,
  copiedId,
  busy,
  onToggleExpand,
  onOpenAllInFolder,
  onConvertToGroup,
  onQuickAddInFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenBookmark,
  onCopyUrl,
  onUpdateBookmark,
  onDeleteBookmark,
}: FolderBranchProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editParentId, setEditParentId] = useState(node.id);

  const isExpanded = forceExpand || expandedIds.has(node.id);
  const children = node.children ?? [];
  const bookmarkItems = children.filter((child) => typeof child.url === 'string');
  const subFolders = children.filter((child) => typeof child.url !== 'string');
  const totalInSubtree = countBookmarksInSubtree(node);
  const isRootFolder = Boolean(node.role);

  const commitRename = () => {
    setRenaming(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== node.title) {
      void onRenameFolder(node.id, trimmed);
    }
  };

  const startEditBookmark = (bm: BookmarkNode) => {
    setEditingBookmarkId(bm.id);
    setEditTitle(bm.title);
    setEditUrl(bm.url ?? '');
    setEditParentId(bm.parentId || node.id || parentId);
  };

  const commitEditBookmark = async (bmId: string) => {
    const cleanUrl = normalizeInputUrl(editUrl);
    if (!cleanUrl) return;
    await onUpdateBookmark(bmId, node.id, editTitle.trim() || cleanUrl, cleanUrl, editParentId);
    setEditingBookmarkId(null);
  };

  return (
    <section
      className={`bm-folder ${depth === 0 ? 'bm-folder--root' : 'bm-folder--nested'}`}
      data-folder-id={node.id}
    >
      <header className="bm-folder-header">
        <div className="bm-folder-header__left">
          <button
            type="button"
            className="icon-btn"
            aria-label={isExpanded ? `折叠文件夹 ${node.title}` : `展开文件夹 ${node.title}`}
            onClick={() => onToggleExpand(node.id)}
          >
            {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>

          {isExpanded ? (
            <FolderOpen size={16} className="bm-folder-icon" aria-hidden="true" />
          ) : (
            <Folder size={16} className="bm-folder-icon" aria-hidden="true" />
          )}

          {renaming ? (
            <input
              type="text"
              className="group-title-input"
              aria-label="编辑文件夹名称"
              value={draftTitle}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraftTitle(node.title);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <h3
              className="bm-folder-title"
              onClick={() => onToggleExpand(node.id)}
              onDoubleClick={() => {
                if (!isRootFolder) {
                  setDraftTitle(node.title);
                  setRenaming(true);
                }
              }}
            >
              {node.title}
            </h3>
          )}

          <span className="pill">{totalInSubtree} 条</span>
        </div>

        <div className="bm-folder-actions">
          {totalInSubtree > 0 && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="在新标签页打开此文件夹内全部书签"
                onClick={() => onOpenAllInFolder(node)}
              >
                <ExternalLink size={13} />
                <span>打开全部</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="将此文件夹内的书签复制为一个标签分组"
                onClick={() => onConvertToGroup(node.id)}
              >
                <Layers size={13} />
                <span>转为标签组</span>
              </button>
            </>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            title="在此文件夹新增书签"
            onClick={() => onQuickAddInFolder(node.id)}
          >
            <Plus size={13} />
            <span>添加</span>
          </button>

          {!isRootFolder && (
            <>
              <button
                type="button"
                className="icon-btn"
                title="重命名文件夹"
                aria-label={`重命名文件夹 ${node.title}`}
                onClick={() => {
                  setDraftTitle(node.title);
                  setRenaming(true);
                }}
              >
                <Pencil size={13} />
              </button>
              {confirmDelete ? (
                <div className="bm-confirm-inline">
                  <button
                    type="button"
                    className="btn btn--danger-ghost btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirmDelete(false);
                      void onDeleteFolder(node.id);
                    }}
                  >
                    确认删除
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="删除文件夹"
                  aria-label={`删除文件夹 ${node.title}`}
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {isExpanded && (
        <div className="bm-folder-body">
          {bookmarkItems.length === 0 && subFolders.length === 0 ? (
            <div className="bm-empty-folder">此文件夹暂无书签</div>
          ) : (
            <>
              {bookmarkItems.length > 0 && (
                <ul className="tab-list">
                  {bookmarkItems.map((bm) => {
                    const url = bm.url ?? '';
                    const isDup = duplicateUrls.has(url);

                    if (editingBookmarkId === bm.id) {
                      return (
                        <li key={bm.id} className="bm-edit-row">
                          <input
                            type="text"
                            className="drive-input"
                            aria-label="编辑书签标题"
                            placeholder="书签标题"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                          />
                          <input
                            type="text"
                            className="drive-input drive-input--mono"
                            aria-label="编辑书签网址"
                            placeholder="https://example.com"
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                          />
                          <select
                            className="bm-select"
                            aria-label="移动书签到文件夹"
                            value={editParentId}
                            onChange={(e) => setEditParentId(e.target.value)}
                          >
                            {folderOptions.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.pathLabel}
                              </option>
                            ))}
                          </select>
                          <div className="bm-edit-actions">
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              disabled={busy || !editUrl.trim()}
                              onClick={() => void commitEditBookmark(bm.id)}
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setEditingBookmarkId(null)}
                            >
                              取消
                            </button>
                          </div>
                        </li>
                      );
                    }

                    return (
                      <li key={bm.id} className="tab-row">
                        <button
                          type="button"
                          className="tab-link-btn"
                          title={url}
                          onClick={() => onOpenBookmark(url)}
                        >
                          <SiteFavicon />
                          <span className="tab-info">
                            <span className="tab-title">{bm.title}</span>
                            <span className="tab-domain">{getDomain(url)}</span>
                          </span>
                          {isDup && <span className="pill pill--locked">重复</span>}
                        </button>

                        <div className="tab-row-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title="编辑或移动书签"
                            aria-label={`编辑 ${bm.title}`}
                            onClick={() => startEditBookmark(bm)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="复制链接"
                            aria-label={`复制 ${bm.title} 的链接`}
                            onClick={() => onCopyUrl(bm.id, url)}
                          >
                            {copiedId === bm.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            title="删除书签"
                            aria-label={`删除 ${bm.title}`}
                            disabled={busy}
                            onClick={() => void onDeleteBookmark(bm.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {subFolders.length > 0 && (
                <div className="bm-subfolders">
                  {subFolders.map((sub) => (
                    <FolderBranch
                      key={sub.id}
                      node={sub}
                      parentId={node.id}
                      depth={depth + 1}
                      forceExpand={forceExpand}
                      expandedIds={expandedIds}
                      duplicateUrls={duplicateUrls}
                      folderOptions={folderOptions}
                      copiedId={copiedId}
                      busy={busy}
                      onToggleExpand={onToggleExpand}
                      onOpenAllInFolder={onOpenAllInFolder}
                      onConvertToGroup={onConvertToGroup}
                      onQuickAddInFolder={onQuickAddInFolder}
                      onRenameFolder={onRenameFolder}
                      onDeleteFolder={onDeleteFolder}
                      onOpenBookmark={onOpenBookmark}
                      onCopyUrl={onCopyUrl}
                      onUpdateBookmark={onUpdateBookmark}
                      onDeleteBookmark={onDeleteBookmark}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function BookmarksView({
  bookmarkStore,
  searchQuery,
  autoCaptureEnabled,
  syncEnabled,
  hasValidToken,
  onStoreChange,
  onConvertFolderToGroup,
}: BookmarksViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(bookmarkStore.roots.map((r) => r.id))
  );
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [showAddForm, setShowAddForm] = useState<'bookmark' | 'folder' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const folderOptions = useMemo(
    () => collectBookmarkFolders(bookmarkStore.roots),
    [bookmarkStore.roots]
  );

  const duplicateUrls = useMemo(
    () => findDuplicateBookmarkUrls(bookmarkStore.roots),
    [bookmarkStore.roots]
  );

  const filteredRoots = useMemo(
    () => filterBookmarkTree(bookmarkStore.roots, searchQuery, onlyDuplicates),
    [bookmarkStore.roots, searchQuery, onlyDuplicates]
  );

  const effectiveExpandedIds = useMemo(() => {
    if (expandedIds.size > 0) return expandedIds;
    return new Set(bookmarkStore.roots.map((r) => r.id));
  }, [expandedIds, bookmarkStore.roots]);

  const effectiveTargetFolderId =
    targetFolderId && folderOptions.some((f) => f.id === targetFolderId)
      ? targetFolderId
      : folderOptions[0]?.id ?? '';

  const isFiltering = Boolean(searchQuery.trim()) || onlyDuplicates;
  const isBusy = busyAction !== null;

  const handleToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev.size > 0 ? prev : bookmarkStore.roots.map((r) => r.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedIds(new Set(collectAllFolderIds(bookmarkStore.roots)));
  };

  const handleCollapseAll = () => {
    // Keep a single sentinel so size > 0 and all folders collapse cleanly.
    setExpandedIds(new Set(['__collapsed__']));
  };

  const handleCaptureNow = async () => {
    setBusyAction('capture');
    setFeedback(null);
    try {
      const captured = await captureBrowserBookmarks();
      onStoreChange(captured);
      setExpandedIds(new Set(captured.roots.map((r) => r.id)));
      setFeedback({
        type: 'ok',
        text: `已从当前浏览器同步 ${captured.folderCount} 个文件夹、${captured.totalCount} 条书签。`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '读取浏览器书签失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCloudUpload = async () => {
    setBusyAction('upload');
    setFeedback(null);
    try {
      const summary = await cloudSyncAdapter.backupBookmarks();
      setFeedback({
        type: 'ok',
        text: `已将 ${summary.bookmarkCount} 条书签备份至 Google Drive（autosynctab-bookmarks.json）。`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '书签上传云端失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCloudPull = async () => {
    setBusyAction('pull');
    setFeedback(null);
    try {
      const summary = await cloudSyncAdapter.pullBookmarks();
      setFeedback({
        type: 'ok',
        text: `已从 Google Drive 拉取 ${summary.bookmarkCount} 条书签（仅更新插件书签列表，未改写原生书签栏）。`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '从云端拉取书签失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportHtml = () => {
    const html = exportBookmarksToHtml(bookmarkStore.roots);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `autosynctab-bookmarks-${new Date().toISOString().slice(0, 10)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateSubmit = async () => {
    if (!effectiveTargetFolderId) return;
    setBusyAction('create');
    setFeedback(null);
    try {
      if (showAddForm === 'bookmark') {
        const cleanUrl = normalizeInputUrl(newUrl);
        if (!cleanUrl) {
          setFeedback({ type: 'error', text: '请输入书签网址' });
          return;
        }
        const next = await createBookmarkItem(
          effectiveTargetFolderId,
          newTitle.trim() || cleanUrl,
          cleanUrl
        );
        onStoreChange(next);
        setFeedback({ type: 'ok', text: '已新增书签。' });
      } else if (showAddForm === 'folder') {
        const name = newTitle.trim();
        if (!name) {
          setFeedback({ type: 'error', text: '请输入文件夹名称' });
          return;
        }
        const next = await createBookmarkFolder(effectiveTargetFolderId, name);
        onStoreChange(next);
        setFeedback({ type: 'ok', text: `已新建文件夹「${name}」。` });
      }
      setNewTitle('');
      setNewUrl('');
      setShowAddForm(null);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '创建失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenBookmark = (url: string) => {
    void chrome.tabs.create({ url, active: true });
  };

  const handleOpenAllInFolder = (folder: BookmarkNode) => {
    const collected = collectFolderBookmarksAsTabs([folder], folder.id);
    if (!collected) return;
    for (const item of collected.tabs) {
      void chrome.tabs.create({ url: item.url, active: false });
    }
  };

  const handleConvertToGroup = async (folderId: string) => {
    const collected = collectFolderBookmarksAsTabs(bookmarkStore.roots, folderId);
    if (!collected || collected.tabs.length === 0) {
      setFeedback({ type: 'error', text: '该文件夹下没有可转为标签组的可访问网页链接。' });
      return;
    }
    await onConvertFolderToGroup(collected.folderTitle, collected.tabs);
    setFeedback({
      type: 'ok',
      text: `已将「${collected.folderTitle}」的 ${collected.tabs.length} 个链接加入已收纳标签页分组。`,
    });
  };

  const handleCopyUrl = (id: string, url: string) => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="bm-view">
      <section className="bm-toolbar">
        <div className="bm-toolbar__meta">
          <div className="bm-toolbar__title">
            <Bookmark size={16} />
            <span>
              共 <strong>{bookmarkStore.folderCount}</strong> 个文件夹 ·{' '}
              <strong>{bookmarkStore.totalCount}</strong> 条书签
            </span>
            <span className="pill">
              {bookmarkStore.source === 'cloud' ? '云端同步视图' : '浏览器同步'}
            </span>
          </div>
          <div className="bm-toolbar__sub">
            {autoCaptureEnabled ? '已开启自动抓取浏览器书签变更' : '自动抓取已关闭'}
            {bookmarkStore.lastCapturedAt
              ? ` · 最近抓取 ${formatDateTime(bookmarkStore.lastCapturedAt)}`
              : ''}
            {bookmarkStore.lastSyncedAt
              ? ` · 云端同步 ${formatDateTime(bookmarkStore.lastSyncedAt)}`
              : ''}
          </div>
        </div>

        <div className="bm-toolbar__actions">
          <button
            type="button"
            className="btn btn--primary-soft btn--sm"
            disabled={isBusy}
            onClick={() => void handleCaptureNow()}
          >
            <RefreshCw size={13} className={busyAction === 'capture' ? 'spin-icon' : ''} />
            <span>立即同步浏览器</span>
          </button>

          {syncEnabled && (
            <>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={isBusy || !hasValidToken || bookmarkStore.totalCount === 0}
                onClick={() => void handleCloudUpload()}
              >
                <CloudUpload size={13} />
                <span>上传云端</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={isBusy || !hasValidToken}
                onClick={() => void handleCloudPull()}
              >
                <CloudDownload size={13} />
                <span>拉取云端</span>
              </button>
            </>
          )}

          <button
            type="button"
            className={`btn btn--secondary btn--sm ${showAddForm === 'bookmark' ? 'btn--active' : ''}`}
            disabled={folderOptions.length === 0}
            onClick={() =>
              setShowAddForm((prev) => (prev === 'bookmark' ? null : 'bookmark'))
            }
          >
            <Plus size={13} />
            <span>新增书签</span>
          </button>

          <button
            type="button"
            className={`btn btn--secondary btn--sm ${showAddForm === 'folder' ? 'btn--active' : ''}`}
            disabled={folderOptions.length === 0}
            onClick={() =>
              setShowAddForm((prev) => (prev === 'folder' ? null : 'folder'))
            }
          >
            <FolderPlus size={13} />
            <span>新建文件夹</span>
          </button>

          {(duplicateUrls.size > 0 || onlyDuplicates) && (
            <button
              type="button"
              className={`btn btn--secondary btn--sm ${onlyDuplicates ? 'btn--active' : ''}`}
              onClick={() => setOnlyDuplicates((v) => !v)}
            >
              <span>重复书签 ({duplicateUrls.size})</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={bookmarkStore.totalCount === 0}
            onClick={handleExportHtml}
          >
            <Download size={13} />
            <span>导出 HTML</span>
          </button>

          {bookmarkStore.roots.length > 0 && (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleExpandAll}>
                全部展开
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleCollapseAll}>
                全部折叠
              </button>
            </>
          )}
        </div>
      </section>

      {showAddForm && (
        <section className="bm-create-panel" aria-label={showAddForm === 'bookmark' ? '新增书签' : '新建文件夹'}>
          <input
            type="text"
            className="drive-input"
            placeholder={showAddForm === 'bookmark' ? '书签标题（可选）' : '文件夹名称'}
            aria-label={showAddForm === 'bookmark' ? '新书签标题' : '新文件夹名称'}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          {showAddForm === 'bookmark' && (
            <input
              type="text"
              className="drive-input drive-input--mono"
              placeholder="网址，例如 https://react.dev"
              aria-label="新书签网址"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
            />
          )}
          <select
            className="bm-select"
            aria-label="选择目标文件夹"
            value={effectiveTargetFolderId}
            onChange={(e) => setTargetFolderId(e.target.value)}
          >
            {folderOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.pathLabel}
              </option>
            ))}
          </select>
          <div className="bm-edit-actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={isBusy}
              onClick={() => void handleCreateSubmit()}
            >
              确认创建
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowAddForm(null)}
            >
              取消
            </button>
          </div>
        </section>
      )}

      {feedback && (
        <div
          className={`modal-alert ${feedback.type === 'error' ? 'modal-alert--error' : 'modal-alert--ok'}`}
          role="status"
        >
          {feedback.text}
        </div>
      )}

      {bookmarkStore.roots.length === 0 || bookmarkStore.totalCount === 0 ? (
        <section className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">
            <Bookmark size={32} />
          </div>
          <h2>暂无同步的书签</h2>
          <p>
            点击上方「立即同步浏览器」抓取当前 Chrome 账号书签；若你已在其他浏览器将书签上传至 Google Drive，也可点击「拉取云端」直接在插件内打开书签列表。
          </p>
        </section>
      ) : filteredRoots.length === 0 ? (
        <section className="empty-state">
          <h2>没有找到匹配的书签</h2>
          <p>尝试更换搜索关键词或关闭筛选条件。</p>
        </section>
      ) : (
        <div className="bm-tree">
          {filteredRoots.map((root) => (
            <FolderBranch
              key={root.id}
              node={root}
              parentId={root.id}
              depth={0}
              forceExpand={isFiltering}
              expandedIds={effectiveExpandedIds}
              duplicateUrls={duplicateUrls}
              folderOptions={folderOptions}
              copiedId={copiedId}
              busy={isBusy}
              onToggleExpand={handleToggleExpand}
              onOpenAllInFolder={handleOpenAllInFolder}
              onConvertToGroup={(fid) => void handleConvertToGroup(fid)}
              onQuickAddInFolder={(fid) => {
                setTargetFolderId(fid);
                setShowAddForm('bookmark');
              }}
              onRenameFolder={async (fid, title) => {
                setBusyAction(`rename-${fid}`);
                try {
                  onStoreChange(await updateBookmarkEntry(fid, { title }));
                } finally {
                  setBusyAction(null);
                }
              }}
              onDeleteFolder={async (fid) => {
                setBusyAction(`del-${fid}`);
                try {
                  onStoreChange(await removeBookmarkEntry(fid, true));
                } finally {
                  setBusyAction(null);
                }
              }}
              onOpenBookmark={handleOpenBookmark}
              onCopyUrl={handleCopyUrl}
              onUpdateBookmark={async (id, currParent, title, url, nextParent) => {
                setBusyAction(`upd-${id}`);
                try {
                  let updated = await updateBookmarkEntry(id, { title, url });
                  if (nextParent && nextParent !== currParent) {
                    updated = await moveBookmarkEntry(id, nextParent);
                  }
                  onStoreChange(updated);
                } finally {
                  setBusyAction(null);
                }
              }}
              onDeleteBookmark={async (id) => {
                setBusyAction(`del-${id}`);
                try {
                  onStoreChange(await removeBookmarkEntry(id, false));
                } finally {
                  setBusyAction(null);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
