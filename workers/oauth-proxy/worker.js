const DEFAULT_ALLOWED_ORIGIN = 'chrome-extension://jlckgkpfpnegkcfmoioonmkjjgoggpmb';
const DEFAULT_ALLOWED_REDIRECT = 'https://jlckgkpfpnegkcfmoioonmkjjgoggpmb.chromiumapp.org/';

function buildHomeHtml(verificationContent) {
  const escapedToken = verificationContent
    ? String(verificationContent).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    : '';
  const metaTag = escapedToken
    ? `\n  <meta name="google-site-verification" content="${escapedToken}" />`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />${metaTag}
  <title>autoSyncTab - Chrome 标签页与书签云同步扩展</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 48px auto; padding: 0 20px; color: #0f172a; line-height: 1.7; }
    h1 { color: #2563eb; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>autoSyncTab</h1>
  <p>autoSyncTab 是一款轻量级的 Chrome 浏览器扩展，用于一键收纳、分组管理标签页与同步书签，并通过用户个人 Google Drive 应用私有目录（<code>appDataFolder</code>）进行跨设备备份与同步。</p>
  <p><a href="/privacy">查看隐私权政策（Privacy Policy）</a></p>
</body>
</html>`;
}

const PRIVACY_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>autoSyncTab 隐私权政策（Privacy Policy）</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 48px auto; padding: 0 20px; color: #0f172a; line-height: 1.7; }
    h1 { color: #2563eb; }
  </style>
</head>
<body>
  <h1>autoSyncTab 隐私权政策</h1>
  <p><strong>数据存储：</strong>autoSyncTab 默认将您的标签页分组与书签记录保存在本地浏览器 <code>chrome.storage.local</code> 中，不会向任何第三方服务器收集、出售或统计您的浏览历史。</p>
  <p><strong>Google Drive 同步：</strong>仅在您主动授权登录 Google 账号后，扩展才会将备份文件写入您本人 Google Drive 的隐藏应用空间（<code>https://www.googleapis.com/auth/drive.appdata</code>），无法访问您云盘中的其他文件。</p>
  <p><strong>OAuth 令牌代理：</strong>本服务仅用于协助完成 Google OAuth 2.0 授权码兑换与令牌刷新，无状态运行，不会记录、缓存或保存您的任何访问令牌或个人数据。</p>
</body>
</html>`;

function parseAllowedList(raw, fallback) {
  const source = typeof raw === 'string' && raw.trim() ? raw : fallback;
  return source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(origin, allowedOrigins) {
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(buildHomeHtml(env.GOOGLE_SITE_VERIFICATION), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/privacy') {
      return new Response(PRIVACY_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/google1b406c0f5a23f8c3.html') {
      return new Response('google-site-verification: google1b406c0f5a23f8c3.html', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    const allowedOrigins = parseAllowedList(env.ALLOWED_ORIGIN, DEFAULT_ALLOWED_ORIGIN);
    const allowedRedirects = parseAllowedList(env.ALLOWED_REDIRECT_URI, DEFAULT_ALLOWED_REDIRECT);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (origin && !allowedOrigins.includes(origin)) {
      return json({ error: 'forbidden_origin' }, 403, headers);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return json({ error: 'worker_missing_oauth_secrets' }, 500, headers);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ error: 'invalid_json' }, 400, headers);
    }

    const params = new URLSearchParams();
    params.set('client_id', env.GOOGLE_CLIENT_ID);
    params.set('client_secret', env.GOOGLE_CLIENT_SECRET);

    if (url.pathname === '/exchange') {
      if (!body.code || !body.code_verifier || !allowedRedirects.includes(body.redirect_uri)) {
        return json({ error: 'invalid_exchange_request' }, 400, headers);
      }
      params.set('grant_type', 'authorization_code');
      params.set('code', String(body.code));
      params.set('code_verifier', String(body.code_verifier));
      params.set('redirect_uri', String(body.redirect_uri));
    } else if (url.pathname === '/refresh') {
      if (!body.refresh_token) {
        return json({ error: 'missing_refresh_token' }, 400, headers);
      }
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', String(body.refresh_token));
    } else {
      return json({ error: 'not_found' }, 404, headers);
    }

    const googleRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const text = await googleRes.text();
    return new Response(text, {
      status: googleRes.status,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
    });
  },
};
