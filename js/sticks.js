// 멍석과 윷가락 네 개, 그리고 던지기 연출.
// 물리 엔진 없이 미리 짠 궤적으로 움직인다: 손으로 모으기 → 포물선 비행 → 한두 번 튀기 → 등으로 구르며 멈추기.
// 끝 자세는 언제나 요청한 면이다(flats[i]가 true면 평평한 배가 위).
// 조마조마 가락은 나머지 셋이 다 멈춘 뒤 마지막으로 내려앉아 혼자 흔들린다(그동안 북).
// 짠 궤적은 시간 순으로 훑어 가락끼리 파고들지 않는 것만 쓴다.
// 좌표는 멍석 기준(local): x = 멍석 긴 변, z = 짧은 변, y = 위. rig 그룹이 멍석 자리(side)로 옮기고 돌린다.
import * as THREE from 'three';
import { tween, finishAll, ease, SPEED, reducedMotion } from './anim.js';

/* ---------------- 치수 ---------------- */
export const MAT_W = 7.6;            // 멍석 긴 변(local x)
export const MAT_D = 3.5;            // 멍석 짧은 변(local z)
const MAT_H = 0.1;                   // 테두리 천 높이
const STRAW_Y = 0.075;               // 짚 윗면 — 윷가락이 닿는 높이
const BAND = 0.26;                   // 테두리 천 폭
const FLOOR_Y = 0;                   // 멍석 밖 바닥(낙)
const IN_X = MAT_W / 2 - BAND - 0.04, IN_Z = MAT_D / 2 - BAND - 0.04;   // 윷가락이 누울 수 있는 안쪽
export const STICK_L = 2.6, STICK_R = 0.3, STICK_YS = 0.75;
const SL = STICK_L, A = STICK_R, B = STICK_R * STICK_YS;   // 단면 반타원: 가로 반지름 A, 깊이 B(배가 y=0, 등이 아래)
const END = 0.11, TIP = 0.62;        // 끝 둥글리기 길이, 맨 끝 단면 비율
const LIFT = 0.003;                  // 면 겹침 깜빡임 방지
const OUT_X = 4.75;                  // 낙 자리(멍석 긴 변 끝 바깥)
const G_FLY = 95, G_HOP = 55;        // 비행·튀기 중력(월드 단위/s²)
const TG = 0.15;                     // 손으로 모으는 시간(s)
const SLOW = 0.35;                   // 윷·모 슬로모션 배율
const T_MAX = 1.96;                  // 보통 던지기 길이 한도(s, 계획 시간)
const DR_MIN = 0.44, DR_MAX = 0.56;  // 조마조마 흔들기(북) 길이
const RES_FLIP = 0.26, RES_BACK = 0.35;   // 흔들린 뒤 넘어가기 / 돌아오기 길이
const ROW = 0.66;                    // 손에 쥔 가락 사이(가락 폭 2A보다 조금 넓게 한 줄)
const CLEAR = 0.58;                  // 두 가락 중심선 사이 최소 거리(반지름 A 캡슐 둘 — 캡슐이 넉넉해 조금 봐준다)
const TAU = Math.PI * 2;

/** 멍석 자리. right는 local +x가 카메라 쪽(월드 +z)을 보도록 돌린다 */
const PLACE = {
  bottom: { x: 0, z: 7.8, rot: 0 },
  right: { x: 9.0, z: 0, rot: -Math.PI / 2 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (a, b) => a + Math.random() * (b - a);
const jit = s => (Math.random() * 2 - 1) * s;

/** 텍스처용 씨앗 난수(같은 씨앗이면 같은 나뭇결) */
function mulberry(seed) {
  return () => {
    let a = (seed = (seed + 0x6D2B79F5) | 0);
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 구르기 표 ----------------
 * 윷가락을 긴 축으로 θ만큼 돌렸을 때(θ=0 배가 위, ±π 배가 아래) 바닥에 닿은 채 미끄러짐 없이 구르면
 * 중심(배 한가운데)이 옆으로 dx, 위로 y만큼 있다. |θ|≤π/2는 둥근 등으로 구르고, 그 너머는 모서리로 넘어간다.
 */
const ROLL = (() => {
  const n = 256, th = [], cx = [], cy = [];
  let s = 0, px0 = 0, py0 = -B;
  for (let i = 0; i <= n; i++) {
    const ph = 1.5 * Math.PI - (Math.PI / 2) * i / n;       // 바닥 → 왼쪽 모서리
    const px = A * Math.cos(ph), py = B * Math.sin(ph);
    s += Math.hypot(px - px0, py - py0); px0 = px; py0 = py;
    let t = -Math.PI / 2 - Math.atan2(A * Math.sin(ph), B * Math.cos(ph));
    t = ((t % TAU) + TAU) % TAU; if (t > Math.PI) t -= TAU;
    t = clamp(t, 0, Math.PI / 2);
    const c = Math.cos(t), sn = Math.sin(t);
    th.push(t); cx.push(-s - (px * c - py * sn)); cy.push(-(px * sn + py * c));
  }
  return { th, cx, cy, sQ: s };
})();

/** 등(둥근 면)으로 구를 때 [dx, y] */
function backRollPose(t) {
  const sg = t < 0 ? -1 : 1, a = Math.abs(t);
  if (a >= Math.PI / 2) { const k = Math.min(a, Math.PI); return [sg * (-ROLL.sQ + A * Math.cos(k)), A * Math.sin(k)]; }
  const T = ROLL.th;
  let lo = 0, hi = T.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= a) lo = m; else hi = m; }
  const k = T[hi] > T[lo] ? (a - T[lo]) / (T[hi] - T[lo]) : 0;
  return [sg * lerp(ROLL.cx[lo], ROLL.cx[hi], k), lerp(ROLL.cy[lo], ROLL.cy[hi], k)];
}
/** 배가 아래로 누운 채 모서리로 까딱일 때 [dx, y] (e = 멈출 각도와의 차이) */
function flatPose(e) {
  return [-Math.sign(e) * A * (1 - Math.cos(e)), A * Math.sin(Math.abs(e))];
}
/** 멈출 면(rest: 0 또는 ±π) 기준 바닥 자세 */
const surf = (t, rest) => (rest === 0 ? backRollPose(t) : flatPose(t - rest));
/** 포물선: 가장 낮은 점이 y0에서 top까지 올라갔다 y1에 닿는다 */
function ballistic(y0, y1, top, g) {
  top = Math.max(top, y0 + 0.01, y1 + 0.01);
  const tUp = Math.sqrt(2 * (top - y0) / g), tDn = Math.sqrt(2 * (top - y1) / g), v0 = g * tUp;
  return { T: tUp + tDn, y: t => y0 + v0 * t - 0.5 * g * t * t };
}
/** 제자리에서 T초 동안 튀려면 필요한 높이 */
const hopH = T => G_HOP * T * T / 8;
/** 두 선분 [px,py,pz,qx,qy,qz] 사이 최소 거리 */
function segDist(a, b) {
  const d1x = a[3] - a[0], d1y = a[4] - a[1], d1z = a[5] - a[2], d2x = b[3] - b[0], d2y = b[4] - b[1], d2z = b[5] - b[2];
  const rx = a[0] - b[0], ry = a[1] - b[1], rz = a[2] - b[2];
  const aa = d1x * d1x + d1y * d1y + d1z * d1z, ee = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz, c = d1x * rx + d1y * ry + d1z * rz, bb = d1x * d2x + d1y * d2y + d1z * d2z;
  const den = aa * ee - bb * bb;
  let s = den > 1e-9 ? clamp((bb * f - c * ee) / den, 0, 1) : 0;
  let t = (bb * s + f) / ee;
  if (t < 0) { t = 0; s = clamp(-c / aa, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / aa, 0, 1); }
  return Math.hypot(rx + d1x * s - d2x * t, ry + d1y * s - d2y * t, rz + d1z * s - d2z * t);
}
/** 바닥에 누운 가락의 발자국(긴 축 선분, y=0) */
const footprint = (x, z, yaw) => { const ax = Math.sin(yaw) * SL / 2, az = Math.cos(yaw) * SL / 2; return [x - ax, 0, z - az, x + ax, 0, z + az]; };
/** 자세 P의 긴 축(배 면 가운데를 지나는 선). 몸통은 이 선에서 A 안에 있다 */
function axisSeg(P, o) {
  const cp = Math.cos(P.pitch), h = SL / 2 - 0.08;
  const ax = Math.sin(P.yaw) * cp * h, ay = -Math.sin(P.pitch) * h, az = Math.cos(P.yaw) * cp * h;
  o[0] = P.x - ax; o[1] = P.y - ay; o[2] = P.z - az; o[3] = P.x + ax; o[4] = P.y + ay; o[5] = P.z + az;
  return o;
}
function insideMat(x, z, yaw) {
  const s = Math.abs(Math.sin(yaw)), c = Math.abs(Math.cos(yaw));
  return Math.abs(x) + s * SL / 2 + c * A <= IN_X && Math.abs(z) + c * SL / 2 + s * A <= IN_Z;
}
const perpOf = yaw => [Math.cos(yaw), -Math.sin(yaw)];   // 윷가락 local x(가로) 방향

/* ---------------- 윷가락 모양 ---------------- */
// 텍스처 한 장(가락마다 재질 하나 = 그리기 한 번): 등 | 틈 | 배 | 틈 | 마구리
const AT_W = 288, AT_H = 512, U_BACK = 0, U_FLAT = 136, U_CAP = 280;
/** 반타원 막대. 끝은 둥글게 줄어든다. 등(둥근 면)·배(평평한 면)·마구리가 한 텍스처의 다른 칸을 쓴다 */
function stickGeometry() {
  const N = 24, D = [0, 0.012, 0.03, 0.055, 0.08, END];
  const zs = [...D.map(d => -SL / 2 + d), ...D.slice().reverse().map(d => SL / 2 - d)];
  const cy0 = -0.4 * B;   // 끝으로 갈수록 이 점을 향해 줄어든다(배 모서리도 살짝 둥글게)
  const shrink = z => { const u = Math.min(1, (SL / 2 - Math.abs(z)) / END); return TIP + (1 - TIP) * Math.sqrt(1 - (1 - u) * (1 - u)); };
  const pos = [], uv = [], idx = [];
  const ux = (x0, u) => (x0 + 0.5 + u * 127) / AT_W;
  const ringPt = (z, k) => {
    const s = shrink(z), ph = Math.PI + Math.PI * k / N;
    return [A * Math.cos(ph) * s, cy0 + (B * Math.sin(ph) - cy0) * s, z];
  };
  // 등
  zs.forEach(z => { for (let k = 0; k <= N; k++) { pos.push(...ringPt(z, k)); uv.push(ux(U_BACK, k / N), (z + SL / 2) / SL); } });
  for (let j = 0; j < zs.length - 1; j++) {
    for (let k = 0; k < N; k++) { const a = j * (N + 1) + k, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  }
  // 배(평평한 면): u를 뒤집어 위에서 볼 때 그림이 거울상이 되지 않게
  const f0 = pos.length / 3;
  zs.forEach(z => {
    const s = shrink(z), y = cy0 * (1 - s), v = (z + SL / 2) / SL;
    pos.push(-A * s, y, z, A * s, y, z); uv.push(ux(U_FLAT, 0.5 + s / 2), v, ux(U_FLAT, 0.5 - s / 2), v);
  });
  for (let j = 0; j < zs.length - 1; j++) { const a = f0 + 2 * j, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  // 마구리(양 끝 면): 한 가지 색
  const cu = U_CAP / AT_W;
  for (const [z, front] of [[zs[0], false], [zs[zs.length - 1], true]]) {
    const s = shrink(z), c0 = pos.length / 3;
    pos.push(0, cy0 + (-0.45 * B - cy0) * s, z); uv.push(cu, 0.5);
    for (let k = 0; k <= N; k++) { pos.push(...ringPt(z, k)); uv.push(cu, 0.5); }
    for (let k = 0; k <= N; k++) {
      const p = c0 + 1 + k, q = c0 + 1 + ((k + 1) % (N + 1));
      if (front) idx.push(c0, p, q); else idx.push(c0, q, p);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // 바닥 닿기 계산용 껍질 점: 양 끝과 둥글기가 끝나는 곳의 단면
  const hull = [];
  for (const j of [0, D.length - 1, D.length, zs.length - 1]) for (let k = 0; k <= N; k += 2) hull.push(...ringPt(zs[j], k));
  geo.userData.hull = new Float32Array(hull);
  return geo;
}

/* ---------------- 텍스처 ---------------- */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, aniso, color = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/** 붓으로 그은 듯 가운데가 두꺼운 획 */
function brush(g, x0, y0, x1, y1, w, rng) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, L = [], R = [];
  const bend = (rng() - 0.5) * 3;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, hw = w * 0.5 * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (1 + (rng() - 0.5) * 0.12);
    const b = Math.sin(Math.PI * t) * bend, x = x0 + dx * t + nx * b, y = y0 + dy * t + ny * b;
    L.push([x + nx * hw, y + ny * hw]); R.push([x - nx * hw, y - ny * hw]);
  }
  g.beginPath(); L.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  R.reverse().forEach(([x, y]) => g.lineTo(x, y)); g.closePath(); g.fill();
}
/** 배(평평한 면): 밝은 나무, 결, 먹으로 그은 X 셋. mark면 가운데 X 대신 붉은 '빽' 도장(markRot만큼 돌림) */
function flatCanvas(rng, mark, markRot) {
  const W = 128, H = 512, [c, g] = makeCanvas(W, H);
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#C39058'); gr.addColorStop(0.14, '#E0BA80'); gr.addColorStop(0.5, '#EDCF9C');
  gr.addColorStop(0.86, '#E0BA80'); gr.addColorStop(1, '#C39058');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 20; i++) {
    const x = rng() * W, amp = 1.5 + rng() * 3, ph = rng() * 6;
    g.strokeStyle = `rgba(150,96,44,${0.07 + rng() * 0.13})`; g.lineWidth = 0.6 + rng() * 1.5;
    g.beginPath(); g.moveTo(x, -8);
    for (let y = 0; y <= H + 16; y += 16) g.lineTo(x + Math.sin(y / 70 + ph) * amp, y);
    g.stroke();
  }
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(120,70,30,${0.1 + rng() * 0.15})`; g.fillRect(rng() * W, rng() * H, 1, 2 + rng() * 5); }
  const ge = g.createLinearGradient(0, 0, 0, H);   // 손때 묻은 양 끝
  ge.addColorStop(0, 'rgba(110,62,24,.32)'); ge.addColorStop(0.07, 'rgba(110,62,24,0)');
  ge.addColorStop(0.93, 'rgba(110,62,24,0)'); ge.addColorStop(1, 'rgba(110,62,24,.32)');
  g.fillStyle = ge; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(38,22,10,0.93)';
  [0.2, 0.5, 0.8].forEach((k, n) => {
    if (mark && n === 1) return;
    const x = W / 2, y = k * H, s = 25;
    brush(g, x - s, y - s * 1.05, x + s, y + s * 1.05, 10, rng);
    brush(g, x + s, y - s * 1.05, x - s, y + s * 1.05, 10, rng);
  });
  if (mark) {
    const size = 80, r = size / 2;
    g.save(); g.translate(W / 2, H / 2); g.rotate(markRot - 0.08);
    g.fillStyle = '#C62E26'; rrect(g, -r, -r, size, size, 14); g.fill();
    g.strokeStyle = 'rgba(255,238,220,0.9)'; g.lineWidth = 3; rrect(g, -r + 6, -r + 6, size - 12, size - 12, 9); g.stroke();
    g.fillStyle = '#FFF4E6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 50px "Black Han Sans","Jua","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
    g.fillText('빽', 0, 3);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(236,196,150,${0.25 + rng() * 0.35})`; g.fillRect(-r + rng() * size, -r + rng() * size, 1 + rng() * 2, 1 + rng() * 2); }
    g.restore();
  }
  return c;
}
/** 등(둥근 면): 짙은 나무, 긴 결과 옹이 하나 */
function backCanvas(rng) {
  const W = 128, H = 512, [c, g] = makeCanvas(W, H);
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#6E3F1E'); gr.addColorStop(0.5, '#935A2E'); gr.addColorStop(1, '#6E3F1E');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 34; i++) {
    const x = rng() * W, amp = 1 + rng() * 4, ph = rng() * 6, dark = rng() < 0.7;
    g.strokeStyle = dark ? `rgba(60,30,12,${0.12 + rng() * 0.2})` : `rgba(200,140,80,${0.08 + rng() * 0.12})`;
    g.lineWidth = 0.7 + rng() * 2;
    g.beginPath(); g.moveTo(x, -8);
    for (let y = 0; y <= H + 16; y += 16) g.lineTo(x + Math.sin(y / 60 + ph) * amp, y);
    g.stroke();
  }
  const kx = 30 + rng() * 68, ky = 110 + rng() * 290;   // 옹이
  for (let r = 11; r > 1; r -= 2.5) {
    g.strokeStyle = `rgba(55,26,10,${0.18 + (11 - r) * 0.04})`; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(kx, ky, r * 0.7, r * 1.8, 0, 0, TAU); g.stroke();
  }
  const ge = g.createLinearGradient(0, 0, 0, H);
  ge.addColorStop(0, 'rgba(40,18,6,.45)'); ge.addColorStop(0.06, 'rgba(40,18,6,0)');
  ge.addColorStop(0.94, 'rgba(40,18,6,0)'); ge.addColorStop(1, 'rgba(40,18,6,.45)');
  g.fillStyle = ge; g.fillRect(0, 0, W, H);
  return c;
}
/** 가락 한 개의 텍스처 한 장: 등 | 배 | 마구리. 칸 사이 틈은 가장자리 색을 늘려 칠해 밉맵 번짐을 막는다 */
function atlasCanvas(back, flat) {
  const [c, g] = makeCanvas(AT_W, AT_H);
  g.drawImage(back, U_BACK, 0);
  g.drawImage(back, 127, 0, 1, AT_H, 128, 0, 4, AT_H);
  g.drawImage(flat, 0, 0, 1, AT_H, 132, 0, 4, AT_H);
  g.drawImage(flat, U_FLAT, 0);
  g.drawImage(flat, 127, 0, 1, AT_H, 264, 0, 8, AT_H);
  g.fillStyle = '#C4935C'; g.fillRect(272, 0, AT_W - 272, AT_H);
  return c;
}
/** 거칠기 칸(모든 가락이 함께 씀, 초록 값): 등 0.5 · 배 0.64 · 마구리 0.75 */
function roughCanvas() {
  const [c, g] = makeCanvas(AT_W, 4);
  const gray = r => { const v = Math.round(r * 255); return `rgb(${v},${v},${v})`; };
  g.fillStyle = gray(0.5); g.fillRect(0, 0, 132, 4);
  g.fillStyle = gray(0.64); g.fillRect(132, 0, 140, 4);
  g.fillStyle = gray(0.75); g.fillRect(272, 0, AT_W - 272, 4);
  return c;
}
/** 짚 헤링본(ㅅ자 엮음): 색과 요철 한 쌍. 가로·세로로 이어 붙여도 이음새가 없다 */
function strawCanvases(rng) {
  const S = 512, COL = 64, P = 16, ROWS = S / P, SLOPE = 0.8;
  const [cc, g] = makeCanvas(S, S), [bc, b] = makeCanvas(S, S);
  g.fillStyle = '#6B4A1E'; g.fillRect(0, 0, S, S);
  b.fillStyle = '#000'; b.fillRect(0, 0, S, S);
  const tones = ['#D9B468', '#CDA658', '#E4C47E', '#C79C4C', '#DDBA70', '#D2AE60', '#C9A864'];
  for (let col = 0; col < S / COL; col++) {
    const x0 = col * COL, dir = col % 2 ? 1 : -1;
    const strand = Array.from({ length: ROWS }, () => ({ tone: tones[Math.floor(rng() * tones.length)], f: rng(), w: 0.66 + rng() * 0.08 }));
    for (const c2 of [g, b]) { c2.save(); c2.beginPath(); c2.rect(x0 + 1.5, 0, COL - 3, S); c2.clip(); c2.lineCap = 'round'; }
    for (let k = -5; k < ROWS + 5; k++) {
      const st = strand[((k % ROWS) + ROWS) % ROWS];
      const ya = k * P, xa = x0 - 6, xb = x0 + COL + 6, yb = ya + dir * (COL + 12) * SLOPE;
      const line = (c2, off, w, style) => { c2.strokeStyle = style; c2.lineWidth = w; c2.beginPath(); c2.moveTo(xa, ya + off); c2.lineTo(xb, yb + off); c2.stroke(); };
      line(g, 0, P * st.w, st.tone);
      line(g, -P * 0.2, P * 0.2, 'rgba(255,244,205,0.38)');
      line(g, P * 0.27, P * 0.12, 'rgba(95,62,20,0.35)');
      line(g, -P * 0.05 + st.f * 3, 0.8, 'rgba(255,255,240,0.18)');
      line(b, 0, P * st.w, '#8a8a8a');
      line(b, -P * 0.06, P * 0.34, '#e0e0e0');
    }
    for (const c2 of [g, b]) c2.restore();
    g.fillStyle = 'rgba(70,44,14,0.6)'; g.fillRect(x0 - 1.5, 0, 3, S);   // 날줄(세로 끈)
  }
  return [cc, bc];
}
/** 테두리 천 윗면(멍석 전체 크기에 맞춘 한 장): 검붉은 무명과 금빛 바느질 두 줄 */
function bandCanvas(rng) {
  const W = 1024, H = Math.round(W * MAT_D / MAT_W), [c, g] = makeCanvas(W, H), ppu = W / MAT_W;
  g.fillStyle = '#6A281D'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3200; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,215,185,0.06)' : 'rgba(25,4,0,0.1)';
    if (rng() < 0.5) g.fillRect(rng() * W, rng() * H, 2 + rng() * 6, 1); else g.fillRect(rng() * W, rng() * H, 1, 2 + rng() * 6);
  }
  g.strokeStyle = '#E2B865'; g.lineWidth = 2.6; g.setLineDash([10, 7]);
  for (const inset of [0.075, BAND - 0.065]) {
    const p = inset * ppu; rrect(g, p, p, W - 2 * p, H - 2 * p, Math.max(0.05, 0.28 - inset) * ppu); g.stroke();
  }
  return c;
}

/* ---------------- 멍석 ---------------- */
function rrShape(p, w, h, r) {
  const x = -w / 2, y = -h / 2;
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x + w, y + h - r); p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  p.lineTo(x + r, y + h); p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x, y + r); p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}
function buildMat(aniso, rng, bag) {
  const group = new THREE.Group(); group.name = 'yut-mat';
  const TILE = 1.9;   // 짚 무늬 한 장이 덮는 월드 길이
  const [sc, bc] = strawCanvases(rng);
  const map = toTex(sc, aniso), bump = toTex(bc, aniso, false);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / TILE, 1 / TILE); }
  const iw = MAT_W - 2 * BAND, ih = MAT_D - 2 * BAND;
  const strawGeo = new THREE.ShapeGeometry(rrShape(new THREE.Shape(), iw, ih, 0.13), 6);
  strawGeo.rotateX(-Math.PI / 2); strawGeo.translate(0, STRAW_Y, 0);
  const strawMat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.2, roughness: 0.93 });
  const straw = new THREE.Mesh(strawGeo, strawMat);
  straw.receiveShadow = true;
  const outer = rrShape(new THREE.Shape(), MAT_W - 0.04, MAT_D - 0.04, 0.28);
  outer.holes.push(rrShape(new THREE.Path(), iw + 0.04, ih + 0.04, 0.15));
  const bandGeo = new THREE.ExtrudeGeometry(outer, { depth: MAT_H - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  bandGeo.rotateX(-Math.PI / 2); bandGeo.translate(0, 0.02, 0);
  const bandTex = toTex(bandCanvas(rng), aniso);
  bandTex.repeat.set(1 / MAT_W, 1 / MAT_D); bandTex.offset.set(0.5, 0.5);
  const bandTop = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.88 });
  const bandSide = new THREE.MeshStandardMaterial({ color: 0x5A2118, roughness: 0.9 });
  const band = new THREE.Mesh(bandGeo, [bandTop, bandSide]);
  band.receiveShadow = true;
  group.add(straw, band);
  bag.push(strawGeo, strawMat, map, bump, bandGeo, bandTex, bandTop, bandSide);
  return group;
}

/** 방향(side)별 멍석 영역 — 카메라 맞춤용. 낙 자리까지 넣는다 */
function matBox(side) {
  const p = PLACE[side], hd = MAT_D / 2 + 0.05, hl = OUT_X + 0.75;
  return side === 'right'
    ? { x0: p.x - hd, x1: p.x + hd, z0: p.z - hl, z1: p.z + hl, y1: 0.6 }
    : { x0: p.x - hl, x1: p.x + hl, z0: p.z - hd, z1: p.z + hd, y1: 0.6 };
}

/** 낙 가락 번호 정리: 0~3 정수(문자 '2'도)만, 나머지는 -1 */
function normOut(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 4 ? n : -1;
}

/* ======================================================================
 * createYut(ctx, { sfx, fx })
 * sfx(name, params): 효과음. 돌려준 함수는 북(drumroll)을 도중에 끌 때 부른다.
 * fx: createFx 결과(있으면 멍석 윗면 높이를 fx.setFloor로 알려 준다)
 * ====================================================================== */
export function createYut(ctx, opts = {}) {
  const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
  const rng = mulberry(20260217);
  const KEY = {};          // 트윈 취소 키
  let gen = 0;             // 세대 표시: 새 던지기·정리가 오면 이전 연출은 조용히 멈춘다
  let side = ctx.matSide === 'right' ? 'right' : 'bottom';
  let backdoOn = false;
  let stopDrum = null;     // 울리는 중인 북을 끄는 함수(audio.play가 돌려줌)
  const bag = [];
  const stats = { ms: 0, snapErr: 0, suspense: -1, drumMs: 0, drumAt: -1, clash: 0, gatherClash: 0, clashAt: null, tries: 0, planMs: 0, timeline: null };

  let lastClack = 0, lastVol = 0;
  /** 효과음. opts.sfx가 돌려준 값(예: 북 끄기 함수)을 그대로 돌려준다 */
  function sfx(name, params) {
    if (!opts.sfx) return null;
    if (name === 'stickLand') {   // 여러 가락이 동시에 닿으면 한 번만(큰 소리 우선)
      const now = performance.now();
      if (now - lastClack < 28 && params.vol <= lastVol) return null;
      lastClack = now; lastVol = params.vol;
    }
    try { return opts.sfx(name, params); } catch (e) { setTimeout(() => { throw e; }); return null; }
  }

  const rig = new THREE.Group(); rig.name = 'yut-rig';
  ctx.world.add(rig);
  const matGroup = buildMat(aniso, rng, bag);
  rig.add(matGroup);

  const geo = stickGeometry();
  const HULL = geo.userData.hull;
  const roughTex = toTex(roughCanvas(), 1, false);
  const seeds = [11, 23, 37, 51];
  const atlas = (s, mark, rot) => toTex(atlasCanvas(backCanvas(mulberry(s * 7 + 3)), flatCanvas(mulberry(s), mark, rot)), aniso);
  const plainTex = seeds.map(s => atlas(s, false, 0));
  // '빽' 글자가 화면에서 바로 서 보이도록 멍석 방향마다 돌린 판을 따로 둔다(0번 가락)
  const backdoTex = { bottom: atlas(seeds[0], true, Math.PI), right: atlas(seeds[0], true, Math.PI / 2) };
  const sticks = seeds.map((s, i) => {
    const mat = new THREE.MeshStandardMaterial({ map: plainTex[i], roughnessMap: roughTex, roughness: 1 });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'yut-stick-' + i;
    m.rotation.order = 'YXZ';
    m.castShadow = true; m.receiveShadow = true;
    rig.add(m);
    bag.push(mat);
    return m;
  });
  bag.push(geo, roughTex, ...plainTex, backdoTex.bottom, backdoTex.right);

  /* ---------------- 자세 ---------------- */
  const state = sticks.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }));
  const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();
  /** 이 기울기(pitch)·굴림(roll)에서 중심 아래로 가장 낮은 점까지 높이 */
  function lowest(pitch, roll) {
    _e.set(pitch, 0, roll); _m.makeRotationFromEuler(_e);
    const el = _m.elements;
    let mn = Infinity;
    for (let k = 0; k < HULL.length; k += 3) { const y = el[1] * HULL[k] + el[5] * HULL[k + 1] + el[9] * HULL[k + 2]; if (y < mn) mn = y; }
    return -mn;
  }
  function apply(i, P) {
    const m = sticks[i], s = state[i];
    m.position.set(P.x, P.y, P.z); m.rotation.set(P.pitch, P.yaw, P.roll);
    s.x = P.x; s.y = P.y; s.z = P.z; s.yaw = P.yaw; s.pitch = P.pitch; s.roll = P.roll;
  }
  /** 멈춘 자세(F: {x,z,yaw,base,rest}) */
  function finalPose(F, P) {
    P.x = F.x; P.z = F.z; P.yaw = F.yaw; P.pitch = 0; P.roll = F.rest;
    P.y = F.base + (F.rest === 0 ? B : 0) + LIFT;
    return P;
  }

  /* ---------------- 멈출 자리 고르기 ---------------- */
  /** 던지는 방향(손 → 멍석 안쪽) */
  const throwDir = () => (side === 'right' ? [-1, 0] : [0, -1]);
  function outPose(sgn, flat, dir) {
    return { x: sgn * OUT_X, z: jit(0.3), yaw: jit(0.3), base: FLOOR_Y, rest: flat ? 0 : dir * Math.PI };
  }
  /** 가지런한 자리. order[k] = 왼쪽(−x)부터 k번째 자리의 가락 */
  function tidyPoses(flats, out, order = [0, 1, 2, 3]) {
    return flats.map((f, i) => {
      const slot = order.indexOf(i);
      return i === out ? outPose(slot < 2 ? -1 : 1, f, 1)
        : { x: (slot - 1.5) * 1.45 + jit(0.05), z: jit(0.05), yaw: jit(0.06), base: STRAW_Y, rest: f ? 0 : Math.PI };
    });
  }
  /**
   * 던진 뒤 흩어진 자리와 튀는 길이(bn). 멈춘 자리끼리는 0.68, 튀며 지나는 자리(유령)와는 0.62 넘게 떨어뜨린다.
   * 유령 종류: 0 멈춘 자리, 1 튀는 길(다른 가락이 튀는 동안), 2 조마조마 흔들기(다른 가락이 다 멈춘 뒤) —
   * 같은 때 있을 수 없는 1과 2는 서로 보지 않는다.
   * 반환: { F:[4], sus } — 못 찾으면 가지런한 자리에 조마조마 없이
   */
  function sampleThrow(flats, out, outSgn, sus, dirs, K, order) {
    const lat = side === 'right' ? 0.6 : 1, [hx, hz] = throwDir();
    for (let tries = 0; tries < 200; tries++) {
      const F = [], ghosts = [];
      let ok = true;
      for (let i = 0; i < 4 && ok; i++) {
        if (i === out) { F[i] = outPose(outSgn, flats[i], dirs[i]); ghosts[i] = []; continue; }
        const slot = order.indexOf(i);
        const f = { x: (slot - 1.5) * 1.62 + jit(0.34), z: jit(0.13), yaw: jit(0.42), base: STRAW_Y, rest: flats[i] ? 0 : dirs[i] * Math.PI };
        // 튀는 길이: 가로 화면에서는 손 → 멍석 방향이 가락 옆쪽이라 덜 튄다
        f.bn = { sl: rnd(0.06, 0.16) * lat, b2: rnd(0.15, 0.28) * lat, b1: rnd(0.35, 0.62) * lat, j1: jit(0.12), j2: jit(0.06), back: rnd(0.3, 0.42) * lat };
        const g = [{ s: footprint(f.x, f.z, f.yaw), k: 0 }];
        ok = insideMat(f.x, f.z, f.yaw);
        if (i === sus) {
          const [px, pz] = perpOf(f.yaw), C = susCenter(f, dirs[i], flats[i]);
          for (const th of [K.p1, K.p2, K.p3]) {
            const dx = backRollPose(th)[0], gx = C.x + px * dx, gz = C.z + pz * dx;
            ok = ok && insideMat(gx, gz, f.yaw);
            g.push({ s: footprint(gx, gz, f.yaw), k: 2 });
          }
          const d0 = backRollPose(K.p0)[0], lx = C.x + px * d0, lz = C.z + pz * d0;
          for (const k of [0, 0.5, 1]) g.push({ s: footprint(lx - hx * f.bn.back * k, lz - hz * f.bn.back * k, f.yaw), k: 1 });
        } else {
          const reach = f.bn.sl + f.bn.b2 + f.bn.b1 * 1.15;
          for (const k of [0.34, 0.67, 1]) g.push({ s: footprint(f.x - hx * reach * k, f.z - hz * reach * k, f.yaw), k: 1 });
        }
        F[i] = f; ghosts[i] = g;
      }
      for (let i = 0; i < 4 && ok; i++) {
        for (let j = i + 1; j < 4 && ok; j++) {
          for (const a of ghosts[i]) for (const b of ghosts[j]) {
            if (a.k + b.k === 3) continue;   // 튀는 길 × 흔들기: 같은 때가 아니다
            if (segDist(a.s, b.s) < (a.k || b.k ? 0.62 : 0.68)) { ok = false; break; }
          }
        }
      }
      if (ok) return { F, sus };
    }
    const F = tidyPoses(flats, out, order);
    F.forEach((f, i) => { if (i === out) { f.x = outSgn * OUT_X; if (!flats[i]) f.rest = dirs[i] * Math.PI; } else { if (!flats[i]) f.rest = dirs[i] * Math.PI; f.bn = { sl: 0.05, b2: 0.12, b1: 0.2, j1: 0, j2: 0, back: 0.2 }; } });
    return { F, sus: -1 };
  }
  /** 조마조마 가락이 흔들릴 때의 중심: 넘어가면(배 아래) 옆으로 구른 만큼 앞에서 시작한다 */
  function susCenter(f, dir, flat) {
    if (flat) return { x: f.x, z: f.z };
    const [px, pz] = perpOf(f.yaw), d = backRollPose(dir * Math.PI)[0];
    return { x: f.x - px * d, z: f.z - pz * d };
  }
  /** 결과를 가르는 가락: 빽도는 빽 가락, 걸은 엎어진 가락(윷이 될 뻔!), 도는 젖혀진 가락(모가 될 뻔!) */
  function pickSuspense(flats) {
    const n = flats.filter(Boolean).length;
    if (n === 1 && flats[0] && backdoOn) return 0;
    if (n === 3) return flats.indexOf(false);
    if (n === 1) return flats.indexOf(true);
    return Math.floor(Math.random() * 4);
  }

  /* ---------------- 궤적 조각 ---------------- */
  function landingPose(F, thetaL, slide, yawSlide) {
    const yaw = F.yaw - yawSlide, [dx] = surf(thetaL, F.rest), [px, pz] = perpOf(yaw);
    return { x: F.x - slide.x + px * dx, z: F.z - slide.z + pz * dx, yaw };
  }
  /** 바닥에 닿은 뒤 흔들리며 멈추기(끝에서 정확히 F) */
  function settlePhase(t0, dur, F, thetaL, slide, yawSlide, lam, om) {
    return {
      t0, t1: t0 + dur,
      f(t, P) {
        const tau = clamp(t - t0, 0, dur), w = 1 - tau / dur;
        const th = F.rest + (thetaL - F.rest) * Math.exp(-lam * tau) * Math.cos(om * tau) * w;
        const s = 1 - ease.outCubic(Math.min(1, tau / (dur * 0.7)));
        const yaw = F.yaw - yawSlide * s, [dx, y] = surf(th, F.rest), [px, pz] = perpOf(yaw);
        P.x = F.x - slide.x * s + px * dx; P.z = F.z - slide.z * s + pz * dx;
        P.y = F.base + y + LIFT; P.yaw = yaw; P.pitch = 0; P.roll = th;
      },
    };
  }
  /**
   * 공중 구간들. start 자세에서 segs[k].to 로 차례로 튀고, 마지막에 end({yaw, roll}, pitch 0)로 닿는다.
   * 방향(yaw) 돌기는 첫 착지 전에 끝낸다 — 튀는 동안은 제 줄에 나란히 있어 이웃 가락을 가로지르지 않는다.
   * 손을 떠날 때는 이웃과 나란히(천천히 돌기 시작), 비틀기(twirl)는 한 번 던질 때 네 가락이 거의 같이 한다.
   * 굴림은 spin.dir 방향으로 spin.turns 바퀴 안팎, 구간마다 spin.rates 비율로 느려진다.
   */
  function airPhases(tA, start, segs, end, spin) {
    let yLow = start.y - LIFT - lowest(start.pitch, start.roll), t = tA, from = { x: start.x, z: start.z };
    const parts = [], times = [tA];
    for (const s of segs) {
      const bal = ballistic(yLow, s.base, s.top, s.g);
      parts.push({ t0: t, t1: t + bal.T, bal, from, to: s.to });
      t += bal.T; times.push(t); yLow = s.base; from = s.to;
    }
    const tB = t, span = tB - tA, span1 = times[1] - tA;
    let d = end.roll - start.roll;
    d += Math.round((spin.dir * spin.turns * TAU - d) / TAU) * TAU;
    const w = parts.map((p, j) => (spin.rates[j] ?? 0.3) * (p.t1 - p.t0)), W = w.reduce((a, b) => a + b, 0) || 1;
    const rollAt = tt => {
      let acc = 0;
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j];
        if (tt <= p.t1 || j === parts.length - 1) return start.roll + d * (acc + w[j] * clamp((tt - p.t0) / (p.t1 - p.t0), 0, 1)) / W;
        acc += w[j];
      }
      return end.roll;
    };
    const phases = parts.map(p => ({
      t0: p.t0, t1: p.t1,
      f(tt, P) {
        const u = clamp((tt - p.t0) / (p.t1 - p.t0), 0, 1), U = clamp((tt - tA) / span, 0, 1), U1 = clamp((tt - tA) / span1, 0, 1);
        P.x = lerp(p.from.x, p.to.x, u); P.z = lerp(p.from.z, p.to.z, u);
        const sw = Math.sin(Math.PI * U1);
        P.yaw = lerp(start.yaw, end.yaw, ease.inOutSine(U1)) + spin.twirl * sw * sw;   // 손을 떠날 때는 천천히 돌기 시작
        P.pitch = start.pitch * (1 - U) * (1 - U) + spin.pitch * Math.sin(Math.PI * U * spin.waves) * (1 - U);
        P.roll = rollAt(tt);
        P.y = p.bal.y(tt - p.t0) + lowest(P.pitch, P.roll) + LIFT;
      },
    }));
    return { phases, tB, impacts: times.slice(1) };
  }

  /** 멍석 안쪽(중심 기준)으로 자르기 */
  const inMat = p => ({ x: clamp(p.x, -IN_X + 0.35, IN_X - 0.35), z: clamp(p.z, -IN_Z + 0.2, IN_Z - 0.2) });

  /** 멈춤 구간에서 끝 자세와 눈에 띄게(0.012 / 0.024rad) 다른 마지막 때 */
  function visibleSettle(F, st) {
    const P = {}, Q = finalPose(F, {});
    let last = st.t0;
    for (let t = st.t0; t <= st.t1 + 1e-9; t += 1 / 240) {
      st.f(t, P);
      if (Math.hypot(P.x - Q.x, P.y - Q.y, P.z - Q.z) > 0.012 || Math.abs(P.yaw - Q.yaw) + Math.abs(P.pitch) + Math.abs(P.roll - Q.roll) > 0.024) last = t;
    }
    return last;
  }

  /* ---------------- 던지기 계획 ---------------- */
  /**
   * 손: 멍석의 카메라 쪽 가장자리 위. 네 가락을 멍석에 누울 때와 같은 방향(짧은 변 쪽)으로 나란히 쥔다 —
   * 손의 줄이 그대로 멍석 위 자리 줄로 벌어지므로 날아가는 동안 서로 가로지르지 않는다.
   */
  function makeHand() {
    return side === 'right'
      ? { x: 3.95, y: 1.4, z: 0.12 + jit(0.15), dx: -1, dz: 0, lx: 0, lz: 1, yaw: jit(0.12) }   // 판 쪽으로 살짝(화면 오른쪽 끝에서 멀게)
      : { x: jit(0.3), y: 1.4, z: 1.9, dx: 0, dz: -1, lx: 1, lz: 0, yaw: jit(0.12) };
  }
  /** 모으기(0~TG) + 손에 쥐고 있기(TG~tA). 순서가 뒤로 바뀌는 가락은 H.arc만큼 높이 넘어간다 */
  function gatherPhases(i, H, tA) {
    const S = { ...state[i] }, arc = H.arc ?? 0.35;
    return [{
      t0: 0, t1: TG,
      f(t, P) {
        const u = clamp(t / TG, 0, 1), e = ease.inOutSine(u);
        const sn = Math.sin(Math.PI * u), lift = arc > 0.35 ? Math.sqrt(sn) : sn;   // 넘어가는 가락은 꼭대기를 넓게
        P.x = lerp(S.x, H.x, e); P.z = lerp(S.z, H.z, e); P.y = lerp(S.y, H.y, e) + arc * lift;
        const e2 = ease.outCubic(u);   // 먼저 나란히 돌려 놓고 모은다
        P.yaw = lerp(S.yaw, H.yaw, e2); P.pitch = lerp(S.pitch, H.pitch, e2); P.roll = S.roll;
      },
    }, { t0: TG, t1: tA, f(t, P) { P.x = H.x; P.y = H.y; P.z = H.z; P.yaw = H.yaw; P.pitch = H.pitch; P.roll = H.roll; } }];
  }
  let twirl0 = 0;   // 이번 던지기의 공통 비틀기
  const spinOf = (dir, pw) => {
    const rm = reducedMotion;
    return { dir, turns: rm ? 1 : 2 + (Math.random() < 0.3 + 0.45 * pw ? 1 : 0), rates: [1, 0.5, 0.28], pitch: rm ? 0.08 : jit(0.5), waves: Math.random() < 0.5 ? 1 : 2, twirl: rm ? 0 : twirl0 + jit(0.08) };
  };

  /** 보통 가락: 날아가 한두 번 튀고 등으로 흔들리다 멈춘다. lvl이 클수록 짧게(덜 튀고 낮게) */
  function planPlain(i, F, flat, dir, H, hand, pw, flyBase, lvl, tA) {
    const rm = reducedMotion, bn = F.bn;
    const nb = rm || lvl >= 1 ? 1 : (Math.random() < 0.45 + 0.3 * pw ? 2 : 1);
    const thetaL = F.rest - dir * (flat ? rnd(0.24, 0.34) : rnd(0.07, 0.12));
    const slide = { x: hand.dx * bn.sl, z: hand.dz * bn.sl }, yawSlide = jit(0.1);
    const L = landingPose(F, thetaL, slide, yawSlide);
    const b1 = bn.b1 * (0.85 + 0.3 * pw) * (lvl >= 2 ? 0.7 : 1);
    const I2 = nb === 2 ? inMat({ x: L.x - hand.dx * bn.b2 + hand.lx * bn.j2, z: L.z - hand.dz * bn.b2 + hand.lz * bn.j2 }) : null;
    const P1 = I2 || L;
    const I1 = inMat({ x: P1.x - hand.dx * b1 + hand.lx * bn.j1, z: P1.z - hand.dz * b1 + hand.lz * bn.j1 });
    const h1 = (rm ? 0.2 : rnd(0.32, 0.46) + 0.18 * pw) * [1, 0.75, 0.5, 0.3][lvl];
    const top = Math.max(2.3, flyBase - [0, 0, 0.45, 0.9][lvl] + jit(0.18));
    const segs = [{ to: I1, base: F.base, top, g: G_FLY }];
    if (nb === 2) segs.push({ to: I2, base: F.base, top: F.base + h1, g: G_HOP }, { to: L, base: F.base, top: F.base + rnd(0.1, 0.15), g: G_HOP });
    else segs.push({ to: L, base: F.base, top: F.base + h1 * 0.85, g: G_HOP });
    const air = airPhases(tA, H, segs, { yaw: L.yaw, roll: thetaL }, spinOf(dir, pw));
    const st = settlePhase(air.tB, flat ? rnd(0.27, 0.31) : rnd(0.19, 0.23), F, thetaL, slide, yawSlide, flat ? 6.5 : 12, TAU * (flat ? 3.4 : 7));
    const vols = [0.55 + 0.35 * pw, 0.45, 0.25];
    return {
      phases: [...gatherPhases(i, H, tA), ...air.phases, st],
      events: air.impacts.map((t, k) => ({ t, name: 'stickLand', vol: vols[k] ?? 0.25 })),
      F, tEnd: st.t1, first: air.impacts[0], last: air.tB, still: visibleSettle(F, st),
    };
  }

  /** 낙: 멍석 끝에 맞고 튀어 나가 바닥에 떨어진다 */
  function planOut(i, F, flat, dir, H, pw, flyBase, tA) {
    const sgn = Math.sign(F.x) || 1, thetaL = F.rest - dir * (flat ? rnd(0.26, 0.36) : rnd(0.07, 0.12));
    const slide = { x: sgn * rnd(0.12, 0.22), z: 0 }, yawSlide = jit(0.15);
    const L = landingPose(F, thetaL, slide, yawSlide);
    const I2 = { x: L.x - sgn * rnd(0.3, 0.42), z: L.z + jit(0.1) };
    const I1 = { x: sgn * rnd(2.5, 3.0), z: clamp(F.z * 0.5 + jit(0.3), -1.0, 1.0) };
    const air = airPhases(tA, H, [
      { to: I1, base: STRAW_Y, top: flyBase + jit(0.18), g: G_FLY },
      { to: I2, base: FLOOR_Y, top: STRAW_Y + 0.8, g: G_HOP },
      { to: L, base: FLOOR_Y, top: FLOOR_Y + 0.14, g: G_HOP },
    ], { yaw: L.yaw, roll: thetaL }, { ...spinOf(dir, pw), rates: [1, 0.7, 0.3] });
    const st = settlePhase(air.tB, flat ? 0.36 : 0.22, F, thetaL, slide, yawSlide, flat ? 5 : 12, TAU * (flat ? 3.4 : 7));
    const vols = [0.8, 0.65, 0.3];
    return {
      phases: [...gatherPhases(i, H, tA), ...air.phases, st],
      events: air.impacts.map((t, k) => ({ t, name: 'stickLand', vol: vols[k] })),
      F, tEnd: st.t1, first: air.impacts[0], last: air.tB, still: visibleSettle(F, st),
    };
  }

  /**
   * 조마조마 가락: 가장 높이 던져져 다른 가락이 다 멈춘 때(tGo)에 마지막으로 내려앉는다.
   * 비행 높이와 튀기 높이를 풀어 닿는 때를 맞추고, 닿자마자 혼자 크게 흔들린다(북은 이때부터).
   */
  function planSuspense(i, F, flat, dir, H, hand, K, pw, flyBase, tGo, tFirst, resolve, tA) {
    const rm = reducedMotion, bn = F.bn;
    const C = susCenter(F, dir, flat), [px, pz] = perpOf(F.yaw);
    const dx0 = backRollPose(K.p0)[0], L = { x: C.x + px * dx0, z: C.z + pz * dx0 };
    const yLow = H.y - LIFT - lowest(H.pitch, H.roll);
    const flyT = top => ballistic(yLow, F.base, top, G_FLY).T;
    // 첫 착지는 다른 가락들 뒤, 마지막 착지는 tGo 무렵
    // 가로 화면에서는 멍석이 화면 오른쪽 끝이라 너무 높으면(카메라에 가까워) 화면 밖으로 나간다
    const wide = side === 'right';
    const lo = rm ? 2.1 : flyBase + 0.1, hi = rm ? 3.4 : wide ? 4.5 : 6;
    const want = Math.max(tFirst + 0.1 - tA, tGo - tA - (rm ? 0.2 : rnd(0.27, 0.34)));
    let top = lo;
    if (flyT(lo) < want) { let a = lo, b = hi; for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (flyT(m) < want) a = m; else b = m; } top = b; }
    const R = tGo - tA - flyT(top);
    const T2 = rnd(0.11, 0.13), two = !rm && R >= 0.25;
    const hops = two ? [hopH(clamp(R - T2, 0.12, 0.4)), hopH(T2)] : [hopH(clamp(R, 0.12, 0.4))];
    const I2 = two ? inMat({ x: L.x - hand.dx * bn.back * 0.3, z: L.z - hand.dz * bn.back * 0.3 }) : null;
    const I1 = inMat({ x: L.x - hand.dx * bn.back + hand.lx * bn.j2, z: L.z - hand.dz * bn.back + hand.lz * bn.j2 });
    const segs = [{ to: I1, base: F.base, top, g: G_FLY }];
    if (two) segs.push({ to: I2, base: F.base, top: F.base + hops[0], g: G_HOP }, { to: L, base: F.base, top: F.base + hops[1], g: G_HOP });
    else segs.push({ to: L, base: F.base, top: F.base + hops[0], g: G_HOP });
    const spin = spinOf(dir, pw);
    if (wide) spin.pitch *= 0.35;   // 끝이 덜 치솟게
    const air = airPhases(tA, H, segs, { yaw: F.yaw, roll: K.p0 }, { ...spin, rates: [1, 0.4, 0.2] });
    const tL = air.tB;
    const Dr = clamp(Math.min(rnd(0.47, DR_MAX), T_MAX - tL - resolve), DR_MIN, DR_MAX);   // 움직임 줄이기면 SPEED가 알아서 줄인다
    const rock = rockPhase(tL, Dr, F, C, flat, dir, K);
    const vols = two ? [0.8, 0.5, 0.35] : [0.8, 0.45];
    const events = air.impacts.map((t, k) => ({ t, name: 'stickLand', vol: vols[k] }));
    events.push({ t: tL, name: 'drumroll', until: tL + Dr }, { t: rock.tHit, name: 'stickLand', vol: flat ? 0.16 : 0.75 });
    return {
      phases: [...gatherPhases(i, H, tA), ...air.phases, ...rock.phases],
      events, F, tEnd: rock.tEnd, first: air.impacts[0], last: tL, still: rock.tEnd,
    };
  }

  /** 조마조마 흔들기 봉우리: 닿을 때 → 반대로 크게 → 다시 → 모서리 직전(멈칫) */
  function rockKeys(dir) {
    return { p0: -dir * 0.5, p1: dir * 0.95, p2: -dir * 0.72, p3: dir * 1.38 };
  }
  function rockPhase(tL, D, F, C, flat, dir, K) {
    const [px, pz] = perpOf(F.yaw);
    const q = [0.26, 0.27, 0.31, 0.16].map(k => k * D);
    const k1 = tL + q[0], k2 = k1 + q[1], k3 = k2 + q[2], k4 = k3 + q[3];
    const seg = (t, a, b, t0, t1, e) => a + (b - a) * e(clamp((t - t0) / (t1 - t0), 0, 1));
    const thetaRock = t => {
      if (t <= k1) return seg(t, K.p0, K.p1, tL, k1, ease.inOutSine);
      if (t <= k2) return seg(t, K.p1, K.p2, k1, k2, ease.inOutSine);
      if (t <= k3) return seg(t, K.p2, K.p3, k2, k3, ease.outCubic);   // 모서리 쪽으로 천천히
      const tau = t - k3;
      return K.p3 + dir * 0.05 * Math.sin(TAU * 8 * tau) * (1 - tau / q[3]);   // 모서리에서 파르르
    };
    const phases = [];
    const backAt = (P, th) => {
      const [dx, y] = backRollPose(th);
      P.x = C.x + px * dx; P.z = C.z + pz * dx; P.y = F.base + y + LIFT; P.yaw = F.yaw; P.pitch = 0; P.roll = th;
    };
    phases.push({ t0: tL, t1: k4, f(t, P) { backAt(P, thetaRock(t)); } });
    let tHit, tEnd;
    if (!flat) {
      // 넘어간다: 점점 빨라지며 배가 바닥에 탁
      const t5 = k4 + 0.12, t6 = t5 + 0.14;
      phases.push({ t0: k4, t1: t5, f(t, P) { backAt(P, seg(t, K.p3, F.rest, k4, t5, ease.inQuad)); } });
      phases.push({
        t0: t5, t1: t6,
        f(t, P) {
          const u = clamp((t - t5) / (t6 - t5), 0, 1), e = -dir * 0.085 * Math.sin(Math.PI * u) * (1 - u * 0.3);
          const [dx, y] = flatPose(e);
          P.x = F.x + px * dx; P.z = F.z + pz * dx; P.y = F.base + y + LIFT; P.yaw = F.yaw; P.pitch = 0; P.roll = F.rest + e;
        },
      });
      tHit = t5; tEnd = t6;
    } else {
      // 돌아온다: 휴, 반대쪽으로 한 번 흔들리고 멈춘다
      const t5 = k4 + 0.17, t6 = t5 + 0.1, t7 = t6 + 0.08;
      phases.push({
        t0: k4, t1: t7,
        f(t, P) {
          let th;
          if (t <= t5) th = seg(t, K.p3, -dir * 0.4, k4, t5, ease.inOutSine);
          else if (t <= t6) th = seg(t, -dir * 0.4, dir * 0.12, t5, t6, ease.inOutSine);
          else th = seg(t, dir * 0.12, 0, t6, t7, ease.outQuad);
          backAt(P, th);
        },
      });
      tHit = t7; tEnd = t7;
    }
    return { phases, tHit, tEnd };
  }

  /**
   * 한 번 짜 보기. 보통 가락(과 낙 가락)을 먼저 짜고 — 조마조마가 있으면 흔들 시간이 남도록 늦어도 deadline까지
   * 멈추게 줄여 가며 — 그다음 조마조마 가락을 그들이 다 멈춘 때에 맞춘다.
   */
  function planOnce(flats, out, pw, att) {
    const rm = reducedMotion;
    const dirs = flats.map(() => (Math.random() < 0.5 ? 1 : -1));
    let sus = out >= 0 ? -1 : pickSuspense(flats);
    const K = sus >= 0 ? rockKeys(dirs[sus]) : null;
    // 멈출 자리 순서는 지금 놓인 순서를 대체로 지킨다(모으기·비행 길이 엇갈리지 않게). 가끔 이웃 둘만 바꾼다
    const byX = [0, 1, 2, 3].sort((a, b) => state[a].x - state[b].x);
    const order = byX.slice();
    const outSgn = out < 0 ? 0 : byX.indexOf(out) < 2 ? -1 : 1;   // 낙은 가까운 끝으로(줄을 적게 가로지르게)
    if (out >= 0) { order.splice(order.indexOf(out), 1); if (outSgn < 0) order.unshift(out); else order.push(out); }
    else if (att < 16 && Math.random() < 0.35) { const k = Math.floor(Math.random() * 3); [order[k], order[k + 1]] = [order[k + 1], order[k]]; }
    const pick = sampleThrow(flats, out, outSgn, sus, dirs, K, order);
    const Fs = pick.F; sus = pick.sus;
    const hand = makeHand(), [hpx, hpz] = perpOf(hand.yaw);
    twirl0 = jit(0.55);
    // 가로 화면은 조마조마 가락이 너무 높이 못 가므로(화면 밖) 다른 가락을 조금 낮게 던져 높이 차를 남긴다
    const flyBase = rm ? 2.1 : side === 'right' ? 2.6 + 1.0 * pw : 2.9 + 1.1 * pw;
    // 손에는 멈출 자리 순서대로, 가락 폭보다 조금 넓게 한 줄(모두 같은 방향이라 서로 파고들지 않는다).
    // 지금 놓인 순서보다 뒤로 가는 가락은 모을 때 높이 넘어간다
    const Hs = [0, 1, 2, 3].map(i => {
      const k = order.indexOf(i), o = (k - 1.5) * ROW;
      return {
        x: hand.x + hpx * o, y: hand.y + Math.abs(o) * 0.1, z: hand.z + hpz * o, yaw: hand.yaw, pitch: rm ? 0.05 : 0.14, roll: state[i].roll,
        arc: 0.35 + 0.9 * Math.max(0, k - byX.indexOf(i)),
      };
    });
    // 손을 떠나는 때: 가로 화면은 손의 줄이 던지는 방향이라 앞 가락부터 차례로(뒤 가락이 따라잡지 않게)
    const rel = order.map((_, k) => TG + (side === 'right' ? 0.016 * k + rnd(0, 0.006) : rnd(0, 0.05)));
    const tAof = i => rel[order.indexOf(i)];
    const resolve = sus >= 0 ? (flats[sus] ? RES_BACK : RES_FLIP) : 0;
    const deadline = sus >= 0 ? T_MAX - resolve - DR_MIN : T_MAX;
    const plans = [];
    let tGo = 0, tFirst = 0;
    for (let i = 0; i < 4; i++) {
      if (i === sus) continue;
      let pl;
      if (i === out) pl = planOut(i, Fs[i], flats[i], dirs[i], Hs[i], pw, flyBase, tAof(i));
      else {
        for (let lvl = 0; lvl < 4; lvl++) {
          pl = planPlain(i, Fs[i], flats[i], dirs[i], Hs[i], hand, pw, flyBase, lvl, lvl >= 3 ? Math.min(tAof(i), TG + 0.02) : tAof(i));
          if ((sus >= 0 ? Math.max(pl.still, pl.last + 0.1) : pl.tEnd) <= deadline) break;
        }
      }
      plans[i] = pl;
      tGo = Math.max(tGo, pl.still, pl.last + 0.1); tFirst = Math.max(tFirst, pl.first);
    }
    if (sus >= 0) plans[sus] = planSuspense(sus, Fs[sus], flats[sus], dirs[sus], Hs[sus], hand, K, pw, flyBase, tGo, tFirst, resolve, tAof(sus));
    return { plans, sus };
  }

  const clashAt = { t: 0, i: 0, j: 0 };
  /** 두 가락 몸통(긴 축 둘레 반지름 A)이 가장 깊이 겹친 정도. 손에 다 모인 뒤(TG)부터 끝까지 훑는다 */
  function clashOf(plans, t0 = TG, t1 = Infinity) {
    const T = Math.min(t1, Math.max(...plans.map(p => p.tEnd))), P = {}, S = [[], [], [], []];
    let worst = -1;
    for (let t = t0; t <= T + 1e-9; t += 0.008) {
      for (let i = 0; i < 4; i++) axisSeg(poseAt(plans[i], t, P), S[i]);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const c = CLEAR - segDist(S[i], S[j]);
        if (c > worst) { worst = c; clashAt.t = t; clashAt.i = i; clashAt.j = j; }
      }
    }
    return worst;
  }

  /** 던지기 계획: 가락끼리 파고들지 않는 계획이 나올 때까지 다시 짠다(못 찾으면 가장 덜 겹친 것) */
  function planThrow(flats, out, pw) {
    let best = null, att = 0;
    const t0 = performance.now(), wantSus = out < 0;
    for (; att < 30; att++) {
      const p = planOnce(flats, out, pw, att);
      p.clash = clashOf(p.plans);
      p.score = Math.max(0, p.clash) + (wantSus && p.sus < 0 ? 1 : 0);   // 조마조마가 빠지면 벌점
      if (!best || p.score < best.score) best = p;
      if (best.score <= 0) break;
    }
    stats.tries = Math.min(att + 1, 30); stats.planMs = +(performance.now() - t0).toFixed(1);
    stats.suspense = best.sus; stats.clash = Math.max(0, clashOf(best.plans)); stats.clashAt = { ...clashAt, t: Math.round(clashAt.t * 1000) };
    stats.gatherClash = Math.max(0, clashOf(best.plans, 0, TG));
    best.plans[0].events.push({ t: 0, name: 'throwStart', power: pw });
    return best.plans;
  }

  /** 살살: 제자리에서 톡 뛰어 면만 바꾸고 가지런히 눕는다(~0.7초). 놓인 순서는 그대로 */
  function planGentle(flats, out) {
    const byX = [0, 1, 2, 3].sort((a, b) => state[a].x - state[b].x), order = byX.slice();
    if (out >= 0) { const k = byX.indexOf(out); order.splice(k, 1); if (k < 2) order.unshift(out); else order.push(out); }   // 낙은 가까운 끝으로
    const Fs = tidyPoses(flats, out, order), plans = [];
    for (let i = 0; i < 4; i++) {
      const F = Fs[i], flat = flats[i], S = { ...state[i] }, dir = Math.random() < 0.5 ? 1 : -1;
      if (!flat) F.rest = dir * Math.PI;
      const wasFlat = Math.cos(S.roll) > 0, change = wasFlat !== flat;
      const thetaL = F.rest - dir * (flat ? 0.22 : 0.07);
      const slide = { x: 0, z: 0 }, yawSlide = 0;
      const L = landingPose(F, thetaL, slide, yawSlide);
      const over = order.indexOf(i) !== byX.indexOf(i) && i === out;   // 이웃을 넘어 낙 자리로 가면 먼저, 높이
      const tA = over ? 0 : 0.05 + i * 0.04;
      const air = airPhases(tA, S, [{ to: L, base: F.base, top: Math.max(S.y, F.base) + (over ? 1.1 : change ? 0.55 : 0.22), g: G_HOP }],
        { yaw: L.yaw, roll: thetaL }, { dir, turns: 0, rates: [1], pitch: jit(0.12), waves: 1, twirl: 0 });
      const st = settlePhase(air.tB, flat ? 0.26 : 0.14, F, thetaL, slide, yawSlide, flat ? 7 : 14, TAU * (flat ? 3.6 : 7));
      plans.push({ phases: [...air.phases, st], events: [{ t: air.tB, name: 'stickLand', vol: 0.28 }], F, tEnd: st.t1 });
    }
    return plans;
  }

  function poseAt(pl, t, P) {
    const ph = pl.phases;
    if (t <= ph[0].t0) { ph[0].f(ph[0].t0, P); return P; }
    for (const p of ph) if (t <= p.t1) { p.f(t, P); return P; }
    return finalPose(pl.F, P);
  }

  /** 계획을 트윈 하나로 재생. 윷·모면 마지막 0.5초를 느리게. 끝나면 true, 다른 연출에 밀리면 false */
  function run(plans, dramatic) {
    const my = gen;
    const T = Math.max(...plans.map(p => p.tEnd));
    if (!Number.isFinite(T)) {   // 안전망: 계획이 깨졌으면 끝 자세로 바로
      plans.forEach((pl, i) => apply(i, finalPose(pl.F, {})));
      stats.ms = 0; ctx.invalidate();
      return Promise.resolve(true);
    }
    const slow = dramatic && !reducedMotion ? Math.max(0, T - 0.5) : Infinity;
    const toC = r => (r <= slow ? r : slow + (r - slow) * SLOW);
    const toR = c => (c <= slow ? c : slow + (c - slow) / SLOW);
    const realT = toR(T);
    stats.ms = realT * 1000 * SPEED;
    stats.drumMs = 0; stats.drumAt = -1;
    const ms = c => Math.round(toR(c) * 1000 * SPEED);
    // 가락마다 계획된 때(실제 ms): 처음 닿음 · 마지막 닿음 · 눈에 띄게 멈춤 · 끝
    stats.timeline = plans.map(p => (p.first === undefined ? null : { first: ms(p.first), last: ms(p.last), still: ms(p.still), end: ms(p.tEnd) }));
    plans.forEach(p => {
      p.events.sort((a, b) => a.t - b.t); p.fired = 0;
      const dr = p.events.find(e => e.name === 'drumroll');
      if (dr) { stats.drumAt = Math.round(toR(dr.t) * 1000 * SPEED); stats.drumMs = Math.round((toR(dr.until) - toR(dr.t)) * 1000 * SPEED); }
    });
    let punched = !isFinite(slow);
    const P = {};
    return tween(realT * 1000, k => {
      if (my !== gen) return;
      const c = toC(k * realT);
      if (!punched && c >= slow) {
        punched = true;
        // 멍석 쪽으로 잠깐 다가가기. scene.punch가 초점(세 번째 인자)을 모르면 가로 화면에서는
        // 화면 가장자리의 멍석이 밀려나지 않게 조금만 다가간다
        const focused = ctx.punch.length >= 3;
        ctx.punch(focused || side !== 'right' ? 0.15 : 0.05, 700, matCenter());
      }
      plans.forEach((pl, i) => {
        apply(i, poseAt(pl, c, P));
        while (pl.fired < pl.events.length && pl.events[pl.fired].t <= c) {
          const ev = pl.events[pl.fired++];
          if (ev.name === 'drumroll') { const s = sfx('drumroll', { ms: stats.drumMs }); stopDrum = typeof s === 'function' ? s : null; }
          else if (ev.name === 'stickLand') sfx('stickLand', { vol: ev.vol });
          else sfx(ev.name, ev.power != null ? { power: ev.power } : undefined);
        }
      });
      ctx.invalidate();
    }, KEY).then(() => {
      if (my !== gen) return false;
      stopDrum = null;   // 북은 제 길이만큼 울고 끝난다
      // 끝 자세로 딱 맞추기(연출이 이미 거의 같은 곳에서 끝난다 — 그 차이를 stats.snapErr에 남긴다)
      let err = 0;
      const Q = {};
      plans.forEach((pl, i) => {
        const last = pl.phases[pl.phases.length - 1];
        last.f(last.t1, P); finalPose(pl.F, Q);
        const dr = Math.abs(Math.atan2(Math.sin(P.roll - Q.roll), Math.cos(P.roll - Q.roll)));
        err = Math.max(err, Math.hypot(P.x - Q.x, P.y - Q.y, P.z - Q.z), dr, Math.abs(P.yaw - Q.yaw), Math.abs(P.pitch));
        apply(i, Q);
      });
      stats.snapErr = err;
      ctx.invalidate();
      return true;
    });
  }

  /** 진행 중인 연출을 멈춘다(울리던 북도 끈다) */
  function cancel() {
    gen++;
    if (stopDrum) { try { stopDrum(); } catch (e) { /* 무시 */ } stopDrum = null; }
    finishAll(KEY);
  }

  function normFlats(f) { return [0, 1, 2, 3].map(i => !!(f && f[i])); }

  /* ---------------- 공개 API ---------------- */
  function layout(s) {
    side = s === 'right' ? 'right' : 'bottom';
    const p = PLACE[side];
    rig.position.set(p.x, 0, p.z);
    rig.rotation.y = p.rot;
    if (backdoOn) sticks[0].material.map = backdoTex[side];
    ctx.invalidate();
    return matBox(side);
  }

  function rest(flats, out = -1) {
    cancel();
    const f = normFlats(flats), o = normOut(out);
    const P = {};
    tidyPoses(f, o).forEach((F, i) => apply(i, finalPose(F, P)));
    ctx.invalidate();
  }

  function throwYut(o = {}) {
    cancel();
    const flats = normFlats(o.flats), out = normOut(o.out);
    const p = o.power == null ? NaN : Number(o.power), pw = Number.isFinite(p) ? clamp(p, 0, 1) : 0.5;
    stats.suspense = -1; stats.clash = 0; stats.gatherClash = 0; stats.clashAt = null; stats.tries = 0; stats.planMs = 0;
    const plans = o.gentle ? planGentle(flats, out) : planThrow(flats, out, pw);
    return run(plans, !o.gentle && (o.dramatic === 'yut' || o.dramatic === 'mo'));
  }

  function setBackdoMark(on) {
    backdoOn = !!on;
    sticks[0].material.map = backdoOn ? backdoTex[side] : plainTex[0];
    ctx.invalidate();
  }

  function matCenter() { const p = PLACE[side]; return { x: p.x, z: p.z }; }

  /** 월드 (x, z)의 멍석 윗면 높이(짚 또는 테두리 천). 멍석 밖이면 null — 색종이가 내려앉을 높이 */
  function floorAt(x, z) {
    const p = PLACE[side], wx = x - p.x, wz = z - p.z;
    const lx = side === 'right' ? wz : wx, lz = side === 'right' ? -wx : wz;
    if (Math.abs(lx) > MAT_W / 2 || Math.abs(lz) > MAT_D / 2) return null;
    return Math.abs(lx) <= MAT_W / 2 - BAND && Math.abs(lz) <= MAT_D / 2 - BAND ? STRAW_Y : MAT_H + 0.02;
  }

  // 색종이가 멍석 위에 내려앉도록 fx에 바닥 높이를 알려 준다(createYut(ctx, { fx }))
  const fxFloor = opts.fx && typeof opts.fx.setFloor === 'function' ? opts.fx : null;
  if (fxFloor) fxFloor.setFloor(floorAt);

  function dispose() {
    cancel();
    if (fxFloor) fxFloor.setFloor(null);
    rig.removeFromParent();
    bag.forEach(x => x.dispose && x.dispose());
    ctx.invalidate();
  }

  layout(side);
  rest([true, false, true, false], -1);

  return {
    layout, setBackdoMark, matCenter, floorAt, rest, dispose,
    throw: throwYut,
    flickTargets: [matGroup, ...sticks],
    /** 윷가락 메시 4개(읽기 전용으로 쓸 것) */
    sticks,
    /**
     * 마지막 연출 정보(시험·점검용): ms(실제 길이), snapErr, suspense(조마조마 가락), drumAt·drumMs(북 시작·길이, 실제 ms),
     * clash·gatherClash(계획상 몸통 겹침 깊이, 0이면 없음)·clashAt, tries·planMs(계획 짜기 횟수·시간),
     * timeline[i] = { first, last, still, end }(가락별 첫 착지·마지막 착지·눈에 띄게 멈춤·끝, 실제 ms)
     */
    stats,
    get side() { return side; },
  };
}
