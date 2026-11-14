import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST_DIR = resolve(ROOT, 'dist');
const OUTPUT_DIR = resolve(ROOT, 'docs/store-screenshots');

mkdirSync(OUTPUT_DIR, { recursive: true });

async function run() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'autosynctab-shot-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
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
    const managerUrl = `chrome-extension://${extensionId}/manager.html`;
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;

    const mockStore = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      groups: [
        {
          id: 'group-1',
          title: '前端与现代架构探索',
          createdAt: Date.now() - 3600000 * 2,
          updatedAt: Date.now() - 3600000 * 2,
          locked: false,
          tabs: [
            { id: 'tab-1-1', title: 'React 19 官方核心新特性与 Server Actions 全面解析', url: 'https://react.dev/blog/2024/04/25/react-19' },
            { id: 'tab-1-2', title: 'Vite 6 极速打包构建与开发服务器架构实践', url: 'https://vite.dev/guide/' },
            { id: 'tab-1-3', title: 'TypeScript 5.x 性能优化与生产级类型体操全解', url: 'https://www.typescriptlang.org/docs/' },
            { id: 'tab-1-4', title: 'Tailwind CSS 现代化企业级响应式布局系统范式', url: 'https://tailwindcss.com/docs' }
          ]
        },
        {
          id: 'group-2',
          title: 'AI 大模型与边缘计算实践',
          createdAt: Date.now() - 3600000 * 24,
          updatedAt: Date.now() - 3600000 * 24,
          locked: true,
          tabs: [
            { id: 'tab-2-1', title: 'Google DeepMind - Gemini API 开发者指南与实战', url: 'https://ai.google.dev/gemini-api/docs' },
            { id: 'tab-2-2', title: 'Cloudflare Workers AI 全球分布式边缘智能推理', url: 'https://developers.cloudflare.com/workers-ai/' },
            { id: 'tab-2-3', title: 'Hugging Face - 开源模型排行与多模态微调实践', url: 'https://huggingface.co/models' }
          ]
        },
        {
          id: 'group-3',
          title: '优质设计资源与素材灵感',
          createdAt: Date.now() - 3600000 * 48,
          updatedAt: Date.now() - 3600000 * 48,
          locked: false,
          tabs: [
            { id: 'tab-3-1', title: 'Lucide Icons - 极简开源图标与设计规范', url: 'https://lucide.dev/icons/' },
            { id: 'tab-3-2', title: 'Dribbble - 顶级 UI/UX 设计师灵感与案例精选', url: 'https://dribbble.com/shots' },
            { id: 'tab-3-3', title: 'Mobbin - 600,000+ 真实产品界面设计与流程参考', url: 'https://mobbin.com/' }
          ]
        }
      ],
      deletedGroups: [],
      settings: {
        ignorePinnedTabs: true,
        removeOnRestore: false,
        openManagerAfterStash: true,
        deduplicateOnStash: true,
        autoSync: true,
        autoCaptureBookmarks: false,
        theme: 'light'
      },
      sync: {
        provider: 'google-drive',
        enabled: true,
        lastSyncedAt: Date.now() - 1000 * 60 * 5,
        lastSyncedHash: 'mock-hash-1234',
        remoteFileId: 'drive-mock-file-id',
        remoteModifiedTime: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        accountEmail: 'developer@gmail.com'
      }
    };

    // 1. 管理页 - 浅色模式
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(managerUrl, { waitUntil: 'networkidle' });

    await page.evaluate((store) => {
      return chrome.storage.local.set({ autosynctab_store_v1: store });
    }, mockStore);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const shot1 = resolve(OUTPUT_DIR, 'screenshot-1-manager-light.jpg');
    await page.screenshot({ path: shot1, type: 'jpeg', quality: 95 });
    console.log('Saved:', shot1);

    // 2. 管理页 - 深色模式
    mockStore.settings.theme = 'dark';
    await page.evaluate((store) => {
      return chrome.storage.local.set({ autosynctab_store_v1: store });
    }, mockStore);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const shot2 = resolve(OUTPUT_DIR, 'screenshot-2-manager-dark.jpg');
    await page.screenshot({ path: shot2, type: 'jpeg', quality: 95 });
    console.log('Saved:', shot2);

    // 3. 管理页 - 设置与云同步弹窗
    const settingsButton = page.locator('button[title*="设置"], button:has-text("设置")').first();
    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await page.waitForTimeout(300);
      const shot3 = resolve(OUTPUT_DIR, 'screenshot-3-settings-sync.jpg');
      await page.screenshot({ path: shot3, type: 'jpeg', quality: 95 });
      console.log('Saved:', shot3);
    }

    // 4. Popup 页面（真实加载与渲染）
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 1280, height: 800 });
    await popupPage.goto(popupUrl, { waitUntil: 'networkidle' });
    await popupPage.waitForTimeout(600);

    await popupPage.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        html, body {
          width: 1280px !important;
          height: 800px !important;
          margin: 0 !important;
          padding: 0 !important;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          overflow: hidden !important;
        }
        #stage-container {
          display: flex;
          align-items: center;
          gap: 60px;
          max-width: 1100px;
          width: 100%;
          padding: 0 40px;
          box-sizing: border-box;
        }
        #feature-intro {
          flex: 1;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #feature-intro h2 {
          font-size: 38px;
          font-weight: 800;
          margin: 0 0 16px 0;
          background: linear-gradient(135deg, #60a5fa, #38bdf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        #feature-intro p {
          font-size: 16px;
          color: #94a3b8;
          line-height: 1.6;
          margin: 0 0 28px 0;
        }
        #feature-intro ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        #feature-intro li {
          font-size: 15px;
          color: #cbd5e1;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #feature-intro .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(56, 189, 248, 0.2);
          color: #38bdf8;
          font-weight: bold;
          font-size: 13px;
        }
        .popup-root {
          width: 360px !important;
          border-radius: 14px !important;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.15) !important;
          overflow: hidden !important;
        }
      `;
      document.head.appendChild(style);

      const root = document.getElementById('root');
      if (root) {
        const stage = document.createElement('div');
        stage.id = 'stage-container';

        const intro = document.createElement('div');
        intro.id = 'feature-intro';
        intro.innerHTML = `
          <h2>一键收纳 · 随时恢复</h2>
          <p>点击扩展图标或使用全局快捷键，秒级收纳当前窗口标签页，释放高达 95% 内存占用，保持工作流专注有序。</p>
          <ul>
            <li><span class="badge">✓</span> <strong>一键收纳全部</strong> (Alt+Shift+A)</li>
            <li><span class="badge">✓</span> <strong>仅收纳当前标签页</strong> (Alt+Shift+C)</li>
            <li><span class="badge">✓</span> <strong>快捷打开管理页</strong> (Alt+Shift+M)</li>
            <li><span class="badge">✓</span> <strong>Google Drive 跨端自动同步与历史快照保护</strong></li>
          </ul>
        `;

        root.parentNode.insertBefore(stage, root);
        stage.appendChild(intro);
        stage.appendChild(root);
      }
    });

    await popupPage.waitForTimeout(500);
    const shot4 = resolve(OUTPUT_DIR, 'screenshot-4-popup.jpg');
    await popupPage.screenshot({ path: shot4, type: 'jpeg', quality: 95 });
    console.log('Saved:', shot4);

    // 5. 小型宣传图块 (Small Promo Tile - 440x280 JPEG)
    const promoSmallPage = await context.newPage();
    await promoSmallPage.setViewportSize({ width: 440, height: 280 });
    await promoSmallPage.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0;
            width: 440px;
            height: 280px;
            background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: white;
            box-sizing: border-box;
            padding: 24px;
            text-align: center;
          }
          .icon-box {
            width: 68px;
            height: 68px;
            background: linear-gradient(135deg, #3b82f6, #0284c7);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2);
            margin-bottom: 14px;
          }
          .icon-svg {
            width: 38px;
            height: 38px;
            fill: none;
            stroke: #ffffff;
            stroke-width: 2.2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .title {
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #ffffff, #e2e8f0);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .subtitle {
            font-size: 13px;
            color: #94a3b8;
            max-width: 340px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="icon-box">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
        </div>
        <div class="title">autoSyncTab</div>
        <div class="subtitle">轻量标签页收纳 · Google Drive 云端安全同步</div>
      </body>
      </html>
    `);
    await promoSmallPage.waitForTimeout(300);
    const shot5 = resolve(OUTPUT_DIR, 'promo-tile-small-440x280.jpg');
    await promoSmallPage.screenshot({ path: shot5, type: 'jpeg', quality: 95 });
    console.log('Saved:', shot5);

    // 6. 顶部宣传图块 (Marquee Promo Tile - 1400x560 JPEG)
    const promoMarqueePage = await context.newPage();
    await promoMarqueePage.setViewportSize({ width: 1400, height: 560 });
    await promoMarqueePage.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0;
            width: 1400px;
            height: 560px;
            background: linear-gradient(135deg, #0b132b 0%, #1c2541 50%, #0b132b 100%);
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: white;
            box-sizing: border-box;
            padding: 0 100px;
          }
          .left {
            max-width: 650px;
          }
          .brand {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            padding: 6px 16px;
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid rgba(56, 189, 248, 0.3);
            border-radius: 9999px;
            color: #38bdf8;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
          }
          .title {
            font-size: 52px;
            font-weight: 900;
            letter-spacing: -1px;
            line-height: 1.15;
            margin-bottom: 16px;
            background: linear-gradient(135deg, #ffffff 0%, #93c5fd 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .subtitle {
            font-size: 18px;
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 28px;
          }
          .features {
            display: flex;
            gap: 24px;
          }
          .feature-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: #cbd5e1;
          }
          .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #38bdf8;
          }
          .right {
            position: relative;
          }
          .card {
            width: 420px;
            padding: 28px;
            background: rgba(30, 41, 59, 0.85);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 20px;
            box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.6);
          }
          .card-header {
            font-size: 17px;
            font-weight: 700;
            color: #f8fafc;
            margin-bottom: 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .card-badge {
            font-size: 12px;
            padding: 4px 10px;
            background: #2563eb;
            color: #fff;
            border-radius: 6px;
          }
          .item {
            padding: 12px 14px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            font-size: 14px;
            color: #e2e8f0;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
        </style>
      </head>
      <body>
        <div class="left">
          <div class="brand">✦ Chrome 标签页管理神器</div>
          <div class="title">一键收纳恢复<br>释放 95% 浏览器内存</div>
          <div class="subtitle">告别标签页繁杂凌乱，支持分组重命名、加锁保护、实时搜索与 Google Drive 跨设备自动同步。</div>
          <div class="features">
            <div class="feature-badge"><span class="dot"></span> 全局快捷键</div>
            <div class="feature-badge"><span class="dot"></span> 深浅双色主题</div>
            <div class="feature-badge"><span class="dot"></span> 隐私安全无追踪</div>
          </div>
        </div>
        <div class="right">
          <div class="card">
            <div class="card-header">
              <span>已收纳标签页分组</span>
              <span class="card-badge">4 个标签</span>
            </div>
            <div class="item">
              <span>React 19 核心新特性解读</span>
              <span style="color:#64748b;font-size:12px;">已锁定</span>
            </div>
            <div class="item">
              <span>Vite 6 现代化极速构建指南</span>
              <span style="color:#38bdf8;font-size:12px;">已同步</span>
            </div>
            <div class="item">
              <span>Cloudflare Workers 全球边缘计算</span>
              <span style="color:#38bdf8;font-size:12px;">已同步</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
    await promoMarqueePage.waitForTimeout(300);
    const shot6 = resolve(OUTPUT_DIR, 'promo-tile-marquee-1400x560.jpg');
    await promoMarqueePage.screenshot({ path: shot6, type: 'jpeg', quality: 95 });
    console.log('Saved:', shot6);

  } finally {
    await context.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
