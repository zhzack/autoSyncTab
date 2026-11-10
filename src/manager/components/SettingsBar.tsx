import type { ExtensionSettings } from '../../shared/types';

interface SettingsBarProps {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}

interface SettingOption {
  key: keyof ExtensionSettings;
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
];

export function SettingsBar({ settings, onUpdate }: SettingsBarProps) {
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
    </section>
  );
}
