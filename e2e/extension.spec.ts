import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const DIST_DIR = resolve(import.meta.dirname, '../dist');

async function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/alpha') {
      res.end('<!doctype html><html><head><title>测试页面 Alpha</title></head><body>Alpha</body></html>');
      return;
    }
    if (req.url === '/beta') {
      res.end('<!doctype html><html><head><title>测试页面 Beta</title></head><body>Beta</body></html>');
      return;
    }
    res.end('<!doctype html><html><head><title>测试首页</title></head><body>Home</body></html>');
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind local fixture server');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test('自动加载扩展并验证完整收纳、搜索、深色模式、快捷键、快照与恢复流程', async () => {
  const { server, baseUrl } = await startFixtureServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'autosynctab-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.E2E_HEADLESS !== 'false',
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    expect(extensionId).toBe('jlckgkpfpnegkcfmoioonmkjjgoggpmb');
    const managerUrl = `chrome-extension://${extensionId}/manager.html`;
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;

    // 打开两个真实网页标签页
    const pageAlpha = await context.newPage();
    await pageAlpha.goto(`${baseUrl}/alpha`, { waitUntil: 'load' });
    const pageBeta = await context.newPage();
    await pageBeta.goto(`${baseUrl}/beta`, { waitUntil: 'load' });

    // 打开插件弹窗页并验证可收纳数量
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });

    const stashAllBtn = popupPage.getByRole('button', { name: /收纳当前窗口全部标签页/ });
    await expect(stashAllBtn).toContainText('2');

    // 点击收纳全部，并等待自动打开管理页
    const managerPagePromise = context.waitForEvent('page', (p) =>
      p.url().startsWith(managerUrl)
    );
    await stashAllBtn.click();
    const managerPage = await managerPagePromise;
    await managerPage.waitForLoadState('domcontentloaded');

    // 原有两个网页标签应已自动关闭
    await expect.poll(() => pageAlpha.isClosed()).toBe(true);
    await expect.poll(() => pageBeta.isClosed()).toBe(true);

    // 验证 Manifest V3 全局快捷键已注册
    const commandNames = await managerPage.evaluate(async () => {
      const cmds = await chrome.commands.getAll();
      return cmds.map((c) => c.name);
    });
    expect(commandNames).toEqual(
      expect.arrayContaining(['_execute_action', 'stash-all-tabs', 'stash-current-tab', 'open-manager'])
    );

    // 管理页应展示刚收纳的分组和标签，并禁用浏览器自动翻译提示
    await expect(managerPage.locator('html')).toHaveAttribute('translate', 'no');
    await expect(managerPage.locator('meta[name="google"]')).toHaveAttribute(
      'content',
      'notranslate'
    );
    await expect(managerPage.getByText('测试页面 Alpha')).toBeVisible();
    await expect(managerPage.getByText('测试页面 Beta')).toBeVisible();

    // 切换深色模式并验证刷新后持久化生效
    await managerPage.getByRole('button', { name: /切换主题模式/ }).click(); // 跟随系统 -> 浅色
    await managerPage.getByRole('button', { name: /切换主题模式/ }).click(); // 浅色 -> 深色
    await expect(managerPage.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 实时搜索过滤（含页内快捷键 '/' 聚焦）
    await managerPage.keyboard.press('/');
    const searchInput = managerPage.getByLabel('搜索已收纳标签页');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('Alpha');
    await expect(managerPage.getByText('测试页面 Alpha')).toBeVisible();
    await expect(managerPage.getByText('测试页面 Beta')).toBeHidden();
    await managerPage.getByRole('button', { name: '清空搜索' }).click();
    await expect(managerPage.getByText('测试页面 Beta')).toBeVisible();

    // 打开设置面板验证自动同步选项与快捷键提示
    await managerPage.getByRole('button', { name: '设置' }).click();
    await expect(managerPage.getByText('启用 Google Drive 自动同步')).toBeVisible();
    await expect(managerPage.getByText('Alt+Shift+A')).toBeVisible();
    await managerPage.getByRole('button', { name: '设置' }).click();

    // 重命名分组并验证刷新页面后 chrome.storage.local 持久化（含深色模式）有效
    await managerPage.getByRole('button', { name: '重命名分组' }).click();
    const titleInput = managerPage.getByLabel('编辑分组名称');
    await titleInput.fill('E2E 自动化分组');
    await titleInput.press('Enter');
    await expect(managerPage.getByText('E2E 自动化分组')).toBeVisible();
    await managerPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(managerPage.getByText('E2E 自动化分组')).toBeVisible();
    await expect(managerPage.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 锁定与解锁保护
    await managerPage.getByRole('button', { name: '锁定分组' }).click();
    await expect(managerPage.getByRole('button', { name: '删除分组' })).toBeDisabled();
    await managerPage.getByRole('button', { name: '解锁分组' }).click();
    await expect(managerPage.getByRole('button', { name: '删除分组' })).toBeEnabled();

    // 验证 Google Drive 弹窗开箱即用的一键登录按钮、高级配置持久化及历史快照创建
    expect(
      await managerPage.evaluate(() => typeof chrome.identity?.launchWebAuthFlow === 'function')
    ).toBe(true);
    await managerPage.getByRole('button', { name: /Google Drive 云同步/ }).click();
    await expect(managerPage.getByRole('button', { name: /登录 Google 账号/ })).toBeEnabled();

    // 历史快照标签页创建手动快照
    await managerPage.getByRole('button', { name: /历史快照/ }).click();
    await managerPage.getByRole('button', { name: '创建当前快照' }).click();
    await expect(managerPage.getByText(/共 1 个分组 · 2 个标签页/)).toBeVisible();
    await managerPage.getByRole('button', { name: '云端同步' }).click();

    await managerPage.getByRole('button', { name: /展开配置/ }).click();
    await expect(managerPage.getByLabel('固定重定向 URI（Redirect URI）')).toHaveValue(
      `https://${extensionId}.chromiumapp.org/`
    );
    const clientIdInput = managerPage.getByLabel('Google OAuth Client ID');
    await expect(clientIdInput).toHaveValue(
      '813169183999-7h25nq6u6rcf0lhf69gmknd65ogji42p.apps.googleusercontent.com'
    );
    await clientIdInput.fill('9876543210-e2etest.apps.googleusercontent.com');
    await managerPage.getByRole('button', { name: '保存' }).click();
    await expect(managerPage.getByText(/OAuth Client ID 已保存/)).toBeVisible();
    await managerPage.getByRole('button', { name: '关闭弹窗' }).click();

    await managerPage.getByRole('button', { name: /Google Drive 云同步/ }).click();
    await managerPage.getByRole('button', { name: /展开配置/ }).click();
    await expect(managerPage.getByLabel('Google OAuth Client ID')).toHaveValue(
      '9876543210-e2etest.apps.googleusercontent.com'
    );
    await managerPage.getByRole('button', { name: '关闭弹窗' }).click();

    // 恢复整组标签页并验证重新打开
    await managerPage.getByRole('button', { name: '恢复全部' }).click();
    await expect(managerPage.getByText('还没有已收纳的标签页')).toBeVisible();

    await expect
      .poll(() =>
        context
          .pages()
          .map((p) => p.url())
          .filter((url) => url.startsWith(baseUrl))
          .sort()
      )
      .toEqual([`${baseUrl}/alpha`, `${baseUrl}/beta`]);
  } finally {
    await context.close();
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
