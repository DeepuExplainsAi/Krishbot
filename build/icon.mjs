// Writes a plain 512x512 PNG icon (no dependencies).
import fs from 'node:fs';
import zlib from 'node:zlib';
const N = 512, raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const o = y * (N * 4 + 1) + 1 + x * 4, dx = x - N / 2, dy = y - N / 2, r = Math.hypot(dx, dy);
    const eye = Math.hypot(Math.abs(dx) - 80, dy + 20) < 34;
    const bg = r < 230;
    const c = !bg ? [0, 0, 0, 0] : eye ? [255, 255, 255, 255] : [79, 70, 229, 255];
    raw.set(c, o);
  }
}
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let v = 0xffffffff; for (const x of b) v = t[(v ^ x) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
