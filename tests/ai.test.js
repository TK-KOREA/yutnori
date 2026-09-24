import { test, eq, ok } from './harness.js';
import { HOME, DONE, FIN, newTeams, optionsFor, applyMove, rollYut, rngNext, isBonusThrow } from '../js/rules.js';
import { chooseMove, expectedThrows } from '../js/ai.js';

const RULES = { backdo: true, finish: 'pass', backdoEmpty: 'void', odds: 'real', nak: false };
const mk = (teams = 2, pieces = 4, seed = 99) => ({ rules: RULES, teams: newTeams(teams, pieces), seed });
const put = (st, t, i, pos, trail = []) => { st.teams[t].pieces[i].pos = pos; st.teams[t].pieces[i].trail = trail; };

test('기대 던지기 수: 방·뒷모가 모보다, 모가 4칸보다 가깝다', () => {
  const T = expectedThrows(RULES);
  ok(T[22] < T[10], 'T22<T10');
  ok(T[10] < T[5], 'T10<T5');
  ok(T[5] < T[4], 'T5<T4');
  ok(T[HOME] > T[1], 'HOME farthest');
});

for (const level of ['easy', 'normal', 'hard', 'gentle']) {
  test(`${level}: 둘 수 있는 수만 고른다`, () => {
    const st = mk();
    put(st, 0, 0, 3, [2]);
    const c = chooseMove(st, 0, [2, 4], level, () => rngNext(st));
    ok(c && optionsFor(st, 0, [2, 4][c.ri]).some(o => o.pos === c.opt.pos));
  });
}

test('보통: 잡을 수 있으면 잡는다', () => {
  const st = mk();
  put(st, 0, 0, 2, [1]); put(st, 1, 0, 5, [4]);
  const c = chooseMove(st, 0, [3], 'normal', () => 0.5);
  eq(c.opt.move.dest, 5);
});
test('보통: 잡힐 위험이 있는 말은 완주시킨다', () => {
  const st = mk();
  put(st, 0, 0, 19, [18]); put(st, 0, 1, 3, [2]); put(st, 1, 0, 16, [15]);
  const c = chooseMove(st, 0, [2], 'normal', () => 0.5);
  eq(c.opt.move.dest, FIN);
});
test('어려움: [도, 윷]이면 도로 모에 먼저 선 뒤 지름길을 노린다', () => {
  const st = mk(2, 1);
  put(st, 0, 0, 4, [3]);
  const c = chooseMove(st, 0, [1, 4], 'hard', () => 0.5);
  eq(c.ri, 0, '도부터');
});

/** CPU끼리 한 판을 끝까지 둔다(규칙 + AI 통합 시험) */
function playOut(seed, teams, pieces, levels) {
  const st = { rules: RULES, teams: newTeams(teams, pieces), seed };
  st.teams.forEach(o => { o.cpu = true; });
  let turn = 0, turns = 0;
  const rnd = () => rngNext(st);
  while (turns < 600) {
    turns++;
    const results = [];
    let throws = 1;
    while (throws > 0) {
      throws--;
      const y = rollYut(st);
      results.push(y.r);
      if (isBonusThrow(y.r)) throws++;
      while (!throws && results.length) {
        const c = chooseMove(st, turn, results, levels[turn], rnd);
        if (!c) { results.length = 0; break; }
        results.splice(c.ri, 1);
        const ev = applyMove(st, turn, c.opt);
        // 불변식: 한 칸에 두 팀이 함께 있지 않다
        const occ = {};
        st.teams.forEach((o, ot) => o.pieces.forEach(q => { if (q.pos >= 0 && q.pos !== DONE) { if (occ[q.pos] !== undefined && occ[q.pos] !== ot) throw new Error('two teams on ' + q.pos); occ[q.pos] = ot; } }));
        if (ev.teamDone) return { winner: turn, turns };
        if (ev.caught.length) throws++;
      }
    }
    turn = (turn + 1) % teams;
  }
  throw new Error('game did not finish in 600 turns');
}

test('CPU끼리 200판: 모두 끝나고 불변식 유지', () => {
  for (let s = 1; s <= 200; s++) playOut(s * 7919, 2 + (s % 3), 2 + (s % 3), ['normal', 'easy', 'hard', 'gentle']);
});
test('어려움이 쉬움을 이긴다(120판 중 60% 이상)', () => {
  let hard = 0;
  for (let s = 1; s <= 120; s++) {
    const swap = s % 2 === 0;
    const r = playOut(s * 104729, 2, 4, swap ? ['easy', 'hard'] : ['hard', 'easy']);
    if ((r.winner === 0) !== swap) hard++;
  }
  ok(hard >= 72, `hard won ${hard}/120`);
});
