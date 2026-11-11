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

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e2x = ax - cx;
  const e2y = ay - cy;

  const v0x = px - ax;
  const v0y = py - ay;
  const v1x = px - bx;
  const v1y = py - by;
  const v2x = px - cx;
  const v2y = py - cy;

  const clampDot = (vx, vy, ex, ey) => {
    const t = Math.max(0, Math.min(1, (vx * ex + vy * ey) / (ex * ex + ey * ey)));
    return [vx - ex * t, vy - ey * t];
  };

  const [pq0x, pq0y] = clampDot(v0x, v0y, e0x, e0y);
  const [pq1x, pq1y] = clampDot(v1x, v1y, e1x, e1y);
  const [pq2x, pq2y] = clampDot(v2x, v2y, e2x, e2y);

  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0x = pq0x * pq0x + pq0y * pq0y;
  const d0y = s * (v0x * e0y - v0y * e0x);
  const d1x = pq1x * pq1x + pq1y * pq1y;
  const d1y = s * (v1x * e1y - v1y * e1x);
  const d2x = pq2x * pq2x + pq2y * pq2y;
  const d2y = s * (v2x * e2y - v2y * e2x);

  const minSq = Math.min(d0x, d1x, d2x);
  const minSigned = Math.min(d0y, d1y, d2y);
  return -Math.sqrt(minSq) * Math.sign(minSigned);
}

function sdArc(px, py, cx, cy, radius, thickness, startAngle, endAngle) {
  const dx = px - cx;
  const dy = py - cy;
  const midAngle = (startAngle + endAngle) * 0.5;
  const halfSpan = (endAngle - startAngle) * 0.5;

  // Rotate point into arc-centered coordinates
  const cosM = Math.cos(-midAngle);
  const sinM = Math.sin(-midAngle);
  const rx = dx * cosM - dy * sinM;
  const ry = Math.abs(dx * sinM + dy * cosM);

  const sinSpan = Math.sin(halfSpan);
  const cosSpan = Math.cos(halfSpan);

  if (cosSpan * ry > sinSpan * rx) {
    return Math.hypot(rx - radius * cosSpan, ry - radius * sinSpan) - thickness;
  }
  return Math.abs(Math.hypot(rx, ry) - radius) - thickness;
}

function sdTabCard(px, py, cx, cy) {
  // Base body + top-left browser tab ear
  const body = sdRoundedBox(px, py, cx, cy + 0.015, 0.145, 0.095, 0.025);
  const tabEar = sdRoundedBox(px, py, cx - 0.055, cy - 0.08, 0.068, 0.03, 0.018);
  return Math.min(body, tabEar);
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

function makeArrowhead(cx, cy, radius, angle, forwardSign, wingSpan, tipLen) {
  const tipAngle = angle + forwardSign * (tipLen / radius);
  const baseX = cx + Math.cos(angle) * radius;
  const baseY = cy + Math.sin(angle) * radius;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const tipX = cx + Math.cos(tipAngle) * radius;
  const tipY = cy + Math.sin(tipAngle) * radius;
  return [
    tipX,
    tipY,
    baseX + nx * wingSpan,
    baseY + ny * wingSpan,
    baseX - nx * wingSpan,
    baseY - ny * wingSpan,
  ];
}

const DEG = Math.PI / 180;
const RIGHT_ARROW = makeArrowhead(0.5, 0.5, 0.315, -18 * DEG, 1, 0.062, 0.092);
const LEFT_ARROW = makeArrowhead(0.5, 0.5, 0.315, 162 * DEG, 1, 0.062, 0.092);

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const feather = (size <= 20 ? 0.9 : 1.25) / size;
  const ringThickness = size <= 20 ? 0.042 : 0.025;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const pixel = [0, 0, 0, 0];

      // Cobalt-to-indigo squircle badge with transparent outer corners
      const bgSdf = sdRoundedBox(nx, ny, 0.5, 0.5, 0.44, 0.44, 0.21);
      const bgCov = coverageFromSdf(bgSdf, feather);
      if (bgCov > 0) {
        const t = clamp01(ny * 0.78 + nx * 0.22);
        const r = 37 + (49 - 37) * t; // #2563EB -> #312E81
        const g = 99 + (46 - 99) * t;
        const b = 235 + (129 - 235) * t;
        blendOver(pixel, r, g, b, bgCov);
      }

      // Circular sync loop arcs + arrowheads
      const topArc = sdArc(nx, ny, 0.5, 0.5, 0.315, ringThickness, -162 * DEG, -18 * DEG);
      const botArc = sdArc(nx, ny, 0.5, 0.5, 0.315, ringThickness, 18 * DEG, 162 * DEG);
      const arrowR = sdTriangle(nx, ny, ...RIGHT_ARROW);
      const arrowL = sdTriangle(nx, ny, ...LEFT_ARROW);
      const syncSdf = Math.min(topArc, botArc, arrowR, arrowL);
      const syncCov = coverageFromSdf(syncSdf, feather);
      if (syncCov > 0) {
        blendOver(pixel, 255, 255, 255, syncCov * 0.96);
      }

      // Stacked browser tab cards in center (simplified single crisp card at 16px for clarity)
      if (size <= 20) {
        const singleTab = sdTabCard(nx, ny, 0.5, 0.51);
        const singleCov = coverageFromSdf(singleTab, feather);
        if (singleCov > 0) {
          blendOver(pixel, 255, 255, 255, singleCov);
        }
      } else {
        const backTab = sdTabCard(nx, ny, 0.545, 0.46);
        const midTab = sdTabCard(nx, ny, 0.505, 0.495);
        const frontTab = sdTabCard(nx, ny, 0.465, 0.53);

        const gap = 0.018;
        const backVisible = Math.max(backTab, -(midTab - gap));
        const midVisible = Math.max(midTab, -(frontTab - gap));

        const backCov = coverageFromSdf(backVisible, feather);
        if (backCov > 0) {
          blendOver(pixel, 199, 210, 254, backCov * 0.85);
        }

        const midCov = coverageFromSdf(midVisible, feather);
        if (midCov > 0) {
          blendOver(pixel, 224, 231, 255, midCov * 0.95);
        }

        const frontCov = coverageFromSdf(frontTab, feather);
        if (frontCov > 0) {
          blendOver(pixel, 255, 255, 255, frontCov);
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
