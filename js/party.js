// 잔치 모드: 이벤트 칸과 가족 미션 카드. 순수 모듈(화면 없음).
import { HOME, DONE, FIN, computeMove, distToFin } from './rules.js';

/**
 * 이벤트 칸. 말이 그 칸에 "멈췄을 때만" 발동하고, 한 번 발동하면 모든 팀이 한 번씩 할 때까지 쉰다.
 * 이벤트로 옮겨 간 칸에서 다른 이벤트가 이어서 터지지는 않는다(잡기·업기는 일어난다).
 */
export const TILES = {
  4: { id: 'gift', icon: '🎁', name: '선물 상자', desc: '선물을 열어요! 한 번 더 던지거나 앞으로 가요' },
  7: { id: 'mission', icon: '🎴', name: '가족 미션', desc: '미션 카드를 뽑아요' },
  9: { id: 'gate', icon: '🚪', name: '도깨비 문', desc: '뚝딱! 가운데 방으로 순간이동' },
  12: { id: 'magpie', icon: '🐦', name: '까치 소식', desc: '반가운 소식! 한 번 더 던져요' },
  16: { id: 'mission', icon: '🎴', name: '가족 미션', desc: '미션 카드를 뽑아요' },
  18: { id: 'puddle', icon: '💧', name: '웅덩이', desc: '미끄덩~ 한 칸 뒤로' },
  26: { id: 'friend', icon: '🤝', name: '친구 부르기', desc: '집에 있는 우리 말을 불러 업어요' },
  23: { id: 'tiger', icon: '🐯', name: '호랑이 굴', desc: '어흥! 집으로 돌아가요', spicy: true },
};

/** 지금 이 칸에서 이벤트가 발동하는가 */
export function tileAt(state, node) {
  if (!state.party || !state.party.on || typeof node !== 'number' || node < 0 || node === DONE) return null;
  const tile = TILES[node];
  if (!tile) return null;
  if (tile.spicy && !state.party.spicy) return null;
  const cd = state.party.cool[node];
  if (cd != null && state.turnSerial < cd) return null;
  return tile;
}

export function newPartyState(on, spicy, quiet) {
  return { on: !!on, spicy: !!spicy, quiet: !!quiet, cool: {}, deck: [], used: [] };
}

/** 칸을 쉬게 한다(모든 팀이 한 번씩 할 때까지) */
export function coolDown(state, node) {
  const alive = state.teams.filter(o => o.rank == null).length || 1;
  state.party.cool[node] = state.turnSerial + alive;
}

/** 진행이 가장 늦은 팀인가(따라잡기용) */
function isLast(state, t) {
  const prog = state.teams.map((o, i) => o.rank != null ? Infinity
    : o.pieces.reduce((s, q) => s + (q.pos === DONE ? 30 : q.pos === HOME ? 0 : 30 - distToFin(q.pos, state.rules)), 0));
  const min = Math.min(...prog.filter(Number.isFinite));
  return prog[t] === min && prog.filter(p => p === min).length === 1;
}

/**
 * 이벤트의 효과를 정한다(난수 사용). 게임 쪽에서 실제로 적용한다.
 * 반환 예:
 *   { kind:'extra' }                     한 번 더 던지기
 *   { kind:'forward', steps:2 }          앞으로 n칸
 *   { kind:'back', steps:1 }             뒤로 n칸
 *   { kind:'teleport', to:22 }           순간이동
 *   { kind:'friend' }                    집의 우리 말 한 개를 데려와 업기(없으면 extra)
 *   { kind:'mission', mission }          미션 카드
 *   { kind:'home' }                      집으로
 */
export function resolveTile(state, t, node, tile, rnd) {
  switch (tile.id) {
    case 'gift': {
      if (isLast(state, t)) return { kind: 'extra', label: '꼴찌 팀 응원 선물! 한 번 더!' };
      const x = rnd();
      if (x < 0.4) return { kind: 'extra', label: '한 번 더!' };
      if (x < 0.75) return { kind: 'forward', steps: 2, label: '앞으로 두 칸!' };
      return { kind: 'forward', steps: 1, label: '앞으로 한 칸!' };
    }
    case 'mission': return { kind: 'mission', mission: drawMission(state, rnd) };
    case 'gate': return { kind: 'teleport', to: 22, label: '뚝딱! 방으로' };
    case 'magpie': return { kind: 'extra', label: '한 번 더!' };
    case 'puddle': return { kind: 'back', steps: 1, label: '미끄덩~' };
    case 'friend': {
      const home = state.teams[t].pieces.some(q => q.pos === HOME);
      return home ? { kind: 'friend', label: '친구야, 같이 가자!' } : { kind: 'extra', label: '한 번 더!' };
    }
    case 'tiger': return { kind: 'home', label: '어흥!' };
    default: return null;
  }
}

/** 이벤트로 앞으로/뒤로 갈 때의 목적지 (지름길 규칙 그대로) */
export function stepFrom(state, node, trail, steps) {
  if (steps < 0) {
    const m = computeMove(node, trail, -1, state.rules);
    return m;
  }
  return computeMove(node, trail, steps, state.rules);
}

/* ---------------------------------------------------------------
 * 가족 미션 카드
 * kind: sound(소리) body(몸) heart(마음) fun(재미) all(다 함께)
 * --------------------------------------------------------------- */
export const MISSIONS = [
  { id: 1, kind: 'sound', icon: '🐶', text: '강아지처럼 "멍멍" 세 번!' },
  { id: 2, kind: 'sound', icon: '🦁', text: '사자처럼 "어흥!" 크게 외치기' },
  { id: 3, kind: 'sound', icon: '🐔', text: '닭처럼 날개 파닥이며 "꼬끼오!"' },
  { id: 4, kind: 'sound', icon: '👹', text: '도깨비 목소리로 "뚝딱!"' },
  { id: 5, kind: 'sound', icon: '🎵', text: '좋아하는 노래 한 소절 부르기' },
  { id: 6, kind: 'body', icon: '🐸', text: '개구리처럼 폴짝폴짝 세 번' },
  { id: 7, kind: 'body', icon: '🐰', text: '토끼 귀 만들고 깡충깡충' },
  { id: 8, kind: 'body', icon: '💃', text: '10초 동안 신나게 춤추기', timer: 10 },
  { id: 9, kind: 'body', icon: '🦩', text: '한 발로 5초 서 있기', timer: 5 },
  { id: 10, kind: 'body', icon: '🤖', text: '로봇처럼 걸어서 제자리로' },
  { id: 11, kind: 'body', icon: '✈️', text: '비행기 자세로 5초', timer: 5 },
  { id: 12, kind: 'body', icon: '🩰', text: '까치발로 빙그르르 한 바퀴' },
  { id: 13, kind: 'body', icon: '🐢', text: '거북이처럼 느릿느릿 기어가기' },
  { id: 14, kind: 'body', icon: '🐱', text: '고양이처럼 기지개 켜고 "야옹"' },
  { id: 15, kind: 'heart', icon: '💛', text: '옆 사람 칭찬 한 가지 하기' },
  { id: 16, kind: 'heart', icon: '🤗', text: '가족 한 명 꼭 안아 주기' },
  { id: 17, kind: 'heart', icon: '💌', text: '가족에게 "사랑해요" 말하기' },
  { id: 18, kind: 'heart', icon: '💆', text: '누군가의 어깨 열 번 주물러 주기' },
  { id: 19, kind: 'heart', icon: '🌈', text: '오늘 제일 좋았던 일 말하기' },
  { id: 20, kind: 'heart', icon: '🌠', text: '소원 한 가지 말하기' },
  { id: 21, kind: 'heart', icon: '🍙', text: '좋아하는 음식 세 가지 말하기' },
  { id: 22, kind: 'fun', icon: '🤪', text: '제일 웃긴 표정 짓기' },
  { id: 23, kind: 'fun', icon: '😐', text: '다른 사람이 웃겨도 5초 참기', timer: 5 },
  { id: 24, kind: 'fun', icon: '🧊', text: '3초 동안 얼음!', timer: 3 },
  { id: 25, kind: 'fun', icon: '✍️', text: '손가락으로 공중에 내 이름 쓰기' },
  { id: 26, kind: 'fun', icon: '🙈', text: '눈 감고 열까지 세기' },
  { id: 27, kind: 'all', icon: '📣', text: '모두 함께 "윷이야!" 외치기' },
  { id: 28, kind: 'all', icon: '👏', text: '모두 함께 박수 열 번' },
  { id: 29, kind: 'all', icon: '✌️', text: '가위바위보! 이긴 사람과 하이파이브' },
  { id: 30, kind: 'all', icon: '🙇', text: '어른께 세배 한 번 드리기' },
];

/** 한 판에서 같은 미션이 다시 나오지 않도록 섞어서 뽑는다 */
export function drawMission(state, rnd) {
  const p = state.party;
  const pool = MISSIONS.filter(m => !(p.quiet && (m.kind === 'sound' || m.kind === 'body')));
  let left = pool.filter(m => !p.used.includes(m.id));
  if (!left.length) { p.used = []; left = pool; }
  const m = left[Math.floor(rnd() * left.length)];
  p.used.push(m.id);
  return m;
}

/** 컴퓨터가 수를 고를 때 쓰는 이벤트 칸 점수 */
export function tileBonusFor(state, t, dest) {
  if (!state.party || !state.party.on || dest === FIN) return 0;
  const tile = tileAt(state, dest);
  if (!tile) return 0;
  return { gift: 15, mission: 6, gate: 20, magpie: 20, puddle: -6, friend: 22, tiger: -40 }[tile.id] || 0;
}
