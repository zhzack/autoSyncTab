import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Layers, Search } from 'lucide-react';
import { createSnapshot } from '../shared/snapshots';
import {
  createDefaultStore,
  loadStore,
  mergeImportedGroups,
  moveTabInStore,
  mutateStore,
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
import type { AppStoreData, ExtensionSettings, SyncRuntimeState, TabGroup, TabItem } from '../shared/types';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { GroupCard, type DragItemPayload } from './components/GroupCard';
import { Header } from './components/Header';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsBar } from './components/SettingsBar';

export function ManagerApp() {
  const [store, setStore] = useState<AppStoreData>(() => createDefaultStore());
  const [syncRuntime, setSyncRuntime] = useState<SyncRuntimeState>(DEFAULT_SYNC_RUNTIME_STATE);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragItemPayload | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadStore(), loadSyncRuntimeState()]).then(([initial, runtime]) => {
      if (!mounted) return;
      setStore(initial);
      setSyncRuntime(runtime);
      applyTheme(initial.settings.theme);
      setLoading(false);

      if (initial.sync.enabled && initial.settings.autoSync) {
        void cloudSyncAdapter.syncAuto({ checkRemote: true, silent: true }).then((result) => {
          if (!mounted) return;
          if (result.outcome === 'pulled' || result.outcome === 'merged') {
            void loadStore().then((refreshed) => {
              if (mounted) setStore(refreshed);
            });
          }
        });
      }
    });

    const unsubStore = subscribeStoreChanges((nextStore) => {
      if (mounted) {
        setStore(nextStore);
      }
    });

    const unsubRuntime = subscribeSyncRuntimeChanges((nextRuntime) => {
      if (mounted) {
        setSyncRuntime(nextRuntime);
      }
    });

    return () => {
      mounted = false;
      unsubStore();
      unsubRuntime();
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

  const normalizedQuery = searchQuery.trim();
  const filteredTabCount = filteredGroups.reduce((acc, grp) => acc + grp.tabs.length, 0);

  return (
    <div className="mgr-root">
      <Header
        totalGroups={store.groups.length}
        totalTabs={totalTabs}
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
                onDeleteGroup={(id) => void handleDeleteGroup(id)}
                onRenameGroup={(id, title) => void handleRenameGroup(id, title)}
                onToggleLock={(id, locked) => void handleToggleLock(id, locked)}
                onRestoreTab={(grp, tab) => void handleRestoreTab(grp, tab)}
                onDeleteTab={(gid, tid) => void handleDeleteTab(gid, tid)}
              />
            ))}
          </div>
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
            const [latest, latestRuntime] = await Promise.all([
              loadStore(),
              loadSyncRuntimeState(),
            ]);
            setStore(latest);
            setSyncRuntime(latestRuntime);
          }}
        />
      )}
    </div>
  );
}
