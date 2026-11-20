// Draws the extension icon (a ring with a dot, white on near-black) and writes extension/icons/icon-{16,32,48,128}.png.
// Pure Node: no image library. Run `node scripts/make-icons.mjs` after changing the design; the PNGs are committed.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SS = 4;                                              // supersampling for smooth edges
const INK = [26, 26, 26], WHITE = [255, 255, 255];

function render(size) {
  const N = size * SS, px = new Float64Array(size * size * 4);
  const R = 0.22 * N;                                      // corner radius of the square
  const cx = N / 2, cy = N / 2;
  const ringOuter = 0.30 * N, ringInner = 0.19 * N;        // the ring
  const dotX = cx + 0.30 * N * Math.cos(-Math.PI / 4), dotY = cy + 0.30 * N * Math.sin(-Math.PI / 4), dotR = 0.075 * N;   // the dot on the ring
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // inside the rounded square?
      const dx = Math.max(R - x, 0, x - (N - 1 - R)), dy = Math.max(R - y, 0, y - (N - 1 - R));
      if (dx * dx + dy * dy > R * R) continue;
      const rr = Math.hypot(x - cx, y - cy);
      const ring = rr <= ringOuter && rr >= ringInner;
      const dot = Math.hypot(x - dotX, y - dotY) <= dotR;
      const c = ring || dot ? WHITE : INK;
      const o = ((y / SS | 0) * size + (x / SS | 0)) * 4;
      px[o] += c[0]; px[o + 1] += c[1]; px[o + 2] += c[2]; px[o + 3] += 255;      // premultiplied by coverage below
    }
  }
  const out = Buffer.alloc(size * size * 4), area = SS * SS;
  for (let i = 0; i < size * size; i++) {
    const a = px[i * 4 + 3] / area;                        // coverage 0..255
    out[i * 4 + 3] = Math.round(a);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = a > 0 ? Math.round(px[i * 4 + k] / (px[i * 4 + 3] / 255)) : 0;
  }
  return out;
}

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const rgba = render(size), raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;       // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("icons", { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`icons/icon-${s}.png`, png(s));
console.log("wrote icons/icon-16.png, 32, 48, 128");
