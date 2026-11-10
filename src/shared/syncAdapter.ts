import {
  computeBookmarkDigest,
  loadBookmarkStore,
  normalizeBookmarkStoreData,
  saveBookmarkStore,
} from './bookmarks';
import { exportToJson, parseJsonBackup } from './formatters';
import {
  buildGoogleAuthUrl,
  createOAuthState,
  downloadDriveBackupFile,
  fetchGoogleUserEmail,
  findDriveBackupFile,
  getDriveFileMetadata,
  GoogleDriveError,
  GOOGLE_DRIVE_BACKUP_FILENAME,
  GOOGLE_DRIVE_BOOKMARKS_FILENAME,
  isValidGoogleClientId,
  parseAuthRedirectUrl,
  revokeGoogleToken,
  uploadDriveBackupFile,
  type DriveFileMeta,
  type FetchLike,
} from './googleDriveClient';
import { createSnapshot } from './snapshots';
import {
  applyRemoteBackup,
  clearAuthSession,
  computeContentDigest,
  loadAuthState,
  loadStore,
  mutateStore,
  saveAuthState,
  updateSyncInStore,
} from './storage';
import { reconcileStores } from './syncMerge';
import {
  DEFAULT_SYNC_RUNTIME_STATE,
  loadSyncRuntimeState,
  saveSyncRuntimeState,
} from './syncState';
import type {
  AutoSyncResult,
  ConflictResolutionStrategy,
  DriveBackupSummary,
  DriveBookmarksSummary,
  DriveRestoreSummary,
  DriveStatusSnapshot,
  SyncRestoreMode,
} from './types';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export interface CloudSyncAdapter {
  getRedirectUri(): string;
  getStatus(): Promise<DriveStatusSnapshot>;
  saveClientId(clientId: string): Promise<DriveStatusSnapshot>;
  connect(explicitClientId?: string): Promise<DriveStatusSnapshot>;
  disconnect(): Promise<DriveStatusSnapshot>;
  backup(): Promise<DriveBackupSummary>;
  restore(mode: SyncRestoreMode): Promise<DriveRestoreSummary>;
  syncAuto(options?: { checkRemote?: boolean; silent?: boolean }): Promise<AutoSyncResult>;
  resolveConflict(strategy: ConflictResolutionStrategy): Promise<AutoSyncResult>;
  backupBookmarks(): Promise<DriveBookmarksSummary>;
  pullBookmarks(): Promise<DriveBookmarksSummary>;
  syncBookmarksAuto(options?: { silent?: boolean }): Promise<AutoSyncResult>;
}

function hasUsableToken(token: string | null, expiresAt: number | null, now = Date.now()): boolean {
  if (!token) return false;
  if (expiresAt === null) return true;
  return now < expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

function formatWebAuthError(rawMessage?: string): string {
  if (!rawMessage) return 'Google 授权流程未完成';
  if (rawMessage.includes('Only one web auth flow is allowed')) {
    return '已有打开的 Google 授权窗口尚未关闭，请在任务栏找到并关闭之前的 Google 登录弹窗后再试。';
  }
  if (rawMessage.includes('The user did not approve access')) {
    return '你已取消或关闭了 Google 授权窗口。';
  }
  return rawMessage;
}

export class GoogleDriveSyncAdapter implements CloudSyncAdapter {
  private readonly customFetch?: FetchLike;
  private syncInFlight: Promise<AutoSyncResult> | null = null;

  constructor(fetchFn?: FetchLike) {
    this.customFetch = fetchFn;
  }

  private get fetchFn(): FetchLike {
    return this.customFetch ?? ((...args) => globalThis.fetch(...args));
  }

  getRedirectUri(): string {
    if (typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL) {
      return chrome.identity.getRedirectURL();
    }
    const extId =
      typeof chrome !== 'undefined' && chrome.runtime?.id
        ? chrome.runtime.id
        : 'jlckgkpfpnegkcfmoioonmkjjgoggpmb';
    return `https://${extId}.chromiumapp.org/`;
  }

  async getStatus(): Promise<DriveStatusSnapshot> {
    const [store, auth] = await Promise.all([loadStore(), loadAuthState()]);
    return {
      sync: store.sync,
      hasValidToken: hasUsableToken(auth.accessToken, auth.tokenExpiresAt),
      clientId: auth.clientId,
      redirectUri: this.getRedirectUri(),
    };
  }

  async saveClientId(clientId: string): Promise<DriveStatusSnapshot> {
    const trimmed = clientId.trim();
    if (!isValidGoogleClientId(trimmed)) {
      throw new GoogleDriveError(
        '请输入有效的 Google OAuth Client ID（通常以 .apps.googleusercontent.com 结尾）。',
        'INVALID_CLIENT_ID'
      );
    }
    await saveAuthState({ clientId: trimmed });
    return this.getStatus();
  }

  async connect(explicitClientId?: string): Promise<DriveStatusSnapshot> {
    const auth = await loadAuthState();
    const clientId = (explicitClientId ?? auth.clientId).trim();

    if (!isValidGoogleClientId(clientId)) {
      throw new GoogleDriveError(
        '请先配置有效的 Google OAuth Client ID（以 .apps.googleusercontent.com 结尾）。',
        'INVALID_CLIENT_ID'
      );
    }

    await saveAuthState({ clientId });

    const redirectUri = this.getRedirectUri();
    const state = createOAuthState();
    const authUrl = buildGoogleAuthUrl(clientId, redirectUri, state);

    if (typeof chrome === 'undefined' || !chrome.identity?.launchWebAuthFlow) {
      throw new GoogleDriveError(
        '当前浏览器尚未加载 identity 权限，请前往 chrome://extensions/ 对 autoSyncTab 点击一次「刷新」后再试。',
        'AUTH_REQUIRED'
      );
    }

    const redirectResultUrl = await new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(
            new GoogleDriveError(
              formatWebAuthError(chrome.runtime.lastError.message),
              'AUTH_REQUIRED'
            )
          );
          return;
        }
        if (!responseUrl) {
          reject(new GoogleDriveError('未收到 Google 授权回调地址。', 'AUTH_REQUIRED'));
          return;
        }
        resolve(responseUrl);
      });
    });

    const { accessToken, expiresInSeconds } = parseAuthRedirectUrl(redirectResultUrl, state);
    const tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    const email = await fetchGoogleUserEmail(accessToken, this.fetchFn);

    await saveAuthState({
      clientId,
      accessToken,
      tokenExpiresAt,
      accountEmail: email,
    });

    await mutateStore((current) =>
      updateSyncInStore(current, {
        enabled: true,
        accountEmail: email ?? current.sync.accountEmail,
      })
    );

    const runtime = await loadSyncRuntimeState();
    if (runtime.status === 'auth-expired' || runtime.status === 'error') {
      await saveSyncRuntimeState({ status: 'idle', lastError: null });
    }

    return this.getStatus();
  }

  async disconnect(): Promise<DriveStatusSnapshot> {
    const auth = await loadAuthState();
    if (auth.accessToken) {
      await revokeGoogleToken(auth.accessToken, this.fetchFn);
    }

    await clearAuthSession();
    await mutateStore((current) =>
      updateSyncInStore(current, {
        enabled: false,
        accountEmail: null,
        remoteFileId: null,
        remoteModifiedTime: null,
        lastSyncedHash: null,
      })
    );
    await saveSyncRuntimeState({ ...DEFAULT_SYNC_RUNTIME_STATE });

    return this.getStatus();
  }

  private async requireAccessToken(): Promise<string> {
    const auth = await loadAuthState();
    if (!hasUsableToken(auth.accessToken, auth.tokenExpiresAt)) {
      await clearAuthSession();
      throw new GoogleDriveError('Google 授权已过期或尚未连接，请先授权登录。', 'AUTH_REQUIRED');
    }
    return auth.accessToken!;
  }

  private async handleUnauthorized<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.requireAccessToken();
    try {
      return await fn(token);
    } catch (error) {
      if (error instanceof GoogleDriveError && error.code === 'AUTH_REQUIRED') {
        await clearAuthSession();
        await saveSyncRuntimeState({
          status: 'auth-expired',
          lastError: error.message,
        });
      }
      throw error;
    }
  }

  private async resolveRemoteFileMeta(
    token: string,
    cachedFileId: string | null,
    fileName = GOOGLE_DRIVE_BACKUP_FILENAME
  ): Promise<DriveFileMeta | null> {
    if (cachedFileId) {
      const meta = await getDriveFileMetadata(token, cachedFileId, this.fetchFn);
      if (meta) return meta;
    }
    return findDriveBackupFile(token, fileName, this.fetchFn);
  }

  async backup(): Promise<DriveBackupSummary> {
    return this.handleUnauthorized(async (token) => {
      const store = await loadStore();
      let remoteFileId = store.sync.remoteFileId;

      if (!remoteFileId) {
        const existing = await findDriveBackupFile(
          token,
          GOOGLE_DRIVE_BACKUP_FILENAME,
          this.fetchFn
        );
        remoteFileId = existing?.id ?? null;
      }

      const uploaded = await uploadDriveBackupFile(
        token,
        exportToJson(store),
        remoteFileId,
        GOOGLE_DRIVE_BACKUP_FILENAME,
        this.fetchFn
      );

      const syncedAt = Date.now();
      const digest = computeContentDigest(store);
      await mutateStore((current) =>
        updateSyncInStore(current, {
          enabled: true,
          remoteFileId: uploaded.id,
          remoteModifiedTime: uploaded.modifiedTime,
          lastSyncedAt: syncedAt,
          lastSyncedHash: digest,
        })
      );

      await saveSyncRuntimeState({
        status: 'idle',
        pendingLocalChanges: false,
        lastCheckedAt: syncedAt,
        lastError: null,
        conflict: null,
      });

      return {
        fileId: uploaded.id,
        syncedAt,
        groupCount: store.groups.length,
        tabCount: store.groups.reduce((sum, g) => sum + g.tabs.length, 0),
      };
    });
  }

  async restore(mode: SyncRestoreMode): Promise<DriveRestoreSummary> {
    return this.handleUnauthorized(async (token) => {
      const store = await loadStore();
      let fileId = store.sync.remoteFileId;

      if (!fileId) {
        const existing = await findDriveBackupFile(
          token,
          GOOGLE_DRIVE_BACKUP_FILENAME,
          this.fetchFn
        );
        fileId = existing?.id ?? null;
      }

      if (!fileId) {
        throw new GoogleDriveError(
          'Google Drive 中尚未找到备份文件，请先点击「立即备份」。',
          'NO_BACKUP'
        );
      }

      let rawJson: string;
      try {
        rawJson = await downloadDriveBackupFile(token, fileId, this.fetchFn);
      } catch (error) {
        // Cached remoteFileId might be stale; retry lookup by filename once.
        if (error instanceof GoogleDriveError && error.code === 'NO_BACKUP') {
          const fallback = await findDriveBackupFile(
            token,
            GOOGLE_DRIVE_BACKUP_FILENAME,
            this.fetchFn
          );
          if (!fallback) {
            throw new GoogleDriveError(
              'Google Drive 中尚未找到备份文件，请先点击「立即备份」。',
              'NO_BACKUP'
            );
          }
          fileId = fallback.id;
          rawJson = await downloadDriveBackupFile(token, fileId, this.fetchFn);
        } else {
          throw error;
        }
      }

      const remoteBackup = parseJsonBackup(rawJson);
      const syncedAt = Date.now();

      if (store.groups.length > 0) {
        await createSnapshot(
          store,
          'pre-restore',
          mode === 'replace' ? '云端覆盖恢复前自动快照' : '云端合并恢复前自动快照',
          syncedAt
        );
      }

      const updatedStore = await mutateStore((current) => {
        const merged = applyRemoteBackup(current, remoteBackup, mode, syncedAt);
        return updateSyncInStore(
          merged,
          {
            enabled: true,
            remoteFileId: fileId,
            lastSyncedAt: syncedAt,
            lastSyncedHash: mode === 'replace' ? computeContentDigest(merged) : null,
          },
          syncedAt
        );
      });

      await saveSyncRuntimeState({
        status: 'idle',
        pendingLocalChanges: mode === 'merge',
        lastCheckedAt: syncedAt,
        lastError: null,
        conflict: null,
      });

      return {
        fileId,
        syncedAt,
        restoredGroupCount: remoteBackup.groups.length,
        restoredTabCount: remoteBackup.groups.reduce((sum, g) => sum + g.tabs.length, 0),
        totalGroupCount: updatedStore.groups.length,
      };
    });
  }

  async syncAuto(options: { checkRemote?: boolean; silent?: boolean } = {}): Promise<AutoSyncResult> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    const runner = this.performAutoSync(options).finally(() => {
      this.syncInFlight = null;
    });
    this.syncInFlight = runner;
    return runner;
  }

  private async performAutoSync(options: {
    checkRemote?: boolean;
    silent?: boolean;
  }): Promise<AutoSyncResult> {
    const checkRemote = options.checkRemote ?? true;
    const store = await loadStore();

    if (!store.sync.enabled) {
      return { outcome: 'skipped', syncedAt: store.sync.lastSyncedAt };
    }

    const localDigest = computeContentDigest(store);
    const isLocalDirty =
      store.sync.lastSyncedHash !== null
        ? localDigest !== store.sync.lastSyncedHash
        : store.groups.length > 0;

    const runtime = await loadSyncRuntimeState();
    if (runtime.conflict) {
      await saveSyncRuntimeState({
        status: 'conflict',
        pendingLocalChanges: true,
      });
      return {
        outcome: 'conflict',
        syncedAt: store.sync.lastSyncedAt,
        conflictCount: runtime.conflict.items.length,
      };
    }

    const auth = await loadAuthState();
    if (!hasUsableToken(auth.accessToken, auth.tokenExpiresAt)) {
      await clearAuthSession();
      await saveSyncRuntimeState({
        status: 'auth-expired',
        pendingLocalChanges: isLocalDirty,
        lastError: 'Google 授权已过期，请重新登录后继续自动同步。',
      });
      return { outcome: 'auth-expired', syncedAt: store.sync.lastSyncedAt };
    }

    await saveSyncRuntimeState({
      status: 'syncing',
      lastError: null,
    });

    try {
      return await this.handleUnauthorized(async (token) => {
        const now = Date.now();
        let remoteMeta: DriveFileMeta | null = null;

        if (checkRemote || !store.sync.remoteFileId) {
          remoteMeta = await this.resolveRemoteFileMeta(token, store.sync.remoteFileId);
        }

        // Case 1: No backup file on Drive yet.
        if (!remoteMeta) {
          if (store.groups.length === 0 && !isLocalDirty) {
            await saveSyncRuntimeState({
              status: 'idle',
              pendingLocalChanges: false,
              lastCheckedAt: now,
              lastError: null,
            });
            return { outcome: 'up-to-date', syncedAt: store.sync.lastSyncedAt };
          }

          const uploaded = await uploadDriveBackupFile(
            token,
            exportToJson(store),
            null,
            GOOGLE_DRIVE_BACKUP_FILENAME,
            this.fetchFn
          );
          await mutateStore((current) =>
            updateSyncInStore(current, {
              enabled: true,
              remoteFileId: uploaded.id,
              remoteModifiedTime: uploaded.modifiedTime,
              lastSyncedAt: now,
              lastSyncedHash: localDigest,
            })
          );
          await saveSyncRuntimeState({
            status: 'idle',
            pendingLocalChanges: false,
            lastCheckedAt: now,
            lastError: null,
            conflict: null,
          });
          return { outcome: 'uploaded', syncedAt: now };
        }

        // Case 2: Remote file exists — check whether remote changed since last sync.
        const remoteUnchanged =
          Boolean(store.sync.lastSyncedAt) &&
          Boolean(store.sync.remoteModifiedTime) &&
          Boolean(remoteMeta.modifiedTime) &&
          remoteMeta.modifiedTime === store.sync.remoteModifiedTime;

        if (remoteUnchanged) {
          if (!isLocalDirty) {
            await saveSyncRuntimeState({
              status: 'idle',
              pendingLocalChanges: false,
              lastCheckedAt: now,
              lastError: null,
            });
            return { outcome: 'up-to-date', syncedAt: store.sync.lastSyncedAt };
          }

          const uploaded = await uploadDriveBackupFile(
            token,
            exportToJson(store),
            remoteMeta.id,
            GOOGLE_DRIVE_BACKUP_FILENAME,
            this.fetchFn
          );
          await mutateStore((current) =>
            updateSyncInStore(current, {
              enabled: true,
              remoteFileId: uploaded.id,
              remoteModifiedTime: uploaded.modifiedTime,
              lastSyncedAt: now,
              lastSyncedHash: localDigest,
            })
          );
          await saveSyncRuntimeState({
            status: 'idle',
            pendingLocalChanges: false,
            lastCheckedAt: now,
            lastError: null,
            conflict: null,
          });
          return { outcome: 'uploaded', syncedAt: now };
        }

        // Case 3: Remote changed or modifiedTime unknown — download and inspect.
        const rawJson = await downloadDriveBackupFile(token, remoteMeta.id, this.fetchFn);
        const remoteBackup = parseJsonBackup(rawJson);
        const remoteDigest = computeContentDigest(remoteBackup);

        if (remoteDigest === localDigest) {
          await mutateStore((current) =>
            updateSyncInStore(current, {
              enabled: true,
              remoteFileId: remoteMeta.id,
              remoteModifiedTime: remoteMeta.modifiedTime,
              lastSyncedAt: now,
              lastSyncedHash: localDigest,
            })
          );
          await saveSyncRuntimeState({
            status: 'idle',
            pendingLocalChanges: false,
            lastCheckedAt: now,
            lastError: null,
            conflict: null,
          });
          return { outcome: 'up-to-date', syncedAt: now };
        }

        const reconciled = reconcileStores(store, remoteBackup, store.sync.lastSyncedAt, now);

        // If local has no unsynced edits, seamlessly pull remote state.
        if (!isLocalDirty) {
          if (store.groups.length > 0) {
            await createSnapshot(store, 'pre-auto-sync', '自动同步拉取远端前备份', now);
          }
          const pulledStore = {
            ...reconciled.mergedStore,
            groups: remoteBackup.groups,
            deletedGroups: remoteBackup.deletedGroups,
            settings: remoteBackup.settings,
          };
          const pulledDigest = computeContentDigest(pulledStore);
          await mutateStore((current) =>
            updateSyncInStore(
              {
                ...current,
                updatedAt: now,
                groups: pulledStore.groups,
                deletedGroups: pulledStore.deletedGroups,
                settings: pulledStore.settings,
              },
              {
                enabled: true,
                remoteFileId: remoteMeta.id,
                remoteModifiedTime: remoteMeta.modifiedTime,
                lastSyncedAt: now,
                lastSyncedHash: pulledDigest,
              },
              now
            )
          );
          await saveSyncRuntimeState({
            status: 'idle',
            pendingLocalChanges: false,
            lastCheckedAt: now,
            lastError: null,
            conflict: null,
          });
          return { outcome: 'pulled', syncedAt: now };
        }

        // Disjoint concurrent changes: auto-merge cleanly without interrupting user.
        if (reconciled.conflicts.length === 0) {
          if (reconciled.hasChangesForLocal && store.groups.length > 0) {
            await createSnapshot(store, 'pre-auto-sync', '自动合并多设备变更前备份', now);
          }

          let finalMeta = remoteMeta;
          if (reconciled.hasChangesForRemote) {
            finalMeta = await uploadDriveBackupFile(
              token,
              exportToJson(reconciled.mergedStore),
              remoteMeta.id,
              GOOGLE_DRIVE_BACKUP_FILENAME,
              this.fetchFn
            );
          }

          const mergedDigest = computeContentDigest(reconciled.mergedStore);
          await mutateStore((current) =>
            updateSyncInStore(
              {
                ...current,
                updatedAt: now,
                groups: reconciled.mergedStore.groups,
                deletedGroups: reconciled.mergedStore.deletedGroups,
                settings: reconciled.mergedStore.settings,
              },
              {
                enabled: true,
                remoteFileId: finalMeta.id,
                remoteModifiedTime: finalMeta.modifiedTime,
                lastSyncedAt: now,
                lastSyncedHash: mergedDigest,
              },
              now
            )
          );
          await saveSyncRuntimeState({
            status: 'idle',
            pendingLocalChanges: false,
            lastCheckedAt: now,
            lastError: null,
            conflict: null,
          });
          return {
            outcome: reconciled.hasChangesForLocal ? 'merged' : 'uploaded',
            syncedAt: now,
          };
        }

        // Overlapping conflict detected: preserve local snapshot & surface conflict resolution UI.
        await createSnapshot(store, 'pre-conflict', '检测到同步冲突，自动保留本地快照', now);
        await saveSyncRuntimeState({
          status: 'conflict',
          pendingLocalChanges: true,
          lastCheckedAt: now,
          lastError: null,
          conflict: {
            detectedAt: now,
            fileId: remoteMeta.id,
            remoteModifiedTime: remoteMeta.modifiedTime,
            items: reconciled.conflicts,
            remoteBackup,
          },
        });
        return {
          outcome: 'conflict',
          syncedAt: store.sync.lastSyncedAt,
          conflictCount: reconciled.conflicts.length,
        };
      });
    } catch (error) {
      if (error instanceof GoogleDriveError && error.code === 'AUTH_REQUIRED') {
        if (options.silent) {
          return { outcome: 'auth-expired', syncedAt: store.sync.lastSyncedAt };
        }
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      await saveSyncRuntimeState({
        status: 'error',
        lastError: message,
      });
      if (options.silent) {
        return { outcome: 'skipped', syncedAt: store.sync.lastSyncedAt, message };
      }
      throw error;
    }
  }

  async resolveConflict(strategy: ConflictResolutionStrategy): Promise<AutoSyncResult> {
    const runtime = await loadSyncRuntimeState();
    const conflict = runtime.conflict;
    if (!conflict) {
      return this.syncAuto({ checkRemote: true });
    }

    const now = Date.now();
    const store = await loadStore();

    if (strategy === 'use-remote') {
      if (store.groups.length > 0) {
        await createSnapshot(store, 'pre-conflict', '选择云端版本覆盖本地前的安全快照', now);
      }
      const nextStore = await mutateStore((current) => {
        const replaced = applyRemoteBackup(current, conflict.remoteBackup, 'replace', now);
        return updateSyncInStore(
          replaced,
          {
            enabled: true,
            remoteFileId: conflict.fileId || current.sync.remoteFileId,
            remoteModifiedTime: conflict.remoteModifiedTime,
            lastSyncedAt: now,
            lastSyncedHash: computeContentDigest(replaced),
          },
          now
        );
      });
      void nextStore;
      await saveSyncRuntimeState({
        status: 'idle',
        pendingLocalChanges: false,
        lastCheckedAt: now,
        lastError: null,
        conflict: null,
      });
      return { outcome: 'pulled', syncedAt: now };
    }

    return this.handleUnauthorized(async (token) => {
      if (strategy === 'keep-local') {
        const uploaded = await uploadDriveBackupFile(
          token,
          exportToJson(store),
          conflict.fileId || store.sync.remoteFileId,
          GOOGLE_DRIVE_BACKUP_FILENAME,
          this.fetchFn
        );
        const digest = computeContentDigest(store);
        await mutateStore((current) =>
          updateSyncInStore(current, {
            enabled: true,
            remoteFileId: uploaded.id,
            remoteModifiedTime: uploaded.modifiedTime,
            lastSyncedAt: now,
            lastSyncedHash: digest,
          })
        );
        await saveSyncRuntimeState({
          status: 'idle',
          pendingLocalChanges: false,
          lastCheckedAt: now,
          lastError: null,
          conflict: null,
        });
        return { outcome: 'uploaded', syncedAt: now };
      }

      // strategy === 'merge'
      if (store.groups.length > 0) {
        await createSnapshot(store, 'pre-conflict', '冲突智能合并前本地安全快照', now);
      }
      const reconciled = reconcileStores(store, conflict.remoteBackup, store.sync.lastSyncedAt, now);
      const uploaded = await uploadDriveBackupFile(
        token,
        exportToJson(reconciled.mergedStore),
        conflict.fileId || store.sync.remoteFileId,
        GOOGLE_DRIVE_BACKUP_FILENAME,
        this.fetchFn
      );
      const mergedDigest = computeContentDigest(reconciled.mergedStore);
      await mutateStore((current) =>
        updateSyncInStore(
          {
            ...current,
            updatedAt: now,
            groups: reconciled.mergedStore.groups,
            deletedGroups: reconciled.mergedStore.deletedGroups,
            settings: reconciled.mergedStore.settings,
          },
          {
            enabled: true,
            remoteFileId: uploaded.id,
            remoteModifiedTime: uploaded.modifiedTime,
            lastSyncedAt: now,
            lastSyncedHash: mergedDigest,
          },
          now
        )
      );
      await saveSyncRuntimeState({
        status: 'idle',
        pendingLocalChanges: false,
        lastCheckedAt: now,
        lastError: null,
        conflict: null,
      });
      return { outcome: 'merged', syncedAt: now };
    });
  }

  async backupBookmarks(): Promise<DriveBookmarksSummary> {
    return this.handleUnauthorized(async (token) => {
      const bookmarkStore = await loadBookmarkStore();
      let remoteFileId = bookmarkStore.remoteFileId;

      if (!remoteFileId) {
        const existing = await findDriveBackupFile(
          token,
          GOOGLE_DRIVE_BOOKMARKS_FILENAME,
          this.fetchFn
        );
        remoteFileId = existing?.id ?? null;
      }

      const payload = JSON.stringify(
        {
          schemaVersion: bookmarkStore.schemaVersion,
          updatedAt: bookmarkStore.updatedAt,
          roots: bookmarkStore.roots,
        },
        null,
        2
      );

      const uploaded = await uploadDriveBackupFile(
        token,
        payload,
        remoteFileId,
        GOOGLE_DRIVE_BOOKMARKS_FILENAME,
        this.fetchFn
      );

      const syncedAt = Date.now();
      const digest = computeBookmarkDigest(bookmarkStore.roots);
      await saveBookmarkStore({
        ...bookmarkStore,
        remoteFileId: uploaded.id,
        remoteModifiedTime: uploaded.modifiedTime,
        lastSyncedAt: syncedAt,
        lastSyncedHash: digest,
      });

      return {
        fileId: uploaded.id,
        syncedAt,
        bookmarkCount: bookmarkStore.totalCount,
        folderCount: bookmarkStore.folderCount,
      };
    });
  }

  async pullBookmarks(): Promise<DriveBookmarksSummary> {
    return this.handleUnauthorized(async (token) => {
      const current = await loadBookmarkStore();
      let fileId = current.remoteFileId;

      const meta = await this.resolveRemoteFileMeta(
        token,
        fileId,
        GOOGLE_DRIVE_BOOKMARKS_FILENAME
      );
      if (!meta) {
        throw new GoogleDriveError(
          'Google Drive 中尚未找到书签备份文件，请先同步上传浏览器书签。',
          'NO_BACKUP'
        );
      }
      fileId = meta.id;

      const rawJson = await downloadDriveBackupFile(token, fileId, this.fetchFn);
      const parsed = normalizeBookmarkStoreData(JSON.parse(rawJson));
      const syncedAt = Date.now();
      const digest = computeBookmarkDigest(parsed.roots);

      await saveBookmarkStore({
        ...parsed,
        source: 'cloud',
        lastCapturedAt: current.lastCapturedAt,
        lastSyncedAt: syncedAt,
        lastSyncedHash: digest,
        remoteFileId: fileId,
        remoteModifiedTime: meta.modifiedTime,
      });

      return {
        fileId,
        syncedAt,
        bookmarkCount: parsed.totalCount,
        folderCount: parsed.folderCount,
      };
    });
  }

  async syncBookmarksAuto(options: { silent?: boolean } = {}): Promise<AutoSyncResult> {
    const [store, bookmarkStore, auth] = await Promise.all([
      loadStore(),
      loadBookmarkStore(),
      loadAuthState(),
    ]);

    if (!store.sync.enabled) {
      return { outcome: 'skipped', syncedAt: bookmarkStore.lastSyncedAt };
    }

    if (!hasUsableToken(auth.accessToken, auth.tokenExpiresAt)) {
      return { outcome: 'auth-expired', syncedAt: bookmarkStore.lastSyncedAt };
    }

    try {
      return await this.handleUnauthorized(async (token) => {
        const now = Date.now();
        const remoteMeta = await this.resolveRemoteFileMeta(
          token,
          bookmarkStore.remoteFileId,
          GOOGLE_DRIVE_BOOKMARKS_FILENAME
        );
        const localDigest = computeBookmarkDigest(bookmarkStore.roots);
        const isLocalDirty =
          bookmarkStore.lastSyncedHash !== null
            ? localDigest !== bookmarkStore.lastSyncedHash
            : bookmarkStore.totalCount > 0;

        if (!remoteMeta) {
          if (bookmarkStore.totalCount === 0) {
            return { outcome: 'up-to-date', syncedAt: bookmarkStore.lastSyncedAt };
          }
          const summary = await this.backupBookmarks();
          return { outcome: 'uploaded', syncedAt: summary.syncedAt };
        }

        // Never overwrite non-empty cloud bookmarks with an empty local browser tree automatically.
        if (bookmarkStore.totalCount === 0) {
          const pulled = await this.pullBookmarks();
          return { outcome: 'pulled', syncedAt: pulled.syncedAt };
        }

        const remoteUnchanged =
          Boolean(bookmarkStore.lastSyncedAt) &&
          Boolean(bookmarkStore.remoteModifiedTime) &&
          Boolean(remoteMeta.modifiedTime) &&
          remoteMeta.modifiedTime === bookmarkStore.remoteModifiedTime;

        if (remoteUnchanged) {
          if (!isLocalDirty) {
            return { outcome: 'up-to-date', syncedAt: bookmarkStore.lastSyncedAt };
          }
          const summary = await this.backupBookmarks();
          return { outcome: 'uploaded', syncedAt: summary.syncedAt };
        }

        if (!isLocalDirty) {
          const pulled = await this.pullBookmarks();
          return { outcome: 'pulled', syncedAt: pulled.syncedAt };
        }

        // In single-browser auto-capture mode, upload local bookmarks snapshot to Drive.
        const summary = await this.backupBookmarks();
        return { outcome: 'uploaded', syncedAt: summary.syncedAt ?? now };
      });
    } catch (error) {
      if (options.silent) {
        return {
          outcome: error instanceof GoogleDriveError && error.code === 'AUTH_REQUIRED'
            ? 'auth-expired'
            : 'skipped',
          syncedAt: bookmarkStore.lastSyncedAt,
        };
      }
      throw error;
    }
  }
}

export const cloudSyncAdapter = new GoogleDriveSyncAdapter();
