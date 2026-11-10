import { GoogleDriveError } from '../shared/googleDriveClient';
import {
  computeContentDigest,
  loadStore,
  normalizeStoreData,
  STORAGE_KEY,
} from '../shared/storage';
import { cloudSyncAdapter } from '../shared/syncAdapter';
import { saveSyncRuntimeState } from '../shared/syncState';
import { openOrFocusManagerPage, stashTabsInWindow } from '../shared/tabService';
import type { BackgroundMessage, DriveActionResult, StashResult } from '../shared/types';

const MENU_IDS = {
  STASH_ALL: 'autosynctab-stash-all',
  STASH_CURRENT: 'autosynctab-stash-current',
  STASH_OTHERS: 'autosynctab-stash-others',
  OPEN_MANAGER: 'autosynctab-open-manager',
} as const;

const COMMAND_IDS = {
  STASH_ALL: 'stash-all-tabs',
  STASH_CURRENT: 'stash-current-tab',
  OPEN_MANAGER: 'open-manager',
} as const;

const AUTO_SYNC_ALARM_NAME = 'autosynctab-auto-sync';
const AUTO_SYNC_DELAY_MINUTES = 0.5; // 30s debounce

function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.STASH_ALL,
      title: '收纳当前窗口所有标签页',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.STASH_CURRENT,
      title: '仅收纳当前标签页',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.STASH_OTHERS,
      title: '收纳其他标签页',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: 'autosynctab-separator',
      type: 'separator',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_MANAGER,
      title: '打开 autoSyncTab 管理页',
      contexts: ['page', 'action'],
    });
  });
}

async function wrapDriveAction<T>(fn: () => Promise<T>): Promise<DriveActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof GoogleDriveError) {
      return { ok: false, error: error.message, code: error.code };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'DRIVE_ERROR',
    };
  }
}

async function scheduleDebouncedAutoSync(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
    await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
    chrome.alarms.create(AUTO_SYNC_ALARM_NAME, { delayInMinutes: AUTO_SYNC_DELAY_MINUTES });
  }
}

async function cancelDebouncedAutoSync(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.alarms?.clear) {
    await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
  }
}

async function runBackgroundAutoSync(): Promise<void> {
  const store = await loadStore();
  if (!store.sync.enabled || !store.settings.autoSync) {
    return;
  }
  await cloudSyncAdapter.syncAuto({ checkRemote: true, silent: true });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  void runBackgroundAutoSync();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const windowId = tab?.windowId;
  switch (info.menuItemId) {
    case MENU_IDS.STASH_ALL:
      void stashTabsInWindow('all', windowId);
      break;
    case MENU_IDS.STASH_CURRENT:
      void stashTabsInWindow('current', windowId);
      break;
    case MENU_IDS.STASH_OTHERS:
      void stashTabsInWindow('others', windowId);
      break;
    case MENU_IDS.OPEN_MANAGER:
      void openOrFocusManagerPage(windowId);
      break;
    default:
      break;
  }
});

chrome.commands?.onCommand?.addListener((command) => {
  switch (command) {
    case COMMAND_IDS.STASH_ALL:
      void stashTabsInWindow('all');
      break;
    case COMMAND_IDS.STASH_CURRENT:
      void stashTabsInWindow('current');
      break;
    case COMMAND_IDS.OPEN_MANAGER:
      void openOrFocusManagerPage();
      break;
    default:
      break;
  }
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM_NAME) {
    void runBackgroundAutoSync();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
  const nextStore = normalizeStoreData(changes[STORAGE_KEY].newValue);

  if (!nextStore.sync.enabled || !nextStore.settings.autoSync) {
    void cancelDebouncedAutoSync();
    return;
  }

  const nextDigest = computeContentDigest(nextStore);
  const isDirty =
    nextStore.sync.lastSyncedHash !== null
      ? nextDigest !== nextStore.sync.lastSyncedHash
      : nextStore.groups.length > 0;

  if (isDirty) {
    void saveSyncRuntimeState({ pendingLocalChanges: true });
    void scheduleDebouncedAutoSync();
  } else {
    void cancelDebouncedAutoSync();
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: StashResult | DriveActionResult<unknown> | { ok: true }) => void
  ) => {
    switch (message.type) {
      case 'STASH_TABS':
        void stashTabsInWindow(message.scope, message.windowId).then(sendResponse);
        return true;
      case 'OPEN_MANAGER':
        void openOrFocusManagerPage(message.windowId).then(() => sendResponse({ ok: true }));
        return true;
      case 'DRIVE_STATUS':
        void wrapDriveAction(() => cloudSyncAdapter.getStatus()).then(sendResponse);
        return true;
      case 'DRIVE_SAVE_CLIENT_ID':
        void wrapDriveAction(() => cloudSyncAdapter.saveClientId(message.clientId)).then(
          sendResponse
        );
        return true;
      case 'DRIVE_CONNECT':
        void wrapDriveAction(() => cloudSyncAdapter.connect(message.clientId)).then(sendResponse);
        return true;
      case 'DRIVE_DISCONNECT':
        void wrapDriveAction(() => cloudSyncAdapter.disconnect()).then(sendResponse);
        return true;
      case 'DRIVE_BACKUP':
        void wrapDriveAction(() => cloudSyncAdapter.backup()).then(sendResponse);
        return true;
      case 'DRIVE_RESTORE':
        void wrapDriveAction(() => cloudSyncAdapter.restore(message.mode)).then(sendResponse);
        return true;
      case 'SYNC_NOW':
        void wrapDriveAction(() => cloudSyncAdapter.syncAuto({ checkRemote: true })).then(
          sendResponse
        );
        return true;
      default:
        return false;
    }
  }
);
