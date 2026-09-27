"""Independent STL checker (numpy only; shares no code with the Watertight engine).

    python tools/verify_stl.py model.stl [more.stl ...]

Checks: every edge used by exactly two triangles with opposite directions (closed, manifold,
consistently wound), zero-area triangles, number of separate shells, signed volume (positive
means normals point outward), enclosed shells (a shell inside another), and triangle pairs that
penetrate each other (deeper than 4 float32 steps at the model's largest coordinate, since an STL
stores float32 positions). Exit code 0 when the file is clean.
"""
import struct
import sys

import numpy as np


def load(path):
    data = open(path, 'rb').read()
    if len(data) >= 84:
        n = struct.unpack('<I', data[80:84])[0]
        if 84 + 50 * n == len(data):
            rec = np.frombuffer(data[84:], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n)
            return rec['v'].astype(np.float64)
    tris, cur = [], []
    for line in data.decode('utf-8', 'replace').splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] == 'vertex':
            cur.append([float(x) for x in parts[1:]])
            if len(cur) == 3:
                tris.append(cur)
                cur = []
    return np.array(tris, dtype=np.float64)


def weld(tris):
    pts = tris.reshape(-1, 3)
    uniq, inv = np.unique(pts, axis=0, return_inverse=True)
    return uniq, inv.reshape(-1, 3)


def components(nv, faces):
    parent = np.arange(nv)

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root
    for a, b, c in faces:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(f[0]) for f in faces])
    _, comp = np.unique(roots, return_inverse=True)
    return comp


def point_in_mesh(p, V, faces):
    # parity of crossings of a ray along +x with a slight tilt (avoids hitting edges exactly)
    d = np.array([1.0, 1e-7 * 0.7071, 1e-7 * 0.3183])
    a, b, c = V[faces[:, 0]], V[faces[:, 1]], V[faces[:, 2]]
    e1, e2 = b - a, c - a
    h = np.cross(d, e2)
    det = np.einsum('ij,ij->i', e1, h)
    ok = np.abs(det) > 1e-300
    f = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = p - a
    u = f * np.einsum('ij,ij->i', s, h)
    qv = np.cross(s, e1)
    v = f * (qv @ d)
    t = f * np.einsum('ij,ij->i', e2, qv)
    hit = ok & (u > 0) & (v > 0) & (u + v < 1) & (t > 0)
    return int(hit.sum()) % 2 == 1


def penetrating_pairs(V, faces, limit=2000000):
    """Triangle pairs sharing no vertex whose interiors cross (each has corners strictly on both sides of the other)."""
    A, B, C = V[faces[:, 0]], V[faces[:, 1]], V[faces[:, 2]]
    lo, hi = np.minimum(np.minimum(A, B), C), np.maximum(np.maximum(A, B), C)
    n = len(faces)
    ext = hi.max(0) - lo.min(0)
    diag = float(np.linalg.norm(ext)) or 1.0
    cell = max(ext.max() / max(1.0, round(n ** (1 / 3))), 1e-12)
    grid = {}
    ilo = np.floor((lo - lo.min(0)) / cell).astype(np.int64)
    ihi = np.floor((hi - lo.min(0)) / cell).astype(np.int64)
    for f in range(n):
        for i in range(ilo[f, 0], ihi[f, 0] + 1):
            for j in range(ilo[f, 1], ihi[f, 1] + 1):
                for k in range(ilo[f, 2], ihi[f, 2] + 1):
                    grid.setdefault((i, j, k), []).append(f)
    N = np.cross(B - A, C - A)
    # an STL stores float32 positions: a corner closer to the other face's plane than a few float32 steps at the
    # model's largest coordinate is touching it, not through it
    big = float(np.abs(np.concatenate([lo, hi])).max()) or 1.0
    ulp = 2.0 ** (np.floor(np.log2(big)) - 23)
    eps = max(1e-9 * diag, 4 * ulp)
    seen, found = set(), 0
    fs = [set(x) for x in faces.tolist()]
    for lst in grid.values():
        if len(lst) < 2:
            continue
        for x in range(len(lst)):
            f = lst[x]
            for y in range(x + 1, len(lst)):
                g = lst[y]
                key = (f, g) if f < g else (g, f)
                if key in seen:
                    continue
                seen.add(key)
                if (lo[f] > hi[g]).any() or (lo[g] > hi[f]).any() or fs[f] & fs[g]:
                    continue
                if crosses(A, B, C, N, f, g, eps) and crosses(A, B, C, N, g, f, eps) and overlap(A, B, C, N, f, g, eps):
                    found += 1
                    if found >= limit:
                        return found
    return found


def crosses(A, B, C, N, f, g, eps):
    n = N[g]
    ln = float(np.linalg.norm(n)) or 1.0
    d = np.array([np.dot(n, A[f] - A[g]), np.dot(n, B[f] - A[g]), np.dot(n, C[f] - A[g])]) / ln
    return (d > eps).any() and (d < -eps).any()


def overlap(A, B, C, N, f, g, eps):
    # the two triangles' intervals on their planes' intersection line overlap
    D = np.cross(N[f], N[g])
    if np.linalg.norm(D) == 0:
        return False
    def interval(t, o):
        pts = [A[t], B[t], C[t]]
        n = N[o]
        d = [float(np.dot(n, p - A[o])) for p in pts]
        out = []
        for i in range(3):
            j = (i + 1) % 3
            if (d[i] > 0) != (d[j] > 0) and d[i] != d[j]:
                p = pts[i] + (pts[j] - pts[i]) * (d[i] / (d[i] - d[j]))
                out.append(float(np.dot(D, p)))
            elif d[i] == 0:
                out.append(float(np.dot(D, pts[i])))
        return (min(out), max(out)) if out else None
    ia, ib = interval(f, g), interval(g, f)
    if not ia or not ib:
        return False
    return max(ia[0], ib[0]) < min(ia[1], ib[1]) - eps * float(np.linalg.norm(D))


def check(path):
    tris = load(path)
    V, faces = weld(tris)
    n = len(faces)
    report = {'triangles': n, 'vertices': len(V)}
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    und = np.sort(e, axis=1)
    _, counts = np.unique(und, axis=0, return_counts=True)
    report['open_edges'] = int((counts == 1).sum())
    report['non_manifold_edges'] = int((counts > 2).sum())
    _, dcounts = np.unique(e, axis=0, return_counts=True)
    report['same_direction_edges'] = int((dcounts > 1).sum())  # consistent winding: each directed edge once
    area = 0.5 * np.linalg.norm(np.cross(V[faces[:, 1]] - V[faces[:, 0]], V[faces[:, 2]] - V[faces[:, 0]]), axis=1)
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    report['zero_area_triangles'] = int((area <= (1e-7 * diag) ** 2).sum())
    comp = components(len(V), faces)
    report['shells'] = int(comp.max() + 1) if n else 0
    vol = np.einsum('ij,ij->i', V[faces[:, 0]], np.cross(V[faces[:, 1]], V[faces[:, 2]])) / 6.0
    report['volume'] = round(float(vol.sum()), 4)
    enclosed = 0
    if report['shells'] > 1:
        for c in range(report['shells']):
            fc = faces[comp == c]
            probe = V[fc[0, 0]] + 1e-6 * diag * np.array([0.13, 0.27, 0.41])
            others = faces[comp != c]
            if point_in_mesh(V[fc[0, 0]], V, others):
                enclosed += 1
    report['enclosed_shells'] = enclosed
    report['penetrating_pairs'] = penetrating_pairs(V, faces)
    report['clean'] = (report['open_edges'] == 0 and report['non_manifold_edges'] == 0 and report['same_direction_edges'] == 0
                       and report['zero_area_triangles'] == 0 and report['penetrating_pairs'] == 0 and report['volume'] > 0)
    return report


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    bad = 0
    for p in sys.argv[1:]:
        r = check(p)
        bad += not r['clean']
        print(p)
        for k, v in r.items():
            print(f'  {k}: {v}')
    sys.exit(1 if bad else 0)
