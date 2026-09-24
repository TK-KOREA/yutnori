#!/usr/bin/env python3
"""배포 전에 실행: 앱 파일 목록과 내용 해시로 sw.js의 VERSION과 SHELL 목록을 새로 쓴다."""
import hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATTERNS = ['index.html', 'manifest.webmanifest', 'css/*.css', 'js/*.js',
            'vendor/three/*.js', 'vendor/three/addons/utils/*.js', 'icons/*.png', 'icons/*.svg']

files = sorted({p for pat in PATTERNS for p in ROOT.glob(pat)})
h = hashlib.sha256()
for p in files:
    h.update(str(p.relative_to(ROOT)).encode())
    h.update(p.read_bytes())
version = h.hexdigest()[:12]
shell = ['./'] + ['./' + str(p.relative_to(ROOT)) for p in files]

sw = ROOT / 'sw.js'
src = sw.read_text(encoding='utf-8')
src = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", src)
src = re.sub(r"const SHELL = \[[^\]]*\];", 'const SHELL = [\n' + ''.join(f"  '{s}',\n" for s in shell) + '];', src, flags=re.S)
sw.write_text(src, encoding='utf-8')
print(f'VERSION {version}, {len(shell)} files')
