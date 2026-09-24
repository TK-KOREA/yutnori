// 경기 진행(상태 기계). 무엇이 일어나는지는 여기서 정하고, 어떻게 보이는지는 view가 맡는다.
// 상태 G는 JSON으로 저장할 수 있고, 모든 난수는 G.seed에서 나온다(되돌려도 결과가 같다).
import {
  HOME, DONE, FIN, BACKDO, newTeams, optionsFor, applyMove, placeGroup, groupAt, rollYut, flatsFor,
  rngNext, isBonusThrow, computeMove, distToFin, RESULT_NAME, josa,
} from './rules.js';
import { chooseMove, setTileBonus } from './ai.js';
import { TILES, newPartyState, tileAt, resolveTile, coolDown, tileBonusFor } from './party.js';

export const SAVE_VERSION = 3;

const HIST_MAX = 80;

setTileBonus((st, t, dest) => tileBonusFor(st, t, dest));

function newStats() {
  return { res: { '-1': 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, nak: 0 }, caught: 0, gotCaught: 0, stacks: 0, maxStack: 1, shortcuts: 0, firstFinish: false, events: 0, missions: 0, lastTurns: 0 };
}

/**
 * settings = {
 *   input:'screen'|'real', pieces:2..4, endRule:'first'|'all', auto:bool,
 *   teams:[{ name, species, color, cpu, level }],
 *   rules:{ backdo, finish, backdoEmpty, odds, nak }, party:{ on, quiet },
 * }
 */
export function newGameState(settings, seed) {
  const s = JSON.parse(JSON.stringify(settings));
  const teams = newTeams(s.teams.length, s.pieces).map((tm, i) => ({
    ...tm,
    name: s.teams[i].name, species: s.teams[i].species, color: s.teams[i].color,
    cpu: !!s.teams[i].cpu, level: s.teams[i].level || 'normal',
  }));
  return {
    v: SAVE_VERSION,
    settings: s,
    rules: { ...s.rules, nak: s.input === 'screen' && !!s.rules.nak },
    party: newPartyState(s.party && s.party.on, false, s.party && s.party.quiet),
    seed: seed | 0,
    teams,
    turn: 0, turnSerial: 0,
    phase: 'throw',          // throw | move | event | over
    pending: 1,              // 남은 던지기 횟수
    results: [],             // 아직 안 쓴 결과
    selected: 0,
    ranks: [],
    stats: teams.map(() => newStats()),
    event: null,             // 열려 있는 미션 카드 { t, node, mission }
    moving: null,            // 연출 중인 수(새로고침 뒤 마무리용) { t, node, eff }
    log: [],
    winner: null,
  };
}

/** 팀 진행도(시상·순위용) */
export function progressOf(G, t) {
  return G.teams[t].pieces.reduce((s, q) => s + (q.pos === DONE ? 30 : q.pos === HOME ? 0 : 30 - distToFin(q.pos, G.rules)), 0);
}

/** 경기 끝 순위: 들어온 순서, 나머지는 진행도 */
export function finalOrder(G) {
  return G.teams.map((_, i) => i).sort((a, b) => {
    const ra = G.teams[a].rank, rb = G.teams[b].rank;
    if (ra && rb) return ra - rb;
    if (ra) return -1;
    if (rb) return 1;
    return progressOf(G, b) - progressOf(G, a);
  });
}

/** 모든 팀이 서로 다른 상을 하나 이상 받도록 나눈다 */
export const AWARDS = [
  { id: 'catch', icon: '🏹', name: '잡기왕', desc: '상대 말을 가장 많이 잡았어요', score: s => s.caught },
  { id: 'luck', icon: '🍀', name: '행운왕', desc: '윷과 모가 가장 많이 나왔어요', score: s => s.res[4] + s.res[5] * 2 },
  { id: 'stack', icon: '🎒', name: '업기왕', desc: '친구를 가장 많이 업어 줬어요', score: s => (s.maxStack > 1 ? s.maxStack * 10 + s.stacks : 0) },
  { id: 'comeback', icon: '🚀', name: '대역전상', desc: '뒤에서부터 쑥쑥 따라왔어요', score: (s, G, t) => { const p = finalOrder(G).indexOf(t); return s.lastTurns > 0 && p <= 1 && p < G.teams.length - 1 ? s.lastTurns : 0; } },
  { id: 'shortcut', icon: '🧭', name: '지름길 탐험가', desc: '지름길을 가장 많이 탔어요', score: s => s.shortcuts },
  { id: 'mission', icon: '🎭', name: '미션 스타', desc: '가족 미션을 가장 많이 해냈어요', score: s => s.missions },
  { id: 'first', icon: '🏃', name: '첫 완주상', desc: '가장 먼저 말을 들여보냈어요', score: s => (s.firstFinish ? 1 : 0) },
  { id: 'tumbler', icon: '💪', name: '오뚝이상', desc: '잡혀도 씩씩하게 다시 달렸어요', score: s => (s.gotCaught >= 2 ? s.gotCaught : 0) },
  { id: 'back', icon: '🔙', name: '뒷걸음 달인', desc: '빽도가 가장 많이 나왔어요', score: s => s.res[-1] },
  { id: 'turtle', icon: '🐢', name: '거북이상', desc: '천천히 가도 괜찮아요! 도가 가장 많이 나왔어요', score: s => s.res[1] },
];
export const AWARD_FALLBACK = { id: 'best', icon: '🌟', name: '끝까지 최고상', desc: '끝까지 즐겁게 함께했어요' };
/** 기록으로 받을 상이 모자랄 때 나눠 주는 상(팀은 최대 4개라 늘 하나는 남는다) */
const EXTRA_AWARDS = [AWARD_FALLBACK,
  { id: 'smile', icon: '😊', name: '웃음상', desc: '함께 웃으며 즐겁게 놀았어요' },
  { id: 'cheer', icon: '📣', name: '응원왕', desc: '친구들을 신나게 응원했어요' },
  { id: 'friend', icon: '🤝', name: '사이좋은상', desc: '사이좋게 끝까지 함께했어요' }];

export function computeAwards(G) {
  const order = finalOrder(G);
  const given = new Set(), out = {};
  // 뒤 순위 팀부터 고르게 해서 진 팀도 좋은 상을 받게 한다
  for (const t of order.slice().reverse()) {
    let best = null;
    for (const a of AWARDS) {
      if (given.has(a.id)) continue;
      const v = a.score(G.stats[t], G, t);
      if (!(v > 0)) continue;
      const top = Math.max(...G.teams.map((_, u) => a.score(G.stats[u], G, u)));
      if (v < top) continue;
      best = a; break;
    }
    if (best) { given.add(best.id); out[t] = best; }
  }
  // 1등 기록이 없는 팀: 남은 상 중 자기 기록이 가장 좋은 것, 없으면 남은 추가 상(팀마다 다른 상)
  for (const t of order.slice().reverse()) {
    if (out[t]) continue;
    let best = null, bv = 0;
    for (const a of AWARDS) {
      if (given.has(a.id)) continue;
      const v = a.score(G.stats[t], G, t);
      if (v > bv) { best = a; bv = v; }
    }
    best = best || EXTRA_AWARDS.find(a => !given.has(a.id));
    given.add(best.id);
    out[t] = best;
  }
  return order.map((t, k) => ({ t, place: k + 1, award: out[t] }));
}

/**
 * 컨트롤러.
 * view: 화면 쪽 구현(가짜로 바꿔 끼우면 테스트에서 한 판을 통째로 돌릴 수 있다)
 * store: { save(G, hist), clear() }
 * clock: { sleep(ms) } — 없으면 일시정지를 지키는 setTimeout
 */
export function createGame({ view, store, clock } = {}) {
  let G = null, hist = [], token = 0, busy = false, paused = false, noAuto = false;
  let anim = null; // 윷가락·말이 움직이는 동안 화면에 결과를 미리 보이지 않게(저장하지 않음)
  let missionWait = null;

  const sleep = clock && clock.sleep ? clock.sleep : (ms => new Promise(res => {
    let left = ms, last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (!paused) left -= now - last;
      last = now;
      if (left <= 0) res(); else setTimeout(tick, Math.min(left, 120));
    };
    setTimeout(tick, Math.min(ms, 120));
  }));
  const rnd = () => rngNext(G);
  const human = () => G && !G.teams[G.turn].cpu;
  const save = () => { if (store && G) store.save(G, hist); };
  const log = (text, t) => { G.log.push({ t: t === undefined ? G.turn : t, text }); if (G.log.length > 60) G.log.shift(); };

  function snapshot() {
    const { settings, ...rest } = G;
    hist.push({ serial: G.turnSerial, team: G.turn, state: JSON.stringify(rest) });
    if (hist.length > HIST_MAX) hist.shift();
  }

  function canUndo() {
    if (!G || busy || !hist.length || G.phase === 'event') return false;
    const top = hist[hist.length - 1];
    if (G.phase === 'over') return top.serial === G.turnSerial;
    if (!human()) return false;
    if (G.settings.input === 'real') return true;
    if (top.serial === G.turnSerial) return true;
    return top.serial === G.turnSerial - 1 && G.phase === 'throw' && !G.results.length && G.pending === 1 && !G.teams[top.team].cpu;
  }

  function undo() {
    if (!canUndo()) return false;
    const top = hist.pop();
    token++;
    busy = false;
    anim = null;
    const st = JSON.parse(top.state);
    const who = G.teams.map(t => [t.cpu, t.level]);   // 경기 중에 바꾼 사람/컴퓨터 설정은 되돌리지 않는다
    G = { ...st, settings: G.settings };
    G.teams.forEach((t, i) => { if (who[i]) [t.cpu, t.level] = who[i]; });
    noAuto = true;
    view.load(G, { undo: true });
    view.toast && view.toast('한 수 되돌렸어요');
    step(token);
    return true;
  }

  /* ---------------- 흐름 ---------------- */

  function beginTurn(tk) {
    G.phase = 'throw'; G.pending = 1; G.results = []; G.selected = 0; G.bonus = false;
    save();
    view.turnStart(G, G.turn);
    return step(tk);
  }

  async function step(tk) {
    if (tk !== token || !G) return;
    save();
    view.update(G, api);
    if (G.phase === 'over') return;
    if (G.phase === 'event') { await runMission(tk); return; }
    const tm = G.teams[G.turn];
    if (G.phase === 'throw') {
      if (tm.cpu) {
        await sleep(650);
        if (tk !== token) return;
        await doThrow(null, tk, 0.6);
      }
      return; // 사람은 throwNow()/realInput()을 기다린다
    }
    if (G.phase === 'move') {
      const usable = G.results.map(r => optionsFor(G, G.turn, r).length > 0);
      if (!usable.some(Boolean)) {
        busy = true;
        log(`${tm.name}: 움직일 말이 없어요`);
        view.update(G, api);
        await view.announce(G, 'noMove', { t: G.turn });
        await sleep(900);
        if (tk !== token) return;
        busy = false;
        return endTurn(tk);
      }
      if (G.selected >= G.results.length || !usable[G.selected]) G.selected = usable.indexOf(true);
      if (tm.cpu) {
        busy = true;
        view.update(G, api);
        const c = chooseMove(G, G.turn, G.results, tm.level, rnd);
        if (c) view.cpuThinking && view.cpuThinking(G, G.turn, c);
        await sleep(700);
        if (tk !== token) return;
        busy = false;
        if (!c) return endTurn(tk);
        return doMove(c.ri, c.opt, tk, false);
      }
      const opts = optionsFor(G, G.turn, G.results[G.selected]);
      view.showChoices(G, G.turn, choiceList(opts));
      view.update(G, api);
      const skip = noAuto; noAuto = false;
      if (!skip && G.settings.auto && G.results.length === 1 && opts.length === 1) {
        busy = true;
        view.update(G, api);
        await sleep(650);
        if (tk !== token) return;
        busy = false;
        return doMove(G.selected, opts[0], tk, false);
      }
    }
  }

  /** 화면에 보여 줄 선택지(번호 붙임) */
  function choiceList(opts) {
    return opts.map((o, k) => {
      const dest = o.move.dest;
      const tags = [];
      if (dest !== FIN) {
        const enemy = G.teams.some((x, ot) => ot !== G.turn && x.pieces.some(q => q.pos === dest));
        const mine = G.teams[G.turn].pieces.some((q, j) => q.pos === dest && !o.idx.includes(j));
        if (enemy) tags.push('catch');
        if (mine) tags.push('stack');
        if (dest === 5 || dest === 10 || dest === 22) tags.push('corner');
        const tile = tileAt(G, dest);
        if (tile) tags.push('tile:' + tile.id);
      } else tags.push('finish');
      if (o.move.shortcut) tags.push('shortcut');
      return { k, label: String(k + 1), opt: o, dest, tags };
    });
  }

  async function doThrow(realR, tk, power) {
    const t = G.turn, st = G.stats[t];
    busy = true;
    if (!G.teams[t].cpu) snapshot();
    let roll;
    if (realR != null) {
      roll = realR === 'nak'
        ? { r: 'nak', flats: [0, 1, 2, 3].map(() => rnd() < 0.6), out: Math.floor(rnd() * 4) }
        : { r: realR, flats: flatsFor(realR, G.rules, rnd), out: -1 };
    } else roll = rollYut(G);
    G.pending--;
    st.res[roll.r] = (st.res[roll.r] || 0) + 1;
    if (roll.r === 'nak') log(`${G.teams[t].name}: 낙`);
    else {
      G.results.push(roll.r);
      log(`${G.teams[t].name}: ${RESULT_NAME[roll.r]}`);
      if (isBonusThrow(roll.r)) G.pending++;
    }
    const again = G.pending > 0;
    if (!again) G.phase = G.results.length ? 'move' : 'throw';
    save(); // 던지자마자 저장 — 새로고침으로 다시 던질 수 없다
    anim = { kind: 'throw', shown: G.results.length - (roll.r === 'nak' ? 0 : 1) };
    view.update(G, api);
    await view.throwSticks(G, t, roll, { power, gentle: realR != null });
    if (tk !== token) return;
    anim = null;
    view.update(G, api);
    await view.showResult(G, t, roll.r, { again });
    if (tk !== token) return;
    busy = false;
    if (!again && !G.results.length) return endTurn(tk);
    return step(tk);
  }

  async function doMove(ri, opt, tk, byHuman) {
    const t = G.turn, tm = G.teams[t], st = G.stats[t];
    busy = true;
    if (byHuman) snapshot();
    view.clearChoices();
    G.results.splice(ri, 1);
    G.selected = 0;
    const from = opt.pos;
    const ev = applyMove(G, t, opt);
    recordMove(t, ev, opt.move.shortcut);
    if (ev.caught.length) G.pending++;
    let eff = null, tile = null;
    if (ev.dest !== FIN && !ev.teamDone) {
      tile = tileAt(G, ev.dest);
      if (tile) {
        eff = resolveTile(G, t, ev.dest, tile, rnd);
        coolDown(G, ev.dest);
        st.events++;
        if (eff.kind === 'mission') { G.phase = 'event'; G.event = { t, node: ev.dest, mission: eff.mission }; }
      }
    }
    G.moving = { t, node: ev.dest, eff: eff && eff.kind !== 'mission' ? eff : null };
    save();
    anim = { kind: 'move' };
    view.update(G, api);
    await view.animateMove(G, t, { ...opt, from }, ev);
    if (tk !== token) return;
    anim = null;
    view.update(G, api);
    await view.announceMove(G, t, ev);
    if (tk !== token) return;
    return finishMove(tk);
  }

  /** 수의 뒷마무리: 잔치 칸 효과 → 완주 확인 → 다음 단계. 새로고침으로 이어할 때도 여기서 마무리한다 */
  async function finishMove(tk) {
    const m = G.moving;
    busy = true;
    if (m && m.eff) {
      await applyEffect(m.t, m.node, m.tile || TILES[m.node], m.eff, tk);
      if (tk !== token) return;
    }
    G.moving = null;
    busy = false;
    const t = m ? m.t : G.turn;
    if (G.teams[t].rank == null && G.teams[t].pieces.every(q => q.pos === DONE)) return teamFinished(t, tk);
    return afterMove(tk);
  }

  function afterMove(tk) {
    if (G.phase === 'event') return step(tk);
    if (G.pending > 0) { G.phase = 'throw'; G.bonus = true; }
    else if (G.results.length) G.phase = 'move';
    else return endTurn(tk);
    return step(tk);
  }

  function recordMove(t, ev, shortcut) {
    const st = G.stats[t];
    if (ev.caught.length) {
      st.caught += ev.caught.length;
      const victims = new Set(ev.caught.map(c => c[0]));
      victims.forEach(v => { G.stats[v].gotCaught++; });
      log(`${josa(G.teams[t].name, '이', '가')} ${[...victims].map(v => G.teams[v].name).join(', ')} 말을 잡았어요`, t);
    }
    if (ev.stacked) { st.stacks++; st.maxStack = Math.max(st.maxStack, ev.stackSize); log(`${josa(G.teams[t].name, '이', '가')} 말을 업었어요`, t); }
    if (shortcut) st.shortcuts++;
    if (ev.finished && ev.finished.length) {
      if (!G.stats.some(s => s.firstFinish)) st.firstFinish = true;
      log(`${G.teams[t].name} 말 ${ev.finished.length}개 완주`, t);
    }
  }

  /** 잔치 칸 효과를 상태에 적용하고 보여 준다(다른 칸 효과로 이어지지 않는다) */
  async function applyEffect(t, node, tile, eff, tk) {
    const tm = G.teams[t];
    const idx = groupAt(tm, node);
    await view.showEvent(G, t, tile, eff);
    if (tk !== token) return;
    if (G.moving) G.moving.eff = null; // 이후 저장본에는 '이미 적용함'으로 남는다(새로고침해도 두 번 적용되지 않게)
    if (eff.kind === 'extra') { G.pending++; save(); return; }
    let ev = null;
    if (eff.kind === 'forward' || eff.kind === 'back') {
      if (!idx.length) return;
      const trail = tm.pieces[idx[0]].trail;
      const move = computeMove(node, trail, eff.kind === 'back' ? BACKDO : eff.steps, G.rules);
      if (!move) return;
      ev = applyMove(G, t, { type: 'group', pos: node, idx, move });
      recordMove(t, ev, false);
      if (ev.caught.length) G.pending++;
      save();
      await view.animateMove(G, t, { type: 'group', pos: node, idx, move, from: node, event: true }, ev);
    } else if (eff.kind === 'teleport') {
      if (!idx.length) return;
      const trail = tm.pieces[idx[0]].trail.concat([node]);
      ev = placeGroup(G, t, idx, eff.to, trail);
      ev.dest = eff.to; ev.finished = [];
      recordMove(t, ev, false);
      if (ev.caught.length) G.pending++;
      save();
      await view.teleport(G, t, idx, eff.to, ev);
    } else if (eff.kind === 'friend') {
      const h = tm.pieces.findIndex(q => q.pos === HOME);
      if (h < 0) { G.pending++; save(); return; }
      const trail = idx.length ? tm.pieces[idx[0]].trail : [];
      ev = placeGroup(G, t, [h], node, trail);
      ev.dest = node; ev.finished = [];
      recordMove(t, ev, false);
      save();
      await view.animateMove(G, t, { type: 'new', pos: HOME, idx: [h], move: { path: [node], dest: node, trail }, from: HOME, event: true }, ev);
    } else if (eff.kind === 'home') {
      idx.forEach(i => { tm.pieces[i].pos = HOME; tm.pieces[i].trail = []; });
      save();
      await view.goHome(G, t, idx);
    }
    if (tk !== token) return;
    if (ev) await view.announceMove(G, t, ev);
  }

  async function runMission(tk) {
    const e = G.event;
    if (!e) { G.phase = 'move'; return afterMove(tk); }
    const t = e.t;
    busy = true;
    view.update(G, api);
    let done;
    if (G.teams[t].cpu) {
      await view.showMission(G, t, e.mission, { auto: true });
      done = true;
    } else {
      done = await new Promise(res => { missionWait = res; view.showMission(G, t, e.mission, { auto: false }); });
      missionWait = null;
      view.hideMission && view.hideMission();
    }
    if (tk !== token) return;
    G.event = null;
    G.phase = 'move';
    busy = false;
    if (done) {
      G.stats[t].missions++;
      log(`${G.teams[t].name}: 미션 성공!`, t);
      if (groupAt(G.teams[t], e.node).length) {
        // 답과 상(한 칸 앞으로)을 먼저 저장해 두면 새로고침해도 같은 카드가 다시 뜨지 않는다
        G.moving = { t, node: e.node, tile: { id: 'missionReward', icon: '👏', name: '미션 성공' }, eff: { kind: 'forward', steps: 1, label: '잘했어요! 한 칸 앞으로' } };
        save();
        return finishMove(tk);
      }
    }
    return afterMove(tk);
  }

  async function teamFinished(t, tk) {
    const tm = G.teams[t];
    tm.rank = G.ranks.length + 1;
    G.ranks.push(t);
    G.results = []; G.pending = 0;
    log(`${tm.name} ${tm.rank}등!`, t);
    const rest = G.teams.map((_, i) => i).filter(i => G.teams[i].rank == null);
    if (G.settings.endRule === 'first' || rest.length <= 1) {
      if (G.settings.endRule === 'all' && rest.length === 1) { const l = rest[0]; G.teams[l].rank = G.ranks.length + 1; G.ranks.push(l); }
      G.phase = 'over';
      G.winner = finalOrder(G)[0];
      save();
      view.update(G, api);
      await view.gameOver(G, computeAwards(G));
      return;
    }
    save();
    busy = true;
    await view.announce(G, 'teamDone', { t, rank: tm.rank });
    await sleep(900);
    if (tk !== token) return;
    busy = false;
    return endTurn(tk);
  }

  function nextTeam(t) {
    const n = G.teams.length;
    for (let k = 1; k <= n; k++) { const c = (t + k) % n; if (G.teams[c].rank == null) return c; }
    return t;
  }

  function endTurn(tk) {
    if (tk !== token || !G || G.phase === 'over') return;
    view.clearChoices();
    // 대역전상 계산용: 이번 차례가 끝난 시점의 꼴찌
    const alive = G.teams.map((_, i) => i).filter(i => G.teams[i].rank == null);
    if (alive.length > 1) {
      const prog = alive.map(i => progressOf(G, i)), min = Math.min(...prog);
      if (prog.filter(p => p === min).length === 1) G.stats[alive[prog.indexOf(min)]].lastTurns++;
    }
    G.turn = nextTeam(G.turn);
    G.turnSerial++;
    return beginTurn(tk);
  }

  /* ---------------- 바깥에서 부르는 동작 ---------------- */
  const api = {
    get state() { return G; },
    get busy() { return busy; },
    get anim() { return anim; },
    get paused() { return paused; },
    canUndo,
    undo,
    human,
    canThrow() { return !!(G && !busy && !paused && G.phase === 'throw' && human()); },
    throwNow(power = 0.6) {
      if (!api.canThrow() || G.settings.input !== 'screen') return false;
      doThrow(null, token, power);
      return true;
    },
    realInput(r) {
      if (!api.canThrow() || G.settings.input !== 'real') return false;
      if (r === BACKDO && !G.rules.backdo) return false;
      doThrow(r, token, 0);
      return true;
    },
    select(i) {
      if (!G || busy || G.phase !== 'move' || !human() || i < 0 || i >= G.results.length) return;
      if (!optionsFor(G, G.turn, G.results[i]).length) return;
      G.selected = i;
      noAuto = true;
      step(token);
    },
    /** 선택지 번호 k(0부터)로 두기 */
    choose(k) {
      if (!G || busy || paused || G.phase !== 'move' || !human()) return false;
      const opts = optionsFor(G, G.turn, G.results[G.selected]);
      const o = opts[k];
      if (!o) return false;
      doMove(G.selected, o, token, true);
      return true;
    },
    /** 판 위 말을 눌렀을 때: 그 말을 움직이는 선택지(없으면 -1) */
    choiceForPiece(t, i) {
      if (!G || G.phase !== 'move' || t !== G.turn) return -1;
      const pos = G.teams[t].pieces[i].pos;
      const opts = optionsFor(G, G.turn, G.results[G.selected]);
      if (pos === HOME) return opts.findIndex(o => o.type === 'new');
      return opts.findIndex(o => o.type === 'group' && o.pos === pos);
    },
    /** 도착 칸을 눌렀을 때: 그 칸으로 가는 선택지 목록 */
    choicesForDest(dest) {
      if (!G || G.phase !== 'move') return [];
      const opts = optionsFor(G, G.turn, G.results[G.selected]);
      return opts.map((o, k) => (o.move.dest === dest ? k : -1)).filter(k => k >= 0);
    },
    missionAnswer(done) { if (missionWait) missionWait(!!done); },
    pause(on) { paused = !!on; },
    /** 경기 중 바꿔도 되는 설정(사람/컴퓨터·컴퓨터 세기·자동 두기)을 지금 판에 반영 */
    applyLive(s) {
      if (!G || G.phase === 'over' || !s) return;
      let changed = false;
      if (G.settings.input !== 'real') G.teams.forEach((tm, i) => {
        const x = s.teams && s.teams[i];
        if (!x) return;
        if (tm.cpu !== !!x.cpu || tm.level !== (x.level || tm.level)) changed = true;
        tm.cpu = !!x.cpu; tm.level = x.level || tm.level;
      });
      G.settings.auto = !!s.auto;
      save();
      // 방금 컴퓨터가 된 팀은 바로 두고, 컴퓨터가 기다리던 차례는 사람에게 돌려준다
      if (changed && !busy && (G.phase === 'throw' || G.phase === 'move')) { token++; step(token); }
    },
    newGame(settings, seed) {
      token++;
      busy = false; hist = []; noAuto = false; anim = null;
      if (missionWait) { missionWait(false); missionWait = null; }
      G = newGameState(settings, seed);
      log(`${G.teams.length}팀 경기 시작`, -1);
      view.load(G, { fresh: true });
      return beginTurn(token);
    },
    resume(saved) {
      if (!validSave(saved)) return false;
      token++;
      busy = false; noAuto = true;
      if (missionWait) { missionWait(false); missionWait = null; }
      G = saved.G;
      anim = null;
      hist = Array.isArray(saved.hist) ? saved.hist : [];
      view.load(G, { resume: true });
      // 연출 도중에 저장된 판은 그 수의 뒷마무리부터 한다
      if (G.moving || (G.phase === 'move' && !G.results.length)) finishMove(token);
      else if (G.phase === 'throw' && G.pending <= 0) { if (G.results.length) { G.phase = 'move'; step(token); } else endTurn(token); }
      else step(token);
      return true;
    },
    /** 경기를 버리고 멈춤(설정 화면으로) */
    stop() { token++; busy = false; anim = null; if (missionWait) { missionWait(false); missionWait = null; } view.hideMission && view.hideMission(); },
    get history() { return hist; },
  };
  return api;
}

export function validSave(sv) {
  return !!(sv && sv.G && sv.G.v === SAVE_VERSION && Array.isArray(sv.G.teams) && sv.G.teams.length >= 2 && sv.G.settings && sv.G.phase !== 'over');
}
