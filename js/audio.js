// 효과음·동물 울음·굿거리 장단(배경 음악)·진동. 소리 파일 없이 전부 WebAudio로 합성한다.
// 소리 길: 소리마다 작은 게인 → 효과음 버스 ─┐
//                         음악 세션 → 음악 버스 ─┴→ 컴프레서 → 마스터 → 부드러운 리미터 → 스피커
// AudioContext는 unlock()(사용자 탭 안)에서 처음 만든다. 그 전의 play()는 조용히 무시된다.
// 소리 크기 순서(폰 스피커 기준, tests/audio.test.js가 지킨다): 모 > 윷 > 도·개·걸 > 한 칸, 빽도·낙은 윷보다 3dB 이상 작게,
// 동물 울음은 한 칸 + 3dB 안팎(목소리·효과음을 덮지 않게).
import { STEP_NOTES, speciesById } from './theme.js';

/** 효과음 이름 (docs/ARCHITECTURE.md "효과음 이름"과 같다) */
export const SFX_NAMES = [
  'tap', 'throwStart', 'stickLand', 'drumroll', 'result', 'hop', 'land', 'bigLand', 'whoosh', 'shortcut',
  'stack', 'capture', 'finish', 'teamDone', 'win', 'turn', 'cry', 'event', 'clap', 'pop', 'backdo', 'bell',
  'sparkle', 'select',
];
export const EVENT_KINDS = ['gift', 'magpie', 'gate', 'puddle', 'friend', 'mission'];

/** 진동 패턴(ms) — iOS 등 지원하지 않는 곳에서는 조용히 무시 */
export const BUZZ = {
  tap: 8, land: 15, yutmo: [30, 40, 30, 40, 60], capture: [80, 50, 120], stack: [20, 30, 20],
  finish: [20, 30, 20, 30, 100], win: [100, 60, 100, 60, 300],
};

const MUSIC_VOL = 0.12;     // 음악 버스 크기
const DUCK = 0.3;           // 음성이 나올 때 음악 배율
const MASTER = 0.72;        // 컴프레서 뒤 마스터(약 −3dB)
const MAX_VOICES = 24;      // 한꺼번에 울릴 수 있는 효과음 수(아이가 마구 눌러도 소리가 뭉개지지 않게)
const IMPORTANT = new Set(['result', 'capture', 'finish', 'teamDone', 'win', 'turn', 'event', 'cry']);
/** 같은 소리를 다시 낼 수 있는 최소 간격(초) */
const GAP = { tap: 0.045, select: 0.045, pop: 0.035, stickLand: 0.012, hop: 0.02, sparkle: 0.06, clap: 0.2 };
/** 장단 빠르기(점4분음표 bpm): 보통 72, 막판 긴장 90 */
const BPM = { calm: 72, tense: 90 };
/**
 * 배경 음악 조옮김(반음). 0이면 황종 G 평조(G A C D E)로, 말이 한 칸 갈 때 나는 5음(STEP_NOTES)과 같은 음들이라
 * 효과음과 부딪히지 않는다. −4로 하면 전통 황종 E♭ 평조(E♭ F A♭ B♭ C).
 */
const MUSIC_SHIFT = 0;
/** 장단 안의 악기 크기(음악 버스 MUSIC_VOL 앞) — 효과음보다 한참 뒤에 깔리도록 */
const MIX = { drum: 0.42, daegeum: 0.17, gayageum: 0.17 };

const NOOP = () => {};
NOOP.duration = 0;
const GESTURES = ['pointerdown', 'touchend', 'keydown'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

/** 5음계 i번째 음(0 = C5). 음수면 아래 옥타브, 5 이상이면 위 옥타브 */
export function pent(i) {
  const o = Math.floor(i / 5), k = ((i % 5) + 5) % 5;
  return STEP_NOTES[k] * Math.pow(2, o);
}

/** 컴프레서 뒤에 두는 부드러운 리미터 곡선: 0.7까지는 그대로, 그 위는 0.92에 닿도록 눌러 준다 */
function softClipCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1, a = Math.abs(x);
    const y = a <= 0.7 ? a : 0.7 + 0.22 * Math.tanh((a - 0.7) / 0.22);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/* ---------------- 미리 그려 두는 타악기 ---------------- */
// 드르륵·장단처럼 자주 치는 소리는 JS로 한 번 그려 두고(변주 3개) 버퍼 + 게인, 노드 2개로 다시 튼다.
// 한 방마다 오실레이터·필터를 9~13개씩 만들면, 싼 폰에서는 네 번째 가락이 흔들리는 조마조마한 순간에 프레임이 끊길 수 있다.
// 부품: 음 { f: Hz 또는 [[초, Hz], …], dur, vol, a, wave: 'sine'|'tri'|'sq' } · 잡음 { noise: 'bp'|'lp', f, q, dur, vol, a }
// (폰 스피커는 300Hz 아래를 거의 못 내므로, 낮은 소리마다 귀가 기음을 짐작할 배음·가죽 소리를 넉넉히 넣는다)
const HITS = {
  // 장구 북편 "쿵": 내려가는 사인 + 배음 + 낮은 잡음 + 가죽 "똑"
  kung: [
    { f: [[0, 150], [0.12, 62]], dur: 0.4, vol: 0.44 },
    { f: [[0, 310], [0.1, 128]], dur: 0.16, vol: 0.2, wave: 'tri' },
    { noise: 'lp', f: 250, dur: 0.04, vol: 0.22 },
    { f: [[0, 540], [0.06, 300]], dur: 0.07, vol: 0.3, a: 0.002 },
    { noise: 'bp', f: 650, q: 1.4, dur: 0.03, vol: 0.14 },
  ],
  // 장구 채편 "덕": 높은 대역 잡음 + 짧은 딸깍 + 채편 울림(f 3200 기준, 다른 f는 빠르기로 옮긴다)
  deok: [
    { noise: 'bp', f: 3200, q: 1.2, dur: 0.035, vol: 0.5 },
    { f: 1100, dur: 0.015, vol: 0.06, wave: 'sq' },
    { f: [[0, 540], [0.05, 470]], dur: 0.06, vol: 0.16, wave: 'tri', a: 0.002 },
  ],
  // 북 드르륵 한 방
  roll: [
    { f: [[0, 125], [0.08, 72]], dur: 0.1, vol: 0.28 },
    { f: [[0, 250], [0.06, 150]], dur: 0.06, vol: 0.2, wave: 'tri' },
    { f: [[0, 520], [0.04, 330]], dur: 0.05, vol: 0.5, wave: 'tri', a: 0.002 },
    { noise: 'bp', f: 1100, q: 0.7, dur: 0.035, vol: 0.7 },
  ],
};
const HIT_VARIANTS = 3;

/** WebAudio BiquadFilter와 같은 계수(lowpass의 Q는 dB, bandpass의 Q는 배수) → [b0, b1, b2, a1, a2] */
function biquad(type, f, q, sr) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w);
  const al = type === 'lp' ? s / (2 * Math.pow(10, (q === undefined ? 1 : q) / 20)) : s / (2 * (q === undefined ? 1 : q));
  const a0 = 1 + al;
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [al, 0, -al];
  return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - al) / a0];
}

/** 타악기 한 방을 JS로 그린다: tone()·noise()와 같은 봉투(1e-4 → vol → 1e-4, 지수)와 음높이 곡선 */
function renderHit(parts, sr, seed = 1) {
  const len = Math.max(...parts.map(p => p.dur)) + 0.01;
  const out = new Float32Array(Math.ceil(len * sr));
  let s = seed >>> 0 || 1;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
  for (const p of parts) {
    const n = Math.min(out.length, Math.ceil(p.dur * sr)), na = Math.max(1, Math.round((p.a || (p.noise ? 0.002 : 0.004)) * sr));
    const up = Math.pow(p.vol / 1e-4, 1 / na), down = Math.pow(1e-4 / p.vol, 1 / Math.max(1, n - na));
    let g = 1e-4;
    if (p.noise) {
      const [b0, b1, b2, a1, a2] = biquad(p.noise, p.f, p.q, sr);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const x = rand(), y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] += y * g;
        g *= i < na ? up : down;
      }
      continue;
    }
    const pts = Array.isArray(p.f) ? p.f : [[0, p.f]];
    let hz = pts[0][1], mul = 1, k = 1, next = 0, ph = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) {                              // 음높이 곡선의 다음 구간(지수)
        if (k < pts.length) {
          const m = Math.max(1, Math.round((pts[k][0] - pts[k - 1][0]) * sr));
          hz = pts[k - 1][1]; mul = Math.pow(pts[k][1] / hz, 1 / m); next = i + m; k++;
        } else { hz = pts[pts.length - 1][1]; mul = 1; next = Infinity; }
      }
      let w;
      if (p.wave === 'tri') w = 1 - 4 * Math.abs(ph - 0.5);
      else if (p.wave === 'sq') {                   // 사각파: 나이퀴스트 아래 홀수 배음만(접힘 없이)
        w = 0;
        for (let h = 1; h * hz < sr / 2; h += 2) w += Math.sin(2 * Math.PI * h * ph) / h;
        w *= 4 / Math.PI;
      } else w = Math.sin(2 * Math.PI * ph);
      out[i] += w * g;
      ph += hz / sr; ph -= Math.floor(ph);
      hz *= mul;
      g *= i < na ? up : down;
    }
  }
  return out;
}

/* 굿거리 선율(대금) — [5음계 번호, 8분음표 길이], null은 쉼표. 8마디 × 12 */
const MELODY = [
  [-2, 2], [-1, 1], [0, 2], [1, 1], [2, 3], [1, 2], [0, 1],
  [1, 2], [2, 1], [1, 2], [0, 1], [-1, 3], [-2, 3],
  [0, 2], [1, 1], [2, 2], [3, 1], [4, 3], [3, 2], [2, 1],
  [3, 2], [2, 1], [1, 2], [0, 1], [1, 6],
  [2, 2], [3, 1], [4, 2], [3, 1], [2, 2], [1, 1], [0, 3],
  [1, 2], [2, 1], [3, 2], [2, 1], [1, 3], [-1, 3],
  [0, 2], [-1, 1], [-2, 2], [-1, 1], [0, 2], [1, 1], [2, 2], [1, 1],
  [0, 2], [-1, 1], [-2, 6], [null, 3],
];
/** 마디마다 가야금 뜯는 음(1박, 3박) */
const BASS = [[-7, -4], [-9, -7], [-5, -3], [-9, -4], [-5, -3], [-9, -6], [-5, -7], [-7, -7]];
const LOOP = 192;           // 8마디(8분음표 96개) × 2: 두 번째 돌 때는 앞 4마디를 장단·가야금만(쉬어 가기)
const MEL_AT = (() => {     // 8분음표 위치 → [음, 길이]
  const m = new Map();
  let e = 0;
  for (const [n, len] of MELODY) { if (n !== null) m.set(e, [n, len]); e += len; }
  return m;
})();

/**
 * 효과음·음악·진동 묶음을 만든다.
 * context를 주면(예: OfflineAudioContext) 그 위에 바로 소리 길을 만든다 — 테스트용.
 */
export function createAudio({ context } = {}) {
  let ctx = null, offline = false;
  let sfxBus = null, musicBus = null, noiseBuf = null, flute = null;
  let sfxOn = true, musicOn = false, hapticsOn = true, tense = false, ducked = false, unlocked = false;
  let disposed = false, listening = false;
  let resumeAt = -1;        // 탭 안에서 resume()을 부른 시각(ms). 끝날 때까지 그 탭의 소리를 미리 걸어 둔다
  let mus = null;           // 지금 도는 음악 세션
  let hitBufs = null, hitSeq = 0;   // 미리 그린 타악기 버퍼(컨텍스트마다)
  const last = {};          // 이름별 마지막 재생 시각
  let ends = [];            // 울리고 있는 효과음의 끝 시각

  /* ---------------- 소리 길 만들기 ---------------- */
  function build(c) {
    ctx = c;
    offline = typeof c.startRendering === 'function';
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    const master = c.createGain();
    master.gain.value = MASTER;
    const lim = c.createWaveShaper();
    lim.curve = softClipCurve();
    comp.connect(master); master.connect(lim); lim.connect(c.destination);
    sfxBus = c.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(comp);
    musicBus = c.createGain(); musicBus.gain.value = MUSIC_VOL * (ducked ? DUCK : 1); musicBus.connect(comp);
    // 2초짜리 흰 잡음 하나를 모든 소리가 돌려 쓴다
    const len = Math.floor(c.sampleRate * 2);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 대금 음색: 기음 + 약한 배음
    flute = c.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.22, 0.08, 0.03]));
    prerender(c);
    if (musicOn) startMusic();
  }

  /**
   * 자주 치는 타악기를 미리 그린다. 실제 컨텍스트에서는 잠금을 푼 탭을 무겁게 하지 않도록 한 조각(변주 하나)씩
   * 쉬는 틈에 그리고, 다 되기 전의 한 방은 노드로 바로 합성한다. 오프라인(테스트)에서는 곧바로 모두 그린다.
   */
  function prerender(c) {
    hitBufs = {};
    const jobs = [], made = {};
    for (const k of Object.keys(HITS)) for (let v = 0; v < HIT_VARIANTS; v++) jobs.push([k, v]);
    const step = () => {
      if (ctx !== c || disposed || !jobs.length) return;
      const [k, v] = jobs.shift();
      const data = renderHit(HITS[k], c.sampleRate, 0x9E3779B1 * (v + 1));
      const b = c.createBuffer(1, data.length, c.sampleRate);
      b.getChannelData(0).set(data);
      (made[k] = made[k] || []).push(b);
      if (made[k].length === HIT_VARIANTS) hitBufs[k] = made[k];
      if (jobs.length && !offline) later(step);
    };
    if (offline) while (jobs.length) step();
    else later(step);
  }
  const later = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 16));

  /**
   * 소리를 걸어도 되나. resume()은 비동기라, 탭 안에서 깨우는 중(아직 'suspended')에도 그 탭의 소리는 걸어 둔다 —
   * 멈춘 시계에 currentTime+0.01로 건 소리는 시계가 돌자마자 난다. 1초 넘게 안 깨어나면 더 쌓지 않는다.
   */
  const running = () => !!ctx && !disposed && (offline || ctx.state === 'running'
    || (ctx.state === 'suspended' && resumeAt >= 0 && now() - resumeAt < 1000));

  /** 탭 안에서 컨텍스트 깨우기 */
  function wake() {
    if (!ctx || offline || ctx.state === 'running' || ctx.state === 'closed') return;
    const at = resumeAt = now();
    const done = () => { if (resumeAt === at) resumeAt = -1; };
    try {
      const pr = ctx.resume();
      if (pr && pr.then) pr.then(done, done); else done();
    } catch (e) { done(); }
  }

  /* ---------------- 합성 도구 ---------------- */
  /** AudioParam에 값 또는 [[초, 값], …] 곡선을 건다(지수 곡선) */
  function curve(param, t, v) {
    if (!Array.isArray(v)) { param.setValueAtTime(v, t); return; }
    param.setValueAtTime(v[0][1], t + v[0][0]);
    for (let i = 1; i < v.length; i++) param.exponentialRampToValueAtTime(v[i][1], t + v[i][0]);
  }

  /** 소리 크기 봉투: 0 → vol(a초) → 유지(hold) → 0(dur까지) */
  function envelope(g, t, vol, dur, a = 0.004, hold = 0, lin = false) {
    const p = g.gain, v = Math.max(1e-4, vol);
    p.setValueAtTime(1e-4, t);
    if (lin) p.linearRampToValueAtTime(v, t + a); else p.exponentialRampToValueAtTime(v, t + a);
    if (hold > 0) p.setValueAtTime(v, t + a + hold);
    p.exponentialRampToValueAtTime(1e-4, Math.max(t + a + hold + 0.01, t + dur));
  }

  function filter(type, f, t, q) {
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    curve(fl.frequency, t, f);
    if (q !== undefined) fl.Q.value = q;
    return fl;
  }

  /**
   * 오실레이터 하나. f는 Hz 또는 [[초, Hz], …].
   * o: type, wave, a, hold, lin, vib:[Hz, 깊이Hz], vibDelay, am:[Hz, 깊이0~1], lp/bp/hp(Hz 또는 곡선), q, detune
   */
  function tone(t, f, dur, vol, dest, o = {}) {
    const os = ctx.createOscillator();
    if (o.wave) os.setPeriodicWave(o.wave); else os.type = o.type || 'sine';
    curve(os.frequency, t, f);
    if (o.detune) os.detune.value = o.detune;
    const end = t + dur + 0.05;
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vib[0];
      if (o.vibDelay) { lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(o.vib[1], t + o.vibDelay); }
      else lg.gain.value = o.vib[1];
      l.connect(lg); lg.connect(os.frequency);
      l.start(t); l.stop(end);
    }
    let node = os;
    for (const k of ['hp', 'bp', 'lp']) {
      if (o[k] === undefined) continue;
      const fl = filter(k === 'lp' ? 'lowpass' : k === 'hp' ? 'highpass' : 'bandpass', o[k], t, o.q);
      node.connect(fl); node = fl;
    }
    const g = ctx.createGain();
    envelope(g, t, vol, dur, o.a, o.hold, o.lin);
    node.connect(g);
    if (o.am) {
      // 떨림(음량 LFO): 1−깊이를 기준으로 ±깊이
      const ag = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      ag.gain.value = 1 - o.am[1];
      l.frequency.value = o.am[0]; lg.gain.value = o.am[1];
      l.connect(lg); lg.connect(ag.gain); g.connect(ag); ag.connect(dest);
      l.start(t); l.stop(end);
    } else g.connect(dest);
    os.start(t); os.stop(end);
    return os;
  }

  /** 거른 잡음 한 줄기. o: type('bandpass'|'lowpass'|'highpass'), f(Hz 또는 곡선), q, a, hold */
  function noise(t, dur, vol, dest, o = {}) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const fl = filter(o.type || 'bandpass', o.f || 1000, t, o.q);
    const g = ctx.createGain();
    envelope(g, t, vol, dur, o.a || 0.002, o.hold || 0);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, rnd(0, 1.9));
    s.stop(t + dur + 0.03);
  }

  /* ---------------- 우리 악기 ---------------- */
  /** 미리 그린 타악기 한 방(버퍼 + 게인). rate로 음높이를 옮긴다(변주를 돌려 쓰고 ±1.5% 흔들어 기계 같지 않게) */
  function hit(kind, t, v, d, rate = 1) {
    const list = hitBufs && hitBufs[kind];
    if (!list) { hitLive(kind, t, v, d, rate); return; }
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = list[hitSeq++ % list.length];
    s.playbackRate.value = rate * rnd(0.985, 1.015);
    g.gain.value = v;
    s.connect(g); g.connect(d);
    s.start(t);
  }
  /** 아직 그리지 못한 타악기는 같은 부품을 노드로 바로 합성한다(빠르기 rate = 음높이 ×rate, 길이 ÷rate) */
  function hitLive(kind, t, v, d, rate) {
    for (const p of HITS[kind]) {
      const f = Array.isArray(p.f) ? p.f.map(([s, hz]) => [s / rate, hz * rate]) : p.f * rate;
      if (p.noise) noise(t, p.dur / rate, p.vol * v, d, { type: p.noise === 'lp' ? 'lowpass' : 'bandpass', f, q: p.q, a: p.a });
      else tone(t, f, p.dur / rate, p.vol * v, d, { type: p.wave === 'tri' ? 'triangle' : p.wave === 'sq' ? 'square' : 'sine', a: p.a });
    }
  }
  // 장구 북편 "쿵"·채편 "덕"(HITS 참고)
  function kung(t, v, d) { hit('kung', t, v, d); }
  function deok(t, v, d, f = 3200) { hit('deok', t, v, d, f / 3200); }
  function deong(t, v, d) { kung(t, v, d); deok(t, v * 0.85, d); }
  // 북 "둥": 폰 스피커가 못 내는 낮은 사인은 줄이고(컴프레서만 누르지 않게), 들리는 300~600Hz 울림을 넉넉히
  function buk(t, v, d) {
    tone(t, [[0, 82], [0.5, 45]], 0.55, 0.53 * v, d);
    tone(t, [[0, 172], [0.22, 94]], 0.26, 0.11 * v, d);
    tone(t, 160, 0.07, 0.28 * v, d, { type: 'triangle' });
    tone(t, [[0, 330], [0.15, 180]], 0.2, 0.26 * v, d, { type: 'triangle' });              // 폰에서 들리는 울림
    tone(t, [[0, 560], [0.08, 280]], 0.09, 0.3 * v, d, { a: 0.002 });
    noise(t, 0.12, 0.32 * v, d, { type: 'lowpass', f: 400 });
    noise(t, 0.03, 0.2 * v, d, { type: 'bandpass', f: 1000, q: 1 });                      // 북채가 닿는 소리
  }
  // 꽹과리: 서로 어긋난 사각파 6개를 고역 통과 — len이 짧으면 막는 소리
  const KKWAENG = [540, 812, 1133, 1478, 1896, 2410];
  function kkwaeng(t, v, len, d) {
    const g = ctx.createGain(), hp = filter('highpass', 600, t), lp = filter('lowpass', 6500, t);
    envelope(g, t, 0.06 * v, len, 0.002);
    for (const f of KKWAENG) {
      const os = ctx.createOscillator();
      os.type = 'square';
      os.frequency.value = f * rnd(0.995, 1.005);
      os.connect(hp);
      os.start(t); os.stop(t + len + 0.05);
    }
    hp.connect(lp); lp.connect(g); g.connect(d);
  }
  // "갠지갱": 0 / 0.11 / 0.22초, 마지막만 길게
  function kaenjigaeng(t, v, d) {
    kkwaeng(t, v * 0.85, 0.12, d);
    kkwaeng(t + 0.11, v * 0.6, 0.1, d);
    kkwaeng(t + 0.22, v, 0.9, d);
  }
  // 징: 맥놀이 나는 두 사인 + 배음, 치고 나서 살짝 올라가는 음.
  // 기음은 따로 긴 봉투(선형 40ms로 열고 τ 1초로 약 −9dB/초)라 목소리 밑에서 3초 넘게 운다. 배음은 더 빨리 사라진다
  function jing(t, v, dur, d) {
    const g = ctx.createGain(), p = g.gain, end = t + dur + 0.05;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.04);
    p.setTargetAtTime(0, t + 0.3, 1);
    p.setTargetAtTime(0, t + dur - 0.3, 0.08);                                            // 끝에서 부드럽게 닫기
    g.connect(d);
    for (const [f0, f1, k] of [[192, 196, 0.2], [193.6, 197.6, 0.14]]) {   // 크기가 달라 맥놀이가 끊기지 않고 일렁인다
      const os = ctx.createOscillator(), og = ctx.createGain();
      curve(os.frequency, t, [[0, f0], [0.4, f1]]);
      og.gain.value = k;
      os.connect(og); og.connect(g);
      os.start(t); os.stop(end);
    }
    tone(t, [[0, 386], [0.4, 392]], dur * 0.55, 0.1 * v, d, { a: 0.04 });
    tone(t, 589, dur * 0.35, 0.05 * v, d, { a: 0.03 });
    noise(t, 0.08, 0.06 * v, d, { type: 'bandpass', f: 900, q: 0.8 });
  }
  // 나무 딸깍(윷가락이 멍석에 떨어짐): 짧은 잡음 + 나무 공명
  function clack(t, v, d) {
    const k = rnd(0.95, 1.05);
    noise(t, 0.012, 0.55 * v, d, { type: 'bandpass', f: 2600 * k, q: 0.8 });
    tone(t, 1250 * k, 0.08, 0.26 * v, d);
    tone(t, 2380 * k, 0.06, 0.15 * v, d);
    tone(t, 3400 * k, 0.04, 0.1 * v, d);
    tone(t, [[0, 230], [0.03, 150]], 0.04, 0.2 * v, d);   // 멍석에 닿는 둔한 소리
  }
  // 목탁 같은 "똑"
  function block(t, f, v, d) {
    tone(t, [[0, f * 1.08], [0.02, f]], 0.07, 0.3 * v, d);
    noise(t, 0.012, 0.12 * v, d, { type: 'bandpass', f: f * 2.4, q: 1.5 });
  }
  // 맑은 종: 어긋난 배음 3개
  function bell(t, f, v, d, len = 1.2) {
    tone(t, f, len, 0.16 * v, d, { a: 0.003 });
    tone(t, f * 2.76, len * 0.5, 0.06 * v, d, { a: 0.002 });
    tone(t, f * 5.4, len * 0.25, 0.03 * v, d, { a: 0.002 });
  }
  function note(t, i, dur, v, d, type = 'triangle') { tone(t, pent(i), dur, v, d, { type }); }
  function sparkle(t, v, d, from = 8) {
    for (let k = 0; k < 6; k++) tone(t + k * 0.045, pent(from + Math.floor(rnd(0, 5))), 0.12, 0.07 * v, d, { a: 0.002 });
    noise(t, 0.3, 0.025 * v, d, { type: 'highpass', f: 7000, a: 0.02 });
  }
  function whoosh(t, v, d, up = true, dur = 0.4) {
    noise(t, dur, 0.5 * v, d, { type: 'bandpass', f: up ? [[0, 350], [dur * 0.6, 2600], [dur, 1500]] : [[0, 2400], [dur, 400]], q: 1.2, a: dur * 0.45 });
  }
  function slide(t, from, to, dur, v, d, vib) {
    tone(t, [[0, from], [dur, to]], dur, v, d, { type: 'sine', vib, a: 0.01, hold: dur * 0.5 });
  }

  /* ---------------- 동물 울음 (말 설계 §4.11) ---------------- */
  // 울음은 차례마다(차례 소리·목소리와 함께) 나므로 작게: 종마다 CRY_LEVEL을 곱해 모두 LUFS-M −22 안팎(한 칸 + 3dB)
  const CRY = {
    // 히히힝: 톱니파가 올라갔다 떨며 내려오고, 끝에 입술을 떠는 콧김 "푸르르"
    horse(t, d, p) {
      tone(t, [[0, 650 * p], [0.07, 1050 * p], [0.2, 900 * p], [0.42, 540 * p]], 0.44, 0.17, d,
        { type: 'sawtooth', vib: [13, 55 * p], am: [13, 0.3], lp: 2400, a: 0.02, hold: 0.22 });
      noise(t, 0.34, 0.035, d, { type: 'bandpass', f: 1600, q: 0.7, a: 0.03 });
      tone(t + 0.36, 105 * p, 0.24, 0.16, d, { type: 'sawtooth', lp: 800, am: [27, 0.85], a: 0.03, hold: 0.1 });
      noise(t + 0.36, 0.22, 0.05, d, { type: 'lowpass', f: 1400, a: 0.03 });
      return 0.65;
    },
    // 꿀꿀: 콧소리 사각파 두 번 + 폰 스피커에서도 들리는 코맹맹이 울림(900Hz 근처)
    pig(t, d, p) {
      for (let k = 0; k < 2; k++) {
        const s = t + k * 0.15;
        tone(s, [[0, 215 * p], [0.09, 160 * p]], 0.1, 0.12, d, { type: 'square', lp: 1300, a: 0.008, hold: 0.04 });
        tone(s, [[0, 215 * p], [0.09, 160 * p]], 0.1, 0.22, d, { type: 'square', bp: 900 * p, q: 2.5, a: 0.008, hold: 0.04 });
        noise(s, 0.08, 0.1, d, { type: 'bandpass', f: 700 * p, q: 2 });
      }
      return 0.3;
    },
    // 멍멍: 짧게 떨어지는 두 번
    dog(t, d, p) {
      for (let k = 0; k < 2; k++) {
        const s = t + k * 0.2, q = p * (k ? 1.06 : 1);
        tone(s, [[0, 420 * q], [0.12, 260 * q]], 0.14, 0.34, d, { type: 'triangle', a: 0.006, hold: 0.03 });
        tone(s, [[0, 420 * q], [0.12, 260 * q]], 0.12, 0.07, d, { type: 'square', lp: 1300, a: 0.006 });
        noise(s, 0.03, 0.1, d, { type: 'bandpass', f: 900, q: 1 });
      }
      return 0.38;
    },
    // 매애: 톱니파 + 느린 비브라토 + 빠른 떨림
    sheep(t, d, p) {
      tone(t, 520 * p, 0.5, 0.22, d, { type: 'sawtooth', vib: [7, 40 * p], am: [21, 0.45], lp: [[0, 700], [0.08, 1800]], a: 0.03, hold: 0.28 });
      return 0.55;
    },
    // 음매: 입을 다물었다(음) 벌리는(매) 필터. 송아지답게 조금 높게(폰에서도 들리게)
    cow(t, d, p) {
      tone(t, [[0, 175 * p], [0.25, 230 * p], [0.6, 165 * p]], 0.65, 0.25, d,
        { type: 'sawtooth', lp: [[0, 450], [0.22, 520], [0.32, 1600], [0.62, 750]], a: 0.05, hold: 0.33 });
      return 0.7;
    },
    // 어흥: 아기 호랑이 — 으르렁 떨림 없이, 새끼답게 한 옥타브 가까이 높고 둥글게
    tiger(t, d, p) {
      tone(t, [[0, 225 * p], [0.12, 205 * p]], 0.15, 0.2, d, { type: 'sawtooth', lp: 900, a: 0.02, hold: 0.05 });
      tone(t + 0.17, [[0, 190 * p], [0.14, 250 * p], [0.45, 170 * p]], 0.48, 0.24, d,
        { type: 'sawtooth', lp: [[0, 900], [0.15, 1450], [0.45, 650]], vib: [5, 4], a: 0.03, hold: 0.2 });
      noise(t + 0.17, 0.4, 0.04, d, { type: 'lowpass', f: 900, a: 0.05 });
      return 0.7;
    },
    // 뿅
    rabbit(t, d, p) {
      tone(t, [[0, 700 * p], [0.12, 1400 * p]], 0.14, 0.18, d, { a: 0.005, hold: 0.05 });
      return 0.18;
    },
    // 뾰로롱: 올라가는 세 음 + 반짝
    dragon(t, d, p) {
      [880, 1175, 1568, 2093].forEach((f, k) => tone(t + k * 0.06, f * p, 0.18, 0.26, d, { type: 'triangle', vib: [9, 12] }));
      sparkle(t + 0.2, 0.8, d);
      return 0.55;
    },
  };

  /** 울음 크기 맞춤(LUFS-M −22 안팎이 되게 잰 값) */
  const CRY_LEVEL = { horse: 0.75, tiger: 0.42, rabbit: 0.85, pig: 0.72, dog: 0.48, sheep: 0.7, cow: 0.38, dragon: 0.65 };

  /* ---------------- 효과음 ---------------- */
  // 각 함수는 (시작 시각, 인자, 출력 노드)를 받아 소리를 걸고, 소리 길이(초)를 돌려준다.
  const SFX = {
    tap(t, p, d) {
      tone(t, [[0, 1250], [0.03, 900]], 0.05, 0.18, d, { a: 0.002 });
      noise(t, 0.012, 0.05, d, { type: 'bandpass', f: 2600, q: 1.2 });
      return 0.08;
    },
    select(t, p, d) {
      note(t, 2, 0.12, 0.2, d);
      note(t + 0.07, 4, 0.18, 0.2, d);
      return 0.26;
    },
    pop(t, p, d) {
      tone(t, [[0, 320], [0.06, 1150]], 0.09, 0.28, d, { a: 0.003 });
      return 0.1;
    },
    throwStart(t, p, d) {
      deong(t, 0.9, d);
      whoosh(t + 0.02, 0.45, d, true, 0.3);
      return 0.45;
    },
    stickLand(t, p, d) {
      clack(t, 0.75 * clamp(p.vol === undefined ? 1 : +p.vol || 0, 0.1, 1), d);
      return 0.1;
    },
    // 북 드르륵: 네 번째 가락이 흔들리는 동안. ms 동안 점점 세게, 마지막 한 방은 없다(결과 소리가 이어짐)
    drumroll(t, p, d) {
      const len = clamp((+p.ms || 700) / 1000, 0.15, 2.5), gap = 0.055, n = Math.max(3, Math.round(len / gap));
      for (let k = 0; k < n; k++) {
        // 점점 세게, 음도 조금씩 올라가 조마조마하게(한 방 = 미리 그린 버퍼 하나)
        const u = k / (n - 1);
        hit('roll', t + k * gap, (0.25 + 0.5 * u) * (k % 2 ? 0.82 : 1), d, 1 + 0.18 * u);
      }
      return n * gap + 0.15;
    },
    result(t, p, d) {
      const r = p.r === 'nak' ? 'nak' : Number(p.r);
      if (r === 4) {                               // 윷: 덩 + 갠지갱
        deong(t, 0.7, d);
        kaenjigaeng(t, 1, d);
        return 1.2;
      }
      if (r === 5) {                               // 모: 북 + 갠지갱 ×2 + 북 + "짠!" — 가장 큰 결과
        buk(t, 0.9, d);
        kaenjigaeng(t, 1, d);
        kaenjigaeng(t + 0.45, 1.2, d);
        buk(t + 0.9, 1, d);
        // 짠: 밝은 5음 화음. 북의 힘은 폰에서 거의 사라지므로, 폰에서도 모가 윷보다 크게 들리게 하는 몫
        for (const i of [5, 7, 10]) tone(t + 0.9, pent(i), 0.6, 0.18, d, { type: 'triangle', a: 0.004, hold: 0.12 });
        return 1.7;
      }
      if (r === -1) {                              // 빽도: 뒤로 뽀옹 두 음(아쉬운 결과라 작게)
        tone(t, [[0, pent(3)], [0.13, pent(2)]], 0.15, 0.1, d, { type: 'triangle', hold: 0.06 });
        tone(t + 0.17, [[0, pent(0)], [0.25, pent(-1)]], 0.3, 0.11, d, { type: 'triangle', hold: 0.1 });
        block(t, 1400, 0.26, d);
        return 0.5;
      }
      if (r === 'nak') {                           // 낙: 꽹과리 막음 + 두 음 하강("아이고~")
        kkwaeng(t, 0.5, 0.06, d);
        tone(t + 0.1, [[0, pent(1)], [0.2, pent(1) * 0.94]], 0.24, 0.1, d, { type: 'triangle', hold: 0.08 });
        tone(t + 0.34, [[0, pent(-1)], [0.35, pent(-1) * 0.88]], 0.42, 0.1, d, { type: 'triangle', vib: [6, 6], hold: 0.15 });
        return 0.8;
      }
      // 도·개·걸: 덕덕 (결과가 클수록 조금 밝게) — 한 칸 소리보다는 또렷하게
      const n = clamp(r || 1, 1, 3), f = 2800 + n * 250, w = 880 * Math.pow(1.12, n - 1);
      deok(t, 1.7, d, f);
      deok(t + 0.13, 2, d, f * 1.06);
      // 나무가 딱 갈라지는 몸통 소리(폰에서도 또렷하게)
      tone(t, [[0, w], [0.04, w * 0.85]], 0.1, 0.18, d, { type: 'triangle', a: 0.002, hold: 0.02 });
      tone(t + 0.13, [[0, w * 1.06], [0.04, w * 0.9]], 0.13, 0.22, d, { type: 'triangle', a: 0.002, hold: 0.02 });
      return 0.25;
    },
    // 한 칸: 5음계로 한 음씩 올라간다(5칸 뒤는 한 옥타브 위)
    hop(t, p, d) {
      const s = Math.max(0, Math.floor(+p.step || 0));
      const f = STEP_NOTES[s % 5] * (s >= 5 ? 2 : 1);
      tone(t, f, 0.12, 0.22, d, { type: 'triangle', a: 0.004, hold: 0.02 });
      tone(t, f * 2, 0.06, 0.035, d, { a: 0.002 });
      return 0.14;
    },
    // 착지: 둔한 "쿵"은 줄이고 폰에서 들리는 "톡"을 키운다(한 칸 소리보다 작아지지 않게)
    land(t, p, d) {
      tone(t, [[0, 210], [0.1, 90]], 0.16, 0.22, d, { a: 0.003 });
      tone(t, [[0, 520], [0.05, 320]], 0.1, 0.42, d, { type: 'triangle', a: 0.002, hold: 0.01 });
      noise(t, 0.05, 0.14, d, { type: 'lowpass', f: 600 });
      noise(t, 0.035, 0.3, d, { type: 'bandpass', f: 900, q: 0.9 });
      return 0.2;
    },
    // 쿵 착지(소): 북 + 폰에서도 묵직하게 들리는 중간 울림
    bigLand(t, p, d) {
      buk(t, 0.35, d);
      tone(t, [[0, 520], [0.2, 380]], 0.3, 0.6, d, { type: 'triangle' });                 // 판이 울리는 소리
      tone(t, [[0, 780], [0.14, 520]], 0.2, 0.3, d, { a: 0.002 });
      tone(t, [[0, 660], [0.2, 480]], 0.24, 0.26, d, { type: 'triangle', a: 0.002 });
      noise(t, 0.12, 0.25, d, { type: 'bandpass', f: 700, q: 0.8 });
      clack(t, 0.5, d);
      return 0.6;
    },
    whoosh(t, p, d) { whoosh(t, 1, d); return 0.42; },
    // 지름길: 5음계가 휘리릭 올라가고 반짝
    shortcut(t, p, d) {
      for (let k = 0; k < 6; k++) tone(t + k * 0.045, pent(k), 0.2, 0.2, d, { type: 'triangle' });
      whoosh(t, 0.4, d, true, 0.35);
      sparkle(t + 0.28, 0.9, d);
      return 0.75;
    },
    // 업기: 용수철 "보잉"
    stack(t, p, d) {
      tone(t, [[0, 523], [0.12, 784]], 0.34, 0.24, d, { type: 'triangle', vib: [13, 34], vibDelay: 0.06, hold: 0.1 });
      tone(t, [[0, 1046], [0.12, 1568]], 0.2, 0.04, d);
      return 0.38;
    },
    // 잡기: 북 한 방 + 미끄럼 휘파람이 내려간다(슬프지 않고 우스꽝스럽게)
    capture(t, p, d) {
      buk(t, 0.7, d);
      tone(t, [[0, 320], [0.06, 1150]], 0.08, 0.18, d);   // 뿅!
      slide(t + 0.06, 1200, 300, 0.42, 0.15, d, [9, 22]);
      return 0.6;
    },
    // 완주: 5음 올라가고 마지막 음은 길게
    finish(t, p, d) {
      for (let k = 0; k < 5; k++) note(t + k * 0.085, k, 0.22, 0.2, d);
      tone(t + 0.43, pent(5), 0.55, 0.2, d, { type: 'triangle', vib: [6, 5], vibDelay: 0.2, hold: 0.15 });
      sparkle(t + 0.45, 0.8, d);
      return 1.05;
    },
    // 한 팀의 말이 모두 완주
    teamDone(t, p, d) {
      deong(t, 0.8, d);
      kaenjigaeng(t + 0.05, 0.75, d);
      for (let k = 0; k < 6; k++) note(t + 0.3 + k * 0.08, k, 0.24, 0.17, d);
      tone(t + 0.8, pent(7), 0.6, 0.16, d, { type: 'triangle', hold: 0.2 });
      buk(t + 0.8, 0.9, d);
      sparkle(t + 0.85, 0.9, d);
      return 1.5;
    },
    // 우승: 덩 + 징 + 나팔 + 갠지갱 — 징은 목소리("…팀 우승! 축하해요!") 밑에서 3초 넘게 운다
    win(t, p, d) {
      deong(t, 0.9, d);
      jing(t, 1, 3.8, d);
      const brass = (s, i, len, v) => {
        tone(s, pent(i), len, v, d, { type: 'sawtooth', lp: 2300, a: 0.015, hold: len * 0.5 });
        tone(s, pent(i), len, v * 0.8, d, { type: 'triangle', a: 0.015, hold: len * 0.5 });
      };
      brass(t + 0.12, 0, 0.14, 0.08);
      brass(t + 0.26, 2, 0.14, 0.08);
      brass(t + 0.4, 3, 0.14, 0.08);
      brass(t + 0.54, 5, 0.7, 0.09);
      brass(t + 0.54, 7, 0.7, 0.05);
      kaenjigaeng(t + 0.2, 0.55, d);
      sparkle(t + 0.6, 1, d);
      return 3.8;
    },
    // 차례 시작: 덩 기덕
    turn(t, p, d) {
      deong(t, 0.8, d);
      deok(t + 0.19, 0.55, d);
      deok(t + 0.25, 1, d);
      return 0.45;
    },
    cry(t, p, d) {
      // 같은 울음도 매번 조금씩 다르게(±3%) — 여러 번 들어도 기계 같지 않게
      const sp = speciesById(p.species).id, g = ctx.createGain();
      g.gain.value = CRY_LEVEL[sp];
      g.connect(d);
      return CRY[sp](t, g, clamp(+p.pitch || 1, 0.5, 2) * rnd(0.97, 1.03));
    },
    event(t, p, d) {
      switch (p.kind) {
        case 'gift':                               // 선물 상자: 짠!
          tone(t, [[0, 320], [0.06, 1150]], 0.08, 0.22, d);
          for (let k = 0; k < 6; k++) note(t + 0.06 + k * 0.05, 3 + k, 0.18, 0.13, d, 'sine');
          bell(t + 0.36, pent(10), 1, d, 0.9);
          sparkle(t + 0.4, 1, d);
          return 1.3;
        case 'magpie':                             // 까치: 깍깍 + 반가운 한 음
          for (let k = 0; k < 2; k++) {
            tone(t + k * 0.15, [[0, 1900], [0.07, 1450]], 0.09, 0.4, d, { type: 'sawtooth', bp: 2300, q: 1.6, a: 0.004 });
          }
          note(t + 0.4, 4, 0.3, 0.18, d);
          note(t + 0.48, 7, 0.4, 0.14, d);
          return 0.9;
        case 'gate':                               // 도깨비 문: 뚝딱! + 순간이동 소용돌이
          block(t, 900, 1, d);
          block(t + 0.13, 1300, 1, d);
          tone(t + 0.25, [[0, 300], [0.45, 1500]], 0.5, 0.14, d, { type: 'triangle', vib: [18, 60], a: 0.03, hold: 0.3 });
          sparkle(t + 0.7, 1, d);
          return 1.1;
        case 'puddle':                             // 웅덩이: 퐁 + 미끄덩
          tone(t, [[0, 1200], [0.06, 320]], 0.09, 0.32, d, { a: 0.002 });
          tone(t + 0.14, [[0, 700], [0.4, 240]], 0.42, 0.2, d, { type: 'triangle', vib: [6, 22], a: 0.01, hold: 0.2 });
          noise(t, 0.12, 0.06, d, { type: 'bandpass', f: 1800, q: 1 });
          return 0.62;
        case 'friend':                             // 친구 부르기: "여기~" 두 음 부름
          tone(t, pent(3), 0.2, 0.2, d, { type: 'triangle', a: 0.02, hold: 0.1 });
          tone(t + 0.22, [[0, pent(2)], [0.3, pent(2) * 0.99]], 0.36, 0.2, d, { type: 'triangle', vib: [6, 8], vibDelay: 0.1, a: 0.02, hold: 0.18 });
          tone(t + 0.62, [[0, 320], [0.06, 1150]], 0.09, 0.2, d);
          return 0.75;
        case 'mission':                            // 미션 카드: 덩 + 세 음 + 종
          deong(t, 0.8, d);
          note(t + 0.12, 2, 0.16, 0.18, d);
          note(t + 0.24, 3, 0.16, 0.18, d);
          note(t + 0.36, 5, 0.34, 0.2, d);
          bell(t + 0.36, pent(10), 0.8, d, 1);
          return 1.3;
        default:
          sparkle(t, 1, d);
          return 0.5;
      }
    },
    // 박수: 여러 사람이 짝짝짝
    clap(t, p, d) {
      const n = 10;
      for (let k = 0; k < n; k++) {
        const s = t + k * 0.1 + rnd(0, 0.035), v = rnd(1.2, 1.7);
        const src = ctx.createBufferSource(), fl = filter('bandpass', rnd(1100, 1700), s, 0.9), g = ctx.createGain(), q = g.gain;
        src.buffer = noiseBuf;
        // 손바닥이 여러 번 부딪히는 짧은 봉우리 세 개
        q.setValueAtTime(1e-4, s);
        q.exponentialRampToValueAtTime(0.5 * v, s + 0.001);
        q.exponentialRampToValueAtTime(0.1 * v, s + 0.009);
        q.setValueAtTime(0.4 * v, s + 0.011);
        q.exponentialRampToValueAtTime(0.08 * v, s + 0.02);
        q.setValueAtTime(0.32 * v, s + 0.022);
        q.exponentialRampToValueAtTime(1e-4, s + 0.1);
        src.connect(fl); fl.connect(g); g.connect(d);
        src.start(s, rnd(0, 1.8)); src.stop(s + 0.12);
      }
      return 1.15;
    },
    // 뒷걸음: 되감기처럼 내려가는 소리 + 뽁뽁
    backdo(t, p, d) {
      tone(t, [[0, 900], [0.28, 400]], 0.3, 0.14, d, { vib: [16, 30], a: 0.02, hold: 0.12 });
      block(t, 1500, 0.5, d);
      block(t + 0.14, 1200, 0.5, d);
      return 0.36;
    },
    bell(t, p, d) { bell(t, pent(9), 1, d); return 1.2; },
    sparkle(t, p, d) { sparkle(t, 1.3, d); return 0.5; },
  };

  /* ---------------- 굿거리 장단 (배경 음악) ---------------- */
  const shift = Math.pow(2, MUSIC_SHIFT / 12);

  // 대금: 살짝 밀어 올려 들어가는 음(시김새) + 늦게 걸리는 비브라토 + 숨소리
  function daegeum(t, f, dur, v, d) {
    const os = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
    os.setPeriodicWave(flute);
    os.frequency.setValueAtTime(f * 0.985, t);
    os.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    l.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t + 0.08);
    lg.gain.linearRampToValueAtTime(f * 0.0035, t + 0.08 + Math.min(0.35, dur * 0.6));   // ±6센트
    l.connect(lg); lg.connect(os.frequency);
    const rel = Math.min(0.12, dur * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.06);
    g.gain.setValueAtTime(v * 0.9, t + dur - rel);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    os.connect(g); g.connect(d);
    os.start(t); os.stop(t + dur + 0.1); l.start(t); l.stop(t + dur + 0.1);
    noise(t, 0.06, v * 0.12, d, { type: 'bandpass', f: 2400, q: 1 });                      // 입김 첫소리
    noise(t, dur, v * 0.035, d, { type: 'bandpass', f: 1600, q: 0.7, a: 0.05, hold: Math.max(0, dur - 0.15) });
  }
  // 가야금 뜯기
  function pluck(t, f, v, d) {
    tone(t, f, 0.9, v, d, { type: 'triangle', lp: [[0, 2600], [0.3, 500]], a: 0.003 });
    tone(t, f * 2, 0.3, v * 0.25, d, { a: 0.003 });
  }

  /** 8분음표 하나(step: 0‥191)를 t에 건다. eighth = 8분음표 길이(초) */
  function scheduleEighth(step, t, eighth, d) {
    const e = step % 96, i = e % 12, dv = MIX.drum * (tense ? 1.1 : 1);
    // 장단: 덩 . 기덕 | 쿵 . 더러러러 | 쿵 . 기덕 | 쿵 . 더러러러
    if (i === 0) deong(t, 0.95 * dv, d);
    else if (i === 3 || i === 6 || i === 9) kung(t, 0.8 * dv, d);
    if (i === 2 || i === 8) { deok(t, 0.3 * dv, d); deok(t + eighth / 2, 0.6 * dv, d); }
    if (i === 5 || i === 11) [0.45, 0.28, 0.3, 0.36].forEach((v, k) => deok(t + k * eighth / 4, v * dv, d, 3000));
    // 가야금: 마디의 1박과 3박
    if (i === 0 || i === 6) pluck(t, pent(BASS[Math.floor(e / 12)][i ? 1 : 0]) * shift, MIX.gayageum, d);
    const m = MEL_AT.get(e);
    if (m && (step < 96 || e >= 48)) daegeum(t, pent(m[0]) * shift, m[1] * eighth * 0.97, MIX.daegeum, d);
  }

  function scheduleUntil(end) {
    while (mus && mus.next < end) {
      // 빠르기는 한 박에 1.5bpm씩 목표로 다가간다(갑자기 바뀌지 않게)
      const target = tense ? BPM.tense : BPM.calm;
      mus.bpm += clamp(target - mus.bpm, -1.5, 1.5);
      const eighth = 60 / mus.bpm / 3;
      try { scheduleEighth(mus.step % LOOP, mus.next, eighth, mus.out); } catch (e) { /* 무시 */ }
      mus.next += eighth;
      mus.step++;
    }
  }

  function tick() {
    if (!mus || !ctx) return;
    if (!running()) { mus.next = 0; return; }
    const now = ctx.currentTime;
    if (mus.next < now + 0.02) mus.next = now + 0.06;   // 멈췄다 돌아오면 밀린 음을 몰아 치지 않는다
    scheduleUntil(now + 0.3);
  }

  function startMusic() {
    if (mus || !ctx) return;
    const out = ctx.createGain();
    out.connect(musicBus);
    const m = mus = { out, next: ctx.currentTime + 0.08, step: 0, bpm: tense ? BPM.tense : BPM.calm, timer: 0 };
    if (offline) {
      // 오프라인(테스트): 실제처럼 조금씩 미리 건다 — 0.4초마다 렌더링을 멈추고 다음 몫을 건다
      const c = ctx, end = c.length / c.sampleRate;
      scheduleUntil(c.currentTime + 0.5);
      for (let s = c.currentTime + 0.37; s < end; s += 0.4) {
        const go = () => { if (mus === m) scheduleUntil(s + 0.5); };
        c.suspend(s).then(() => { go(); c.resume(); }, go);
      }
    } else { tick(); m.timer = setInterval(tick, 60); }
  }

  function stopMusic() {
    if (!mus) return;
    const m = mus;
    mus = null;
    clearInterval(m.timer);
    try {
      const now = ctx.currentTime;
      m.out.gain.cancelScheduledValues(now);
      m.out.gain.setValueAtTime(m.out.gain.value, now);
      m.out.gain.linearRampToValueAtTime(0, now + 0.35);
    } catch (e) { /* 무시 */ }
    if (!offline) setTimeout(() => { try { m.out.disconnect(); } catch (e) { /* 무시 */ } }, 700);
  }

  /* ---------------- 공개 API ---------------- */
  if (context) build(context);

  const quiet = pr => { if (pr && pr.catch) pr.catch(NOOP); };
  // 화면이 가려지면 멈추고, 돌아오면 다시(직접 만든 컨텍스트만).
  // 탭 밖의 resume()은 iOS에서 오래 걸리거나 실패할 수 있어 wake()처럼 '깨우는 중'으로 치지 않는다(소리가 쌓였다 한꺼번에 나지 않게)
  function onVisibility() {
    if (!ctx || offline || context) return;
    try {
      if (document.hidden) { resumeAt = -1; quiet(ctx.suspend()); }
      else if (unlocked && ctx.state !== 'running' && ctx.state !== 'closed') quiet(ctx.resume());
    } catch (e) { /* 무시 */ }
  }
  // 잠금을 푼 뒤의 탭마다: iOS가 전화·앱 전환으로 멈춘('interrupted') 컨텍스트는 탭 안에서만 다시 깨울 수 있다.
  // main이 unlock()을 한 번만 불러도 소리가 스스로 돌아오게 한다(돌고 있으면 아무것도 안 함)
  function onGesture() {
    if (!ctx || offline || document.hidden) return;
    wake();
  }
  function unlisten() {
    if (!listening) return;
    listening = false;
    document.removeEventListener('visibilitychange', onVisibility);
    for (const ev of GESTURES) document.removeEventListener(ev, onGesture, { capture: true });
  }

  const api = {
    /** 사용자 탭 안에서 부른다(매번 불러도 싸다): 컨텍스트를 만들거나 깨운다 */
    unlock() {
      if (disposed) return;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          let c;
          try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { c = new AC(); }
          build(c);
          listening = true;
          document.addEventListener('visibilitychange', onVisibility);
          for (const ev of GESTURES) document.addEventListener(ev, onGesture, { capture: true, passive: true });
        }
        if (offline) return;
        wake();
        if (!unlocked) {
          // iOS: 탭 안에서 무음 한 샘플을 틀어야 소리 길이 열린다
          unlocked = true;
          const s = ctx.createBufferSource();
          s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          s.connect(ctx.destination);
          s.start(0);
        }
      } catch (e) { /* 소리 없이 계속 */ }
    },

    /**
     * 효과음 한 번. 모르는 이름은 무시. params.vol(0~1)은 모든 소리의 크기(stickLand는 떨어지는 세기),
     * params.pan(−1~1)은 좌우. 돌려주는 함수를 부르면 곧바로 줄여 끈다(예: drumroll). 그 함수의 duration = 소리 길이(초)
     */
    play(name, params) {
      const fn = SFX[name];
      if (!fn || !sfxOn || !running()) return NOOP;
      try {
        const p = params || {};
        const vol = name === 'stickLand' ? 1 : clamp(p.vol === undefined ? 1 : +p.vol || 0, 0, 1);
        if (vol <= 0) return NOOP;
        const cur = ctx.currentTime;
        if (last[name] !== undefined && cur - last[name] < (GAP[name] || 0.025) && cur >= last[name]) return NOOP;
        if (ends.length > 8) ends = ends.filter(e => e > cur);
        if (ends.length >= MAX_VOICES && !IMPORTANT.has(name)) return NOOP;
        const t = cur + (offline ? 0.002 : 0.01);
        const out = ctx.createGain();
        out.gain.value = vol;
        if (typeof p.pan === 'number' && ctx.createStereoPanner) {
          const pn = ctx.createStereoPanner();
          pn.pan.value = clamp(p.pan, -1, 1);
          out.connect(pn); pn.connect(sfxBus);
        } else out.connect(sfxBus);
        const dur = fn(t, p, out) || 0.5;
        last[name] = cur;
        ends.push(t + dur);
        let done = false;
        const drop = () => { if (!done) { done = true; try { out.disconnect(); } catch (e) { /* 무시 */ } } };
        if (!offline) setTimeout(drop, (dur + 0.4) * 1000);
        const stop = () => {
          if (done || !ctx) return;
          try {
            const n = ctx.currentTime;
            out.gain.cancelScheduledValues(n);
            out.gain.setValueAtTime(vol, n);
            out.gain.linearRampToValueAtTime(0, n + 0.05);
            if (!offline) setTimeout(drop, 120);
          } catch (e) { /* 무시 */ }
        };
        stop.duration = dur;
        return stop;
      } catch (e) {
        return NOOP;
      }
    },

    /** { sfx, music, haptics } 중 준 것만 바꾼다 */
    setEnabled({ sfx, music, haptics } = {}) {
      if (typeof sfx === 'boolean') {
        sfxOn = sfx;
        if (sfxBus) try { sfxBus.gain.setTargetAtTime(sfx ? 1 : 0, ctx.currentTime, 0.02); } catch (e) { /* 무시 */ }
      }
      if (typeof haptics === 'boolean') hapticsOn = haptics;
      if (typeof music === 'boolean') api.music(music);
    },
    get enabled() { return { sfx: sfxOn, music: musicOn, haptics: hapticsOn }; },

    /** 굿거리 장단 켜기/끄기. 컨텍스트가 아직 없으면 unlock 때 시작한다 */
    music(on) {
      musicOn = !!on;
      if (!ctx) return;
      if (musicOn) startMusic(); else stopMusic();
    },
    /** 막판 긴장: 72 → 90bpm */
    setTension(on) { tense = !!on; },
    /** 음성이 나오는 동안 음악을 30%로 */
    duck(on) {
      ducked = !!on;
      if (!musicBus) return;
      try { musicBus.gain.setTargetAtTime(MUSIC_VOL * (ducked ? DUCK : 1), ctx.currentTime, ducked ? 0.06 : 0.25); } catch (e) { /* 무시 */ }
    },

    /** 진동. 탭하기 전에는 부르지 않는다(Chrome 경고 방지) */
    buzz(name) {
      if (!hapticsOn) return;
      const pat = BUZZ[name];
      if (pat === undefined || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      try { navigator.vibrate(pat); } catch (e) { /* 무시 */ }
    },

    /**
     * 다 쓴 뒤 정리: 음악을 멈추고 문서 리스너를 떼고, 직접 만든 컨텍스트는 닫는다(받은 컨텍스트는 그대로 둔다).
     * 그 뒤의 play·music·unlock은 아무것도 하지 않는다
     */
    dispose() {
      if (disposed) return;
      try { stopMusic(); } catch (e) { /* 무시 */ }
      disposed = true;
      unlisten();
      if (ctx && !context && !offline) try { quiet(ctx.close()); } catch (e) { /* 무시 */ }
      ctx = null;
    },

    get context() { return ctx; },
  };
  return api;
}
