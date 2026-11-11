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

export function normalizeOAuthProxyUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

export function isValidOAuthProxyUrl(rawUrl: string): boolean {
  const normalized = normalizeOAuthProxyUrl(rawUrl);
  if (!normalized) return true;
  try {
    const parsed = new URL(normalized);
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const codeVerifier = toBase64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = toBase64Url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
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

export function buildGooglePkceAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId.trim());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
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

export function parseAuthCodeRedirectUrl(redirectUrl: string, expectedState: string): string {
  const parsed = new URL(redirectUrl);
  const queryParams = parsed.searchParams;
  const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '');

  const error = queryParams.get('error') ?? hashParams.get('error');
  if (error) {
    if (error === 'access_denied') {
      throw new GoogleDriveError('你已取消 Google 账号授权。', 'AUTH_REQUIRED');
    }
    const desc = queryParams.get('error_description') ?? hashParams.get('error_description');
    throw new GoogleDriveError(desc || `Google 授权失败：${error}`, 'AUTH_REQUIRED');
  }

  const returnedState = queryParams.get('state') ?? hashParams.get('state');
  if (!returnedState || returnedState !== expectedState) {
    throw new GoogleDriveError('OAuth 安全校验（state）不匹配，请重新授权。', 'AUTH_REQUIRED');
  }

  const code = queryParams.get('code') ?? hashParams.get('code');
  if (!code) {
    throw new GoogleDriveError('未能从 Google 授权回调中获取授权码。', 'AUTH_REQUIRED');
  }

  return code;
}

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}

async function postOAuthProxy(
  endpointUrl: string,
  payload: Record<string, string>,
  fetchFn: FetchLike
): Promise<OAuthTokenBundle> {
  const response = await fetchFn(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    const errorCode = data.error ?? '';
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    if (errorCode === 'invalid_grant' || errorCode === 'unauthorized_client' || response.status === 401) {
      throw new GoogleDriveError(
        'Google 长期授权已失效或已被撤销，请重新登录 Google 账号。',
        'AUTH_REQUIRED',
        response.status
      );
    }
    throw new GoogleDriveError(`OAuth 令牌服务请求失败：${detail}`, 'DRIVE_ERROR', response.status);
  }

  const expiresInSeconds =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    expiresInSeconds,
  };
}

export async function exchangeAuthCodeViaProxy(
  proxyUrl: string,
  payload: { code: string; codeVerifier: string; redirectUri: string },
  fetchFn: FetchLike = fetch
): Promise<OAuthTokenBundle> {
  const baseUrl = normalizeOAuthProxyUrl(proxyUrl);
  return postOAuthProxy(
    `${baseUrl}/exchange`,
    {
      code: payload.code,
      code_verifier: payload.codeVerifier,
      redirect_uri: payload.redirectUri,
    },
    fetchFn
  );
}

export async function refreshAccessTokenViaProxy(
  proxyUrl: string,
  refreshToken: string,
  fetchFn: FetchLike = fetch
): Promise<OAuthTokenBundle> {
  const baseUrl = normalizeOAuthProxyUrl(proxyUrl);
  return postOAuthProxy(
    `${baseUrl}/refresh`,
    { refresh_token: refreshToken },
    fetchFn
  );
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
