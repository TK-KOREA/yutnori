// 윷놀이 규칙 엔진 — 화면(DOM)이나 three.js 없이 동작하는 순수 모듈.
// 게임 상태를 받아 둘 수 있는 수를 계산하고, 수를 적용하고, 무슨 일이 일어났는지 알려 준다.

export const FIN = 'F';     // 경로 위의 "완주" 표시
export const HOME = -1;     // 아직 판에 올라가지 않은 말
export const DONE = 99;     // 완주한 말
export const BACKDO = -1;

export const RESULT_NAME = { '-1': '빽도', 1: '도', 2: '개', 3: '걸', 4: '윷', 5: '모' };
/** 도·개·걸·윷·모의 본뜻: 돼지·개·양·소·말 */
export const RESULT_ANIMAL = { '-1': 'pig', 1: 'pig', 2: 'dog', 3: 'sheep', 4: 'cow', 5: 'horse' };
export const STEP_WORD = { '-1': '한 칸 뒤로', 1: '한 칸', 2: '두 칸', 3: '세 칸', 4: '네 칸', 5: '다섯 칸' };

/* ---------------------------------------------------------------
 * 윷판 (29칸)
 *  0      참먹이(출발·도착) — 오른쪽 아래
 *  1~4    오른쪽 변 (아래→위)        5   모 (오른쪽 위)
 *  6~9    위쪽 변 (오른쪽→왼쪽)      10  뒷모 (왼쪽 위)
 *  11~14  왼쪽 변 (위→아래)          15  찌모 (왼쪽 아래)
 *  16~19  아래쪽 변 (왼쪽→오른쪽)
 *  20,21  모 → 방        22  방(가운데)     23,24  방 → 찌모
 *  25,26  뒷모 → 방      27,28  방 → 참먹이
 * --------------------------------------------------------------- */
export const NODE_COUNT = 29;
export const CORNER = { 0: '참먹이', 5: '모', 10: '뒷모', 15: '찌모', 22: '방' };

/** 칸의 판 위 좌표 [x, z]. half = 바깥 네모의 반 변 길이 */
export function nodeLayout(half) {
  const P = [];
  for (let i = 0; i < 20; i++) {
    let x, z;
    if (i <= 5) { x = half; z = half - 2 * half * i / 5; }
    else if (i <= 10) { x = half - 2 * half * (i - 5) / 5; z = -half; }
    else if (i <= 15) { x = -half; z = -half + 2 * half * (i - 10) / 5; }
    else { x = -half + 2 * half * (i - 15) / 5; z = half; }
    P[i] = [x, z];
  }
  const C = [0, 0], lp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  P[20] = lp(P[5], C, 1 / 3); P[21] = lp(P[5], C, 2 / 3); P[22] = C;
  P[23] = lp(C, P[15], 1 / 3); P[24] = lp(C, P[15], 2 / 3);
  P[25] = lp(P[10], C, 1 / 3); P[26] = lp(P[10], C, 2 / 3);
  P[27] = lp(C, P[0], 1 / 3); P[28] = lp(C, P[0], 2 / 3);
  return P;
}

/** 윷판 선 (그리기용) */
export const EDGES = (() => {
  const e = [];
  for (let i = 0; i < 20; i++) e.push([i, (i + 1) % 20]);
  e.push([5, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 15],
    [10, 25], [25, 26], [26, 22], [22, 27], [27, 28], [28, 0]);
  return e;
})();

/**
 * 한 칸 앞으로.
 * 모·뒷모·방에 "멈춰 있다가" 출발하면(first) 지름길로 들어간다.
 * 방을 그냥 지나갈 때는 들어온 방향 그대로 간다: 모 쪽(21)에서 오면 찌모 쪽(23), 뒷모 쪽(26)에서 오면 참먹이 쪽(27).
 */
export function nextNode(cur, prev, first) {
  if (cur === HOME) return 1;
  if (cur === 0) return FIN;
  if (first) {
    if (cur === 5) return 20;
    if (cur === 10) return 25;
    if (cur === 22) return 27;
  }
  if (cur === 22) return prev === 21 ? 23 : 27;
  if (cur <= 19) return cur === 19 ? 0 : cur + 1;
  return { 20: 21, 21: 22, 23: 24, 24: 15, 25: 26, 26: 22, 27: 28, 28: 0 }[cur];
}

/** 지나온 길을 모를 때 쓰는 기본 "한 칸 뒤" */
const BACK = { 0: 19, 1: 0, 5: 4, 10: 9, 15: 14, 20: 5, 21: 20, 22: 21, 23: 22, 24: 23, 25: 10, 26: 25, 27: 22, 28: 27 };
export const defaultBack = n => (n in BACK) ? BACK[n] : n - 1;

const TRAIL_MAX = 32;

/**
 * 말(또는 업힌 말 묶음)을 steps만큼 옮긴 결과.
 * trail = 지나온 칸 목록(빽도 때 온 길을 되짚는 데 쓴다).
 * 반환: { path:[칸…], dest:칸|FIN, trail:새 trail, shortcut:지름길에 들어섰는지 } 또는 null
 */
export function computeMove(pos, trail, steps, rules) {
  if (pos === DONE) return null;
  const touch = !!(rules && rules.finish === 'touch');
  trail = trail || [];
  if (steps === BACKDO) {
    if (pos === HOME) return null;
    const b = trail.length ? trail[trail.length - 1] : defaultBack(pos);
    const nt = trail.slice(0, -1);
    if (b === 0 && touch) return { path: [0, FIN], dest: FIN, trail: [], shortcut: false, back: true };
    return { path: [b], dest: b, trail: nt, shortcut: false, back: true };
  }
  let cur = pos, pv = trail.length ? trail[trail.length - 1] : null;
  const path = [], nt = trail.slice();
  const shortcut = (pos === 5 || pos === 10 || pos === 22);
  for (let i = 0; i < steps; i++) {
    const n = nextNode(cur, pv, i === 0);
    if (n === FIN) { path.push(FIN); return { path, dest: FIN, trail: [], shortcut }; }
    if (cur !== HOME) nt.push(cur);
    path.push(n);
    if (n === 0 && touch) { path.push(FIN); return { path, dest: FIN, trail: [], shortcut }; }
    pv = cur; cur = n;
  }
  while (nt.length > TRAIL_MAX) nt.shift();
  return { path, dest: cur, trail: nt, shortcut };
}

/** 멈춘 칸 n에서 완주까지 남은 걸음(지름길은 멈췄을 때만 탄다) */
export function distToFin(pos, rules) {
  if (pos === DONE) return 0;
  const touch = !!(rules && rules.finish === 'touch');
  let cur = pos, pv = null, d = 0;
  while (d < 40) {
    const n = nextNode(cur, pv, d === 0);
    d++;
    if (n === FIN || (n === 0 && touch)) return d;
    pv = cur; cur = n;
  }
  return d;
}

/* ---------------------------------------------------------------
 * 게임 상태 (JSON으로 저장 가능)
 *   state.rules = { backdo:bool, finish:'pass'|'touch', backdoEmpty:'void'|'enter', odds:'real'|'fun', nak:bool }
 *   state.teams = [{ rank:null|number, pieces:[{ pos, trail:[] }] }]
 * --------------------------------------------------------------- */

export function newTeams(teamCount, pieceCount) {
  return Array.from({ length: teamCount }, () => ({
    rank: null,
    pieces: Array.from({ length: pieceCount }, () => ({ pos: HOME, trail: [] })),
  }));
}

export function groupAt(tm, pos) {
  const out = [];
  tm.pieces.forEach((q, j) => { if (q.pos === pos) out.push(j); });
  return out;
}

/**
 * 결과 r로 둘 수 있는 수 목록.
 *   { type:'group', pos, idx:[말 번호…], move }  판 위의 말(업힌 말은 함께)
 *   { type:'new',   pos:HOME, idx:[말 번호], move }  새 말 올리기
 */
export function optionsFor(state, t, r) {
  const tm = state.teams[t], opts = [], seen = new Set();
  tm.pieces.forEach(pc => {
    if (pc.pos >= 0 && pc.pos !== DONE && !seen.has(pc.pos)) {
      seen.add(pc.pos);
      const move = computeMove(pc.pos, pc.trail, r, state.rules);
      if (move) opts.push({ type: 'group', pos: pc.pos, move, idx: groupAt(tm, pc.pos) });
    }
  });
  const h = tm.pieces.findIndex(q => q.pos === HOME);
  if (h >= 0) {
    if (r > 0) {
      opts.push({ type: 'new', pos: HOME, move: computeMove(HOME, [], r, state.rules), idx: [h] });
    } else if (r === BACKDO && !opts.length && state.rules.backdoEmpty === 'enter') {
      // 판에 내 말이 없을 때의 빽도(가정 규칙): 새 말이 참먹이 바로 뒤(19칸)에 선다.
      opts.push({ type: 'new', pos: HOME, move: { path: [19], dest: 19, trail: [], shortcut: false, back: true }, idx: [h] });
    }
  }
  return opts;
}

export function anyUsable(state, t, results) {
  return results.some(r => optionsFor(state, t, r).length > 0);
}

/**
 * 수를 적용한다(state를 바꾼다).
 * 반환: { finished:[말], caught:[[팀,말]], stacked:bool, stackSize, dest, teamDone }
 */
export function applyMove(state, t, opt) {
  const tm = state.teams[t], idx = opt.idx, move = opt.move;
  const ev = { finished: [], caught: [], stacked: false, stackSize: idx.length, dest: move.dest, teamDone: false, shortcut: !!move.shortcut };
  if (move.dest === FIN) {
    idx.forEach(i => { tm.pieces[i].pos = DONE; tm.pieces[i].trail = []; });
    ev.finished = idx.slice();
  } else {
    placeGroup(state, t, idx, move.dest, move.trail, ev);
  }
  ev.teamDone = tm.pieces.every(q => q.pos === DONE);
  return ev;
}

/** 말 묶음을 칸 dest에 내려놓고 업기·잡기를 처리한다(이벤트 칸 이동에도 쓴다) */
export function placeGroup(state, t, idx, dest, trail, ev) {
  const tm = state.teams[t];
  ev = ev || { caught: [], stacked: false, stackSize: idx.length };
  ev.stacked = tm.pieces.some((q, j) => q.pos === dest && !idx.includes(j));
  idx.forEach(i => { tm.pieces[i].pos = dest; tm.pieces[i].trail = trail.slice(); });
  if (ev.stacked) tm.pieces.forEach(q => { if (q.pos === dest) q.trail = trail.slice(); });
  ev.stackSize = tm.pieces.filter(q => q.pos === dest).length;
  state.teams.forEach((o, ot) => {
    if (ot === t) return;
    o.pieces.forEach((q, j) => {
      if (q.pos === dest) { ev.caught.push([ot, j]); q.pos = HOME; q.trail = []; }
    });
  });
  return ev;
}

/* ---------------------------------------------------------------
 * 난수와 윷 던지기
 * --------------------------------------------------------------- */

/** 같은 씨앗이면 같은 수열 — 상태에 씨앗을 넣어 두면 되돌리기로 결과를 바꿀 수 없다 */
export function rngNext(state) {
  let a = (state.seed = (state.seed + 0x6D2B79F5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** 윷가락 하나가 평평한 면(배)이 위로 나올 확률 — 실제 윷에서 흔히 쓰는 근삿값 */
export const FLAT_P = 0.6;

/** 결과별 확률표. odds:'fun'이면 윷·모가 자주 나오는 어린이용 */
export function throwOdds(rules) {
  let o;
  if (rules.odds === 'fun') {
    o = { '-1': 0.04, 1: 0.12, 2: 0.30, 3: 0.30, 4: 0.16, 5: 0.08 };
  } else {
    const p = FLAT_P, q = 1 - p;
    o = { '-1': p * q ** 3, 1: 3 * p * q ** 3, 2: 6 * p * p * q * q, 3: 4 * p ** 3 * q, 4: p ** 4, 5: q ** 4 };
  }
  if (!rules.backdo) { o[1] += o['-1']; o['-1'] = 0; }
  return o;
}

export function resultFromFlats(flats, rules) {
  const n = flats.filter(Boolean).length;
  if (n === 0) return 5;
  if (n === 1 && flats[0] && rules.backdo) return BACKDO;
  return n;
}

/** 결과 r이 나오는 윷가락 모양(0번 가락에 '빽' 표시) */
export function flatsFor(r, rules, rnd) {
  if (r === BACKDO) return [true, false, false, false];
  const k = r === 5 ? 0 : r;
  for (;;) {
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const f = [false, false, false, false];
    order.slice(0, k).forEach(i => { f[i] = true; });
    if (!(k === 1 && f[0] && rules.backdo)) return f;
  }
}

/**
 * 윷을 던진다. state.seed를 쓰고 바꾼다.
 * 반환: { r: -1|1..5|'nak', flats:[4], out: 멍석 밖으로 나간 가락 번호(-1 없음) }
 */
export function rollYut(state) {
  const rules = state.rules, rnd = () => rngNext(state);
  if (rules.nak && rnd() < 0.04) {
    const flats = [0, 1, 2, 3].map(() => rnd() < FLAT_P);
    return { r: 'nak', flats, out: Math.floor(rnd() * 4) };
  }
  const odds = throwOdds(rules);
  let x = rnd(), r = 3;
  for (const k of ['-1', '1', '2', '3', '4', '5']) {
    if (x < odds[k]) { r = +k; break; }
    x -= odds[k];
  }
  return { r, flats: flatsFor(r, rules, rnd), out: -1 };
}

export const isBonusThrow = r => r === 4 || r === 5;

/** 받침 있으면 a, 없으면 b (이/가, 은/는, 을/를). 숫자·영문으로 끝나는 이름도 읽는 소리로 판단 */
export function josa(w, a, b) {
  const s = String(w).trim();
  const c = s.charCodeAt(s.length - 1);
  let has = false;
  if (c >= 0xAC00 && c <= 0xD7A3) has = (c - 0xAC00) % 28 !== 0;
  else if (c >= 48 && c <= 57) has = '013678'.includes(s[s.length - 1]);   // 영·일·삼·육·칠·팔(십·백은 0) → 받침
  else if (/[A-Za-z]$/.test(s)) has = /(ng|[lmn])$/i.test(s);              // Tim·Ben·Paul → 이, Anna·Max → 가
  return w + (has ? a : b);
}
