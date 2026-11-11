# autoSyncTab OAuth 令牌无状态代理（Cloudflare Worker）

用于在浏览器扩展中安全配合 PKCE 授权码流获取并静默刷新 Google `refresh_token`，不保存任何用户数据或令牌。

## 提供端点

- `GET /`：扩展主页说明页（可用于 Google Auth Platform 品牌首页网址）
- `GET /privacy`：隐私权政策页面（可用于 Google Auth Platform 品牌隐私权政策网址）
- `POST /exchange`：接收 `{ code, code_verifier, redirect_uri }`，向 Google 兑换 `access_token` 与 `refresh_token`
- `POST /refresh`：接收 `{ refresh_token }`，向 Google 静默刷新 `access_token`

## Cloudflare Worker 环境变量（Secrets）

在 Cloudflare Dashboard → Worker → **Settings → Variables and Secrets** 中以 **Secret** 类型配置：

- `GOOGLE_CLIENT_ID`：Google Web 应用 Client ID
- `GOOGLE_CLIENT_SECRET`：Google Web 应用 Client Secret
- *(可选)* `ALLOWED_ORIGIN`：默认 `chrome-extension://jlckgkpfpnegkcfmoioonmkjjgoggpmb`
- *(可选)* `ALLOWED_REDIRECT_URI`：默认 `https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/`
