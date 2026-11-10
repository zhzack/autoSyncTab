import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadStore } from '../shared/storage';
import {
  isStashableUrl,
  selectTabsToStash,
  stashTabsInWindow,
  type BrowserTabLike,
} from '../shared/tabService';
import { chromeMockControls } from './setup';

const EXT_ORIGIN = 'chrome-extension://test-ext-id/';

const SAMPLE_TABS: BrowserTabLike[] = [
  { id: 1, url: 'https://pinned.example.com', title: 'Pinned', pinned: true, active: false },
  { id: 2, url: 'https://active.example.com', title: 'Active', pinned: false, active: true },
  { id: 3, url: 'https://docs.example.com', title: 'Docs', pinned: false, active: false },
  { id: 4, url: 'https://docs.example.com', title: 'Docs Dup', pinned: false, active: false },
  { id: 5, url: 'chrome://extensions/', title: 'Extensions', pinned: false, active: false },
  { id: 6, url: `${EXT_ORIGIN}manager.html`, title: 'autoSyncTab', pinned: false, active: false },
];

describe('tabService', () => {
  beforeEach(() => {
    chromeMockControls.reset();
  });

  it('identifies stashable URLs and skips internal or own extension pages', () => {
    expect(isStashableUrl('https://github.com', EXT_ORIGIN)).toBe(true);
    expect(isStashableUrl('http://localhost:3000', EXT_ORIGIN)).toBe(true);
    expect(isStashableUrl('chrome://settings', EXT_ORIGIN)).toBe(false);
    expect(isStashableUrl('about:blank', EXT_ORIGIN)).toBe(false);
    expect(isStashableUrl(`${EXT_ORIGIN}manager.html`, EXT_ORIGIN)).toBe(false);
  });

  it('filters tabs by scope, pinned preference, and deduplication', () => {
    const allResult = selectTabsToStash(SAMPLE_TABS, 'all', DEFAULT_SETTINGS, EXT_ORIGIN);
    expect(allResult.stashItems.map((t) => t.url)).toEqual([
      'https://active.example.com',
      'https://docs.example.com',
    ]);
    expect(allResult.tabIdsToClose).toEqual([2, 3, 4]);

    const othersResult = selectTabsToStash(
      SAMPLE_TABS,
      'others',
      { ...DEFAULT_SETTINGS, ignorePinnedTabs: false, deduplicateOnStash: false },
      EXT_ORIGIN
    );
    expect(othersResult.stashItems.map((t) => t.url)).toEqual([
      'https://pinned.example.com',
      'https://docs.example.com',
      'https://docs.example.com',
    ]);
    expect(othersResult.tabIdsToClose).toEqual([1, 3, 4]);

    const currentPinned = selectTabsToStash(
      [{ id: 10, url: 'https://mail.example.com', title: 'Mail', pinned: true, active: true }],
      'current',
      DEFAULT_SETTINGS,
      EXT_ORIGIN
    );
    expect(currentPinned.stashItems).toHaveLength(1);
    expect(currentPinned.tabIdsToClose).toEqual([10]);
  });

  it('stashes window tabs, opens manager page, and removes stashed tabs', async () => {
    chromeMockControls.tabsList = [
      { id: 11, windowId: 1, url: 'https://react.dev', title: 'React', active: true } as chrome.tabs.Tab,
      { id: 12, windowId: 1, url: 'https://vite.dev', title: 'Vite', active: false } as chrome.tabs.Tab,
    ];

    const res = await stashTabsInWindow('all', 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stashedCount).toBe(2);
    }

    const store = await loadStore();
    expect(store.groups).toHaveLength(1);
    expect(store.groups[0].tabs).toHaveLength(2);
    expect(chromeMockControls.createdTabs[0].url).toBe(`${EXT_ORIGIN}manager.html`);
    expect(chromeMockControls.removedTabIds).toEqual([11, 12]);
  });
});
