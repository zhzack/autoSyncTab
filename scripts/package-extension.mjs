import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_DIR = resolve(ROOT, 'dist');
const RELEASE_DIR = resolve(ROOT, 'release');

if (!existsSync(DIST_DIR)) {
  console.error('Error: dist/ directory not found. Run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const zipName = `${pkg.name}-v${pkg.version}.zip`;
const outPath = resolve(RELEASE_DIR, zipName);

mkdirSync(RELEASE_DIR, { recursive: true });

const zip = new JSZip();

function addDirectoryToZip(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDirectoryToZip(fullPath);
    } else {
      const relPath = relative(DIST_DIR, fullPath).replace(/\\/g, '/');
      zip.file(relPath, readFileSync(fullPath));
    }
  }
}

addDirectoryToZip(DIST_DIR);

await new Promise((resolvePromise, rejectPromise) => {
  zip
    .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
    .pipe(createWriteStream(outPath))
    .on('finish', resolvePromise)
    .on('error', rejectPromise);
});

console.log(`Created extension package: ${outPath}`);
