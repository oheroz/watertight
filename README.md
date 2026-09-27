# Watertight

**Free STL repair for 3D printing that runs entirely in your browser.**
One HTML file. Nothing is uploaded, there is no queue, and there is no file size
limit beyond your own memory.

Watertight reports the same checks the usual online fixers show, repairs them,
verifies its own output, and shows you the problems in 3D before and after.
Overlapping parts are merged into one solid with an exact boolean union, and
for printing it can make a model solid inside: hollows that the outside only
reaches through narrow gaps (a hollow grip with loose parts in it, parts sealed
inside parts) are filled, while every outside surface keeps its triangles.

## Get it

- **Use it online:** https://oheroz.github.io/watertight/ (the same single
  file served by GitHub Pages; nothing is uploaded, everything runs in your
  browser).
- **Download for offline use:** [stl-repair.html from the latest
  release](https://github.com/oheroz/watertight/releases/latest/download/stl-repair.html),
  or `dist/stl-repair.html` in this repository. Open it in any modern browser
  (Chrome, Edge, Firefox, Safari); double-clicking the file works, no install,
  no internet connection needed after the download.

Drop one or more `.stl` files on the page. Each repaired file downloads as
`<name>_fixed.stl`, with a plain-text report next to it. Several files can be
queued and downloaded together as a zip.

A generated sample part with every defect type loads on start so you can see
what the report and the viewer look like.

## What it checks and fixes

| Check | What Watertight does |
| --- | --- |
| Naked edges | Micro-gaps are welded, T-junctions are stitched, remaining loops are filled |
| Planar holes | Minimum-weight triangulation; coplanar islands (a through-hole in a missing face) stay open |
| Non-planar holes | Minimum-weight triangulation that keeps the surface smooth; advancing front for very large loops |
| Non-manifold edges | Faces are paired around the edge by angle and connectivity; dangling fins and internal walls are removed; touching shells are split apart |
| Inverted normals | Winding is propagated across every shell, each closed shell is oriented by signed volume, shells fully enclosed in another shell become cavities |
| Duplicate faces | Extra copies removed; an opposite-facing pair keeps the copy that agrees with its neighbours, or both go if they form a flap |
| Degenerate faces | Needles are collapsed, collinear slivers removed and the gap stitched, hairline slivers are flipped or collapsed away |
| Disjoint shells | Overlapping and touching parts are merged; parts sealed inside others removed; zero-volume shells removed; optionally small floating shells removed |
| Self-intersections | Overlapping parts are cut exactly where they cross and hidden geometry is dropped; anything left is highlighted, and "Rebuild as solid" removes it |

The repair passes iterate until the mesh is clean or nothing changes any more,
then a final analysis runs on the result and is shown as the verification
block. Normals are recomputed from winding on export.

**Merge overlapping parts** (on by default) computes the exact union of all
parts: coordinates are put on an integer grid, intersection points are exact
rationals, every orientation test is exact, and each cut region is kept or
dropped by its winding number. Parts lying flush on each other are fused, and
voids trapped between merged parts are filled. The merged solid is checked
against the original parts before it is used; if they disagree, the parts are
kept separate and the report says so. The few crossings that rounding the
result to float32 can leave in nearly coincident spots are rebuilt locally.

**Fill interior hollows** (opt-in) rolls a ball of the chosen gap width around
the outside on a voxel grid; empty space the ball cannot reach, and that
reaches deeper than a shallow groove, is filled with a voxel solid that is
merged exactly with the model. The default gap width is 0.5 % of the model's
diagonal; raise it if narrow slits into a hollow remain open, lower it if
grooves on the outside get filled.

**Rebuild as solid** classifies the model on a voxel grid (winding number along
grid lines in all three axes, exact crossing positions kept so flat faces stay
flat) and extracts a new surface. The result is one manifold, watertight,
self-intersection-free solid; overlapping parts are merged. Corners are rounded
to one voxel and features thinner than a voxel are lost, so it is an opt-in
step, offered when the normal repair leaves something behind.

## Results on real files

Tested on 126 STL files from the wild: game assets, scans, CAD exports and AI
generated meshes, 4 KB to 97 MB, up to 1.9 million triangles, 20.7 million
triangles in total. The whole corpus repairs in about 2.5 minutes on a laptop.

| | Before | After |
| --- | ---: | ---: |
| Naked edges | 436,632 | 0 |
| Non-manifold edges | 328,790 | 0 |
| Inverted faces | 570,634 | 0 |
| Duplicate faces | 210,786 | 0 |
| Degenerate faces | 32,932 | 5 |
| Holes | 30,640 | 0 |
| Files watertight and manifold | 51 of 126 | 126 of 126 |

The five remaining triangles are hairline slivers thinner than float32
precision on four files, each with intact manifold topology; the report lists
them. Self-intersections are reported separately and removed by the solid
rebuild.

For comparison, the fixed copies produced by formware.co's online repair for
three of these files still contained non-manifold edges and hundreds of
degenerate faces.

To run the corpus yourself: `python tests/make_corpus.py <folder with STL
files>` copies the files into `tests/corpus/` and writes `tests/corpus.json`,
then open `tests/corpus.html?base=./` from the dev server.

## Command line

With Node.js:

```
node tools/watertight.js model.stl                      repair, writes model_fixed.stl
node tools/watertight.js model.stl --fill-hollows       solid inside (gap width 0.5 % of the diagonal)
node tools/watertight.js model.stl --fill-hollows 1 -o solid.stl
node tools/watertight.js model.stl --solid 250          voxel rebuild at 250 voxels
```

`--help` lists every option. The exit code is 0 when the result is clean.

Checking a result independently:

```
python tools/verify_stl.py solid.stl                    closed, manifold, consistent winding, shells, penetrating triangles (numpy only)
node tools/compare_solid.js model_fixed.stl solid.stl   material lost or added between two files
node tools/section_png.js cut.png 0 0.5 500 a.stl b.stl cross-sections side by side, the way a slicer sees them
```

## Project layout

```
src/engine.js      mesh repair engine (pure JS: browser, Web Worker or Node)
src/viewer.js      dependency-free WebGL viewer with problem overlays and a section plane
src/app.js         UI: intake, worker, console report, downloads
src/index.html     page and styles
build.py           bundles src/ into dist/stl-repair.html (standalone), docs/index.html (GitHub Pages) and dist/artifact.html
tools/             command-line repair and independent checking tools
tests/cases.js     regression cases (synthetic defects), shared by the two runners
tests/run-node.js  runs the cases, then every STL in tests/data, in Node
tests/run.html     the same in a browser
tests/corpus-node.js, tests/corpus.html   batch run over a folder of STL files, tallies leftovers per file
```

Build: `python build.py` (Python 3, no packages). Tests: `node tests/run-node.js`,
or serve the folder (`python -m http.server 8771`) and open
`http://localhost:8771/tests/run.html`; every case prints `ok` or `FAIL`.

## Using the engine directly

`src/engine.js` has no DOM dependencies:

```js
const parsed = STLRepair.parseSTL(arrayBuffer);
const r = STLRepair.repair(parsed, { mergeParts: true, fillHollows: 0 });   // fillHollows: 0.005 = solid inside
console.log(r.before.nakedEdges, r.after.nakedEdges, r.log.map((l) => l.t));
const stl = STLRepair.exportBinarySTL(r.repaired.V, r.repaired.F, r.repaired.nf, 'part');
```

Options and their defaults are in `STLRepair.DEFAULTS`.

## Limits

- The exact merge rejects its result when it disagrees with the parts (very
  broken inputs with hundreds of overlapping, non-manifold pieces); those
  parts stay separate and their crossings are reported. The solid rebuild is
  the fallback.
- Filling hollows works on a voxel grid (at most about 16 million voxels), so
  the gap width is only as exact as a voxel; a slit narrower than a voxel is
  covered by the filling but stays as a hairline crack from the outside.
- Hairline slivers thinner than float32 precision may be left in place when
  flipping or collapsing them would fold a neighbour; the report says so.
- Very broken meshes are repaired as far as the passes get; the verification
  block always shows what is left, and the solid rebuild is the fallback.

MIT licensed.
