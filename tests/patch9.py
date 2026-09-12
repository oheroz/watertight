p='src/engine.js'; s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (s.count(old), old[:90])
    s=s.replace(old,new)

# --- nestingDepths: per-pair "all test points inside", grazing points excluded, 10 test points
start = s.index("/* nesting depth of closed components via +x ray casting on a (y,z) grid */")
end = s.index("/* decide per component whether the whole component must be flipped")
new_fn = r'''/* nesting depth of closed components via +x ray casting on a (y,z) grid.
   A shell counts as inside another only if every one of its test points (6 extremes + 4 spread
   vertices) is inside; points whose ray starts on the other shell's surface are ignored. */
function nestingDepths(mesh, comp, ncomp, closed) {
  const depth = new Int32Array(ncomp);
  let nClosed = 0; for (let c = 0; c < ncomp; c++) if (closed[c]) nClosed++;
  if (nClosed < 2) return depth;
  const nf = mesh.nf, F = mesh.F, V = mesh.V, dead = mesh.dead;
  const NP = 10;
  const ext = new Float64Array(ncomp * 6), tp = new Float64Array(ncomp * NP * 3), tpSet = new Uint8Array(ncomp * NP);
  for (let c = 0; c < ncomp; c++) for (let k = 0; k < 3; k++) { ext[c * 6 + k] = Infinity; ext[c * 6 + 3 + k] = -Infinity; }
  const fcount = new Int32Array(ncomp), fseen = new Int32Array(ncomp);
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity, nCF = 0;
  for (let f = 0; f < nf; f++) { if (dead[f]) continue; const c = comp[f]; if (c < 0 || !closed[c]) continue; fcount[c]++; nCF++; }
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue; const c = comp[f]; if (c < 0 || !closed[c]) continue;
    const seen = fseen[c]++;
    for (let q = 0; q < 4; q++) if (seen === Math.floor(q * fcount[c] / 4)) { const v = F[f * 3] * 3; const o = (c * NP + 6 + q) * 3; tp[o] = V[v]; tp[o + 1] = V[v + 1]; tp[o + 2] = V[v + 2]; tpSet[c * NP + 6 + q] = 1; }
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k] * 3, x = V[v], y = V[v + 1], z = V[v + 2];
      for (let ax = 0; ax < 3; ax++) {
        const val = V[v + ax];
        if (val < ext[c * 6 + ax]) { ext[c * 6 + ax] = val; const o = (c * NP + ax) * 3; tp[o] = x; tp[o + 1] = y; tp[o + 2] = z; tpSet[c * NP + ax] = 1; }
        if (val > ext[c * 6 + 3 + ax]) { ext[c * 6 + 3 + ax] = val; const o = (c * NP + 3 + ax) * 3; tp[o] = x; tp[o + 1] = y; tp[o + 2] = z; tpSet[c * NP + 3 + ax] = 1; }
      }
      if (y < ymin) ymin = y; if (y > ymax) ymax = y; if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    }
  }
  const res = Math.max(1, Math.min(400, Math.round(Math.sqrt(nCF / 4))));
  const sy = (ymax - ymin) || 1, sz = (zmax - zmin) || 1;
  const cell = (y, z) => {
    let i = Math.floor((y - ymin) / sy * res), j = Math.floor((z - zmin) / sz * res);
    if (i < 0) i = 0; if (i >= res) i = res - 1; if (j < 0) j = 0; if (j >= res) j = res - 1; return i * res + j;
  };
  const ncell = res * res;
  const cellCount = new Int32Array(ncell + 1);
  const fmin = new Int32Array(nf * 2), fmax = new Int32Array(nf * 2);
  for (let f = 0; f < nf; f++) {
    if (dead[f] || comp[f] < 0 || !closed[comp[f]]) continue;
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) { const v = F[f * 3 + k] * 3; const y = V[v + 1], z = V[v + 2]; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const c0 = cell(y0, z0), c1 = cell(y1, z1);
    const i0 = (c0 / res) | 0, j0 = c0 % res, i1 = (c1 / res) | 0, j1 = c1 % res;
    fmin[f * 2] = i0; fmin[f * 2 + 1] = j0; fmax[f * 2] = i1; fmax[f * 2 + 1] = j1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cellCount[i * res + j + 1]++;
  }
  for (let i = 0; i < ncell; i++) cellCount[i + 1] += cellCount[i];
  const items = new Int32Array(cellCount[ncell]); const fill = cellCount.slice(0, ncell);
  for (let f = 0; f < nf; f++) {
    if (dead[f] || comp[f] < 0 || !closed[comp[f]]) continue;
    for (let i = fmin[f * 2]; i <= fmax[f * 2]; i++) for (let j = fmin[f * 2 + 1]; j <= fmax[f * 2 + 1]; j++) items[fill[i * res + j]++] = f;
  }
  const hits = new Int32Array(ncomp), graze = new Uint8Array(ncomp), touched = [];
  const insideCnt = new Int32Array(ncomp), grazeCnt = new Int32Array(ncomp), pairTouched = [];
  const jit = 1e-7 * Math.max(sy, sz), grazeEps = 1e-6 * Math.max(sy, sz, 1e-300);
  for (let c = 0; c < ncomp; c++) {
    if (!closed[c]) continue;
    let np = 0;
    for (let q = 0; q < NP; q++) {
      if (!tpSet[c * NP + q]) continue; np++;
      const o = (c * NP + q) * 3;
      const px = tp[o], py = tp[o + 1] + jit * 1.7, pz = tp[o + 2] + jit * 0.9;
      const cid = cell(py, pz);
      for (let it = cellCount[cid]; it < cellCount[cid + 1]; it++) {
        const f = items[it]; const fc = comp[f]; if (fc === c) continue;
        const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, d = F[f * 3 + 2] * 3;
        const ay = V[a + 1], az = V[a + 2], by = V[b + 1], bz = V[b + 2], cy = V[d + 1], cz = V[d + 2];
        const d1 = (by - ay) * (pz - az) - (bz - az) * (py - ay);
        const d2 = (cy - by) * (pz - bz) - (cz - bz) * (py - by);
        const d3 = (ay - cy) * (pz - cz) - (az - cz) * (py - cy);
        if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
        const ax = V[a], bx = V[b], cx = V[d];
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(nx) < 1e-300) continue;
        const x = ax - (ny * (py - ay) + nz * (pz - az)) / nx;
        if (hits[fc] === 0 && !graze[fc]) touched.push(fc);
        if (Math.abs(x - px) <= grazeEps) graze[fc] = 1; else if (x > px) hits[fc]++;
      }
      for (let i = 0; i < touched.length; i++) {
        const b = touched[i];
        if (insideCnt[b] === 0 && grazeCnt[b] === 0) pairTouched.push(b);
        if (graze[b]) grazeCnt[b]++; else if (hits[b] & 1) insideCnt[b]++;
        hits[b] = 0; graze[b] = 0;
      }
      touched.length = 0;
    }
    let dpt = 0;
    for (let i = 0; i < pairTouched.length; i++) {
      const b = pairTouched[i]; const known = np - grazeCnt[b];
      if (known > 0 && insideCnt[b] === known) dpt++;
      insideCnt[b] = 0; grazeCnt[b] = 0;
    }
    pairTouched.length = 0; depth[c] = dpt;
  }
  return depth;
}

'''
s = s[:start] + new_fn + s[end:]

# --- componentOrientation: per-component area, always computed
rep("""  const closed = new Uint8Array(ncomp).fill(1);
  const vol = new Float64Array(ncomp), vote = new Float64Array(ncomp);
  const n = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue; const c = comp[f]; if (c < 0) continue;
    const sgn = flip[f] ? -1 : 1;
    for (let k = 0; k < 3; k++) if (opp[f * 3 + k] < 0) { closed[c] = 0; break; }
    vol[c] += sgn * det3(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
    if (storedNormals && src[f] >= 0) {
      faceNormalInto(V, F, f, n); const s = src[f] * 3;
      vote[c] += sgn * (n[0] * storedNormals[s] + n[1] * storedNormals[s + 1] + n[2] * storedNormals[s + 2]);
    }
  }""",
"""  const closed = new Uint8Array(ncomp).fill(1);
  const vol = new Float64Array(ncomp), vote = new Float64Array(ncomp), area = new Float64Array(ncomp);
  const n = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue; const c = comp[f]; if (c < 0) continue;
    const sgn = flip[f] ? -1 : 1;
    for (let k = 0; k < 3; k++) if (opp[f * 3 + k] < 0) { closed[c] = 0; break; }
    vol[c] += sgn * det3(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
    area[c] += faceNormalInto(V, F, f, n);
    if (storedNormals && src[f] >= 0) {
      const s = src[f] * 3;
      vote[c] += sgn * (n[0] * storedNormals[s] + n[1] * storedNormals[s + 1] + n[2] * storedNormals[s + 2]);
    }
  }""")
rep("""  return { compFlip, closed, vol, depth };""", """  return { compFlip, closed, vol, depth, area };""")

# --- zero-volume shells: scale-free criterion
rep("""    const zeroThresh = 1e-9 * diag * diag * diag;
    const kill = new Uint8Array(comps.count); let zero = 0, small = 0;
    for (let c = 0; c < comps.count; c++) {
      const vol = Math.abs(co.vol[c]) / 6;
      if (opts.removeZeroVolumeShells && co.closed[c] && vol < zeroThresh && comps.count > 1) { kill[c] = 1; zero++; continue; }""",
"""    const kill = new Uint8Array(comps.count); let zero = 0, small = 0;
    for (let c = 0; c < comps.count; c++) {
      const vol = Math.abs(co.vol[c]) / 6;
      // a double-sided sheet has (almost) no volume for its surface area; a real thin part still has some
      const zeroVol = vol < 1e-4 * Math.pow(co.area[c], 1.5);
      if (opts.removeZeroVolumeShells && co.closed[c] && zeroVol && comps.count > 1) { kill[c] = 1; zero++; continue; }""")
open(p,'w',encoding='utf-8').write(s); print('ok')
