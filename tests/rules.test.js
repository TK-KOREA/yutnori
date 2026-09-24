import { test, eq, ok } from './harness.js';
import {
  FIN, HOME, DONE, BACKDO, nextNode, computeMove, distToFin, optionsFor, applyMove,
  newTeams, throwOdds, rollYut, flatsFor, resultFromFlats, rngNext, josa,
} from '../js/rules.js';

const PASS = { backdo: true, finish: 'pass', backdoEmpty: 'void', odds: 'real', nak: false };
const TOUCH = { ...PASS, finish: 'touch' };
const mk = (rules, teams = 2, pieces = 4) => ({ rules, teams: newTeams(teams, pieces), seed: 12345 });
const put = (st, t, i, pos, trail = []) => { st.teams[t].pieces[i].pos = pos; st.teams[t].pieces[i].trail = trail; };

/* 이동 경로 */
test('새 말: 도는 1칸, 모는 5칸(모 자리)', () => {
  eq(computeMove(HOME, [], 1, PASS).dest, 1);
  eq(computeMove(HOME, [], 5, PASS).path, [1, 2, 3, 4, 5]);
});
test('모에 멈춘 말은 지름길로 들어간다', () => {
  eq(computeMove(5, [4], 3, PASS).path, [20, 21, 22]);
});
test('모를 지나가기만 하면 바깥 길로 간다', () => {
  eq(computeMove(3, [2], 4, PASS).path, [4, 5, 6, 7]);
});
test('뒷모에 멈추면 방을 지나 참먹이 쪽으로 곧장 간다', () => {
  eq(computeMove(10, [9], 5, PASS).path, [25, 26, 22, 27, 28]);
});
test('모 대각선으로 방을 지나가면 찌모 쪽으로 직진', () => {
  eq(computeMove(20, [5], 4, PASS).path, [21, 22, 23, 24]);
});
test('방에 멈췄다 출발하면 참먹이 쪽', () => {
  eq(computeMove(22, [21], 2, PASS).path, [27, 28]);
});
test('찌모 대각선 끝(24)에서 찌모(15)로 이어진다', () => {
  eq(computeMove(24, [23], 2, PASS).path, [15, 16]);
});
test('지나야 완주: 참먹이에 딱 멈추면 머문다', () => {
  const m = computeMove(19, [18], 1, PASS);
  eq(m.dest, 0);
  eq(computeMove(0, [19], 1, PASS).dest, FIN);
});
test('지나야 완주: 19에서 개면 완주', () => {
  eq(computeMove(19, [18], 2, PASS).dest, FIN);
});
test('닿으면 완주: 참먹이에 닿자마자 완주', () => {
  const m = computeMove(18, [17], 2, TOUCH);
  eq(m.dest, FIN); eq(m.path, [19, 0, FIN]);
});
test('28에서 도: 지나야 완주면 참먹이, 닿으면 완주면 완주', () => {
  eq(computeMove(28, [27], 1, PASS).dest, 0);
  eq(computeMove(28, [27], 1, TOUCH).dest, FIN);
});

/* 빽도 */
test('빽도: 1칸에서 참먹이로', () => {
  eq(computeMove(1, [], BACKDO, PASS).dest, 0);
});
test('빽도: 판에 없는 말은 움직일 수 없다', () => {
  eq(computeMove(HOME, [], BACKDO, PASS), null);
});
test('빽도: 온 길을 되짚는다(두 번 연속, 원본 버그 B9)', () => {
  // 10 → 25 → 26 → 22 에 멈춘 뒤 개 → 27, 28? 아니, 방에서 개면 27,28. 여기서는 22→27(도)
  let m = computeMove(10, [9], 3, PASS); // 25,26,22
  eq(m.dest, 22);
  m = computeMove(22, m.trail, 1, PASS); // 27
  eq(m.dest, 27);
  m = computeMove(27, m.trail, BACKDO, PASS);
  eq(m.dest, 22);
  m = computeMove(22, m.trail, BACKDO, PASS);
  eq(m.dest, 26, '방에서 한 번 더 빽도하면 온 길(26)로');
});
test('빽도: 기록이 없으면 기본 뒤 칸', () => {
  eq(computeMove(20, [], BACKDO, PASS).dest, 5);
  eq(computeMove(0, [], BACKDO, PASS).dest, 19);
});
test('빽도: 닿으면 완주 규칙에서 참먹이로 돌아오면 완주', () => {
  eq(computeMove(1, [], BACKDO, TOUCH).dest, FIN);
});
test('빽도로 모에 선 말은 다음에 지름길', () => {
  const m = computeMove(20, [5], BACKDO, PASS);
  eq(m.dest, 5);
  eq(computeMove(5, m.trail, 1, PASS).dest, 20);
});

/* 거리 */
test('완주까지 거리(쉬지 않고 걸을 때)', () => {
  eq(distToFin(HOME, PASS), 21);
  eq(distToFin(5, PASS), 12, '모에서 출발해 방을 지나면 찌모 쪽으로 간다');
  eq(distToFin(10, PASS), 7);
  eq(distToFin(22, PASS), 4);
  eq(distToFin(4, PASS), 17, '4칸은 모를 지나가므로 바깥 길');
});

/* 수 목록과 적용 */
test('판이 비었을 때 빽도는 둘 곳이 없다(기본 규칙)', () => {
  const st = mk(PASS);
  eq(optionsFor(st, 0, BACKDO).length, 0);
});
test('판이 비었을 때 빽도(가정 규칙): 새 말이 19칸에', () => {
  const st = mk({ ...PASS, backdoEmpty: 'enter' });
  const o = optionsFor(st, 0, BACKDO);
  eq(o.length, 1); eq(o[0].move.dest, 19);
});
test('업힌 말은 한 묶음으로 한 가지 수', () => {
  const st = mk(PASS);
  put(st, 0, 0, 3, [2]); put(st, 0, 1, 3, [2]);
  const o = optionsFor(st, 0, 2);
  eq(o.filter(x => x.type === 'group').length, 1);
  eq(o[0].idx, [0, 1]);
});
test('상대 말을 잡으면 집으로 보낸다', () => {
  const st = mk(PASS);
  put(st, 0, 0, 2, [1]); put(st, 1, 0, 4, [3]); put(st, 1, 1, 4, [3]);
  const opt = optionsFor(st, 0, 2).find(o => o.pos === 2);
  const ev = applyMove(st, 0, opt);
  eq(ev.caught.length, 2);
  eq(st.teams[1].pieces[0].pos, HOME);
  eq(st.teams[0].pieces[0].pos, 4);
});
test('우리 말 위에 서면 업는다', () => {
  const st = mk(PASS);
  put(st, 0, 0, 2, [1]); put(st, 0, 1, 4, [3]);
  const opt = optionsFor(st, 0, 2).find(o => o.pos === 2);
  const ev = applyMove(st, 0, opt);
  ok(ev.stacked); eq(ev.stackSize, 2);
});
test('모든 말이 들어오면 teamDone', () => {
  const st = mk(PASS, 2, 2);
  put(st, 0, 0, DONE); put(st, 0, 1, 19, [18]);
  const opt = optionsFor(st, 0, 3).find(o => o.pos === 19);
  const ev = applyMove(st, 0, opt);
  ok(ev.teamDone);
});
test('지나가는 칸의 상대 말은 잡지 않는다', () => {
  const st = mk(PASS);
  put(st, 0, 0, 1, []); put(st, 1, 0, 2, [1]);
  applyMove(st, 0, optionsFor(st, 0, 3).find(o => o.pos === 1));
  eq(st.teams[1].pieces[0].pos, 2);
});

/* 던지기 */
test('확률표 합은 1', () => {
  for (const r of [PASS, { ...PASS, backdo: false }, { ...PASS, odds: 'fun' }]) {
    const o = throwOdds(r); const s = Object.values(o).reduce((a, b) => a + b, 0);
    ok(Math.abs(s - 1) < 1e-9, 'sum ' + s);
  }
});
test('flatsFor는 결과와 같은 윷가락 모양을 만든다', () => {
  const st = { seed: 7 };
  for (const r of [BACKDO, 1, 2, 3, 4, 5]) for (let k = 0; k < 20; k++) {
    eq(resultFromFlats(flatsFor(r, PASS, () => rngNext(st)), PASS), r);
  }
});
test('같은 씨앗이면 같은 결과(되돌려도 결과가 안 바뀜)', () => {
  const a = mk(PASS), b = mk(PASS);
  const ra = [0, 1, 2, 3, 4].map(() => rollYut(a).r), rb = [0, 1, 2, 3, 4].map(() => rollYut(b).r);
  eq(ra, rb);
});
test('던지기 분포가 확률표와 비슷하다', () => {
  const st = mk(PASS), n = 20000, c = {};
  for (let i = 0; i < n; i++) { const r = rollYut(st).r; c[r] = (c[r] || 0) + 1; }
  const o = throwOdds(PASS);
  for (const k of Object.keys(o)) ok(Math.abs((c[k] || 0) / n - o[k]) < 0.015, `${k}: ${(c[k] || 0) / n} vs ${o[k]}`);
});

test('조사: 받침·숫자·영문 끝', () => {
  eq(josa('호랑이팀', '이', '가'), '호랑이팀이');
  eq(josa('엄마', '이', '가'), '엄마가');
  eq(josa('팀1', '이', '가'), '팀1이');
  eq(josa('엄마2', '이', '가'), '엄마2가');
  eq(josa('Tim', '이', '가'), 'Tim이');
  eq(josa('Anna', '이', '가'), 'Anna가');
});
