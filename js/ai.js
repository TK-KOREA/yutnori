// 컴퓨터 상대. 쉬움·보통·어려움 세 단계.
// 판 위 칸마다 "완주까지 필요한 던지기 수의 기댓값"(T)을 구해 말의 가치를 매기고,
// 상대가 다음 차례에 그 칸에 올 확률(위험)을 따져 수를 고른다.
import { HOME, DONE, FIN, BACKDO, NODE_COUNT, computeMove, defaultBack, optionsFor, applyMove, throwOdds } from './rules.js';

const RESULTS = [BACKDO, 1, 2, 3, 4, 5];
const tables = new Map();

/** 규칙마다 한 번 계산하는 표: T[칸] 과 확률표 */
function table(rules) {
  const key = `${rules.finish}|${rules.backdo}|${rules.odds}|${rules.backdoEmpty}`;
  if (tables.has(key)) return tables.get(key);
  const odds = throwOdds(rules);
  const states = [HOME, ...Array.from({ length: NODE_COUNT }, (_, i) => i)];
  const next = {};
  for (const n of states) {
    next[n] = RESULTS.map(r => {
      if (!odds[r]) return null;
      const m = n === HOME
        ? (r === BACKDO ? null : computeMove(HOME, [], r, rules))
        : computeMove(n, r === BACKDO ? [defaultBack(n)] : [], r, rules);
      return { p: odds[r], to: m ? m.dest : n };
    }).filter(Boolean);
  }
  const T = {};
  states.forEach(n => { T[n] = 10; });
  for (let it = 0; it < 300; it++) {
    for (const n of states) {
      let s = 1;
      for (const e of next[n]) s += e.p * (e.to === FIN ? 0 : T[e.to]);
      T[n] = s;
    }
  }
  const tb = { T, odds, home: T[HOME] };
  tables.set(key, tb);
  return tb;
}

/** 말 한 개의 가치 */
function pieceValue(tb, pos) {
  if (pos === DONE) return 10 * tb.home + 5;
  if (pos === HOME) return 0;
  return 10 * (tb.home - tb.T[pos]);
}

/** 팀 t의 말이 칸 x에 있을 때, 다음 차례에 상대가 그 칸에 올 확률(윷·모 뒤 한 번 더 포함) */
function hitProb(state, t, x, tb) {
  const rules = state.rules, odds = tb.odds;
  let miss = 1;
  state.teams.forEach((o, ot) => {
    if (ot === t || o.rank != null) return;
    const starts = new Set();
    o.pieces.forEach(q => { if (q.pos !== DONE) starts.add(q.pos); });
    for (const s of starts) {
      const trail = s >= 0 ? [defaultBack(s)] : [];
      let p = 0;
      for (const r of RESULTS) {
        if (!odds[r]) continue;
        const m = computeMove(s, trail, r, rules);
        if (!m) continue;
        if (m.dest === x) p += odds[r];
        if ((r === 4 || r === 5) && m.dest !== FIN) {
          for (const r2 of RESULTS) {
            if (!odds[r2]) continue;
            const m2 = computeMove(m.dest, m.trail, r2, rules);
            if (m2 && m2.dest === x) p += odds[r] * odds[r2];
          }
        }
      }
      miss *= 1 - Math.min(1, p);
    }
  });
  return 1 - miss;
}

/** 이벤트 칸 보너스(잔치 모드) — party.js가 등록한다 */
let tileBonus = () => 0;
export function setTileBonus(fn) { tileBonus = fn || (() => 0); }

/** 보통 난이도의 수 점수 */
function scoreOption(state, t, opt, tb, kind) {
  const tm = state.teams[t], k = opt.idx.length, m = opt.move;
  const src = opt.pos;
  let s = k * (pieceValue(tb, m.dest === FIN ? DONE : m.dest) - pieceValue(tb, src));
  if (m.dest !== FIN) {
    let caughtValue = 0, caught = 0;
    state.teams.forEach((o, ot) => {
      if (ot === t) return;
      o.pieces.forEach(q => { if (q.pos === m.dest) { caught++; caughtValue += pieceValue(tb, q.pos); } });
    });
    if (caught) s += caughtValue + 15;
    const stackK = k + tm.pieces.filter((q, j) => q.pos === m.dest && !opt.idx.includes(j)).length;
    if (stackK > k) s += 5;
    // 도착 칸이 위험하면 그 칸에 서는 말 전체의 가치를 잃을 수 있다
    const risk = hitProb(state, t, m.dest, tb);
    s -= risk * stackK * pieceValue(tb, m.dest) * (kind === 'gentle' ? 0.5 : 1);
    s += tileBonus(state, t, m.dest, opt);
    if (kind === 'gentle' && caught) {
      // 봐주기: 사람 팀 말은 되도록 잡지 않는다
      const humanCaught = state.teams.some((o, ot) => ot !== t && !o.cpu && o.pieces.some(q => q.pos === m.dest));
      if (humanCaught) s -= caughtValue + 60;
    }
  }
  if (src >= 0) s += hitProb(state, t, src, tb) * k * pieceValue(tb, src) * 0.6; // 위험한 칸에서 도망
  return s;
}

function clone(state) {
  return {
    rules: state.rules,
    teams: state.teams.map(o => ({ rank: o.rank, cpu: o.cpu, pieces: o.pieces.map(q => ({ pos: q.pos, trail: q.trail.slice() })) })),
  };
}

/** 한 판 상태를 팀 t 입장에서 평가 */
function evaluate(state, t, tb) {
  let mine = 0, best = 0, danger = 0, oppDanger = 0;
  state.teams.forEach((o, ot) => {
    let sum = 0;
    const seen = new Set();
    o.pieces.forEach(q => {
      sum += pieceValue(tb, q.pos);
      if (q.pos >= 0 && q.pos !== DONE && !seen.has(q.pos)) {
        seen.add(q.pos);
        const k = o.pieces.filter(x => x.pos === q.pos).length;
        const h = hitProb(state, ot, q.pos, tb) * k * pieceValue(tb, q.pos);
        if (ot === t) danger += h; else oppDanger += h;
      }
    });
    if (ot === t) mine = sum; else best = Math.max(best, sum);
  });
  return mine - best - danger + 0.3 * oppDanger;
}

/** 어려움: 가진 결과를 모두 쓰는 순서를 따져 본다 */
function planTurn(state, t, results, tb, budget) {
  let bestScore = -Infinity, bestFirst = null, count = 0;
  const seen = new Set();
  const rec = (st, res, first, bonus) => {
    if (count++ > budget) return;
    let any = false;
    const tried = new Set();
    res.forEach((r, ri) => {
      if (tried.has(r)) return;
      tried.add(r);
      optionsFor(st, t, r).forEach(opt => {
        any = true;
        const s2 = clone(st);
        const ev = applyMove(s2, t, opt);
        const rest = res.slice(0, ri).concat(res.slice(ri + 1));
        const key = JSON.stringify(s2.teams.map(o => o.pieces.map(q => q.pos))) + '|' + rest.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        const b = bonus + (ev.caught.length ? 12 : 0) + tileBonus(st, t, opt.move.dest, opt);
        rec(s2, rest, first || { ri, opt }, b);
      });
    });
    if (!any && first) {
      const sc = evaluate(st, t, tb) + bonus;
      if (sc > bestScore) { bestScore = sc; bestFirst = first; }
    }
  };
  rec(state, results, null, 0);
  return bestFirst;
}

/**
 * 수 고르기.
 * level: 'easy' | 'normal' | 'hard' | 'gentle'(봐주기)
 * rnd: 0~1 난수 함수(게임 상태의 씨앗 난수)
 * 반환: { ri, opt } 또는 null
 */
export function chooseMove(state, t, results, level, rnd) {
  const tb = table(state.rules);
  const all = [];
  results.forEach((r, ri) => optionsFor(state, t, r).forEach(opt => all.push({ ri, opt })));
  if (!all.length) return null;
  if (all.length === 1) return all[0];
  if (level === 'easy' && rnd() < 0.4) return all[Math.floor(rnd() * all.length)];
  if (level === 'hard') {
    const t0 = performance.now();
    const plan = planTurn(state, t, results, tb, 2500);
    if (plan && performance.now() - t0 < 400) return plan;
  }
  let best = null, bestS = -Infinity;
  for (const c of all) {
    let s = scoreOption(state, t, c.opt, tb, level === 'gentle' ? 'gentle' : 'normal');
    if (level === 'easy') s += rnd() * 30;
    else s += rnd() * 0.5;
    if (s > bestS) { bestS = s; best = c; }
  }
  return best;
}

/** 테스트·설명용 */
export function expectedThrows(rules) { return { ...table(rules).T }; }
