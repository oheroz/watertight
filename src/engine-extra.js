/* ----------------------------------------------------------- vertex->faces */
function vertexFaces(mesh) {
  const nf = mesh.nf, F = mesh.F, dead = mesh.dead, nv = mesh.nv;
  const start = new Int32Array(nv + 1);
  for (let f = 0; f < nf; f++) { if (dead[f]) continue; start[F[f * 3] + 1]++; start[F[f * 3 + 1] + 1]++; start[F[f * 3 + 2] + 1]++; }
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const items = new Int32Array(start[nv]); const fill = start.slice(0, nv);
  for (let f = 0; f < nf; f++) { if (dead[f]) continue; items[fill[F[f * 3]]++] = f; items[fill[F[f * 3 + 1]]++] = f; items[fill[F[f * 3 + 2]]++] = f; }
  return { start, items };
}
function minAltitude(V, a, b, c) {
  const ax = V[a * 3], ay = V[a * 3 + 1], az = V[a * 3 + 2], bx = V[b * 3], by = V[b * 3 + 1], bz = V[b * 3 + 2], cx = V[c * 3], cy = V[c * 3 + 1], cz = V[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  const longest = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(cx - bx, cy - by, cz - bz));
  return longest > 0 ? area2 / longest : 0;
}

/* ----------------------------------------------------------- sliver removal */
/* Final pass for thin faces that survived the main loop: flip the long edge of a
   collinear face into its neighbour (this is what a T-junction split does, applied
   where it can improve the shape), or collapse a very short edge when no face folds. */
function removeSlivers(mesh, degTol, diag, maxRounds) {
  let flips = 0, collapses = 0;
  const collapseTol = Math.max(degTol * 4, 5e-5 * diag);
  const nrm = [0, 0, 0];
  for (let round = 0; round < maxRounds; round++) {
    mesh.compact();
    const topo = buildTopology(mesh);
    const dg = classifyDegenerate(mesh, degTol);
    if (!dg.needles.length && !dg.caps.length) break;
    if (dg.needles.length) { collapseNeedles(mesh, dg.needles); collapses += dg.needles.length / 3; continue; }
    const F = mesh.F, V = mesh.V;
    const touched = new Uint8Array(mesh.nf);
    let progress = 0;
    const adj = vertexFaces(mesh);
    const faceNormal = (f, out) => faceNormalInto(V, F, f, out);
    for (let i = 0; i < dg.caps.length; i += 2) {
      const f = dg.caps[i], k = dg.caps[i + 1];
      if (mesh.dead[f] || touched[f]) continue;
      const a = F[f * 3 + k], b = F[f * 3 + (k === 2 ? 0 : k + 1)], c = F[f * 3 + (k === 0 ? 2 : k - 1)];
      const h0 = minAltitude(V, a, b, c);
      const s = f * 3 + k, o = topo.opp[s];
      let done = false;
      if (o >= 0) {
        const g = (o / 3) | 0, ok2 = o % 3;
        if (!mesh.dead[g] && !touched[g]) {
          const d = F[g * 3 + (ok2 === 0 ? 2 : ok2 - 1)];
          if (d !== c && topo.findEdge(c, d) < 0) {
            const h1 = minAltitude(V, b, c, d), h2 = minAltitude(V, c, a, d);
            const hm = Math.min(h1, h2);
            if (hm >= degTol || hm > 2 * h0) {
              touched[f] = 1; touched[g] = 1; mesh.killFace(f); splitFaceEdge(mesh, g, ok2, [c]); flips++; progress++; done = true;
            }
          }
        }
      }
      if (done) continue;
      // collapse the shorter of the apex edges if it is tiny and no neighbour folds
      const lac = Math.hypot(V[c * 3] - V[a * 3], V[c * 3 + 1] - V[a * 3 + 1], V[c * 3 + 2] - V[a * 3 + 2]);
      const lcb = Math.hypot(V[c * 3] - V[b * 3], V[c * 3 + 1] - V[b * 3 + 1], V[c * 3 + 2] - V[b * 3 + 2]);
      const w = lac < lcb ? a : b, L = Math.min(lac, lcb);
      if (L >= collapseTol) continue;
      let ok = true; const before = [0, 0, 0];
      for (let j = adj.start[c]; j < adj.start[c + 1] && ok; j++) {
        const g = adj.items[j]; if (mesh.dead[g] || touched[g]) { if (touched[g]) ok = false; continue; }
        const g0 = F[g * 3], g1 = F[g * 3 + 1], g2 = F[g * 3 + 2];
        if (g0 === w || g1 === w || g2 === w) continue; // dies with the collapse
        faceNormal(g, before);
        const n0 = g0 === c ? w : g0, n1 = g1 === c ? w : g1, n2 = g2 === c ? w : g2;
        // normal after
        const ux = V[n1 * 3] - V[n0 * 3], uy = V[n1 * 3 + 1] - V[n0 * 3 + 1], uz = V[n1 * 3 + 2] - V[n0 * 3 + 2];
        const vx = V[n2 * 3] - V[n0 * 3], vy = V[n2 * 3 + 1] - V[n0 * 3 + 1], vz = V[n2 * 3 + 2] - V[n0 * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 0 && (nx * before[0] + ny * before[1] + nz * before[2]) / nl < 0.2) ok = false;
      }
      if (!ok) continue;
      for (let j = adj.start[c]; j < adj.start[c + 1]; j++) {
        const g = adj.items[j]; if (mesh.dead[g]) continue;
        for (let q = 0; q < 3; q++) if (F[g * 3 + q] === c) F[g * 3 + q] = w;
        touched[g] = 1;
        if (F[g * 3] === F[g * 3 + 1] || F[g * 3 + 1] === F[g * 3 + 2] || F[g * 3] === F[g * 3 + 2]) mesh.killFace(g);
      }
      collapses++; progress++;
    }
    if (!progress) break;
  }
  mesh.compact();
  return { flips, collapses };
}

/* ------------------------------------------------------ self-intersections */
function triTriIntersect(V, a0, a1, a2, b0, b1, b2, eps) {
  const p = (i, k) => V[i * 3 + k];
  // plane of B
  let e1x = p(b1, 0) - p(b0, 0), e1y = p(b1, 1) - p(b0, 1), e1z = p(b1, 2) - p(b0, 2);
  let e2x = p(b2, 0) - p(b0, 0), e2y = p(b2, 1) - p(b0, 1), e2z = p(b2, 2) - p(b0, 2);
  const n2x = e1y * e2z - e1z * e2y, n2y = e1z * e2x - e1x * e2z, n2z = e1x * e2y - e1y * e2x;
  const n2l = Math.hypot(n2x, n2y, n2z); if (n2l === 0) return false;
  const d2 = -(n2x * p(b0, 0) + n2y * p(b0, 1) + n2z * p(b0, 2));
  const tol2 = eps * n2l;
  let da0 = n2x * p(a0, 0) + n2y * p(a0, 1) + n2z * p(a0, 2) + d2; if (Math.abs(da0) < tol2) da0 = 0;
  let da1 = n2x * p(a1, 0) + n2y * p(a1, 1) + n2z * p(a1, 2) + d2; if (Math.abs(da1) < tol2) da1 = 0;
  let da2 = n2x * p(a2, 0) + n2y * p(a2, 1) + n2z * p(a2, 2) + d2; if (Math.abs(da2) < tol2) da2 = 0;
  if ((da0 > 0 && da1 > 0 && da2 > 0) || (da0 < 0 && da1 < 0 && da2 < 0)) return false;
  if (da0 === 0 && da1 === 0 && da2 === 0) return false; // coplanar: ignored
  // plane of A
  e1x = p(a1, 0) - p(a0, 0); e1y = p(a1, 1) - p(a0, 1); e1z = p(a1, 2) - p(a0, 2);
  e2x = p(a2, 0) - p(a0, 0); e2y = p(a2, 1) - p(a0, 1); e2z = p(a2, 2) - p(a0, 2);
  const n1x = e1y * e2z - e1z * e2y, n1y = e1z * e2x - e1x * e2z, n1z = e1x * e2y - e1y * e2x;
  const n1l = Math.hypot(n1x, n1y, n1z); if (n1l === 0) return false;
  const d1 = -(n1x * p(a0, 0) + n1y * p(a0, 1) + n1z * p(a0, 2));
  const tol1 = eps * n1l;
  let db0 = n1x * p(b0, 0) + n1y * p(b0, 1) + n1z * p(b0, 2) + d1; if (Math.abs(db0) < tol1) db0 = 0;
  let db1 = n1x * p(b1, 0) + n1y * p(b1, 1) + n1z * p(b1, 2) + d1; if (Math.abs(db1) < tol1) db1 = 0;
  let db2 = n1x * p(b2, 0) + n1y * p(b2, 1) + n1z * p(b2, 2) + d1; if (Math.abs(db2) < tol1) db2 = 0;
  if ((db0 > 0 && db1 > 0 && db2 > 0) || (db0 < 0 && db1 < 0 && db2 < 0)) return false;
  // intersection line direction, pick the dominant axis
  const Dx = n1y * n2z - n1z * n2y, Dy = n1z * n2x - n1x * n2z, Dz = n1x * n2y - n1y * n2x;
  let axis = 0, m = Math.abs(Dx); if (Math.abs(Dy) > m) { m = Math.abs(Dy); axis = 1; } if (Math.abs(Dz) > m) axis = 2;
  const iv = (vp0, vp1, vp2, d0, d1, d2) => {
    if (d0 * d1 > 0) return [vp2 + (vp0 - vp2) * d2 / (d2 - d0), vp2 + (vp1 - vp2) * d2 / (d2 - d1)];
    if (d0 * d2 > 0) return [vp1 + (vp0 - vp1) * d1 / (d1 - d0), vp1 + (vp2 - vp1) * d1 / (d1 - d2)];
    if (d1 * d2 > 0 || d0 !== 0) return [vp0 + (vp1 - vp0) * d0 / (d0 - d1), vp0 + (vp2 - vp0) * d0 / (d0 - d2)];
    if (d1 !== 0) return [vp1 + (vp0 - vp1) * d1 / (d1 - d0), vp1 + (vp2 - vp1) * d1 / (d1 - d2)];
    if (d2 !== 0) return [vp2 + (vp0 - vp2) * d2 / (d2 - d0), vp2 + (vp1 - vp2) * d2 / (d2 - d1)];
    return null;
  };
  const ia = iv(p(a0, axis), p(a1, axis), p(a2, axis), da0, da1, da2); if (!ia) return false;
  const ib = iv(p(b0, axis), p(b1, axis), p(b2, axis), db0, db1, db2); if (!ib) return false;
  const a_lo = Math.min(ia[0], ia[1]), a_hi = Math.max(ia[0], ia[1]), b_lo = Math.min(ib[0], ib[1]), b_hi = Math.max(ib[0], ib[1]);
  return Math.max(a_lo, b_lo) < Math.min(a_hi, b_hi) - eps;
}

function findSelfIntersections(mesh, maxList) {
  const nf = mesh.nf, F = mesh.F, V = mesh.V, dead = mesh.dead;
  let alive = 0; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const fb = new Float64Array(nf * 6);
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue; alive++;
    for (let k = 0; k < 3; k++) { fb[f * 6 + k] = Infinity; fb[f * 6 + 3 + k] = -Infinity; }
    for (let c = 0; c < 3; c++) { const v = F[f * 3 + c] * 3; for (let k = 0; k < 3; k++) { const x = V[v + k]; if (x < fb[f * 6 + k]) fb[f * 6 + k] = x; if (x > fb[f * 6 + 3 + k]) fb[f * 6 + 3 + k] = x; } }
    for (let k = 0; k < 3; k++) { if (fb[f * 6 + k] < mn[k]) mn[k] = fb[f * 6 + k]; if (fb[f * 6 + 3 + k] > mx[k]) mx[k] = fb[f * 6 + 3 + k]; }
  }
  if (alive < 2) return { pairs: 0, faces: new Uint32Array(0) };
  const ex = [Math.max(mx[0] - mn[0], 1e-9), Math.max(mx[1] - mn[1], 1e-9), Math.max(mx[2] - mn[2], 1e-9)];
  const diag = Math.hypot(ex[0], ex[1], ex[2]);
  const targetCells = Math.max(1, alive / 3);
  const base = Math.cbrt(targetCells / (ex[0] * ex[1] * ex[2]));
  const res = [0, 1, 2].map((k) => Math.max(1, Math.min(200, Math.ceil(ex[k] * base))));
  const hs = [ex[0] / res[0], ex[1] / res[1], ex[2] / res[2]];
  const cellOf = (x, k) => { let c = Math.floor((x - mn[k]) / hs[k]); if (c < 0) c = 0; if (c >= res[k]) c = res[k] - 1; return c; };
  const ncell = res[0] * res[1] * res[2];
  const count = new Int32Array(ncell + 1);
  const lo = new Int32Array(nf * 3), hi = new Int32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue;
    for (let k = 0; k < 3; k++) { lo[f * 3 + k] = cellOf(fb[f * 6 + k], k); hi[f * 3 + k] = cellOf(fb[f * 6 + 3 + k], k); }
    for (let i = lo[f * 3]; i <= hi[f * 3]; i++) for (let j = lo[f * 3 + 1]; j <= hi[f * 3 + 1]; j++) for (let k = lo[f * 3 + 2]; k <= hi[f * 3 + 2]; k++) count[(i * res[1] + j) * res[2] + k + 1]++;
  }
  for (let c = 0; c < ncell; c++) count[c + 1] += count[c];
  const items = new Int32Array(count[ncell]); const fill = count.slice(0, ncell);
  for (let f = 0; f < nf; f++) {
    if (dead[f]) continue;
    for (let i = lo[f * 3]; i <= hi[f * 3]; i++) for (let j = lo[f * 3 + 1]; j <= hi[f * 3 + 1]; j++) for (let k = lo[f * 3 + 2]; k <= hi[f * 3 + 2]; k++) items[fill[(i * res[1] + j) * res[2] + k]++] = f;
  }
  const eps = 1e-9 * diag;
  const hit = new Uint8Array(nf); let pairs = 0; let budget = 6e7;
  for (let c = 0; c < ncell && budget > 0; c++) {
    const ci = (c / (res[1] * res[2])) | 0, cj = ((c / res[2]) | 0) % res[1], ck = c % res[2];
    const s = count[c], e = count[c + 1];
    for (let p = s; p < e; p++) {
      const f = items[p];
      for (let q = p + 1; q < e; q++) {
        const g = items[q]; budget--;
        // bbox overlap
        if (fb[f * 6] > fb[g * 6 + 3] || fb[g * 6] > fb[f * 6 + 3] || fb[f * 6 + 1] > fb[g * 6 + 4] || fb[g * 6 + 1] > fb[f * 6 + 4] || fb[f * 6 + 2] > fb[g * 6 + 5] || fb[g * 6 + 2] > fb[f * 6 + 5]) continue;
        // test each pair once: in the cell holding the min corner of the overlap box
        if (Math.max(lo[f * 3], lo[g * 3]) !== ci || Math.max(lo[f * 3 + 1], lo[g * 3 + 1]) !== cj || Math.max(lo[f * 3 + 2], lo[g * 3 + 2]) !== ck) continue;
        const a0 = F[f * 3], a1 = F[f * 3 + 1], a2 = F[f * 3 + 2], b0 = F[g * 3], b1 = F[g * 3 + 1], b2 = F[g * 3 + 2];
        if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) continue;
        if (triTriIntersect(V, a0, a1, a2, b0, b1, b2, eps)) { pairs++; hit[f] = 1; hit[g] = 1; }
      }
    }
  }
  const faces = []; for (let f = 0; f < nf && faces.length < (maxList || 200000); f++) if (hit[f]) faces.push(f);
  return { pairs, faces: Uint32Array.from(faces), truncated: budget <= 0 };
}

/* ----------------------------------------------------------------- solidify */
/* Rebuild the model as one solid from a voxel classification. Inside/outside comes
   from the winding number along grid lines in all three axes (majority vote), and the
   exact crossing positions on grid edges are kept, so flat faces stay flat. The dual
   surface (surface nets) is then run through the normal repair so it is manifold. */
function solidify(mesh, resolution, prog) {
  const F = mesh.F, V = mesh.V, nf = mesh.nf, dead = mesh.dead;
  const bb = bbox(V, mesh.nv);
  const longest = Math.max(bb.size[0], bb.size[1], bb.size[2]) || 1;
  const N = Math.max(16, Math.min(320, resolution | 0 || 200));
  const h = longest / N, pad = 2;
  const frac = [0.2137, 0.3719, 0.1453];
  const org = [0, 1, 2].map((k) => bb.min[k] - (pad + frac[k]) * h);
  const dims = [0, 1, 2].map((k) => Math.ceil(bb.size[k] / h) + 2 * pad + 2);
  const [nx, ny, nz] = dims; const nn = nx * ny * nz;
  const votes = new Int8Array(nn);
  const tEdge = [new Uint8Array(nn), new Uint8Array(nn), new Uint8Array(nn)];
  const idx = (i, j, k) => (i * ny + j) * nz + k;
  const n = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    if (prog) prog('Rebuilding as solid (' + 'xyz'[axis] + ' rays)', 0.05 + axis * 0.2);
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const nu = dims[u], nw = dims[w], na = dims[axis];
    // bin faces by the node lines they cover in the (u,w) plane
    const cnt = new Int32Array(nu * nw + 1);
    const rng = new Int32Array(nf * 4);
    for (let f = 0; f < nf; f++) {
      if (dead[f]) continue;
      let umin = Infinity, umax = -Infinity, wmin = Infinity, wmax = -Infinity;
      for (let c = 0; c < 3; c++) { const v = F[f * 3 + c] * 3; const a = V[v + u], b = V[v + w]; if (a < umin) umin = a; if (a > umax) umax = a; if (b < wmin) wmin = b; if (b > wmax) wmax = b; }
      const ju0 = Math.max(0, Math.ceil((umin - org[u]) / h)), ju1 = Math.min(nu - 1, Math.floor((umax - org[u]) / h));
      const jw0 = Math.max(0, Math.ceil((wmin - org[w]) / h)), jw1 = Math.min(nw - 1, Math.floor((wmax - org[w]) / h));
      rng[f * 4] = ju0; rng[f * 4 + 1] = ju1; rng[f * 4 + 2] = jw0; rng[f * 4 + 3] = jw1;
      for (let a = ju0; a <= ju1; a++) for (let b = jw0; b <= jw1; b++) cnt[a * nw + b + 1]++;
    }
    for (let c = 0; c < nu * nw; c++) cnt[c + 1] += cnt[c];
    const items = new Int32Array(cnt[nu * nw]); const fill = cnt.slice(0, nu * nw);
    for (let f = 0; f < nf; f++) { if (dead[f]) continue; for (let a = rng[f * 4]; a <= rng[f * 4 + 1]; a++) for (let b = rng[f * 4 + 2]; b <= rng[f * 4 + 3]; b++) items[fill[a * nw + b]++] = f; }
    // sweep every line
    let xs = new Float64Array(64), ss = new Int8Array(64);
    for (let a = 0; a < nu; a++) for (let b = 0; b < nw; b++) {
      const s0 = cnt[a * nw + b], s1 = cnt[a * nw + b + 1];
      const U = org[u] + a * h, W = org[w] + b * h;
      let m = 0;
      for (let p = s0; p < s1; p++) {
        const f = items[p];
        const v0 = F[f * 3] * 3, v1 = F[f * 3 + 1] * 3, v2 = F[f * 3 + 2] * 3;
        const a0 = V[v0 + u] - U, b0 = V[v0 + w] - W, a1 = V[v1 + u] - U, b1 = V[v1 + w] - W, a2 = V[v2 + u] - U, b2 = V[v2 + w] - W;
        const d1 = a0 * b1 - a1 * b0, d2 = a1 * b2 - a2 * b1, d3 = a2 * b0 - a0 * b2;
        if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
        faceNormalInto(V, F, f, n);
        const nA = n[axis]; if (Math.abs(nA) < 1e-12) continue;
        // barycentric position along the axis
        const tot = d1 + d2 + d3;
        const x = (V[v2 + axis] * d1 + V[v0 + axis] * d2 + V[v1 + axis] * d3) / tot;
        if (m === xs.length) { const nx2 = new Float64Array(m * 2); nx2.set(xs); xs = nx2; const ns2 = new Int8Array(m * 2); ns2.set(ss); ss = ns2; }
        xs[m] = x; ss[m] = nA > 0 ? -1 : 1; m++;
      }
      if (!m) continue;
      // sort crossings (insertion sort is fine for typical counts, fallback for many)
      if (m < 40) { for (let i = 1; i < m; i++) { const x = xs[i], s = ss[i]; let j = i - 1; while (j >= 0 && xs[j] > x) { xs[j + 1] = xs[j]; ss[j + 1] = ss[j]; j--; } xs[j + 1] = x; ss[j + 1] = s; } }
      else { const ord = Array.from({ length: m }, (_, i) => i).sort((p, q) => xs[p] - xs[q]); const x2 = new Float64Array(m), s2 = new Int8Array(m); for (let i = 0; i < m; i++) { x2[i] = xs[ord[i]]; s2[i] = ss[ord[i]]; } xs.set(x2); ss.set(s2); }
      let wnd = 0, p = 0, lastInside = false, lastTrans = -1;
      for (let i = 0; i < na; i++) {
        const X = org[axis] + i * h;
        while (p < m && xs[p] <= X) { const wasIn = wnd !== 0; wnd += ss[p]; const nowIn = wnd !== 0; if (wasIn !== nowIn) lastTrans = xs[p]; p++; }
        const inside = wnd !== 0;
        const node = axis === 0 ? idx(i, a, b) : axis === 1 ? idx(b, i, a) : idx(a, b, i);
        if (inside) votes[node]++;
        if (i > 0 && inside !== lastInside && lastTrans >= 0) {
          const prevNode = axis === 0 ? idx(i - 1, a, b) : axis === 1 ? idx(b, i - 1, a) : idx(a, b, i - 1);
          let t = (lastTrans - (X - h)) / h; if (t < 0) t = 0; if (t > 1) t = 1;
          tEdge[axis][prevNode] = 1 + Math.round(t * 254);
        }
        lastInside = inside;
      }
    }
  }
  if (prog) prog('Rebuilding as solid (surface)', 0.7);
  const inside = new Uint8Array(nn); for (let i = 0; i < nn; i++) inside[i] = votes[i] >= 2 ? 1 : 0;
  // surface nets: one vertex per mixed cell
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellV = new Int32Array(cx * cy * cz).fill(-1);
  const out = new Mesh(1024, 2048);
  const tOf = (axis, node) => { const q = tEdge[axis][node]; return q ? (q - 1) / 254 : 0.5; };
  const stride = [ny * nz, nz, 1];
  for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) for (let k = 0; k < cz; k++) {
    const n0 = idx(i, j, k);
    const c0 = inside[n0], c1 = inside[n0 + stride[0]], c2 = inside[n0 + stride[1]], c3 = inside[n0 + stride[0] + stride[1]];
    const c4 = inside[n0 + 1], c5 = inside[n0 + stride[0] + 1], c6 = inside[n0 + stride[1] + 1], c7 = inside[n0 + stride[0] + stride[1] + 1];
    const sum = c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7;
    if (sum === 0 || sum === 8) continue;
    let px = 0, py = 0, pz = 0, cntp = 0;
    const X = org[0] + i * h, Y = org[1] + j * h, Z = org[2] + k * h;
    // 12 edges: 4 along x, 4 along y, 4 along z
    const ex = [[0, 0, 0, c0, c1], [0, 1, 0, c2, c3], [0, 0, 1, c4, c5], [0, 1, 1, c6, c7]];
    for (const [_, dj, dk, s0, s1] of ex) if (s0 !== s1) { px += X + tOf(0, idx(i, j + dj, k + dk)) * h; py += Y + dj * h; pz += Z + dk * h; cntp++; }
    const ey = [[0, 0, 0, c0, c2], [1, 0, 0, c1, c3], [0, 0, 1, c4, c6], [1, 0, 1, c5, c7]];
    for (const [di, _, dk, s0, s1] of ey) if (s0 !== s1) { px += X + di * h; py += Y + tOf(1, idx(i + di, j, k + dk)) * h; pz += Z + dk * h; cntp++; }
    const ez = [[0, 0, 0, c0, c4], [1, 0, 0, c1, c5], [0, 1, 0, c2, c6], [1, 1, 0, c3, c7]];
    for (const [di, dj, _, s0, s1] of ez) if (s0 !== s1) { px += X + di * h; py += Y + dj * h; pz += Z + tOf(2, idx(i + di, j + dj, k)) * h; cntp++; }
    if (!cntp) continue;
    cellV[(i * cy + j) * cz + k] = out.addVertex(px / cntp, py / cntp, pz / cntp);
  }
  const cell = (i, j, k) => cellV[(i * cy + j) * cz + k];
  const quad = (q0, q1, q2, q3, flipQ) => {
    if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) return;
    if (flipQ) { const t = q1; q1 = q3; q3 = t; }
    const Vo = out.V;
    const d02 = Math.hypot(Vo[q0 * 3] - Vo[q2 * 3], Vo[q0 * 3 + 1] - Vo[q2 * 3 + 1], Vo[q0 * 3 + 2] - Vo[q2 * 3 + 2]);
    const d13 = Math.hypot(Vo[q1 * 3] - Vo[q3 * 3], Vo[q1 * 3 + 1] - Vo[q3 * 3 + 1], Vo[q1 * 3 + 2] - Vo[q3 * 3 + 2]);
    if (d02 <= d13) { out.addFace(q0, q1, q2, -1, 0); out.addFace(q0, q2, q3, -1, 0); } else { out.addFace(q0, q1, q3, -1, 0); out.addFace(q1, q2, q3, -1, 0); }
  };
  for (let i = 0; i < nx; i++) for (let j = 1; j < cy; j++) for (let k = 1; k < cz; k++) {
    // x-edge (i,j,k)-(i+1,j,k)
    if (i < cx) { const s0 = inside[idx(i, j, k)], s1 = inside[idx(i + 1, j, k)]; if (s0 !== s1) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), s0 === 0); }
  }
  for (let i = 1; i < cx; i++) for (let j = 0; j < cy; j++) for (let k = 1; k < cz; k++) {
    const s0 = inside[idx(i, j, k)], s1 = inside[idx(i, j + 1, k)]; if (s0 !== s1) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), s0 === 0);
  }
  for (let i = 1; i < cx; i++) for (let j = 1; j < cy; j++) for (let k = 0; k < cz; k++) {
    const s0 = inside[idx(i, j, k)], s1 = inside[idx(i, j, k + 1)]; if (s0 !== s1) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), s0 === 0);
  }
  out.compact();
  return { mesh: out, resolution: N, voxel: h, dims };
}
