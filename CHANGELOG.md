# Changelog

## 2.0.0 — 2026-09-27

Models that were never meant to be printed, such as models exported from games,
come out as one printable object: overlapping, open, hollow pieces are closed,
merged into one exact solid and, on request, filled solid inside. A Desert
Eagle from Counter-Strike 2 (36 pieces, 1,193 naked edges, 75 holes, 1,946
crossing triangle pairs) becomes one solid with no defects.

- Overlapping parts are merged into one solid by an exact boolean union:
  coordinates on an integer grid, rational (BigInt) intersection points,
  exact predicates with a floating-point filter, and classification of every
  cut region by winding number. Flush contacts (faces of two parts lying on
  each other) are fused. The result is cross-checked against the parts and
  kept only if it agrees; otherwise the parts stay separate and the report
  says why.
- Hairline gaps between parts: test points never step across another
  surface, so both walls of a gap and anything crossing it are judged the
  same way; strips too thin to test are decided so the surface closes.
- Parts sealed inside other parts, and voids trapped between merged parts,
  are removed.
- Crossings that rounding to float32 leaves in thin, nearly coincident spots
  are rebuilt locally at the end, checked on exactly what the file holds.
- Fill interior hollows (opt-in, "solid inside" for printing): space the
  outside reaches only through gaps narrower than a chosen width (default
  0.5 % of the model's diagonal) is filled with a voxel solid that is merged
  exactly with the model, so every surface outside the hollows keeps its
  original triangles. Shallow grooves and engraving stay open. If the union
  comes out unclean, the fill lattice is turned and the fill tried again.
- Faces cut by many other parts (a plate under lettering, a base under a crowd
  of parts) are triangulated with a constrained Delaunay triangulation (exact
  orientation tests) instead of the greedy one, whose cost grew with the cube of
  the points on the face: merges that ran for more than 10 minutes take seconds.
- Merging gives up after a time limit (default 2 minutes, shared with filling
  hollows; "Merge time limit" in the settings, `--merge-time` in the CLI) or past
  1.5 million crossing triangle pairs, keeps the parts as separate shells and
  says why.
- A part that crosses itself (a keychain drawn as one shell) is merged with
  itself; the volume check no longer takes its signed volume, which counts the
  overlap twice, as a lower bound.
- A wall touching another part's wall within float noise, at an angle the flush
  snap cannot make exact, no longer drags the rest of its region with it: test
  points that step over such a surface only decide a region when nothing in it
  has a clear view (before, whole panels could vanish from the union).
- The float32 untangle step stops before a round that changes the volume: on a
  small mesh with many crossings its widening rings could eat most of the model.
- Self-intersections are now part of the final verification.
- Section view (clip plane on X, Y or Z) in the viewer.
- Command-line tool `tools/watertight.js`, independent checker
  `tools/verify_stl.py` (numpy only), `tools/section_png.js` (cross-section
  images) and `tools/compare_solid.js` (material lost or added between two
  files).
- Node test runner `tests/run-node.js` and corpus runner
  `tests/corpus-node.js`; shared test cases in `tests/cases.js`.

## 1.0.0 — 2026-09-12

First release.

- Parser for binary and ASCII STL with invalid-value sanitising.
- Exact vertex welding plus tolerance welding of boundary vertices.
- Analysis: naked edges, planar and non-planar holes, non-manifold edges,
  inverted normals (with cavity detection), duplicate faces, degenerate faces,
  disjoint shells, self-intersecting triangle pairs, orientation folds.
- Repair passes: gap closing, needle collapse, collinear sliver removal with
  T-junction stitching, duplicate resolution by neighbour agreement,
  non-manifold edge pairing with fin removal and vertex splitting, winding
  propagation, fold cutting, hole filling (minimum-weight triangulation, ear
  clipping with islands, advancing front), hairline sliver flips and collapses,
  global orientation with nested-shell handling, zero-volume and small shell
  cleanup.
- Rebuild as solid: voxel classification by winding number with exact edge
  crossings, surface nets extraction, then the normal repair.
- Single-file app with Web Worker processing, batch queue, zip download,
  before/after WebGL viewer with problem overlays, light and dark themes.
- Regression suite of synthetic defects and real files; corpus runner.
