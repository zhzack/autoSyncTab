import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

const localStoreMemory = new Map<string, unknown>();
const storageListeners = new Set<StorageChangeListener>();

export const chromeMockControls = {
  tabsList: [] as chrome.tabs.Tab[],
  createdTabs: [] as chrome.tabs.CreateProperties[],
  updatedTabs: [] as Array<{ tabId: number; props: chrome.tabs.UpdateProperties }>,
  removedTabIds: [] as number[],
  focusedWindowIds: [] as number[],
  sentMessages: [] as unknown[],
  sendMessageHandler: null as ((msg: unknown) => Promise<unknown> | unknown) | null,
  launchAuthHandler: null as ((authUrl: string) => { redirectUrl?: string; error?: string }) | null,
  reset() {
    localStoreMemory.clear();
    storageListeners.clear();
    this.tabsList = [];
    this.createdTabs = [];
    this.updatedTabs = [];
    this.removedTabIds = [];
    this.focusedWindowIds = [];
    this.sentMessages = [];
    this.sendMessageHandler = null;
    this.launchAuthHandler = null;
    chromeMock.runtime.lastError = undefined;
  },
};

const chromeMock = {
  runtime: {
    lastError: undefined as { message?: string } | undefined,
    getURL: vi.fn((path: string) => `chrome-extension://test-ext-id/${path}`),
    sendMessage: vi.fn(async (msg: unknown) => {
      chromeMockControls.sentMessages.push(msg);
      if (chromeMockControls.sendMessageHandler) {
        return await chromeMockControls.sendMessageHandler(msg);
      }
      return { ok: true, stashedCount: 0, groupId: null };
    }),
    onInstalled: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (key?: string | string[] | Record<string, unknown>) => {
        if (typeof key === 'string') {
          return key in Object.fromEntries(localStoreMemory)
            ? { [key]: localStoreMemory.get(key) }
            : {};
        }
        return Object.fromEntries(localStoreMemory);
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [k, newValue] of Object.entries(items)) {
          const oldValue = localStoreMemory.get(k);
          localStoreMemory.set(k, newValue);
          changes[k] = { oldValue, newValue };
        }
        for (const listener of storageListeners) {
          listener(changes, 'local');
        }
      }),
    },
    onChanged: {
      addListener: vi.fn((fn: StorageChangeListener) => {
        storageListeners.add(fn);
      }),
      removeListener: vi.fn((fn: StorageChangeListener) => {
        storageListeners.delete(fn);
      }),
    },
  },
  tabs: {
    query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo) => {
      return chromeMockControls.tabsList.filter((tab) => {
        if (typeof queryInfo.windowId === 'number' && tab.windowId !== queryInfo.windowId) {
          return false;
        }
        if (typeof queryInfo.url === 'string' && tab.url !== queryInfo.url) {
          return false;
        }
        return true;
      });
    }),
    create: vi.fn(async (props: chrome.tabs.CreateProperties) => {
      chromeMockControls.createdTabs.push(props);
      return {
        id: 1000 + chromeMockControls.createdTabs.length,
        url: props.url,
        windowId: props.windowId ?? 1,
        active: Boolean(props.active),
        pinned: false,
      } as chrome.tabs.Tab;
    }),
    update: vi.fn(async (tabId: number, props: chrome.tabs.UpdateProperties) => {
      chromeMockControls.updatedTabs.push({ tabId, props });
      return { id: tabId } as chrome.tabs.Tab;
    }),
    remove: vi.fn(async (tabIds: number | number[]) => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      chromeMockControls.removedTabIds.push(...ids);
    }),
  },
  windows: {
    update: vi.fn(async (windowId: number) => {
      chromeMockControls.focusedWindowIds.push(windowId);
      return { id: windowId } as chrome.windows.Window;
    }),
  },
  contextMenus: {
    removeAll: vi.fn((cb?: () => void) => cb?.()),
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
  identity: {
    getRedirectURL: vi.fn(() => 'https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn(
      (
        details: { url: string; interactive?: boolean },
        callback: (responseUrl?: string) => void
      ) => {
        chromeMock.runtime.lastError = undefined;
        if (!chromeMockControls.launchAuthHandler) {
          chromeMock.runtime.lastError = { message: 'No auth handler mocked' };
          callback(undefined);
          return;
        }
        const outcome = chromeMockControls.launchAuthHandler(details.url);
        if (outcome.error) {
          chromeMock.runtime.lastError = { message: outcome.error };
          callback(undefined);
          return;
        }
        callback(outcome.redirectUrl);
      }
    ),
  },
};

Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  writable: true,
});
