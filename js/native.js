// 안드로이드 앱(Capacitor)에서만 쓰는 연결부. 웹에서는 아무것도 하지 않는다.
// 번들러가 없으므로 앱이 넣어 주는 window.Capacitor.Plugins를 바로 쓴다.

const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
/** 안드로이드 앱 안에서 도는가 */
export const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
/** 네이티브 플러그인. 웹이거나 없으면 null */
export const plugin = name => (isNative && cap.Plugins && cap.Plugins[name]) || null;

/** 안드로이드 뒤로 가기 버튼. 처리기를 달면 앱이 바로 닫히지 않는다 */
export function onBackButton(fn) {
  const App = plugin('App');
  if (App) App.addListener('backButton', fn);
}
export function exitApp() {
  const App = plugin('App');
  if (App) App.exitApp();
}

const LANG = 'ko-KR';
const CHECK_TRIES = 10, CHECK_GAP = 500;   // 기기 TTS 엔진은 늦게 준비되므로 한국어 지원을 몇 번 다시 묻는다

/**
 * 안드로이드 WebView에는 speechSynthesis가 없다. 기기 TTS(TextToSpeech 플러그인)를
 * speechSynthesis·SpeechSynthesisUtterance처럼 보이게 감싸서 createVoice({ synth, Utterance })에 넣는다.
 * 웹에서는 빈 객체를 돌려주므로 createVoice가 브라우저 speechSynthesis를 그대로 쓴다.
 */
export function nativeSpeech() {
  const TTS = plugin('TextToSpeech');
  if (!TTS) return {};
  const listeners = new Set();
  let voices = [];
  let cur = null;   // 지금 읽는 문장

  class Utterance {
    constructor(text) {
      this.text = String(text || '');
      this.lang = LANG; this.voice = null;
      this.rate = 1; this.pitch = 1; this.volume = 1;
      this.onend = null; this.onerror = null;
    }
  }
  const finish = (u, ok) => {
    if (cur === u) cur = null;
    const fn = ok ? u.onend : u.onerror;
    if (fn) try { fn({ utterance: u }); } catch (e) { /* 무시 */ }
  };

  const synth = {
    get speaking() { return !!cur; },
    pending: false,
    paused: false,
    getVoices: () => voices,
    addEventListener(type, fn) { if (type === 'voiceschanged') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    speak(u) {
      // 브라우저용 '소리 없는 짧은 문장'(읽기 허락 받기)은 앱에서는 필요 없다
      if (!u.text.trim() || u.volume === 0) { setTimeout(() => finish(u, true), 0); return; }
      cur = u;
      TTS.speak({ text: u.text, lang: u.lang || LANG, rate: u.rate, pitch: u.pitch, volume: u.volume, queueStrategy: 0 })
        .then(() => finish(u, true), () => finish(u, false));
    },
    cancel() {
      cur = null;
      TTS.stop().catch(() => {});
    },
    resume() {},
  };

  // 기기에 한국어 음성이 있으면 목소리 하나를 알린다. 끝내 없으면 읽어 주기가 꺼진 채로 둔다
  let tries = 0;
  const check = () => {
    TTS.isLanguageSupported({ lang: LANG }).then(r => {
      if (r && r.supported) {
        voices = [{ name: '기기 한국어 음성', lang: LANG, voiceURI: 'android-tts', default: true, localService: true }];
        listeners.forEach(fn => { try { fn(); } catch (e) { /* 무시 */ } });
      } else if (++tries < CHECK_TRIES) setTimeout(check, CHECK_GAP);
    }, () => { if (++tries < CHECK_TRIES) setTimeout(check, CHECK_GAP); });
  };
  check();

  return { synth, Utterance };
}
