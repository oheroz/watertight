/* ============================================================================
   Watertight — app logic: file intake, worker orchestration, console report,
   3D viewer wiring, downloads (local file or artifact sandbox).
   ============================================================================ */
(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const E = STLRepair;
const fmt = E.fmtInt;

/* ------------------------------------------------------------------ help text */
const HELP = {
  naked: 'Edges used by only one triangle. The surface has an opening there: a hole, a crack, or an unwelded seam. Slicers cannot tell inside from outside.',
  planar: 'Holes whose boundary lies in one plane, e.g. a missing flat face. Filled with a minimum-weight triangulation; islands inside the hole are kept open.',
  nonplanar: 'Holes whose boundary bends in 3D, e.g. a missing patch on a curved surface. Filled with a triangulation that keeps the surface as smooth as possible.',
  nonmanifold: 'Edges shared by three or more triangles: fins, internal walls, or two shells touching along an edge. They are separated, or the extra fin is removed.',
  inverted: 'Triangles whose winding (front side) disagrees with their neighbours or points into the solid. They are flipped so every shell faces outward and cavities face inward.',
  duplicate: 'Triangles that use exactly the same three vertices. One copy is kept; an opposite-facing pair cancels out.',
  degenerate: 'Triangles with zero area: two identical corners, or three corners on a line. They are collapsed or removed and the gap is stitched.',
  shells: 'Separate closed surfaces beyond the first one. Overlapping or touching parts are merged into one solid; parts hidden inside others and zero-volume shells are removed. Parts that stand apart stay separate.',
  selfx: 'Pairs of triangles that pass through each other deeper than float precision, e.g. overlapping parts. Watertight merges overlapping parts exactly (cut where they cross, hidden geometry removed). If some remain, "Rebuild as solid" resamples the model into one clean solid.',
};

/* ------------------------------------------------------------------ state */
const jobs = []; let current = null; let nextId = 1;
let worker = null, workerReady = false, running = null; const queue = [];
let viewer = null; let viewMode = 'repaired';

/* ------------------------------------------------------------------ options */
function readOptions() {
  const tolSel = $('#optTol').value;
  const tolerance = tolSel === 'off' ? 0 : parseFloat(tolSel);
  return {
    tolerance,
    fillHoles: $('#optFill').checked,
    maxHoleEdges: Math.max(0, parseInt($('#optMaxHole').value, 10) || 0),
    removeZeroVolumeShells: $('#optZero').checked,
    removeSmallShells: $('#optSmall').checked,
    smallShellFraction: Math.max(0, parseFloat($('#optSmallPct').value) || 0) / 100,
    cavities: $('#optCavities').checked,
    mergeParts: $('#optMerge').checked,
    mergeTimeLimit: parseInt($('#optMergeTime').value, 10) || 0,
    removeInternalParts: $('#optInternal').checked,
    fillHollows: $('#optHollow').checked ? (parseFloat($('#optHollowPct').value) || 0.5) / 100 : 0,
    solidify: $('#optSolid').checked,
    solidifyResolution: parseInt($('#optSolidRes').value, 10) || 200,
    ascii: $('#optFormat').value === 'ascii',
  };
}

/* ------------------------------------------------------------------ worker */
async function engineSource() {
  const el = document.getElementById('engine-src');
  if (el && el.textContent.trim().length > 100) return el.textContent;
  if (el && el.src) return await (await fetch(el.src)).text();
  throw new Error('engine source unavailable');
}
const WORKER_BOOT = `
self.onmessage = function (e) {
  var m = e.data;
  try {
    var parsed = STLRepair.parseSTL(m.buffer, m.name);
    var r = STLRepair.repair(parsed, m.options, function (stage, frac) { self.postMessage({ id: m.id, type: 'progress', stage: stage, frac: frac }); });
    var t = [r.original.V.buffer, r.original.F.buffer, r.original.flags.buffer, r.repaired.V.buffer, r.repaired.F.buffer, r.repaired.flags.buffer];
    self.postMessage({ id: m.id, type: 'result', result: r }, t);
  } catch (err) { self.postMessage({ id: m.id, type: 'error', message: String(err && err.message || err), stack: err && err.stack }); }
};`;
async function makeWorker() {
  try {
    const src = await engineSource();
    const blob = new Blob([src, '\n', WORKER_BOOT], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('worker timeout')), 4000); w.onerror = (e) => { clearTimeout(t); rej(e); }; w.onmessage = () => { clearTimeout(t); res(); }; w.postMessage({ id: 0, buffer: new ArrayBuffer(0), name: 'ping', options: {} }); });
    w.onerror = null; w.onmessage = null;
    return w;
  } catch (e) { console.warn('Web Worker unavailable, running on the main thread', e); return null; }
}

function runNext() {
  if (running || !queue.length || !workerReady) return;
  const job = queue.shift(); running = job; job.status = 'running'; job.progress = 0; job.stage = 'Reading file'; renderJobs();
  if (job === current) renderCurrent();
  job.file.arrayBuffer().then((buffer) => {
    job.stage = 'Starting'; job.options = readOptions();
    const opts = Object.assign({}, job.options);
    if (worker) {
      worker.onmessage = (e) => {
        const m = e.data; if (m.id !== job.id) return;
        if (m.type === 'progress') { job.progress = m.frac; job.stage = m.stage; if (job === current) renderProgress(job); renderJobs(); }
        else if (m.type === 'result') finish(job, m.result);
        else if (m.type === 'error') fail(job, m.message);
      };
      worker.onerror = (e) => { fail(job, e.message || 'worker error'); };
      worker.postMessage({ id: job.id, buffer, name: job.name, options: opts }, [buffer]);
    } else {
      setTimeout(() => {
        try {
          const parsed = E.parseSTL(buffer, job.name);
          const r = E.repair(parsed, opts, (stage, frac) => { job.progress = frac; job.stage = stage; });
          finish(job, r);
        } catch (err) { fail(job, err.message); }
      }, 30);
    }
  }).catch((err) => fail(job, err.message));
}
function finish(job, result) {
  job.status = 'done'; job.result = result; job.progress = 1; job.stage = 'Done';
  job.lines = buildConsole(job); running = null; renderJobs(); if (job === current) renderCurrent(); updateBatch(); runNext();
}
function fail(job, message) {
  job.status = 'error'; job.error = message || 'Unknown error'; running = null; renderJobs(); if (job === current) renderCurrent(); updateBatch(); runNext();
}

/* ------------------------------------------------------------------ intake */
function addFiles(files, extra) {
  const list = Array.from(files).filter((f) => f && (f.size > 0));
  for (const f of list) {
    const job = Object.assign({ id: nextId++, name: f.name, size: f.size, file: f, status: 'queued', progress: 0, stage: 'Queued', sample: false }, extra || {});
    jobs.push(job); queue.push(job);
    if (!current || current.sample && !job.sample) current = job;
  }
  renderJobs(); renderCurrent(); runNext();
}
function loadSample() {
  const d = E.synth.demoPart();
  const m = E.weldExact(d.tris, d.count);
  const buf = E.exportBinarySTL(m.V, m.F, m.nf, 'sample');
  const file = new File([buf], 'sample-bracket.stl', { type: 'model/stl' });
  addFiles([file], { sample: true });
}

/* ------------------------------------------------------------------ console */
function countLine(n, label, key, cls) {
  const bad = n > 0;
  return { t: `--> ${n} ${label}`, n, label, key, cls: bad ? (cls || 'bad') : 'ok' };
}
function buildConsole(job) {
  const r = job.result, b = r.before, a = r.after, L = [];
  const sizeStr = job.size > 1048576 ? (job.size / 1048576).toFixed(1) + ' MB' : (job.size / 1024).toFixed(0) + ' KB';
  L.push({ t: `-> Loading ${job.name}${job.sample ? ' (generated sample)' : ''}`, cls: 'head' });
  L.push({ t: `--> ${r.format} STL, ${fmt(r.counts.rawTriangles)} triangles, ${sizeStr}${r.invalidValues ? `, ${fmt(r.invalidValues)} invalid coordinates replaced` : ''}` });
  L.push({ t: '-> Analyzing file', cls: 'head' });
  const push = (an, after) => {
    L.push(countLine(an.nakedEdges, 'Naked edges', 'naked'));
    L.push(countLine(an.planarHoles, 'Planar holes', 'planar'));
    L.push(countLine(an.nonPlanarHoles, 'Non-planar holes', 'nonplanar'));
    L.push(countLine(an.nonManifoldEdges, 'Non-manifold edges', 'nonmanifold'));
    L.push(countLine(an.invertedNormals, 'Inverted normals', 'inverted'));
    L.push(countLine(an.duplicateFaces, 'Duplicate faces', 'duplicate'));
    L.push(countLine(an.degenerateFaces, 'Degenerate faces', 'degenerate', after ? 'warn' : 'bad'));
    L.push(countLine(an.disjointShells, 'Disjoint shells', 'shells', 'warn'));
    if (an.selfIntersections === null || an.selfIntersections === undefined) L.push({ t: '--> Self-intersections not checked (mesh too large)', cls: '' });
    else L.push(countLine(an.selfIntersections, 'Self-intersecting pairs', 'selfx', 'warn'));
    if (an.orientationConflicts) L.push(countLine(an.orientationConflicts, 'Non-orientable folds', 'inverted'));
  };
  push(b, false);
  L.push({ t: '-> Repairing: 100.00%', cls: 'head', progress: true });
  for (const l of r.log) L.push({ t: '--> ' + l.t, cls: l.c === 'warn' ? 'warn' : '' });
  if (r.log.length <= 1 && b.printable) L.push({ t: '--> Nothing to repair. Normals recomputed from winding on export.' });
  L.push({ t: '-> Verifying repaired file', cls: 'head' });
  push(a, true);
  L.push({ t: `-> Time needed for repair (ms): ${Math.round(r.ms)}`, cls: 'head' });
  const dv = r.counts.vertsAfter - r.counts.vertsBefore, dt = r.counts.trisAfter - r.counts.trisBefore;
  const sg = (d) => d > 0 ? `+${fmt(d)}` : d < 0 ? `−${fmt(-d)}` : '±0';
  L.push({ t: `--> Vertex count changed from ${fmt(r.counts.vertsBefore)} to ${fmt(r.counts.vertsAfter)} (${sg(dv)})`, delta: dv });
  L.push({ t: `--> Triangle count changed from ${fmt(r.counts.trisBefore)} to ${fmt(r.counts.trisAfter)} (${sg(dt)})`, delta: dt });
  if (a.printable && !a.selfIntersections) L.push({ t: '-> Ready for download.', cls: 'head' });
  else if (a.printable) L.push({ t: '-> Ready for download. Some triangles still cross (the part could not be merged exactly); most slicers handle this, "Rebuild as solid" removes it for good.', cls: 'head' });
  else L.push({ t: '-> Repaired as far as possible. Inspect the highlighted areas, or use "Rebuild as solid" for a guaranteed clean result.', cls: 'head warn' });
  return L;
}
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderConsole(lines) {
  const el = $('#console');
  el.innerHTML = lines.map((l) => {
    if (l.key) {
      const num = `<b class="${l.cls}">${fmt(l.n)}</b>`;
      return `<div class="ln">--&gt; ${num} ${esc(l.label)} <span class="q" tabindex="0" data-tip="${esc(HELP[l.key])}">(?)</span></div>`;
    }
    if (l.delta !== undefined) {
      const m = l.t.match(/^(.*\()([^)]*)(\))$/);
      const cls = l.delta > 0 ? 'ok' : l.delta < 0 ? 'bad' : '';
      return `<div class="ln">${esc(m[1])}<b class="${cls}">${esc(m[2])}</b>${esc(m[3])}</div>`;
    }
    return `<div class="ln ${l.cls || ''}">${esc(l.t)}</div>`;
  }).join('');
  el.scrollTop = 0;
}
function renderProgress(job) {
  const el = $('#console');
  const pct = Math.round((job.progress || 0) * 100);
  el.innerHTML = `<div class="ln head">-&gt; Loading ${esc(job.name)}</div><div class="ln head">-&gt; ${esc(job.stage || 'Working')}…</div><div class="ln">-&gt; Repairing: <b class="ok">${pct.toFixed(0)}%</b></div><div class="bar"><i style="width:${pct}%"></i></div>`;
}

/* ------------------------------------------------------------------ rendering */
function renderJobs() {
  const ul = $('#jobs'); ul.innerHTML = '';
  for (const j of jobs) {
    const li = document.createElement('li'); li.className = 'job' + (j === current ? ' sel' : '');
    let chip = '', cls = '';
    if (j.status === 'queued') { chip = 'queued'; cls = 'muted'; }
    else if (j.status === 'running') { chip = Math.round((j.progress || 0) * 100) + '%'; cls = 'run'; }
    else if (j.status === 'error') { chip = 'failed'; cls = 'bad'; }
    else { const a = j.result.after; chip = a.printable ? (j.result.solid ? 'solid' : 'watertight') : 'check'; cls = a.printable ? 'ok' : 'warn'; }
    const tri = j.result ? fmt(j.result.counts.trisAfter) + ' tris' : (j.size > 1048576 ? (j.size / 1048576).toFixed(1) + ' MB' : Math.round(j.size / 1024) + ' KB');
    li.innerHTML = `<span class="jn" title="${esc(j.name)}">${esc(j.name)}</span><span class="jm">${tri}</span><span class="chip ${cls}">${chip}</span>`;
    li.addEventListener('click', () => { current = j; renderJobs(); renderCurrent(); });
    ul.appendChild(li);
  }
  $('#batch').hidden = jobs.length < 2;
}
function updateBatch() { $('#dlAll').disabled = !jobs.some((j) => j.status === 'done'); }

function renderCurrent() {
  const j = current;
  const stage = $('#stage');
  if (!j) { stage.classList.add('empty'); return; }
  stage.classList.remove('empty');
  $('#jobName').textContent = j.name;
  $('#jobName').title = j.name;
  const pill = $('#verdict'); const meta = $('#jobMeta');
  $('#dl').disabled = j.status !== 'done'; $('#dlReport').disabled = j.status !== 'done';
  if (j.status === 'error') { pill.textContent = 'could not read'; pill.className = 'pill bad'; meta.textContent = j.error; $('#console').innerHTML = `<div class="ln head">-&gt; ${esc(j.name)}</div><div class="ln bad">--&gt; ${esc(j.error)}</div>`; renderStats(null); if (viewer) viewer.setMesh(null); return; }
  if (j.status !== 'done') { pill.textContent = j.status === 'running' ? 'repairing' : 'queued'; pill.className = 'pill run'; meta.textContent = j.sample ? 'generated sample with every defect type' : ''; renderProgress(j); renderStats(null); if (viewer) viewer.setMesh(null); return; }
  const a = j.result.after, b = j.result.before;
  if (j.result.solid && a.printable) { pill.textContent = 'rebuilt solid'; pill.className = 'pill ok'; }
  else if (a.printable && a.degenerateFaces === 0) { pill.textContent = 'watertight'; pill.className = 'pill ok'; }
  else if (a.printable) { pill.textContent = 'watertight · hairline slivers'; pill.className = 'pill ok'; }
  else { pill.textContent = 'needs attention'; pill.className = 'pill warn'; }
  const changed = !(b.printable && j.result.log.length <= 1);
  $('#solidBtn').hidden = !!(j.result.solid) || (a.printable && !a.selfIntersections);
  meta.textContent = (j.sample ? 'Generated sample with every defect type · ' : '') + (changed ? `${Math.round(j.result.ms)} ms · ${j.result.iterations} pass${j.result.iterations === 1 ? '' : 'es'}` : 'already clean, normals recomputed');
  renderConsole(j.lines);
  renderStats(j.result);
  renderViewer();
}

function renderStats(r) {
  const el = $('#stats');
  if (!r) { el.innerHTML = ''; return; }
  const s = r.after.stats, b = r.before.stats; const bb = s.bbox;
  const mm = (v) => v >= 1000 ? (v / 1000).toFixed(2) + ' m' : v.toFixed(2) + ' mm';
  const vol = (v) => v >= 1000 ? (v / 1000).toFixed(2) + ' cm³' : v.toFixed(2) + ' mm³';
  const area = (v) => v >= 100 ? (v / 100).toFixed(2) + ' cm²' : v.toFixed(2) + ' mm²';
  const tiles = [
    ['Size', `${mm(bb.size[0])} × ${mm(bb.size[1])} × ${mm(bb.size[2])}`, 'units as stored (mm assumed)'],
    ['Volume', s.watertight ? vol(s.volume) : '—', s.watertight ? `${r.after.stats.closedShells} closed shell${r.after.stats.closedShells === 1 ? '' : 's'}` : 'open surface'],
    ['Surface', area(s.area), ''],
    ['Triangles', fmt(s.triangles), `${fmt(s.vertices)} vertices`],
    ['Shells', fmt(r.after.shells), r.after.shells > 1 ? `${fmt(r.after.disjointShells)} extra` : 'single body'],
    ['Genus', s.genus === null ? '—' : fmt(Math.max(0, Math.round(s.genus))), s.genus === null ? 'needs a closed manifold' : 'through-holes per shell'],
  ];
  el.innerHTML = tiles.map(([k, v, sub]) => `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span></div>`).join('');
}

function renderViewer() {
  if (!viewer || !current || current.status !== 'done') return;
  const r = current.result;
  const useRepaired = viewMode === 'repaired';
  const snap = useRepaired ? r.repaired : r.original; const an = useRepaired ? r.after : r.before;
  const fill = [], flipped = [];
  if (useRepaired) for (let f = 0; f < snap.nf; f++) { if (snap.flags[f] & E.FLAG_FILL) fill.push(f); }
  viewer.setMesh(snap, {
    selfxFaces: an.selfIntersectingFaces,
    fillFaces: fill,
    invertedFaces: useRepaired ? [] : an.invertedFaceList,
    degenerateFaces: an.degenerateFaceList,
    duplicateFaces: useRepaired ? [] : an.duplicateFaceList,
    nakedEdges: an.nakedEdgeList,
    nonManifoldEdges: an.nonManifoldEdgeList,
  });
  viewer.fit();
  $('#legend').innerHTML = legendFor(an, useRepaired, fill.length);
}
function legendFor(an, repaired, fills) {
  const items = [];
  if (an.nakedEdges) items.push(['naked', `${fmt(an.nakedEdges)} naked edges`]);
  if (an.nonManifoldEdges) items.push(['nm', `${fmt(an.nonManifoldEdges)} non-manifold edges`]);
  if (!repaired && an.invertedNormals) items.push(['inv', `${fmt(an.invertedNormals)} inverted faces`]);
  if (an.degenerateFaces || (!repaired && an.duplicateFaces)) items.push(['deg', `${fmt(an.degenerateFaces + (repaired ? 0 : an.duplicateFaces))} degenerate / duplicate`]);
  if (an.selfIntersections) items.push(['selfx', `${fmt(an.selfIntersections)} self-intersecting pairs`]);
  if (repaired && fills) items.push(['fill', `${fmt(fills)} filled triangles`]);
  items.push(['back', 'inside of the surface']);
  return items.map(([c, t]) => `<span><i class="sw ${c}"></i>${esc(t)}</span>`).join('');
}

/* ------------------------------------------------------------------ downloads */
let downloadsCap = null, capChecked = false;
async function sandboxDownloads() {
  if (capChecked) return downloadsCap; capChecked = true;
  try { if (window.claude && typeof window.claude.use === 'function') downloadsCap = await window.claude.use('downloads'); } catch (e) { downloadsCap = null; }
  return downloadsCap;
}
function baseName(n) { return n.replace(/\.stl$/i, ''); }
function repairedBytes(job) {
  const s = job.result.repaired; const ascii = job.options && job.options.ascii;
  if (ascii) return new TextEncoder().encode(E.exportAsciiSTL(s.V, s.F, s.nf, baseName(job.name)));
  return new Uint8Array(E.exportBinarySTL(s.V, s.F, s.nf, baseName(job.name)));
}
function reportText(job) { return job.lines.map((l) => l.t).join('\n') + '\n'; }
async function saveBytes(filename, bytes, mime) {
  const cap = await sandboxDownloads();
  if (cap) {
    // the artifact sandbox only allows certain file types; STL travels inside a zip
    let name = filename, data = bytes;
    if (!/\.(zip|txt)$/i.test(filename)) { name = filename.replace(/\.[^.]+$/, '') + '.zip'; data = E.makeZip([{ name: filename, data: bytes }]); }
    try { await cap.save({ filename: name, data: new Blob([data]) }); toast(`Saved ${name}`); }
    catch (err) { if (err && err.code === 'declined') return; toast('Could not save: ' + (err && err.message || err), true); }
    return;
  }
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
let toastTimer = null;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200); }

/* ------------------------------------------------------------------ wiring */
function init() {
  // fonts: swap to fallback silently if blocked (nothing to do)
  const canvas = $('#gl');
  viewer = MeshViewer.create(canvas);
  if (!viewer) { $('#viewerWrap').classList.add('nogl'); $('#glMsg').textContent = 'WebGL is not available in this browser, the preview is disabled. Repairs still work.'; }
  const applyTheme = () => {
    if (!viewer) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    viewer.setColors({ body: dark ? '#b9c3cf' : '#cfd6de', wire: dark ? '#6b7684' : '#3d4653' });
  };
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  $('#file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#drop');
  const over = (e) => { e.preventDefault(); drop.classList.add('over'); };
  const leave = () => drop.classList.remove('over');
  for (const el of [drop, document.body]) { el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', (e) => { e.preventDefault(); leave(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }); }
  $('#sampleBtn').addEventListener('click', loadSample);
  $('#dl').addEventListener('click', () => { if (current && current.status === 'done') saveBytes(baseName(current.name) + '_fixed.stl', repairedBytes(current), 'model/stl'); });
  $('#dlReport').addEventListener('click', () => { if (current && current.status === 'done') saveBytes(baseName(current.name) + '_report.txt', new TextEncoder().encode(reportText(current)), 'text/plain'); });
  $('#dlAll').addEventListener('click', () => {
    const done = jobs.filter((j) => j.status === 'done'); if (!done.length) return;
    const entries = [];
    for (const j of done) { entries.push({ name: baseName(j.name) + '_fixed.stl', data: repairedBytes(j) }); entries.push({ name: baseName(j.name) + '_report.txt', data: new TextEncoder().encode(reportText(j)) }); }
    saveBytes('repaired-stl.zip', E.makeZip(entries), 'application/zip');
  });
  $('#clearBtn').addEventListener('click', () => { const keep = jobs.filter((j) => j.status === 'running'); jobs.length = 0; jobs.push(...keep); queue.length = 0; current = keep[0] || null; renderJobs(); renderCurrent(); updateBatch(); if (!current) { if (viewer) viewer.setMesh(null); $('#stage').classList.add('empty'); } });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { viewMode = b.dataset.view; for (const x of document.querySelectorAll('[data-view]')) x.classList.toggle('on', x === b); renderViewer(); });
  for (const c of document.querySelectorAll('[data-show]')) c.addEventListener('change', () => { if (viewer) viewer.setShow(c.dataset.show, c.checked); });
  $('#fitBtn').addEventListener('click', () => viewer && viewer.fit());
  const applySection = () => { const ax = parseInt($('#secAxis').value, 10); $('#secPos').disabled = ax < 0; if (viewer) viewer.setSection(ax, $('#secPos').value / 1000); };
  $('#secAxis').addEventListener('change', applySection);
  $('#secPos').addEventListener('input', applySection);
  $('#solidBtn').addEventListener('click', () => { if (!current || current.status === 'running') return; $('#optSolid').checked = true; current.status = 'queued'; current.result = null; queue.unshift(current); renderJobs(); renderCurrent(); runNext(); });
  $('#rerun').addEventListener('click', () => { if (!current || current.status === 'running') return; current.status = 'queued'; current.result = null; queue.unshift(current); renderJobs(); renderCurrent(); runNext(); });

  sandboxDownloads().then((cap) => { if (cap) { const n = document.querySelector('.actions .note'); n.textContent = 'Hosted version: files are saved as .zip (the page sandbox only allows a few file types). Normals are recomputed on export.'; } });
  makeWorker().then((w) => { worker = w; workerReady = true; $('#engineNote').textContent = w ? 'Runs in a background thread · nothing leaves your computer' : 'Runs in this tab · nothing leaves your computer'; runNext(); });

  const params = new URLSearchParams(location.search);
  const loadUrl = params.get('load');
  if (loadUrl) {
    fetch(loadUrl).then((r) => r.arrayBuffer()).then((buf) => { const name = loadUrl.split('/').pop() || 'model.stl'; addFiles([new File([buf], name)]); }).catch((e) => toast('Could not load ' + loadUrl + ': ' + e.message, true));
  } else loadSample();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
