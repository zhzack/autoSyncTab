import { Cloud, Download, Layers, Search, Settings, X } from 'lucide-react';
import type { SyncMetadata } from '../../shared/types';

interface HeaderProps {
  totalGroups: number;
  totalTabs: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showSettings: boolean;
  onToggleSettings: () => void;
  onOpenImportExport: () => void;
  onOpenDriveModal: () => void;
  sync: SyncMetadata;
}

export function Header({
  totalGroups,
  totalTabs,
  searchQuery,
  onSearchChange,
  showSettings,
  onToggleSettings,
  onOpenImportExport,
  onOpenDriveModal,
  sync,
}: HeaderProps) {
  return (
    <header className="mgr-header">
      <div className="mgr-header__inner">
        <div className="mgr-brand">
          <div className="mgr-logo" aria-hidden="true">
            <Layers size={20} />
          </div>
          <div>
            <h1>autoSyncTab</h1>
            <p className="mgr-stats">
              共 <strong>{totalGroups}</strong> 个分组 · <strong>{totalTabs}</strong> 个标签页
            </p>
          </div>
        </div>

        <div className="mgr-search-wrap">
          <Search size={16} className="mgr-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="mgr-search-input"
            placeholder="搜索标题、网址或分组名..."
            aria-label="搜索已收纳标签页"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="mgr-search-clear"
              aria-label="清空搜索"
              onClick={() => onSearchChange('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mgr-header-actions">
          <button type="button" className="btn btn--secondary" onClick={onOpenImportExport}>
            <Download size={15} />
            <span>导入 / 导出</span>
          </button>

          <button
            type="button"
            className={`btn btn--secondary ${showSettings ? 'btn--active' : ''}`}
            onClick={onToggleSettings}
            aria-pressed={showSettings}
          >
            <Settings size={15} />
            <span>设置</span>
          </button>

          <button type="button" className="btn btn--cloud" onClick={onOpenDriveModal}>
            <Cloud size={15} />
            <span>
              {sync.enabled
                ? sync.accountEmail
                  ? `Drive · ${sync.accountEmail.split('@')[0]}`
                  : 'Google Drive（已连接）'
                : 'Google Drive 云同步'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
