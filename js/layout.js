// 판 밖 자리(팀 방석, 완주 지점) 좌표. 윷판·말 모듈이 함께 쓴다.
import { H, BT, NODE } from './scene.js';

/** 완주할 때 뛰어드는 지점(참먹이 바깥 대각선 방향) */
export const FIN_XZ = [H + 0.74, H + 0.74];

/** 방석 윗면 높이 */
export const NEST_TOP = 0.13;
/** 방석 한 변 */
export const NEST_SIZE = 1.9;
/** 방석과 판 중심 사이 거리 */
export const NEST_OFFSET = 6.45;

const SPREAD = { 1: [0], 2: [-1.4, 1.4], 3: [-2.7, 0, 2.7], 4: [-3.9, -1.3, 1.3, 3.9] };

/**
 * 팀 t 방석의 중심.
 * side: 'bottom'(세로 화면 — 멍석이 판 아래, 방석은 판 위쪽 z<0 한 줄)
 *       'right' (가로 화면 — 멍석이 판 오른쪽, 방석은 판 왼쪽 x<0 한 열)
 */
export function nestCenter(t, teamCount, side) {
  const s = (SPREAD[teamCount] || SPREAD[4])[t] || 0;
  return side === 'right' ? { x: -NEST_OFFSET, z: s } : { x: s, z: -NEST_OFFSET };
}

/**
 * 방석 위 i번째 칸(2×2). 0 = 카메라 쪽 왼쪽, 1 = 카메라 쪽 오른쪽, 2·3 = 뒤쪽 줄.
 * 가로 화면에서도 카메라는 +z 쪽에서 보므로 같은 규칙을 쓴다.
 */
export function nestSlot(t, i, teamCount, side) {
  const c = nestCenter(t, teamCount, side);
  const dx = (i % 2 === 0 ? -1 : 1) * 0.46, dz = (i < 2 ? 1 : -1) * 0.46;
  return { x: c.x + dx, y: NEST_TOP, z: c.z + dz };
}

/** 판 위 칸 n의 윗면 좌표 */
export function nodeTop(n) {
  return { x: NODE[n][0], y: BT, z: NODE[n][1] };
}

/** 방석까지 포함한 판 영역(카메라 맞춤용) */
export function boardBox(side) {
  const e = 5.45, far = NEST_OFFSET + NEST_SIZE / 2 + 0.15;
  return side === 'right'
    ? { x0: -far, x1: e, z0: -e, z1: e, y1: 1.6 }
    : { x0: -e, x1: e, z0: -far, z1: e, y1: 1.6 };
}
