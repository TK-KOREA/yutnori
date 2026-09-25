// 광고(AdMob). 안드로이드 앱에서만 동작하고 웹에서는 아무것도 하지 않는다.
// 아이와 가족이 쓰는 앱이라 Google Play 가족 정책에 맞춘다: 어린이 대상 처리 + 전체 이용가 광고만,
// 앱을 켜자마자 전면 광고를 띄우지 않고, 윷판 경기 중에는 배너도 숨긴다.
import { plugin } from './native.js';

const AdMob = plugin('AdMob');
/** true면 Google 테스트 광고만 나온다(눌러도 안전). 출시 빌드에서만 false로 바꾼다 */
const TEST = true;
const IDS = {
  banner: 'ca-app-pub-8797923354370025/7743278088',   // 윷놀이_배너_하단
  interstitial: 'ca-app-pub-8797923354370025/7310007121',   // 윷놀이_전면_새판
};
const EVERY = 2;              // 이만큼 경기를 마칠 때마다 다음 경기 전에 전면 광고 한 번
const CLOSE_WAIT = 60000;     // 닫힘 알림이 오지 않는 기기 대비: 이 시간이 지나면 그냥 경기를 시작

let ready = Promise.resolve(false);
let bannerMade = false, bannerWant = false, bannerQueue = Promise.resolve();
let finished = 0, interReady = null;

/** 배너 높이만큼 창 아래를 비워 버튼이 가리지 않게(css의 --ad-h) */
const setAdHeight = h => document.documentElement.style.setProperty('--ad-h', `${Math.max(0, Math.round(h || 0))}px`);

export function initAds() {
  if (!AdMob) return ready;
  ready = AdMob.initialize({
    tagForChildDirectedTreatment: true,   // 어린이 대상으로 처리(맞춤 광고 없음)
    maxAdContentRating: 'General',        // 전체 이용가 광고만
    initializeForTesting: TEST,
  }).then(() => true, () => false);
  AdMob.addListener('bannerAdSizeChanged', s => setAdHeight(bannerWant && s ? s.height : 0));
  return ready;
}

function setBanner(on) {
  if (!AdMob || on === bannerWant) return;
  bannerWant = on;
  // 창을 빠르게 열고 닫아도 순서대로 처리한다. 그사이 바뀌었으면 나중 것만
  bannerQueue = bannerQueue.then(async () => {
    if (!(await ready) || bannerWant !== on) return;
    try {
      if (on && !bannerMade) {
        await AdMob.showBanner({ adId: IDS.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', isTesting: TEST });
        bannerMade = true;
      } else if (on) await AdMob.resumeBanner();
      else if (bannerMade) { await AdMob.hideBanner(); setAdHeight(0); }
    } catch (e) { /* 광고가 없어도 게임은 계속 */ }
  });
}

/** 이 창들 중 하나라도 열려 있으면 배너를 보이고, 모두 닫히면(윷판 경기 중) 숨긴다 */
export function bannerOnScreens(ids) {
  if (!AdMob) return;
  const els = ids.map(id => document.getElementById(id)).filter(Boolean);
  const upd = () => setBanner(els.some(el => !el.hidden));
  const mo = new MutationObserver(upd);
  els.forEach(el => mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }));
  upd();
}

/** 한 판이 끝났다. EVERY판째면 다음 경기 전에 보여 줄 전면 광고를 미리 불러 둔다 */
export function gameFinished() {
  if (!AdMob) return;
  finished++;
  if (finished < EVERY || interReady || !(IDS.interstitial || TEST)) return;
  interReady = ready.then(ok => ok && AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TEST }).then(() => true, () => false));
}

/** 새 경기 직전. 불러 둔 전면 광고가 있으면 보여 주고, 닫힐 때까지 기다린다 */
export async function beforeNewGame() {
  if (!AdMob || !interReady) return;
  const loaded = await interReady;
  interReady = null;
  if (!loaded) return;      // 못 불러왔으면 다음 판이 끝날 때 다시
  finished = 0;
  const subs = [];
  const closed = new Promise(res => {
    subs.push(AdMob.addListener('interstitialAdDismissed', res), AdMob.addListener('interstitialAdFailedToShow', res));
    setTimeout(res, CLOSE_WAIT);
  });
  try { await AdMob.showInterstitial(); await closed; } catch (e) { /* 못 보여 줘도 경기는 시작 */ }
  subs.forEach(s => { try { s.remove(); } catch (e) { /* 무시 */ } });
}
