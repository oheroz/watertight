// Render planar cross-sections of STL files as a PNG, the way a slicer sees them: solid = dark, empty = white.
// node tools/section_png.js out.png axis pos(0..1) width file1.stl [file2.stl ...]   (files side by side)
// axis 0/1/2 = x/y/z, pos = where along that axis (0..1 of each file's extent), width = pixels per panel;
// CROP=u0,u1,w0,w1 limits the view (model units, u = the next axis after the cut axis, w = the one after that)
const fs = require('fs'), zlib = require('zlib'), E = require('../src/engine.js');
const [out, axisS, posS, widthS, ...files] = process.argv.slice(2);
const axis = Number(axisS), pos = Number(posS), W = Number(widthS) || 600;
const u = (axis + 1) % 3, w = (axis + 2) % 3;           // image x = coordinate w (right), image y = coordinate u (down = -u)
const load = (f) => { const b = fs.readFileSync(f); const p = E.parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); return p; };
const panels = files.map((f) => {
  const p = load(f), T = p.tris, n = p.count;
  let mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
  for (let i = 0; i < n * 9; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], T[i + k]); mx[k] = Math.max(mx[k], T[i + k]); }
  const c = mn[axis] + (mx[axis] - mn[axis]) * pos + 1e-7 * (mx[axis] - mn[axis]);
  const segs = [];
  for (let t = 0; t < n; t++) {
    const P = [0, 1, 2].map((q) => [T[t * 9 + q * 3], T[t * 9 + q * 3 + 1], T[t * 9 + q * 3 + 2]]);
    const d = P.map((q) => q[axis] - c); const pts = [];
    for (let q = 0; q < 3; q++) { const a = P[q], b = P[(q + 1) % 3], da = d[q], db = d[(q + 1) % 3]; if ((da < 0) !== (db < 0)) { const s = da / (da - db); pts.push([a[u] + (b[u] - a[u]) * s, a[w] + (b[w] - a[w]) * s]); } }
    if (pts.length === 2) segs.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
  }
  return { f, segs, mn, mx, c };
});
let U0 = Math.min(...panels.map((p) => p.mn[u])), U1 = Math.max(...panels.map((p) => p.mx[u]));
let W0 = Math.min(...panels.map((p) => p.mn[w])), W1 = Math.max(...panels.map((p) => p.mx[w]));
if (process.env.CROP) [U0, U1, W0, W1] = process.env.CROP.split(',').map(Number);   // CROP=u0,u1,w0,w1 in model units
const scale = W / (W1 - W0), H = Math.ceil((U1 - U0) * scale), gap = 20, TW = panels.length * W + (panels.length - 1) * gap;
const img = Buffer.alloc(TW * H * 3, 255);
panels.forEach((pn, pi) => {
  // even-odd fill per image row: crossings of the section outline with the row's centre line
  for (let y = 0; y < H; y++) {
    const U = U1 - (y + 0.5) / scale, xs = [];
    for (let s = 0; s < pn.segs.length; s += 4) { const a0 = pn.segs[s], b0 = pn.segs[s + 1], a1 = pn.segs[s + 2], b1 = pn.segs[s + 3]; if ((a0 < U) !== (a1 < U)) xs.push(b0 + (b1 - b0) * (U - a0) / (a1 - a0)); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const x0 = Math.max(0, Math.round((xs[k] - W0) * scale)), x1 = Math.min(W, Math.round((xs[k + 1] - W0) * scale)); for (let x = x0; x < x1; x++) { const o = (y * TW + pi * (W + gap) + x) * 3; img[o] = 60; img[o + 1] = 70; img[o + 2] = 90; } }
  }
  // outline in red
  for (let s = 0; s < pn.segs.length; s += 4) { const L = Math.ceil(Math.hypot(pn.segs[s + 2] - pn.segs[s], pn.segs[s + 3] - pn.segs[s + 1]) * scale) + 1; for (let q = 0; q <= L; q++) { const a = pn.segs[s] + (pn.segs[s + 2] - pn.segs[s]) * q / L, b = pn.segs[s + 1] + (pn.segs[s + 3] - pn.segs[s + 1]) * q / L; const x = Math.floor((b - W0) * scale), y = Math.floor((U1 - a) * scale); if (x >= 0 && x < W && y >= 0 && y < H) { const o = (y * TW + pi * (W + gap) + x) * 3; img[o] = 220; img[o + 1] = 40; img[o + 2] = 40; } } }
});
// PNG
const raw = Buffer.alloc((TW * 3 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (TW * 3 + 1)] = 0; img.copy(raw, y * (TW * 3 + 1) + 1, y * TW * 3, (y + 1) * TW * 3); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(TW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, TW + 'x' + H, panels.map((p) => `${p.f.split('/').pop()} cut at ${'xyz'[axis]}=${p.c.toFixed(3)}`).join(' | '));
