# Chrome Web Store 上架准备指南

本文档用于指导将 **autoSyncTab** 提交至 Chrome Web Store（CWS）审核与发布。

---

## 1. 上架打包命令（自动剥离 `"key"`）

本地开发为了在 `.dev-chrome-profile`、E2E 与日常 Chrome 中保持固定扩展 ID（`jlckgkpfpnegkcfmoioonmkjjgoggpmb`），在 [public/manifest.json](../public/manifest.json) 中保留了 `"key"` 字段。  
**提交 Chrome Web Store 时不能包含 `"key"` 字段**（商店会统一分配正式公钥与扩展 ID）。

运行以下命令即可自动构建并在不改动源码的前提下生成已剥离 `"key"` 的商店专用压缩包：

```bash
npm run package:cws
# 输出：release/autosynctab-v0.3.0-cws.zip
```

---

## 2. OAuth 重定向 URI 切换步骤

首次上传至 Chrome Web Store 开发者控制台（无需立刻公开，可先保存草稿或发布为仅测试人员可见）后，商店会为扩展分配正式的 Extension ID（格式为 32 位小写字母，例如 `<cws-extension-id>`）：

1. 打开 Google Cloud Console → **APIs & Services → Credentials**。
2. 编辑当前 Web 应用凭据（或新建生产环境凭据），在 **Authorized redirect URIs** 中添加商店正式回调地址：
   ```text
   https://<cws-extension-id>.chromiumapp.org/
   ```
3. 如果更换了生产环境 Client ID，可通过环境变量重新构建发布包：
   ```bash
   VITE_GOOGLE_CLIENT_ID="你的正式ClientID.apps.googleusercontent.com" npm run package:cws
   ```
4. 前往 **Google Auth Platform → Audience**，确认 OAuth 同意屏幕已提交审核（使用敏感/受限权限 `drive.appdata` 需按 Google 指南通过应用验证，或先向测试用户开放）。

---

## 3. 商店审核问卷填写参考

### Single Purpose（单一用途声明）
> 一键收纳、分组管理并按需恢复浏览器标签页，同时支持通过用户个人 Google Drive 应用私有目录（`appDataFolder`）实现跨设备备份与同步。

### 权限使用说明（Permission Justifications）

| 权限 | 审核说明 |
| :--- | :--- |
| `tabs` | 读取当前窗口标签页的标题、网址和图标以便一键收纳，并在用户点击恢复时重新打开对应页面、关闭已收纳的标签页。 |
| `storage` | 在本地 `chrome.storage.local` 持久化保存已收纳的标签页分组、设置项、本地安全快照及 OAuth 会话状态。 |
| `contextMenus` | 在网页与扩展图标右键菜单中提供「收纳全部 / 仅收纳当前页 / 收纳其他标签页 / 打开管理页」快捷入口。 |
| `identity` | 通过 `chrome.identity.launchWebAuthFlow` 让用户自主登录 Google 账号并获取最小权限访问令牌用于 Google Drive 备份。 |
| `alarms` | 在启用 Google Drive 自动同步后，于本地数据变更约 30 秒后防抖触发后台增量同步，避免频繁请求。 |
| Host Permissions (`googleapis.com`, `oauth2.googleapis.com`) | 仅用于读取登录邮箱、上传/下载位于用户个人 Google Drive `appDataFolder` 隐藏目录中的备份文件，以及在断开连接时撤销访问令牌。 |

---

## 4. 隐私政策要点（Privacy Policy Template）

- **数据采集与存储**：autoSyncTab 不设自有后端服务器，不会向任何第三方发送、出售或统计用户的浏览历史与标签页记录。所有数据默认仅保存在本地 `chrome.storage.local` 中。
- **可选云同步**：仅当用户主动点击「登录 Google 账号」并授权后，扩展才会将标签页分组 JSON 备份文件写入用户自己 Google Drive 的隐藏应用私有空间（`https://www.googleapis.com/auth/drive.appdata`），扩展无法访问云盘中的其他文件。
- **凭证隔离**：OAuth 访问令牌仅存于本地扩展存储键 `autosynctab_auth_v1`，绝不会包含在导出的 JSON 文件或上传的云端备份中；用户点击「断开」后会尝试调用 Google `revoke` 接口并立即清除本地令牌。

---

## 5. 发布前自检清单

- [ ] 运行 `npm run check`（`tsc` + `eslint` + `vitest` + `vite build`）全部通过。
- [ ] 运行 `npm run test:e2e` 真实 Chromium 端到端测试通过。
- [ ] 运行 `npm run package:cws` 检查生成的 `release/autosynctab-v*-cws.zip` 内 `manifest.json` 已不包含 `"key"`。
- [ ] 准备 1280×800 或 640×400 商店宣传截图（浅色模式管理页、深色模式管理页、Google Drive 同步与历史快照弹窗、Popup 菜单）。
