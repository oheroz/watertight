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
}
if (typeof module !== 'undefined') module.exports = runCases;
