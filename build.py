"""Bundle src/ into single-file deliverables.

  dist/stl-repair.html  - complete standalone page (double-click to run offline)
  dist/artifact.html    - same page as a fragment for publishing as a claude.ai Artifact
"""
import re, pathlib, datetime

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)

html = (SRC / 'index.html').read_text(encoding='utf-8')
engine = (SRC / 'engine.js').read_text(encoding='utf-8')
viewer = (SRC / 'viewer.js').read_text(encoding='utf-8')
app = (SRC / 'app.js').read_text(encoding='utf-8')

def guard(js):
    # an inline script must not contain a closing script tag
    assert '</script' not in js, 'script source contains </script'
    return js

scripts = (
    '<script id="engine-src">\n' + guard(engine) + '\n</script>\n'
    '<script>\n' + guard(viewer) + '\n</script>\n'
    '<script>\n' + guard(app) + '\n</script>\n'
)
stamp = datetime.date.today().isoformat()
bundled = re.sub(r'<!--SCRIPTS-->.*?<!--/SCRIPTS-->', lambda m: scripts, html, flags=re.S)
bundled = bundled.replace('<title>Watertight</title>', '<title>Watertight</title>\n<!-- Watertight STL repair, built %s. Single file, no dependencies, runs offline. -->' % stamp)

full = re.sub(r'<!--BEGIN-DOC-->|<!--END-DOC-->', '', bundled)
(DIST / 'stl-repair.html').write_text(full, encoding='utf-8')

fragment = re.sub(r'<!--BEGIN-DOC-->.*?<!--END-DOC-->', '', bundled, flags=re.S)
(DIST / 'artifact.html').write_text(fragment.strip() + '\n', encoding='utf-8')

print('stl-repair.html: %.1f KB' % ((DIST / 'stl-repair.html').stat().st_size / 1024))
print('artifact.html:   %.1f KB' % ((DIST / 'artifact.html').stat().st_size / 1024))
