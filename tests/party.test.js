import { test, eq, ok } from './harness.js';
import { TILES, tileAt, coolDown, resolveTile, drawMission, MISSIONS, newPartyState, tileBonusFor } from '../js/party.js';
import { newTeams, HOME } from '../js/rules.js';

const RULES = { backdo: true, finish: 'pass', backdoEmpty: 'void', odds: 'real', nak: false };
const mk = (on = true, quiet = false) => ({ rules: RULES, teams: newTeams(2, 3), party: newPartyState(on, false, quiet), turnSerial: 0 });

test('잔치 칸은 켰을 때만 발동한다', () => {
  ok(tileAt(mk(true), 12));
  eq(tileAt(mk(false), 12), null);
  eq(tileAt(mk(true), 11), null);
});
test('호랑이 굴(매운맛)은 기본으로 꺼져 있다', () => {
  eq(tileAt(mk(true), 23), null);
});
test('한 번 발동한 칸은 모든 팀이 한 번씩 할 때까지 쉰다', () => {
  const st = mk();
  coolDown(st, 12);
  eq(tileAt(st, 12), null);
  st.turnSerial = 1; eq(tileAt(st, 12), null);
  st.turnSerial = 2; ok(tileAt(st, 12));
});
test('선물 상자: 꼴찌 팀은 늘 한 번 더', () => {
  const st = mk();
  st.teams[1].pieces[0].pos = 10;
  const eff = resolveTile(st, 0, 4, TILES[4], () => 0.99);
  eq(eff.kind, 'extra');
});
test('친구 부르기: 집에 말이 없으면 한 번 더', () => {
  const st = mk();
  st.teams[0].pieces.forEach(q => { q.pos = 26; });
  eq(resolveTile(st, 0, 26, TILES[26], () => 0.5).kind, 'extra');
  st.teams[0].pieces[2].pos = HOME;
  eq(resolveTile(st, 0, 26, TILES[26], () => 0.5).kind, 'friend');
});
test('미션은 한 판에서 겹치지 않고, 다 쓰면 다시 섞는다', () => {
  const st = mk();
  let x = 0;
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const seen = new Set();
  for (let i = 0; i < MISSIONS.length; i++) seen.add(drawMission(st, rnd).id);
  eq(seen.size, MISSIONS.length);
  ok(drawMission(st, rnd));
});
test('조용 모드에서는 소리·몸 미션이 안 나온다', () => {
  const st = mk(true, true);
  for (let i = 0; i < 40; i++) { const m = drawMission(st, Math.random); ok(m.kind !== 'sound' && m.kind !== 'body' && !/외치|박수/.test(m.text), m.text); }
});
test('컴퓨터 점수: 웅덩이는 피하고 까치는 좋아한다', () => {
  const st = mk();
  ok(tileBonusFor(st, 0, 18) < 0);
  ok(tileBonusFor(st, 0, 12) > 0);
  eq(tileBonusFor(mk(false), 0, 12), 0);
});
