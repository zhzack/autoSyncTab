# GitHub Actions 自动化发布到 Chrome Web Store 指南

本项目已在 `.github/workflows/cws-publish.yml` 中配置了 GitHub Actions 自动化持续发布工作流。

配置完成后，未来你只需在本地执行：
```bash
git tag v0.3.1
git push origin v0.3.1
```
或者在 GitHub 仓库的 **Actions** 标签页点击 **「Run workflow」**，GitHub 就会自动运行测试、编译打包、并通过 Google 官方 API 自动将安装包推送到 Chrome Web Store 并提交审核！

---

## 准备工作：获取 Google API 凭据

为了让 GitHub Actions 有权限往你的 Chrome 商店后台上传代码包，需要获取 3 个凭据：`CHROME_CLIENT_ID`、`CHROME_CLIENT_SECRET` 和 `CHROME_REFRESH_TOKEN`。

获取过程只需要做一次（约 3 分钟）：

### 第一步：在 Google Cloud Console 启用 Chrome Web Store API

1. 打开 [Google Cloud Console API 库](https://console.cloud.google.com/apis/library)。
2. 在搜索框搜索：`Chrome Web Store API`。
3. 点击进入并点击 **「启用 (Enable)」**。

---

### 第二步：创建用于发布 API 的 OAuth 客户端凭据

1. 打开 [Google Cloud Console 凭据页面](https://console.cloud.google.com/apis/credentials)。
2. 点击顶部的 **「+ 创建凭据 (+ Create Credentials)」** → 选择 **OAuth 客户端 ID (OAuth client ID)**。
3. 应用类型 (Application type) 选择：**Web 应用程序 (Web application)**。
4. 名称：填写任意名称（例如 `CWS Publisher GitHub Action`）。
5. 在 **已获授权的重定向 URI (Authorized redirect URIs)** 中，点击添加：
   ```text
   https://developers.google.com/oauthplayground
   ```
   *(该 URI 用于下一步在 Google 官方操场中授权换取 Refresh Token)*
6. 点击 **「创建 (Create)」**。
7. 在弹出的窗口中，复制并保存：
   * **客户端 ID (Client ID)**
   * **客户端密钥 (Client Secret)**

---

### 第三步：获取长期 Refresh Token

1. 浏览器打开 [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)。
2. 点击页面右上角的 **齿轮图标 (OAuth 2.0 configuration)**：
   * 勾选 **Use your own OAuth credentials**。
   * **OAuth Client ID**：填入第二步获得的 Client ID。
   * **OAuth Client secret**：填入第二步获得的 Client Secret。
   * 点击 Close 关闭浮窗。
3. 在页面左侧 **Step 1: Select & authorize APIs** 中：
   * 滚动到输入框 **Input your own scopes**，输入以下 API 权限：
     ```text
     https://www.googleapis.com/auth/chromewebstore
     ```
   * 点击旁边的蓝色按钮 **Authorize APIs**。
4. 页面会弹出 Google 授权窗口：
   * **请务必选择你注册了 Chrome 扩展开发者的 Google 账号登录并同意授权**。
5. 授权完成后会自动跳回 Playground 的 **Step 2: Exchange authorization code for tokens**：
   * 点击蓝色按钮 **Exchange authorization code for tokens**。
   * 页面右侧面板中会刷新展示返回结果，复制其中的 **`refresh_token`** 字段值（一串以 `1//...` 开头的长字符串）。

---

## 在 GitHub 仓库配置 Secrets

1. 打开你的 GitHub 仓库：  
   `https://github.com/zhzack/autoSyncTab`
2. 点击仓库顶部的 **Settings** → 左侧菜单 **Secrets and variables** → **Actions**。
3. 点击 **「New repository secret」**，依次添加以下 3 个密钥：

| Secret 名称 | 填入的值 | 说明 |
| :--- | :--- | :--- |
| `CHROME_CLIENT_ID` | 第二步生成的 Client ID | 用于 API 鉴权 |
| `CHROME_CLIENT_SECRET` | 第二步生成的 Client Secret | 用于 API 鉴权 |
| `CHROME_REFRESH_TOKEN` | 第三步换取的 refresh_token | 用于自动刷新访问令牌 |

*(注：`CHROME_EXTENSION_ID` 在工作流中已默认内置为 `jdpiepnpdobipikhedfcegaehmfpgmjp`，也可额外添加覆盖)*

---

## 如何使用自动化发布？

### 方式 1：打 Git Tag 自动触发（推荐）

每次需要发布新版本时：
```bash
# 1. 运行本地发布脚本，更新版本号并打包验证
npm run release

# 2. 提交并打对应 tag 推送
git commit -am "chore: release v0.3.1"
git tag v0.3.1
git push origin main --tags
```
GitHub Actions 会自动被触发，并在 1~2 分钟内编译、打包、直接调用 Chrome Web Store API 推送到应用商店提审！

### 方式 2：GitHub 网页手动点击触发

1. 打开 GitHub 仓库的 **Actions** 标签页。
2. 在左侧列表中选择 **「Publish Chrome Extension」**。
3. 点击右侧 **Run workflow** 下拉框：
   * 可选择是否直接提审（`auto_publish`），点击绿色的 **Run workflow** 按钮即可。
