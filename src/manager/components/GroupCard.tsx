import { useState, type DragEvent } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  GripVertical,
  Lock,
  Pencil,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { formatDateTime, getDomain } from '../../shared/formatters';
import type { TabGroup, TabItem } from '../../shared/types';
import { SiteFavicon } from './SiteFavicon';

export type DragItemPayload =
  | { kind: 'group'; groupId: string }
  | { kind: 'tab'; sourceGroupId: string; tabId: string };

const DRAG_MIME = 'application/x-autosynctab-drag';

function writeDragPayload(e: DragEvent, payload: DragItemPayload): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData(
      'text/plain',
      payload.kind === 'group' ? payload.groupId : payload.tabId
    );
  } catch {
    // Ignore restricted dataTransfer in synthetic test environments.
  }
}

function readDragPayload(
  e: DragEvent,
  fallback: DragItemPayload | null
): DragItemPayload | null {
  try {
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    if (raw) {
      return JSON.parse(raw) as DragItemPayload;
    }
  } catch {
    // Fallback to React-tracked payload below.
  }
  return fallback;
}

interface GroupCardProps {
  group: TabGroup;
  allowDrag: boolean;
  activeDrag: DragItemPayload | null;
  onDragStartItem: (payload: DragItemPayload) => void;
  onDragEndItem: () => void;
  onReorderGroup: (sourceGroupId: string, targetGroupId: string) => void;
  onMoveTab: (
    sourceGroupId: string,
    tabId: string,
    targetGroupId: string,
    targetTabId?: string,
    position?: 'before' | 'after'
  ) => void;
  onRestoreGroup: (group: TabGroup) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, title: string) => void;
  onToggleLock: (groupId: string, locked: boolean) => void;
  onRestoreTab: (group: TabGroup, tab: TabItem) => void;
  onDeleteTab: (groupId: string, tabId: string) => void;
}

export function GroupCard({
  group,
  allowDrag,
  activeDrag,
  onDragStartItem,
  onDragEndItem,
  onReorderGroup,
  onMoveTab,
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
  const [isCardDropTarget, setIsCardDropTarget] = useState(false);
  const [tabDropTarget, setTabDropTarget] = useState<{
    tabId: string;
    position: 'before' | 'after';
  } | null>(null);

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

  const canAcceptGroupDrop =
    allowDrag && activeDrag?.kind === 'group' && activeDrag.groupId !== group.id;
  const canAcceptTabDrop = allowDrag && !group.locked && activeDrag?.kind === 'tab';

  const handleCardDragOver = (e: DragEvent<HTMLElement>) => {
    if (!canAcceptGroupDrop && !canAcceptTabDrop) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (!isCardDropTarget) {
      setIsCardDropTarget(true);
    }
  };

  const handleCardDragLeave = (e: DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsCardDropTarget(false);
    setTabDropTarget(null);
  };

  const handleCardDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsCardDropTarget(false);
    setTabDropTarget(null);
    if (!allowDrag) return;

    const payload = readDragPayload(e, activeDrag);
    if (!payload) return;

    if (payload.kind === 'group' && payload.groupId !== group.id) {
      onReorderGroup(payload.groupId, group.id);
    } else if (payload.kind === 'tab' && !group.locked) {
      onMoveTab(payload.sourceGroupId, payload.tabId, group.id);
    }
    onDragEndItem();
  };

  return (
    <article
      className={`group-card ${group.locked ? 'group-card--locked' : ''} ${
        isCardDropTarget ? 'group-card--drag-over' : ''
      }`}
      data-group-id={group.id}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
    >
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
              {allowDrag && (
                <span
                  className="drag-handle drag-handle--group"
                  draggable
                  role="button"
                  tabIndex={-1}
                  title="拖拽调整分组顺序"
                  aria-label={`拖拽调整分组 ${group.title || '未命名分组'} 顺序`}
                  onDragStart={(e) => {
                    const payload: DragItemPayload = { kind: 'group', groupId: group.id };
                    writeDragPayload(e, payload);
                    onDragStartItem(payload);
                  }}
                  onDragEnd={() => {
                    setIsCardDropTarget(false);
                    setTabDropTarget(null);
                    onDragEndItem();
                  }}
                >
                  <GripVertical size={15} />
                </span>
              )}
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
        {group.tabs.map((tab) => {
          const isDropBefore =
            tabDropTarget?.tabId === tab.id && tabDropTarget.position === 'before';
          const isDropAfter =
            tabDropTarget?.tabId === tab.id && tabDropTarget.position === 'after';

          return (
            <li
              key={tab.id}
              className={`tab-row ${isDropBefore ? 'tab-row--drop-before' : ''} ${
                isDropAfter ? 'tab-row--drop-after' : ''
              }`}
              draggable={allowDrag && !group.locked}
              onDragStart={(e) => {
                if (!allowDrag || group.locked) return;
                e.stopPropagation();
                const payload: DragItemPayload = {
                  kind: 'tab',
                  sourceGroupId: group.id,
                  tabId: tab.id,
                };
                writeDragPayload(e, payload);
                onDragStartItem(payload);
              }}
              onDragEnd={() => {
                setIsCardDropTarget(false);
                setTabDropTarget(null);
                onDragEndItem();
              }}
              onDragOver={(e) => {
                if (!canAcceptTabDrop) return;
                if (activeDrag?.kind === 'tab' && activeDrag.tabId === tab.id) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'move';
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const position: 'before' | 'after' =
                  rect.height > 0 && e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                setTabDropTarget((prev) =>
                  prev?.tabId === tab.id && prev.position === position ? prev : { tabId: tab.id, position }
                );
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setTabDropTarget((prev) => (prev?.tabId === tab.id ? null : prev));
              }}
              onDrop={(e) => {
                if (!canAcceptTabDrop) return;
                const payload = readDragPayload(e, activeDrag);
                if (!payload || payload.kind !== 'tab') return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const position: 'before' | 'after' =
                  rect.height > 0 && e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                setIsCardDropTarget(false);
                setTabDropTarget(null);
                onMoveTab(payload.sourceGroupId, payload.tabId, group.id, tab.id, position);
                onDragEndItem();
              }}
            >
              {allowDrag && !group.locked && (
                <span className="drag-handle drag-handle--tab" aria-hidden="true" title="拖拽排序或移动至其他分组">
                  <GripVertical size={14} />
                </span>
              )}
              <button
                type="button"
                className="tab-link-btn"
                title={tab.url}
                onClick={() => onRestoreTab(group, tab)}
              >
                <SiteFavicon url={tab.favIconUrl} />
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
          );
        })}
      </ul>
    </article>
  );
}
