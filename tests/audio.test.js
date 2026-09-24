import { test, eq, ok } from './harness.js';
import { createAudio, SFX_NAMES, EVENT_KINDS } from '../js/audio.js';
import { createVoice, pickKoreanVoice } from '../js/voice.js';
import { SPECIES } from '../js/theme.js';

/* ---------------- 효과음: 오프라인으로 그려 보고 소리 크기를 잰다 ---------------- */
const RATE = 44100, SECS = 3;

// docs/ARCHITECTURE.md "효과음 이름"에 적힌 약속(모듈 목록이 아니라 문서 기준)
const CONTRACT = ['tap', 'throwStart', 'stickLand', 'drumroll', 'result', 'hop', 'land', 'bigLand', 'whoosh',
  'shortcut', 'stack', 'capture', 'finish', 'teamDone', 'win', 'turn', 'cry', 'event', 'clap', 'pop', 'backdo',
  'bell', 'sparkle', 'select'];

const CASES = [];
for (const name of CONTRACT) {
  if (name === 'result') [-1, 1, 2, 3, 4, 5, 'nak'].forEach(r => CASES.push([name, { r }]));
  else if (name === 'hop') [0, 2, 4, 5, 9].forEach(step => CASES.push([name, { step }]));
  else if (name === 'cry') SPECIES.forEach(s => CASES.push([name, { species: s.id }]));
  else if (name === 'event') EVENT_KINDS.forEach(kind => CASES.push([name, { kind }]));
  else if (name === 'stickLand') { CASES.push([name, { vol: 1 }]); CASES.push([name, { vol: 0.3 }]); }
  else if (name === 'drumroll') { CASES.push([name, { ms: 600 }]); CASES.push([name, { ms: 1500 }]); }
  else CASES.push([name, {}]);
}

/**
 * 오프라인 렌더링이 끝날 때까지 작은 요청을 이어서 보낸다.
 * 헤드리스 Chrome의 --virtual-time-budget은 네트워크 요청이 걸려 있을 때만 시간을 멈추므로,
 * 이렇게 하지 않으면 렌더링이 끝나기 전에 가상 시간이 다 흘러 버린다. 보통 브라우저에서는 그냥 기다린다.
 */
const HEADLESS = typeof navigator !== 'undefined' && (navigator.webdriver || /Headless/.test(navigator.userAgent));
const PING = new URL('./harness.js', import.meta.url).href;
async function hold(promise) {
  if (!HEADLESS) return promise;
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    try { await fetch(PING, { cache: 'no-store' }).then(r => r.arrayBuffer()); } catch (e) { break; }
  }
  return promise;
}

/**
 * 소리를 오프라인으로 그린다. 소리는 WARM초에 건다:
 * Chrome의 컴프레서는 처음 수십 ms 동안 소리를 크게 줄여서, 0초에 건 소리는 실제(계속 켜져 있는 컨텍스트)보다 작게 잰다.
 */
const WARM = 0.25;
async function render(setup, secs = SECS) {
  const off = new OfflineAudioContext(2, Math.round(RATE * secs), RATE);
  const audio = createAudio({ context: off });
  off.suspend(WARM).then(() => { setup(audio); off.resume(); });
  return hold(off.startRendering());
}

/** play()가 알려 주는 소리 길이(초): 그리지 않고 걸어만 본다 */
function durationOf(name, params) {
  const a = createAudio({ context: new OfflineAudioContext(2, RATE, RATE) });
  return a.play(name, params).duration || 0;
}
/** 소리 하나를 끝까지(길이 + 0.75초, 적어도 SECS초) 그린다 */
const renderOne = (name, params) => render(a => { a.play(name, params); }, Math.max(SECS, WARM + durationOf(name, params) + 0.75));

/** 두 채널 합쳐 최대값과 구간 RMS */
function measure(buf, from = 0, to = buf.duration) {
  let peak = 0, sum = 0, n = 0;
  const a = Math.floor(from * buf.sampleRate), b = Math.min(buf.length, Math.floor(to * buf.sampleRate));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    for (let i = a; i < b; i++) { sum += d[i] * d[i]; n++; }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)) };
}

/* 소리 크기(LUFS-M 흉내): K 가중(1.5kHz 고역 선반 +4dB, 38Hz 고역 통과) 뒤 0.4초 창의 가장 큰 값.
   phone이면 300Hz 고역 통과(2차 두 번)를 더 건다 — 폰·태블릿 스피커는 300Hz 아래를 거의 못 낸다 */
function biquadHP(f, q, sr) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
}
function biquadShelf(f, g, sr) {
  const A = Math.pow(10, g / 40), w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), sa = Math.sqrt(A) * s * Math.SQRT2;
  return [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa];
}
function runBiquad(x, [b0, b1, b2, a0, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function loudness(buf, { phone = false, from = WARM, to = buf.duration } = {}) {
  const sr = buf.sampleRate, win = Math.round(0.4 * sr), hop = Math.round(0.05 * sr);
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    let y = runBiquad(runBiquad(buf.getChannelData(c), biquadShelf(1500, 4, sr)), biquadHP(38, 0.5, sr));
    if (phone) y = runBiquad(runBiquad(y, biquadHP(300, 0.707, sr)), biquadHP(300, 0.707, sr));
    chans.push(y);
  }
  let best = -Infinity;
  const a1 = Math.min(buf.length, Math.round(to * sr));
  for (let a = Math.round(from * sr); a + win <= a1; a += hop) {
    let s = 0;
    for (const y of chans) { let e = 0; for (let i = a; i < a + win; i++) e += y[i] * y[i]; s += e / win; }
    best = Math.max(best, -0.691 + 10 * Math.log10(s + 1e-12));
  }
  return best;
}
/** 여러 소리를 그려 크기를 잰다 → { key: { full, phone } } */
async function levels(list) {
  const out = {};
  for (const [key, name, params] of list) {
    const buf = await renderOne(name, params);
    out[key] = { full: loudness(buf), phone: loudness(buf, { phone: true }) };
  }
  return out;
}
const f1 = v => v.toFixed(1);

test('모듈 효과음 목록이 문서의 약속을 모두 담고 있다', () => {
  for (const n of CONTRACT) ok(SFX_NAMES.includes(n), `빠진 효과음: ${n}`);
});

for (const [name, params] of CASES) {
  test(`효과음 ${name} ${JSON.stringify(params)}: 들리고, 찢어지지 않고, 끝까지 사라진다`, async () => {
    const buf = await renderOne(name, params);
    const all = measure(buf);
    const tail = measure(buf, buf.duration - 0.25, buf.duration);
    ok(all.peak > 0.01, `너무 조용함(최대 ${all.peak.toFixed(4)})`);
    ok(all.peak <= 1.0, `찢어짐(최대 ${all.peak.toFixed(3)})`);
    ok(tail.rms < 0.01, `끝나지 않음(${buf.duration.toFixed(2)}초 렌더의 마지막 0.25초 RMS ${tail.rms.toFixed(4)})`);
  });
}

test('윷 결과 크기 순서(전 대역·폰 300Hz↑): 모 ≥ 윷+2 ≥ 도·개·걸+5, 빽도·낙 ≤ 윷−3, 도·개·걸 > 한 칸', async () => {
  const L = await levels([['mo', 'result', { r: 5 }], ['yut', 'result', { r: 4 }], ['do', 'result', { r: 1 }], ['gae', 'result', { r: 2 }],
    ['geol', 'result', { r: 3 }], ['back', 'result', { r: -1 }], ['nak', 'result', { r: 'nak' }], ['hop', 'hop', { step: 0 }]]);
  for (const k of ['full', 'phone']) {
    const v = n => L[n][k], dgg = Math.max(v('do'), v('gae'), v('geol')), low = Math.min(v('do'), v('gae'), v('geol'));
    const s = `[${k}] 모 ${f1(v('mo'))} 윷 ${f1(v('yut'))} 도개걸 ${f1(low)}~${f1(dgg)} 빽도 ${f1(v('back'))} 낙 ${f1(v('nak'))} 한칸 ${f1(v('hop'))}`;
    ok(v('mo') >= v('yut') + 2, `모가 윷보다 2dB 넘게 커야 함 ${s}`);
    ok(v('yut') + 2 >= dgg + 5, `윷이 도·개·걸보다 3dB 넘게 커야 함 ${s}`);
    ok(v('back') <= v('yut') - 3 && v('nak') <= v('yut') - 3, `빽도·낙은 윷보다 3dB 넘게 작아야 함 ${s}`);
    ok(low > v('hop'), `도·개·걸이 한 칸 소리보다 커야 함 ${s}`);
  }
});

test('동물 울음: 모두 한 칸 + 4dB 이하(목소리·차례 소리를 덮지 않게), 아기 호랑이는 가운데값 이하', async () => {
  const L = await levels([['hop', 'hop', { step: 0 }], ...SPECIES.map(s => [s.id, 'cry', { species: s.id }])]);
  const cries = SPECIES.map(s => L[s.id].full).sort((a, b) => a - b);
  const median = (cries[3] + cries[4]) / 2, cap = L.hop.full + 4;
  const s = SPECIES.map(x => `${x.id} ${f1(L[x.id].full)}`).join(', ');
  for (const x of SPECIES) ok(L[x.id].full <= cap, `${x.id} ${f1(L[x.id].full)} > 한 칸+4 ${f1(cap)} (${s})`);
  ok(L.tiger.full <= median, `호랑이 ${f1(L.tiger.full)} > 가운데값 ${f1(median)} (${s})`);
});

test('폰 스피커(300Hz↑): 착지 ≥ 한 칸−3dB, 쿵 착지 ≥ 한 칸+2dB, 드르륵 마지막 0.4초 ≥ 한 칸', async () => {
  const L = await levels([['hop', 'hop', { step: 0 }], ['land', 'land', {}], ['bigLand', 'bigLand', {}]]);
  const hop = L.hop.phone;
  ok(L.land.phone >= hop - 3, `착지 ${f1(L.land.phone)} < 한 칸 ${f1(hop)} − 3`);
  ok(L.bigLand.phone >= hop + 2, `쿵 착지 ${f1(L.bigLand.phone)} < 한 칸 ${f1(hop)} + 2`);
  for (const ms of [700, 1500]) {
    const buf = await renderOne('drumroll', { ms });
    const end = WARM + ms / 1000, last = loudness(buf, { phone: true, from: end - 0.4, to: end });
    ok(last >= hop, `드르륵 ${ms}ms 마지막 0.4초 ${f1(last)} < 한 칸 ${f1(hop)}`);
  }
});

test('우승 징: 2.5초 뒤에도 −35dB 넘게 울리고, 3.5초부터는 조용(RMS < 0.01)', async () => {
  const buf = await renderOne('win', {});
  const d = buf.getChannelData(0), db = (a, b) => {
    let e = 0;
    const i0 = Math.round((WARM + a) * RATE), i1 = Math.round((WARM + b) * RATE);
    for (let i = i0; i < i1; i++) e += d[i] * d[i];
    return 10 * Math.log10(e / (i1 - i0) + 1e-12);
  };
  ok(db(2.5, 3) >= -35, `2.5~3초 ${f1(db(2.5, 3))}dB`);
  ok(measure(buf, WARM + 3.5, WARM + 4).rms < 0.01, `3.5~4초 RMS ${measure(buf, WARM + 3.5, WARM + 4).rms.toFixed(4)}`);
  ok(durationOf('win', {}) >= 3.5, 'play가 알려 주는 길이도 징 끝까지');
});

test('vol은 모든 소리에 먹는다: 울음 vol 0.5는 약 6dB 작고, vol 0은 소리가 없다', async () => {
  const loud = loudness(await render(a => { a.play('cry', { species: 'dog' }); }));
  const half = loudness(await render(a => { a.play('cry', { species: 'dog', vol: 0.5 }); }));
  ok(loud - half > 4 && loud - half < 8, `차이 ${f1(loud - half)}dB`);
  let d0 = -1;
  const none = await render(a => { d0 = a.play('capture', { vol: 0 }).duration; });
  eq(d0, 0, 'vol 0은 걸지 않는다');
  ok(measure(none).peak < 1e-4, 'silent');
});

test('모르는 이름·잘못된 인자는 조용히 무시한다', async () => {
  const buf = await render(a => {
    a.play('없는소리');
    a.play('result', { r: 99 });
    a.play('cry', { species: 'unicorn' });
    a.play('event', { kind: '??' });
    a.play('hop', { step: -3 });
    a.play('stickLand', { vol: 'x' });
    a.play('tap', { vol: 'x' });
  });
  const m = measure(buf);
  ok(m.peak <= 1.0, 'no clipping');
});

test('컨텍스트가 없어도(잠금 전) 모든 함수가 던지지 않는다', () => {
  const a = createAudio();
  for (const n of CONTRACT) a.play(n, {});
  a.setEnabled({ sfx: false, music: true, haptics: false });
  a.music(false); a.setTension(true); a.duck(true); a.duck(false);
  a.buzz('win'); a.buzz('없음');
  eq(a.context, null);
  eq(typeof a.play('tap'), 'function', 'play는 늘 멈춤 함수를 돌려준다');
  eq(a.play('tap').duration, 0);
  a.dispose(); a.dispose();
  a.unlock();
  eq(a.context, null, 'dispose 뒤에는 unlock해도 컨텍스트를 만들지 않는다');
});

test('효과음을 끄면 소리가 나지 않는다', async () => {
  const buf = await render(a => { a.setEnabled({ sfx: false }); a.play('win'); a.play('capture'); });
  ok(measure(buf).peak < 1e-4, 'silent');
});

test('play는 가볍다: 소리 하나를 거는 데 평균 3ms 미만', () => {
  const off = new OfflineAudioContext(2, RATE, RATE);
  const a = createAudio({ context: off });
  const names = [...new Set(CASES.map(c => c[0]))];
  const t0 = performance.now();
  for (const n of names) a.play(n, (CASES.find(c => c[0] === n) || [])[1]);
  const per = (performance.now() - t0) / names.length;
  ok(per < 3, `평균 ${per.toFixed(2)}ms`);
});

test('드르륵·장단은 미리 그린 타악기를 쓴다: 2.5초 드르륵이 노드 100개 미만', () => {
  const off = new OfflineAudioContext(2, RATE, RATE);
  const a = createAudio({ context: off });
  let nodes = 0;
  for (const k of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner']) {
    const f = off[k].bind(off);
    off[k] = (...z) => { nodes++; return f(...z); };
  }
  a.play('drumroll', { ms: 2500 });
  ok(nodes < 100, `노드 ${nodes}개`);
});

test('여러 소리가 한꺼번에 나도 찢어지지 않는다', async () => {
  const buf = await render(a => {
    for (const [n, p] of CASES) a.play(n, p);
  });
  const m = measure(buf);
  ok(m.peak <= 1.0, `peak ${m.peak}`);
  ok(m.peak > 0.1, 'audible');
});

test('play가 돌려준 함수로 드르륵을 멈출 수 있다', async () => {
  const buf = await render(a => {
    const stop = a.play('drumroll', { ms: 2000 });
    a.context.suspend(0.75).then(() => { stop(); a.context.resume(); });
  });
  ok(measure(buf, 0.3, 0.7).rms > 0.005, '처음엔 들림');
  ok(measure(buf, 0.95, 2.4).rms < 0.002, `멈춘 뒤 조용 ${measure(buf, 0.95, 2.4).rms}`);
});

/**
 * 진짜 AudioContext 흉내: 오프라인 컨텍스트에 노드를 만들되, state와 resume()은 테스트가 정한다.
 * (startRendering을 숨겨 모듈이 실제 컨텍스트로 여기게 한다)
 */
function fakeLive(secs = 1) {
  const off = new OfflineAudioContext(2, Math.round(RATE * secs), RATE);
  const f = { state: 'suspended', resumes: 0, settle: null };
  const ctx = new Proxy(off, {
    get(t, k) {
      if (k === 'startRendering') return undefined;
      if (k === 'state') return f.state;
      if (k === 'resume') return () => { f.resumes++; return new Promise(res => { f.settle = res; }); };
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { ctx, f, off };
}

test('깨우는 중(resume이 아직 안 끝남)에도 그 탭의 소리를 건다 — 1초가 지나거나 실패하면 더 쌓지 않는다', async () => {
  const { ctx, f } = fakeLive();
  const a = createAudio({ context: ctx });
  eq(a.play('tap').duration, 0, '멈춰 있고 깨우는 중도 아니면 걸지 않는다');
  a.unlock();
  eq(f.resumes, 1, 'unlock이 resume을 부른다');
  ok(a.play('cry', { species: 'horse' }).duration > 0, '깨우는 중에는 건다');
  const real = performance.now;
  const t0 = real.call(performance);
  performance.now = () => t0 + 1500;
  try { eq(a.play('select').duration, 0, '1초 넘게 안 깨어나면 걸지 않는다'); } finally { performance.now = real; }
  f.settle(); await tick();
  eq(a.play('pop').duration, 0, 'resume이 끝났는데 아직 suspended(실패)면 걸지 않는다');
  f.state = 'running';
  ok(a.play('pop').duration > 0, '돌기 시작하면 건다');
  f.state = 'interrupted';
  a.unlock();
  eq(a.play('tap').duration, 0, 'iOS 끼어듦(interrupted)은 깨우는 중으로 치지 않는다');
  a.dispose();
});

test('미리 그리기 전(잠금 직후)의 드르륵은 노드로 합성하고, 미리 그린 것과 크기가 같다', async () => {
  const { ctx, f, off } = fakeLive(2);
  f.state = 'running';
  const live = createAudio({ context: ctx });
  live.play('drumroll', { ms: 1000 });
  const a = loudness(await hold(off.startRendering()), { from: 0 });
  const off2 = new OfflineAudioContext(2, Math.round(RATE * 2), RATE);
  createAudio({ context: off2 }).play('drumroll', { ms: 1000 });
  const b = loudness(await hold(off2.startRendering()), { from: 0 });
  ok(Math.abs(a - b) < 1, `노드 ${f1(a)} · 버퍼 ${f1(b)}`);
  live.dispose();
});

test('dispose: 음악을 멈추고, 그 뒤 play·music은 아무것도 하지 않는다', async () => {
  let after = null;
  const buf = await render(a => {
    a.music(true);
    const c = a.context;
    c.suspend(1.2).then(() => {
      try {
        a.dispose();
        after = [a.context, a.play('win').duration];
        a.music(true);
      } catch (e) { after = String(e); } finally { c.resume(); }   // 실패해도 렌더링은 끝나게
    });
  }, 4);
  ok(measure(buf, 0.4, 1.2).rms > 0.003, '처음엔 음악');
  ok(measure(buf, 2.2, 4).rms < 0.001, `dispose 뒤 조용 ${measure(buf, 2.2, 4).rms}`);
  eq(after, [null, 0]);
});

/* ---------------- 배경 음악 ---------------- */
test('굿거리 장단: 들리고, 크기가 작고(≈0.12), 찢어지지 않는다', async () => {
  const buf = await render(a => { a.music(true); }, 8);
  const m = measure(buf, 0.5, 8);
  ok(m.peak > 0.02 && m.peak < 0.5, `peak ${m.peak.toFixed(3)}`);
  ok(m.rms > 0.005 && m.rms < 0.12, `rms ${m.rms.toFixed(4)}`);
});

test('음성이 나올 때(duck) 음악이 약 30%로 줄어든다', async () => {
  const on = measure(await render(a => { a.music(true); }, 6), 1, 6).rms;
  const ducked = measure(await render(a => { a.music(true); a.duck(true); }, 6), 1, 6).rms;
  const k = ducked / on;
  ok(k > 0.18 && k < 0.45, `ratio ${k.toFixed(3)}`);
});

/** 장단의 한 박(점4분음표) 길이(초): 낮은 대역 에너지 곡선의 자기상관이 가장 큰 지연 */
function beatPeriod(buf) {
  const d = buf.getChannelData(0), hop = 441, k = 1 - Math.exp(-2 * Math.PI * 200 / buf.sampleRate);
  const env = [];
  let lp = 0, e = 0;
  for (let i = 0; i < d.length; i++) {
    lp += k * (d[i] - lp);
    e += lp * lp;
    if ((i + 1) % hop === 0) { env.push(e); e = 0; }
  }
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = env.map(v => v - mean);
  let best = 0, bestLag = 0;
  for (let lag = 60; lag <= 100; lag++) {        // 0.6 ~ 1.0초
    let c = 0;
    for (let i = 0; i + lag < x.length; i++) c += x[i] * x[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag * hop / buf.sampleRate;
}

test('장단 빠르기: 보통 72bpm(한 박 0.83초), 막판 긴장 90bpm(0.67초)', async () => {
  const calm = beatPeriod(await render(a => a.music(true), 10));
  const fast = beatPeriod(await render(a => { a.setTension(true); a.music(true); }, 10));
  ok(Math.abs(calm - 60 / 72) < 0.04, `보통 한 박 ${calm.toFixed(3)}초`);
  ok(Math.abs(fast - 60 / 90) < 0.04, `긴장 한 박 ${fast.toFixed(3)}초`);
});

test('음악을 끄면 조용해진다', async () => {
  const buf = await render(a => {
    a.music(true);
    a.context.suspend(1.2).then(() => { a.music(false); a.context.resume(); });
  }, 4);
  ok(measure(buf, 0.4, 1.2).rms > 0.003, 'on');
  ok(measure(buf, 2.2, 4).rms < 0.001, `off ${measure(buf, 2.2, 4).rms}`);
});

/* ---------------- 읽어 주기: 가짜 speechSynthesis ---------------- */
class FakeUtterance {
  constructor(text) { this.text = text; this.volume = 1; this.onend = null; this.onerror = null; }
}
function fakeSynth(voices = [{ name: 'Yuna', lang: 'ko-KR' }]) {
  const s = {
    list: voices, spoken: [], cancels: 0, resumes: 0, paused: false, current: null, listeners: [],
    get speaking() { return !!this.current; },
    pending: false,
    getVoices() { return this.list; },
    speak(u) { this.spoken.push(u); if (u.volume > 0) this.current = u; },
    cancel() {
      this.cancels++;
      const u = this.current;
      this.current = null;
      // 진짜 브라우저처럼 끊긴 문장의 error는 나중에 온다
      if (u) setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0);
    },
    resume() { this.resumes++; this.paused = false; },
    addEventListener(t, f) { this.listeners.push(f); },
    removeEventListener(t, f) { this.listeners = this.listeners.filter(x => x !== f); },
    /** 지금 문장을 끝까지 읽은 것처럼 */
    end() { const u = this.current; this.current = null; if (u && u.onend) u.onend({}); },
    texts() { return this.spoken.filter(u => u.volume > 0).map(u => u.text); },
  };
  return s;
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('한국어 목소리 고르기: Yuna > Google 한국의 > Heami > SunHi > 다른 ko, 외국어는 안 고름', () => {
  const V = (name, lang) => ({ name, lang });
  eq(pickKoreanVoice([V('Alex', 'en-US'), V('Google 한국의', 'ko-KR'), V('Yuna', 'ko-KR')]).name, 'Yuna');
  eq(pickKoreanVoice([V('Microsoft SunHi Online', 'ko-KR'), V('Microsoft Heami', 'ko-KR')]).name, 'Microsoft Heami');
  eq(pickKoreanVoice([V('Samsung Korean', 'ko_KR'), V('Kyoko', 'ja-JP')]).name, 'Samsung Korean');
  eq(pickKoreanVoice([V('Alex', 'en-US'), V('Kyoko', 'ja-JP')]), null);
  eq(pickKoreanVoice([]), null);
});

test('한국어 macOS의 "유나"를 알아보고, 기계음 같은 Eloquence 목소리(Eddy 등)는 피한다', () => {
  const V = (name, lang, extra = {}) => ({ name, lang, voiceURI: name, localService: true, ...extra });
  const mac = [V('Eddy (한국어(대한민국))', 'ko-KR'), V('Grandma (한국어(대한민국))', 'ko-KR'), V('유나', 'ko-KR', { default: true })];
  eq(pickKoreanVoice(mac).name, '유나');
  eq(pickKoreanVoice([V('Eddy (한국어(대한민국))', 'ko-KR'), V('Some Korean', 'ko-KR')]).name, 'Some Korean');
  eq(pickKoreanVoice([V('Eddy (한국어(대한민국))', 'ko-KR')]).name, 'Eddy (한국어(대한민국))', '그것밖에 없으면 그래도 쓴다');
  eq(pickKoreanVoice([V('Yuna', 'ko-KR', { voiceURI: 'com.apple.voice.compact.ko-KR.Yuna' }),
    V('Yuna (Premium)', 'ko-KR', { voiceURI: 'com.apple.voice.premium.ko-KR.Yuna' })]).name, 'Yuna (Premium)');
});

test('읽기 설정: ko-KR, 빠르기 1.05, 높이 1.15, 고른 목소리', async () => {
  const s = fakeSynth([{ name: 'Alex', lang: 'en-US' }, { name: 'Yuna', lang: 'ko-KR' }]);
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  eq(await v.ready, true);
  ok(v.say('걸! 양, 세 칸'));
  const u = s.spoken[0];
  eq([u.lang, u.rate, u.pitch, u.voice.name], ['ko-KR', 1.05, 1.15, 'Yuna']);
});

test('한국어 목소리가 없으면 available=false, say는 아무것도 하지 않는다', async () => {
  const s = fakeSynth([{ name: 'Alex', lang: 'en-US' }]);
  const t0 = performance.now();
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  eq(await v.ready, false);
  ok(performance.now() - t0 < 1900, 'ready는 1.5초 안에 풀린다');
  eq(v.available, false);
  eq(v.say('안녕', { prio: 'high' }), false);
  eq(s.spoken.length, 0);
});

test('voiceschanged로 늦게 온 목소리를 기다린다', async () => {
  const s = fakeSynth([]);
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  setTimeout(() => { s.list = [{ name: 'Google 한국의', lang: 'ko-KR' }]; s.listeners.slice().forEach(f => f({})); }, 30);
  const t0 = performance.now();
  eq(await v.ready, true);
  ok(performance.now() - t0 < 1000, '이벤트가 오면 바로 풀린다');
  eq(v.voice.name, 'Google 한국의');
});

test('speechSynthesis가 없으면 supported=false이고 던지지 않는다', async () => {
  const v = createVoice({ synth: null, Utterance: FakeUtterance });
  eq(v.supported, false);
  eq(await v.ready, false);
  eq(v.say('안녕'), false);
  v.unlock(); v.cancel(); v.setEnabled(false);
});

test('high는 지금 것을 끊고 바로 읽는다', async () => {
  const s = fakeSynth();
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  await v.ready;
  v.say('호랑이팀 차례!');
  v.say('모다! 다섯 칸, 한 번 더!', { prio: 'high' });
  eq(s.texts(), ['호랑이팀 차례!', '모다! 다섯 칸, 한 번 더!']);
  ok(s.cancels >= 1, 'cancel 먼저');
  eq(s.current.text, '모다! 다섯 칸, 한 번 더!');
});

test('normal은 말하는 중인 normal을 바꾸고, high 중이면 끝난 뒤 읽는다(대기는 하나)', async () => {
  const s = fakeSynth();
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  await v.ready;
  v.say('하나');
  v.say('둘');                                   // 바꿔 치기
  eq(s.current.text, '둘');
  v.say('잡았다! 한 번 더 던져요', { prio: 'high' });
  v.say('셋');                                   // high 중 → 대기
  v.say('넷');                                   // 대기를 바꿈
  eq(s.current.text, '잡았다! 한 번 더 던져요');
  await tick();                                  // 끊긴 문장의 늦은 error가 대기를 건드리지 않아야 함
  eq(s.current.text, '잡았다! 한 번 더 던져요');
  s.end();
  eq(s.current.text, '넷');
  eq(s.texts(), ['하나', '둘', '잡았다! 한 번 더 던져요', '넷']);
});

test('high 뒤에서 4초 넘게 기다린 normal은 버린다(지난 일을 늦게 읽지 않음)', async () => {
  const s = fakeSynth(), log = [];
  const v = createVoice({ synth: s, Utterance: FakeUtterance, onSpeaking: b => log.push(b) });
  await v.ready;
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    v.say('모모팀 우승! 축하해요!', { prio: 'high' });
    v.say('걸! 양, 세 칸');                      // 대기
    now += 5000;
    s.end();
    eq(s.current, null);
    eq(s.texts(), ['모모팀 우승! 축하해요!']);
    eq(log, [true, false]);
  } finally { Date.now = real; }
});

test('low는 무엇이든 말하는 중이면 버리고, 조용할 때만 읽는다', async () => {
  const s = fakeSynth();
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  await v.ready;
  v.say('완주!');
  eq(v.say('좋아요', { prio: 'low' }), false);
  s.end();
  eq(v.say('좋아요', { prio: 'low' }), true);
  eq(s.texts(), ['완주!', '좋아요']);
});

test('onSpeaking은 시작 true, 끝 false — 바꿔 치기 중에는 깜빡이지 않는다', async () => {
  const s = fakeSynth(), log = [];
  const v = createVoice({ synth: s, Utterance: FakeUtterance, onSpeaking: b => log.push(b) });
  await v.ready;
  v.say('하나');
  v.say('둘');
  await tick();
  eq(log, [true]);
  s.end();
  eq(log, [true, false]);
  eq(v.speaking, false);
});

test('끄면 멈추고 읽지 않으며, 멈춰 있는(paused) 합성기는 깨운다', async () => {
  const s = fakeSynth(), log = [];
  const v = createVoice({ synth: s, Utterance: FakeUtterance, onSpeaking: b => log.push(b) });
  await v.ready;
  s.paused = true;
  v.say('업었다! 두동무니');
  ok(s.resumes >= 1, 'resume');
  v.setEnabled(false);
  eq(log, [true, false]);
  eq(v.say('모모팀 우승! 축하해요!', { prio: 'high' }), false);
  eq(s.texts(), ['업었다! 두동무니']);
});

test('unlock은 소리 없는 문장을 한 번만 읽고 onSpeaking을 부르지 않는다', async () => {
  const s = fakeSynth(), log = [];
  const v = createVoice({ synth: s, Utterance: FakeUtterance, onSpeaking: b => log.push(b) });
  v.unlock(); v.unlock();
  eq(s.spoken.length, 1);
  eq(s.spoken[0].volume, 0);
  eq(log, []);
});

test('wait로 읽으면 말하는 중인 문장을 끊지 않고 뒤에 줄 선다', async () => {
  const s = fakeSynth();
  const v = createVoice({ synth: s, Utterance: FakeUtterance });
  await v.ready;
  const before = s.cancels;
  v.say('업었다! 두동무니');
  v.say('모모팀 차례!', { wait: true });
  eq(s.current.text, '업었다! 두동무니');
  s.end();
  eq(s.current.text, '모모팀 차례!');
  eq(s.cancels - before <= 1, true, '끊지 않음');
});
