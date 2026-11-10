import { exportToJson, parseJsonBackup } from './formatters';
import {
  buildGoogleAuthUrl,
  createOAuthState,
  downloadDriveBackupFile,
  fetchGoogleUserEmail,
  findDriveBackupFile,
  GoogleDriveError,
  GOOGLE_DRIVE_BACKUP_FILENAME,
  isValidGoogleClientId,
  parseAuthRedirectUrl,
  revokeGoogleToken,
  uploadDriveBackupFile,
  type FetchLike,
} from './googleDriveClient';
import {
  applyRemoteBackup,
  clearAuthSession,
  loadAuthState,
  loadStore,
  mutateStore,
  saveAuthState,
  updateSyncInStore,
} from './storage';
import type {
  DriveBackupSummary,
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
      })
    );

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
      }
      throw error;
    }
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
      await mutateStore((current) =>
        updateSyncInStore(current, {
          enabled: true,
          remoteFileId: uploaded.id,
          lastSyncedAt: syncedAt,
        })
      );

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

      const updatedStore = await mutateStore((current) => {
        const merged = applyRemoteBackup(current, remoteBackup, mode, syncedAt);
        return updateSyncInStore(
          merged,
          {
            enabled: true,
            remoteFileId: fileId,
            lastSyncedAt: syncedAt,
          },
          syncedAt
        );
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
}

export const cloudSyncAdapter = new GoogleDriveSyncAdapter();
