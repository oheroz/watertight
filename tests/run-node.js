#!/usr/bin/env node
/* Regression tests in Node: the shared synthetic cases, then every STL in tests/data (if any).

   node tests/run-node.js            all cases
   node tests/run-node.js --quiet    only failures and the summary
*/
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const runCases = require('./cases.js');

const quiet = process.argv.includes('--quiet');
let fails = 0, passes = 0;
const sum = (a) => `naked=${a.nakedEdges} nm=${a.nonManifoldEdges} holesP=${a.planarHoles} holesNP=${a.planarHoles} inv=${a.invertedNormals} dup=${a.duplicateFaces} deg=${a.degenerateFaces} shells=${a.shells} conflicts=${a.orientationConflicts} V=${a.stats.vertices} T=${a.stats.triangles} vol=${a.stats.volume.toFixed(3)} wt=${a.stats.watertight}`;
const run = (name, parsed, opts) => { const r = E.repair(parsed, opts || {}); if (!quiet) console.log(`--- ${name}: ${r.ms.toFixed(0)} ms`); return r; };
const check = (name, ok, detail) => {
  if (ok) { passes++; if (!quiet) console.log('ok   ' + name); }
  else { fails++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + detail : '')); }
};
runCases(E, run, check, sum);

// real files: every one must come out clean (watertight, manifold, no crossing faces)
const dataDir = path.join(__dirname, 'data');
const files = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((f) => /\.stl$/i.test(f) && !/_fixed\.stl$/i.test(f)) : [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(dataDir, f));
  const parsed = E.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
  const r = run(f, parsed);
  const a = r.after;
  check(`${f} clean`, a.clean && !a.selfIntersections, `${sum(a)} selfx=${a.selfIntersections} (${Math.round(r.ms)} ms)`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
