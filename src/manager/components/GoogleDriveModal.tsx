import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatDateTime } from '../../shared/formatters';
import { DEFAULT_GOOGLE_CLIENT_ID } from '../../shared/storage';
import { cloudSyncAdapter } from '../../shared/syncAdapter';
import type { DriveStatusSnapshot, SyncRestoreMode } from '../../shared/types';

interface GoogleDriveModalProps {
  onClose: () => void;
  onSyncUpdated: () => Promise<void> | void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GoogleDriveModal({ onClose, onSyncUpdated }: GoogleDriveModalProps) {
  const [status, setStatus] = useState<DriveStatusSnapshot | null>(null);
  const [clientIdInput, setClientIdInput] = useState(DEFAULT_GOOGLE_CLIENT_ID);
  const [restoreMode, setRestoreMode] = useState<SyncRestoreMode>('merge');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const loadStatus = async () => {
    try {
      const nextStatus = await cloudSyncAdapter.getStatus();
      setStatus(nextStatus);
      setClientIdInput(nextStatus.clientId || DEFAULT_GOOGLE_CLIENT_ID);
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

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

  const handleBackup = async () => {
    setBusyAction('backup');
    setFeedback(null);
    try {
      const summary = await cloudSyncAdapter.backup();
      await Promise.all([loadStatus(), onSyncUpdated()]);
      setFeedback({
        type: 'ok',
        text: `备份成功！已上传 ${summary.groupCount} 个分组、共 ${summary.tabCount} 个标签页到 Google Drive 应用私有目录。`,
      });
    } catch (error) {
      await loadStatus();
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
      await Promise.all([loadStatus(), onSyncUpdated()]);
      setFeedback({
        type: 'ok',
        text: `恢复成功！从云端读取 ${summary.restoredGroupCount} 个分组（${summary.restoredTabCount} 个标签页），当前本地共 ${summary.totalGroupCount} 个分组。`,
      });
    } catch (error) {
      await loadStatus();
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;
  const isConnected = Boolean(status?.sync.enabled && status?.hasValidToken);
  const needsReauth = Boolean(status?.sync.enabled && !status?.hasValidToken);
  const displayRedirectUri = status?.redirectUri || cloudSyncAdapter.getRedirectUri();

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive 云端同步"
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2>Google Drive 云端备份与恢复</h2>
          <button type="button" className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
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
                    ? `最近同步：${formatDateTime(status.sync.lastSyncedAt)}`
                    : '备份文件将保存在你的 Google Drive 隐藏应用空间（appDataFolder）'}
                </div>
              </div>
            </div>

            <div className="drive-status-actions">
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

          <section className="drive-section">
            <div className="drive-section-header">
              <h3>云端备份与恢复</h3>
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
      </div>
    </div>
  );
}
