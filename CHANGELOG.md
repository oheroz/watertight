# Changelog

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
