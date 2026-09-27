#!/usr/bin/env node
/* Compare the solid material of two STL files on a sample grid.

   node tools/compare_solid.js before.stl after.stl [step]

   Reports how much material only the first file has (lost) and how much only the second has (added), with the
   places where lost material clusters. A repair that fills hollows should add material and lose none.
   step is the grid spacing in model units (default: 1/400 of the longest side).
*/
'use strict';
const fs = require('fs');
const E = require('../src/engine.js');

const [fa, fb, stepArg] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: node tools/compare_solid.js before.stl after.stl [step]'); process.exit(1); }
const load = (f) => {
  const b = fs.readFileSync(f); const p = E.parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const m = E.weldExact(p.tris, p.count); m.dead = new Uint8Array(m.nf); return m;
};
const A = load(fa), B = load(fb);
const WA = E.windingIndex(A.V, A.F, A.nf, A.dead), WB = E.windingIndex(B.V, B.F, B.nf, B.dead);
const bb = E.bbox(A.V, A.nv), bb2 = E.bbox(B.V, B.nv);
const lo = [0, 1, 2].map((k) => Math.min(bb.min[k], bb2.min[k])), hi = [0, 1, 2].map((k) => Math.max(bb.max[k], bb2.max[k]));
const h = Number(stepArg) || Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 400;
let solidA = 0, lost = 0, added = 0; const where = new Map(), cell = h * 25;
for (let x = lo[0] + h / 2; x < hi[0]; x += h) for (let y = lo[1] + h / 2; y < hi[1]; y += h) for (let z = lo[2] + h / 2; z < hi[2]; z += h) {
  // a hair off the grid so no sample sits exactly on an axis-aligned face
  const X = x + 1.3e-7 * h, Y = y + 2.7e-7 * h, Z = z + 3.1e-7 * h;
  const a = WA.at(X, Y, Z) >= 1, b = WB.at(X, Y, Z) >= 1;
  if (a) solidA++;
  if (a && !b) { lost++; const k = [X, Y, Z].map((t) => (Math.round(t / cell) * cell).toFixed(2)).join(', '); where.set(k, (where.get(k) || 0) + 1); } else if (b && !a) added++;
}
const v = h * h * h;
console.log(`grid step ${h.toPrecision(3)}: first file solid ${(solidA * v).toPrecision(6)}`);
console.log(`lost (only in ${fa}): ${(lost * v).toPrecision(4)} volume, ${lost} samples`);
console.log(`added (only in ${fb}): ${(added * v).toPrecision(4)} volume, ${added} samples`);
for (const [k, n] of [...where].sort((p, q) => q[1] - p[1]).slice(0, 8)) console.log(`  lost near (${k}): ${n} samples`);
