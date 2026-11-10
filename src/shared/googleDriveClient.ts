import type { DriveErrorCode } from './types';

export const GOOGLE_DRIVE_BACKUP_FILENAME = 'autosynctab-backup.json';
export const GOOGLE_DRIVE_BOOKMARKS_FILENAME = 'autosynctab-bookmarks.json';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export type FetchLike = typeof fetch;

export class GoogleDriveError extends Error {
  readonly code: DriveErrorCode;
  readonly status?: number;

  constructor(message: string, code: DriveErrorCode = 'DRIVE_ERROR', status?: number) {
    super(message);
    this.name = 'GoogleDriveError';
    this.code = code;
    this.status = status;
  }
}

export function isValidGoogleClientId(clientId: string): boolean {
  const trimmed = clientId.trim();
  return trimmed.length > 20 && trimmed.endsWith('.apps.googleusercontent.com');
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId.trim());
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);
  return authUrl.toString();
}

export function parseAuthRedirectUrl(
  redirectUrl: string,
  expectedState: string
): { accessToken: string; expiresInSeconds: number } {
  const parsed = new URL(redirectUrl);
  const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '');
  const queryParams = parsed.searchParams;

  const error = hashParams.get('error') ?? queryParams.get('error');
  if (error) {
    if (error === 'access_denied') {
      throw new GoogleDriveError('你已取消 Google 账号授权。', 'AUTH_REQUIRED');
    }
    const desc = hashParams.get('error_description') ?? queryParams.get('error_description');
    throw new GoogleDriveError(desc || `Google 授权失败：${error}`, 'AUTH_REQUIRED');
  }

  const returnedState = hashParams.get('state');
  if (!returnedState || returnedState !== expectedState) {
    throw new GoogleDriveError('OAuth 安全校验（state）不匹配，请重新授权。', 'AUTH_REQUIRED');
  }

  const accessToken = hashParams.get('access_token');
  if (!accessToken) {
    throw new GoogleDriveError('未能从授权响应中获取访问令牌。', 'AUTH_REQUIRED');
  }

  const rawExpires = Number(hashParams.get('expires_in') ?? '3600');
  const expiresInSeconds = Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : 3600;

  return { accessToken, expiresInSeconds };
}

export function buildMultipartRelatedBody(
  metadata: Record<string, unknown>,
  contentJson: string,
  boundary = `autosynctab_${createOAuthState()}`
): { contentType: string; body: string } {
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    contentJson,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body,
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } | string };
    if (typeof data?.error === 'string') return data.error;
    if (data?.error?.message) return data.error.message;
  } catch {
    // Fallback to HTTP status text below
  }
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

function throwForDriveFailure(response: Response, detail: string): never {
  if (response.status === 401) {
    throw new GoogleDriveError('Google 授权已过期或失效，请重新授权连接。', 'AUTH_REQUIRED', 401);
  }
  if (response.status === 404) {
    throw new GoogleDriveError('云端备份文件不存在。', 'NO_BACKUP', 404);
  }
  throw new GoogleDriveError(`Google Drive 请求失败：${detail}`, 'DRIVE_ERROR', response.status);
}

export async function fetchGoogleUserEmail(
  accessToken: string,
  fetchFn: FetchLike = fetch
): Promise<string | null> {
  const response = await fetchFn('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    throw new GoogleDriveError('Google 授权无效，请重新连接。', 'AUTH_REQUIRED', 401);
  }
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { email?: unknown };
  return typeof data.email === 'string' ? data.email : null;
}

export interface DriveFileMeta {
  id: string;
  modifiedTime: string | null;
}

export async function findDriveBackupFile(
  accessToken: string,
  fileName = GOOGLE_DRIVE_BACKUP_FILENAME,
  fetchFn: FetchLike = fetch
): Promise<DriveFileMeta | null> {
  const q = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    '&spaces=appDataFolder&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc';

  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throwForDriveFailure(response, await readErrorMessage(response));
  }

  const payload = (await response.json()) as {
    files?: Array<{ id?: string; modifiedTime?: string }>;
  };
  const first = payload.files?.[0];
  if (!first?.id) return null;

  return {
    id: first.id,
    modifiedTime: first.modifiedTime ?? null,
  };
}

export async function getDriveFileMetadata(
  accessToken: string,
  fileId: string,
  fetchFn: FetchLike = fetch
): Promise<DriveFileMeta | null> {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    '?fields=id,modifiedTime,trashed';

  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throwForDriveFailure(response, await readErrorMessage(response));
  }

  const payload = (await response.json()) as {
    id?: string;
    modifiedTime?: string;
    trashed?: boolean;
  };
  if (!payload?.id || payload.trashed) {
    return null;
  }

  return {
    id: payload.id,
    modifiedTime: payload.modifiedTime ?? null,
  };
}

export async function uploadDriveBackupFile(
  accessToken: string,
  contentJson: string,
  existingFileId: string | null,
  fileName = GOOGLE_DRIVE_BACKUP_FILENAME,
  fetchFn: FetchLike = fetch
): Promise<DriveFileMeta> {
  if (existingFileId) {
    const patchUrl =
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}` +
      '?uploadType=media&fields=id,name,modifiedTime';

    const patchRes = await fetchFn(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: contentJson,
    });

    if (patchRes.ok) {
      const updated = (await patchRes.json()) as { id: string; modifiedTime?: string };
      return {
        id: updated.id,
        modifiedTime: updated.modifiedTime ?? null,
      };
    }

    if (patchRes.status !== 404) {
      throwForDriveFailure(patchRes, await readErrorMessage(patchRes));
    }
    // File was deleted remotely; fall through to create a fresh file in appDataFolder.
  }

  const { contentType, body } = buildMultipartRelatedBody(
    {
      name: fileName,
      mimeType: 'application/json',
      parents: ['appDataFolder'],
    },
    contentJson
  );

  const createRes = await fetchFn(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType,
      },
      body,
    }
  );

  if (!createRes.ok) {
    throwForDriveFailure(createRes, await readErrorMessage(createRes));
  }

  const created = (await createRes.json()) as { id: string; modifiedTime?: string };
  return {
    id: created.id,
    modifiedTime: created.modifiedTime ?? null,
  };
}

export async function downloadDriveBackupFile(
  accessToken: string,
  fileId: string,
  fetchFn: FetchLike = fetch
): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throwForDriveFailure(response, await readErrorMessage(response));
  }

  return response.text();
}

export async function revokeGoogleToken(
  accessToken: string,
  fetchFn: FetchLike = fetch
): Promise<void> {
  try {
    await fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
    });
  } catch {
    // Best-effort revocation; local logout proceeds regardless.
  }
}
