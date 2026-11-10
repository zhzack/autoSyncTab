import {
  createId,
  loadStore,
  mutateStore,
  prependGroup,
  removeGroupFromStore,
  removeTabFromGroup,
} from './storage';
import type { ExtensionSettings, StashResult, StashScope, TabGroup, TabItem } from './types';

const STASHABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

export interface BrowserTabLike {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  active?: boolean;
  pinned?: boolean;
}

export function getTabUrl(tab: BrowserTabLike): string {
  return (tab.url || tab.pendingUrl || '').trim();
}

export function isStashableUrl(rawUrl: string, extensionOrigin = ''): boolean {
  if (!rawUrl) return false;
  if (extensionOrigin && rawUrl.startsWith(extensionOrigin)) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return STASHABLE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeFavIconUrl(favIconUrl?: string): string | undefined {
  if (!favIconUrl) return undefined;
  if (
    favIconUrl.startsWith('https://') ||
    favIconUrl.startsWith('http://') ||
    favIconUrl.startsWith('data:image/')
  ) {
    return favIconUrl;
  }
  return undefined;
}

export function toTabItem(tab: BrowserTabLike): TabItem {
  const url = getTabUrl(tab);
  return {
    id: createId('tab'),
    url,
    title: tab.title?.trim() || url,
    favIconUrl: sanitizeFavIconUrl(tab.favIconUrl),
    pinned: tab.pinned ? true : undefined,
  };
}

export interface TabSelectionResult {
  stashItems: TabItem[];
  tabIdsToClose: number[];
}

export function selectTabsToStash(
  tabs: BrowserTabLike[],
  scope: StashScope,
  settings: ExtensionSettings,
  extensionOrigin = ''
): TabSelectionResult {
  const seenUrls = new Set<string>();
  const stashItems: TabItem[] = [];
  const tabIdsToClose: number[] = [];

  for (const tab of tabs) {
    if (scope === 'current' && !tab.active) continue;
    if (scope === 'others' && tab.active) continue;

    // Bulk stash respects ignorePinnedTabs; explicit "current tab" stash allows pinned tabs.
    if (scope !== 'current' && settings.ignorePinnedTabs && tab.pinned) {
      continue;
    }

    const url = getTabUrl(tab);
    if (!isStashableUrl(url, extensionOrigin)) {
      continue;
    }

    if (typeof tab.id === 'number') {
      tabIdsToClose.push(tab.id);
    }

    if (settings.deduplicateOnStash && seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    stashItems.push(toTabItem(tab));
  }

  return { stashItems, tabIdsToClose };
}

export function getManagerUrl(): string {
  return chrome.runtime.getURL('manager.html');
}

export function getExtensionOrigin(): string {
  return chrome.runtime.getURL('');
}

export async function openOrFocusManagerPage(
  targetWindowId?: number,
  section?: 'tabs' | 'bookmarks'
): Promise<chrome.tabs.Tab> {
  const managerUrl = getManagerUrl();
  const targetUrl = section === 'bookmarks' ? `${managerUrl}#bookmarks` : managerUrl;
  const existingTabs = await chrome.tabs.query({ url: managerUrl });

  const preferredTab =
    (typeof targetWindowId === 'number'
      ? existingTabs.find((tab) => tab.windowId === targetWindowId)
      : undefined) ?? existingTabs[0];

  if (preferredTab && typeof preferredTab.id === 'number') {
    const updateProps: chrome.tabs.UpdateProperties = { active: true };
    if (section && preferredTab.url !== targetUrl) {
      updateProps.url = targetUrl;
    }
    await chrome.tabs.update(preferredTab.id, updateProps);
    if (typeof preferredTab.windowId === 'number') {
      await chrome.windows.update(preferredTab.windowId, { focused: true });
    }
    return preferredTab;
  }

  return chrome.tabs.create({
    url: targetUrl,
    windowId: targetWindowId,
    active: true,
  });
}

export async function stashTabsInWindow(
  scope: StashScope,
  explicitWindowId?: number
): Promise<StashResult> {
  try {
    const query: chrome.tabs.QueryInfo =
      typeof explicitWindowId === 'number'
        ? { windowId: explicitWindowId }
        : { currentWindow: true };

    const allTabs = await chrome.tabs.query(query);
    const windowId =
      typeof explicitWindowId === 'number' ? explicitWindowId : allTabs[0]?.windowId;

    const store = await loadStore();
    const { stashItems, tabIdsToClose } = selectTabsToStash(
      allTabs,
      scope,
      store.settings,
      getExtensionOrigin()
    );

    if (stashItems.length === 0) {
      return { ok: true, stashedCount: 0, groupId: null };
    }

    let createdGroupId: string | null = null;
    await mutateStore((current) => {
      const { nextStore, group } = prependGroup(current, stashItems);
      createdGroupId = group?.id ?? null;
      return nextStore;
    });

    const remainingTabsCount = allTabs.length - tabIdsToClose.length;
    const managerUrl = getManagerUrl();
    const managerAlreadyOpenInWindow = allTabs.some((tab) => tab.url === managerUrl);

    if (
      store.settings.openManagerAfterStash ||
      (remainingTabsCount <= 0 && !managerAlreadyOpenInWindow)
    ) {
      await openOrFocusManagerPage(windowId);
    }

    if (tabIdsToClose.length > 0) {
      await chrome.tabs.remove(tabIdsToClose);
    }

    return {
      ok: true,
      stashedCount: stashItems.length,
      groupId: createdGroupId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function restoreSingleTab(
  groupId: string,
  tab: TabItem,
  locked: boolean,
  removeOnRestore: boolean,
  active = false
): Promise<void> {
  await chrome.tabs.create({ url: tab.url, active });
  if (!locked && removeOnRestore) {
    await mutateStore((current) => removeTabFromGroup(current, groupId, tab.id));
  }
}

export async function restoreTabGroup(
  group: TabGroup,
  removeOnRestore: boolean
): Promise<void> {
  for (const tab of group.tabs) {
    await chrome.tabs.create({ url: tab.url, active: false });
  }
  if (!group.locked && removeOnRestore) {
    await mutateStore((current) => removeGroupFromStore(current, group.id));
  }
}
