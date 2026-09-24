// DOM 화면: 차례 바, 팀 현황, 결과 토큰, 선택지 줄, 진짜 윷 입력, 배너, 알림, 미션 카드, 시상식, 설정.
import { TEAM_COLORS, SPECIES, speciesById, RESULT_SPECIES } from './theme.js';
import { RESULT_NAME, STEP_WORD, BACKDO, HOME, DONE, FIN, CORNER, optionsFor, josa } from './rules.js';
import { TILES } from './party.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { josa };

/** 팀 모양 SVG (채움/테두리/완주) */
export function shapeSVG(shape, mode, color, size = 14) {
  const fill = mode === 'fill' ? color : mode === 'done' ? 'var(--gold)' : 'none';
  const stroke = mode === 'ring' ? color : mode === 'done' ? '#8E6A00' : 'none';
  const sw = mode === 'fill' ? 0 : 2.2;
  const star = (() => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3.7 : 8.6; p.push((10 + r * Math.cos(a)).toFixed(1) + ',' + (10.7 + r * Math.sin(a)).toFixed(1)); } return p.join(' '); })();
  const el = shape === 'circle' ? '<circle cx="10" cy="10" r="7.6"/>'
    : shape === 'square' ? '<rect x="3" y="3" width="14" height="14" rx="2.4"/>'
      : shape === 'triangle' ? '<path d="M10 2.6 L17.8 16.8 H2.2 Z"/>' : `<polygon points="${star}"/>`;
  return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" style="fill:${fill};stroke:${stroke};stroke-width:${sw};stroke-linejoin:round" aria-hidden="true">${el}</svg>`;
}

export const dotsFor = r => r === BACKDO ? '◀' : '●'.repeat(r) + '○'.repeat(5 - r);
/** 결과 동물 그림(빽도는 뒤돌아 선 돼지 + 빨간 화살표) */
export const resultFace = r => (r === BACKDO ? 'surprised' : 'happy');
const resultImg = (r, color, portrait) => `<span class="rimg${r === BACKDO ? ' back' : ''}"><img alt="" src="${portrait(RESULT_SPECIES[r], color, resultFace(r))}"></span>`;

/** 도착 칸 이름(아이도 알 수 있게) */
export function destName(dest) {
  if (dest === FIN) return '완주!';
  if (dest in CORNER) return dest === 0 ? '출발(참먹이)' : CORNER[dest];
  return null;
}

export function createUI(h) {
  let portrait = () => '';
  let lastTurnKey = '';
  const hud = { face: $('#turnFace'), name: $('#turnName'), sub: $('#turnSub'), bar: $('#turnBar') };

  /* ---------- 차례 바와 팀 현황 ---------- */
  function buildHud(G) {
    const box = $('#teams');
    box.innerHTML = '';
    box.className = 'n' + G.teams.length;
    G.teams.forEach((tm, i) => {
      const col = TEAM_COLORS[tm.color];
      const d = document.createElement('div');
      d.className = 'tcard'; d.id = 'tc' + i;
      d.style.setProperty('--tc', `var(--t${tm.color})`);
      d.innerHTML = `<img alt="" src="${portrait(tm.species, tm.color, 'idle')}"><div class="tinfo"><span class="tname">${esc(tm.name)}</span><span class="pips"></span></div><span class="rank"></span>`;
      d.title = `${tm.name} (${col.name})`;
      box.appendChild(d);
    });
    lastTurnKey = '';
  }

  function teamPips(tm) {
    const col = TEAM_COLORS[tm.color];
    return tm.pieces.map(q => `<span class="pip">${shapeSVG(col.shape, q.pos === DONE ? 'done' : q.pos === HOME ? 'fill' : 'ring', `var(--t${tm.color})`, 12)}</span>`).join('');
  }

  function render(G, api, note) {
    if (!G) return;
    const t = G.turn, tm = G.teams[t], over = G.phase === 'over', human = !tm.cpu, real = G.settings.input === 'real';
    // 윷가락이 날아가는 동안에는 결과를 미리 보여 주지 않는다
    const a = api.anim, flying = !!(a && a.kind === 'throw'), ph = flying ? 'throw' : G.phase;
    const results = flying ? G.results.slice(0, a.shown) : G.results;
    const again = results.length > 0 || !!G.bonus;          // 윷·모·잡기·잔치 칸으로 한 번 더 던지는 중
    const going = !!((a && a.kind === 'move') || G.moving);  // 말이 가는 중(잡기·업기 배너, 잔치 칸 효과까지)
    const root = document.documentElement.style;
    root.setProperty('--cur', `var(--t${tm.color})`);
    root.setProperty('--curInk', TEAM_COLORS[tm.color].ink);
    const key = `${t}|${G.turnSerial}|${over}`;
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      hud.face.src = portrait(tm.species, tm.color, over ? 'proud' : 'happy');
      hud.bar.classList.remove('pop'); void hud.bar.offsetWidth; hud.bar.classList.add('pop');
    }
    if (over) {
      const w = G.teams[G.winner != null ? G.winner : t];
      hud.face.src = portrait(w.species, w.color, 'proud');
      hud.name.innerHTML = `<span class="nm">${esc(w.name)}</span><span class="sf">&nbsp;우승!</span>`;
      hud.sub.textContent = '축하해요!';
      root.setProperty('--cur', `var(--t${w.color})`);
      root.setProperty('--curInk', TEAM_COLORS[w.color].ink);
    } else {
      hud.name.innerHTML = `<span class="nm">${esc(tm.name)}</span><span class="sf">&nbsp;차례</span>`;
      hud.sub.textContent = tm.cpu ? '컴퓨터가 하고 있어요' : flying ? '윷이 날아가요…' : (ph === 'throw' ? (again ? '한 번 더 던져요!' : '윷을 던져요') : ph === 'event' ? '미션!' : going ? '콩콩 가는 중…' : '말을 골라요');
    }
    G.teams.forEach((x, i) => {
      const c = document.getElementById('tc' + i);
      if (!c) return;
      c.classList.toggle('active', i === t && !over);
      c.classList.toggle('done', x.rank != null);
      c.querySelector('.rank').textContent = x.rank ? x.rank + '등' : '';
      if (!(a && a.kind === 'move')) c.querySelector('.pips').innerHTML = teamPips(x);
    });
    const canAct = human && !api.busy && !over && !api.paused;
    // 결과 토큰
    const panel = $('#panel');
    const hadFocus = panel.contains(document.activeElement) || document.activeElement === document.body;
    const tokens = $('#tokens');
    tokens.innerHTML = '';
    results.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'token' + (r === BACKDO ? ' back' : '');
      const usable = G.phase === 'move' && optionsFor(G, t, r).length > 0;
      if (G.phase === 'move' && i === G.selected) b.classList.add('sel');
      if (G.phase === 'move' && !usable) b.classList.add('dead');
      b.disabled = !(canAct && usable && G.phase === 'move');
      b.innerHTML = `${resultImg(r, tm.color, portrait)}<b>${RESULT_NAME[r]}</b><span class="dots">${dotsFor(r)}</span>`;
      b.setAttribute('aria-label', `${RESULT_NAME[r]}, ${STEP_WORD[r]}`);
      b.setAttribute('aria-pressed', String(G.phase === 'move' && i === G.selected));
      b.addEventListener('click', () => h.select(i));
      tokens.appendChild(b);
    });
    // 진짜 윷 패드
    const pad = $('#realPad');
    pad.hidden = !(real && human && !over && ph === 'throw');
    pad.querySelectorAll('button').forEach(b => { b.setAttribute('aria-disabled', String(!canAct || G.phase !== 'throw' || (b.dataset.r === '-1' && !G.rules.backdo))); });
    // 던지기 버튼
    const tb = $('#throwBtn');
    // 사람이 말을 고르는 동안에는 던지기 버튼을 숨겨 선택지 자리를 넓힌다
    tb.hidden = (real && human) || (human && !over && ph === 'move');
    const tbOn = canAct && G.phase === 'throw' && !real;
    tb.setAttribute('aria-disabled', String(!tbOn));
    tb.querySelector('.tlabel').textContent = over ? '경기 끝' : !human ? '컴퓨터 차례' : flying ? '윷이 날아가요…' : ph === 'throw' ? (again ? '한 번 더 던지기!' : '윷 던지기!') : '말을 골라요';
    tb.classList.toggle('nudge', tbOn);
    $('.actions').classList.toggle('solo', tb.hidden);
    panel.classList.toggle('moving', ph === 'move' && human && !over);
    $('#undoBtn').disabled = !api.canUndo();
    // 안내
    let m = note || '';
    if (!m) {
      if (over) m = '경기가 끝났어요';
      else if (!human) m = `${josa(tm.name, '이', '가')} ${ph === 'throw' ? '윷을 던져요' : '생각하고 있어요'}…`;
      else if (flying) m = '윷이 날아가요…';
      else if (ph === 'throw') m = real ? (again ? '한 번 더 던지고, 나온 결과를 눌러요' : `${tm.name} 차례! 진짜 윷을 던지고, 나온 결과를 눌러요`) : (again ? '한 번 더! 윷을 던져요' : `${tm.name} 차례! 윷을 던져요`);
      else if (ph === 'event') m = '미션을 해 볼까요?';
      else if (going) m = '콩콩 가는 중…';
      else if (api.busy && results.every(r => !optionsFor(G, t, r).length)) m = '움직일 말이 없어요';
      else m = results.length > 1 ? '쓸 결과를 고르고, 움직일 말을 눌러요' : '움직일 말이나 번호를 눌러요';
    }
    const me = $('#msg');
    if (me.textContent !== m) me.textContent = m;
    if (hadFocus) keepFocus(G);
    if (!a) renderLog(G);
  }

  /** 다시 그린 뒤 포커스가 사라졌으면 다음에 누를 곳으로 옮긴다 */
  function keepFocus(G) {
    const act = document.activeElement;
    if (act && act !== document.body && act !== $('#panel') && act.isConnected) return;
    if (!$('#setup').hidden || !$('#result').hidden || !$('#mission').hidden) return;
    const tm = G.teams[G.turn];
    const target = (G.phase === 'move' && ($('#choices .choice') || $$('#tokens .token')[G.selected]))
      || (G.phase === 'throw' && !tm.cpu && ($('#throwBtn:not([hidden])') || $('#realPad:not([hidden]) button')))
      || $('#panel');
    target.focus({ preventScroll: true });
  }

  function renderLog(G) {
    const el = $('#log');
    el.innerHTML = G.log.slice(-18).reverse().map(l => `<li><i style="background:${l.t >= 0 ? `var(--t${G.teams[l.t].color})` : 'var(--muted)'}"></i>${esc(l.text)}</li>`).join('');
  }

  /* ---------- 선택지 줄 ---------- */
  function renderChoices(G, choices) {
    const box = $('#choices');
    box.innerHTML = '';
    const tm = G.teams[G.turn];
    choices.forEach(ch => {
      const o = ch.opt;
      const b = document.createElement('button');
      b.className = 'choice';
      b.dataset.k = ch.k;
      const who = o.type === 'new' ? '새 말' : o.idx.length > 1 ? `업은 말 ${o.idx.length}개` : '';
      const where = destName(ch.dest) || (o.move.back ? '한 칸 뒤로' : `${o.move.path.length}칸`);
      const said = ch.tags.map(tg => tg === 'catch' ? '잡기' : tg === 'stack' ? '업기' : tg === 'shortcut' ? '지름길' : tg.startsWith('tile:') ? (Object.values(TILES).find(x => x.id === tg.slice(5)) || {}).name : '').filter(Boolean);
      const tags = ch.tags.filter(tg => !(tg === 'finish' && ch.dest === FIN)).map(tg => {
        if (tg === 'catch') return '<span class="tag hot">잡기!</span>';
        if (tg === 'stack') return '<span class="tag good">업기</span>';
        if (tg === 'finish') return '<span class="tag good">완주</span>';
        if (tg === 'shortcut') return '<span class="tag">지름길</span>';
        if (tg.startsWith('tile:')) { const t = Object.values(TILES).find(x => x.id === tg.slice(5)); return t ? `<span class="tag">${t.icon}</span>` : ''; }
        return '';
      }).join('');
      b.innerHTML = `<span class="num">${ch.label}</span><span class="what"><span>${who ? esc(who) + ' → ' : ''}${esc(where)}</span>${tags}</span>`;
      b.setAttribute('aria-label', `${ch.label}번: ${who || '말'}, ${where}${said.length ? ', ' + said.join(', ') : ''}`);
      b.addEventListener('click', () => h.choose(ch.k));
      box.appendChild(b);
    });
    box.style.setProperty('--cur', `var(--t${tm.color})`);
  }
  function clearChoices() { $('#choices').innerHTML = ''; }
  function flashChoices(ks) {
    let first = null;
    $$('#choices .choice').forEach(b => { b.classList.remove('flash'); if (ks.includes(+b.dataset.k)) { void b.offsetWidth; b.classList.add('flash'); first = first || b; } });
    if (first) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ---------- 진짜 윷 패드 ---------- */
  function buildPad(colorIdx) {
    const pad = $('#realPad');
    pad.innerHTML = '';
    [BACKDO, 1, 2, 3, 4, 5].forEach(r => {
      const b = document.createElement('button');
      b.dataset.r = r;
      b.innerHTML = `${resultImg(r, colorIdx, portrait)}<b>${RESULT_NAME[r]}</b>`;
      b.setAttribute('aria-label', `${RESULT_NAME[r]} (${STEP_WORD[r]})`);
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') h.real(r); });
      pad.appendChild(b);
    });
    const nak = document.createElement('button');
    nak.className = 'nak'; nak.dataset.r = 'nak';
    nak.innerHTML = '<b>낙</b><span>윷이 멍석 밖으로 나갔어요</span>';
    nak.addEventListener('click', () => { if (nak.getAttribute('aria-disabled') !== 'true') h.real('nak'); });
    pad.appendChild(nak);
  }

  /* ---------- 배너와 알림 (하나씩 차례로) ---------- */
  let bannerChain = Promise.resolve();
  function banner(o) {
    const dur = o.long ? 2100 : 1500;
    const show = () => new Promise(res => {
      const el = $('#banner');
      const div = document.createElement('div');
      div.className = 'bn' + (o.gold ? ' gold' : '') + (o.long ? ' long' : '');
      div.innerHTML = (o.img ? `<img alt=""${o.back ? ' class="back"' : ''} src="${o.img}">` : '') + `<div class="big">${esc(o.big)}</div>`
        + (o.dots ? `<div class="dots">${esc(o.dots)}</div>` : '') + (o.sub ? `<div class="sub">${esc(o.sub)}</div>` : '');
      el.innerHTML = '';
      el.appendChild(div);
      const n = $('#srNews');
      n.textContent = '';
      n.textContent = [o.big, o.sub].filter(Boolean).join(' ');
      setTimeout(res, Math.min(dur, o.hold || dur * 0.6));
      setTimeout(() => { if (div.parentNode) div.remove(); }, dur + 50);
    });
    bannerChain = bannerChain.then(show);
    return bannerChain;
  }
  let toastTimer = 0;
  function toast(text, ms = 1800) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ---------- 미션 카드 ---------- */
  let missionTimer = 0;
  function showMission(G, t, mission, auto) {
    const tm = G.teams[t];
    $('#mTeam').innerHTML = auto ? `컴퓨터 ${esc(tm.name)}의 미션!<br><small>컴퓨터 친구가 해 볼게요 👀</small>` : `${esc(tm.name)}의 가족 미션!`;
    $('#mIcon').textContent = mission.icon;
    $('#mText').textContent = mission.text;
    const timer = $('#mTimer');
    clearInterval(missionTimer);
    timer.hidden = !mission.timer || auto;
    $('#mDone').hidden = auto; $('#mSkip').hidden = auto;
    $('#mission').hidden = false;
    if (mission.timer && !auto) {
      let left = mission.timer * 10;
      const tick = () => {
        timer.style.setProperty('--p', `${left / (mission.timer * 10) * 100}%`);
        timer.innerHTML = `<span>${Math.ceil(left / 10)}</span>`;
        if (left-- <= 0) { clearInterval(missionTimer); timer.innerHTML = '<span>끝!</span>'; }
      };
      tick();
      missionTimer = setInterval(tick, 100);
    }
    $('#mission .sheet').scrollTop = 0;
    if (!auto) setTimeout(() => $('#mDone').focus({ preventScroll: true }), 50);
  }
  function hideMission() { clearInterval(missionTimer); $('#mission').hidden = true; }
  $('#mDone').addEventListener('click', () => h.missionAnswer(true));
  $('#mSkip').addEventListener('click', () => h.missionAnswer(false));

  /* ---------- 시상식 ---------- */
  function showResult(G, awards, today, canUndo) {
    const w = G.teams[awards[0].t];
    $('#rTitle').textContent = `${josa(w.name, '이', '가')} 이겼어요!`;
    $('#rList').innerHTML = awards.map(a => {
      const tm = G.teams[a.t];
      return `<li class="${a.place === 1 ? 'first' : ''}" style="--tc:var(--t${tm.color})"><span class="place">${a.place === 1 ? '🏆' : a.place + '등'}</span>`
        + `<img alt="" src="${portrait(tm.species, tm.color, a.place === 1 ? 'proud' : 'happy')}">`
        + `<div><div class="who">${esc(tm.name)}</div><div class="aw">${a.award.icon} <b>${esc(a.award.name)}</b> · ${esc(a.award.desc)}</div></div></li>`;
    }).join('');
    $('#today').textContent = today || '';
    $('#rUndo').hidden = !canUndo;
    $('#result').hidden = false;
    $('#result .sheet').scrollTop = 0;
    setTimeout(() => $('#againBtn').focus({ preventScroll: true }), 50);
  }
  function hideResult() { $('#result').hidden = true; }

  /* ---------- 버튼 연결 ---------- */
  // 던지기: 짧게 누르면 바로, 꾹 누르면 힘을 모았다가 손을 떼면 던진다
  const tb = $('#throwBtn'), charge = tb.querySelector('.charge');
  let hold = null;
  const tbOff = () => tb.getAttribute('aria-disabled') === 'true';
  let ptrThrowAt = 0;
  tb.addEventListener('pointerdown', e => {
    if (tbOff()) return;
    hold = { t0: performance.now(), raf: 0 };
    const loop = () => {
      if (!hold) return;
      const k = ((performance.now() - hold.t0) % 1200) / 1200, p = k < 0.5 ? k * 2 : 2 - k * 2;
      hold.p = p;
      charge.style.transform = `scaleX(${p})`;
      hold.raf = requestAnimationFrame(loop);
    };
    hold.raf = requestAnimationFrame(loop);
  });
  const release = fire => {
    if (!hold) return;
    cancelAnimationFrame(hold.raf);
    const held = performance.now() - hold.t0, p = held < 220 ? 0.6 : 0.3 + (hold.p || 0) * 0.7;
    hold = null;
    charge.style.transform = 'scaleX(0)';
    if (fire) { ptrThrowAt = performance.now(); h.throw(p); }
  };
  tb.addEventListener('pointerup', () => release(true));
  tb.addEventListener('pointerleave', () => release(false));
  tb.addEventListener('pointercancel', () => release(!!hold && performance.now() - hold.t0 >= 220));
  tb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!tbOff()) h.throw(0.6); } });
  // 보조 기기(화면 낭독기·음성 제어)는 click만 보낸다
  tb.addEventListener('click', () => { if (tbOff() || performance.now() - ptrThrowAt < 500) return; h.throw(0.6); });
  $('#undoBtn').addEventListener('click', () => h.undo());
  $('#againBtn').addEventListener('click', () => h.again());
  $('#toSetupBtn').addEventListener('click', () => h.toSetup());
  $('#rUndo').addEventListener('click', () => h.resultUndo());

  return {
    setPortrait(fn) { portrait = fn; },
    buildHud, render, renderChoices, clearChoices, flashChoices, buildPad, banner, toast,
    showMission, hideMission, showResult, hideResult,
  };
}

/* ======================= 설정 화면 ======================= */

export const PRESETS = {
  party: { input: 'screen', pieces: 3, party: true, quiet: false, backdo: true, backdoEmpty: 'void', finish: 'pass', odds: 'real', nak: false, endRule: 'first', auto: true },
  classic: { input: 'screen', pieces: 4, party: false, quiet: false, backdo: true, backdoEmpty: 'void', finish: 'pass', odds: 'real', nak: false, endRule: 'first', auto: true },
  real: { input: 'real', pieces: 4, party: false, quiet: false, backdo: true, backdoEmpty: 'void', finish: 'pass', odds: 'real', nak: false, endRule: 'first', auto: true },
};
const DEFAULT_SPECIES = ['horse', 'tiger', 'rabbit', 'pig'];
export function defaultTeamName(species) {
  const s = speciesById(species);
  if (species === 'horse' || species === 'dog') return s.name + '팀';
  return s.animal + '팀';
}

export function defaultSettings() {
  return {
    preset: 'party', teamCount: 2, speed: 'normal',
    ...PRESETS.party,
    teams: DEFAULT_SPECIES.map((sp, i) => ({ species: sp, name: defaultTeamName(sp), named: false, cpu: i >= 2, level: 'normal' })),
  };
}

/** 저장된 설정을 안전하게 읽는다 */
export function sanitizeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  const m = { ...d, ...s };
  m.teamCount = [2, 3, 4].includes(m.teamCount) ? m.teamCount : 2;
  m.pieces = [2, 3, 4].includes(m.pieces) ? m.pieces : 3;
  m.input = m.input === 'real' ? 'real' : 'screen';
  const ids = SPECIES.map(x => x.id);
  m.teams = d.teams.map((t, i) => {
    const src = (Array.isArray(s.teams) && s.teams[i]) || {};
    const o = { ...t, ...src };
    if (!ids.includes(o.species)) o.species = t.species;
    o.name = String(o.name || '').slice(0, 10) || defaultTeamName(o.species);
    if (!['easy', 'normal', 'hard', 'gentle'].includes(o.level)) o.level = 'normal';
    o.cpu = !!o.cpu;
    return o;
  });
  // 같은 동물이 겹치면 비어 있는 동물로 바꾼다
  const used = new Set();
  m.teams.forEach(t => {
    if (used.has(t.species)) { t.species = ids.find(id => !used.has(id)); if (!t.named) t.name = defaultTeamName(t.species); }
    used.add(t.species);
  });
  return m;
}

/** 설정 → 경기 설정(game.js가 받는 모양) */
export function toGameSettings(s) {
  return {
    input: s.input, pieces: s.pieces, endRule: s.endRule, auto: !!s.auto,
    teams: s.teams.slice(0, s.teamCount).map((t, i) => ({ name: (String(t.name).trim() || defaultTeamName(t.species)).slice(0, 10), species: t.species, color: i, cpu: !!t.cpu, level: t.level })),
    rules: { backdo: !!s.backdo, finish: s.finish, backdoEmpty: s.backdoEmpty, odds: s.odds, nak: !!s.nak },
    party: { on: !!s.party, quiet: !!s.quiet },
  };
}

export function createSetup({ getSettings, setSettings, getPrefs, setPrefs, portrait, onStart, onResume, voiceAvailable }) {
  const rows = $('#teamRows');
  function setSeg(sg, v) { sg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }

  function render(info = {}) {
    const s = getSettings(), p = getPrefs();
    $$('#presets .preset').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === s.preset)));
    $$('#setup .seg[data-key]').forEach(sg => { let v = s[sg.dataset.key]; if (typeof v === 'boolean') v = v ? 'on' : 'off'; setSeg(sg, v); });
    $$('#setup .seg[data-pref]').forEach(sg => setSeg(sg, p[sg.dataset.pref] ? 'on' : 'off'));
    $('#rowNak').hidden = s.input === 'real';
    $('#rowOdds').hidden = s.input === 'real';
    $('#rowEnd').hidden = s.teamCount < 3;
    $('#rowQuiet').hidden = !s.party;
    $('#rowBackEmpty').hidden = !s.backdo;
    $('#voiceNote').hidden = voiceAvailable() !== false;
    rows.innerHTML = '';
    for (let i = 0; i < s.teamCount; i++) rows.appendChild(teamRow(s, i));
    const rb = $('#resumeBtn'), sb = $('#startBtn');
    $('#setupClose').hidden = !info.inGame;
    rb.hidden = !info.canResume;
    $('#inGameNote').hidden = !info.inGame;
    rb.textContent = info.inGame ? '하던 경기로 돌아가기' : '저장된 경기 이어하기';
    sb.textContent = info.canResume ? '새 경기 시작!' : '경기 시작!';
    sb.className = 'go ' + (info.canResume ? 'b' : 'a');
    sb.dataset.need = info.canResume ? '1' : '';
    delete sb.dataset.armed;
  }

  function teamRow(s, i) {
    const t = s.teams[i], col = TEAM_COLORS[i];
    const sp = speciesById(t.species);
    const row = document.createElement('div');
    row.className = 'trow';
    row.style.setProperty('--tc', `var(--t${i})`);
    row.innerHTML = `<div class="pick"><button class="prev" aria-label="${i + 1}팀 동물 바꾸기(이전)">◀</button><img alt="${esc(sp.animal)}" src="${portrait(t.species, i, 'happy')}"><button class="next" aria-label="${i + 1}팀 동물 바꾸기(다음)">▶</button></div>`
      + `<div class="tmeta"><input type="text" maxlength="10" enterkeyhint="done" aria-label="${i + 1}팀 이름"><span class="who">${esc(sp.animal)} ${esc(sp.name)} · ${esc(sp.intro)} · ${col.name}</span>`
      + `<div class="opts"><div class="seg sm who2" role="group" aria-label="${i + 1}팀은 누가 하나요"><button data-v="h">사람</button><button data-v="c">컴퓨터</button></div></div></div>`
      + `<div class="seg sm lvl" role="group" aria-label="${i + 1}팀 컴퓨터 세기"${t.cpu ? '' : ' hidden'}><button data-v="gentle">살살</button><button data-v="easy">쉬움</button><button data-v="normal">보통</button><button data-v="hard">어려움</button></div>`;
    const inp = row.querySelector('input');
    inp.value = t.name;
    inp.addEventListener('input', () => { t.name = inp.value; t.named = !!inp.value.trim(); setSettings(s, false); });
    const cycle = dir => {
      const used = new Set(s.teams.slice(0, s.teamCount).filter((_, j) => j !== i).map(x => x.species));
      let k = SPECIES.findIndex(x => x.id === t.species);
      for (let n = 0; n < SPECIES.length; n++) { k = (k + dir + SPECIES.length) % SPECIES.length; if (!used.has(SPECIES[k].id)) break; }
      t.species = SPECIES[k].id;
      if (!t.named) t.name = defaultTeamName(t.species);
      setSettings(s, true);
      h.cry && h.cry(t.species);
    };
    row.querySelector('.prev').addEventListener('click', () => cycle(-1));
    row.querySelector('.next').addEventListener('click', () => cycle(1));
    row.querySelector('img').addEventListener('click', () => cycle(1));
    const who = row.querySelector('.who2');
    setSeg(who, t.cpu ? 'c' : 'h');
    who.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; t.cpu = b.dataset.v === 'c'; setSettings(s, true); });
    const lvl = row.querySelector('.lvl');
    setSeg(lvl, t.level);
    lvl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; t.level = b.dataset.v; setSettings(s, true); });
    return row;
  }

  const h = {};
  $$('#presets .preset').forEach(b => b.addEventListener('click', () => {
    const s = getSettings();
    Object.assign(s, PRESETS[b.dataset.preset], { preset: b.dataset.preset });
    if (s.input === 'real') s.teams.forEach(t => { t.cpu = false; });
    setSettings(s, true);
  }));
  $$('#setup .seg[data-key]').forEach(sg => sg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = getSettings(), k = sg.dataset.key;
    let v = b.dataset.v;
    if (k === 'teamCount' || k === 'pieces') v = +v;
    else if (['backdo', 'nak', 'auto', 'party', 'quiet'].includes(k)) v = v === 'on';
    s[k] = v;
    if (k === 'teamCount') { const used = new Set(); s.teams.forEach(t => { if (used.has(t.species)) { t.species = SPECIES.find(x => !used.has(x.id)).id; if (!t.named) t.name = defaultTeamName(t.species); } used.add(t.species); }); }
    setSettings(s, true);
  }));
  $$('#setup .seg[data-pref]').forEach(sg => sg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const p = getPrefs();
    p[sg.dataset.pref] = b.dataset.v === 'on';
    setPrefs(p);
    setSeg(sg, b.dataset.v);
  }));
  // 하던 경기가 있으면 두 번 눌러야 새로 시작한다(아이가 실수로 판을 날리지 않게)
  let armT = 0;
  $('#startBtn').addEventListener('click', () => {
    const sb = $('#startBtn');
    if (sb.dataset.need === '1' && sb.dataset.armed !== '1') {
      sb.dataset.armed = '1';
      sb.textContent = '하던 경기는 사라져요. 한 번 더 누르면 새로 시작!';
      clearTimeout(armT);
      armT = setTimeout(() => { delete sb.dataset.armed; sb.textContent = '새 경기 시작!'; }, 4000);
      return;
    }
    clearTimeout(armT);
    delete sb.dataset.armed;
    onStart();
  });
  $('#resumeBtn').addEventListener('click', () => onResume());

  // 도움말: 도개걸윷모 동물 카드
  function buildAnimalCards(speak) {
    const box = $('#animalCards');
    box.innerHTML = '';
    [1, 2, 3, 4, 5, BACKDO].forEach(r => {
      const sp = speciesById(RESULT_SPECIES[r]);
      const b = document.createElement('button');
      b.className = 'acard';
      b.innerHTML = `${resultImg(r, 0, portrait)}<b>${RESULT_NAME[r]}</b><span>${r === BACKDO ? '뒷걸음 돼지' : sp.animal} · ${STEP_WORD[r]}</span>`;
      b.addEventListener('click', () => speak(r === BACKDO ? '빽도는 뒷걸음 돼지! 한 칸 뒤로 가요' : `${josa(RESULT_NAME[r], '은', '는')} ${sp.animal}! ${STEP_WORD[r]} 가요`, sp.id));
      box.appendChild(b);
    });
  }

  return { render, handlers: h, buildAnimalCards };
}
