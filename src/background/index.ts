import { GoogleDriveError } from '../shared/googleDriveClient';
import { cloudSyncAdapter } from '../shared/syncAdapter';
import { openOrFocusManagerPage, stashTabsInWindow } from '../shared/tabService';
import type { BackgroundMessage, DriveActionResult, StashResult } from '../shared/types';

const MENU_IDS = {
  STASH_ALL: 'autosynctab-stash-all',
  STASH_CURRENT: 'autosynctab-stash-current',
  STASH_OTHERS: 'autosynctab-stash-others',
  OPEN_MANAGER: 'autosynctab-open-manager',
} as const;

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

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
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
      default:
        return false;
    }
  }
);
