import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManagerApp } from '../manager/ManagerApp';
import {
  createDefaultStore,
  loadStore,
  prependGroup,
  saveAuthState,
  saveStore,
  updateSyncInStore,
} from '../shared/storage';
import { saveSyncRuntimeState } from '../shared/syncState';
import { chromeMockControls } from './setup';

describe('ManagerApp', () => {
  beforeEach(async () => {
    chromeMockControls.reset();
    document.documentElement.dataset.theme = 'light';
    let store = createDefaultStore(1000);
    store = prependGroup(
      store,
      [
        { id: 't1', url: 'https://react.dev', title: 'React Docs' },
        { id: 't2', url: 'https://typescriptlang.org', title: 'TypeScript' },
      ],
      '前端文档',
      1000
    ).nextStore;
    await saveStore(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders groups, filters via search, renames group, locks group, and restores tabs', async () => {
    render(<ManagerApp />);

    expect(await screen.findByText('前端文档')).toBeInTheDocument();
    expect(screen.getByText('React Docs')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    // Search filters out non-matching tabs when searching URL/title
    const searchInput = screen.getByLabelText('搜索已收纳标签页');
    fireEvent.change(searchInput, { target: { value: 'react' } });
    expect(screen.getByText('React Docs')).toBeInTheDocument();
    expect(screen.queryByText('TypeScript')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    // Rename group
    fireEvent.click(screen.getByRole('button', { name: '重命名分组' }));
    const titleInput = screen.getByLabelText('编辑分组名称');
    fireEvent.change(titleInput, { target: { value: '核心技术栈' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });
    expect(await screen.findByText('核心技术栈')).toBeInTheDocument();

    // Lock group protects delete button
    fireEvent.click(screen.getByRole('button', { name: '锁定分组' }));
    const deleteGroupBtn = await screen.findByRole('button', { name: '删除分组' });
    expect(deleteGroupBtn).toBeDisabled();

    // Unlock and restore a single tab (removes it when removeOnRestore=true)
    fireEvent.click(screen.getByRole('button', { name: '解锁分组' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除分组' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText('React Docs'));
    await waitFor(() => {
      expect(chromeMockControls.createdTabs).toHaveLength(1);
      expect(chromeMockControls.createdTabs[0].url).toBe('https://react.dev');
      expect(screen.queryByText('React Docs')).not.toBeInTheDocument();
    });
  });

  it('opens Google Drive sync modal, logs in via launchWebAuthFlow, and triggers backup', async () => {
    const redirectUri = 'https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/';
    chromeMockControls.launchAuthHandler = (authUrl) => {
      const state = new URL(authUrl).searchParams.get('state');
      return {
        redirectUrl: `${redirectUri}?code=ui_pkce_code&state=${state}`,
      };
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/exchange')) {
        return new Response(
          JSON.stringify({
            access_token: 'ya29_ui_test',
            refresh_token: '1//ui_refresh_tok',
            expires_in: 3600,
          }),
          { status: 200 }
        );
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return new Response(JSON.stringify({ email: 'tester@gmail.com' }), { status: 200 });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
        return new Response(JSON.stringify({ id: 'file_1', name: 'autosynctab-backup.json' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Unexpected URL' } }), { status: 500 });
    });

    render(<ManagerApp />);
    await screen.findByText('前端文档');

    fireEvent.click(screen.getByRole('button', { name: /Google Drive 云同步/ }));
    const loginBtn = await screen.findByRole('button', { name: /登录 Google 账号/ });
    expect(loginBtn).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /展开配置/ }));
    expect(await screen.findByDisplayValue(redirectUri)).toBeInTheDocument();

    fireEvent.click(loginBtn);
    expect(await screen.findByText('已连接：tester@gmail.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /立即备份到云端/ }));
    expect(await screen.findByText(/备份成功！已上传 1 个分组/)).toBeInTheDocument();
  });

  it('cycles theme mode (system -> light -> dark) and handles keyboard shortcuts', async () => {
    render(<ManagerApp />);
    await screen.findByText('前端文档');

    const themeBtn = screen.getByRole('button', { name: /切换主题模式/ });
    fireEvent.click(themeBtn); // system -> light
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    fireEvent.click(screen.getByRole('button', { name: /切换主题模式/ })); // light -> dark
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect((await loadStore()).settings.theme).toBe('dark');

    // Keyboard shortcut '/' focuses search input and 'Escape' clears it
    const searchInput = screen.getByLabelText('搜索已收纳标签页');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.change(searchInput, { target: { value: 'React' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(searchInput).toHaveValue('');
  });

  it('supports drag-and-drop group reordering and cross-group tab moving', async () => {
    let store = await loadStore();
    store = prependGroup(
      store,
      [{ id: 't3', url: 'https://vite.dev', title: 'Vite Docs' }],
      '构建工具',
      2000
    ).nextStore;
    await saveStore(store);

    render(<ManagerApp />);
    await screen.findByText('构建工具');
    await screen.findByText('前端文档');

    // Drag group '前端文档' onto '构建工具' card to reorder
    const frontendDragHandle = screen.getByRole('button', { name: /拖拽调整分组 前端文档 顺序/ });
    const targetCard = document.querySelector('[data-group-id="' + store.groups[0].id + '"]')!;
    fireEvent.dragStart(frontendDragHandle);
    fireEvent.dragOver(targetCard);
    fireEvent.drop(targetCard);

    await waitFor(async () => {
      const updated = await loadStore();
      expect(updated.groups.map((g) => g.title)).toEqual(['前端文档', '构建工具']);
    });

    // Drag 'React Docs' row from '前端文档' onto '构建工具' card
    const reactRow = screen.getByText('React Docs').closest('li')!;
    const buildCard = document.querySelector('[data-group-id="' + store.groups[0].id + '"]')!;
    fireEvent.dragStart(reactRow);
    fireEvent.dragOver(buildCard);
    fireEvent.drop(buildCard);

    await waitFor(async () => {
      const updated = await loadStore();
      const buildGroup = updated.groups.find((g) => g.title === '构建工具')!;
      expect(buildGroup.tabs.map((t) => t.title)).toEqual(['Vite Docs', 'React Docs']);
    });
  });

  it('displays conflict banner, resolves conflict in Drive modal, and manages snapshots', async () => {
    const store = await loadStore();
    const localGroup = store.groups[0];
    const enabledStore = updateSyncInStore(store, {
      enabled: true,
      accountEmail: 'tester@gmail.com',
      remoteFileId: 'file_1',
      lastSyncedAt: 500,
    });
    await saveStore(enabledStore);
    await saveAuthState({
      clientId: '1234567890-abcdefg.apps.googleusercontent.com',
      accessToken: 'tok_valid',
      tokenExpiresAt: Date.now() + 3_600_000,
      accountEmail: 'tester@gmail.com',
    });

    const remoteBackup = {
      ...enabledStore,
      groups: [
        {
          ...localGroup,
          title: '远端更新标题',
          updatedAt: 1500,
          tabs: [{ id: 't_rem', url: 'https://vitest.dev', title: 'Vitest Docs' }],
        },
      ],
    };

    await saveSyncRuntimeState({
      status: 'conflict',
      pendingLocalChanges: true,
      lastCheckedAt: 1600,
      lastError: null,
      conflict: {
        detectedAt: 1600,
        fileId: 'file_1',
        remoteModifiedTime: '2026-11-11T00:00:00Z',
        items: [
          {
            groupId: localGroup.id,
            reason: 'both-modified',
            localGroup,
            remoteGroup: remoteBackup.groups[0],
          },
        ],
        remoteBackup,
      },
    });

    render(<ManagerApp />);
    expect(await screen.findByText(/检测到 1 处多端同步冲突/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '立即处理冲突' }));
    expect(await screen.findByText('检测到 1 处同步冲突')).toBeInTheDocument();

    // Switch to Snapshots tab and create manual snapshot
    fireEvent.click(screen.getByRole('button', { name: /历史快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '创建当前快照' }));
    expect(await screen.findByText(/共 1 个分组 · 2 个标签页/)).toBeInTheDocument();

    // Switch back to sync tab and resolve conflict using remote
    fireEvent.click(screen.getByRole('button', { name: '云端同步' }));
    fireEvent.click(screen.getByRole('button', { name: '以云端为准覆盖本地' }));
    expect(await screen.findByText(/已使用云端版本覆盖本地记录/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    expect(await screen.findByText('远端更新标题')).toBeInTheDocument();
  });

  it('switches to Bookmarks tab, auto-captures browser bookmarks, creates/edits/deletes items, and converts folder to tab group', async () => {
    chromeMockControls.bookmarkTree = [
      {
        id: '0',
        title: '',
        syncing: false,
        children: [
          {
            id: '1',
            parentId: '0',
            title: '书签栏',
            syncing: false,
            children: [
              {
                id: 'b_1',
                parentId: '1',
                title: 'MDN Docs',
                url: 'https://developer.mozilla.org',
                syncing: false,
              },
              {
                id: 'f_dev',
                parentId: '1',
                title: '开发工具',
                syncing: false,
                children: [
                  {
                    id: 'b_2',
                    parentId: 'f_dev',
                    title: 'Playwright',
                    url: 'https://playwright.dev',
                    syncing: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    render(<ManagerApp />);
    await screen.findByText('前端文档');

    // Auto-captured count shows in the Bookmarks nav tab
    const bookmarksTab = await screen.findByRole('tab', { name: /书签列表/ });
    expect(bookmarksTab).toHaveTextContent('2');

    fireEvent.click(bookmarksTab);
    expect(await screen.findByText('MDN Docs')).toBeInTheDocument();
    expect(screen.getByText('开发工具')).toBeInTheDocument();

    // Add a new bookmark inline
    fireEvent.click(screen.getByRole('button', { name: '新增书签' }));
    fireEvent.change(screen.getByLabelText('新书签标题'), { target: { value: 'GitHub' } });
    fireEvent.change(screen.getByLabelText('新书签网址'), { target: { value: 'github.com' } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
    expect(await screen.findByText('GitHub')).toBeInTheDocument();

    // Search bookmarks
    const bmSearch = screen.getByLabelText('搜索书签列表');
    fireEvent.change(bmSearch, { target: { value: 'github' } });
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('MDN Docs')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));

    // Edit bookmark title
    fireEvent.click(screen.getByRole('button', { name: '编辑 GitHub' }));
    fireEvent.change(screen.getByLabelText('编辑书签标题'), { target: { value: 'GitHub Home' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('GitHub Home')).toBeInTheDocument();

    // Convert folder '开发工具' into a stashed tab group
    const devFolderSection = screen.getByText('开发工具').closest('section')!;
    const convertBtn = devFolderSection.querySelector('button[title="将此文件夹内的书签复制为一个标签分组"]')!;
    fireEvent.click(convertBtn);
    expect(await screen.findByText(/已将「开发工具」的 1 个链接加入已收纳标签页分组/)).toBeInTheDocument();

    // Delete bookmark
    fireEvent.click(screen.getByRole('button', { name: '删除 GitHub Home' }));
    await waitFor(() => {
      expect(screen.queryByText('GitHub Home')).not.toBeInTheDocument();
    });

    // Switch back to tabs and see the converted group
    fireEvent.click(screen.getByRole('tab', { name: /已收纳标签页/ }));
    expect(await screen.findByText('开发工具')).toBeInTheDocument();
    expect(screen.getByText('Playwright')).toBeInTheDocument();
  });

  it('saves a stashed tab group directly as a named bookmark folder', async () => {
    render(<ManagerApp />);
    expect(await screen.findByText('前端文档')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '将分组 前端文档 存为书签' }));
    expect(await screen.findByText(/已将「前端文档」的 2 个链接加入书签栏/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看书签列表' }));
    expect(await screen.findByText('前端文档')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开文件夹 前端文档' }));
    expect(await screen.findByText('React Docs')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });
});
