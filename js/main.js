// 모두 연결: 3D 장면 + 말 + 윷 + 소리 + 화면 + 경기 진행.
import { createScene } from './scene.js';
import { createBoard } from './board.js';
import { createPieces } from './characters.js';
import { createYut } from './sticks.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';
import { createGame, validSave } from './game.js';
import { createUI, createSetup, sanitizeSettings, toGameSettings, josa, dotsFor, resultFace } from './ui.js';
import { RESULT_NAME, STEP_WORD, BACKDO, FIN, HOME, DONE, CORNER, optionsFor } from './rules.js';
import { TEAM_COLORS, RESULT_SPECIES, speciesById } from './theme.js';
import { TILES } from './party.js';
import { wait } from './anim.js';

export const VERSION = '1.0.0';
const $ = s => document.querySelector(s);

/* ---------- 저장소(같은 github.io 주소를 여러 프로젝트가 함께 쓰므로 접두사) ---------- */
const KEY = { save: 'yutnori3:save', settings: 'yutnori3:settings', prefs: 'yutnori3:prefs', today: 'yutnori3:today' };
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간이 없어도 게임은 계속 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
};

function fatal(msg) {
  const b = $('#boot');
  b.classList.remove('hide');
  b.innerHTML = `<p style="max-width:22em;text-align:center;line-height:1.5">${msg}</p><button class="go a" style="max-width:240px" onclick="location.reload()">다시 시도</button>`;
}

async function boot() {
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) { fatal('이 브라우저에서는 3D 윷판을 그릴 수 없어요. 최신 Chrome, Safari(iOS 16.4 이상), Edge에서 열어 주세요.'); return; }
  // 판 글자를 Jua로 굽기 위해 글꼴을 잠깐 기다린다(최대 1.5초)
  let fontsLate = false;
  try {
    await Promise.race([
      Promise.all([document.fonts.load('32px "Jua"', '윷놀이모도개걸'), document.fonts.load('16px "Gowun Dodum"', '가')]),
      new Promise(r => setTimeout(() => { fontsLate = true; r(); }, 1500)),
    ]);
  } catch (e) { fontsLate = true; }

  let prefs = { sfx: true, voice: true, music: false, ...(store.get(KEY.prefs) || {}) };
  let settings = sanitizeSettings(store.get(KEY.settings));

  /* ---------- 3D ---------- */
  const stage = $('#stage');
  const ctx = createScene(stage);
  const audio = createAudio();
  const voice = createVoice({ onSpeaking: on => audio.duck(on) });
  const sfx = (name, params) => (prefs.sfx ? audio.play(name, params) : undefined);
  const fx = createFx(ctx);
  const board = createBoard(ctx);
  const yut = createYut(ctx, { sfx, fx });
  const pieces = createPieces(ctx, { sfx, fx });
  if (fontsLate) document.fonts.ready.then(() => board.redrawText());

  let G = null;
  function applyLayout(side) {
    board.setLayout(side);
    const matBox = yut.layout(side);
    pieces.setLayout(side);
    ctx.setBoxes({ board: board.box(side), mat: matBox });
    ctx.setFlickZones(yut.flickTargets);
    if (G) pieces.sync(G, { force: false });
  }
  ctx.onLayout(side => applyLayout(side));
  applyLayout(ctx.matSide);
  ctx.start();

  /* 초상(동물 얼굴 그림) */
  const portrait = (species, color, face = 'happy') => {
    try { return pieces.portrait(species, color, face, 128); } catch (e) { return ''; }
  };

  const say = (text, prio = 'normal', o = {}) => { if (prefs.voice) voice.say(text, { prio, ...o }); };
  const buzz = name => { if (prefs.sfx) audio.buzz(name); };

  /* ---------- 화면 ---------- */
  // 창이 방금 닫힌 뒤 0.4초 동안의 입력은 무시한다(창을 닫은 두 번째 탭·엔터가 게임을 건드리지 않게)
  let modalClosedAt = -1e9, lastUndo = -1e9;
  const justClosed = () => performance.now() - modalClosedAt < 400;
  // 되돌리기를 두 번 빨리 눌러 두 수가 되돌아가지 않게
  const undoOnce = () => { const now = performance.now(); if (now - lastUndo < 450) return false; lastUndo = now; return game.undo(); };
  const ui = createUI({
    throw: power => { if (justClosed()) return; unlockAudio(); game.throwNow(power); },
    real: r => { if (justClosed()) return; unlockAudio(); game.realInput(r); },
    select: i => { if (justClosed()) return; sfx('tap'); game.select(i); },
    choose: k => { if (justClosed()) return; sfx('select'); game.choose(k); },
    undo: () => undoOnce(),
    missionAnswer: done => { ui.hideMission(); if (done) { sfx('clap'); fx.sparkle && fx.sparkle({ x: 0, y: 1, z: 0 }, { color: 0xE8B23A }); } game.missionAnswer(done); },
    again: () => { ui.hideResult(); startGame(); },
    toSetup: () => { ui.hideResult(); openSetup(); },
    resultUndo: () => { ui.hideResult(); undoOnce(); },
  });
  ui.setPortrait(portrait);

  /* 창이 열려 있으면 뒤 화면은 누르거나 초점을 받을 수 없게(inert), 닫히면 초점을 되돌린다 */
  let modalReturn = null;
  function syncModal() {
    const open = [...document.querySelectorAll('.modal')].some(m => !m.hidden);
    const app = $('#app');
    if (!open && app.inert) modalClosedAt = performance.now();   // 열려 있던 창이 닫힌 순간
    if (open && !app.inert) { const a = document.activeElement; modalReturn = app.contains(a) ? a : null; }
    app.inert = open;
    if (!open) {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('.modal')) {
        const back = modalReturn && modalReturn.isConnected && !modalReturn.hidden ? modalReturn
          : ($('#throwBtn:not([hidden])') || $('#realPad:not([hidden]) button') || $('#panel'));
        back && back.focus && back.focus({ preventScroll: true });
      }
      modalReturn = null;
    }
  }
  const modalObs = new MutationObserver(syncModal);
  document.querySelectorAll('.modal').forEach(m => modalObs.observe(m, { attributes: true, attributeFilter: ['hidden'] }));
  syncModal();   // 설정 창은 처음부터 열려 있으므로 뒤 화면을 바로 막는다

  const teamName = t => G.teams[t].name;
  const col = t => G.teams[t].color;

  /* ---------- 경기 화면 구현(view) ---------- */
  let lastTurnSpoken = -1, countedWin = null;
  const view = {
    load(G2, info) {
      // 시상식에서 되돌리면 오늘의 전적에서 그 승리를 뺀다
      if (info && info.undo && G && G.phase === 'over' && countedWin) unrecordToday(countedWin);
      countedWin = null;
      G = G2;
      pieces.setTeams(G.teams.map(t => ({ species: t.species, color: t.color, count: t.pieces.length })));
      board.setTeams(G.teams.map(t => ({ color: t.color })));
      board.setParty(G.party.on, G.party.spicy);
      board.refreshTiles(G);
      board.clearChoices();
      yut.setBackdoMark(G.rules.backdo);
      pieces.setSpeed(settings.speed === 'fast' ? 0.6 : 1);
      pieces.sync(G, { force: true });
      pieces.setTurn(G.turn);
      ui.buildHud(G);
      ui.buildPad(col(G.turn));
      ui.clearChoices();
      ui.hideMission();
      ui.hideResult();
      ctx.setFraming(G.phase === 'move' || G.settings.input === 'real' ? 'board' : 'throw', true);
      lastTurnSpoken = -1;
      if (info && info.resume) {
        ui.toast('저장된 경기를 이어서 해요');
        // 저장된 그 차례를 그대로 이어 갈 때만 말한다(연출 마무리·차례 넘김이면 turnStart가 알려 준다)
        const handsOff = G.phase === 'over' || G.moving || (G.phase === 'move' && !G.results.length) || (G.phase === 'throw' && G.pending <= 0 && !G.results.length);
        if (!handsOff) { lastTurnSpoken = G.turnSerial; sfx('turn'); say(`${teamName(G.turn)} 차례!`, 'normal'); }
      }
      keepAwake();
    },
    update(G2, api) {
      G = G2;
      // 잡기·까치·선물로 한 번 더 던질 때도 멍석이 보이게
      if (G.phase === 'throw' && G.settings.input !== 'real' && api && !api.busy && !api.anim && !G.teams[G.turn].cpu) ctx.setFraming('throw');
      ui.render(G, api);
      // 막판 긴장: 남은 팀이 모두 마지막 말 하나씩만 남으면 장단이 빨라진다
      const alive = G.teams.filter(tm => tm.rank == null);
      audio.setTension(G.phase !== 'over' && alive.length > 1 && alive.every(tm => tm.pieces.filter(q => q.pos !== DONE).length === 1));
      board.refreshTiles(G);
      describeBoard();
    },
    turnStart(G2, t) {
      G = G2;
      pieces.setTurn(t);
      pieces.cheer(t);
      ui.buildPad(col(t));
      ctx.setFraming(G.settings.input === 'real' ? 'board' : 'throw');
      sfx('turn');
      if (lastTurnSpoken !== G.turnSerial) { lastTurnSpoken = G.turnSerial; say(`${teamName(t)} 차례!`, 'normal', { wait: true }); }
    },
    async throwSticks(G2, t, roll, o) {
      if (o.gentle) { yut.rest(roll.flats, roll.out); return; }   // 진짜 윷: 카메라는 판에 두고 윷가락만 결과대로 놓는다
      ctx.setFraming('throw');
      pieces.lookAt(yut.matCenter());
      const dramatic = roll.r === 4 ? 'yut' : roll.r === 5 ? 'mo' : null;
      await yut.throw({ flats: roll.flats, out: roll.out, power: o.power, dramatic: o.gentle ? null : dramatic, gentle: !!o.gentle });
      pieces.lookAt(null);
    },
    async showResult(G2, t, r, o) {
      const c = col(t), mat = G.settings.input === 'real' ? { x: 0, z: 0 } : yut.matCenter();
      pieces.reactThrow(t, r);
      sfx('result', { r });
      if (r === 'nak') {
        ui.banner({ big: '낙!', sub: '이번 던지기는 없던 걸로 해요' });
        say(o.again ? '낙! 다시 던져요' : '낙!', 'normal');
        buzz('land');
        await wait(900);
        return;
      }
      const sp = speciesById(RESULT_SPECIES[r]);
      const big = r === 4 || r === 5;
      if (big) {
        buzz('yutmo');
        if (r === 5) fx.fireworks({ x: mat.x, y: 1.2, z: mat.z }, { colors: [TEAM_COLORS[c].hex, 0xE8B23A, 0xFFFFFF] });
        else fx.confetti({ x: mat.x, y: 0.8, z: mat.z }, { colors: [TEAM_COLORS[c].hex, 0xE8B23A, 0xFFFFFF], count: 80, duration: 1600 });
      }
      const sub = r === BACKDO ? '뒷걸음 돼지! 한 칸 뒤로' : `${sp.animal}, ${STEP_WORD[r]}${big ? ' · 한 번 더!' : ''}`;
      ui.banner({ big: RESULT_NAME[r] + '!', img: portrait(sp.id, c, resultFace(r)), back: r === BACKDO, dots: dotsFor(r), sub, gold: big });
      say(r === 4 ? '윷이다! 네 칸, 한 번 더!' : r === 5 ? '모다! 다섯 칸, 한 번 더!' : r === BACKDO ? '빽도! 한 칸 뒤로' : `${RESULT_NAME[r]}! ${STEP_WORD[r]}`, 'normal');
      await wait(big ? 900 : 650);
    },
    showChoices(G2, t, choices) {
      ctx.setFraming('board');
      board.showChoices(choices, col(t));
      pieces.setSelectable(choices.map(ch => ({ t, idx: ch.opt.idx, label: ch.label, kind: ch.opt.type })));
      const threat = [];
      choices.forEach(ch => {
        if (ch.dest === FIN) return;
        G.teams.forEach((o, ot) => {
          if (ot === t) return;
          const idx = [];
          o.pieces.forEach((q, j) => { if (q.pos === ch.dest) idx.push(j); });
          if (idx.length) threat.push({ t: ot, idx });
        });
      });
      pieces.setThreat(threat);
      ui.renderChoices(G, choices);
    },
    clearChoices() {
      board.clearChoices();
      pieces.clearSelectable();
      pieces.clearThreat();
      ui.clearChoices();
    },
    cpuThinking(G2, t, c) {
      if (!c || c.opt.move.dest === FIN) return;
      const threat = [];
      G.teams.forEach((o, ot) => {
        if (ot === t) return;
        const idx = [];
        o.pieces.forEach((q, j) => { if (q.pos === c.opt.move.dest) idx.push(j); });
        if (idx.length) threat.push({ t: ot, idx });
      });
      if (threat.length) pieces.setThreat(threat);
    },
    async animateMove(G2, t, opt, ev) {
      ctx.setFraming('board');
      pieces.clearThreat();
      await pieces.move(t, opt.idx, opt.move.path, {
        isNew: opt.type === 'new', back: !!opt.move.back, shortcut: !!opt.move.shortcut,
        stack: !!ev.stacked, caught: ev.caught || [], finish: ev.dest === FIN, teamCount: G.teams.length,
      });
      if (ev.caught && ev.caught.length) buzz('capture');
      else if (ev.stacked) buzz('stack');
      else if (ev.dest === FIN) buzz('finish');
      pieces.sync(G, { force: false });
    },
    async announceMove(G2, t, ev) {
      const c = col(t);
      if (ev.caught && ev.caught.length) {
        const victims = [...new Set(ev.caught.map(v => v[0]))].map(v => teamName(v)).join(', ');
        ui.banner({ big: '잡았다!', img: portrait(G.teams[t].species, c, 'happy'), sub: `${victims} 말을 잡았어요 · 한 번 더!`, gold: true });
        say(`잡았다! 한 번 더 던져요`, 'high');
        await wait(800);
      } else if (ev.stacked) {
        const n = ev.stackSize;
        const name = n >= 4 ? '넉동무니' : n === 3 ? '석동무니' : '두동무니';
        ui.banner({ big: '업었다!', img: portrait(G.teams[t].species, c, 'happy'), sub: `${name}! 함께 가요` });
        say(`업었다! ${name}`, 'normal', { wait: true });
        await wait(650);
      } else if (ev.finished && ev.finished.length) {
        ui.banner({ big: '완주!', img: portrait(G.teams[t].species, c, 'proud'), sub: `${ev.finished.length}개가 완주했어요` });
        say('완주!', 'normal', { wait: true });
        await wait(650);
      } else if (ev.dest === 5 || ev.dest === 10 || ev.dest === 22) {
        ui.toast(`${CORNER[ev.dest]}에 섰어요! 다음엔 지름길로 가요`);
      }
    },
    async announce(G2, kind, data) {
      if (kind === 'noMove') {
        ui.banner({ big: '쉬어 가요', sub: '움직일 수 있는 말이 없어요' });
        say('움직일 말이 없어요', 'normal');
        await wait(700);
      } else if (kind === 'teamDone') {
        const t = data.t;
        ui.banner({ big: `${data.rank}등!`, img: portrait(G.teams[t].species, col(t), 'proud'), sub: `${josa(teamName(t), '이', '가')} 다 들어왔어요`, gold: true, long: true });
        say(`${teamName(t)} ${data.rank}등!`, 'high');
        await wait(1200);
      }
    },
    async showEvent(G2, t, tile, eff) {
      const node = Object.keys(TILES).find(k => TILES[k] === tile);
      if (node != null) board.pulseTile(+node);
      sfx('event', { kind: tile.id });
      if (eff.kind === 'extra') buzz('stack');
      ui.banner({ big: `${tile.icon} ${tile.name}`, sub: eff.label || '' });
      say(eff.label ? `${tile.name}! ${eff.label}` : tile.name, 'normal', { wait: true });
      await wait(1000);
    },
    async teleport(G2, t, idx, to, ev) {
      await pieces.teleport(t, idx, to);
      const byTeam = new Map();
      (ev.caught || []).forEach(([ot, j]) => { if (!byTeam.has(ot)) byTeam.set(ot, []); byTeam.get(ot).push(j); });
      for (const [ot, js] of byTeam) await pieces.goHome(ot, js);
      pieces.sync(G, { force: false });
    },
    async goHome(G2, t, idx) {
      await pieces.goHome(t, idx);
      pieces.sync(G, { force: false });
    },
    hideMission() { ui.hideMission(); },
    async showMission(G2, t, mission, o) {
      sfx('event', { kind: 'mission' });
      if (G.event) board.pulseTile(G.event.node);
      ui.showMission(G, t, mission, o.auto);
      say(o.auto ? `컴퓨터 ${josa(teamName(t), '이', '가')} 미션을 해냈어요!` : `${teamName(t)} 미션! ${mission.text}`, 'normal');
      if (o.auto) {
        pieces.cheer(t);
        await wait(2400);
        ui.hideMission();
        sfx('clap');
        return;
      }
    },
    async gameOver(G2, awards) {
      const w = awards[0].t;
      ctx.setFraming('board');
      pieces.celebrate(w);
      fx.rain({ colors: [TEAM_COLORS[col(w)].hex, 0xE8B23A, 0xFFFFFF, 0xE14B2F, 0x2C5ED0], duration: 3500 });
      sfx('win');
      buzz('win');
      ui.banner({ big: '우승!', img: portrait(G.teams[w].species, col(w), 'proud'), sub: teamName(w), gold: true, long: true });
      say(`${teamName(w)} 우승! 축하해요!`, 'high');
      store.del(KEY.save);
      releaseWakeLock();
      const today = recordToday(teamName(w));
      await wait(2200);
      if (G !== G2) return;
      ui.showResult(G, awards, today, game.canUndo());
      // 글을 못 읽는 아이도 자기 팀 상을 들을 수 있게 읽어 준다
      say(awards.map(a => `${josa(teamName(a.t), '은', '는')} ${a.award.name}`).join('! ') + '!', 'normal', { wait: true });
    },
    toast(text) { ui.toast(text); },
  };

  /* 스크린리더용 판 상태 */
  function describeBoard() {
    if (!G) return;
    const parts = G.teams.map(tm => {
      const on = tm.pieces.filter(q => q.pos >= 0 && q.pos !== DONE).length;
      const home = tm.pieces.filter(q => q.pos === HOME).length;
      const done = tm.pieces.filter(q => q.pos === DONE).length;
      return `${tm.name}: 판 위 ${on}, 대기 ${home}, 완주 ${done}`;
    });
    const txt = parts.join('. '), bt = $('#boardText');
    if (bt.textContent !== txt) bt.textContent = txt;
  }

  /* ---------- 경기 ---------- */
  const game = createGame({
    view,
    store: { save: (G2, hist) => { if (G2.phase === 'over') store.del(KEY.save); else store.set(KEY.save, { G: G2, hist }); } },
  });

  function recordToday(winner) {
    const d = new Date(), date = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let rec = store.get(KEY.today);
    if (!rec || rec.date !== date) rec = { date, wins: {} };
    rec.wins[winner] = (rec.wins[winner] || 0) + 1;
    store.set(KEY.today, rec);
    countedWin = winner;
    const total = Object.values(rec.wins).reduce((a, b) => a + b, 0);
    return `오늘 ${total}판: ` + Object.entries(rec.wins).sort((a, b) => b[1] - a[1]).map(([n, w]) => `${n} ${w}승`).join(' · ');
  }

  function unrecordToday(winner) {
    const d = new Date(), date = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const rec = store.get(KEY.today);
    if (rec && rec.date === date && rec.wins[winner] > 0) {
      if (--rec.wins[winner] === 0) delete rec.wins[winner];
      store.set(KEY.today, rec);
    }
  }

  /* 터치: 말·도착 칸 고르기, 멍석 쓸어 던지기 */
  ctx.onPick(data => {
    if (!data || !G || G.phase !== 'move' || game.busy || !game.human() || justClosed()) return;
    if (data.kind === 'dest') {
      if (data.ks.length === 1) { sfx('select'); game.choose(data.ks[0]); }
      else { ui.flashChoices(data.ks); ui.toast('어느 말을 움직일까요? 번호를 눌러요'); }
    } else if (data.kind === 'piece') {
      const k = game.choiceForPiece(data.t, data.i);
      if (k >= 0) { sfx('select'); pieces.press(data.t, data.i); game.choose(k); }
      else if (data.t === G.turn) ui.toast('이 말은 이번 결과로 움직일 수 없어요');
    }
  });
  ctx.onFlick(power => { if (justClosed()) return; unlockAudio(); game.throwNow(power); }, () => game.canThrow() && G && G.settings.input === 'screen');

  /* ---------- 설정 화면 ---------- */
  const setup = createSetup({
    getSettings: () => settings,
    setSettings: (s, rerender) => { settings = s; store.set(KEY.settings, settings); if (rerender) setup.render(setupInfo()); },
    getPrefs: () => prefs,
    setPrefs: p => { const was = prefs.sfx; prefs = p; store.set(KEY.prefs, prefs); unlockAudio(); applyPrefs(); if (p.sfx && !was) sfx('tap'); },
    portrait,
    onStart: () => { unlockAudio(); startGame(); },
    onResume: () => {
      unlockAudio();
      if (G && G.phase !== 'over') { closeSetup(); return; }
      const sv = store.get(KEY.save);
      closeSetup();
      if (!game.resume(sv)) { store.del(KEY.save); openSetup(); }
    },
    voiceAvailable: () => voiceOk,
  });
  setup.handlers.cry = species => { unlockAudio(); sfx('cry', { species }); };
  setup.buildAnimalCards((text, species) => { unlockAudio(); sfx('cry', { species }); if (prefs.voice) voice.say(text, { prio: 'high' }); });

  let voiceOk = null;
  voice.ready.then(() => { voiceOk = voice.available; if (!$('#setup').hidden) setup.render(setupInfo()); });

  function setupInfo() {
    const inGame = !!(G && G.phase !== 'over');
    return { inGame, canResume: inGame || validSave(store.get(KEY.save)) };
  }
  function openSetup() {
    if (!$('#mission').hidden) return;
    game.pause(true);
    setup.render(setupInfo());
    $('#setup').hidden = false;
    setTimeout(() => { $('#setup .sheet').scrollTop = 0; const b = $('#setupClose:not([hidden])') || $('#resumeBtn:not([hidden])') || $('#startBtn'); b && b.focus({ preventScroll: true }); }, 50);
  }
  /** 설정 창 닫기. 경기로 돌아가면 바로 바꿀 수 있는 설정(사람/컴퓨터, 컴퓨터 세기, 자동 두기, 말 빠르기)을 반영한다 */
  function closeSetup(apply = true) {
    $('#setup').hidden = true;
    if (apply && G && G.phase !== 'over') { pieces.setSpeed(settings.speed === 'fast' ? 0.6 : 1); game.applyLive(toGameSettings(settings)); }
    game.pause(false);
  }
  function startGame() {
    store.set(KEY.settings, settings);
    closeSetup(false);
    const seed = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 31)) | 0;
    game.newGame(toGameSettings(settings), seed);
  }
  $('#setup').addEventListener('click', e => { if (e.target === e.currentTarget && G && G.phase !== 'over') closeSetup(); });
  $('#setupClose').addEventListener('click', () => { if (G && G.phase !== 'over') closeSetup(); });

  /* ---------- 소리 ---------- */
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audio.unlock();
    voice.unlock();
    applyPrefs();
  }
  function applyPrefs() {
    audio.setEnabled({ sfx: prefs.sfx, music: prefs.music });
    if (audioUnlocked) audio.music(!!prefs.music);
    voice.setEnabled(!!prefs.voice);
    updateSoundIcon();
  }
  const ICON_ON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>';
  function updateSoundIcon() {
    const on = prefs.sfx || prefs.voice || prefs.music;
    const b = $('#soundBtn');
    b.innerHTML = on ? ICON_ON : ICON_OFF;
    b.setAttribute('aria-label', on ? '소리 끄기' : '소리 켜기');
  }
  $('#soundBtn').addEventListener('click', () => {
    unlockAudio();
    const on = prefs.sfx || prefs.voice || prefs.music;
    prefs = on ? { ...prefs, sfx: false, voice: false, music: false, _last: { sfx: prefs.sfx, voice: prefs.voice, music: prefs.music } }
      : { ...prefs, ...(prefs._last || { sfx: true, voice: true, music: false }) };
    store.set(KEY.prefs, prefs);
    applyPrefs();
    if (!on) sfx('tap');
    if (on) voice.cancel();
    ui.toast(on ? '소리를 껐어요' : '소리를 켰어요');
  });
  $('#viewBtn').addEventListener('click', () => { ctx.resetView(); if (G && G.phase !== 'over') closeSetup(); });
  $('#menuBtn').addEventListener('click', () => openSetup());
  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  $('#fsBtn').hidden = !fsOk;
  $('#fsBtn').addEventListener('click', () => {
    try {
      const d = document, el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else { const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* 무시 */ }
  });
  // 전체 화면이면 버튼 글자를 '끝내기'로
  const fsBtn = $('#fsBtn');
  const fsTxt = [...fsBtn.childNodes].reverse().find(n => n.nodeType === 3 && n.nodeValue.trim());
  const updFs = () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (fsTxt) fsTxt.nodeValue = on ? ' 전체 화면 끝내기' : ' 전체 화면';
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  document.addEventListener('fullscreenchange', updFs);
  document.addEventListener('webkitfullscreenchange', updFs);
  updFs();


  /* ---------- 키보드 ---------- */
  document.addEventListener('keydown', e => {
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    ctx.poke(); keepAwake();
    if (e.key === 'Escape') { if (!$('#setup').hidden && G && G.phase !== 'over') closeSetup(); return; }
    if (!G || !$('#setup').hidden || !$('#result').hidden) return;
    if (!$('#mission').hidden) return;
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (!e.repeat) undoOnce(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'u' || k === 'backspace') { e.preventDefault(); if (!e.repeat) undoOnce(); return; }
    if (G.phase === 'throw') {
      if (e.repeat || justClosed()) { if (k === ' ' || k === 'enter') e.preventDefault(); return; }
      if (G.settings.input === 'real') {
        const map = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 0: BACKDO, b: BACKDO, '-': BACKDO, n: 'nak' };
        if (k in map) { e.preventDefault(); unlockAudio(); game.realInput(map[k]); }
      } else if (k === ' ' || k === 'enter') {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON' && document.activeElement.id !== 'throwBtn') return;
        e.preventDefault(); unlockAudio(); game.throwNow(0.6);
      }
    } else if (G.phase === 'move') {
      if (/^[1-9]$/.test(k)) { e.preventDefault(); if (e.repeat || justClosed()) return; game.choose(+k - 1); }
      else if (k === 'arrowleft' || k === 'arrowright') {
        const n = G.results.length;
        if (n < 2) return;
        const dir = k === 'arrowright' ? 1 : -1;
        for (let s = 1; s < n; s++) {
          const j = ((G.selected + dir * s) % n + n) % n;
          if (optionsFor(G, G.turn, G.results[j]).length) { e.preventDefault(); game.select(j); break; }
        }
      }
    }
  });
  document.addEventListener('pointerdown', () => { ctx.poke(); keepAwake(); }, { passive: true });

  /* ---------- 화면 꺼짐 방지 ---------- */
  // 누군가 놀고 있을 때만 화면을 켜 둔다: 탭·키마다 5분 타이머를 다시 건다(컴퓨터끼리 시연은 끝날 때까지)
  let wakeLock = null, wlPending = false, wlIdle = 0;
  const WL_IDLE_MS = 5 * 60 * 1000;
  function releaseWakeLock() { clearTimeout(wlIdle); const s = wakeLock; wakeLock = null; if (s) s.release().catch(() => {}); }
  async function requestWakeLock() {
    if (wakeLock || wlPending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wlPending = true;
    try { const s = await navigator.wakeLock.request('screen'); s.addEventListener('release', () => { if (wakeLock === s) wakeLock = null; }); wakeLock = s; } catch (e) { /* 무시 */ } finally { wlPending = false; }
  }
  function keepAwake() {
    if (!G || G.phase === 'over') return;
    requestWakeLock();
    clearTimeout(wlIdle);
    if (!G.teams.every(t => t.cpu)) wlIdle = setTimeout(releaseWakeLock, WL_IDLE_MS);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
    if (document.visibilityState === 'hidden') voice.cancel();
  });

  /* ---------- 느린 기기면 화질 낮추기(3초 평균 한 프레임 24ms 넘으면) ---------- */
  // 평소(한가할 때) 프레임 간격을 기준으로 삼아, 30fps로 묶인 기기를 느리다고 잘못 보지 않는다. 저장하지 않는다.
  let qLevel = 'high', fSum = 0, fN = 0, base = 1 / 60;
  ctx.addTicker(dt => {
    if (document.hidden || dt <= 0) return false;
    if (!game.busy) { base = Math.min(0.05, base * 0.98 + Math.min(dt, 0.05) * 0.02); return false; }
    fSum += dt; fN++;
    if (fSum >= 3) {
      const avg = fSum / fN;
      fSum = 0; fN = 0;
      if (avg > Math.max(0.024, base * 1.5) && qLevel !== 'min') {
        qLevel = qLevel === 'high' ? 'low' : 'min';
        pieces.setQuality(qLevel);
      }
    }
    return false;
  });
  // 설정 화면에 쓰는 동물 얼굴을 한가할 때 미리 그려 둔다
  if (pieces.prewarmPortraits) {
    const list = [];
    for (let c = 0; c < 4; c++) ['horse', 'tiger', 'rabbit', 'pig', 'dog', 'sheep', 'cow', 'rooster'].forEach(sp => list.push([sp, c, 'happy', 128]));
    pieces.prewarmPortraits(list);
  }

  /* ---------- 시작 ---------- */
  $('#ver').textContent = VERSION;
  { // 소스 코드 링크: github.io 주소에서 저장소 주소를 알아낸다
    const m = location.hostname.match(/^([^.]+)\.github\.io$/), repo = location.pathname.split('/')[1];
    const a = $('#repoLink');
    if (m && repo) a.href = `https://github.com/${m[1]}/${repo}`;
  }
  updateSoundIcon();
  applyPrefs();
  const boot = $('#boot');
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600);
  // ?autoplay=4 : 컴퓨터끼리 바로 한 판(시연·점검용)
  const auto = new URLSearchParams(location.search).get('autoplay');
  if (auto) {
    const n = Math.min(4, Math.max(2, +auto || 4));
    const demo = sanitizeSettings({ ...settings, teamCount: n, teams: settings.teams.map(t => ({ ...t, cpu: true, level: 'normal' })) });
    const seed = +(new URLSearchParams(location.search).get('seed')) || 20260924;
    closeSetup();
    game.newGame(toGameSettings(demo), seed);
  } else openSetup();
  window.__yut ={ game, ctx, pieces, board, yut, fx, audio, voice, get G() { return G; } };
  document.documentElement.dataset.ready = '1';
}

/* 오프라인 설치(서비스워커): 배포 주소에서만. 로컬에서는 ?sw=1일 때만 */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  if (local && !/[?&]sw=1/.test(location.search)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const t = document.getElementById('toast');
          if (t) { t.textContent = '새 버전이 나왔어요! 경기 뒤 새로 고침해요'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); }
        }
      });
    });
  }).catch(() => {});
}

boot().catch(err => { console.error(err); fatal('윷판을 펴다가 문제가 생겼어요. 새로 고침해 주세요.'); });
registerSW();
