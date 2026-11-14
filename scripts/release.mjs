import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync as runCommand } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const MANIFEST_PATH = resolve(ROOT, 'public/manifest.json');

const EXTENSION_ID = 'jdpiepnpdobipikhedfcegaehmfpgmjp';
const DEVELOPER_ID = '80a3a15e-2aba-478e-9402-0c4fe2e8d476';
const DASHBOARD_PACKAGE_URL = `https://chrome.google.com/webstore/devconsole/${DEVELOPER_ID}/${EXTENSION_ID}/edit/package`;

function parseVersion(ver) {
  const parts = ver.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver: ${ver}`);
  }
  return parts;
}

function bump(currentVersion, type) {
  const [major, minor, patch] = parseVersion(currentVersion);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(type)) return type;
  return `${major}.${minor}.${patch + 1}`;
}

const bumpType = process.argv[2] || 'patch';

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const oldVersion = pkg.version;
const newVersion = bump(oldVersion, bumpType);

console.log(`\n🚀 准备发布更新: v${oldVersion} -> v${newVersion} (${bumpType})\n`);

// 1. 同步更新 package.json
pkg.version = newVersion;
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`✅ 已更新 package.json version -> ${newVersion}`);

// 2. 同步更新 public/manifest.json
manifest.version = newVersion;
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`✅ 已更新 public/manifest.json version -> ${newVersion}`);

// 3. 执行检查与构建打包
console.log(`\n⏳ 正在执行生产检查与商店包构建 (npm run check + package:cws)...`);
try {
  runCommand('npm run check', { cwd: ROOT, stdio: 'inherit' });
  runCommand('node scripts/package-extension.mjs --cws', { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  console.error(`\n❌ 构建失败，请检查报错！已回滚版本号至 v${oldVersion}`, err);
  pkg.version = oldVersion;
  manifest.version = oldVersion;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.exit(1);
}

const zipPath = resolve(ROOT, `release/${pkg.name}-v${newVersion}-cws.zip`);

console.log(`\n🎉 新版本打包完成！`);
console.log(`📦 新安装包路径: ${zipPath}`);
console.log(`\n👉 接下来仅需 2 步发布：`);
console.log(`1. 打开商店包管理后台:`);
console.log(`   ${DASHBOARD_PACKAGE_URL}`);
console.log(`2. 点击「上传新程序包 (Upload new package)」，拖入上面的 zip 文件，然后点击提交审核即可！\n`);

// 自动打开 release 目录方便拖拽
try {
  if (process.platform === 'win32') {
    runCommand(`explorer.exe /select,"${zipPath}"`);
  }
} catch (err) {
  void err;
}
