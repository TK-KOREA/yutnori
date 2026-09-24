#!/bin/sh
# 브라우저 테스트를 headless Chrome으로 돌린다. 사용: tools/test.sh [포트]
PORT=${1:-8765}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$(dirname "$0")/.." || exit 1
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/tests/index.html"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  sleep 1
fi
"$CHROME" --headless=new --virtual-time-budget=180000 --dump-dom "http://127.0.0.1:$PORT/tests/index.html" 2>/dev/null \
  | python3 -c "import sys,re,html; d=sys.stdin.read(); m=re.search(r'<pre id=\"out\"[^>]*>(.*?)</pre>', d, re.S); out=html.unescape(m.group(1)) if m else 'NO RESULT'; print(out); sys.exit(0 if out.startswith('PASS') else 1)"
STATUS=$?
[ -n "$SERVER" ] && kill "$SERVER"
exit $STATUS
