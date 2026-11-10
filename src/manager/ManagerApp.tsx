import { useEffect, useMemo, useState } from 'react';
import { Layers, Search } from 'lucide-react';
import {
  createDefaultStore,
  loadStore,
  mergeImportedGroups,
  mutateStore,
  removeGroupFromStore,
  removeTabFromGroup,
  subscribeStoreChanges,
  updateGroupInStore,
  updateSettingsInStore,
} from '../shared/storage';
import { restoreSingleTab, restoreTabGroup } from '../shared/tabService';
import type { AppStoreData, ExtensionSettings, TabGroup, TabItem } from '../shared/types';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { GroupCard } from './components/GroupCard';
import { Header } from './components/Header';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsBar } from './components/SettingsBar';

export function ManagerApp() {
  const [store, setStore] = useState<AppStoreData>(() => createDefaultStore());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadStore().then((initial) => {
      if (!mounted) return;
      setStore(initial);
      setLoading(false);
    });

    const unsubscribe = subscribeStoreChanges((nextStore) => {
      if (mounted) {
        setStore(nextStore);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

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

  const handleUpdateSettings = async (patch: Partial<ExtensionSettings>) => {
    const updated = await mutateStore((current) => updateSettingsInStore(current, patch));
    setStore(updated);
  };

  const handleImportGroups = async (groups: TabGroup[], mode: 'prepend' | 'replace') => {
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
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onOpenImportExport={() => setShowImportExport(true)}
        onOpenDriveModal={() => setShowDriveModal(true)}
        sync={store.sync}
      />

      <main className="mgr-main">
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
          onClose={() => setShowDriveModal(false)}
          onSyncUpdated={async () => {
            const latest = await loadStore();
            setStore(latest);
          }}
        />
      )}
    </div>
  );
}
