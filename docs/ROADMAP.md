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
  *(注：未来若需提交 Chrome Web Store 审核上架，上传前请移除 `"key"` 字段以由商店统一分配。)*
- 申请 `"identity"` 权限及 `https://www.googleapis.com/*`、`https://oauth2.googleapis.com/*` 主机权限。

### 2. 多账户友好的 OAuth 2.0 授权方案
- 使用 `chrome.identity.launchWebAuthFlow` + `prompt=select_account` + 随机 `state` 防 CSRF 校验：
  - 不仅支持 Google Chrome，也兼容 `npm run dev:browser` 启动的独立测试 Chromium 环境。
  - 支持在授权弹窗中自由选择/切换任意 Google 账号，不受浏览器当前 Profile 登录账号限制。
- 客户端 ID 支持在扩展弹窗内直接填写保存（也支持通过构建环境变量 `VITE_GOOGLE_CLIENT_ID` 预置）。
- 访问令牌保存在独立本地键 `autosynctab_auth_v1`，不会随标签页 JSON 备份上传或导出。

### 3. Google Drive API v3 集成
- 实现 `src/shared/googleDriveClient.ts` 与 `src/shared/syncAdapter.ts` 中的 `GoogleDriveSyncAdapter`：
  - 仅申请最小权限 `drive.appdata` 与 `userinfo.email`。
  - 备份文件 `autosynctab-backup.json` 存放在 Google Drive 隐藏应用空间 `appDataFolder`，不占用云盘根目录视图。
  - 支持创建（`POST uploadType=multipart`）、覆盖更新（`PATCH uploadType=media`）、下载恢复（`alt=media`），并支持「智能合并到本地」与「覆盖本地」两种恢复模式。

---

## 阶段三：自动同步、冲突处理与体验增强

- **自动同步策略**：本地变更后防抖自动上传（如 30 秒节流）+ 启动时拉取远端校验。
- **冲突检测与合并**：基于 `updatedAt`、分组级合并与历史版本快照保留，避免多设备覆盖丢失记录。
- **体验升级**：键盘快捷键（`manifest.json` `commands`）、深色模式、标签页拖拽分组排序、上架 Chrome Web Store 资料准备。
