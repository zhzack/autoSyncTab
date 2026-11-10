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

export interface DeletedGroupTombstone {
  id: string;
  deletedAt: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ExtensionSettings {
  ignorePinnedTabs: boolean;
  removeOnRestore: boolean;
  openManagerAfterStash: boolean;
  deduplicateOnStash: boolean;
  autoSync: boolean;
  theme: ThemeMode;
}

export interface SyncMetadata {
  provider: 'google-drive';
  enabled: boolean;
  lastSyncedAt: number | null;
  lastSyncedHash: string | null;
  remoteFileId: string | null;
  remoteModifiedTime: string | null;
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
  deletedGroups: DeletedGroupTombstone[];
  settings: ExtensionSettings;
  sync: SyncMetadata;
}

export type SnapshotReason =
  | 'manual'
  | 'pre-restore'
  | 'pre-auto-sync'
  | 'pre-conflict'
  | 'pre-import';

export interface StoreSnapshot {
  id: string;
  createdAt: number;
  reason: SnapshotReason;
  note?: string;
  groupCount: number;
  tabCount: number;
  store: {
    schemaVersion: number;
    updatedAt: number;
    groups: TabGroup[];
    deletedGroups: DeletedGroupTombstone[];
    settings: ExtensionSettings;
  };
}

export type SyncConflictReason =
  | 'both-modified'
  | 'local-edited-remote-deleted'
  | 'remote-edited-local-deleted';

export interface SyncConflictItem {
  groupId: string;
  reason: SyncConflictReason;
  localGroup: TabGroup | null;
  remoteGroup: TabGroup | null;
}

export type SyncActivityState = 'idle' | 'syncing' | 'conflict' | 'auth-expired' | 'error';

export type ConflictResolutionStrategy = 'merge' | 'keep-local' | 'use-remote';

export interface SyncConflictPayload {
  detectedAt: number;
  fileId: string;
  remoteModifiedTime: string | null;
  items: SyncConflictItem[];
  remoteBackup: AppStoreData;
}

export interface SyncRuntimeState {
  status: SyncActivityState;
  pendingLocalChanges: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  conflict: SyncConflictPayload | null;
}

export interface AutoSyncResult {
  outcome:
    | 'skipped'
    | 'up-to-date'
    | 'uploaded'
    | 'pulled'
    | 'merged'
    | 'conflict'
    | 'auth-expired';
  syncedAt: number | null;
  message?: string;
  conflictCount?: number;
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
  | { type: 'DRIVE_RESTORE'; mode: SyncRestoreMode }
  | { type: 'SYNC_NOW' };

export type StashResult =
  | { ok: true; stashedCount: number; groupId: string | null }
  | { ok: false; error: string };
