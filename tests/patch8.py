import re
p='src/engine.js'; s=open(p,encoding='utf-8').read()
extra=open('src/engine-extra.js',encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (s.count(old), old[:90])
    s=s.replace(old,new)

# insert extra functions before the export section
marker = "/* ------------------------------------------------------------------ export */"
assert s.count(marker)==1 and 'function solidify' not in s
s = s.replace(marker, extra + "\n" + marker)

# defaults
rep("""  cavities: true,           // enclosed closed shells are oriented inward (even-odd rule); false = every shell outward
};""",
"""  cavities: true,           // enclosed closed shells are oriented inward (even-odd rule); false = every shell outward
  checkSelfIntersections: true,
  selfIntersectionMaxFaces: 3000000,
  solidify: false,          // rebuild the result as one voxel-classified solid (removes self-intersections, unions shells)
  solidifyResolution: 200,  // voxels along the longest axis
};""")

# analysis: self-intersections (full analysis only)
rep("""  res.clean = res.nakedEdges === 0 && res.nonManifoldEdges === 0 && res.invertedNormals === 0 && res.duplicateFaces === 0 && res.degenerateFaces === 0 && conflicts === 0;""",
"""  if (!ctx.quick && ctx.selfIntersections !== false && alive <= (ctx.siMaxFaces || 3000000)) {
    const si = findSelfIntersections(mesh, 200000);
    res.selfIntersections = si.pairs; res.selfIntersectingFaces = si.faces; res.selfIntersectionsTruncated = !!si.truncated;
  } else { res.selfIntersections = null; res.selfIntersectingFaces = new Uint32Array(0); }
  res.clean = res.nakedEdges === 0 && res.nonManifoldEdges === 0 && res.invertedNormals === 0 && res.duplicateFaces === 0 && res.degenerateFaces === 0 && conflicts === 0;""")

# repair: ctx flags, let mesh, sliver pass inside loop, solidify step
rep("""  const ctx = { tol: degTol, storedNormals: parsed.normals || null, diag };""",
"""  const ctx = { tol: degTol, storedNormals: parsed.normals || null, diag, selfIntersections: opts.checkSelfIntersections, siMaxFaces: opts.selfIntersectionMaxFaces };""")
rep("""  const mesh = weldExact(parsed.tris, count);""", """  let mesh = weldExact(parsed.tris, count);""")
rep("""  const totals = { welded: 0, needles: 0, caps: 0, collinearLoops: 0, folds: 0,""",
"""  const totals = { welded: 0, needles: 0, caps: 0, collinearLoops: 0, folds: 0, sliverFlips: 0, sliverCollapses: 0,""")
rep("""    prog('Verifying', base + step * 0.9);
    cur = analyze(mesh, topo, Object.assign({ quick: true }, ctx));""",
"""    // 7c. thin slivers left by stitching and filling
    {
      const r = removeSlivers(mesh, degTol, diag, 6);
      if (r.flips || r.collapses) { totals.sliverFlips += r.flips; totals.sliverCollapses += r.collapses; rebuild(); const dup = findDuplicates(mesh); if (dup.remove.length) { for (const f of dup.remove) mesh.killFace(f); totals.duplicates += dup.count; rebuild(); } }
    }
    prog('Verifying', base + step * 0.9);
    cur = analyze(mesh, topo, Object.assign({ quick: true }, ctx));""")
rep("""  mesh.removeUnusedVertices();
  rebuild();
  prog('Final check', 0.95);""",
"""  mesh.removeUnusedVertices();
  rebuild();
  let solidInfo = null;
  if (opts.solidify && mesh.alive() > 0) {
    prog('Rebuilding as solid', 0.86);
    const sol = solidify(mesh, opts.solidifyResolution, (stage, frac) => prog(stage, 0.86 + frac * 0.08));
    if (sol.mesh.nf > 0) {
      const soup = new Float32Array(sol.mesh.nf * 9);
      for (let f = 0; f < sol.mesh.nf; f++) for (let c = 0; c < 3; c++) { const v = sol.mesh.F[f * 3 + c] * 3; soup[f * 9 + c * 3] = sol.mesh.V[v]; soup[f * 9 + c * 3 + 1] = sol.mesh.V[v + 1]; soup[f * 9 + c * 3 + 2] = sol.mesh.V[v + 2]; }
      const inner = repair({ tris: soup, normals: null, count: sol.mesh.nf, format: 'solid', header: '' }, Object.assign({}, opts, { solidify: false, trace: null, checkSelfIntersections: false }), null);
      const snap = inner.repaired;
      mesh = new Mesh(Math.max(4, snap.nv), Math.max(4, snap.nf));
      mesh.V = Float64Array.from(snap.V); mesh.nv = snap.nv; mesh.F = Uint32Array.from(snap.F); mesh.nf = snap.nf;
      mesh.src = new Int32Array(Math.max(1, snap.nf)).fill(-1); mesh.flags = new Uint8Array(Math.max(1, snap.nf)); mesh.dead = new Uint8Array(Math.max(1, snap.nf)); mesh.ndead = 0;
      rebuild();
      solidInfo = { resolution: sol.resolution, voxel: sol.voxel, triangles: snap.nf, innerLog: inner.log };
    }
  }
  prog('Final check', 0.95);""")
rep("""  if (totals.flipped) say(`Flipped ${fmtInt(totals.flipped)} inverted face${totals.flipped === 1 ? '' : 's'}`);""",
"""  if (totals.sliverFlips || totals.sliverCollapses) say(`Reshaped ${fmtInt(totals.sliverFlips + totals.sliverCollapses)} hairline sliver${totals.sliverFlips + totals.sliverCollapses === 1 ? '' : 's'} (${fmtInt(totals.sliverFlips)} edge flips, ${fmtInt(totals.sliverCollapses)} collapses)`);
  if (totals.flipped) say(`Flipped ${fmtInt(totals.flipped)} inverted face${totals.flipped === 1 ? '' : 's'}`);""")
rep("""  const ms = now() - t0;
  prog('Done', 1);""",
"""  if (solidInfo) {
    say(`Rebuilt as one solid at ${solidInfo.resolution} voxels (${fmtTol(solidInfo.voxel)} units per voxel): ${fmtInt(after.stats.triangles)} triangles, ${after.shells} shell${after.shells === 1 ? '' : 's'}`);
    for (const l of solidInfo.innerLog) if (!/^Welded|^Flipped/.test(l.t)) say('    ' + l.t, l.c);
  }
  const ms = now() - t0;
  prog('Done', 1);""")
rep("""    before, after, log, totals, iterations: iter, ms, diag, tolerance: tol,""",
"""    before, after, log, totals, iterations: iter, ms, diag, tolerance: tol, solid: solidInfo ? { resolution: solidInfo.resolution, voxel: solidInfo.voxel } : null,""")
# api
rep("""  _boundaryLoops: boundaryLoops, _loopGeometry: loopGeometry, _classifyDegenerate: classifyDegenerate, _faceComponents: faceComponents, _orientationFlips: orientationFlips };""",
"""  _boundaryLoops: boundaryLoops, _loopGeometry: loopGeometry, _classifyDegenerate: classifyDegenerate, _faceComponents: faceComponents, _orientationFlips: orientationFlips,
  findSelfIntersections, solidify, removeSlivers };""")
open(p,'w',encoding='utf-8').write(s)

# ---------------- app.js ----------------
p='src/app.js'; s=open(p,encoding='utf-8').read()
rep("""  shells: 'Separate closed surfaces beyond the first one. Extra shells can be intended (a multi-part model) or noise (floating fragments). Zero-volume shells are removed.',
};""",
"""  shells: 'Separate closed surfaces beyond the first one. Extra shells can be intended (a multi-part model) or noise (floating fragments). Zero-volume shells are removed.',
  selfx: 'Pairs of triangles that pass through each other, e.g. overlapping parts exported as separate shells. Most slicers cope, but phantom walls or missing regions can appear. Topology repair cannot remove them; "Rebuild as solid" resamples the model into one clean solid.',
};""")
rep("""    cavities: $('#optCavities').checked,
    ascii: $('#optFormat').value === 'ascii',
  };""",
"""    cavities: $('#optCavities').checked,
    solidify: $('#optSolid').checked,
    solidifyResolution: parseInt($('#optSolidRes').value, 10) || 200,
    ascii: $('#optFormat').value === 'ascii',
  };""")
rep("""    L.push(countLine(an.disjointShells, 'Disjoint shells', 'shells', 'warn'));
    if (an.orientationConflicts) L.push(countLine(an.orientationConflicts, 'Non-orientable folds', 'inverted'));
  };""",
"""    L.push(countLine(an.disjointShells, 'Disjoint shells', 'shells', 'warn'));
    if (an.selfIntersections === null || an.selfIntersections === undefined) L.push({ t: '--> Self-intersections not checked (mesh too large)', cls: '' });
    else L.push(countLine(an.selfIntersections, 'Self-intersecting pairs', 'selfx', 'warn'));
    if (an.orientationConflicts) L.push(countLine(an.orientationConflicts, 'Non-orientable folds', 'inverted'));
  };""")
rep("""  if (a.printable) L.push({ t: '-> Ready for download.', cls: 'head' });
  else L.push({ t: '-> Repaired as far as possible. Download and inspect the highlighted areas.', cls: 'head warn' });
  return L;""",
"""  if (a.printable && !a.selfIntersections) L.push({ t: '-> Ready for download.', cls: 'head' });
  else if (a.printable) L.push({ t: '-> Ready for download. Overlapping triangles remain; most slicers handle them, "Rebuild as solid" removes them for good.', cls: 'head' });
  else L.push({ t: '-> Repaired as far as possible. Inspect the highlighted areas, or use "Rebuild as solid" for a guaranteed clean result.', cls: 'head warn' });
  return L;""")
rep("""  const changed = !(b.printable && j.result.log.length <= 1);""",
"""  const changed = !(b.printable && j.result.log.length <= 1);
  $('#solidBtn').hidden = !!(j.result.solid) || (a.printable && !a.selfIntersections);""")
rep("""  viewer.setMesh(snap, {
    fillFaces: fill,""",
"""  viewer.setMesh(snap, {
    selfxFaces: an.selfIntersectingFaces,
    fillFaces: fill,""")
rep("""  if (repaired && fills) items.push(['fill', `${fmt(fills)} filled triangles`]);""",
"""  if (an.selfIntersections) items.push(['selfx', `${fmt(an.selfIntersections)} self-intersecting pairs`]);
  if (repaired && fills) items.push(['fill', `${fmt(fills)} filled triangles`]);""")
rep("""  $('#rerun').addEventListener('click', () => {""",
"""  $('#solidBtn').addEventListener('click', () => { if (!current || current.status === 'running') return; $('#optSolid').checked = true; current.status = 'queued'; current.result = null; queue.unshift(current); renderJobs(); renderCurrent(); runNext(); });
  $('#rerun').addEventListener('click', () => {""")
rep("""    else { const a = j.result.after; chip = a.printable ? 'watertight' : 'check'; cls = a.printable ? 'ok' : 'warn'; }""",
"""    else { const a = j.result.after; chip = a.printable ? (j.result.solid ? 'solid' : 'watertight') : 'check'; cls = a.printable ? 'ok' : 'warn'; }""")
rep("""  if (a.printable && a.degenerateFaces === 0) { pill.textContent = 'watertight'; pill.className = 'pill ok'; }""",
"""  if (j.result.solid && a.printable) { pill.textContent = 'rebuilt solid'; pill.className = 'pill ok'; }
  else if (a.printable && a.degenerateFaces === 0) { pill.textContent = 'watertight'; pill.className = 'pill ok'; }""")
open(p,'w',encoding='utf-8').write(s)

# ---------------- index.html ----------------
p='src/index.html'; s=open(p,encoding='utf-8').read()
rep("""        <label><span>Output format</span><select id="optFormat"><option value="binary" selected>binary STL</option><option value="ascii">ASCII STL</option></select></label>""",
"""        <label><span>Rebuild as solid<small>resamples into one clean solid: no self-intersections, overlapping parts merged; corners rounded to one voxel</small></span><input type="checkbox" id="optSolid"></label>
        <label><span>Solid resolution<small>voxels along the longest side</small></span><select id="optSolidRes"><option value="100">100 (fast)</option><option value="150">150</option><option value="200" selected>200</option><option value="250">250</option><option value="320">320 (slow, ~1 GB RAM)</option></select></label>
        <label><span>Output format</span><select id="optFormat"><option value="binary" selected>binary STL</option><option value="ascii">ASCII STL</option></select></label>""")
rep("""          <button class="btn" id="dlReport" disabled>Save report</button>""",
"""          <button class="btn" id="dlReport" disabled>Save report</button>
          <button class="btn" id="solidBtn" hidden title="Resample into one clean solid">Rebuild as solid</button>""")
rep(""".sw.naked { background: var(--sw-naked); } .sw.nm { background: var(--sw-nm); } .sw.inv { background: var(--sw-inv); } .sw.deg { background: var(--sw-deg); } .sw.fill { background: var(--sw-fill); } .sw.back { background: var(--sw-back); }""",
""".sw.naked { background: var(--sw-naked); } .sw.nm { background: var(--sw-nm); } .sw.inv { background: var(--sw-inv); } .sw.deg { background: var(--sw-deg); } .sw.fill { background: var(--sw-fill); } .sw.back { background: var(--sw-back); } .sw.selfx { background: var(--sw-selfx); }""")
rep("""  --sw-naked: #ff3b2f; --sw-nm: #e23bff; --sw-inv: #f0a41b; --sw-deg: #ffd21f; --sw-fill: #3ec46d; --sw-back: #e2604a;""",
"""  --sw-naked: #ff3b2f; --sw-nm: #e23bff; --sw-inv: #f0a41b; --sw-deg: #ffd21f; --sw-fill: #3ec46d; --sw-back: #e2604a; --sw-selfx: #22c7e6;""")
open(p,'w',encoding='utf-8').write(s)

# ---------------- viewer.js ----------------
p='src/viewer.js'; s=open(p,encoding='utf-8').read()
rep("""    body: '#c9d1da', back: '#e2604a', inverted: '#f0a41b', fill: '#3ec46d', naked: '#ff3b2f', nonManifold: '#e23bff', degenerate: '#ffd21f', wire: '#3a4250', clear: [0, 0, 0, 0],""",
"""    body: '#c9d1da', back: '#e2604a', inverted: '#f0a41b', fill: '#3ec46d', naked: '#ff3b2f', nonManifold: '#e23bff', degenerate: '#ffd21f', selfx: '#22c7e6', wire: '#3a4250', clear: [0, 0, 0, 0],""")
rep("""    faceSubset('fill', ov.fillFaces, colors.fill);""",
"""    faceSubset('selfx', ov.selfxFaces, colors.selfx);
    faceSubset('fill', ov.fillFaces, colors.fill);""")
rep("""    if (state.show.problems) { drawSub('inverted'); drawSub('degenerate'); drawSub('duplicate'); }""",
"""    if (state.show.problems) { drawSub('selfx'); drawSub('inverted'); drawSub('degenerate'); drawSub('duplicate'); }""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
