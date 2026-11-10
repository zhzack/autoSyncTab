import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManagerApp } from '../manager/ManagerApp';
import { createDefaultStore, prependGroup, saveStore } from '../shared/storage';
import { chromeMockControls } from './setup';

describe('ManagerApp', () => {
  beforeEach(async () => {
    chromeMockControls.reset();
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
        redirectUrl: `${redirectUri}#access_token=ya29_ui_test&expires_in=3600&state=${state}`,
      };
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
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
});
