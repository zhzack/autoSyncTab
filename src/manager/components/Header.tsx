import type { RefObject } from 'react';
import {
  AlertTriangle,
  Cloud,
  Download,
  Layers,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { getThemeLabel } from '../../shared/theme';
import type { SyncMetadata, SyncRuntimeState, ThemeMode } from '../../shared/types';

interface HeaderProps {
  totalGroups: number;
  totalTabs: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  showSettings: boolean;
  onToggleSettings: () => void;
  onOpenImportExport: () => void;
  onOpenDriveModal: () => void;
  theme: ThemeMode;
  onCycleTheme: () => void;
  sync: SyncMetadata;
  syncRuntime: SyncRuntimeState;
}

export function Header({
  totalGroups,
  totalTabs,
  searchQuery,
  onSearchChange,
  searchInputRef,
  showSettings,
  onToggleSettings,
  onOpenImportExport,
  onOpenDriveModal,
  theme,
  onCycleTheme,
  sync,
  syncRuntime,
}: HeaderProps) {
  const renderThemeIcon = () => {
    if (theme === 'dark') return <Moon size={15} />;
    if (theme === 'light') return <Sun size={15} />;
    return <Monitor size={15} />;
  };

  const renderDriveButtonContent = () => {
    if (!sync.enabled) {
      return (
        <>
          <Cloud size={15} />
          <span>Google Drive 云同步</span>
        </>
      );
    }

    if (syncRuntime.status === 'conflict') {
      return (
        <>
          <AlertTriangle size={15} />
          <span>Drive · 同步冲突</span>
        </>
      );
    }

    if (syncRuntime.status === 'auth-expired') {
      return (
        <>
          <AlertTriangle size={15} />
          <span>Drive · 授权过期</span>
        </>
      );
    }

    if (syncRuntime.status === 'syncing') {
      return (
        <>
          <RefreshCw size={15} className="spin-icon" />
          <span>Drive · 同步中...</span>
        </>
      );
    }

    const baseLabel = sync.accountEmail
      ? `Drive · ${sync.accountEmail.split('@')[0]}`
      : 'Google Drive（已连接）';

    return (
      <>
        <Cloud size={15} />
        <span>{syncRuntime.pendingLocalChanges ? `${baseLabel} · 待同步` : baseLabel}</span>
      </>
    );
  };

  const hasCloudWarning =
    sync.enabled &&
    (syncRuntime.status === 'conflict' ||
      syncRuntime.status === 'auth-expired' ||
      syncRuntime.status === 'error');

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
            ref={searchInputRef}
            type="search"
            className="mgr-search-input"
            placeholder="搜索标题、网址或分组名...（快捷键 / 或 Ctrl+K）"
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
          <button
            type="button"
            className="btn btn--secondary btn--icon-text"
            onClick={onCycleTheme}
            title={`切换主题模式（当前：${getThemeLabel(theme)}）`}
            aria-label={`切换主题模式（当前：${getThemeLabel(theme)}）`}
          >
            {renderThemeIcon()}
            <span>{getThemeLabel(theme)}</span>
          </button>

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

          <button
            type="button"
            className={`btn ${hasCloudWarning ? 'btn--cloud-warn' : 'btn--cloud'}`}
            onClick={onOpenDriveModal}
          >
            {renderDriveButtonContent()}
          </button>
        </div>
      </div>
    </header>
  );
}
