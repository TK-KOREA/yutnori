// 아주 작은 브라우저용 테스트 도구. 결과는 화면과 document.title("PASS 12/12" 또는 "FAIL 3/12")에 나온다.
const cases = [];
export function test(name, fn) { cases.push({ name, fn }); }

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}
export function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

/** 같은 씨앗이면 같은 수열을 내는 난수 */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export async function run() {
  const out = document.getElementById('out');
  let pass = 0;
  const fails = [];
  for (const c of cases) {
    try { await c.fn(); pass++; }
    catch (e) { fails.push({ name: c.name, err: e }); }
  }
  const total = cases.length;
  const lines = [`${fails.length ? 'FAIL' : 'PASS'} ${pass}/${total}`];
  fails.forEach(f => lines.push(`✗ ${f.name}\n   ${f.err && f.err.message}`));
  out.textContent = lines.join('\n');
  out.className = fails.length ? 'fail' : 'pass';
  document.title = lines[0];
  window.__testResult = { pass, total, fails: fails.map(f => ({ name: f.name, message: String(f.err && f.err.message) })) };
  return window.__testResult;
}
