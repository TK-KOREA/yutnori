// 한국어 읽어 주기(speechSynthesis). 한국어 목소리가 없으면 아무것도 읽지 않는다(외국어 목소리로 한국어를 읽지 않음).
// 우선순위: high = 지금 것을 끊고 바로, normal = 말하는 중·대기 중인 것을 바꿔 치기
//           (high는 끊지 않고 끝난 뒤 읽는다. 대기는 하나뿐이고 4초가 지나면 버림), low = 무엇이든 말하는 중이면 버림.

/** 좋은 한국어 목소리 이름(앞일수록 먼저). 한국어 macOS·iOS에서는 Yuna가 '유나'로 나온다 */
const PREFER = [['Yuna', '유나'], ['Google 한국의'], ['Heami', '해미'], ['SunHi', '선희']];
/** macOS·iOS의 기계음 같은 장난 목소리(Eloquence)는 되도록 피한다 */
const NOVELTY = /eloquence|^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const RATE = 1.05, PITCH = 1.15;
const WAIT_VOICES = 1500;   // voiceschanged를 기다리는 최대 시간(ms)
const STALE = 4000;         // high 뒤에 기다린 문장이 이보다 오래되면 버린다(이미 지난 일을 늦게 읽지 않게)

const langOf = v => String((v && v.lang) || '').replace('_', '-').toLowerCase();

/** 목소리 목록에서 가장 좋은 한국어 목소리. 없으면 null */
export function pickKoreanVoice(voices) {
  let best = null, bestScore = -1;
  for (const v of voices || []) {
    const lang = langOf(v);
    if (!lang.startsWith('ko')) continue;
    const name = String(v.name || ''), id = name + ' ' + String(v.voiceURI || '');
    const i = PREFER.findIndex(ps => ps.some(p => id.includes(p)));
    let s = i >= 0 ? 20 + (PREFER.length - i) * 10 : 10;
    if (/premium|enhanced|natural|고품질|향상/i.test(id)) s += 3;   // 같은 이름이면 고품질판
    if (NOVELTY.test(name) || NOVELTY.test(String(v.voiceURI || ''))) s -= 8;
    if (v.default) s += 2;
    if (v.localService) s += 1;
    if (lang === 'ko-kr') s += 1;
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

/**
 * 읽어 주기 묶음을 만든다.
 * synth/Utterance는 테스트에서 가짜로 바꿔 넣을 수 있다. onSpeaking(bool)은 말하기 시작·끝(음악 줄이기용).
 */
export function createVoice({
  synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined,
  Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : undefined,
  onSpeaking,
} = {}) {
  const supported = !!(synth && typeof synth.speak === 'function' && typeof Utterance === 'function');
  let voice = null, enabled = true, unlocked = false, speaking = false;
  let cur = null;           // 지금 읽는 것 { text, prio, u }
  let queued = null;        // high가 끝나면 읽을 것(하나만)
  let watchdog = 0;

  const voicesNow = () => { try { return synth.getVoices() || []; } catch (e) { return []; } };
  const refresh = () => { voice = pickKoreanVoice(voicesNow()); };

  function listen(fn) {
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', fn);
    else { const prev = synth.onvoiceschanged; synth.onvoiceschanged = e => { if (prev) prev(e); fn(e); }; }
  }
  function unlisten(fn) {
    if (typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', fn);
  }

  // 목소리 목록이 나중에 바뀌어도(늦게 받는 목소리) 다시 고른다
  if (supported) { refresh(); listen(refresh); }

  const ready = new Promise(res => {
    if (!supported) { res(false); return; }
    if (voice) { res(true); return; }
    let timer = 0;
    const done = () => { clearTimeout(timer); unlisten(check); refresh(); res(!!voice); };
    function check() { refresh(); if (voice) done(); }
    listen(check);
    timer = setTimeout(done, WAIT_VOICES);
  });

  function setSpeaking(b) {
    if (speaking === b) return;
    speaking = b;
    if (onSpeaking) try { onSpeaking(b); } catch (e) { /* 무시 */ }
  }

  /** 지금 것이 끝남: 대기 중인 것이 아직 새것이면 이어서 */
  function finish() {
    clearTimeout(watchdog);
    cur = null;
    const n = queued;
    queued = null;
    if (n && Date.now() - n.at <= STALE) speakNow(n);
    else setSpeaking(false);
  }

  function speakNow(item) {
    clearTimeout(watchdog);
    cur = item;
    // Chrome이 가끔 말하기 상태에 멈춰 있는 버그: 새로 읽기 전에 비우고, 멈춰 있으면 깨운다
    try { if (synth.speaking || synth.pending) synth.cancel(); } catch (e) { /* 무시 */ }
    try { if (synth.paused) synth.resume(); } catch (e) { /* 무시 */ }
    const u = new Utterance(item.text);
    u.lang = 'ko-KR';
    try { u.voice = voice; } catch (e) { /* 무시 */ }
    u.rate = RATE; u.pitch = PITCH; u.volume = 1;
    item.u = u;
    // 끊긴 옛 문장의 end/error는 무시한다(cur가 이미 바뀜)
    u.onend = () => { if (cur === item) finish(); };
    u.onerror = () => { if (cur === item) finish(); };
    setSpeaking(true);
    // end가 오지 않는 기기 대비: 글자 수로 넉넉히 잡은 시간이 지나면 끝난 것으로 친다
    watchdog = setTimeout(() => { if (cur === item) finish(); }, 2500 + item.text.length * 220);
    try { synth.speak(u); } catch (e) { if (cur === item) finish(); }
  }

  const api = {
    supported,
    ready,
    /** 한국어 목소리가 있나 */
    get available() { return !!voice; },
    get voice() { return voice; },
    get enabled() { return enabled; },
    get speaking() { return speaking; },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) api.cancel();
    },
    /** 사용자 탭 안에서 한 번: 소리 없는 짧은 문장을 읽어 iOS·Chrome이 나중의 읽기를 허락하게 한다 */
    unlock() {
      if (!supported || unlocked) return;
      unlocked = true;
      try {
        const u = new Utterance(' ');
        u.lang = 'ko-KR';
        u.volume = 0;
        if (voice) try { u.voice = voice; } catch (e) { /* 무시 */ }
        synth.speak(u);
      } catch (e) { /* 무시 */ }
    },
    /** 읽기. 실제로 읽거나 줄 세웠으면 true */
    say(text, { prio = 'normal' } = {}) {
      if (!supported || !enabled || !voice || !text) return false;
      const item = { text: String(text), prio, at: Date.now() };
      if (prio === 'low') {
        if (cur || queued) return false;
        speakNow(item);
        return true;
      }
      if (prio !== 'high' && cur && cur.prio === 'high') { queued = item; return true; }
      queued = null;
      speakNow(item);
      return true;
    },
    cancel() {
      clearTimeout(watchdog);
      queued = null;
      const was = cur;
      cur = null;
      if (was) try { synth.cancel(); } catch (e) { /* 무시 */ }
      setSpeaking(false);
    },
  };
  return api;
}
