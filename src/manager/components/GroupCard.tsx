import { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  Pencil,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { formatDateTime, getDomain } from '../../shared/formatters';
import type { TabGroup, TabItem } from '../../shared/types';

interface GroupCardProps {
  group: TabGroup;
  onRestoreGroup: (group: TabGroup) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, title: string) => void;
  onToggleLock: (groupId: string, locked: boolean) => void;
  onRestoreTab: (group: TabGroup, tab: TabItem) => void;
  onDeleteTab: (groupId: string, tabId: string) => void;
}

function TabFavicon({ url }: { url?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return <Globe size={15} className="tab-favicon-fallback" aria-hidden="true" />;
  }

  return (
    <img
      src={url}
      alt=""
      className="tab-favicon"
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}

export function GroupCard({
  group,
  onRestoreGroup,
  onDeleteGroup,
  onRenameGroup,
  onToggleLock,
  onRestoreTab,
  onDeleteTab,
}: GroupCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(group.title);
  const [copiedTabId, setCopiedTabId] = useState<string | null>(null);

  const startEditing = () => {
    setDraftTitle(group.title);
    setIsEditing(true);
  };

  const commitTitle = () => {
    setIsEditing(false);
    if (draftTitle.trim() !== group.title) {
      onRenameGroup(group.id, draftTitle.trim());
    }
  };

  const handleCopyUrl = async (tab: TabItem) => {
    try {
      await navigator.clipboard.writeText(tab.url);
      setCopiedTabId(tab.id);
      window.setTimeout(() => {
        setCopiedTabId((prev) => (prev === tab.id ? null : prev));
      }, 1500);
    } catch {
      // Clipboard API may be unavailable in restricted test environments.
    }
  };

  return (
    <article className={`group-card ${group.locked ? 'group-card--locked' : ''}`}>
      <header className="group-header">
        <div className="group-header__left">
          {isEditing ? (
            <input
              type="text"
              className="group-title-input"
              value={draftTitle}
              placeholder="输入分组名称（留空使用默认名称）"
              aria-label="编辑分组名称"
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') {
                  setDraftTitle(group.title);
                  setIsEditing(false);
                }
              }}
            />
          ) : (
            <div className="group-title-wrap">
              <h2 className="group-title" onDoubleClick={startEditing}>
                {group.title || `未命名分组`}
              </h2>
              <button
                type="button"
                className="icon-btn"
                title="重命名分组"
                aria-label="重命名分组"
                onClick={startEditing}
              >
                <Pencil size={13} />
              </button>
            </div>
          )}

          <div className="group-meta">
            <span className="pill">{group.tabs.length} 个标签</span>
            <span className="group-time">{formatDateTime(group.createdAt)}</span>
            {group.locked && (
              <span className="pill pill--locked">
                <Lock size={11} />
                已锁定
              </span>
            )}
          </div>
        </div>

        <div className="group-actions">
          <button
            type="button"
            className="btn btn--primary-soft"
            onClick={() => onRestoreGroup(group)}
          >
            <ExternalLink size={14} />
            <span>恢复全部</span>
          </button>

          <button
            type="button"
            className="btn btn--ghost"
            title={group.locked ? '解锁分组' : '锁定分组（恢复时不移除，防止误删）'}
            aria-label={group.locked ? '解锁分组' : '锁定分组'}
            onClick={() => onToggleLock(group.id, !group.locked)}
          >
            {group.locked ? <Unlock size={14} /> : <Lock size={14} />}
            <span>{group.locked ? '解锁' : '锁定'}</span>
          </button>

          <button
            type="button"
            className="btn btn--danger-ghost"
            disabled={group.locked}
            title={group.locked ? '分组已锁定，请先解锁再删除' : '删除此分组'}
            aria-label="删除分组"
            onClick={() => onDeleteGroup(group.id)}
          >
            <Trash2 size={14} />
            <span>删除</span>
          </button>
        </div>
      </header>

      <ul className="tab-list">
        {group.tabs.map((tab) => (
          <li key={tab.id} className="tab-row">
            <button
              type="button"
              className="tab-link-btn"
              title={tab.url}
              onClick={() => onRestoreTab(group, tab)}
            >
              <TabFavicon url={tab.favIconUrl} />
              <span className="tab-info">
                <span className="tab-title">{tab.title}</span>
                <span className="tab-domain">{getDomain(tab.url)}</span>
              </span>
            </button>

            <div className="tab-row-actions">
              <button
                type="button"
                className="icon-btn"
                title="复制链接"
                aria-label={`复制 ${tab.title} 的链接`}
                onClick={() => void handleCopyUrl(tab)}
              >
                {copiedTabId === tab.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                title={group.locked ? '请先解锁分组再删除单个标签' : '从列表中移除'}
                aria-label={`删除 ${tab.title}`}
                disabled={group.locked}
                onClick={() => onDeleteTab(group.id, tab.id)}
              >
                <X size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
