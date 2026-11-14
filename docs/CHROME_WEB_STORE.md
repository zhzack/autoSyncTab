# Chrome Web Store 上架与发布全流程指南

本文档用于指导 **autoSyncTab** 在 Chrome Web Store（CWS）的首次上架、凭据绑定与后续自动化持续发布。

---

## 1. 核心上架资产与标识

* **Chrome 开发者账号 ID (Publisher ID)**: `80a3a15e-2aba-478e-9402-0c4fe2e8d476`
* **正式 Extension ID**: `jdpiepnpdobipikhedfcegaehmfpgmjp`
* **CWS 后台草稿/版本编辑直达链接**:  
  https://chrome.google.com/webstore/devconsole/80a3a15e-2aba-478e-9402-0c4fe2e8d476/jdpiepnpdobipikhedfcegaehmfpgmjp/edit
* **程序包管理直达链接**:  
  https://chrome.google.com/webstore/devconsole/80a3a15e-2aba-478e-9402-0c4fe2e8d476/jdpiepnpdobipikhedfcegaehmfpgmjp/edit/package
* **在线隐私政策网址 (Privacy Policy)**:  
  `https://autosynctab-oauth.zz1018784543.workers.dev/privacy`

---

## 2. 外部授权白名单（已对接正式 ID）

1. **Google Cloud Console OAuth 凭据**：
   * 凭据 Client ID: `813169183999-7h25nq6u6rcf0lhf69gmknd65ogji42p.apps.googleusercontent.com`
   * **已获授权的重定向 URI** 已加入：
     ```text
     https://jdpiepnpdobipikhedfcegaehmfpgmjp.chromiumapp.org/
     ```
2. **Cloudflare Worker 代理 (`workers/oauth-proxy`)**：
   * `ALLOWED_ORIGIN`: `chrome-extension://jlckgkpfpnegkcfmoioonmkjjgoggpmb,chrome-extension://jdpiepnpdobipikhedfcegaehmfpgmjp`
   * `ALLOWED_REDIRECT_URI`: `https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/,https://jdpiepnpdobipikhedfcegaehmfpgmjp.chromiumapp.org/`

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
| `bookmarks` | 自动读取本机浏览器书签树同步至插件「书签列表」视图，并支持在插件管理页内增删改、整理书签与同步至用户的 Google Drive 私人应用空间。 |
| Host Permissions (`googleapis.com`, `oauth2.googleapis.com`, `*.workers.dev`) | 分别用于读写用户个人 Google Drive `appDataFolder` 备份与用户信息、在断开时撤销令牌，以及通过无状态 Cloudflare Worker 代理完成 PKCE 授权码兑换与长期 `refresh_token` 刷新。 |

---

## 4. 宣传素材与截图自动化

谷歌商店对截图有严格的像素限制与格式要求（**必须为 1280x800 或 640x400，严禁 32 位 Alpha 透明通道**）。
项目中已内置 Playwright 自动化渲染截图脚本：

```bash
npm run screenshots
```

执行后会自动在 [docs/store-screenshots/](./store-screenshots/) 生成符合规范的高品质 JPEG 图像：
1. `screenshot-1-manager-light.jpg` (1280×800) - 浅色模式管理页
2. `screenshot-2-manager-dark.jpg` (1280×800) - 深色模式管理页
3. `screenshot-3-settings-sync.jpg` (1280×800) - Google Drive 同步与偏好设置
4. `screenshot-4-popup.jpg` (1280×800) - Popup 弹窗与核心功能宣传
5. `promo-tile-small-440x280.jpg` (440×280) - 小型宣传图块
6. `promo-tile-marquee-1400x560.jpg` (1400×560) - 顶部宣传图块

---

## 5. 后续版本一键更新流程

后续维护和日常 Bug 修复时，无需手动改写版本号或反复打包，只需运行：

```bash
npm run release        # 自动 patch: 0.3.0 -> 0.3.1
# 或
npm run release:minor  # 自动 minor: 0.3.0 -> 0.4.0
```

脚本将自动执行以下操作：
1. 同步更新 `package.json` 与 `public/manifest.json` 的版本号；
2. 执行类型检查、代码规范校验与单元测试（`npm run check`）；
3. 编译前端并剥离 `"key"` 生成正式 CWS 安装包（`release/autosynctab-v*-cws.zip`）；
4. 在资源管理器中自动弹出并高亮选中生成的 zip 包；
5. 在终端打印直达后台上传地址。只需拖入网页并点击「提交审核」即可。
