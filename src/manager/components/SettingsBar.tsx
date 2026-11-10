import { useState } from 'react';
import { Check, Copy, Keyboard, Monitor, Moon, Sun } from 'lucide-react';
import type { ExtensionSettings, ThemeMode } from '../../shared/types';

interface SettingsBarProps {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}

type BooleanSettingKey =
  | 'ignorePinnedTabs'
  | 'removeOnRestore'
  | 'openManagerAfterStash'
  | 'deduplicateOnStash'
  | 'autoSync';

interface SettingOption {
  key: BooleanSettingKey;
  label: string;
  description: string;
}

const SETTING_OPTIONS: SettingOption[] = [
  {
    key: 'ignorePinnedTabs',
    label: '批量收纳时忽略固定标签页',
    description: '一键收纳全部或其他标签时保留左侧 Pinned Tabs',
  },
  {
    key: 'removeOnRestore',
    label: '恢复后自动从列表移除',
    description: '点击恢复单个标签或整组后自动清理记录（锁定分组除外）',
  },
  {
    key: 'openManagerAfterStash',
    label: '收纳后自动打开管理页',
    description: '从弹窗或右键收纳标签后立即跳转并聚焦管理页',
  },
  {
    key: 'deduplicateOnStash',
    label: '收纳时自动合并重复链接',
    description: '同一批收纳中若存在相同 URL，仅保留一条记录并关闭重复页',
  },
  {
    key: 'autoSync',
    label: '启用 Google Drive 自动同步',
    description: '连接 Drive 后，本地变更约 30 秒防抖自动上传，打开管理页时自动校验云端',
  },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色模式', icon: Sun },
  { value: 'dark', label: '深色模式', icon: Moon },
];

const SHORTCUT_ITEMS = [
  { keys: 'Alt+Shift+S', label: '打开弹窗菜单' },
  { keys: 'Alt+Shift+A', label: '收纳当前窗口全部标签页' },
  { keys: 'Alt+Shift+C', label: '仅收纳当前标签页' },
  { keys: 'Alt+Shift+M', label: '打开标签页管理页' },
  { keys: '/ 或 Ctrl+K', label: '管理页快速聚焦搜索框' },
  { keys: 'Esc', label: '清空搜索或关闭弹窗' },
];

export function SettingsBar({ settings, onUpdate }: SettingsBarProps) {
  const [copiedShortcutsUrl, setCopiedShortcutsUrl] = useState(false);

  const handleCopyShortcutsPage = async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions/shortcuts');
      setCopiedShortcutsUrl(true);
      window.setTimeout(() => setCopiedShortcutsUrl(false), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted environments.
    }
  };

  return (
    <section className="settings-panel" aria-label="插件行为设置">
      <div className="settings-grid">
        {SETTING_OPTIONS.map((option) => (
          <label key={option.key} className="setting-item">
            <input
              type="checkbox"
              checked={settings[option.key]}
              onChange={(e) => onUpdate({ [option.key]: e.target.checked })}
            />
            <span className="setting-text">
              <span className="setting-label">{option.label}</span>
              <span className="setting-desc">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="settings-divider" />

      <div className="settings-extras">
        <div className="settings-theme-row">
          <div className="settings-extra-title">界面外观主题</div>
          <div className="theme-segmented" role="radiogroup" aria-label="界面外观主题">
            {THEME_OPTIONS.map((item) => {
              const Icon = item.icon;
              const active = settings.theme === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`theme-pill ${active ? 'theme-pill--active' : ''}`}
                  onClick={() => onUpdate({ theme: item.value })}
                >
                  <Icon size={13} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-shortcuts-block">
          <div className="settings-shortcuts-header">
            <span className="settings-extra-title">
              <Keyboard size={14} />
              <span>键盘快捷键</span>
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void handleCopyShortcutsPage()}
              title="复制 chrome://extensions/shortcuts 到剪贴板以自定义全局快捷键"
            >
              {copiedShortcutsUrl ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedShortcutsUrl ? '已复制快捷键设置地址' : '自定义全局快捷键地址'}</span>
            </button>
          </div>
          <div className="shortcuts-grid">
            {SHORTCUT_ITEMS.map((item) => (
              <div key={item.keys} className="shortcut-chip">
                <kbd>{item.keys}</kbd>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
