import { useCallback, useEffect, useState } from 'react';
import { Cloud, FolderOpen, Layers, MinusCircle, PanelTopClose } from 'lucide-react';
import { formatDateTime } from '../shared/formatters';
import { loadStore } from '../shared/storage';
import { getExtensionOrigin, selectTabsToStash } from '../shared/tabService';
import type { BackgroundMessage, StashResult, StashScope } from '../shared/types';

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
}

export function PopupApp() {
  const [summary, setSummary] = useState<WindowSummary | null>(null);
  const [busyScope, setBusyScope] = useState<StashScope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    const [tabs, store] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      loadStore(),
    ]);
    const origin = getExtensionOrigin();

    const allSelection = selectTabsToStash(tabs, 'all', store.settings, origin);
    const currentSelection = selectTabsToStash(tabs, 'current', store.settings, origin);
    const othersSelection = selectTabsToStash(tabs, 'others', store.settings, origin);

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
    });
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

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
        <div className="cloud-hint" title="可在管理页右上角进行 Google Drive 备份与恢复">
          <Cloud size={13} />
          <span>
            {summary?.syncEnabled
              ? summary.lastSyncedAt
                ? `Drive 已连接 · 上次同步 ${formatDateTime(summary.lastSyncedAt)}`
                : `Drive 已连接 · ${summary.syncEmail || '可备份至云端'}`
              : 'Google Drive 未连接 · 可在管理页授权同步'}
          </span>
        </div>
      </footer>
    </div>
  );
}
