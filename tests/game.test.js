import { test, eq, ok } from './harness.js';
import { createGame, computeAwards, newGameState, validSave } from '../js/game.js';
import { HOME, DONE, BACKDO } from '../js/rules.js';

/** 아무것도 그리지 않고 바로 끝나는 가짜 화면 */
function fakeView(hooks = {}) {
  const calls = [];
  const v = new Proxy({}, {
    get(_, name) {
      if (name === 'showMission') return (G, t, m, o) => { calls.push(name); if (hooks.mission) hooks.mission(G, t, m, o); return Promise.resolve(); };
      if (name === 'gameOver') return (G, awards) => { calls.push(name); hooks.over && hooks.over(G, awards); return Promise.resolve(); };
      if (name === 'showChoices') return (G, t, ch) => { calls.push(name); hooks.choices && hooks.choices(G, t, ch); };
      if (name === 'update') return (G, api) => { hooks.update && hooks.update(G, api); };
      return (...a) => { calls.push(name); return Promise.resolve(); };
    },
  });
  return { v, calls };
}
const now = { sleep: () => Promise.resolve() };
const tick = () => new Promise(r => setTimeout(r, 0));

function settings(over = {}) {
  return {
    input: 'screen', pieces: 3, endRule: 'first', auto: true,
    teams: [
      { name: '호랑이팀', species: 'tiger', color: 0, cpu: true, level: 'normal' },
      { name: '토끼팀', species: 'rabbit', color: 1, cpu: true, level: 'easy' },
    ],
    rules: { backdo: true, finish: 'pass', backdoEmpty: 'void', odds: 'real', nak: false },
    party: { on: true, quiet: false },
    ...over,
  };
}

async function runCpuGame(seed, s) {
  let over = null;
  const { v } = fakeView({ over: (G, awards) => { over = { G, awards }; } });
  const game = createGame({ view: v, clock: now });
  game.newGame(s, seed);
  for (let i = 0; i < 20000 && !over; i++) {
    await tick();
    const G = game.state;
    // 불변식: 한 칸에 두 팀이 함께 있지 않다, 말 수 보존
    const occ = {};
    G.teams.forEach((o, ot) => o.pieces.forEach(q => {
      if (q.pos >= 0 && q.pos !== DONE) { if (occ[q.pos] !== undefined && occ[q.pos] !== ot) throw new Error('two teams on ' + q.pos); occ[q.pos] = ot; }
    }));
  }
  if (!over) throw new Error('game did not finish');
  return over;
}

test('컴퓨터끼리 잔치판 한 판이 끝나고 모든 팀이 서로 다른 상을 받는다', async () => {
  for (let s = 1; s <= 6; s++) {
    const st = settings({ teams: [
      { name: 'A', species: 'tiger', color: 0, cpu: true, level: 'normal' },
      { name: 'B', species: 'rabbit', color: 1, cpu: true, level: 'easy' },
      { name: 'C', species: 'pig', color: 2, cpu: true, level: 'hard' },
      { name: 'D', species: 'cow', color: 3, cpu: true, level: 'gentle' },
    ] });
    const { G, awards } = await runCpuGame(1000 + s, st);
    eq(G.phase, 'over');
    eq(awards.length, 4);
    const ids = awards.map(a => a.award.id);
    eq(new Set(ids).size, ids.length, 'awards distinct');
    ok(G.teams.some(t => t.pieces.every(q => q.pos === DONE)), 'someone finished');
  }
});

test('전통판(잔치 칸 끔)도 끝까지 간다', async () => {
  const { G } = await runCpuGame(77, settings({ party: { on: false, quiet: false }, pieces: 4 }));
  eq(G.phase, 'over');
});

test('사람 차례: 던지고 되돌려도 결과가 같다(씨앗 난수)', async () => {
  const s = settings({ teams: [
    { name: '사람', species: 'horse', color: 0, cpu: false },
    { name: '컴', species: 'dog', color: 1, cpu: true },
  ], auto: false });
  const { v } = fakeView();
  const game = createGame({ view: v, clock: now });
  game.newGame(s, 4242);
  await tick();
  ok(game.canThrow(), 'can throw');
  game.throwNow();
  for (let i = 0; i < 20; i++) await tick();
  const first = game.state.results.slice();
  ok(first.length >= 1, 'has result');
  ok(game.canUndo(), 'can undo');
  game.undo();
  for (let i = 0; i < 5; i++) await tick();
  eq(game.state.results.length, 0);
  game.throwNow();
  for (let i = 0; i < 20; i++) await tick();
  eq(game.state.results, first, 'same result after undo');
});

test('컴퓨터 차례에는 되돌릴 수 없다', async () => {
  const s = settings({ teams: [
    { name: '사람', species: 'horse', color: 0, cpu: false },
    { name: '컴', species: 'dog', color: 1, cpu: true },
  ] });
  let sawCpu = false, undoDuringCpu = false;
  const { v } = fakeView({ update: (G, api) => { if (G.teams[G.turn].cpu) { sawCpu = true; if (api.canUndo()) undoDuringCpu = true; } } });
  const game = createGame({ view: v, clock: now });
  game.newGame(s, 99);
  for (let n = 0; n < 60; n++) {
    await tick();
    const G = game.state;
    if (G.phase === 'throw' && game.canThrow()) game.throwNow();
    else if (G.phase === 'move' && !game.busy && !G.teams[G.turn].cpu) game.choose(0);
    else if (G.phase === 'event') game.missionAnswer(true);
  }
  ok(sawCpu, 'cpu played');
  ok(!undoDuringCpu, 'no undo during cpu');
});

test('진짜 윷 입력: 누른 결과가 그대로 들어간다', async () => {
  const s = settings({ input: 'real', teams: [
    { name: '엄마', species: 'sheep', color: 0, cpu: false },
    { name: '아빠', species: 'cow', color: 1, cpu: false },
  ], auto: false });
  const { v } = fakeView();
  const game = createGame({ view: v, clock: now });
  game.newGame(s, 5);
  await tick();
  ok(game.realInput(4));
  for (let i = 0; i < 10; i++) await tick();
  eq(game.state.phase, 'throw', '윷이면 한 번 더');
  ok(game.realInput(2));
  for (let i = 0; i < 10; i++) await tick();
  eq(game.state.results, [4, 2]);
  eq(game.state.phase, 'move');
});

test('미션 칸: 사람이 "해냈어요"를 누르면 한 칸 앞으로', async () => {
  const s = settings({ teams: [
    { name: '가', species: 'horse', color: 0, cpu: false },
    { name: '나', species: 'dog', color: 1, cpu: false },
  ], auto: false, party: { on: true, quiet: false } });
  let shown = null;
  const { v } = fakeView({ mission: (G, t, m) => { shown = m; } });
  const game = createGame({ view: v, clock: now });
  game.newGame(s, 1);
  await tick();
  // 말을 6칸에 두고 도(1)로 7칸(미션)에 멈추게 한다
  const G = game.state;
  G.teams[0].pieces[0].pos = 6; G.teams[0].pieces[0].trail = [5];
  G.phase = 'move'; G.results = [1]; G.pending = 0; G.selected = 0;
  game.select(0);
  await tick();
  const k = game.choiceForPiece(0, 0);
  ok(k >= 0, 'choice for piece');
  game.choose(k);
  for (let i = 0; i < 10; i++) await tick();
  ok(shown, 'mission shown');
  eq(game.state.phase, 'event');
  game.missionAnswer(true);
  for (let i = 0; i < 10; i++) await tick();
  eq(game.state.teams[0].pieces[0].pos, 8, '미션 성공 → 한 칸 앞으로');
  eq(game.state.stats[0].missions, 1);
});

test('저장본 검사', () => {
  const G = newGameState(settings(), 3);
  ok(validSave({ G, hist: [] }));
  ok(!validSave({ G: { ...G, v: 2 } }));
  ok(!validSave(null));
});

test('시상: 한 팀이 모든 기록 1등이어도 다른 팀도 상을 받는다', () => {
  const G = newGameState(settings(), 3);
  G.teams[0].rank = 1; G.ranks = [0]; G.phase = 'over';
  G.stats[0].caught = 5; G.stats[0].res[4] = 3; G.stats[0].res[1] = 4; G.stats[0].shortcuts = 2;
  const a = computeAwards(G);
  eq(a.length, 2);
  ok(a[1].award.id !== a[0].award.id);
});

test('연출 도중 새로고침: 마지막 말이 들어가던 판은 이어하면 우승으로 끝난다', async () => {
  const s = settings({ pieces: 2, auto: false, party: { on: false, quiet: false }, teams: [
    { name: '가', species: 'horse', color: 0, cpu: false },
    { name: '나', species: 'dog', color: 1, cpu: false },
  ] });
  let saved = null;
  const stuck = fakeView();
  const v1 = new Proxy(stuck.v, { get(o, n) { return n === 'animateMove' ? () => new Promise(() => {}) : o[n]; } });
  const game = createGame({ view: v1, clock: now, store: { save: (G, hist) => { saved = JSON.parse(JSON.stringify({ G, hist })); } } });
  game.newGame(s, 1);
  await tick();
  const G = game.state;
  G.teams[0].pieces[0].pos = DONE; G.teams[0].pieces[1].pos = 19; G.teams[0].pieces[1].trail = [18];
  G.phase = 'move'; G.results = [2]; G.pending = 0; G.selected = 0;
  game.select(0);
  await tick();
  ok(game.choose(0), 'chose');
  for (let i = 0; i < 5; i++) await tick();
  ok(saved && saved.G.moving, 'saved mid-move');
  let over = null;
  const { v } = fakeView({ over: G2 => { over = G2; } });
  const g2 = createGame({ view: v, clock: now });
  ok(g2.resume(saved), 'resumed');
  for (let i = 0; i < 10; i++) await tick();
  ok(over, 'game over after resume');
  eq(g2.state.ranks, [0]);
});

test('미션 카드는 사람이 답하면 닫힌다', async () => {
  const s = settings({ auto: false, teams: [
    { name: '가', species: 'horse', color: 0, cpu: false },
    { name: '나', species: 'dog', color: 1, cpu: false },
  ] });
  const { v, calls } = fakeView();
  const game = createGame({ view: v, clock: now });
  game.newGame(s, 1);
  await tick();
  const G = game.state;
  G.teams[0].pieces[0].pos = 6; G.teams[0].pieces[0].trail = [5];
  G.phase = 'move'; G.results = [1]; G.pending = 0; G.selected = 0;
  game.select(0);
  await tick();
  game.choose(game.choiceForPiece(0, 0));
  for (let i = 0; i < 10; i++) await tick();
  eq(game.state.phase, 'event');
  game.missionAnswer(false);
  for (let i = 0; i < 10; i++) await tick();
  ok(calls.includes('hideMission'), 'hideMission called');
  ok(game.state.phase !== 'event');
});

test('2팀 경기의 꼴찌는 대역전상을 받지 않는다', () => {
  const G = newGameState(settings(), 3);
  G.teams[0].rank = 1; G.ranks = [0]; G.phase = 'over';
  G.stats[1].lastTurns = 10;
  const a = computeAwards(G);
  ok(a[1].award.id !== 'comeback');
});

test('시상: 1등 기록이 없는 두 팀도 서로 다른 상을 받는다', () => {
  const G = newGameState(settings({ teams: [
    { name: 'A', species: 'tiger', color: 0, cpu: true }, { name: 'B', species: 'rabbit', color: 1, cpu: true }, { name: 'C', species: 'pig', color: 2, cpu: true },
  ] }), 3);
  G.teams[0].rank = 1; G.ranks = [0]; G.phase = 'over';
  G.stats[0].caught = 1; G.stats[0].res[5] = 1;
  G.stats[1].res[2] = 3; G.stats[2].res[3] = 2;
  const ids = computeAwards(G).map(a => a.award.id);
  eq(new Set(ids).size, 3, ids.join(','));
});
