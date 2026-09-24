// 트윈(시간에 따라 값 바꾸기)과 이징 함수. 그리기 루프(scene.js)가 매 프레임 step()을 부른다.

const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
/** 움직임 줄이기 설정이면 연출 시간을 줄인다 */
export const SPEED = REDUCED ? 0.55 : 1;
export const reducedMotion = REDUCED;

const tweens = [];
let wake = () => {};
/** 새 트윈이 생기면 그리기 루프를 깨우는 함수를 등록 */
export function onTweenStart(fn) { wake = fn; }

/**
 * dur(ms) 동안 fn(k)를 부른다. k는 0→1. 끝나면 풀리는 Promise.
 * cancelKey를 주면 cancel(cancelKey)로 한꺼번에 멈출 수 있다.
 */
export function tween(dur, fn, cancelKey) {
  return new Promise(res => {
    tweens.push({ t0: performance.now(), dur: Math.max(1, dur * SPEED), fn, res, key: cancelKey });
    wake();
  });
}

export function wait(ms) { return new Promise(r => setTimeout(r, ms * SPEED)); }

/** 해당 키의 트윈을 끝까지 건너뛴다(마지막 값 적용 후 resolve) */
export function finishAll(key) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (key === undefined || tw.key === key) { tweens.splice(i, 1); try { tw.fn(1); } catch (e) { /* 무시 */ } tw.res(); }
  }
}

/** 트윈을 한 번 진행. 아직 돌고 있는 트윈이 있으면 true */
export function step(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = Math.max(0, Math.min(1, (now - tw.t0) / tw.dur));
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  return tweens.length > 0;
}

export const ease = {
  linear: k => k,
  inQuad: k => k * k,
  outQuad: k => 1 - (1 - k) * (1 - k),
  outCubic: k => 1 - Math.pow(1 - k, 3),
  inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
  inOutCubic: k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  outBack: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outElastic: k => k === 0 ? 0 : k === 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  outBounce: k => {
    const n1 = 7.5625, d1 = 2.75;
    if (k < 1 / d1) return n1 * k * k;
    if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75;
    if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375;
    return n1 * (k -= 2.625 / d1) * k + 0.984375;
  },
};

export const lerp = (a, b, k) => a + (b - a) * k;
/** 포물선 점프 높이: k=0.5에서 h */
export const arc = (k, h) => 4 * h * k * (1 - k);
