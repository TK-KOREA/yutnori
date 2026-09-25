#!/usr/bin/env python3
"""배포 전에 실행: 앱 파일 목록과 내용 해시로 sw.js의 VERSION과 SHELL 목록을 새로 쓴다."""
import hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATTERNS = ['index.html', 'manifest.webmanifest', 'css/*.css', 'js/*.js',
            'vendor/three/*.js', 'vendor/three/addons/utils/*.js', 'icons/*.png', 'icons/*.svg', 'fonts/*.woff2']

files = sorted({p for pat in PATTERNS for p in ROOT.glob(pat)})
h = hashlib.sha256()
for p in files:
    h.update(p.relative_to(ROOT).as_posix().encode())   # 윈도에서도 / 경로(같은 해시, 정규식 치환 오류 없음)
    h.update(p.read_bytes())
version = h.hexdigest()[:12]
shell = ['./'] + ['./' + p.relative_to(ROOT).as_posix() for p in files]

sw = ROOT / 'sw.js'
src = sw.read_text(encoding='utf-8')
src = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", src)
src = re.sub(r"const SHELL = \[[^\]]*\];", 'const SHELL = [\n' + ''.join(f"  '{s}',\n" for s in shell) + '];', src, flags=re.S)
sw.write_text(src, encoding='utf-8')
print(f'VERSION {version}, {len(shell)} files')
