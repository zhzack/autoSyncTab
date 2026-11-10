import { createId, normalizeStoreData } from './storage';
import type { AppStoreData, TabGroup, TabItem } from './types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

export function isValidExportedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function getDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname || parsed.protocol.replace(':', '');
  } catch {
    return rawUrl;
  }
}

export function exportToOneTabText(groups: TabGroup[]): string {
  return groups
    .map((group) =>
      group.tabs
        .map((tab) => (tab.title && tab.title !== tab.url ? `${tab.url} | ${tab.title}` : tab.url))
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n');
}

export function parseOneTabText(rawText: string, now = Date.now()): TabGroup[] {
  const blocks = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const groups: TabGroup[] = [];

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx += 1) {
    const lines = blocks[blockIdx]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const tabs: TabItem[] = [];
    let groupTitle = '';

    for (const line of lines) {
      if (line.startsWith('#') && tabs.length === 0 && !groupTitle) {
        groupTitle = line.slice(1).trim();
        continue;
      }

      const separatorIndex = line.indexOf(' | ');
      const rawUrl = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
      const rawTitle = separatorIndex >= 0 ? line.slice(separatorIndex + 3).trim() : '';

      if (!isValidExportedUrl(rawUrl)) continue;

      tabs.push({
        id: createId('tab'),
        url: rawUrl,
        title: rawTitle || rawUrl,
      });
    }

    if (tabs.length > 0) {
      const timestamp = now - blockIdx * 1000;
      groups.push({
        id: createId('grp'),
        title: groupTitle,
        createdAt: timestamp,
        updatedAt: timestamp,
        locked: false,
        tabs,
      });
    }
  }

  return groups;
}

export function exportToJson(store: AppStoreData): string {
  const cleanBackup = {
    schemaVersion: store.schemaVersion,
    updatedAt: store.updatedAt,
    groups: store.groups,
    settings: store.settings,
  };
  return JSON.stringify(cleanBackup, null, 2);
}

export function parseJsonBackup(rawJson: string): AppStoreData {
  const parsed: unknown = JSON.parse(rawJson);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { groups?: unknown }).groups)) {
    throw new Error('无效的 JSON 备份格式：缺少 groups 数组');
  }
  return normalizeStoreData(parsed);
}
