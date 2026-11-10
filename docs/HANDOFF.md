# autoSyncTab 项目交接文档（Handoff）

> 本文档用于在新对话窗口（工作区：`C:\Users\zz101\Desktop\autoSyncTab`）中快速恢复上下文并继续开发。

---

## 1. 项目概览与环境信息

- **项目名称**：`autoSyncTab`（npm 包名：`autosynctab`，当前版本：`0.3.0`）
- **当前根目录**：`C:\Users\zz101\Desktop\autoSyncTab`
- **GitHub 仓库**：`https://github.com/zhzack/autoSyncTab`（Private）
- **技术栈**：React 19 + TypeScript 5.9 + Vite 8（Manifest V3 多入口构建）+ Vitest 5 + Playwright（Chrome for Testing 158）
- **固定扩展 ID**：`jlckgkpfpnegkcfmoioonmkjjgoggpmb`（通过 `public/manifest.json` 中的 `"key"` 公钥固定）
- **OAuth 重定向 URI**：`https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/`

---

## 2. 已完成功能与关键架构决策

### 阶段一：工程化工作流 + OneTab 核心本地功能（已完成）
- **完整开发与测试流**：
  - `npm run dev:browser`（`scripts/launch-dev-browser.mjs`）：自动编译并拉起 Playwright 独立 Chromium（数据保存在 `.dev-chrome-profile/`），监听源码变动自动热重载。
  - `npm run check`：`tsc --noEmit` + `eslint .` + `vitest run` + `vite build`。
  - `npm run test:e2e`（`e2e/extension.spec.ts`）：自动构建并用真实 Chromium 加载 `dist/` 跑端到端测试。
  - `npm run package` / `npm run package:cws`（`scripts/package-extension.mjs`）：输出 `release/autosynctab-v0.3.0.zip`（含固定 `"key"`）与 `release/autosynctab-v0.3.0-cws.zip`（自动剥离 `"key"`，供 Chrome Web Store 上架）。
- **交互设计**：
  - 弹窗菜单模式（`popup.html`）+ 后台 Service Worker（`src/background/index.ts`）统一执行收纳与右键菜单动作。
  - `manager.html`（`ManagerApp`）支持分组重命名、锁定/解锁、实时搜索、恢复单个/整组、复制链接、设置面板、OneTab 文本及完整 JSON 导入导出。

### 阶段二：Google 账号授权与 Google Drive 云端备份/恢复（已完成）
- 默认 Web 应用 Client ID 内置在 `src/shared/storage.ts`（`DEFAULT_GOOGLE_CLIENT_ID`），支持 `VITE_GOOGLE_CLIENT_ID` 环境变量或界面「高级设置」覆盖。
- `GoogleDriveModal` 直接调用 `src/shared/syncAdapter.ts` 中的 `cloudSyncAdapter`，使用 `chrome.identity.launchWebAuthFlow`（`response_type=token`、`prompt=select_account`、随机 `state` 校验）。
- 仅申请 `drive.appdata` 与 `userinfo.email` 最小权限，备份存放在各用户云盘隐藏目录 `appDataFolder`。
- 存储键分离：`autosynctab_store_v1`（业务数据）、`autosynctab_auth_v1`（OAuth 令牌）、`autosynctab_snapshots_v1`（本地历史快照）、`autosynctab_sync_runtime_v1`（实时同步状态与冲突载荷）。

### 阶段三：自动同步、冲突处理与体验增强（已完成）
- **自动同步**：`src/background/index.ts` 监听 `chrome.storage.onChanged`，通过 `computeContentDigest` 判定真实内容变更（排除 `sync` 元数据自身写入），使用 `chrome.alarms` 30 秒防抖触发 `syncAuto()`；并在 `onStartup` 及打开管理页时轻量校验远端 `modifiedTime`。
- **三方合并与冲突处理**：`src/shared/syncMerge.ts` 实现基于 `deletedGroups` 墓碑与 `updatedAt` 的分组级三方合并 `reconcileStores`；无冲突时跨端自动合并，发生并发冲突时暂停上传、自动生成 `pre-conflict` 本地快照并在管理页与 Drive 弹窗展示冲突解决操作（智能合并 / 以本地为准 / 以云端为准）。
- **历史快照**：`src/shared/snapshots.ts` 保留最近 15 份快照（自动去重连续相同内容的自动快照），可在 Drive 弹窗「历史快照」页签创建手动快照、合并恢复、覆盖恢复或删除。
- **体验升级与上架准备**：
  - 快捷键：`manifest.json` `commands`（`Alt+Shift+S/A/C/M`）及管理页 `/`、`Ctrl+K`、`Esc`；
  - 深色模式：`src/shared/theme.ts` 支持 `system / light / dark` 三态并同步应用至 Popup 与 Manager；
  - 拖拽排序：`GroupCard` 支持分组拖拽排序及标签页同组/跨未锁定分组拖拽移动；
  - 书签自动抓取与管理：`src/shared/bookmarks.ts` 监听 `chrome.bookmarks` 变更自动同步到 `autosynctab_bookmarks_v1`，独立上传/拉取 Google Drive `autosynctab-bookmarks.json`，并在管理页「书签列表」提供文件夹树浏览、搜索、重复检测、增删改/移动、导出 HTML 与文件夹转标签组功能（同时在空浏览器下保护云端书签不被空树覆盖）；
  - Chrome Web Store 资料：[docs/CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md) 与 `npm run package:cws`。

---

## 3. 核心文件索引

- **配置与构建**：`package.json`、`public/manifest.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`eslint.config.js`、`tsconfig.json`
- **共享层**：
  - `src/shared/types.ts`（核心类型定义）
  - `src/shared/storage.ts`（`chrome.storage.local` 封装、墓碑维护、拖拽重排 `reorderGroupsInStore`/`moveTabInStore`、内容指纹 `computeContentDigest`）
  - `src/shared/syncMerge.ts`（三方分组级合并 `reconcileStores` 与冲突合并 `mergeConflictingGroup`）
  - `src/shared/bookmarks.ts`（浏览器书签树抓取、增删改/移动、重复检测、HTML 导出与云端防误覆盖保护）
  - `src/shared/snapshots.ts`（历史版本快照管理）
  - `src/shared/syncState.ts`（同步运行时状态与冲突载荷持久化）
  - `src/shared/theme.ts`（深浅主题解析与系统主题订阅）
  - `src/shared/tabService.ts`（标签过滤、收纳、恢复与窗口管理）
  - `src/shared/formatters.ts`（日期格式化、OneTab 文本及 JSON 导入导出）
  - `src/shared/googleDriveClient.ts`（OAuth URL、state 校验、Drive v3 `appDataFolder` REST 接口）
  - `src/shared/syncAdapter.ts`（`GoogleDriveSyncAdapter` 自动同步、冲突解决与错误中文映射）
- **界面与后台**：
  - `src/background/index.ts`
  - `src/popup/PopupApp.tsx`、`src/popup/popup.css`
  - `src/manager/ManagerApp.tsx`、`src/manager/manager.css`
  - `src/manager/components/Header.tsx`、`GroupCard.tsx`、`BookmarksView.tsx`、`SiteFavicon.tsx`、`SettingsBar.tsx`、`ImportExportModal.tsx`、`GoogleDriveModal.tsx`
- **测试与脚本**：
  - `src/test/`（`storage.test.ts`、`tabService.test.ts`、`formatters.test.ts`、`bookmarks.test.ts`、`googleDrive.test.ts`、`syncMerge.test.ts`、`popup.test.tsx`、`manager.test.tsx`）
  - `e2e/extension.spec.ts`
  - `scripts/generate-icons.mjs`、`scripts/package-extension.mjs`、`scripts/launch-dev-browser.mjs`
- **上架与规划文档**：`docs/ROADMAP.md`、`docs/HANDOFF.md`、`docs/CHROME_WEB_STORE.md`

---

## 4. 后续可继续的演进建议

1. 如有日常浏览器更新需求：在 `chrome://extensions/` 重新加载 `C:\Users\zz101\Desktop\autoSyncTab\dist`。
2. 如有新功能规划（如自定义标签分组颜色/备注、静默 OAuth Refresh Token 后端代理或发布到 Chrome Web Store 审核跟踪），可随时基于当前 `v0.3.0` 基线继续迭代。
