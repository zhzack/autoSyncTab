import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST_DIR = resolve(ROOT, 'dist');
const PROFILE_DIR = resolve(ROOT, '.dev-chrome-profile');
const VITE_BIN = resolve(ROOT, 'node_modules/vite/bin/vite.js');

function runInitialBuild() {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, [VITE_BIN, 'build', '--mode', 'development'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(`Vite build exited with code ${code}`));
    });
  });
}

await runInitialBuild();

if (!existsSync(PROFILE_DIR)) {
  mkdirSync(PROFILE_DIR, { recursive: true });
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: 'chromium',
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${DIST_DIR}`,
    `--load-extension=${DIST_DIR}`,
  ],
});

let serviceWorker = context.serviceWorkers()[0];
if (!serviceWorker) {
  serviceWorker = await context.waitForEvent('serviceworker');
}

const extensionId = new URL(serviceWorker.url()).host;
const managerUrl = `chrome-extension://${extensionId}/manager.html`;
const popupUrl = `chrome-extension://${extensionId}/popup.html`;

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(managerUrl);

console.log('\n[autoSyncTab] 测试浏览器已启动并自动加载扩展！');
console.log(`- 管理页: ${managerUrl}`);
console.log(`- 弹窗调试页: ${popupUrl}`);
console.log('- 正在监听源码改动，保存文件后将自动编译并重载扩展（无需手动添加）...\n');

// 启动 Vite watch，每次重新构建完成自动调用 chrome.runtime.reload()
const watcher = spawn(process.execPath, [VITE_BIN, 'build', '--watch', '--mode', 'development'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let isFirstBuild = true;
let reloading = false;
let stdoutBuffer = '';

async function reloadExtension() {
  if (reloading) return;
  reloading = true;
  try {
    const hadManagerOpen = context.pages().some((p) => p.url().startsWith(managerUrl));
    const activeWorker = context.serviceWorkers()[0] ?? serviceWorker;
    if (activeWorker) {
      const nextWorkerPromise = context
        .waitForEvent('serviceworker', { timeout: 10_000 })
        .catch(() => null);
      await activeWorker.evaluate(() => globalThis.chrome.runtime.reload()).catch(() => undefined);
      const nextWorker = await nextWorkerPromise;
      if (nextWorker) {
        serviceWorker = nextWorker;
      }
      if (hadManagerOpen) {
        const reopened = await context.newPage();
        await reopened.goto(managerUrl).catch(() => undefined);
      }
      console.log('[autoSyncTab] 检测到编译更新，扩展已自动热重载。');
    }
  } finally {
    reloading = false;
  }
}

watcher.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  stdoutBuffer += text;
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() ?? '';

  for (const line of lines) {
    if (line.includes('built in')) {
      if (isFirstBuild) {
        isFirstBuild = false;
      } else {
        void reloadExtension();
      }
    }
  }
});

watcher.stderr.on('data', (chunk) => {
  process.stderr.write(chunk.toString());
});

const cleanup = async () => {
  watcher.kill();
  await context.close().catch(() => undefined);
  process.exit(0);
};

context.on('close', () => {
  watcher.kill();
  process.exit(0);
});

process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
