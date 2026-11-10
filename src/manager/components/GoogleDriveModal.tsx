import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  GitMerge,
  History,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { formatDateTime } from '../../shared/formatters';
import {
  createSnapshot,
  deleteSnapshot,
  loadSnapshots,
  restoreSnapshot,
} from '../../shared/snapshots';
import { DEFAULT_GOOGLE_CLIENT_ID, loadStore } from '../../shared/storage';
import { cloudSyncAdapter } from '../../shared/syncAdapter';
import type {
  ConflictResolutionStrategy,
  DriveStatusSnapshot,
  SnapshotReason,
  StoreSnapshot,
  SyncConflictReason,
  SyncRestoreMode,
  SyncRuntimeState,
} from '../../shared/types';

interface GoogleDriveModalProps {
  autoSync: boolean;
  syncRuntime: SyncRuntimeState;
  onToggleAutoSync: (enabled: boolean) => Promise<void> | void;
  onClose: () => void;
  onSyncUpdated: () => Promise<void> | void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSnapshotReason(reason: SnapshotReason): string {
  switch (reason) {
    case 'manual':
      return '手动创建';
    case 'pre-restore':
      return '云端恢复前';
    case 'pre-auto-sync':
      return '自动同步前';
    case 'pre-conflict':
      return '冲突保护';
    case 'pre-import':
      return '覆盖导入前';
    default:
      return '历史快照';
  }
}

function formatConflictReason(reason: SyncConflictReason): string {
  switch (reason) {
    case 'both-modified':
      return '本地与云端均有修改';
    case 'local-edited-remote-deleted':
      return '本地已修改，云端已删除';
    case 'remote-edited-local-deleted':
      return '云端已修改，本地已删除';
  }
}

export function GoogleDriveModal({
  autoSync,
  syncRuntime,
  onToggleAutoSync,
  onClose,
  onSyncUpdated,
}: GoogleDriveModalProps) {
  const [activeTab, setActiveTab] = useState<'sync' | 'snapshots'>('sync');
  const [status, setStatus] = useState<DriveStatusSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<StoreSnapshot[]>([]);
  const [clientIdInput, setClientIdInput] = useState(DEFAULT_GOOGLE_CLIENT_ID);
  const [restoreMode, setRestoreMode] = useState<SyncRestoreMode>('merge');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const loadModalData = useCallback(async () => {
    try {
      const [nextStatus, nextSnapshots] = await Promise.all([
        cloudSyncAdapter.getStatus(),
        loadSnapshots(),
      ]);
      setStatus(nextStatus);
      setSnapshots(nextSnapshots);
      setClientIdInput(nextStatus.clientId || DEFAULT_GOOGLE_CLIENT_ID);
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void loadModalData();
  }, [loadModalData]);

  const handleCopyRedirectUri = async () => {
    const uri = status?.redirectUri || cloudSyncAdapter.getRedirectUri();
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 1800);
    } catch {
      setFeedback({ type: 'error', text: '剪贴板写入失败，请手动选中复制重定向 URI' });
    }
  };

  const handleSaveClientId = async () => {
    setBusyAction('save-client');
    setFeedback(null);
    try {
      const nextStatus = await cloudSyncAdapter.saveClientId(clientIdInput);
      setStatus(nextStatus);
      setClientIdInput(nextStatus.clientId);
      setFeedback({ type: 'ok', text: 'OAuth Client ID 已保存，现在可以直接点击登录。' });
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnect = async () => {
    setBusyAction('connect');
    setFeedback(null);
    try {
      const nextStatus = await cloudSyncAdapter.connect(
        clientIdInput.trim() || DEFAULT_GOOGLE_CLIENT_ID
      );
      setStatus(nextStatus);
      await onSyncUpdated();
      setFeedback({
        type: 'ok',
        text: nextStatus.sync.accountEmail
          ? `已授权连接 Google 账号：${nextStatus.sync.accountEmail}`
          : '已成功授权连接 Google Drive！',
      });
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnect = async () => {
    setBusyAction('disconnect');
    setFeedback(null);
    try {
      const nextStatus = await cloudSyncAdapter.disconnect();
      setStatus(nextStatus);
      await onSyncUpdated();
      setFeedback({ type: 'ok', text: '已断开 Google Drive 连接（本地标签页记录仍保留）。' });
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSmartSync = async () => {
    setBusyAction('smart-sync');
    setFeedback(null);
    try {
      const result = await cloudSyncAdapter.syncAuto({ checkRemote: true });
      await Promise.all([loadModalData(), onSyncUpdated()]);
      switch (result.outcome) {
        case 'up-to-date':
          setFeedback({ type: 'ok', text: '本地与 Google Drive 云端已是最新一致状态。' });
          break;
        case 'uploaded':
          setFeedback({ type: 'ok', text: '已将本地最新更改同步上传到 Google Drive。' });
          break;
        case 'pulled':
          setFeedback({ type: 'ok', text: '已从 Google Drive 拉取最新远端记录到本地。' });
          break;
        case 'merged':
          setFeedback({ type: 'ok', text: '已完成双端差异智能合并并同步至 Google Drive。' });
          break;
        case 'conflict':
          setFeedback({
            type: 'error',
            text: `检测到 ${result.conflictCount ?? 1} 处同步冲突，已在本地自动保存安全快照，请在下方选择处理方式。`,
          });
          break;
        case 'auth-expired':
          setFeedback({ type: 'error', text: 'Google 授权已过期，请点击「重新授权」。' });
          break;
        default:
          break;
      }
    } catch (error) {
      await loadModalData();
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveConflict = async (strategy: ConflictResolutionStrategy) => {
    setBusyAction(`resolve-${strategy}`);
    setFeedback(null);
    try {
      await cloudSyncAdapter.resolveConflict(strategy);
      await Promise.all([loadModalData(), onSyncUpdated()]);
      const labels: Record<ConflictResolutionStrategy, string> = {
        merge: '已完成智能合并并同步到云端！',
        'keep-local': '已使用本地版本覆盖云端备份！',
        'use-remote': '已使用云端版本覆盖本地记录（原本地快照已保留）！',
      };
      setFeedback({ type: 'ok', text: labels[strategy] });
    } catch (error) {
      await loadModalData();
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleBackup = async () => {
    setBusyAction('backup');
    setFeedback(null);
    try {
      const summary = await cloudSyncAdapter.backup();
      await Promise.all([loadModalData(), onSyncUpdated()]);
      setFeedback({
        type: 'ok',
        text: `备份成功！已上传 ${summary.groupCount} 个分组、共 ${summary.tabCount} 个标签页到 Google Drive 应用私有目录。`,
      });
    } catch (error) {
      await loadModalData();
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestore = async () => {
    setBusyAction('restore');
    setFeedback(null);
    try {
      const summary = await cloudSyncAdapter.restore(restoreMode);
      await Promise.all([loadModalData(), onSyncUpdated()]);
      setFeedback({
        type: 'ok',
        text: `恢复成功！从云端读取 ${summary.restoredGroupCount} 个分组（${summary.restoredTabCount} 个标签页），当前本地共 ${summary.totalGroupCount} 个分组。`,
      });
    } catch (error) {
      await loadModalData();
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateManualSnapshot = async () => {
    setBusyAction('snap-create');
    setFeedback(null);
    try {
      const store = await loadStore();
      await createSnapshot(store, 'manual', '用户手动创建本地快照');
      await loadModalData();
      setFeedback({ type: 'ok', text: '已创建当前标签页状态的本地安全快照。' });
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string, mode: 'replace' | 'merge') => {
    setBusyAction(`snap-restore-${snapshotId}`);
    setFeedback(null);
    try {
      const current = await loadStore();
      if (current.groups.length > 0) {
        await createSnapshot(current, 'pre-restore', '恢复历史快照前的自动保护快照');
      }
      await restoreSnapshot(snapshotId, mode);
      await Promise.all([loadModalData(), onSyncUpdated()]);
      setFeedback({
        type: 'ok',
        text: mode === 'replace' ? '已恢复至选定历史快照！' : '已将历史快照内容智能合并到当前记录！',
      });
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    setBusyAction(`snap-delete-${snapshotId}`);
    try {
      const next = await deleteSnapshot(snapshotId);
      setSnapshots(next);
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;
  const isConnected = Boolean(status?.sync.enabled && status?.hasValidToken);
  const needsReauth = Boolean(
    status?.sync.enabled && (!status?.hasValidToken || syncRuntime.status === 'auth-expired')
  );
  const displayRedirectUri = status?.redirectUri || cloudSyncAdapter.getRedirectUri();
  const activeConflict = syncRuntime.conflict;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive 云端同步"
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2>Google Drive 云同步与历史快照</h2>
          <button type="button" className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${activeTab === 'sync' ? 'modal-tab--active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <Cloud size={14} />
            <span>云端同步</span>
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'snapshots' ? 'modal-tab--active' : ''}`}
            onClick={() => setActiveTab('snapshots')}
          >
            <History size={14} />
            <span>历史快照 ({snapshots.length})</span>
          </button>
        </div>

        {activeTab === 'sync' ? (
          <div className="modal-body modal-body--scroll">
            <div className={`drive-status-card ${isConnected ? 'drive-status-card--connected' : ''}`}>
              <div className="drive-status-card__info">
                <Cloud
                  size={24}
                  className={isConnected ? 'drive-icon--ok' : 'drive-icon--idle'}
                  aria-hidden="true"
                />
                <div>
                  <div className="drive-status-title">
                    {isConnected
                      ? `已连接：${status?.sync.accountEmail || 'Google 账号'}`
                      : needsReauth
                        ? `授权已过期（${status?.sync.accountEmail || 'Google 账号'}）`
                        : '尚未连接 Google Drive'}
                  </div>
                  <div className="drive-status-sub">
                    {status?.sync.lastSyncedAt
                      ? `最近同步：${formatDateTime(status.sync.lastSyncedAt)}${
                          syncRuntime.pendingLocalChanges ? ' · 有本地变更待同步' : ''
                        }`
                      : '备份文件将保存在你的 Google Drive 隐藏应用空间（appDataFolder）'}
                  </div>
                </div>
              </div>

              <div className="drive-status-actions">
                {isConnected && (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={isBusy}
                    onClick={() => void handleSmartSync()}
                  >
                    <RefreshCw size={13} className={busyAction === 'smart-sync' ? 'spin-icon' : ''} />
                    <span>{busyAction === 'smart-sync' ? '同步中...' : '立即双向同步'}</span>
                  </button>
                )}
                {isConnected || needsReauth ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={isBusy}
                      onClick={() => void handleConnect()}
                    >
                      <RefreshCw size={13} />
                      <span>{needsReauth ? '重新授权' : '切换账号'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger-ghost btn--sm"
                      disabled={isBusy}
                      onClick={() => void handleDisconnect()}
                    >
                      <LogOut size={13} />
                      <span>断开</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={isBusy || !clientIdInput.trim()}
                    onClick={() => void handleConnect()}
                  >
                    <ShieldCheck size={15} />
                    <span>{busyAction === 'connect' ? '正在授权...' : '登录 Google 账号'}</span>
                  </button>
                )}
              </div>
            </div>

            {activeConflict && (
              <section className="conflict-card" aria-label="同步冲突处理">
                <div className="conflict-card__header">
                  <AlertTriangle size={18} />
                  <div>
                    <h3>检测到 {activeConflict.items.length} 处同步冲突</h3>
                    <p>
                      发现另一台设备与当前设备同时修改了同一分组。自动上传已暂停，且已自动生成本地安全快照。
                    </p>
                  </div>
                </div>

                <ul className="conflict-list">
                  {activeConflict.items.slice(0, 5).map((item) => (
                    <li key={item.groupId} className="conflict-item">
                      <span className="conflict-item__title">
                        {item.localGroup?.title || item.remoteGroup?.title || '未命名分组'}
                      </span>
                      <span className="conflict-item__meta">
                        {formatConflictReason(item.reason)}
                        {item.localGroup ? ` · 本地 ${item.localGroup.tabs.length} 项` : ''}
                        {item.remoteGroup ? ` · 云端 ${item.remoteGroup.tabs.length} 项` : ''}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="conflict-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={isBusy || !isConnected}
                    onClick={() => void handleResolveConflict('merge')}
                  >
                    <GitMerge size={14} />
                    <span>智能合并双方（推荐）</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={isBusy || !isConnected}
                    onClick={() => void handleResolveConflict('keep-local')}
                  >
                    <span>以本地为准覆盖云端</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={isBusy}
                    onClick={() => void handleResolveConflict('use-remote')}
                  >
                    <span>以云端为准覆盖本地</span>
                  </button>
                </div>
              </section>
            )}

            <section className="drive-section">
              <div className="drive-section-header">
                <h3>自动与手动同步</h3>
                <label className="drive-autosync-toggle">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => void onToggleAutoSync(e.target.checked)}
                  />
                  <span>变更后 30 秒自动防抖同步</span>
                </label>
              </div>

              <div className="drive-sync-grid">
                <div className="drive-op-card">
                  <h4>备份到 Google Drive</h4>
                  <p className="modal-desc">
                    将当前本地全部分组与插件设置上传至 Google Drive（仅覆盖云端备份文件{' '}
                    <code>autosynctab-backup.json</code>）。
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={isBusy || !isConnected}
                    onClick={() => void handleBackup()}
                  >
                    <CloudUpload size={15} />
                    <span>{busyAction === 'backup' ? '正在上传...' : '立即备份到云端'}</span>
                  </button>
                </div>

                <div className="drive-op-card">
                  <h4>从 Google Drive 恢复</h4>
                  <div className="import-mode-group">
                    <label>
                      <input
                        type="radio"
                        name="driveRestoreMode"
                        checked={restoreMode === 'merge'}
                        onChange={() => setRestoreMode('merge')}
                      />
                      智能合并到本地
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="driveRestoreMode"
                        checked={restoreMode === 'replace'}
                        onChange={() => setRestoreMode('replace')}
                      />
                      覆盖本地记录
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={isBusy || !isConnected}
                    onClick={() => void handleRestore()}
                  >
                    <CloudDownload size={15} />
                    <span>{busyAction === 'restore' ? '正在恢复...' : '从云端恢复记录'}</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="drive-section">
              <div className="drive-section-header">
                <h3>高级设置（自定义 OAuth Client ID）</h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-expanded={showAdvanced}
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  <span>{showAdvanced ? '收起' : '展开配置'}</span>
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {showAdvanced && (
                <>
                  <ol className="drive-guide-list">
                    <li>
                      已内置默认 OAuth Client ID，正常情况无需修改，直接点击上方「登录 Google
                      账号」即可。
                    </li>
                    <li>
                      如需使用你自己的 Google Cloud 应用，请启用 <strong>Google Drive API</strong>
                      ，在 <strong>Google Auth Platform（旧称 OAuth 同意屏幕）</strong>{' '}
                      添加测试用户，并创建 <strong>Web 应用</strong> 凭据填入下方回调地址：
                    </li>
                  </ol>

                  <div className="drive-field">
                    <label className="drive-field-label" htmlFor="drive-redirect-uri">
                      固定重定向 URI（Redirect URI）
                    </label>
                    <div className="drive-input-row">
                      <input
                        id="drive-redirect-uri"
                        type="text"
                        readOnly
                        className="drive-input drive-input--mono"
                        value={displayRedirectUri}
                      />
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => void handleCopyRedirectUri()}
                      >
                        {copiedUri ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedUri ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="drive-field">
                    <label className="drive-field-label" htmlFor="drive-client-id">
                      Google OAuth Client ID
                    </label>
                    <div className="drive-input-row">
                      <input
                        id="drive-client-id"
                        type="text"
                        className="drive-input drive-input--mono"
                        placeholder="例如：1234567890-xxxx.apps.googleusercontent.com"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={isBusy || !clientIdInput.trim()}
                        onClick={() => void handleSaveClientId()}
                      >
                        <span>{busyAction === 'save-client' ? '保存中...' : '保存'}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>

            {feedback && (
              <div
                className={`modal-alert ${feedback.type === 'error' ? 'modal-alert--error' : 'modal-alert--ok'}`}
                role="status"
              >
                {feedback.text}
              </div>
            )}
          </div>
        ) : (
          <div className="modal-body modal-body--scroll">
            <div className="snapshot-toolbar">
              <p className="modal-desc">
                系统会在云端恢复、冲突合并或覆盖导入前自动保留最近 15 份本地安全快照，随时可一键回滚。
              </p>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={isBusy}
                onClick={() => void handleCreateManualSnapshot()}
              >
                <Camera size={14} />
                <span>创建当前快照</span>
              </button>
            </div>

            {snapshots.length === 0 ? (
              <div className="snapshot-empty">
                暂无历史快照。点击右上角「创建当前快照」或在执行云端同步/恢复时将自动生成。
              </div>
            ) : (
              <ul className="snapshot-list">
                {snapshots.map((snap) => (
                  <li key={snap.id} className="snapshot-item">
                    <div className="snapshot-item__info">
                      <div className="snapshot-item__top">
                        <span className="pill">{formatSnapshotReason(snap.reason)}</span>
                        <span className="snapshot-time">{formatDateTime(snap.createdAt)}</span>
                      </div>
                      <div className="snapshot-item__stats">
                        共 {snap.groupCount} 个分组 · {snap.tabCount} 个标签页
                        {snap.note ? ` · ${snap.note}` : ''}
                      </div>
                    </div>

                    <div className="snapshot-item__actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={isBusy}
                        onClick={() => void handleRestoreSnapshot(snap.id, 'merge')}
                      >
                        <GitMerge size={13} />
                        <span>合并恢复</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary-soft btn--sm"
                        disabled={isBusy}
                        onClick={() => void handleRestoreSnapshot(snap.id, 'replace')}
                      >
                        <RotateCcw size={13} />
                        <span>覆盖恢复</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`删除快照 ${formatDateTime(snap.createdAt)}`}
                        disabled={isBusy}
                        onClick={() => void handleDeleteSnapshot(snap.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {feedback && (
              <div
                className={`modal-alert ${feedback.type === 'error' ? 'modal-alert--error' : 'modal-alert--ok'}`}
                role="status"
              >
                {feedback.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
