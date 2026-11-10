# autoSyncTab

一个基于 **React + TypeScript + Vite (Manifest V3)** 构建的轻量级浏览器标签页收纳管理扩展（类似 OneTab），目前已完成**阶段一（完整开发流程与本地核心功能）**及**阶段二（Google Drive 云端备份与恢复）**。

---

## 目录结构

```text
autoSyncTab/
├── public/
│   ├── manifest.json          # Chrome 扩展 Manifest V3 配置
│   └── icons/                 # 自动生成的 16/32/48/128 PNG 图标
├── scripts/
│   ├── generate-icons.mjs     # 零依赖 Node PNG 图标生成脚本
│   └── package-extension.mjs  # 打包 dist/ 为 release/*.zip
├── src/
│   ├── background/index.ts    # Service Worker：右键菜单与后台收纳调度
│   ├── popup/                 # 点击扩展图标时的弹窗菜单界面
│   ├── manager/               # 独立标签页管理页面与各 UI 组件
│   ├── shared/                # 数据模型、chrome.storage 封装、标签逻辑、导入导出
│   └── test/                  # Vitest 单元测试与组件测试
├── docs/ROADMAP.md            # 三阶段开发路线图
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

# 6. 打包可分发压缩包（生成 release/autosynctab-v0.2.0.zip）
npm run package
```

### 2. 免手动点击的正式测试方式（推荐）

由于现代版 Google Chrome（137+）出于安全策略禁用了正式版浏览器的 `--load-extension` 参数，**项目已内置 Playwright + Chrome for Testing 正式测试流**：
- **自动化端到端测试 (`npm run test:e2e`)**：每次改完代码直接运行，脚本会自动构建 `dist/`、启动隔离 Chromium 并加载扩展，自动测完「弹窗统计 -> 一键收纳 -> 自动关闭原标签 -> 跳转管理页 -> 搜索/重命名/锁定/恢复」全流程。
- **交互式热重载测试浏览器 (`npm run dev:browser`)**：自动弹出已加载好扩展的独立 Chromium 窗口；继续改源码保存后，会自动重新编译并调用 `chrome.runtime.reload()` 热重载扩展，无需每次去 `chrome://extensions/` 手动添加或点刷新。

### 3. 如果需要在你日常使用的 Google Chrome 中加载试用

1. 先运行 `npm run build`（或保持 `npm run dev` 运行），确认项目根目录已生成 `dist/` 文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角的 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**，选择本项目的 `dist/` 目录（**注意是 `dist/`，不是根目录**）。
5. 建议将扩展图标固定到工具栏（Pin），点击图标即可打开弹窗菜单。

#### 如何调试各个模块？
- **调试 Popup 弹窗**：右键点击扩展图标 -> **审查弹出内容（Inspect popup）**。
- **调试 Manager 管理页**：打开管理页后按 `F12` 打开 DevTools。
- **调试 Background Service Worker**：在 `chrome://extensions/` 卡片上点击蓝色的 **Service Worker** 链接即可查看后台日志。
- **修改代码后更新**：如果是监听模式 `npm run dev`，编译完成后去 `chrome://extensions/` 点击该扩展的 **刷新按钮**（若修改了逻辑或 `manifest.json`/`background.js` 尤其需要点击刷新）。

---

## 已实现功能

### 阶段一：本地核心标签页管理
- **三种收纳模式**：收纳当前窗口全部标签页 / 仅收纳当前标签页 / 收纳其他标签页（弹窗 + 网页右键菜单均可触发）。
- **防误操作保护**：
  - 自动跳过 `chrome://`、`chrome-extension://` 等系统内部页面及插件自身管理页。
  - 若收纳后会关闭窗口最后一个标签页，会自动先打开管理页再关闭原标签，避免浏览器窗口意外关闭。
  - 锁定的分组在恢复或误点删除时受到保护。
- **管理页能力**：分组重命名、锁定/解锁、关键词搜索、一键恢复整组/单个标签、复制链接、设置面板、兼容 OneTab 文本及完整 JSON 的导入导出。

### 阶段二：Google Drive 云端备份与恢复
- **Google OAuth 2.0 授权（支持多账号选择）**：支持在扩展内直接配置 OAuth Client ID（或通过环境变量 `VITE_GOOGLE_CLIENT_ID` 预置），使用 `launchWebAuthFlow` 授权并自由切换任意 Google 账号。
- **隐私安全的云端存储**：备份文件 `autosynctab-backup.json` 存放在 Google Drive 隐藏应用目录 `appDataFolder`，不污染云盘根目录；访问令牌与备份内容分离存储。
- **备份与恢复模式**：支持「立即备份到云端」、「智能合并到本地（按分组时间戳去重合并）」与「覆盖本地记录」。

#### 连接 Google Drive
已内置默认 Google OAuth Client ID，打开管理页右上角 **Google Drive 云同步** 后直接点击 **登录 Google 账号** 即可授权并开始备份与恢复（测试阶段需确保登录邮箱已添加到 Google Cloud Console 的 Test users 名单中；如需更换自定义 Client ID，可展开弹窗底部的「高级设置」或通过 `VITE_GOOGLE_CLIENT_ID` 环境变量覆盖）。

下一步规划详见 [docs/ROADMAP.md](docs/ROADMAP.md)。
