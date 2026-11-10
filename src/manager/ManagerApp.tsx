import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Search, X } from 'lucide-react';
import {
  captureBrowserBookmarks,
  createDefaultBookmarkStore,
  loadBookmarkStore,
  saveTabGroupAsBookmarkFolder,
  subscribeBookmarkStoreChanges,
} from '../shared/bookmarks';
import { createSnapshot } from '../shared/snapshots';
import {
  createDefaultStore,
  loadStore,
  mergeImportedGroups,
  moveTabInStore,
  mutateStore,
  prependGroup,
  removeGroupFromStore,
  removeTabFromGroup,
  reorderGroupsInStore,
  subscribeStoreChanges,
  updateGroupInStore,
  updateSettingsInStore,
} from '../shared/storage';
import { cloudSyncAdapter } from '../shared/syncAdapter';
import {
  DEFAULT_SYNC_RUNTIME_STATE,
  loadSyncRuntimeState,
  subscribeSyncRuntimeChanges,
} from '../shared/syncState';
import { restoreSingleTab, restoreTabGroup } from '../shared/tabService';
import { applyTheme, getNextTheme, subscribeSystemTheme } from '../shared/theme';
import type {
  AppStoreData,
  BookmarkStoreData,
  ExtensionSettings,
  SyncRuntimeState,
  TabGroup,
  TabItem,
} from '../shared/types';
import { BookmarksView } from './components/BookmarksView';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { GroupCard, type DragItemPayload } from './components/GroupCard';
import { Header, type ManagerSection } from './components/Header';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsBar } from './components/SettingsBar';

function readInitialSection(): ManagerSection {
  if (typeof window !== 'undefined' && window.location.hash === '#bookmarks') {
    return 'bookmarks';
  }
  return 'tabs';
}

export function ManagerApp() {
  const [store, setStore] = useState<AppStoreData>(() => createDefaultStore());
  const [bookmarkStore, setBookmarkStore] = useState<BookmarkStoreData>(() =>
    createDefaultBookmarkStore()
  );
  const [syncRuntime, setSyncRuntime] = useState<SyncRuntimeState>(DEFAULT_SYNC_RUNTIME_STATE);
  const [hasValidToken, setHasValidToken] = useState(false);
  const [activeSection, setActiveSection] = useState<ManagerSection>(readInitialSection);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragItemPayload | null>(null);
  const [tabsNotice, setTabsNotice] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadStore(),
      loadBookmarkStore(),
      loadSyncRuntimeState(),
      cloudSyncAdapter.getStatus(),
    ]).then(([initial, initialBookmarks, runtime, driveStatus]) => {
      if (!mounted) return;
      setStore(initial);
      setBookmarkStore(initialBookmarks);
      setSyncRuntime(runtime);
      setHasValidToken(driveStatus.hasValidToken);
      applyTheme(initial.settings.theme);
      setLoading(false);

      const prepareBookmarks =
        initial.settings.autoCaptureBookmarks && initialBookmarks.roots.length === 0
          ? captureBrowserBookmarks(Date.now(), { skipIfEmptyCloud: true }).then((captured) => {
              if (mounted) setBookmarkStore(captured);
            })
          : Promise.resolve();

      if (initial.sync.enabled && initial.settings.autoSync) {
        void cloudSyncAdapter.syncAuto({ checkRemote: true, silent: true }).then((result) => {
          if (!mounted) return;
          if (result.outcome === 'pulled' || result.outcome === 'merged') {
            void loadStore().then((refreshed) => {
              if (mounted) setStore(refreshed);
            });
          }
        });

        void prepareBookmarks.then(() =>
          cloudSyncAdapter.syncBookmarksAuto({ silent: true }).then((res) => {
            if (!mounted) return;
            if (res.outcome === 'pulled') {
              void loadBookmarkStore().then((refreshed) => {
                if (mounted) setBookmarkStore(refreshed);
              });
            }
          })
        );
      } else {
        void prepareBookmarks;
      }
    });

    const unsubStore = subscribeStoreChanges((nextStore) => {
      if (mounted) {
        setStore(nextStore);
      }
    });

    const unsubBookmarks = subscribeBookmarkStoreChanges((nextBookmarks) => {
      if (mounted) {
        setBookmarkStore(nextBookmarks);
      }
    });

    const unsubRuntime = subscribeSyncRuntimeChanges((nextRuntime) => {
      if (mounted) {
        setSyncRuntime(nextRuntime);
      }
    });

    const handleHashChange = () => {
      setActiveSection(readInitialSection());
    };
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      mounted = false;
      unsubStore();
      unsubBookmarks();
      unsubRuntime();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    applyTheme(store.settings.theme);
    if (store.settings.theme !== 'system') return;
    return subscribeSystemTheme(() => {
      applyTheme('system');
    });
  }, [store.settings.theme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (showDriveModal) {
          setShowDriveModal(false);
        } else if (showImportExport) {
          setShowImportExport(false);
        } else if (searchQuery) {
          setSearchQuery('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, showDriveModal, showImportExport]);

  const totalTabs = useMemo(
    () => store.groups.reduce((acc, group) => acc + group.tabs.length, 0),
    [store.groups]
  );

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return store.groups;

    return store.groups
      .map((group) => {
        if (group.title.toLowerCase().includes(query)) {
          return group;
        }
        const matchingTabs = group.tabs.filter(
          (tab) =>
            tab.title.toLowerCase().includes(query) || tab.url.toLowerCase().includes(query)
        );
        if (matchingTabs.length === 0) return null;
        return {
          ...group,
          tabs: matchingTabs,
        };
      })
      .filter((group): group is TabGroup => group !== null);
  }, [searchQuery, store.groups]);

  const handleSectionChange = (section: ManagerSection) => {
    setActiveSection(section);
    setSearchQuery('');
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const nextUrl =
        section === 'bookmarks'
          ? `${window.location.pathname}${window.location.search}#bookmarks`
          : `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const handleRestoreGroup = async (group: TabGroup) => {
    await restoreTabGroup(group, store.settings.removeOnRestore);
    if (!group.locked && store.settings.removeOnRestore) {
      setStore((prev) => removeGroupFromStore(prev, group.id));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    const updated = await mutateStore((current) => removeGroupFromStore(current, groupId));
    setStore(updated);
  };

  const handleRenameGroup = async (groupId: string, title: string) => {
    const updated = await mutateStore((current) =>
      updateGroupInStore(current, groupId, { title })
    );
    setStore(updated);
  };

  const handleToggleLock = async (groupId: string, locked: boolean) => {
    const updated = await mutateStore((current) =>
      updateGroupInStore(current, groupId, { locked })
    );
    setStore(updated);
  };

  const handleRestoreTab = async (group: TabGroup, tab: TabItem) => {
    await restoreSingleTab(group.id, tab, group.locked, store.settings.removeOnRestore, false);
    if (!group.locked && store.settings.removeOnRestore) {
      setStore((prev) => removeTabFromGroup(prev, group.id, tab.id));
    }
  };

  const handleDeleteTab = async (groupId: string, tabId: string) => {
    const updated = await mutateStore((current) => removeTabFromGroup(current, groupId, tabId));
    setStore(updated);
  };

  const handleReorderGroup = async (sourceGroupId: string, targetGroupId: string) => {
    const updated = await mutateStore((current) =>
      reorderGroupsInStore(current, sourceGroupId, targetGroupId)
    );
    setStore(updated);
  };

  const handleMoveTab = async (
    sourceGroupId: string,
    tabId: string,
    targetGroupId: string,
    targetTabId?: string,
    position: 'before' | 'after' = 'before'
  ) => {
    const updated = await mutateStore((current) =>
      moveTabInStore(current, sourceGroupId, tabId, targetGroupId, targetTabId, position)
    );
    setStore(updated);
  };

  const handleUpdateSettings = async (patch: Partial<ExtensionSettings>) => {
    const updated = await mutateStore((current) => updateSettingsInStore(current, patch));
    setStore(updated);
  };

  const handleImportGroups = async (groups: TabGroup[], mode: 'prepend' | 'replace') => {
    if (mode === 'replace' && store.groups.length > 0) {
      await createSnapshot(store, 'pre-import', '覆盖导入前自动安全快照');
    }
    const updated = await mutateStore((current) => mergeImportedGroups(current, groups, mode));
    setStore(updated);
  };

  const handleConvertBookmarkFolderToGroup = async (folderTitle: string, tabs: TabItem[]) => {
    const updated = await mutateStore((current) => prependGroup(current, tabs, folderTitle).nextStore);
    setStore(updated);
  };

  const handleSaveGroupAsBookmarks = async (group: TabGroup) => {
    const result = await saveTabGroupAsBookmarkFolder(group);
    setBookmarkStore(result.store);
    if (result.addedCount > 0) {
      setTabsNotice(
        `已将「${result.folderTitle}」的 ${result.addedCount} 个链接加入书签栏${
          result.skippedCount > 0 ? `（跳过 ${result.skippedCount} 个已存在链接）` : ''
        }`
      );
    } else {
      setTabsNotice(`分组「${result.folderTitle}」内的链接已全部存在于书签栏中`);
    }
  };

  const normalizedQuery = searchQuery.trim();
  const filteredTabCount = filteredGroups.reduce((acc, grp) => acc + grp.tabs.length, 0);

  return (
    <div className="mgr-root">
      <Header
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        totalGroups={store.groups.length}
        totalTabs={totalTabs}
        totalBookmarks={bookmarkStore.totalCount}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onOpenImportExport={() => setShowImportExport(true)}
        onOpenDriveModal={() => setShowDriveModal(true)}
        theme={store.settings.theme}
        onCycleTheme={() =>
          void handleUpdateSettings({ theme: getNextTheme(store.settings.theme) })
        }
        sync={store.sync}
        syncRuntime={syncRuntime}
      />

      <main className="mgr-main">
        {store.sync.enabled && syncRuntime.status === 'conflict' && syncRuntime.conflict && (
          <div className="sync-alert-banner sync-alert-banner--conflict" role="alert">
            <span>
              <AlertTriangle size={16} />
              检测到 {syncRuntime.conflict.items.length}{' '}
              处多端同步冲突，已自动保存本地快照并暂停自动上传。
            </span>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setShowDriveModal(true)}
            >
              立即处理冲突
            </button>
          </div>
        )}

        {store.sync.enabled && syncRuntime.status === 'auth-expired' && (
          <div className="sync-alert-banner sync-alert-banner--warn" role="status">
            <span>
              <AlertTriangle size={16} />
              Google Drive 授权已过期，自动同步已暂停。
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setShowDriveModal(true)}
            >
              重新授权登录
            </button>
          </div>
        )}

        {showSettings && (
          <SettingsBar settings={store.settings} onUpdate={(p) => void handleUpdateSettings(p)} />
        )}

        {activeSection === 'bookmarks' ? (
          <BookmarksView
            bookmarkStore={bookmarkStore}
            searchQuery={searchQuery}
            autoCaptureEnabled={store.settings.autoCaptureBookmarks}
            syncEnabled={store.sync.enabled}
            hasValidToken={hasValidToken}
            onStoreChange={setBookmarkStore}
            onConvertFolderToGroup={handleConvertBookmarkFolderToGroup}
          />
        ) : (
          <>
            {tabsNotice && (
              <div className="modal-alert modal-alert--ok sync-alert-banner" role="status">
                <span>
                  <CheckCircle2 size={15} />
                  {tabsNotice}
                </span>
                <div className="bm-edit-actions">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => {
                      setTabsNotice(null);
                      handleSectionChange('bookmarks');
                    }}
                  >
                    查看书签列表
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="关闭提示"
                    onClick={() => setTabsNotice(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {normalizedQuery && (
              <div className="search-banner">
                <span>
                  <Search size={14} />
                  关键词「<strong>{normalizedQuery}</strong>」匹配 {filteredGroups.length} 个分组、
                  {filteredTabCount} 个标签页
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSearchQuery('')}
                >
                  清除筛选
                </button>
              </div>
            )}

            {loading ? (
              <div className="empty-state">正在读取本地标签页记录...</div>
            ) : store.groups.length === 0 ? (
              <section className="empty-state">
                <div className="empty-state__icon" aria-hidden="true">
                  <Layers size={34} />
                </div>
                <h2>还没有已收纳的标签页</h2>
                <p>
                  点击浏览器右上角的 <strong>autoSyncTab</strong> 图标，或直接在网页空白处点击右键选择「收纳当前窗口所有标签页」即可开始使用。
                </p>
              </section>
            ) : filteredGroups.length === 0 ? (
              <section className="empty-state">
                <div className="empty-state__icon" aria-hidden="true">
                  <Search size={30} />
                </div>
                <h2>没有找到匹配的标签页</h2>
                <p>换个关键词试试，或清空搜索条件查看全部分组。</p>
              </section>
            ) : (
              <div className="group-list">
                {filteredGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    allowDrag={!normalizedQuery}
                    activeDrag={activeDrag}
                    onDragStartItem={setActiveDrag}
                    onDragEndItem={() => setActiveDrag(null)}
                    onReorderGroup={(srcId, tgtId) => void handleReorderGroup(srcId, tgtId)}
                    onMoveTab={(srcGid, tid, tgtGid, tgtTid, pos) =>
                      void handleMoveTab(srcGid, tid, tgtGid, tgtTid, pos)
                    }
                    onRestoreGroup={(grp) => void handleRestoreGroup(grp)}
                    onSaveGroupAsBookmarks={handleSaveGroupAsBookmarks}
                    onDeleteGroup={(id) => void handleDeleteGroup(id)}
                    onRenameGroup={(id, title) => void handleRenameGroup(id, title)}
                    onToggleLock={(id, locked) => void handleToggleLock(id, locked)}
                    onRestoreTab={(grp, tab) => void handleRestoreTab(grp, tab)}
                    onDeleteTab={(gid, tid) => void handleDeleteTab(gid, tid)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {showImportExport && (
        <ImportExportModal
          store={store}
          onClose={() => setShowImportExport(false)}
          onImportGroups={handleImportGroups}
        />
      )}

      {showDriveModal && (
        <GoogleDriveModal
          autoSync={store.settings.autoSync}
          syncRuntime={syncRuntime}
          onToggleAutoSync={(enabled) => handleUpdateSettings({ autoSync: enabled })}
          onClose={() => setShowDriveModal(false)}
          onSyncUpdated={async () => {
            const [latest, latestBookmarks, latestRuntime, driveStatus] = await Promise.all([
              loadStore(),
              loadBookmarkStore(),
              loadSyncRuntimeState(),
              cloudSyncAdapter.getStatus(),
            ]);
            setStore(latest);
            setBookmarkStore(latestBookmarks);
            setSyncRuntime(latestRuntime);
            setHasValidToken(driveStatus.hasValidToken);
          }}
        />
      )}
    </div>
  );
}
