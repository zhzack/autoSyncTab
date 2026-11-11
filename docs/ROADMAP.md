# autoSyncTab 分阶段开发路线图

## 阶段一：完整开发流程 + 基础核心功能（已完成）

### 1. 插件工程化开发流程
- **技术栈**：React + TypeScript + Vite（Manifest V3 多入口构建）
- **脚本闭环**：
  - `npm run dev`：监听模式自动编译输出至 `dist/`
  - `npm run typecheck`：TypeScript 严格类型检查
  - `npm run lint`：ESLint + React Hooks 代码质量检查
  - `npm test`：Vitest + Testing Library 单元测试（含 Chrome API Mock）
  - `npm run icons`：生成多尺寸 PNG 插件图标
  - `npm run package`：构建并打包为可直接分发的 `release/*.zip`

### 2. 核心基础功能
- **Popup 弹窗菜单**：
  - 实时统计当前窗口可收纳标签页数量与本地已保存总量
  - 支持「收纳当前窗口全部标签页 / 仅收纳当前标签页 / 收纳其他标签页」
  - 快捷跳转独立标签页管理页
- **Background Service Worker + 右键菜单**：
  - 所有收纳动作由后台 Service Worker 统一执行，避免弹窗关闭导致异步中断
  - 注册网页与扩展图标右键快捷菜单
- **Manager 独立管理页**：
  - 分组展示、内联重命名、锁定/解锁防误删
  - 恢复单个标签、恢复整组、删除标签/分组、一键复制链接
  - 关键词实时搜索（按标题、URL、分组名过滤）
  - 行为设置（忽略固定标签页、恢复后移除、自动打开管理页、自动去重）
  - 导入 / 导出（兼容 OneTab 文本格式与完整 JSON 备份）
- **阶段二预留架构**：
  - 存储结构包含 `schemaVersion`、`updatedAt` 与 `sync` 元数据
  - `src/shared/syncAdapter.ts` 定义了 `CloudSyncAdapter` 接口边界

---

## 阶段二：Google 账号授权与 Google Drive 云端备份/恢复（已完成）

### 1. 固定扩展 ID 与权限配置
- 在 `public/manifest.json` 中固定 RSA 公钥 `"key"`，确保任意测试环境（如 `.dev-chrome-profile`、E2E、Chrome）均获得稳定一致的扩展 ID：`jlckgkpfpnegkcfmoioonmkjjgoggpmb`。
  *(注：提交 Chrome Web Store 审核上架时请使用 `npm run package:cws`，脚本会自动从压缩包内的 `manifest.json` 剥离 `"key"` 字段。)*
- 申请 `"identity"` 权限及 `https://www.googleapis.com/*`、`https://oauth2.googleapis.com/*`、`https://*.workers.dev/*` 主机权限。

### 2. 多账户友好的长期 OAuth 2.0 授权方案（PKCE + Refresh Token）
- 使用 `chrome.identity.launchWebAuthFlow` + PKCE（`response_type=code`、`access_type=offline`、`prompt=select_account consent`、`S256`）+ 无状态 Cloudflare Worker 代理（`workers/oauth-proxy/worker.js`）：
  - 不仅支持 Google Chrome，也兼容 `npm run dev:browser`、Edge 等环境，并支持自由切换任意 Google 账号。
  - 兑换并持久化存储长期 `refresh_token`，关闭浏览器重开或遇 401 时后台自动无感续期（若高级设置清空代理地址则自动退回原有隐式流）。
- 客户端 ID 与代理地址支持在扩展弹窗内直接填写保存（也支持环境变量 `VITE_GOOGLE_CLIENT_ID` / `VITE_OAUTH_PROXY_URL` 预置）。
- 访问令牌与刷新令牌保存在独立本地键 `autosynctab_auth_v1`，不会随标签页 JSON 备份上传或导出；排错与配置记录见 [docs/OAUTH_PERSISTENCE_TROUBLESHOOTING.md](./OAUTH_PERSISTENCE_TROUBLESHOOTING.md)。

### 3. Google Drive API v3 集成
- 实现 `src/shared/googleDriveClient.ts` 与 `src/shared/syncAdapter.ts` 中的 `GoogleDriveSyncAdapter`：
  - 仅申请最小权限 `drive.appdata` 与 `userinfo.email`。
  - 备份文件 `autosynctab-backup.json` 存放在 Google Drive 隐藏应用空间 `appDataFolder`，不占用云盘根目录视图。
  - 支持创建（`POST uploadType=multipart`）、覆盖更新（`PATCH uploadType=media`）、下载恢复（`alt=media`），并支持「智能合并到本地」与「覆盖本地」两种恢复模式。

---

## 阶段三：自动同步、冲突处理与体验增强（已完成）

### 1. 自动同步策略
- **30 秒防抖后台同步**：在 `public/manifest.json` 注册 `"alarms"` 权限，由 `src/background/index.ts` 监听 `chrome.storage.onChanged`，通过 `computeContentDigest` 精准识别内容变更（同步元数据更新不触发循环上传），约 30 秒后自动触发 `cloudSyncAdapter.syncAuto()`。
- **启动与打开页远端校验**：浏览器启动（`chrome.runtime.onStartup`）及打开管理页时轻量检查远端 `modifiedTime`；无本地未同步修改时自动拉取远端更新，有差异时执行三方合并。
- **实时同步状态反馈**：通过 `autosynctab_sync_runtime_v1` 在后台与 Popup / Manager 间共享 `idle / syncing / conflict / auth-expired / error` 状态。

### 2. 冲突检测、三方合并与历史版本快照
- **墓碑机制与三方合并（`src/shared/syncMerge.ts`）**：引入 `deletedGroups` 删除墓碑（保留 30 天）与 `reconcileStores` 三方分组级合并，无重叠编辑时跨设备自动无感合并。
- **冲突检测与保护**：同一分组被多端并发修改或出现编辑/删除冲突时，自动暂停上传、生成 `pre-conflict` 安全快照，并在管理页与同步弹窗展示冲突提示，支持「智能合并双方（保留全量标签去重）」「以本地为准覆盖云端」「以云端为准覆盖本地」。
- **历史快照管理（`src/shared/snapshots.ts`）**：本地自动与手动保留最近 15 份快照（覆盖恢复、冲突保护、覆盖导入前自动生成），支持在 Google Drive 弹窗的「历史快照」页签一键查看、合并恢复或覆盖恢复。

### 3. 体验升级与上架准备
- **键盘快捷键**：
  - 全局扩展快捷键（`manifest.json` `commands`）：`Alt+Shift+S`（弹窗）、`Alt+Shift+A`（收纳全部）、`Alt+Shift+C`（仅收纳当前页）、`Alt+Shift+M`（打开管理页）。
  - 管理页内快捷键：`/` 或 `Ctrl+K` / `Cmd+K` 快速聚焦搜索框，`Esc` 清空搜索或关闭弹窗。
- **深色模式（`src/shared/theme.ts`）**：支持「跟随系统 / 浅色 / 深色」三态切换，Popup 与 Manager 均基于 CSS 变量完整适配深色主题。
- **拖拽排序与跨组移动**：支持未过滤模式下拖拽分组调整顺序，以及拖拽单个标签页在分组内排序或跨未锁定分组移动（自动尊重锁定分组保护）。
- **书签自动抓取与管理列表（`src/shared/bookmarks.ts`）**：自动监听 `chrome.bookmarks` 变化同步至插件内部及 Google Drive `autosynctab-bookmarks.json`，管理页提供「书签列表」标签页，支持文件夹树展开/折叠、搜索、重复书签筛选、新增/编辑/移动/删除、打开整目录、导出 Netscape HTML，并与已收纳分组支持双向互转（书签文件夹可转为标签分组，标签页分组旁也可一键「存为书签」自动在书签栏生成同名文件夹并去重写入链接）。
- **Chrome Web Store 上架准备**：新增 `npm run package:cws` 自动剥离 `"key"` 打包商店专用包，并编写 [docs/CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md)（权限说明、隐私政策模板、OAuth 回调迁移与审核自检清单）。
