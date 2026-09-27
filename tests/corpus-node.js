#!/usr/bin/env node
/* Run the engine over every file listed in tests/corpus.json (made by tests/make_corpus.py) and tally what is left.

   node tests/corpus-node.js [--only name] [--max-mb 50] [--merge-time 120] [--out results.json]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null), maxMb = Number(opt('--max-mb', 1e9)), mergeTime = opt('--merge-time', null), out = opt('--out', path.join(__dirname, 'out', 'corpus-results.json'));
const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
const rows = [];
const t0 = Date.now();
for (const item of list) {
  if (only && !item.path.toLowerCase().includes(only.toLowerCase())) continue;
  if (item.size > maxMb * 1048576) continue;
  const file = path.join(__dirname, item.path);
  const row = { file: path.basename(file), mb: +(item.size / 1048576).toFixed(1), mergeNote: '' };
  try {
    const buf = fs.readFileSync(file);
    const parsed = E.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), row.file);
    const r = E.repair(parsed, mergeTime === null ? {} : { mergeTimeLimit: Number(mergeTime) });
    const a = r.after, b = r.before;
    row.tris = parsed.count; row.ms = Math.round(r.ms);
    row.before = { naked: b.nakedEdges, nm: b.nonManifoldEdges, inv: b.invertedNormals, dup: b.duplicateFaces, deg: b.degenerateFaces, shells: b.shells, selfx: b.selfIntersections };
    row.after = { naked: a.nakedEdges, nm: a.nonManifoldEdges, inv: a.invertedNormals, dup: a.duplicateFaces, deg: a.degenerateFaces, shells: a.shells, selfx: a.selfIntersections, conf: a.orientationConflicts, vol: +a.stats.volume.toFixed(3) };
    row.merged = r.merge ? `${r.merge.parts}->${a.shells}` : null;
    row.mergeSkipped = r.mergeSkipped ? r.mergeSkipped.reason : null;
    row.mergeNote = (r.log.find((l) => /merge/i.test(l.t)) || {}).t || '';
    row.leftover = a.nakedEdges + a.nonManifoldEdges + a.invertedNormals + a.duplicateFaces + a.degenerateFaces + a.orientationConflicts + (a.selfIntersections || 0);
  } catch (e) { row.error = String(e && e.stack || e); }
  rows.push(row);
  const status = row.error ? 'ERROR ' + row.error.split('\n')[0] : row.leftover ? `LEFT ${row.leftover}` : 'CLEAN';
  console.log(`${status.padEnd(12)} ${row.file} ${row.tris || ''} tris ${row.ms || ''} ms ${row.after ? JSON.stringify(row.after) : ''} ${row.mergeNote.slice(0, 90)}`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const clean = rows.filter((r) => !r.error && !r.leftover).length;
console.log(`\n${rows.length} files, ${clean} clean, ${rows.filter((r) => r.error).length} errors, ${((Date.now() - t0) / 1000).toFixed(0)} s total`);
