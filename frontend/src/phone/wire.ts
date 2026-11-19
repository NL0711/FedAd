// Wire format of one model update, byte-compatible with backend/src/fedad/aggregation/compress.py (encode/decode):
//   zlib( '<IIB' header (size u32, nonzero count u32, gap itemsize u8) + gaps (uint16, or uint32 if size >= 65536)
//         + float16 values of the nonzero entries )
// gaps are the differences of the sorted nonzero indices with a prepended -1. The zlib stream uses STORED deflate blocks
// (no compression): valid zlib that Python's zlib.decompress accepts, and it needs no CompressionStream, which is missing
// on older phones and on non-secure (plain HTTP LAN) pages.

const f64 = new DataView(new ArrayBuffer(8));

/** IEEE 754 binary16 bits of a float64, round to nearest even (what numpy's astype(float16) does). */
export function toHalfBits(x: number): number {
  if (Number.isNaN(x)) return 0x7e00;
  f64.setFloat64(0, x);
  const hi = f64.getUint32(0);
  const lo = f64.getUint32(4);
  const sign = (hi >>> 31) << 15;
  const exp = (hi >>> 20) & 0x7ff;
  if (exp === 0x7ff) return sign | 0x7c00 | (((hi & 0xfffff) | lo) !== 0 ? 0x200 : 0);
  if (exp === 0) return sign;
  const e = exp - 1023;
  if (e > 15) return sign | 0x7c00;
  if (e < -25) return sign;
  const full = (1n << 52n) | (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const shift = e >= -14 ? 42n : BigInt(42 + (-14 - e));
  let mant = full >> shift;
  const rem = full & ((1n << shift) - 1n);
  const half = 1n << (shift - 1n);
  if (rem > half || (rem === half && (mant & 1n) === 1n)) mant += 1n;
  let bits: number;
  if (e >= -14) bits = ((e + 15) << 10) + (Number(mant) - 1024);
  else bits = Number(mant);
  if (bits >= 0x7c00) return sign | 0x7c00;
  return sign | bits;
}

export function adler32(d: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    a = (a + d[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A valid zlib stream holding ``raw`` in stored (uncompressed) deflate blocks. */
export function zlibStored(raw: Uint8Array): Uint8Array {
  const nBlocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78;
  out[o++] = 0x01;
  for (let b = 0; b < nBlocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = b === nBlocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = ad >>> 24;
  out[o++] = (ad >>> 16) & 0xff;
  out[o++] = (ad >>> 8) & 0xff;
  out[o++] = ad & 0xff;
  return out;
}

/** Encode the nonzero entries of ``v`` exactly like compress.encode. */
export function encodeUpdate(v: Float64Array): Uint8Array {
  const idx: number[] = [];
  for (let i = 0; i < v.length; i++) if (v[i] !== 0) idx.push(i);
  const wide = v.length >= 65536;
  const isz = wide ? 4 : 2;
  const raw = new Uint8Array(9 + idx.length * isz + idx.length * 2);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0, v.length, true);
  dv.setUint32(4, idx.length, true);
  dv.setUint8(8, isz);
  let o = 9;
  let prev = -1;
  for (const i of idx) {
    if (wide) dv.setUint32(o, i - prev, true);
    else dv.setUint16(o, i - prev, true);
    o += isz;
    prev = i;
  }
  for (const i of idx) {
    dv.setUint16(o, toHalfBits(v[i]), true);
    o += 2;
  }
  return zlibStored(raw);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
