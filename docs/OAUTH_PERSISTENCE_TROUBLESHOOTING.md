# Google Drive 长期授权（PKCE + Refresh Token）配置与排错记录

本文档记录 **autoSyncTab** 从“1 小时隐式流掉线”升级为“关闭浏览器重开永久保持登录”的技术架构，以及在 Google Cloud Console 与 Cloudflare Worker 配置过程中遇到的真实问题和解决方案。

---

## 1. 为什么早期版本会约 1 小时掉线？

- 早期实现使用 OAuth 2.0 隐式授权流（`response_type=token`），Google 返回的 `access_token` 固定有效期只有 **3600 秒（1 小时）**，且**不颁发 `refresh_token`**。
- `chrome.identity.launchWebAuthFlow` 使用的是浏览器隔离登录沙箱，会话 Cookie **在关闭浏览器后不保证持久保留**；即便改用 `prompt=none` 静默请求，重启浏览器后依然可能掉线。
- 而 Chrome 原生 `chrome.identity.getAuthToken` 又强绑定 Chrome Profile 登录账号，无法自由切换多账号，也不兼容 Playwright 测试浏览器或非 Chrome 内核浏览器。

### 最终采用的解决方案（PKCE + 无状态 Cloudflare Worker）

1. **前端扩展端**：使用 **Authorization Code + PKCE（S256）**，请求参数附带 `response_type=code`、`access_type=offline`、`prompt=select_account consent`，获取一次性授权码。
2. **无状态代理端（[workers/oauth-proxy/worker.js](../workers/oauth-proxy/worker.js)）**：接收扩展发来的 `code + code_verifier + redirect_uri`（`/exchange`）或 `refresh_token`（`/refresh`），在服务端安全拼接环境变量中的 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`，向 `https://oauth2.googleapis.com/token` 兑换并刷新令牌。Worker 不保存任何用户数据或令牌。
3. **本地持久化与自动无感续期**：扩展将 `refresh_token` 保存在独立的本地存储键 `autosynctab_auth_v1`（导出备份或上传云盘时绝不携带）。无论关闭重开浏览器还是遇到 `401`，[`GoogleDriveSyncAdapter`](../src/shared/syncAdapter.ts) 都会自动静默刷新 `access_token`，只在真正被撤销授权（`invalid_grant`）时才清理登录态并提示重新登录。
   - 同时保留向下兼容：若在弹窗「高级设置」中清空 `OAuth 令牌刷新代理` 地址，自动退回原有隐式授权流。

---

## 2. 配置过程中遇到的问题与解决方案汇总

| 阶段 | 遇到的问题 / 报错 | 原因分析 | 解决方案 |
| :--- | :--- | :--- | :--- |
| **1. 获取密钥** | 在 Google Cloud 客户端详情页看不到原有 `Client secret` 明文 | Google 出于安全规范，仅在新建凭据那一瞬间明文展示一次 `Client secret`，之后只显示掩码 | 无需删除重建 Client ID，直接进入 **Google Auth Platform → 客户端** 点开对应凭据，点击 **「+ 添加密钥（+ Add secret）」** 生成新密钥并立刻复制；随后可删除旧密钥。 |
| **2. 切正式版** | 「受众 / Audience」页面的 **「发布应用」** 按钮置灰，提示：`必须提供有效的应用名称、支持邮箱、首页网址和隐私权政策网址` | 发布到外部生产模式（解除 Testing 状态 `refresh_token` **7 天过期** 限制）前，必须完善「品牌 / Branding」页必填字段 | 在 **品牌 / Branding** 页填齐应用名称 `autoSyncTab`、支持邮箱、开发者联系邮箱、首页网址与隐私权政策网址，保存后再回受众页点「发布应用」。 |
| **3. 授权网域** | 填写首页与隐私链接后提示：`缺少的网域：zz1018784543.workers.dev 缺少的网域：github.com` | 隐私链接挂了私有 GitHub 仓库（外部不可访问），且下方「已获授权的网域」未登记对应域名 | 1. 在 Cloudflare Worker 顺带实现 `GET /`（主页）和 `GET /privacy`（隐私页）；<br>2. 将首页与隐私链接统一指向同一 Worker 域名；<br>3. 在「已获授权的网域」仅添加 `zz1018784543.workers.dev` 即可。 |
| **4. 网站所有权** | 品牌验证提示：`您的首页网址“https://autosynctab-oauth.zz1018784543.workers.dev/”对应的网站未注册到您的名下` | Google 需要通过 Google Search Console 确认该 URL 与当前 Cloud 项目账号的归属关系 | 用同一谷歌账号打开 Search Console → 选择 **「网址前缀 / URL prefix」**（勿选网域）→ 选 **HTML 文件验证**（如 `/google1b406c0f5a23f8c3.html`），在 `worker.js` 中增加该路由返回对应文本并部署后，点击验证通过。 |
| **5. 品牌徽标** | 品牌验证提示：`您的徽标无法唯一标识您的品牌和身份` | 未上传专属徽标，或纯抽象几何图标缺少应用名称与品牌辨识度 | 制作并上传包含清晰 `autoSyncTab` 字标与层叠标签同步图形的 **120×120 PNG**（[autosynctab-brand-logo-120x120.png](./assets/autosynctab-brand-logo-120x120.png)），重新提交品牌验证后通过（同时更新 [generate-icons.mjs](../scripts/generate-icons.mjs) 统一了插件多尺寸图标）。 |
| **6. 换票报错** | 扩展登录回调时报：`OAuth 令牌服务请求失败：worker_missing_oauth_secrets` | Worker 代码保护检查发现环境变量 `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET` 缺失（常见于只添了 Secret 漏添 Client ID，或添加变量后未点 Deploy） | 在 Cloudflare Worker 的 **Settings → Variables and Secrets** 中同时添加 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`（Secret 类型），并点击 **Deploy** 发布生效。 |

---

## 3. 线下小范围分享 vs Chrome Web Store 上架

- **线下分享给朋友**：
  - 使用 `npm run package` 生成 [release/autosynctab-v0.3.0.zip](../release/autosynctab-v0.3.0.zip)（保留了 `public/manifest.json` 的固定 `"key"`）。
  - 朋友解压后在 `chrome://extensions/` 开启「开发者模式」→「加载已解压的扩展程序」选中解压目录即可使用。
  - 每个朋友登录自己的 Google 账号，备份文件隔离存放在各自云盘的 `appDataFolder`，Worker 不存任何数据；若应用在受众页处于 `In production`，朋友无需预先加测试名单（未过敏感权限 Scope 审核时首次点一次「高级 → 继续」，受 100 用户总额度限制，朋友间分享完全够用）。
- **正式上架 Chrome Web Store**：
  - 见 [CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md)，需使用 `npm run package:cws` 剥离 `"key"`，并在拿到商店分配的新扩展 ID 后将其加入 Google Redirect URI 及 Worker 的 `ALLOWED_ORIGIN` / `ALLOWED_REDIRECT_URI`（支持英文逗号分隔多个值）。
