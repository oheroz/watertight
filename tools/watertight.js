#!/usr/bin/env node
/* Watertight command-line repair.

   node tools/watertight.js <input.stl> [options]

   -o, --output <file>   where to write the repaired STL (default: <input>_fixed.stl)
   --no-merge            keep overlapping parts as separate shells
   --keep-internal       keep parts that are sealed inside other parts
   --fill-hollows [pct]  solid inside: fill hollows that open only through gaps narrower than pct % of the
                         model's diagonal (default 0.5)
   --solid [voxels]      rebuild as one voxel solid (default 200 voxels on the longest side)
   --ascii               write ASCII STL instead of binary
   --report <file>       also write the text report to a file
   --json                print the result counts as JSON instead of the report
   --dry-run             analyse and repair, but write nothing
*/
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

function usage(msg) {
  if (msg) console.error(msg + '\n');
  console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 16).join('\n').replace(/^\/\* |\*\/$/gm, ''));
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) usage();
const opts = {}; let input = null, output = null, reportFile = null, json = false, dry = false, ascii = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--output') output = args[++i];
  else if (a === '--no-merge') opts.mergeParts = false;
  else if (a === '--keep-internal') opts.removeInternalParts = false;
  else if (a === '--fill-hollows') { opts.fillHollows = 0.005; if (args[i + 1] && /^[\d.]+$/.test(args[i + 1])) opts.fillHollows = parseFloat(args[++i]) / 100; }
  else if (a === '--solid') { opts.solidify = true; if (args[i + 1] && /^\d+$/.test(args[i + 1])) opts.solidifyResolution = parseInt(args[++i], 10); }
  else if (a === '--ascii') ascii = true;
  else if (a === '--report') reportFile = args[++i];
  else if (a === '--json') json = true;
  else if (a === '--dry-run') dry = true;
  else if (a.startsWith('-')) usage('Unknown option ' + a);
  else if (!input) input = a;
  else usage('Only one input file is supported');
}
if (!input) usage('No input file given');
if (!fs.existsSync(input)) usage('File not found: ' + input);
if (!output) output = input.replace(/\.stl$/i, '') + '_fixed.stl';

const buf = fs.readFileSync(input);
const parsed = E.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.basename(input));
const r = E.repair(parsed, opts);
const b = r.before, a = r.after;

const lines = [];
const counts = (x) => [
  ['Naked edges', x.nakedEdges], ['Planar holes', x.planarHoles], ['Non-planar holes', x.nonPlanarHoles],
  ['Non-manifold edges', x.nonManifoldEdges], ['Inverted normals', x.invertedNormals], ['Duplicate faces', x.duplicateFaces],
  ['Degenerate faces', x.degenerateFaces], ['Disjoint shells', x.disjointShells],
  ['Self-intersecting pairs', x.selfIntersections === null ? 'not checked' : x.selfIntersections],
];
lines.push(`-> ${path.basename(input)}: ${parsed.format} STL, ${E.fmtInt(parsed.count)} triangles`);
lines.push('-> Analyzing file');
for (const [k, v] of counts(b)) lines.push(`--> ${v} ${k}`);
lines.push('-> Repairing');
for (const l of r.log) lines.push('--> ' + l.t);
lines.push('-> Verifying repaired file');
for (const [k, v] of counts(a)) lines.push(`--> ${v} ${k}`);
const bb = a.stats.bbox;
lines.push(`-> Size ${bb.size.map((v) => v.toFixed(2)).join(' x ')}, volume ${a.stats.volume.toFixed(2)}, ${E.fmtInt(a.stats.triangles)} triangles, ${a.shells} shell${a.shells === 1 ? '' : 's'}`);
lines.push(`-> Time needed for repair (ms): ${Math.round(r.ms)}`);
const clean = a.printable && !a.selfIntersections;
lines.push(clean ? '-> Ready for printing.' : a.printable ? '-> Watertight; overlapping triangles remain (try --solid).' : '-> Repaired as far as possible; inspect the file.');
const report = lines.join('\n') + '\n';

if (json) {
  console.log(JSON.stringify({ input, output: dry ? null : output, before: pick(b), after: pick(a), ms: Math.round(r.ms), log: r.log.map((l) => l.t) }, null, 2));
} else process.stdout.write(report);
function pick(x) { return { naked: x.nakedEdges, holes: x.planarHoles + x.nonPlanarHoles, nonManifold: x.nonManifoldEdges, inverted: x.invertedNormals, duplicate: x.duplicateFaces, degenerate: x.degenerateFaces, shells: x.shells, selfIntersections: x.selfIntersections, watertight: x.stats.watertight, volume: x.stats.volume, triangles: x.stats.triangles }; }

if (!dry) {
  const s = r.repaired; const name = path.basename(output).replace(/\.stl$/i, '');
  if (ascii) fs.writeFileSync(output, E.exportAsciiSTL(s.V, s.F, s.nf, name));
  else fs.writeFileSync(output, Buffer.from(E.exportBinarySTL(s.V, s.F, s.nf, name)));
  if (reportFile) fs.writeFileSync(reportFile, report);
  if (!json) console.log('-> Wrote ' + output);
}
process.exit(clean ? 0 : 2);
