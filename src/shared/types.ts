export interface TabItem {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned?: boolean;
}

export interface TabGroup {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  locked: boolean;
  tabs: TabItem[];
}

export interface ExtensionSettings {
  ignorePinnedTabs: boolean;
  removeOnRestore: boolean;
  openManagerAfterStash: boolean;
  deduplicateOnStash: boolean;
}

export interface SyncMetadata {
  provider: 'google-drive';
  enabled: boolean;
  lastSyncedAt: number | null;
  remoteFileId: string | null;
  accountEmail: string | null;
}

export interface SyncAuthState {
  clientId: string;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  accountEmail: string | null;
}

export interface DriveStatusSnapshot {
  sync: SyncMetadata;
  hasValidToken: boolean;
  clientId: string;
  redirectUri: string;
}

export interface DriveBackupSummary {
  fileId: string;
  syncedAt: number;
  groupCount: number;
  tabCount: number;
}

export interface DriveRestoreSummary {
  fileId: string;
  syncedAt: number;
  restoredGroupCount: number;
  restoredTabCount: number;
  totalGroupCount: number;
}

export type SyncRestoreMode = 'merge' | 'replace';

export interface AppStoreData {
  schemaVersion: number;
  updatedAt: number;
  groups: TabGroup[];
  settings: ExtensionSettings;
  sync: SyncMetadata;
}

export type StashScope = 'all' | 'current' | 'others';

export type DriveErrorCode =
  | 'AUTH_REQUIRED'
  | 'NO_BACKUP'
  | 'INVALID_CLIENT_ID'
  | 'DRIVE_ERROR';

export type DriveActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: DriveErrorCode };

export type BackgroundMessage =
  | { type: 'STASH_TABS'; scope: StashScope; windowId?: number }
  | { type: 'OPEN_MANAGER'; windowId?: number }
  | { type: 'DRIVE_STATUS' }
  | { type: 'DRIVE_SAVE_CLIENT_ID'; clientId: string }
  | { type: 'DRIVE_CONNECT'; clientId?: string }
  | { type: 'DRIVE_DISCONNECT' }
  | { type: 'DRIVE_BACKUP' }
  | { type: 'DRIVE_RESTORE'; mode: SyncRestoreMode };

export type StashResult =
  | { ok: true; stashedCount: number; groupId: string | null }
  | { ok: false; error: string };
