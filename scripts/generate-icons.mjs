import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '../public/icons');
const SIZES = [16, 32, 48, 128];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // no filter
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function coverageFromSdf(sdf, feather) {
  return clamp01(0.5 - sdf / feather);
}

function blendOver(dst, srcR, srcG, srcB, srcA) {
  const a = clamp01(srcA);
  const inv = 1 - a;
  dst[0] = dst[0] * inv + srcR * a;
  dst[1] = dst[1] * inv + srcG * a;
  dst[2] = dst[2] * inv + srcB * a;
  dst[3] = dst[3] + a * (1 - dst[3]);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const feather = 1.2 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;

      const pixel = [0, 0, 0, 0];

      // Background rounded square badge
      const bgSdf = sdRoundedBox(nx, ny, 0.5, 0.5, 0.44, 0.44, 0.19);
      const bgCov = coverageFromSdf(bgSdf, feather);
      if (bgCov > 0) {
        const t = clamp01((nx + ny) * 0.5);
        const r = 37 + (79 - 37) * t; // #2563EB -> #4F46E5
        const g = 99 + (70 - 99) * t;
        const b = 235 + (229 - 235) * t;
        blendOver(pixel, r, g, b, bgCov);
      }

      // Top back tab bar
      const bar1 = sdRoundedBox(nx, ny, 0.5, 0.30, 0.21, 0.055, 0.032);
      const bar1Cov = coverageFromSdf(bar1, feather);
      if (bar1Cov > 0) {
        blendOver(pixel, 199, 210, 254, bar1Cov * 0.85);
      }

      // Middle tab bar
      const bar2 = sdRoundedBox(nx, ny, 0.5, 0.45, 0.25, 0.06, 0.035);
      const bar2Cov = coverageFromSdf(bar2, feather);
      if (bar2Cov > 0) {
        blendOver(pixel, 224, 231, 255, bar2Cov * 0.95);
      }

      // Front main card
      const card = sdRoundedBox(nx, ny, 0.5, 0.65, 0.29, 0.115, 0.045);
      const cardCov = coverageFromSdf(card, feather);
      if (cardCov > 0) {
        blendOver(pixel, 255, 255, 255, cardCov);
      }

      // Small accent line inside front card (only visible clearly on >= 32px)
      if (size >= 24) {
        const line = sdRoundedBox(nx, ny, 0.44, 0.65, 0.14, 0.025, 0.015);
        const lineCov = coverageFromSdf(line, feather);
        if (lineCov > 0 && cardCov > 0.5) {
          blendOver(pixel, 79, 70, 229, lineCov * 0.8);
        }
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(clamp01(pixel[0] / 255) * 255);
      rgba[idx + 1] = Math.round(clamp01(pixel[1] / 255) * 255);
      rgba[idx + 2] = Math.round(clamp01(pixel[2] / 255) * 255);
      rgba[idx + 3] = Math.round(clamp01(pixel[3]) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(ICONS_DIR, { recursive: true });
for (const size of SIZES) {
  const outPath = resolve(ICONS_DIR, `icon${size}.png`);
  writeFileSync(outPath, renderIcon(size));
  console.log(`Generated ${outPath}`);
}
