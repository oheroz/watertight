"""Copy every .stl file below a folder into tests/corpus/ and write tests/corpus.json.

    python tests/make_corpus.py "C:/Users/me/Downloads"

Duplicate names such as "part (1).stl" and files ending in "_fixed.stl" are skipped.
Then serve the project (python -m http.server 8771) and open
http://localhost:8771/tests/corpus.html?base=./  - the page reports leftovers per file
and keeps the full results in window.__corpus.
"""
import json, pathlib, re, shutil, sys

if len(sys.argv) < 2:
    print(__doc__); sys.exit(1)
src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(__file__).parent / 'corpus'
dst.mkdir(exist_ok=True)
files, seen, total = [], set(), 0
for p in sorted(src.rglob('*.stl'), key=lambda p: p.stat().st_size):
    if not p.is_file() or re.search(r'_fixed\.stl$', p.name, re.I):
        continue
    base = re.sub(r' \(\d+\)(?=\.stl$)', '', p.name, flags=re.I)
    if base.lower() in seen:
        continue
    seen.add(base.lower())
    target = dst / base
    if not target.exists():
        shutil.copy2(p, target)
    files.append({'path': 'corpus/' + base, 'size': target.stat().st_size})
    total += target.stat().st_size
json.dump(files, open(pathlib.Path(__file__).parent / 'corpus.json', 'w'), indent=1)
print(f'{len(files)} files, {total / 1e6:.0f} MB -> {dst}')
