import { useState, type ChangeEvent } from 'react';
import { Check, Copy, Download, Upload, X } from 'lucide-react';
import {
  exportToJson,
  exportToOneTabText,
  parseJsonBackup,
  parseOneTabText,
} from '../../shared/formatters';
import type { AppStoreData, TabGroup } from '../../shared/types';

interface ImportExportModalProps {
  store: AppStoreData;
  onClose: () => void;
  onImportGroups: (groups: TabGroup[], mode: 'prepend' | 'replace') => Promise<void>;
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ImportExportModal({ store, onClose, onImportGroups }: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'prepend' | 'replace'>('prepend');
  const [copiedText, setCopiedText] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const oneTabText = exportToOneTabText(store.groups);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(oneTabText);
      setCopiedText(true);
      window.setTimeout(() => setCopiedText(false), 1800);
    } catch {
      setErrorMessage('剪贴板写入失败，请手动复制文本框内容');
    }
  };

  const handleDownloadJson = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`autosynctab-backup-${stamp}.json`, exportToJson(store), 'application/json');
  };

  const handleDownloadText = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`autosynctab-export-${stamp}.txt`, oneTabText, 'text/plain;charset=utf-8');
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    setErrorMessage(null);
    setStatusMessage(`已读取文件：${file.name}`);
  };

  const handleImportSubmit = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    const trimmed = importText.trim();
    if (!trimmed) {
      setErrorMessage('请先粘贴文本或 JSON 备份内容');
      return;
    }

    try {
      let parsedGroups: TabGroup[];
      if (trimmed.startsWith('{')) {
        const parsedStore = parseJsonBackup(trimmed);
        parsedGroups = parsedStore.groups;
      } else {
        parsedGroups = parseOneTabText(trimmed);
      }

      if (parsedGroups.length === 0) {
        setErrorMessage('未识别到有效的网页链接（仅支持 http/https/file/ftp 链接）');
        return;
      }

      await onImportGroups(parsedGroups, importMode);
      const totalImportedTabs = parsedGroups.reduce((sum, g) => sum + g.tabs.length, 0);
      setStatusMessage(
        `成功导入 ${parsedGroups.length} 个分组（共 ${totalImportedTabs} 个标签页）`
      );
      setImportText('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入解析失败');
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入与导出">
      <div className="modal-card">
        <div className="modal-header">
          <h2>导入 / 导出记录</h2>
          <button type="button" className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${activeTab === 'export' ? 'modal-tab--active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            <Download size={14} />
            <span>导出备份</span>
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'import' ? 'modal-tab--active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Upload size={14} />
            <span>导入记录</span>
          </button>
        </div>

        {activeTab === 'export' ? (
          <div className="modal-body">
            <p className="modal-desc">
              支持导出标准 OneTab 文本格式（<code>URL | 标题</code>）或完整 JSON 备份文件（保留分组名与锁定状态）。
            </p>
            <textarea
              className="modal-textarea"
              readOnly
              value={oneTabText || '暂无已保存的标签页记录'}
              aria-label="导出的 OneTab 文本"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!oneTabText}
                onClick={() => void handleCopyText()}
              >
                {copiedText ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedText ? '已复制文本' : '复制 OneTab 文本'}</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!oneTabText}
                onClick={handleDownloadText}
              >
                <Download size={14} />
                <span>下载 .txt</span>
              </button>
              <button type="button" className="btn btn--primary" onClick={handleDownloadJson}>
                <Download size={14} />
                <span>下载完整 JSON 备份</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-desc">
              粘贴 OneTab 文本（每行一个 <code>URL | 标题</code>，空行分隔分组）或上传本插件导出的 <code>.json</code> 备份文件：
            </p>
            <div className="import-file-row">
              <label className="btn btn--secondary file-upload-btn">
                <Upload size={14} />
                <span>选择 .txt / .json 文件</span>
                <input
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  onChange={(e) => void handleFileUpload(e)}
                />
              </label>

              <div className="import-mode-group">
                <label>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'prepend'}
                    onChange={() => setImportMode('prepend')}
                  />
                  追加到顶部
                </label>
                <label>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                  />
                  覆盖现有记录
                </label>
              </div>
            </div>

            <textarea
              className="modal-textarea"
              placeholder={'https://example.com | 示例网页\nhttps://github.com | GitHub'}
              value={importText}
              aria-label="导入内容输入框"
              onChange={(e) => setImportText(e.target.value)}
            />

            {errorMessage && <div className="modal-alert modal-alert--error">{errorMessage}</div>}
            {statusMessage && <div className="modal-alert modal-alert--ok">{statusMessage}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleImportSubmit()}>
                <Upload size={14} />
                <span>确认导入</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
