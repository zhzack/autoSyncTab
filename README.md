# autoSyncTab

一个基于 **React + TypeScript + Vite (Manifest V3)** 构建的轻量级浏览器标签页收纳管理扩展（类似 OneTab），已完成**阶段一（基础本地收纳管理）**、**阶段二（Google Drive 云端备份与恢复）**及**阶段三（自动防抖同步、冲突检测与快照、快捷键、深色模式、拖拽排序与商店上架准备）**。

---

## 目录结构

```text
autoSyncTab/
├── public/
│   ├── manifest.json          # Chrome 扩展 Manifest V3 配置（含快捷键与 alarms）
│   └── icons/                 # 自动生成的 16/32/48/128 PNG 图标
├── scripts/
│   ├── generate-icons.mjs     # 零依赖 Node PNG 图标生成脚本
│   ├── launch-dev-browser.mjs # 拉起独立测试浏览器并热重载
│   └── package-extension.mjs  # 打包 dist/ 为 release/*.zip（支持 --cws 商店包）
├── src/
│   ├── background/index.ts    # Service Worker：右键菜单、快捷键、后台收纳与 30s 防抖自动同步
│   ├── popup/                 # 点击扩展图标时的弹窗菜单界面（适配深色模式）
│   ├── manager/               # 独立标签页管理页面（拖拽排序、深色模式、冲突/快照弹窗）
│   ├── shared/                # 数据模型、存储、三方合并、快照、主题、Drive 客户端与同步适配器
│   └── test/                  # Vitest 单元测试与组件测试
├── workers/
│   └── oauth-proxy/           # 无状态 Cloudflare Worker（PKCE 换票、续期及隐私政策页）
├── docs/
│   ├── ROADMAP.md                           # 三阶段开发路线图
│   ├── HANDOFF.md                           # 项目交接与架构说明
│   ├── CHROME_WEB_STORE.md                  # Chrome Web Store 上架准备指南
│   ├── OAUTH_PERSISTENCE_TROUBLESHOOTING.md # Google 长期授权配置与排错记录
│   └── assets/                              # 120x120 Google 品牌验证 Logo
├── popup.html                 # Popup 页面入口
├── manager.html               # Manager 页面入口
└── vite.config.ts             # Vite 多入口构建配置
```

---

## 完整开发与调试流程

### 1. 日常开发常用命令

```bash
# 1. 一键启动独立测试浏览器（自动编译、自动加载 dist/，改代码后自动热重载，无需手动添加）
npm run dev:browser

# 2. 仅启动监听构建（保存源码后自动更新 dist/）
npm run dev

# 3. 类型检查、代码规范检查、单元测试、生产构建一键校验
npm run check

# 4. 运行真实浏览器 E2E 自动化测试（自动启动 Chromium 加载 dist/ 并完整测试弹窗与管理页）
npm run test:e2e

# 5. 单独运行各项检查
npm run typecheck
npm run lint
npm test
npm run build

# 6. 打包可分发压缩包
npm run package       # 生成 release/autosynctab-v0.3.0.zip（保留本地固定 key）
npm run package:cws   # 生成 release/autosynctab-v0.3.0-cws.zip（自动剥离 key，供 Chrome Web Store 上传）
```

### 2. 免手动点击的正式测试方式（推荐）

由于现代版 Google Chrome（137+）出于安全策略禁用了正式版浏览器的 `--load-extension` 参数，**项目已内置 Playwright + Chrome for Testing 正式测试流**：
- **自动化端到端测试 (`npm run test:e2e`)**：每次改完代码直接运行，脚本会自动构建 `dist/`、启动隔离 Chromium 并加载扩展，自动测完「弹窗统计 -> 一键收纳 -> 自动关闭原标签 -> 快捷键检查 -> 深色模式切换 -> 搜索/重命名/锁定 -> 快照创建 -> 恢复」全流程。
- **交互式热重载测试浏览器 (`npm run dev:browser`)**：自动弹出已加载好扩展的独立 Chromium 窗口；继续改源码保存后，会自动重新编译并调用 `chrome.runtime.reload()` 热重载扩展，无需每次去 `chrome://extensions/` 手动添加或点刷新。

### 3. 如果需要在你日常使用的 Google Chrome 中加载试用

1. 先运行 `npm run build`（或保持 `npm run dev` 运行），确认项目根目录已生成 `dist/` 文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角的 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**，选择本项目的 `dist/` 目录（**注意是 `dist/`，不是根目录**）。
5. 建议将扩展图标固定到工具栏（Pin），点击图标即可打开弹窗菜单。

---

## 已实现功能

### 阶段一：本地核心标签页管理
- **三种收纳模式**：收纳当前窗口全部标签页 / 仅收纳当前标签页 / 收纳其他标签页（弹窗 + 网页右键菜单 + 全局快捷键均可触发）。
- **防误操作保护**：
  - 自动跳过 `chrome://`、`chrome-extension://` 等系统内部页面及插件自身管理页。
  - 若收纳后会关闭窗口最后一个标签页，会自动先打开管理页再关闭原标签，避免浏览器窗口意外关闭。
  - 锁定的分组在恢复、拖拽或误点删除时受到保护。
- **管理页能力**：分组重命名、锁定/解锁、关键词实时搜索、一键恢复整组/单个标签、复制链接、设置面板、兼容 OneTab 文本及完整 JSON 的导入导出。

### 阶段二：Google Drive 云端备份与恢复（支持长期免掉线授权）
- **Google OAuth 2.0 长期授权（PKCE + Refresh Token）**：支持在扩展内配置 OAuth Client ID 与无状态代理地址（或通过 `VITE_GOOGLE_CLIENT_ID` / `VITE_OAUTH_PROXY_URL` 预置），使用 `launchWebAuthFlow` + PKCE 配合 [workers/oauth-proxy/worker.js](workers/oauth-proxy/worker.js) 兑换 `refresh_token`，关闭浏览器重开也能自动无感续期（支持自由切换任意 Google 账号；详见 [docs/OAUTH_PERSISTENCE_TROUBLESHOOTING.md](docs/OAUTH_PERSISTENCE_TROUBLESHOOTING.md)）。
- **隐私安全的云端存储**：备份文件 `autosynctab-backup.json` 存放在 Google Drive 隐藏应用目录 `appDataFolder`，不污染云盘根目录；访问令牌与备份内容分离存储。
- **备份与恢复模式**：支持「立即备份到云端」、「智能合并到本地」与「覆盖本地记录」。

### 阶段三：自动同步、冲突保护与体验增强
- **自动防抖同步与远端校验**：本地增删改后约 30 秒通过 `chrome.alarms` 后台防抖同步；浏览器启动与打开管理页时轻量校验云端更新。
- **三方分组级合并与冲突保护**：基于 `deletedGroups` 墓碑与 `updatedAt` 实现多设备无冲突自动合并；当出现同分组并发冲突时自动暂停上传、生成本地安全快照并提示用户一键处理（智能合并 / 保留本地 / 使用云端）。
- **本地历史版本快照**：自动（云端恢复/同步/冲突/覆盖导入前）与手动保留最近 15 份本地安全快照，支持在 Google Drive 弹窗内随时查看、合并恢复或覆盖恢复。
- **效率与外观升级**：
  - 全局快捷键（`Alt+Shift+S/A/C/M`）与管理页快捷键（`/` / `Ctrl+K` 搜索、`Esc` 清空/关闭）；
  - 深色模式（跟随系统 / 浅色 / 深色三态切换）；
  - 分组拖拽排序与标签页跨未锁定分组拖拽移动；
  - 浏览器书签自动抓取与管理（「书签列表」视图支持自动监听本机 Chrome 书签同步至插件及云端 `autosynctab-bookmarks.json`，支持目录树浏览、搜索、重复书签筛选、增删改/移动、导出 HTML，并与已收纳分组支持双向互转——既可把书签文件夹转为标签组，也可在分组卡片旁一键「存为书签」将整组链接以分组名存入书签栏文件夹）；
  - Chrome Web Store 上架准备（`npm run package:cws` 与 [docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md)）。

#### 连接 Google Drive
已内置默认 Google OAuth Client ID，打开管理页右上角 **Google Drive 云同步** 后直接点击 **登录 Google 账号** 即可授权并开始备份与自动同步（测试阶段需确保登录邮箱已添加到 Google Cloud Console 的 Test users 名单中；如需更换自定义 Client ID，可展开弹窗底部的「高级设置」或通过 `VITE_GOOGLE_CLIENT_ID` 环境变量覆盖）。
