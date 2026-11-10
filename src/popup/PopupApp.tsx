import { useCallback, useEffect, useState } from 'react';
import { Cloud, FolderOpen, Layers, MinusCircle, PanelTopClose } from 'lucide-react';
import { formatDateTime } from '../shared/formatters';
import { loadStore, subscribeStoreChanges } from '../shared/storage';
import { getExtensionOrigin, selectTabsToStash } from '../shared/tabService';
import { applyTheme, subscribeSystemTheme } from '../shared/theme';
import {
  DEFAULT_SYNC_RUNTIME_STATE,
  loadSyncRuntimeState,
  subscribeSyncRuntimeChanges,
} from '../shared/syncState';
import type {
  BackgroundMessage,
  StashResult,
  StashScope,
  SyncRuntimeState,
  ThemeMode,
} from '../shared/types';

interface WindowSummary {
  windowId?: number;
  allCount: number;
  currentCount: number;
  othersCount: number;
  savedGroups: number;
  savedTabs: number;
  syncEnabled: boolean;
  syncEmail: string | null;
  lastSyncedAt: number | null;
  theme: ThemeMode;
}

export function PopupApp() {
  const [summary, setSummary] = useState<WindowSummary | null>(null);
  const [syncRuntime, setSyncRuntime] = useState<SyncRuntimeState>(DEFAULT_SYNC_RUNTIME_STATE);
  const [busyScope, setBusyScope] = useState<StashScope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    const [tabs, store, runtime] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      loadStore(),
      loadSyncRuntimeState(),
    ]);
    const origin = getExtensionOrigin();

    const allSelection = selectTabsToStash(tabs, 'all', store.settings, origin);
    const currentSelection = selectTabsToStash(tabs, 'current', store.settings, origin);
    const othersSelection = selectTabsToStash(tabs, 'others', store.settings, origin);

    applyTheme(store.settings.theme);
    setSyncRuntime(runtime);
    setSummary({
      windowId: tabs[0]?.windowId,
      allCount: allSelection.tabIdsToClose.length,
      currentCount: currentSelection.tabIdsToClose.length,
      othersCount: othersSelection.tabIdsToClose.length,
      savedGroups: store.groups.length,
      savedTabs: store.groups.reduce((acc, grp) => acc + grp.tabs.length, 0),
      syncEnabled: store.sync.enabled,
      syncEmail: store.sync.accountEmail,
      lastSyncedAt: store.sync.lastSyncedAt,
      theme: store.settings.theme,
    });
  }, []);

  useEffect(() => {
    void refreshSummary();

    const unsubStore = subscribeStoreChanges((nextStore) => {
      applyTheme(nextStore.settings.theme);
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              savedGroups: nextStore.groups.length,
              savedTabs: nextStore.groups.reduce((acc, grp) => acc + grp.tabs.length, 0),
              syncEnabled: nextStore.sync.enabled,
              syncEmail: nextStore.sync.accountEmail,
              lastSyncedAt: nextStore.sync.lastSyncedAt,
              theme: nextStore.settings.theme,
            }
          : prev
      );
    });

    const unsubSync = subscribeSyncRuntimeChanges((nextRuntime) => {
      setSyncRuntime(nextRuntime);
    });

    return () => {
      unsubStore();
      unsubSync();
    };
  }, [refreshSummary]);

  const activeTheme = summary?.theme ?? 'system';
  useEffect(() => {
    applyTheme(activeTheme);
    if (activeTheme !== 'system') return;
    return subscribeSystemTheme(() => {
      applyTheme('system');
    });
  }, [activeTheme]);

  const handleStash = async (scope: StashScope) => {
    setBusyScope(scope);
    setNotice(null);
    try {
      const msg: BackgroundMessage = {
        type: 'STASH_TABS',
        scope,
        windowId: summary?.windowId,
      };
      const result = (await chrome.runtime.sendMessage(msg)) as StashResult | undefined;
      if (!result) {
        setNotice('后台服务未响应，请重试');
      } else if (!result.ok) {
        setNotice(`收纳失败：${result.error}`);
      } else if (result.stashedCount === 0) {
        setNotice('当前没有可收纳的网页标签页');
      } else {
        setNotice(`已成功收纳 ${result.stashedCount} 个标签页`);
        await refreshSummary();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyScope(null);
    }
  };

  const handleOpenManager = async () => {
    const msg: BackgroundMessage = {
      type: 'OPEN_MANAGER',
      windowId: summary?.windowId,
    };
    await chrome.runtime.sendMessage(msg);
    window.close();
  };

  const isBusy = busyScope !== null;

  const renderCloudHintText = () => {
    if (!summary?.syncEnabled) {
      return 'Google Drive 未连接 · 可在管理页授权同步';
    }
    if (syncRuntime.status === 'conflict') {
      return 'Drive 检测到同步冲突 · 请在管理页处理';
    }
    if (syncRuntime.status === 'auth-expired') {
      return 'Drive 授权已过期 · 请在管理页重新登录';
    }
    if (syncRuntime.status === 'syncing') {
      return 'Google Drive 正在自动同步...';
    }
    if (syncRuntime.pendingLocalChanges) {
      return '有本地变更待自动同步至 Google Drive';
    }
    if (summary.lastSyncedAt) {
      return `Drive 已同步 · ${formatDateTime(summary.lastSyncedAt)}`;
    }
    return `Drive 已连接 · ${summary.syncEmail || '可自动同步至云端'}`;
  };

  return (
    <div className="popup-root">
      <header className="popup-header">
        <div className="popup-brand">
          <div className="popup-logo" aria-hidden="true">
            <Layers size={18} />
          </div>
          <div>
            <h1>autoSyncTab</h1>
            <p className="popup-subtitle">
              已保存 {summary ? `${summary.savedGroups} 组 · ${summary.savedTabs} 个标签` : '...'}
            </p>
          </div>
        </div>
      </header>

      <main className="popup-actions">
        <button
          type="button"
          className="action-btn action-btn--primary"
          disabled={isBusy || !summary || summary.allCount === 0}
          onClick={() => void handleStash('all')}
        >
          <span className="action-btn__left">
            <PanelTopClose size={16} />
            <span>收纳当前窗口全部标签页</span>
          </span>
          <span className="action-badge">{summary ? summary.allCount : '-'}</span>
        </button>

        <button
          type="button"
          className="action-btn"
          disabled={isBusy || !summary || summary.currentCount === 0}
          onClick={() => void handleStash('current')}
        >
          <span className="action-btn__left">
            <MinusCircle size={16} />
            <span>仅收纳当前标签页</span>
          </span>
          <span className="action-badge">{summary ? summary.currentCount : '-'}</span>
        </button>

        <button
          type="button"
          className="action-btn"
          disabled={isBusy || !summary || summary.othersCount === 0}
          onClick={() => void handleStash('others')}
        >
          <span className="action-btn__left">
            <Layers size={16} />
            <span>收纳其他标签页</span>
          </span>
          <span className="action-badge">{summary ? summary.othersCount : '-'}</span>
        </button>

        {notice && (
          <div className="popup-notice" role="status">
            {notice}
          </div>
        )}
      </main>

      <footer className="popup-footer">
        <button type="button" className="manager-link-btn" onClick={() => void handleOpenManager()}>
          <FolderOpen size={15} />
          <span>打开标签页管理页</span>
        </button>
        <div
          className={`cloud-hint ${
            syncRuntime.status === 'conflict' || syncRuntime.status === 'auth-expired'
              ? 'cloud-hint--warn'
              : ''
          }`}
          title="可在管理页右上角进行 Google Drive 同步与快照管理"
        >
          <Cloud size={13} />
          <span>{renderCloudHintText()}</span>
        </div>
      </footer>
    </div>
  );
}
