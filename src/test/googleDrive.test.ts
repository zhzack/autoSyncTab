import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportToJson } from '../shared/formatters';
import {
  buildGoogleAuthUrl,
  buildMultipartRelatedBody,
  GoogleDriveError,
  isValidGoogleClientId,
  parseAuthRedirectUrl,
} from '../shared/googleDriveClient';
import {
  createDefaultStore,
  loadAuthState,
  loadStore,
  mergeRemoteGroups,
  prependGroup,
  saveStore,
} from '../shared/storage';
import { GoogleDriveSyncAdapter } from '../shared/syncAdapter';
import { chromeMockControls } from './setup';

const TEST_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';
const REDIRECT_URI = 'https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('googleDriveClient & GoogleDriveSyncAdapter', () => {
  beforeEach(() => {
    chromeMockControls.reset();
  });

  it('validates client IDs, builds OAuth URLs, and verifies state on callback', () => {
    expect(isValidGoogleClientId(TEST_CLIENT_ID)).toBe(true);
    expect(isValidGoogleClientId('invalid-id')).toBe(false);

    const authUrl = new URL(buildGoogleAuthUrl(TEST_CLIENT_ID, REDIRECT_URI, 'state_123'));
    expect(authUrl.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(authUrl.searchParams.get('response_type')).toBe('token');
    expect(authUrl.searchParams.get('prompt')).toBe('select_account');
    expect(authUrl.searchParams.get('state')).toBe('state_123');

    const parsed = parseAuthRedirectUrl(
      `${REDIRECT_URI}#access_token=tok_abc&expires_in=3600&state=state_123`,
      'state_123'
    );
    expect(parsed).toEqual({ accessToken: 'tok_abc', expiresInSeconds: 3600 });

    expect(() =>
      parseAuthRedirectUrl(
        `${REDIRECT_URI}#access_token=tok_abc&state=wrong_state`,
        'state_123'
      )
    ).toThrow(GoogleDriveError);

    expect(() =>
      parseAuthRedirectUrl(`${REDIRECT_URI}?error=access_denied`, 'state_123')
    ).toThrow('你已取消 Google 账号授权。');
  });

  it('builds RFC 2387 multipart/related bodies for Drive appDataFolder', () => {
    const { contentType, body } = buildMultipartRelatedBody(
      { name: 'autosynctab-backup.json', parents: ['appDataFolder'] },
      '{"groups":[]}',
      'test_boundary'
    );

    expect(contentType).toBe('multipart/related; boundary=test_boundary');
    expect(body).toContain('--test_boundary\r\nContent-Type: application/json; charset=UTF-8');
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('{"groups":[]}');
    expect(body).toContain('--test_boundary--\r\n');
  });

  it('merges local and remote groups without losing distinct groups', () => {
    const merged = mergeRemoteGroups(
      [
        {
          id: 'g_shared',
          title: '本地旧版本',
          createdAt: 100,
          updatedAt: 100,
          locked: false,
          tabs: [{ id: 't1', url: 'https://a.com', title: 'A' }],
        },
        {
          id: 'g_local_only',
          title: '仅本地',
          createdAt: 300,
          updatedAt: 300,
          locked: false,
          tabs: [{ id: 't2', url: 'https://local.com', title: 'Local' }],
        },
      ],
      [
        {
          id: 'g_shared',
          title: '云端较新版本',
          createdAt: 100,
          updatedAt: 250,
          locked: true,
          tabs: [{ id: 't1', url: 'https://a.com', title: 'A' }],
        },
        {
          id: 'g_remote_only',
          title: '另一台电脑',
          createdAt: 200,
          updatedAt: 200,
          locked: false,
          tabs: [{ id: 't3', url: 'https://remote.com', title: 'Remote' }],
        },
      ]
    );

    expect(merged.map((g) => g.id)).toEqual(['g_local_only', 'g_remote_only', 'g_shared']);
    expect(merged[2].title).toBe('云端较新版本');
    expect(merged[2].locked).toBe(true);
  });

  it('connects, backs up to appDataFolder, updates existing file, restores, and disconnects', async () => {
    // Seed local store with 1 group
    const base = createDefaultStore(1000);
    const { nextStore } = prependGroup(
      base,
      [{ id: 't1', url: 'https://github.com', title: 'GitHub' }],
      '工作常用',
      1000
    );
    await saveStore(nextStore);

    let remoteFileContent = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return jsonResponse({ email: 'dev@gmail.com' });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
        return jsonResponse({
          files: remoteFileContent ? [{ id: 'file_001', modifiedTime: '2026-11-11T00:00:00Z' }] : [],
        });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
        const rawBody = String(init?.body ?? '');
        const parts = rawBody.split('\r\n\r\n');
        remoteFileContent = parts[2].split('\r\n--')[0];
        return jsonResponse({ id: 'file_001', name: 'autosynctab-backup.json' });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files/file_001?uploadType=media')) {
        expect(method).toBe('PATCH');
        remoteFileContent = String(init?.body ?? '');
        return jsonResponse({ id: 'file_001', name: 'autosynctab-backup.json' });
      }
      if (url === 'https://www.googleapis.com/drive/v3/files/file_001?alt=media') {
        return new Response(remoteFileContent, { status: 200 });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
        return jsonResponse({});
      }
      return jsonResponse({ error: { message: `Unhandled ${method} ${url}` } }, 500);
    });

    chromeMockControls.launchAuthHandler = (authUrl) => {
      const state = new URL(authUrl).searchParams.get('state');
      return {
        redirectUrl: `${REDIRECT_URI}#access_token=ya29_mock_token&expires_in=3600&state=${state}`,
      };
    };

    const adapter = new GoogleDriveSyncAdapter(fetchMock as typeof fetch);

    // 1. Connect
    const status = await adapter.connect(TEST_CLIENT_ID);
    expect(status.hasValidToken).toBe(true);
    expect(status.sync.enabled).toBe(true);
    expect(status.sync.accountEmail).toBe('dev@gmail.com');

    // Verify accessToken stays out of exported JSON backup
    const currentStore = await loadStore();
    expect(exportToJson(currentStore)).not.toContain('ya29_mock_token');
    expect((await loadAuthState()).accessToken).toBe('ya29_mock_token');

    // 2. First backup (creates multipart file)
    const backup1 = await adapter.backup();
    expect(backup1.fileId).toBe('file_001');
    expect(backup1.groupCount).toBe(1);
    expect(remoteFileContent).toContain('https://github.com');

    // 3. Second backup (updates existing fileId via PATCH)
    const backup2 = await adapter.backup();
    expect(backup2.fileId).toBe('file_001');

    // 4. Simulate remote having an extra group and restore in merge mode
    const parsedRemote = JSON.parse(remoteFileContent) as typeof currentStore;
    parsedRemote.groups.push({
      id: 'grp_remote_extra',
      title: '云端新增',
      createdAt: 500,
      updatedAt: 500,
      locked: false,
      tabs: [{ id: 't_r', url: 'https://react.dev', title: 'React' }],
    });
    remoteFileContent = JSON.stringify(parsedRemote);

    const restored = await adapter.restore('merge');
    expect(restored.restoredGroupCount).toBe(2);
    expect(restored.totalGroupCount).toBe(2);

    // 5. Disconnect clears token while keeping local groups
    const afterDisconnect = await adapter.disconnect();
    expect(afterDisconnect.hasValidToken).toBe(false);
    expect(afterDisconnect.sync.enabled).toBe(false);
    expect((await loadStore()).groups).toHaveLength(2);
  });

  it('clears expired token and surfaces AUTH_REQUIRED on 401 from Drive', async () => {
    const adapter = new GoogleDriveSyncAdapter(
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid Credentials' } }, 401)) as typeof fetch
    );

    chromeMockControls.launchAuthHandler = (authUrl) => {
      const state = new URL(authUrl).searchParams.get('state');
      return {
        redirectUrl: `${REDIRECT_URI}#access_token=expired_tok&expires_in=3600&state=${state}`,
      };
    };

    // Mock userinfo failing with 401 right away OR connect succeeding then backup returning 401
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ email: 'dev@gmail.com' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid Credentials' } }, 401));

    const adapter2 = new GoogleDriveSyncAdapter(fetchMock as typeof fetch);
    await adapter2.connect(TEST_CLIENT_ID);
    await expect(adapter2.backup()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect((await loadAuthState()).accessToken).toBeNull();
    void adapter;
  });

  it('translates concurrent web auth flow error into clear Chinese guidance', async () => {
    chromeMockControls.launchAuthHandler = () => ({
      error: 'Only one web auth flow is allowed at a time.',
    });
    const adapter = new GoogleDriveSyncAdapter(vi.fn() as typeof fetch);
    await expect(adapter.connect(TEST_CLIENT_ID)).rejects.toThrow(
      '已有打开的 Google 授权窗口尚未关闭'
    );
  });
});
