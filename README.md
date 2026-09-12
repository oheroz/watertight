# Watertight — local STL repair

A single HTML file that repairs STL files for 3D printing entirely in the browser.
Nothing is uploaded and there is no queue. It reports the same eight checks the
usual online fixers show, repairs them, verifies its own output, and lets you
look at the problems in 3D before and after.

## Use it

Open `dist/stl-repair.html` in any modern browser (double-click works, no server
needed) and drop one or more `.stl` files on it. The repaired file downloads as
`<name>_fixed.stl`; a text report is available next to it. Several files can be
queued and downloaded together as a zip.

The page also loads a generated sample part that contains every defect type so
you can see what the report and the viewer look like.

## What it checks and fixes

| Check | Repair |
| --- | --- |
| Naked edges | Micro-gaps are welded, T-junctions are stitched, remaining loops are filled |
| Planar holes | Minimum-weight triangulation; coplanar islands (e.g. a through-hole) stay open |
| Non-planar holes | Minimum-weight (dihedral-angle aware) triangulation, advancing front for very large loops |
| Non-manifold edges | Faces are paired around the edge by angle and connectivity; dangling fins and internal walls are removed; touching shells are split apart |
| Inverted normals | Winding is propagated across every shell, then each closed shell is oriented by signed volume; shells enclosed in another shell become cavities |
| Duplicate faces | Extra copies removed; opposite-facing pairs cancel out |
| Degenerate faces | Needles are collapsed, collinear slivers removed and the gap stitched |
| Disjoint shells | Counted; zero-volume shells removed; optionally small floating shells removed |

The repair passes iterate until the mesh is clean or stops improving, then a
final analysis is run on the result and shown as the verification block.
Normals are recomputed from winding on export.

## Layout

```
src/engine.js   mesh repair engine (pure JS, also runs in a Web Worker or Node)
src/viewer.js   dependency-free WebGL viewer with problem overlays
src/app.js      UI: intake, worker, console report, downloads
src/index.html  page and styles
build.py        bundles src/ into dist/stl-repair.html (standalone) and dist/artifact.html
tests/run.html  synthetic regression cases plus real files from tests/data
```

Run the tests by serving the project folder (for example
`python -m http.server 8771 --directory .`) and opening
`http://localhost:8771/tests/run.html`. Every case prints `ok` or `FAIL`.

## Limits

- Self-intersections are not detected or fixed.
- Hairline slivers thinner than float32 precision are left in place when the
  topology around them is already manifold; the report says so.
- Very broken meshes (thousands of holes, folded surfaces) are repaired as far as
  the passes get; the verification block always shows what is left.
