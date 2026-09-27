/* Regression cases, shared by tests/run.html (browser) and tests/run-node.js (Node).
   runCases(E, run, check, sum) uses the engine E; run(name, parsed, opts) repairs and logs; check(name, ok, detail). */
function runCases(E, run, check, sum) {
  const S = E.synth;
  function soupFrom(fn) { const s = S.soup(); fn(s); return s.done(); }
  const p = (x, y, z) => [x, y, z];

  // 1. clean cube
  {
    const r = run('cube', S.cube(10));
    check('cube clean before', r.before.clean && r.before.stats.watertight, sum(r.before));
    check('cube volume 1000', Math.abs(r.after.stats.volume - 1000) < 1e-6, r.after.stats.volume);
    check('cube unchanged', r.after.stats.triangles === 12 && r.after.stats.vertices === 8);
  }
  // 2. cube with a missing face (planar hole)
  {
    const parsed = soupFrom((s) => { const a = p(0,0,0), b = p(10,0,0), c = p(10,10,0), d = p(0,10,0), e = p(0,0,10), f = p(10,0,10), g = p(10,10,10), h = p(0,10,10);
      s.quad(a, d, c, b); /* no top */ s.quad(a, b, f, e); s.quad(b, c, g, f); s.quad(c, d, h, g); s.quad(d, a, e, h); });
    const r = run('cube missing top', parsed);
    check('hole detected', r.before.nakedEdges === 4 && r.before.planarHoles === 1, sum(r.before));
    check('hole filled', r.after.clean && Math.abs(r.after.stats.volume - 1000) < 1e-6, sum(r.after));
  }
  // 3. flipped triangle
  {
    const parsed = S.cube(10); const t = parsed.tris; // flip triangle 0: swap v1,v2
    for (let k = 0; k < 3; k++) { const tmp = t[3 + k]; t[3 + k] = t[6 + k]; t[6 + k] = tmp; }
    const r = run('cube flipped tri', parsed);
    check('inverted detected', r.before.invertedNormals === 1, sum(r.before));
    check('inverted fixed', r.after.clean && Math.abs(r.after.stats.signedVolume - 1000) < 1e-6, sum(r.after));
  }
  // 4. whole cube inside out
  {
    const parsed = S.cube(10); const t = parsed.tris;
    for (let i = 0; i < parsed.count; i++) for (let k = 0; k < 3; k++) { const tmp = t[i*9 + 3 + k]; t[i*9 + 3 + k] = t[i*9 + 6 + k]; t[i*9 + 6 + k] = tmp; }
    const r = run('cube inside out', parsed);
    check('all inverted detected', r.before.invertedNormals === 12, sum(r.before));
    check('inside-out fixed', r.after.clean && r.after.stats.signedVolume > 0, sum(r.after));
  }
  // 5. duplicate face
  {
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); s.tri(p(0,0,0), p(0,10,0), p(10,10,0)); });
    const r = run('cube duplicate face', parsed);
    check('duplicate detected', r.before.duplicateFaces === 1, sum(r.before));
    check('duplicate removed', r.after.clean && r.after.stats.triangles === 12, sum(r.after));
  }
  // 6. degenerate sliver (collinear) inside a face + needle
  {
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); s.tri(p(0,0,0), p(10,0,0), p(5,0,0)); s.tri(p(3,3,10), p(3,3,10), p(4,4,10)); s.tri(p(1,1,10), p(1.0000001,1,10), p(2,1,10)); });
    const r = run('cube degenerate', parsed);
    check('degenerate detected', r.before.degenerateFaces === 3, sum(r.before));
    check('degenerate removed', r.after.degenerateFaces === 0 && r.after.clean, sum(r.after));
  }
  // 7. two cubes sharing an edge (non-manifold edge with 4 faces)
  {
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 10, 0, 10, 20, 10, 20); });
    const r = run('two cubes share edge', parsed);
    check('nm edge detected', r.before.nonManifoldEdges === 1, sum(r.before));
    check('split into 2 shells', r.after.clean && r.after.shells === 2 && Math.abs(r.after.stats.volume - 2000) < 1e-2, sum(r.after));
  }
  // 8. fin attached to cube edge (3 faces on one edge)
  {
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); s.tri(p(0,0,0), p(10,0,0), p(5,-5,-5)); });
    const r = run('cube with fin', parsed);
    check('fin nm edge detected', r.before.nonManifoldEdges === 1, sum(r.before));
    check('fin removed', r.after.clean && r.after.shells === 1 && r.after.stats.triangles === 12, sum(r.after));
  }
  // 9. internal wall (box split by a wall)
  {
    const parsed = soupFrom((s) => {
      const a = p(0,0,0), b = p(10,0,0), c = p(10,10,0), d = p(0,10,0), e = p(0,0,10), f = p(10,0,10), g = p(10,10,10), h = p(0,10,10);
      const m0 = p(5,0,0), m1 = p(5,10,0), m2 = p(5,10,10), m3 = p(5,0,10);
      s.quad(a, d, m1, m0); s.quad(m0, m1, c, b);        // bottom split
      s.quad(e, m3, m2, h); s.quad(m3, f, g, m2);        // top split
      s.quad(a, m0, m3, e); s.quad(m0, b, f, m3);        // front split
      s.quad(b, c, g, f); s.quad(d, a, e, h);
      s.quad(c, d, h, g); // back not split -> T-junctions at m1/m2
      s.quad(m0, m1, m2, m3); // internal wall
    });
    const r = run('box with internal wall + T-junctions', parsed);
    check('wall removed & stitched', r.after.clean && r.after.shells === 1 && Math.abs(r.after.stats.volume - 1000) < 1e-6, sum(r.after));
  }
  // 10. T-junction only
  {
    const parsed = soupFrom((s) => {
      const a = p(0,0,0), b = p(10,0,0), c = p(10,10,0), d = p(0,10,0), e = p(0,0,10), f = p(10,0,10), g = p(10,10,10), h = p(0,10,10);
      const m = p(10,5,10);
      s.quad(a, d, c, b); s.quad(a, b, f, e); s.quad(b, c, g, f); s.quad(c, d, h, g); s.quad(d, a, e, h);
      s.tri(e, f, m); s.tri(e, m, g); s.tri(e, g, h);
    });
    const r = run('T-junction', parsed);
    check('T-junction naked edges before', r.before.nakedEdges === 3, sum(r.before));
    check('T-junction stitched', r.after.clean && r.after.nakedEdges === 0 && Math.abs(r.after.stats.volume - 1000) < 1e-6, sum(r.after));
  }
  // 11. hollow cube: cavity oriented inward must be preserved; cavity oriented outward must be flipped
  {
    const good = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); const t0 = s.t.length; S.box(s, 3, 3, 3, 7, 7, 7); for (let i = t0; i < s.t.length; i += 9) { for (let k = 0; k < 3; k++) { const tmp = s.t[i+3+k]; s.t[i+3+k] = s.t[i+6+k]; s.t[i+6+k] = tmp; } } });
    const r = run('hollow cube (correct)', good);
    check('cavity recognised as fine', r.before.invertedNormals === 0 && r.after.clean && Math.abs(r.after.stats.signedVolume - (1000 - 64)) < 1e-6, sum(r.before) + ' signed=' + r.after.stats.signedVolume);
    const bad = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 3, 3, 3, 7, 7, 7); });
    // an inner cube drawn outward is a part hidden inside the outer one, not a cavity: it is removed
    const r2 = run('hollow cube (inner cube drawn outward)', bad);
    check('inner part is not reported inverted', r2.before.invertedNormals === 0, sum(r2.before));
    check('inner part removed', r2.after.clean && r2.after.shells === 1 && Math.abs(r2.after.stats.signedVolume - 1000) < 1e-6, sum(r2.after) + ' signed=' + r2.after.stats.signedVolume);
  }
  // 12. non-planar hole in cylinder + disjoint shell
  {
    const parsed = soupFrom((s) => { S.cylinder(s, 0, 0, 0, 20, 5, 24, { skipSide: [3, 4] }); });
    const r = run('cylinder side strip missing', parsed);
    check('non-planar hole detected', r.before.nonPlanarHoles === 1, sum(r.before));
    check('non-planar hole filled', r.after.clean, sum(r.after));
  }
  // 13. planar hole with island: plate with a through-hole whose top face is missing
  {
    const parsed = soupFrom((s) => {
      const n = 32, R = 10, r = 3, z0 = 0, z1 = 4;
      const ring = (rad, z) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([rad * Math.cos(a), rad * Math.sin(a), z]); } return o; };
      const oL = ring(R, z0), oH = ring(R, z1), iL = ring(r, z0), iH = ring(r, z1);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n;
        s.quad(oL[i], oL[j], oH[j], oH[i]);           // outer wall
        s.quad(iL[j], iL[i], iH[i], iH[j]);           // inner wall (facing inward to the hole)
        s.quad(oL[j], oL[i], iL[i], iL[j]);           // bottom annulus (facing -z)
        // top annulus missing
      }
    });
    const r = run('annulus with missing top (island hole)', parsed);
    check('two loops detected', r.before.planarHoles === 2, sum(r.before));
    check('island fill ok', r.after.clean && r.after.stats.genus === 1, sum(r.after) + ' genus=' + r.after.stats.genus + ' islands=' + r.totals.islands);
  }
  // 14. demo part
  {
    const r = run('demo part', S.demoPart());
    check('demo has every defect class', r.before.nakedEdges > 0 && r.before.nonManifoldEdges > 0 && r.before.planarHoles > 0 && r.before.nonPlanarHoles > 0 && r.before.invertedNormals > 0 && r.before.duplicateFaces > 0 && r.before.degenerateFaces > 0 && r.before.disjointShells > 0, sum(r.before));
    check('demo repaired', r.after.clean, sum(r.after));
  }
  // 15. export round trip
  {
    const r = E.repair(S.cube(10), {});
    const buf = E.exportBinarySTL(r.repaired.V, r.repaired.F, r.repaired.nf, 'cube');
    const p2 = E.parseSTL(buf); const r2 = E.repair(p2, {});
    check('binary export round trip', p2.count === 12 && r2.after.clean && Math.abs(r2.after.stats.volume - 1000) < 1e-6);
    const txt = E.exportAsciiSTL(r.repaired.V, r.repaired.F, r.repaired.nf, 'cube');
    const p3 = E.parseSTL(new TextEncoder().encode(txt).buffer); const r3 = E.repair(p3, {});
    check('ascii export round trip', p3.count === 12 && p3.format === 'ascii' && r3.after.clean, `count=${p3.count} fmt=${p3.format}`);
    const zip = E.makeZip([{ name: 'a.stl', data: new Uint8Array(buf) }]);
    check('zip built', zip.length > buf.byteLength + 60, zip.length);
  }

  // appended to run.html: self-intersection detection and solidify
  {
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 5, 5, 5, 15, 15, 15); });
    const r = run('two overlapping cubes', parsed);
    check('self-intersections detected', r.before.selfIntersections > 0, 'pairs=' + r.before.selfIntersections);
    check('overlapping cubes merged into one exact solid', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && Math.abs(r.after.stats.volume - 1875) < 1e-6, sum(r.after) + ' pairs=' + r.after.selfIntersections);
    const r1 = run('two overlapping cubes, merging off', parsed, { mergeParts: false });
    check('without merging: 2 clean shells that still overlap', r1.after.clean && r1.after.shells === 2 && r1.after.selfIntersections > 0, sum(r1.after));
    const r2 = run('two overlapping cubes, solidified', parsed, { solidify: true, solidifyResolution: 60 });
    const unionVol = 1000 + 1000 - 125;
    check('solidify unions shells', r2.after.clean && r2.after.shells === 1 && r2.after.selfIntersections === 0, sum(r2.after) + ' pairs=' + r2.after.selfIntersections);
    check('solidify volume within 3%', Math.abs(r2.after.stats.volume - unionVol) / unionVol < 0.03, r2.after.stats.volume.toFixed(1) + ' vs ' + unionVol);
  }
  {
    const r = run('demo part solidified', S.demoPart(), { solidify: true, solidifyResolution: 80 });
    check('demo solid clean', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0, sum(r.after) + ' pairs=' + r.after.selfIntersections);
  }
  {
    const r = run('cube clean has no self-intersections', S.cube(10));
    check('no false positives', r.before.selfIntersections === 0, 'pairs=' + r.before.selfIntersections);
  }

  // ---- merging: parts that overlap, touch, or hide inside each other ----
  {
    // a part entirely inside another part (drawn outward): removed, nothing left inside
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 2, 2, 2, 5, 5, 5); });
    const r = run('part hidden inside another part', parsed);
    check('hidden part removed', r.after.clean && r.after.shells === 1 && Math.abs(r.after.stats.volume - 1000) < 1e-6, sum(r.after));
  }
  {
    // a bullet (cylinder) poking out of a grip (box): one solid, exact volume
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.cylinder(s, 5, 5, 4, 14, 2, 32); });
    const cyl = 32 * 0.5 * 2 * 2 * Math.sin(2 * Math.PI / 32);   // area of the 32-gon
    const r = run('cylinder through the top of a box', parsed);
    check('merged into one solid', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0, sum(r.after));
    check('union volume exact', Math.abs(r.after.stats.volume - (1000 + cyl * 4)) < 1e-4, r.after.stats.volume.toFixed(4) + ' vs ' + (1000 + cyl * 4).toFixed(4));
  }
  {
    // two boxes touching face to face (flush contact): one box
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 10, 0, 0, 20, 10, 10); });
    const r = run('two boxes touching face to face', parsed);
    check('flush contact fused into one solid', r.after.clean && r.after.shells === 1 && Math.abs(r.after.stats.volume - 2000) < 1e-6, sum(r.after));
  }
  {
    // a smaller box flush against a bigger one, partial contact
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 10, 3, 3, 14, 7, 7); });
    const r = run('small box flush on a big box', parsed);
    check('partial flush contact fused', r.after.clean && r.after.shells === 1 && Math.abs(r.after.stats.volume - 1064) < 1e-6, sum(r.after));
  }
  {
    // two boxes touching along one edge only: two solids, and the file must still be manifold by position
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 10, 10, 0, 20, 20, 10); });
    const r = run('two boxes touching along an edge', parsed);
    check('edge contact: clean file, two solids', r.after.clean && r.after.shells === 2 && Math.abs(r.after.stats.volume - 2000) < 1e-2, sum(r.after));
  }
  {
    // three mutually overlapping boxes (triple points)
    const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 5, -2, -2, 15, 8, 8); S.box(s, -3, 5, 3, 7, 15, 13); });
    const r = run('three overlapping boxes', parsed);
    // inclusion-exclusion: |A|+|B|+|C| - |AB| - |AC| - |BC| + |ABC|
    const box = (x0, y0, z0, x1, y1, z1) => ({ x0, y0, z0, x1, y1, z1 });
    const A = box(0, 0, 0, 10, 10, 10), B = box(5, -2, -2, 15, 8, 8), C = box(-3, 5, 3, 7, 15, 13);
    const inter = (...bs) => { const x = Math.min(...bs.map((b) => b.x1)) - Math.max(...bs.map((b) => b.x0)), y = Math.min(...bs.map((b) => b.y1)) - Math.max(...bs.map((b) => b.y0)), z = Math.min(...bs.map((b) => b.z1)) - Math.max(...bs.map((b) => b.z0)); return x > 0 && y > 0 && z > 0 ? x * y * z : 0; };
    const u = 1000 * 3 - inter(A, B) - inter(A, C) - inter(B, C) + inter(A, B, C);
    check('three boxes merged, exact volume', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && Math.abs(r.after.stats.volume - u) < 1e-6, r.after.stats.volume + ' vs ' + u + ' ' + sum(r.after));
  }
  {
    // a tilted box crossing another at an angle (general positions, no axis alignment)
    const s = S.soup(); S.box(s, 0, 0, 0, 10, 10, 10);
    const t0 = s.t.length; S.box(s, -3, 3, 3, 13, 7, 7);
    const c = Math.cos(0.3), sn = Math.sin(0.3);
    for (let i = t0; i < s.t.length; i += 3) { const x = s.t[i] - 5, y = s.t[i + 1] - 5; s.t[i] = 5 + c * x - sn * y; s.t[i + 1] = 5 + sn * x + c * y; }
    const r = run('tilted bar through a box', s.done());
    check('tilted bar merged into one solid', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0, sum(r.after) + ' pairs=' + r.after.selfIntersections);
  }
  // fill hollows: a box assembled from overlapping walls, its lid 0.3 short of one wall (a slit into the cavity),
  // and a loose part inside. Filled, it is one solid block; left alone, the cavity stays open.
  {
    const s = S.soup();
    S.box(s, 0, 0, 0, 10, 10, 1); S.box(s, 0, 0, 0, 1, 10, 10); S.box(s, 9, 0, 0, 10, 10, 10);
    S.box(s, 0, 0, 0, 10, 1, 10); S.box(s, 0, 9, 0, 10, 10, 10); S.box(s, 1.3, 1, 9, 9, 9, 10);
    S.box(s, 4, 4, 3, 6, 6, 7);
    const parsed = s.done();
    const r = run('walled box with a slit and a loose part, fill hollows', parsed, { fillHollows: 0.05 });
    check('hollow behind a narrow slit filled solid', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && Math.abs(r.after.stats.volume - 1000) < 1, sum(r.after) + ' pairs=' + r.after.selfIntersections);
    const r0 = run('walled box with a slit and a loose part', parsed);
    check('without filling the cavity stays open', r0.after.stats.volume < 600, sum(r0.after));
  }
  {
    // a groove as narrow as the slit but only 0.3 deep is surface detail: it stays open
    const s = S.soup();
    S.box(s, 0, 0, 0, 10, 10, 9.7); S.box(s, 0, 0, 9.5, 10, 4.85, 10); S.box(s, 0, 5.15, 9.5, 10, 10, 10);
    const r = run('shallow groove, fill hollows', s.done(), { fillHollows: 0.05 });
    check('shallow groove kept', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && Math.abs(r.after.stats.volume - (1000 - 0.3 * 10 * 0.3)) < 1e-4, sum(r.after) + ' vol=' + r.after.stats.volume);
  }
  // ---- big faces crossed by many cuts, parts that cross themselves, and the merge budget ----
  // a plate with posts sunk into its top face (lettering on a keychain): each top triangle is cut by hundreds of
  // segments and gets the constrained Delaunay triangulation; the greedy one must give the same solid
  const plate = (nPosts, seg) => {
    const s = S.soup(); S.box(s, 0, 0, 0, 60, 30, 3);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < nPosts; i++) S.cylinder(s, 4 + rnd() * 52, 4 + rnd() * 22, 1.5, 5 + rnd() * 2, 0.8 + rnd() * 1.5, seg);
    return s.done();
  };
  {
    const parsed = plate(12, 16);
    const r = run('plate under 12 posts', parsed);
    check('plate and posts merged into one solid', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && !!r.merge, sum(r.after) + ' pairs=' + r.after.selfIntersections);
    check('big cut faces triangulated by constrained Delaunay', !!r.merge && r.merge.stats.cdtFaces >= 2 && !r.merge.stats.failedFaces, JSON.stringify(r.merge && r.merge.stats.fail));
    const rg = run('plate under 12 posts, greedy triangulation only', parsed, { cdtMinPoints: 1e9 });
    check('same solid with the greedy triangulation', rg.after.clean && Math.abs(rg.after.stats.volume - r.after.stats.volume) < 1e-6 * r.after.stats.volume, rg.after.stats.volume + ' vs ' + r.after.stats.volume);
    const rs = run('plate under 12 posts, pair cap', parsed, { mergeMaxPairs: 10 });
    check('too many crossings: merge skipped, parts kept', rs.mergeSkipped && rs.mergeSkipped.reason === 'size' && rs.after.printable && rs.after.shells === 13 && rs.log.some((l) => /^Skipped merging/.test(l.t)), sum(rs.after) + ' ' + JSON.stringify(rs.mergeSkipped));
    const rt = run('plate under 12 posts, no time', parsed, { mergeTimeLimit: 1e-6 });
    check('out of time: merge skipped, parts kept', rt.mergeSkipped && rt.mergeSkipped.reason === 'time' && rt.after.printable && rt.after.shells === 13, sum(rt.after) + ' ' + JSON.stringify(rt.mergeSkipped));
  }
  {
    // one closed tube along a (2,3) torus knot, thick enough to pass through itself: a single shell that crosses itself
    const s = S.soup(), nu = 120, nv = 10, rr = 9;
    const c = (t) => { const r = Math.cos(3 * t) + 2; return [r * Math.cos(2 * t) * 10, r * Math.sin(2 * t) * 10, -Math.sin(3 * t) * 10]; };
    const rings = [];
    for (let i = 0; i < nu; i++) {
      const t = i / nu * 2 * Math.PI, p0 = c(t), p1 = c(t + 1e-4);
      const T = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], lt = Math.hypot(...T); for (let k = 0; k < 3; k++) T[k] /= lt;
      const N = [-T[1], T[0], 0], ln = Math.hypot(...N); for (let k = 0; k < 3; k++) N[k] /= ln;
      const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      const ring = []; for (let j = 0; j < nv; j++) { const a = j / nv * 2 * Math.PI, ca = Math.cos(a) * rr, sa = Math.sin(a) * rr; ring.push([p0[0] + ca * N[0] + sa * B[0], p0[1] + ca * N[1] + sa * B[1], p0[2] + ca * N[2] + sa * B[2]]); }
      rings.push(ring);
    }
    for (let i = 0; i < nu; i++) { const a = rings[i], b = rings[(i + 1) % nu]; for (let j = 0; j < nv; j++) { const k = (j + 1) % nv; s.quad(a[j], b[j], b[k], a[k]); } }
    const r = run('knotted tube crossing itself', s.done());
    check('one shell crossing itself', r.before.shells === 1 && r.before.selfIntersections > 0, sum(r.before) + ' pairs=' + r.before.selfIntersections);
    check('self-crossing shell merged with itself', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0 && !!r.merge && r.after.stats.volume < Math.abs(r.before.stats.signedVolume), sum(r.after) + ' pairs=' + r.after.selfIntersections + ' vol ' + r.after.stats.volume + ' vs ' + r.before.stats.signedVolume);
  }
  {
    // panels whose walls touch within float noise, at an angle no flush snap makes exact, tied together by tilted bars.
    // A wall's test points step over its neighbour, so walls say "drop" while the panel's top (in the same region) says
    // "keep": the clear view must win, or whole panels vanish. And the float32 untangle must not eat the model.
    const s = S.soup(), gap = 1e-5;
    let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x0 = i * (10 + gap), y0 = j * (10 + gap); S.box(s, x0, y0, 0, x0 + 10, y0 + 10, 3 + rnd()); }
    const L = 4 * (10 + gap);
    for (let b = 0; b < 10; b++) {
      const t0 = s.t.length, y = 2 + rnd() * (L - 4), z = 1 + rnd() * 2;
      S.box(s, -2, y - 0.6, z - 0.6, L + 2, y + 0.6, z + 0.6);
      const a = (rnd() - 0.5) * 1.2, c = Math.cos(a), sn = Math.sin(a);
      for (let i = t0; i < s.t.length; i += 3) { const x = s.t[i] - L / 2, yy = s.t[i + 1] - L / 2; s.t[i] = L / 2 + c * x - sn * yy; s.t[i + 1] = L / 2 + sn * x + c * yy; }
    }
    for (const [ax, ang] of [[2, 0.46], [0, 0.21]]) for (let i = 0; i < s.t.length; i += 3) { const u = (ax + 1) % 3, w = (ax + 2) % 3, x = s.t[i + u], y = s.t[i + w]; s.t[i + u] = Math.cos(ang) * x - Math.sin(ang) * y; s.t[i + w] = Math.sin(ang) * x + Math.cos(ang) * y; }
    const r = run('panels touching within float noise, tilted', s.done());
    // (a few float32 crossings stay where the walls touch: the untangle stops before it would eat into the panels)
    check('touching panels merged into one solid, no panel lost', r.after.printable && r.after.shells === 1 && !!r.merge && r.after.stats.volume > 0.85 * r.before.stats.volume, sum(r.after) + ' pairs=' + r.after.selfIntersections + ' vol ' + r.after.stats.volume.toFixed(1) + ' vs parts ' + r.before.stats.volume.toFixed(1));
  }
}
if (typeof module !== 'undefined') module.exports = runCases;
