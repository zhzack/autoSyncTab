# autoSyncTab 项目交接文档（Handoff）

> 本文档用于在新对话窗口（工作区：`C:\Users\zz101\Desktop\autoSyncTab`）中快速恢复上下文并继续开发。

---

## 1. 项目概览与环境信息

- **项目名称**：`autoSyncTab`（npm 包名：`autosynctab`，当前版本：`0.2.0`）
- **当前根目录**：`C:\Users\zz101\Desktop\autoSyncTab`（原目录 `oneTab` 已重命名为此目录）
- **技术栈**：React 19 + TypeScript 5.9 + Vite 8（Manifest V3 多入口构建）+ Vitest 5 + Playwright（Chrome for Testing 158）
- **固定扩展 ID**：`jlckgkpfpnegkcfmoioonmkjjgoggpmb`（通过 `public/manifest.json` 中的 `"key"` 公钥固定）
- **OAuth 重定向 URI**：`https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/`

---

## 2. 已完成功能与关键架构决策

### 阶段一：工程化工作流 + OneTab 核心本地功能（已完成）
- **完整开发与测试流**：
  - `npm run dev:browser`（`scripts/launch-dev-browser.mjs`）：自动编译并拉起 Playwright 独立 Chromium（数据保存在 `.dev-chrome-profile/`，不污染用户日常 Chrome 账户），监听源码变动自动调用 `chrome.runtime.reload()` 热重载。
  - `npm run check`：`tsc --noEmit` + `eslint .` + `vitest run` + `vite build`。
  - `npm run test:e2e`（`e2e/extension.spec.ts`）：自动构建并用真实 Chromium 加载 `dist/` 跑端到端测试。
  - `npm run package`（`scripts/package-extension.mjs`）：打包输出 `release/autosynctab-v0.2.0.zip`。
- **交互设计**：
  - 用户选择了 **弹窗菜单模式**：点击扩展图标弹出 `popup.html`，可选择「收纳当前窗口全部标签页 / 仅收纳当前标签页 / 收纳其他标签页 / 打开标签页管理页」。
  - 所有收纳动作由 `src/background/index.ts`（Service Worker）执行，避免弹窗关闭中断异步流程；同时注册了网页与图标右键菜单。
  - `manager.html`（`ManagerApp`）支持分组重命名、锁定/解锁防误删、实时搜索、恢复单个/整组、复制链接、设置面板（忽略固定标签、恢复后移除、自动打开管理页、收纳去重）、兼容 OneTab 文本及完整 JSON 的导入导出。

### 阶段二：Google 账号授权与 Google Drive 云端备份/恢复（已完成，登录已打通）
- **Google Cloud 项目状态**：
  - 项目 ID：`autosynctab-514317`，项目编号：`813169183999`
  - 已内置默认 Web 应用 Client ID：`813169183999-7h25nq6u6rcf0lhf69gmknd65ogji42p.apps.googleusercontent.com`（定义在 `src/shared/storage.ts` 的 `DEFAULT_GOOGLE_CLIENT_ID`，支持 `VITE_GOOGLE_CLIENT_ID` 环境变量或界面「高级设置」覆盖）。
  - 用户已完成 Google Cloud Console 配置：Web 应用凭据已添加固定重定向 URI，Google Auth Platform 受众已切换为「外部（Testing）」，并添加测试用户邮箱。
- **授权与数据隔离**：
  - `GoogleDriveModal` 直接调用 `src/shared/syncAdapter.ts` 中的 `cloudSyncAdapter`，不经过 MV3 Service Worker 30 秒消息超时通道。
  - 使用 `chrome.identity.launchWebAuthFlow`（`response_type=token`、`prompt=select_account`、随机 `state` 校验），兼容多账户自由切换及非登录态的测试浏览器。
  - 仅申请 `https://www.googleapis.com/auth/drive.appdata` 与 `userinfo.email` 最小权限；备份文件 `autosynctab-backup.json` 存放在**各登录用户自己云盘的隐藏应用目录 `appDataFolder`**，用户间完全隔离。
  - 本地存储键：`autosynctab_store_v1`（业务数据）与 `autosynctab_auth_v1`（OAuth 令牌与 Client ID，导出和云端备份均剥离敏感令牌）。
- **其他细节**：
  - `popup.html` 和 `manager.html` 已添加 `translate="no"`、`<meta name="google" content="notranslate" />` 与 `class="notranslate"`，防止 Chrome 弹出翻译提示。
  - `syncAdapter.ts` 中的 `formatWebAuthError` 已对 `Only one web auth flow is allowed`、`The user did not approve access` 等 Chrome 英文报错做了中文提示转换。

---

## 3. 核心文件索引

- **配置与构建**：`package.json`、`public/manifest.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`eslint.config.js`、`tsconfig.json`
- **共享层**：
  - `src/shared/types.ts`（核心类型定义）
  - `src/shared/storage.ts`（`chrome.storage.local` 封装、合并算法 `mergeRemoteGroups` / `applyRemoteBackup`、默认 Client ID）
  - `src/shared/tabService.ts`（标签过滤、收纳、恢复与窗口管理）
  - `src/shared/formatters.ts`（日期格式化、OneTab 文本及 JSON 导入导出）
  - `src/shared/googleDriveClient.ts`（OAuth URL、state 校验、Drive v3 `appDataFolder` REST 接口）
  - `src/shared/syncAdapter.ts`（`GoogleDriveSyncAdapter` 与错误中文映射）
- **界面与后台**：
  - `src/background/index.ts`
  - `src/popup/PopupApp.tsx`、`src/popup/popup.css`
  - `src/manager/ManagerApp.tsx`、`src/manager/manager.css`
  - `src/manager/components/Header.tsx`、`GroupCard.tsx`、`SettingsBar.tsx`、`ImportExportModal.tsx`、`GoogleDriveModal.tsx`
- **测试与脚本**：
  - `src/test/`（`storage.test.ts`、`tabService.test.ts`、`formatters.test.ts`、`googleDrive.test.ts`、`popup.test.tsx`、`manager.test.tsx`）
  - `e2e/extension.spec.ts`
  - `scripts/generate-icons.mjs`、`scripts/package-extension.mjs`、`scripts/launch-dev-browser.mjs`

---

## 4. 新对话接手后建议的检查与下一步待办

1. **新对话基线复验**（因目录刚改名，先在新工作区执行一次命令确认环境正常）：
   ```bash
   npm run check
   npm run test:e2e
   ```
2. **日常浏览器同步提示**：
   - 若日常 Chrome 仍加载着旧路径 `oneTab\dist`，需在 `chrome://extensions/` 重新加载 `C:\Users\zz101\Desktop\autoSyncTab\dist`。
3. **待用户确认后可继续的阶段三功能**（详见 `docs/ROADMAP.md`）：
   - 本地标签增删改后自动防抖同步到 Google Drive + 打开管理页时校验远端版本；
   - 冲突检测与历史快照/分组级精细合并；
   - 键盘快捷键（`manifest.json` `commands`）、深色模式；
   - Chrome Web Store 上架准备（注意上架前需按规范处理 `manifest.json` `"key"` 与商店 ID 对应的 OAuth 回调地址）。

---

## 5. 新对话开场推荐提示词

在新对话中可以直接发送：
> 请先阅读 `docs/HANDOFF.md` 和 `docs/ROADMAP.md` 了解项目当前进度，然后先运行 `npm run check` 和 `npm run test:e2e` 验证环境正常，接下来我们继续……
