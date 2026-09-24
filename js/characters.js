// 말 캐릭터 — 설빔(팀색 저고리) 입은 윷 동물 친구들 8종의 리그·표정·연출.
// 게임은 sync(state)로 자리를 맞추고 move()로 한 수를 연출한다. move()는 게임을 막는 구간이 끝나면 풀리고,
// 남은 장식 연출(decor)은 말마다 토큰으로 따로 돈다.
// 말 하나 = 뼈(Bone) 10개로 움직이는 SkinnedMesh 1개 + 얼굴 스티커 1개. 부품을 한 geometry로 합쳐 그리기 호출을 줄였다.
// 트윈(anim.js)은 리그의 애니메이션 값(rig.a)만 바꾸고, 매 프레임 ticker가 숨쉬기·몸짓과 합쳐 뼈에 옮긴다.
// 숨쉬기·깜빡임은 장면이 실제로 그리는 동안만 흐르는 대기 시계를 쓰고, 60초 동안 아무 일이 없으면 모두 잠든다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NODE, BT } from './scene.js';
import { nestSlot, nestCenter, FIN_XZ, NEST_TOP } from './layout.js';
import { TEAM_COLORS, INK, RESULT_SPECIES } from './theme.js';
import { tween, wait, ease, SPEED, reducedMotion } from './anim.js';

const TAU = Math.PI * 2;
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
const GOLD = 0xE8B23A;
const TIER_S = [1, 0.92, 0.85, 0.8];   // 업힌 층별 배율
const NEST_S = 0.78;                   // 방석 위 말 배율(PIECE_SCALE을 곱해 .88을 넘지 않게)
const PED_H = 0.17;                    // 금 좌대 높이(받침 밖으로 금빛 띠가 보이게)
const STEP_MS = [260, 260, 230, 210, 200];
// 게임을 막는 구간 상한(ms·SP): 잡기 1180, 완주 1160. 구간을 시작할 때 마감 시각을 잡아 두고
// 남은 시간을 그 시각에서 거꾸로 잰다(프레임이 늦게 와도 합이 늘지 않게). SLACK은 타이머 오차 몫
const CATCH_MS = 1180, FIN_MS = 1160, SLACK = 30;
const POUNCE_MS = 480, FIN_LEAP_MS = 540, HITSTOP = 80;
// 탭 우선순위: 도착 번호(3) > 번호 핀(1.6) > 고를 수 있는 말·새로 올릴 대기 말(1.5) > 도착 칸(1.2) > 다른 말(1)
const PICK_LO = 1, PICK_HI = 1.5;
const HEAD_Y = 0.56;                   // 머리 중심 높이(말 원점 기준)
const HEAD_TILT = -0.3;                // 고개를 들어 위의 카메라(플레이어)를 올려다봄
const PRIO = { dizzy: 60, surprised: 50, sad: 40, effort: 30, proud: 25, happy: 20, idle: 10, blink: 10 };
/** 뼈 번호(skinIndex). 없는 부위(꼬리·귀)도 뼈는 만들어 두어 번호를 고정한다 */
const BONE = { lift: 0, base: 1, torso: 2, pawL: 3, pawR: 4, head: 5, medal: 6, tail: 7, earL: 8, earR: 9 };
const WHITE_UV = [0.5, 0.875];         // 아틀라스의 흰 동정 띠 — 색칠(vertex color) 부품은 여기를 본다
const HIDE = 1e-4;                     // 뼈 배율을 이만큼 줄이면 그 부위가 사라진다

/** 표정 8종 (얼굴 재질 이름) */
export const FACES = ['idle', 'blink', 'happy', 'surprised', 'dizzy', 'proud', 'effort', 'sad'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const arcH = (k, h) => 4 * h * k * (1 - k);
const rnd = (a, b) => a + Math.random() * (b - a);
const angTo = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

/** 층 k(소수 가능)의 높이·깊이·배율 — 맨 아래 말 좌표계, 말 단위 */
function tierY(L) {
  let y = 0; const n = Math.floor(L);
  for (let j = 0; j < n; j++) y += 0.42 * TIER_S[Math.min(j, 3)];
  return y + (L - n) * 0.42 * TIER_S[Math.min(n, 3)];
}
const tierZ = L => -0.2 * L;
function tierS(L) {
  const n = Math.floor(L), f = L - n;
  if (n >= 3) return TIER_S[3];
  return lerp(TIER_S[n], TIER_S[n + 1], f);
}

/* ---------------------------------------------------------------
 * 발 자세 [왼발 x, 왼발 z, 오른발 x, 오른발 z] (pivot 기준 회전)
 * --------------------------------------------------------------- */
const PAW = {
  rest: [0, 0, 0, 0],
  orb: [-0.75, 0.35, -0.75, -0.35],   // 여의주 받치기
  hold: [-1.2, 0, -1.2, 0],           // 업혀서 어깨 잡기
  reach: [-1.2, 0, -1.2, 0],
  pounce: [-1.3, 0, -1.3, 0],
  up: [0, -1.9, 0, 1.9],              // 만세
  cover: [-2.4, 0.55, -2.4, -0.55],   // 얼굴 가리기
  waveR: [0, -0.3, 0, 1.9],
  scratch: [0, -0.2, -0.4, 2.5],      // 머리 긁기
};

/* ---------------------------------------------------------------
 * 동물 8종. 부품 좌표는 말 원점 기준(받침 바닥 중심, +z 얼굴).
 * g: 기본 도형, c: 색, s: 배율, r: 회전(XYZ), p: 위치
 * --------------------------------------------------------------- */
function pair(d) {
  const m = { ...d, p: [-d.p[0], d.p[1], d.p[2]] };
  if (d.r) m.r = [d.r[0], -d.r[1], -d.r[2]];
  return [d, m];
}
const WOOL = 0xFBF6EA;
/** 호랑이 꼬리 곡선(꼬리 pivot 기준). 옆으로 돌아 나와 오른팔 옆에서 물음표처럼 말린다(귀 높이까지 솟으면 더듬이처럼 보임) */
const TIGER_TAIL = [[0, 0, 0.04], [0.03, -0.03, -0.07], [0.12, -0.05, -0.13], [0.24, -0.03, -0.14], [0.34, 0.03, -0.09], [0.39, 0.11, -0.01], [0.37, 0.18, 0.06], [0.31, 0.19, 0.09]];
const MANE = 0x5B3322;
const COW = 0xE4B05A;   // 누렁이 황소빛(개의 크림색과 멀게)

const SPEC = {
  horse: {
    fur: 0xD6895A, hs: [0.95, 1, 1.05],
    head: [
      // 앞으로 나온 긴 주둥이와 콧구멍
      { g: ['sphere', 0.14], c: 0xF5DFC4, s: [0.95, 0.78, 1.3], p: [0, 0.49, 0.21] },
      ...pair({ g: ['sphere', 0.024], c: MANE, s: [1, 1.2, 0.5], p: [0.05, 0.50, 0.372] }),
      // 쫑긋한 귀(겉·속)
      ...pair({ g: ['cone', 0.065, 0.2, 10], c: 0xD6895A, p: [0.12, 0.8, -0.02], r: [-0.1, 0, -0.3] }),
      ...pair({ g: ['cone', 0.035, 0.12, 8], c: 0xF5DFC4, p: [0.125, 0.79, 0.012], r: [-0.1, 0, -0.3] }),
      // 갈기: 머리 곡면을 따라 이마에서 목덜미까지 이어진 털 뭉치(길쭉한 구를 곡면 접선으로 눕힘) + 앞머리
      ...[30, 0, -35, -70, -102].map((deg, k) => {
        const th = deg * Math.PI / 180, R = k === 1 ? 0.3 : 0.285;
        return { g: ['sphere', 0.078, 10, 8], c: MANE, s: [0.55, 0.8, 1.45], r: [th, 0, 0], p: [0, HEAD_Y + R * Math.cos(th), R * 1.05 * Math.sin(th)] };
      }),
      { g: ['sphere', 0.055, 10, 8], c: MANE, s: [0.8, 1, 0.9], r: [0.9, 0, 0.3], p: [0.02, 0.752, 0.215] },
    ],
    // 꼬리: 뒤로 늘어진 털 뭉치(달릴 때 휘날림)
    tail: {
      parts: [
        { g: ['tuft', 0.3, 0.075, 10], c: MANE, s: [0.85, 1, 1] },
        { g: ['tuft', 0.22, 0.05, 8], c: 0x7A4630, r: [0.35, 0.25, 0], p: [0.03, 0.01, -0.02] },
      ],
      pivot: [0, 0.27, -0.26], rx: -0.75,
    },
    gait: { h: 0.5, horse: true },
  },
  pig: {
    fur: 0xF7B6C6, hs: [1.1, 0.95, 1],
    head: [
      { g: ['cyl', 0.10, 0.10, 0.08, 20], c: 0xEE8FA8, r: [Math.PI / 2, 0, 0], p: [0, 0.51, 0.27] },
      ...pair({ g: ['sphere', 0.022, 8, 6], c: 0xB0506A, s: [1, 1.3, 0.5], p: [0.035, 0.51, 0.31] }),
      ...pair({ g: ['cone', 0.08, 0.13, 3], c: 0xF7B6C6, p: [0.15, 0.78, 0.02], r: [0.6, 0, -0.35] }),
    ],
    tail: { parts: [{ g: ['torus', 0.05, 0.016, 6, 12, 1.5 * Math.PI], c: 0xEE8FA8, r: [0, Math.PI / 2, 0], p: [0, 0, -0.05] }], pivot: [0, 0.20, -0.30], rx: 0 },
    gait: { h: 0.45, waddle: true },
  },
  dog: {
    fur: 0xEFD3A2, hs: [1.05, 1, 1],
    head: [
      // 머리 밖으로 늘어진 갈색 귀
      ...pair({ g: ['sphere', 0.12], c: 0x8A5A36, s: [0.55, 1.45, 0.85], r: [0, 0, 0.15], p: [0.27, 0.53, -0.01] }),
      // 삽살개 앞머리: 이마를 덮는 복슬 털
      { g: ['sphere', 0.16, 14, 10], c: 0xFCE6C0, s: [1.3, 0.5, 0.8], p: [0, 0.78, 0.06] },
      ...pair({ g: ['sphere', 0.055, 8, 6], c: 0xFCE6C0, p: [0.1, 0.748, 0.165] }),
      { g: ['sphere', 0.055, 8, 6], c: 0xFCE6C0, p: [0, 0.745, 0.19] },
      // 흰 주둥이, 까만 코, 혀
      { g: ['sphere', 0.10], c: 0xFFF4E2, s: [1.15, 0.8, 1], p: [0, 0.49, 0.22] },
      { g: ['sphere', 0.048, 10, 8], c: 0x2B1D14, p: [0, 0.525, 0.31] },
      { g: ['sphere', 0.035, 10, 8], c: 0xFF7F96, s: [1, 0.45, 1.3], p: [0, 0.43, 0.285] },
    ],
    tail: { parts: [{ g: ['sphere', 0.08], c: 0xEFD3A2, s: [1, 1, 1.5], p: [0, 0, -0.1] }], pivot: [0, 0.26, -0.26], rx: 0.6 },
    gait: { h: 0.55, wag: true },
  },
  sheep: {
    fur: 0xEECBB0, hs: [1, 1, 1],
    head: [
      // 머리를 감싼 구름 털(정수리·옆·뒤·앞머리)
      { g: ['sphere', 0.13, 10, 8], c: WOOL, p: [0, 0.8, 0] },
      ...pair({ g: ['sphere', 0.12, 10, 8], c: WOOL, p: [0.14, 0.77, 0.03] }),
      ...pair({ g: ['sphere', 0.11, 10, 8], c: WOOL, p: [0.2, 0.67, -0.07] }),
      { g: ['sphere', 0.12, 10, 8], c: WOOL, p: [0, 0.76, -0.15] },
      ...pair({ g: ['sphere', 0.07, 8, 6], c: WOOL, p: [0.06, 0.77, 0.15] }),
      // 양옆으로 말린 뿔
      ...pair({ g: ['torus', 0.07, 0.03, 6, 14, 1.6 * Math.PI], gap: true, c: 0xB98A55, r: [0, Math.PI / 2 - 0.5, 0], p: [0.25, 0.57, 0.02] }),
    ],
    body: [{ g: ['torus', 0.20, 0.07, 8, 20], c: WOOL, r: [Math.PI / 2, 0, 0], p: [0, 0.36, 0] }],
    gait: { h: 0.55, sq: 1.3 },
  },
  cow: {
    fur: COW, hs: [1.12, 0.95, 1],
    head: [
      { g: ['sphere', 0.14], c: 0xF8E2BF, s: [1.3, 0.8, 0.8], p: [0, 0.47, 0.21] },
      ...pair({ g: ['sphere', 0.024], c: 0x8A5A36, p: [0.06, 0.49, 0.31] }),
      // 뿔: 옆으로 뻗다가 위로 휘는 두 마디
      ...pair({ g: ['capsule', 0.048, 0.1, 4, 10], c: 0xF7F0DE, r: [0, 0, Math.PI / 2 + 0.25], p: [0.25, 0.73, 0] }),
      ...pair({ g: ['cone', 0.048, 0.17, 10], c: 0xF7F0DE, r: [0, 0, -0.35], p: [0.374, 0.835, 0] }),
      // 옆으로 처진 귀, 이마 곱슬털
      ...pair({ g: ['sphere', 0.07, 12, 8], c: COW, s: [1.4, 0.5, 0.8], r: [0, 0, -0.35], p: [0.3, 0.63, 0.03] }),
      { g: ['sphere', 0.06, 10, 8], c: 0xC98F3F, s: [1.3, 0.7, 1], p: [0, 0.785, 0.07] },
    ],
    body: [
      { g: ['sphere', 0.06, 12, 8], c: GOLD, p: [0, 0.30, 0.27] },
      { g: ['torus', 0.19, 0.016, 6, 24], c: 0x7A3B1E, r: [Math.PI / 2, 0, 0], p: [0, 0.34, 0] },
    ],
    tail: {
      parts: [{ g: ['capsuleZ', 0.025, 0.20], c: COW }, { g: ['sphere', 0.045, 10, 8], c: 0x8A5A36, p: [0, 0, -0.27] }],
      pivot: [0, 0.24, -0.27], rx: -0.8,
    },
    gait: { h: 0.42, cow: true },
  },
  tiger: {
    fur: 0xF59B3D, hs: [1.05, 1, 1], map: true,
    head: [
      ...pair({ g: ['sphere', 0.08, 12, 8], c: 0xF59B3D, s: [1, 1, 0.5], p: [0.17, 0.77, -0.02] }),
      ...pair({ g: ['sphere', 0.045, 10, 8], c: 0xFFF6E8, s: [1, 1, 0.4], p: [0.17, 0.77, 0.02] }),
      { g: ['sphere', 0.11], c: 0xFFF6E8, s: [1.3, 0.8, 0.9], p: [0, 0.48, 0.21] },
      { g: ['sphere', 0.035, 10, 8], c: 0x3A2416, p: [0, 0.53, 0.31] },
    ],
    // 꼬리: 줄무늬가 있는 긴 꼬리가 옆으로 휘어 올라가 머리 옆으로 삐죽 보인다(물음표 모양)
    tail: {
      parts: [
        { g: ['tube', 0.036, TIGER_TAIL, 36, 8], c: 0xF59B3D, band: [0x3A2416, 6] },
        { g: ['sphere', 0.04, 10, 8], c: 0xF59B3D, p: TIGER_TAIL[TIGER_TAIL.length - 1] },
      ],
      pivot: [0, 0.24, -0.25], rx: 0,
    },
    gait: { h: 0.38, long: true },
  },
  rabbit: {
    fur: 0xF6F0EA, hs: [1, 0.97, 1],
    head: [
      ...pair({ g: ['sphere', 0.07, 12, 8], c: 0xFFFFFF, p: [0.06, 0.48, 0.20] }),
      { g: ['sphere', 0.03, 10, 8], c: 0xF58FA8, p: [0, 0.53, 0.26] },
    ],
    ears: { outer: 0xF6F0EA, inner: 0xF7B6C6, pivot: [0.08, 0.76, -0.02] },
    body: [{ g: ['sphere', 0.075, 12, 8], c: 0xFFFFFF, p: [0, 0.22, -0.31] }],
    gait: { h: 0.5, rabbit: true },
  },
  rooster: {
    fur: 0xFFFBF2, hs: [1, 1, 1],
    head: [
      // 정수리의 빨간 볏(위에서 봐도 보이는 가장 큰 표시)
      { g: ['sphere', 0.07], c: 0xE8392E, p: [0, 0.82, 0.08] },
      { g: ['sphere', 0.078], c: 0xE8392E, s: [0.8, 1.15, 1], p: [0, 0.85, -0.02] },
      { g: ['sphere', 0.066], c: 0xE8392E, p: [0, 0.81, -0.12] },
      // 노란 부리와 빨간 턱볏
      { g: ['cone', 0.058, 0.13, 10], c: 0xF6B53A, r: [Math.PI / 2, 0, 0], p: [0, 0.535, 0.3] },
      { g: ['sphere', 0.046], c: 0xE8392E, s: [0.8, 1.4, 0.6], p: [0, 0.44, 0.245] },
    ],
    // 꼬리: 위로 솟아 부채처럼 펼쳐진 깃털(초록·주황)
    tail: {
      parts: [
        { g: ['tuft', 0.3, 0.07, 10], c: 0x2E6B4F },
        { g: ['tuft', 0.26, 0.06, 8], c: 0xE8892E, r: [0.25, 0.4, 0], p: [0.03, 0, 0] },
        { g: ['tuft', 0.26, 0.06, 8], c: 0xE8892E, r: [0.25, -0.4, 0], p: [-0.03, 0, 0] },
        { g: ['tuft', 0.22, 0.05, 8], c: 0x1F4E3A, r: [-0.3, 0, 0] },
      ],
      pivot: [0, 0.3, -0.26], rx: 0.9,
    },
    gait: { h: 0.5, waddle: true },
  },
};

/* ---------------------------------------------------------------
 * 도형 만들기
 * --------------------------------------------------------------- */
function paint(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function prim(d) {
  const [type, a, b, c, e, f] = d.g;
  let g;
  if (type === 'sphere') {   // 작은 구는 면을 줄인다(말 16개 × 부품 수십 개)
    const [ws, hs] = a >= 0.1 ? [14, 10] : a >= 0.06 ? [10, 8] : [8, 6];
    g = new THREE.SphereGeometry(a, b || ws, c || hs);
  }
  else if (type === 'cone') g = new THREE.ConeGeometry(a, b, c || 12);
  else if (type === 'cyl') g = new THREE.CylinderGeometry(a, b, c, e || 16);
  else if (type === 'torus') g = new THREE.TorusGeometry(a, b, c || 8, e || 20, f || TAU);
  else if (type === 'capsule') g = new THREE.CapsuleGeometry(a, b, 4, 10);
  else if (type === 'capsuleZ') { g = new THREE.CapsuleGeometry(a, b, 4, 10); g.rotateX(-Math.PI / 2); g.translate(0, 0, -(b / 2 + a)); }
  else if (type === 'coneZ') { g = new THREE.ConeGeometry(a, b, c || 10); g.rotateX(-Math.PI / 2); g.translate(0, 0, -b / 2); }
  else if (type === 'tuft') {   // 뿌리가 가늘고 가운데가 불룩한 털 뭉치(−z로 뻗음). a: 길이, b: 가장 굵은 반지름
    const prof = [[0, 0], [0.45, 0.05], [0.8, 0.2], [1, 0.42], [0.92, 0.64], [0.62, 0.84], [0.25, 0.97], [0, 1]];
    g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * b, y * a)), c || 10);
    g.rotateX(-Math.PI / 2);
  } else if (type === 'tube') {  // 곡선 꼬리. a: 반지름, b: 점 목록, d.band: [띠 색, 띠 수]
    const curve = new THREE.CatmullRomCurve3(b.map(q => new THREE.Vector3(q[0], q[1], q[2])));
    const segs = c || 30, rad = e || 8;
    g = new THREE.TubeGeometry(curve, segs, a, rad, false);
    paint(g, d.c);
    if (d.band) {   // 줄무늬: 고리(ring) 단위로 색을 바꾼다
      const col = g.attributes.color.array, dark = new THREE.Color(d.band[0]), n = d.band[1];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        if (Math.floor(u * n + 0.35) % 2 === 0) continue;
        for (let j = 0; j <= rad; j++) { const v = (i * (rad + 1) + j) * 3; col[v] = dark.r; col[v + 1] = dark.g; col[v + 2] = dark.b; }
      }
    }
  }
  if (d.gap) g.rotateZ(-0.3 * Math.PI);   // 뿔 고리의 빈 곳을 아래로
  if (d.s) g.scale(d.s[0], d.s[1], d.s[2]);
  if (d.r) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(d.r[0], d.r[1], d.r[2])));
  if (d.p) g.translate(d.p[0], d.p[1], d.p[2]);
  return g.attributes.color ? g : paint(g, d.c);
}

const KEEP_ATTR = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight', 'glow'];

/** vertexColors 부품 합치기. Extrude가 섞이면 모두 non-indexed로 바꾼다 */
function mergeParts(list) {
  const nonIdx = list.some(g => !g.index);
  const gs = list.map(g => {
    const o = nonIdx && g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(o.attributes)) if (!KEEP_ATTR.includes(k)) o.deleteAttribute(k);
    return o;
  });
  const m = mergeGeometries(gs, false);
  list.forEach(g => g.dispose());
  gs.forEach(g => g.dispose());
  return m;
}

/**
 * 부품에 뼈 번호·빛 받이(glow)·uv를 붙인다. 좌표는 말 원점 기준(= 뼈를 묶는 기본 자세).
 * o.v: 원래 uv의 v를 아틀라스 v로 바꾸는 함수(저고리·호랑이 머리). 없으면 흰 칸을 본다.
 */
function rigPart(g, bone, o = {}) {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), gl = new Float32Array(n), uv = new Float32Array(n * 2);
  const src = g.attributes.uv ? g.attributes.uv.array : null;
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone; sw[i * 4] = 1; gl[i] = o.glow || 0;
    if (o.v && src) { uv[i * 2] = src[i * 2]; uv[i * 2 + 1] = o.v(src[i * 2 + 1]); } else { uv[i * 2] = WHITE_UV[0]; uv[i * 2 + 1] = WHITE_UV[1]; }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (!g.attributes.color) paint(g, 0xffffff);
  return g;
}

/** 말 재질: 받침(glow 1)에만 emissive가 켜지도록 셰이더를 조금 고친다 */
function patchGlow(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = glow;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vGlow;');
}

/** 받침용 팀 모양(앞 = shape의 −y → 회전 뒤 +z) */
function shape3D(kind, grow = 1) {
  const s = new THREE.Shape();
  if (kind === 'circle') s.absarc(0, 0, 0.44 * grow, 0, TAU, false);
  else if (kind === 'square') {
    const h = 0.36 * grow, r = 0.07 * grow;
    s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
    s.lineTo(h, h - r); s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
    s.lineTo(-h + r, h); s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-h, -h + r); s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  } else {
    const star = kind === 'star', n = star ? 10 : 3;
    for (let k = 0; k < n; k++) {
      const ang = -Math.PI / 2 + k * TAU / n, R = star ? (k % 2 ? 0.27 : 0.52) * grow : 0.58 * grow;
      const x = R * Math.cos(ang), y = R * Math.sin(ang);
      if (k) s.lineTo(x, y); else s.moveTo(x, y);
    }
    s.closePath();
  }
  return s;
}
const RIM_GROW = { circle: (0.44 + 0.035) / 0.44, square: (0.36 + 0.035) / 0.36, triangle: (0.29 + 0.035) / 0.29, star: (0.27 + 0.035) / 0.27 };

/* ---------------------------------------------------------------
 * 캔버스 그림
 * --------------------------------------------------------------- */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** 캔버스용 팀 모양(꼭짓점이 위). r은 대략의 반지름 */
function shapePath(g, kind, cx, cy, r) {
  g.beginPath();
  if (kind === 'circle') g.arc(cx, cy, r, 0, TAU);
  else if (kind === 'square') {
    const h = r * 0.86, q = r * 0.28;
    g.moveTo(cx - h + q, cy - h); g.arcTo(cx + h, cy - h, cx + h, cy + h, q); g.arcTo(cx + h, cy + h, cx - h, cy + h, q);
    g.arcTo(cx - h, cy + h, cx - h, cy - h, q); g.arcTo(cx - h, cy - h, cx + h, cy - h, q);
  } else {
    const star = kind === 'star', n = star ? 10 : 3, oy = star ? r * 0.06 : r * 0.22;
    for (let k = 0; k < n; k++) {
      const ang = -Math.PI / 2 + k * TAU / n, R = star ? (k % 2 ? r * 0.5 : r * 1.08) : r * 1.2;
      const x = cx + R * Math.cos(ang), y = cy + oy + R * Math.sin(ang);
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
  }
  g.closePath();
}

function starPath(g, cx, cy, ro, ri, n = 5) {
  g.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const ang = -Math.PI / 2 + k * Math.PI / n, R = k % 2 ? ri : ro;
    const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
    if (k) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

function text(g, s, x, y, size, fill, stroke, lw) {
  g.font = `${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.strokeText(s, x, y); }
  g.fillStyle = fill;
  g.lineWidth = Math.max(1, size * 0.05); g.strokeStyle = fill; g.strokeText(s, x, y);   // 조금 굵게
  g.fillText(s, x, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** 저고리 천 256×128 (v=0이 밑단) */
function drawJeogori(g, tc) {
  const W = 256, H = 128;
  g.fillStyle = tc.css; g.fillRect(0, 0, W, H);
  g.save(); g.globalAlpha = 0.3;
  if (tc.pattern === 'dots') {
    g.fillStyle = '#fff';
    const sx = W / 12;
    for (let row = 0, y = 6; y < H; y += 21, row++) for (let x = (row % 2) * sx / 2; x < W + sx; x += sx) { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
  } else if (tc.pattern === 'grid') {
    g.fillStyle = '#fff';
    for (let x = 0; x < W; x += W / 13) g.fillRect(x, 0, 3, H);
    for (let y = 2; y < H; y += 20) g.fillRect(0, y, W, 3);
  } else if (tc.pattern === 'zigzag') {
    g.fillStyle = '#7A4A00';
    for (const y0 of [47, 69]) {
      g.beginPath(); g.moveTo(0, y0 + 11);
      for (let x = 0; x < W; x += 16) { g.lineTo(x + 8, y0); g.lineTo(x + 16, y0 + 11); }
      g.lineTo(W, y0 + 15); g.lineTo(0, y0 + 15); g.closePath(); g.fill();
    }
  } else {
    g.fillStyle = '#fff';
    const sx = W / 9;
    for (let row = 0, y = 10; y < H; y += 26, row++) for (let x = (row % 2) * sx / 2; x < W + sx; x += sx) { starPath(g, x, y, 6.5, 2.8); g.fill(); }
  }
  g.restore();
  // 밑단 금박 띠
  g.fillStyle = '#E8B23A'; g.fillRect(0, 85, W, 22);
  g.fillStyle = '#FFF1C9';
  for (let x = 8; x < W; x += 16) { g.beginPath(); g.arc(x, 96, 3, 0, TAU); g.fill(); }
  // 동정(목둘레 흰 띠)
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 21, W, 22);
  // 고름
  g.strokeStyle = '#FFFFFF'; g.lineCap = 'round'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(150, 46); g.lineTo(158, 80); g.moveTo(152, 46); g.lineTo(166, 76); g.stroke();
  // 가슴·등 도장 (구면에서 가로로 늘어나 보이는 만큼 미리 좁힌다)
  const stamp = x => {
    g.save(); g.translate(x, 64); g.scale(0.78, 1);
    shapePath(g, tc.shape, 0, 0, 17);
    g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
    g.restore();
  };
  stamp(128); stamp(0); stamp(W);
}

/** 표정 캔버스 256×128 (투명). 눈 L(84,50) R(172,50), 입 (128,88) */
function drawFace(g, name) {
  const ink = '#2A2024', EY = 50, EX = [84, 172];
  const V = 0.84;   // 구면 조각의 세로 늘어남 보정
  g.lineCap = 'round'; g.lineJoin = 'round';
  const at = (x, y, fn) => { g.save(); g.translate(x, y); g.scale(1, V); fn(); g.restore(); };
  const cheeks = a => {
    g.fillStyle = `rgba(255,143,163,${a})`;
    for (const x of [56, 200]) at(x, 78, () => { g.beginPath(); g.ellipse(0, 0, 17, 9, 0, 0, TAU); g.fill(); });
  };
  const smile = (r, lw) => at(128, 88 - r * 0.55, () => { g.strokeStyle = ink; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); });
  const dot = (x, y) => at(x, y, () => {
    g.fillStyle = ink; g.beginPath(); g.ellipse(0, 0, 13, 17, 0, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(5, -7, 5, 0, TAU); g.fill();
  });
  const line = (pts, lw, col = ink) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  switch (name) {
    case 'idle':
      cheeks(0.5); EX.forEach(x => dot(x, EY)); smile(12, 5); break;
    case 'blink':
      cheeks(0.5);
      EX.forEach(x => at(x, EY - 6, () => { g.strokeStyle = ink; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 13, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }));
      smile(12, 5); break;
    case 'happy':
      cheeks(0.75);
      EX.forEach(x => line([[x - 14, EY + 6], [x, EY - 8], [x + 14, EY + 6]], 7));
      at(128, 82, () => {
        g.fillStyle = ink; g.beginPath(); g.arc(0, 0, 14, 0, Math.PI); g.closePath(); g.fill();
        g.save(); g.clip(); g.fillStyle = '#FF7A8A'; g.beginPath(); g.arc(0, 12, 7, 0, TAU); g.fill(); g.restore();
      });
      break;
    case 'surprised':
      cheeks(0.35);
      EX.forEach(x => at(x, EY, () => {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 19, 0, TAU); g.fill();
        g.strokeStyle = ink; g.lineWidth = 4; g.stroke();
        g.fillStyle = ink; g.beginPath(); g.arc(0, 1, 8, 0, TAU); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(3, -2, 3, 0, TAU); g.fill();
      }));
      EX.forEach(x => at(x, 22, () => { g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.arc(0, 10, 14, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); }));
      at(128, 90, () => { g.fillStyle = ink; g.beginPath(); g.ellipse(0, 0, 7, 10, 0, 0, TAU); g.fill(); });
      break;
    case 'dizzy':
      // 굵은 두 바퀴 소용돌이(작게 보여도 까만 점이 아니라 고리로 읽힘) + 꼬불 입
      cheeks(0.3);
      EX.forEach((x, e) => at(x, EY, () => {
        g.strokeStyle = ink; g.lineWidth = 7; g.beginPath();
        const turns = 2 * TAU, dir = e ? -1 : 1;
        for (let a = 0; a <= turns + 0.01; a += 0.12) { const r = 3 + 17 * a / turns; const px = r * Math.cos(dir * a), py = r * Math.sin(dir * a); if (a) g.lineTo(px, py); else g.moveTo(px, py); }
        g.stroke();
      }));
      g.strokeStyle = ink; g.lineWidth = 6; g.beginPath();
      for (let x = 106; x <= 150; x += 1) { const y = 92 + 5 * Math.sin((x - 106) / 44 * 2 * TAU); if (x === 106) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      break;
    case 'proud':
      cheeks(0.7);
      EX.forEach(x => at(x, EY, () => { starPath(g, 0, 1, 17, 7.5); g.fillStyle = '#FFC83D'; g.fill(); g.strokeStyle = ink; g.lineWidth = 3; g.stroke(); }));
      smile(16, 6); break;
    case 'effort':
      cheeks(0.6);
      line([[EX[0] - 11, EY - 11], [EX[0] + 9, EY], [EX[0] - 11, EY + 11]], 7);
      line([[EX[1] + 11, EY - 11], [EX[1] - 9, EY], [EX[1] + 11, EY + 11]], 7);
      at(128, 88, () => {
        g.fillStyle = ink; roundRect(g, -15, -5.5, 30, 11, 3); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, -4); g.lineTo(-5, 4); g.moveTo(5, -4); g.lineTo(5, 4); g.stroke();
      });
      break;
    case 'sad': {
      // 꼭 감은 ∩ 눈 + 처진 눈썹 + 굵은 눈물 줄기(파란색이라 작게 보여도 읽힘) + 삐죽 입
      cheeks(0.35);
      const tear = (x, y0, len) => {
        g.fillStyle = '#6EC6FF'; g.strokeStyle = ink; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x - 5, y0); g.lineTo(x + 5, y0); g.lineTo(x + 6, y0 + len);
        g.arc(x, y0 + len, 8, 0, Math.PI); g.lineTo(x - 5, y0); g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x - 2.5, y0 + len - 1, 2.2, 3.5, 0, 0, TAU); g.fill();
      };
      EX.forEach((x, e) => {
        const d = e ? 1 : -1;   // 바깥쪽 방향
        at(x, EY + 6, () => { g.strokeStyle = ink; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 13, 1.1 * Math.PI, 1.9 * Math.PI); g.stroke(); });
        line([[x - 15 * d, EY - 28], [x + 13 * d, EY - 19]], 5);   // 안쪽 끝이 올라간 걱정 눈썹
        tear(x + 11 * d, EY + 6, 20);
      });
      at(128, 100, () => { g.strokeStyle = ink; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 11, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); });
      break;
    }
  }
}

/** 호랑이 머리 무늬 256×128 (u=.25가 앞). 흰 바탕 — 털색(vertex color)에 곱해진다 */
function drawTiger(g) {
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#4A3A38';
  const bar = (x, y0, w, h) => { g.beginPath(); g.moveTo(x - w / 2, y0); g.lineTo(x + w / 2, y0); g.lineTo(x + w * 0.15, y0 + h); g.lineTo(x - w * 0.15, y0 + h); g.closePath(); g.fill(); };
  bar(52, 4, 7, 18); bar(64, 2, 8, 26); bar(76, 4, 7, 18);
  for (const [x, d] of [[30, 1], [98, -1]]) for (const y of [60, 72]) {
    g.beginPath(); g.moveTo(x - 12 * d, y - 4); g.lineTo(x - 12 * d, y + 4); g.lineTo(x + 8 * d, y); g.closePath(); g.fill();
  }
  for (const x of [180, 192, 204]) bar(x, 6, 7, 28);
  for (const x of [140, 244]) bar(x, 30, 6, 22);
}

/* ---------------------------------------------------------------
 * createPieces
 * --------------------------------------------------------------- */
export function createPieces(ctx, opts = {}) {
  const renderer = ctx.renderer;
  const S = () => SPEED * spd;

  const sfx = (name, p) => {
    if (!opts.sfx) return;
    try { opts.sfx(name, p || {}); } catch (e) { setTimeout(() => { throw e; }); }
  };

  /* ---------- 공유 자원 ---------- */
  const trash = [];
  const keep = x => (trash.push(x), x);
  const canvasTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return keep(t); };

  const texts = new Map();   // 글자가 든 텍스처(글꼴이 늦게 오면 다시 그림)
  function drawnTex(key, w, h, draw) {
    let e = texts.get(key);
    if (!e) { const c = mkCanvas(w, h); draw(c.getContext('2d'), w, h); e = { c, draw, tex: canvasTex(c) }; texts.set(key, e); }
    return e.tex;
  }
  function rebake() {
    for (const e of texts.values()) { const g = e.c.getContext('2d'); g.clearRect(0, 0, e.c.width, e.c.height); e.draw(g, e.c.width, e.c.height); e.tex.needsUpdate = true; }
    ctx.invalidate();
  }
  const onFonts = () => rebake();
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', onFonts);
    document.fonts.load(`40px ${FONT}`).then(f => { if (f && f.length) rebake(); }, () => {});
  }

  const R = {
    atlas: [], baseTop: [], baseRim: [], ringMat: [],
    faceMat: {},
    sp: {}, geo: {},
  };
  for (const f of FACES) {
    const c = mkCanvas(256, 128); drawFace(c.getContext('2d'), f);
    R.faceMat[f] = keep(new THREE.MeshBasicMaterial({
      map: canvasTex(c), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false,
    }));
  }
  R.faceGeo = keep(new THREE.SphereGeometry(0.254, 16, 10, Math.PI / 2 - 0.95, 1.9, 0.80, 1.15));
  // 저고리(말 원점 기준). phiStart=π라서 가슴(+z)이 u=.5에 온다
  const BODY_PTS = [[0, 0.08], [0.30, 0.08], [0.31, 0.12], [0.28, 0.21], [0.21, 0.31], [0.13, 0.37], [0, 0.39]];
  // 터치 원기둥: 보이는 몸(받침 반지름 .44, 키 .81)에 가깝게. 너무 크면 뒤 칸 말의 탭을 가로챈다
  R.proxyGeo = keep(new THREE.CylinderGeometry(0.45, 0.45, 0.95, 12).translate(0, 0.475, 0));
  R.proxyMat = keep(new THREE.MeshBasicMaterial({ visible: false }));
  R.ringGeo = keep(new THREE.RingGeometry(0.52, 0.68, 40).rotateX(-Math.PI / 2));
  // 금 좌대: 이웃 칸(.92 간격)과 닿지 않는 가장 큰 크기. 윗면 테와 아랫단 띠로 층을 보인다
  R.pedGeo = keep(mergeParts([
    prim({ g: ['cyl', 0.48, 0.5, PED_H - 0.04, 28], c: GOLD, p: [0, 0.04 + (PED_H - 0.04) / 2, 0] }),
    prim({ g: ['cyl', 0.52, 0.52, 0.04, 28], c: 0xC9922A, p: [0, 0.02, 0] }),
    prim({ g: ['torus', 0.475, 0.022, 6, 36], c: 0xFFE7A0, r: [Math.PI / 2, 0, 0], p: [0, PED_H, 0] }),
  ]));
  R.pedMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.35, emissive: 0x7A5200, emissiveIntensity: 0.35 }));
  R.orbMat = keep(new THREE.MeshStandardMaterial({ color: 0xFFFDF5, emissive: 0xFFE9A8, emissiveIntensity: 0.35, roughness: 0.3 }));
  R.orbGeo = keep(new THREE.SphereGeometry(0.075, 14, 10));
  // 완주 메달(저고리 뼈 기준 좌표) — 완주한 말에만 보인다
  R.medalGeo = keep(mergeParts([
    prim({ g: ['cyl', 0.075, 0.075, 0.02, 20], c: GOLD, r: [Math.PI / 2, 0, 0], p: [0, 0.20, 0.30] }),
    prim({ g: ['sphere', 0.03, 8, 6], c: 0xFFF1C9, s: [1, 1, 0.4], p: [0, 0.20, 0.312] }),
    prim({ g: ['torus', 0.19, 0.014, 6, 24], c: 0xD23B3B, r: [Math.PI / 2, 0, 0], p: [0, 0.27, 0] }),
  ]));
  R.medalMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.35 }));
  {
    const c = mkCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(40,24,10,0.38)'); gr.addColorStop(0.55, 'rgba(40,24,10,0.22)'); gr.addColorStop(1, 'rgba(40,24,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    R.blobMat = keep(new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    R.blobGeo = keep(new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2));
  }
  R.fxRingMat = keep(new THREE.MeshBasicMaterial({ color: 0xFFC83D, transparent: true, opacity: 0.9, depthWrite: false }));

  TEAM_COLORS.forEach((tc, c) => {
    // 팀 아틀라스 256×256: 위 절반 저고리 천, 아래 절반 호랑이 머리 무늬
    const cv = mkCanvas(256, 256), g = cv.getContext('2d');
    drawJeogori(g, tc);
    g.save(); g.translate(0, 128); drawTiger(g); g.restore();
    R.atlas[c] = canvasTex(cv);
    // 곡선 분할: 원은 둘레 28조각, 둥근 네모는 모서리마다 6조각
    const ex = { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: tc.shape === 'circle' ? 14 : 3 };
    R.baseTop[c] = keep(paint(new THREE.ExtrudeGeometry(shape3D(tc.shape), ex).rotateX(-Math.PI / 2).translate(0, 0.015, 0), tc.hex));
    R.baseRim[c] = keep(paint(new THREE.ExtrudeGeometry(shape3D(tc.shape, RIM_GROW[tc.shape]), { ...ex, depth: 0.02, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, 0.015, 0), 0x2B2118));
    R.ringMat[c] = keep(new THREE.MeshBasicMaterial({ color: tc.hex, transparent: true, opacity: 0.8, depthWrite: false }));
  });

  /** 말마다 하나씩 만드는 재질(받침 빛 세기가 말마다 다르다). 셰이더 프로그램은 모두 같이 쓴다 */
  function rigMat(c) {
    const m = new THREE.MeshStandardMaterial({ map: R.atlas[c], vertexColors: true, roughness: 0.55, emissive: TEAM_COLORS[c].hex, emissiveIntensity: 0 });
    m.onBeforeCompile = patchGlow;
    m.customProgramCacheKey = () => 'yut-piece-glow';
    return m;
  }

  /** 종별 정보(머리 꼭대기 높이 등) */
  function speciesInfo(id) {
    if (R.sp[id]) return R.sp[id];
    const d = SPEC[id] || SPEC.horse;
    let top = HEAD_Y + 0.25 * d.hs[1];
    for (const p of d.head) {
      const g = prim(p); g.computeBoundingBox(); top = Math.max(top, g.boundingBox.max.y); g.dispose();
    }
    if (d.ears) top = d.ears.pivot[1] + 0.42;
    R.sp[id] = { topY: top };
    return R.sp[id];
  }

  /** 종·팀별 말 geometry(부품을 뼈 번호와 함께 한 덩어리로). 같은 종·팀의 말은 이것을 같이 쓴다 */
  function rigGeo(id, c) {
    const key = id + '|' + c;
    if (R.geo[key]) return R.geo[key];
    const d = SPEC[id], parts = [];
    const add = (g, bone, o) => parts.push(rigPart(g, bone, o));
    // 받침 + 먹 테두리
    add(R.baseTop[c].clone(), BONE.base, { glow: 1 });
    add(R.baseRim[c].clone(), BONE.base, { glow: 0.45 });
    // 저고리(아틀라스 위 절반)
    add(new THREE.LatheGeometry(BODY_PTS.map(([x, y]) => new THREE.Vector2(x, y)), 24, Math.PI, TAU), BONE.torso, { v: v => 0.5 + 0.5 * v });
    (d.body || []).forEach(p => add(prim(p), BONE.torso));
    // 앞발 2개
    for (const sx of [-1, 1]) add(paint(new THREE.SphereGeometry(0.075, 10, 8).scale(1, 1.2, 1).translate(0.25 * sx, 0.28, 0.06), d.fur), sx < 0 ? BONE.pawL : BONE.pawR);
    // 머리 + 종별 부품
    const sphere = paint(new THREE.SphereGeometry(0.25, 20, 14).scale(d.hs[0], d.hs[1], d.hs[2]).translate(0, HEAD_Y, 0), d.fur);
    add(sphere, BONE.head, d.map ? { v: v => 0.5 * v } : undefined);
    d.head.forEach(p => add(prim(p), BONE.head));
    // 꼬리(pivot 기준으로 만든 것을 제자리로)
    if (d.tail) d.tail.parts.forEach(p => add(prim(p).translate(d.tail.pivot[0], d.tail.pivot[1], d.tail.pivot[2]), BONE.tail));
    // 토끼 귀 2개(따로 움직임)
    if (d.ears) {
      for (const sx of [-1, 1]) {
        const o = paint(new THREE.CapsuleGeometry(0.06, 0.30, 4, 10).scale(1, 1, 0.5), d.ears.outer);
        const n = paint(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8).scale(1, 1, 0.3).translate(0, 0, 0.022), d.ears.inner);
        const p = d.ears.pivot;
        [o, n].forEach(g => add(g.translate(p[0] * sx, p[1] + 0.21, p[2]), sx < 0 ? BONE.earL : BONE.earR));
      }
    }
    R.geo[key] = keep(mergeParts(parts));
    return R.geo[key];
  }

  /** 리그 하나 만들기 (장면에 넣지는 않음) */
  function buildRig(species, c) {
    const id = SPEC[species] ? species : 'horse';
    const d = SPEC[id], info = speciesInfo(id), cc = clamp(c | 0, 0, 3);
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const bones = [];
    const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); bones.push(b); return b; };
    // BONE 순서대로 만든다
    const lift = bone(root, 0, 0, 0);
    const base = bone(lift, 0, 0, 0);
    const torso = bone(lift, 0, 0.08, 0);
    const pawL = bone(torso, -0.18, 0.28, 0);
    const pawR = bone(torso, 0.18, 0.28, 0);
    const headG = bone(torso, 0, HEAD_Y - 0.08, 0);
    bone(torso, 0, 0, 0);   // (예비 뼈)
    const tp = d.tail ? d.tail.pivot : [0, 0.2, -0.25];
    const tail = bone(torso, tp[0], tp[1] - 0.08, tp[2]);
    const ep = d.ears ? d.ears.pivot : [0.08, HEAD_Y, 0];
    const earL = bone(headG, -ep[0], ep[1] - HEAD_Y, ep[2]);
    const earR = bone(headG, ep[0], ep[1] - HEAD_Y, ep[2]);
    const mat = rigMat(cc);
    const skin = new THREE.SkinnedMesh(rigGeo(id, cc), mat);
    skin.frustumCulled = false;
    root.add(skin);
    root.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton(bones));
    const medal = new THREE.Mesh(R.medalGeo, R.medalMat); medal.visible = false; torso.add(medal);
    tail.rotation.x = d.tail ? d.tail.rx : 0;
    earL.rotation.z = 0.12; earR.rotation.z = -0.12;
    const face = new THREE.Mesh(R.faceGeo, R.faceMat.idle); face.scale.set(d.hs[0], d.hs[1], d.hs[2]); headG.add(face);
    let orb = null;   // 여의주 재질은 말마다 따로(한 마리가 빛날 때 팀 전체가 같이 빛나지 않게)
    if (d.orb) { orb = new THREE.Mesh(R.orbGeo, R.orbMat.clone()); orb.position.set(0, 0.30 - 0.08, 0.31); torso.add(orb); }
    const proxy = new THREE.Mesh(R.proxyGeo, R.proxyMat); root.add(proxy);
    const ring = new THREE.Mesh(R.ringGeo, R.ringMat[cc]); ring.position.y = 0.012; ring.visible = false; ring.renderOrder = 2; root.add(ring);
    return {
      species: id, color: cc, root, skin, mat, lift, base, torso, headG, face, medal, pawL, pawR,
      tail: d.tail ? tail : null, earL: d.ears ? earL : null, earR: d.ears ? earR : null, orb, proxy, ring,
      tailRest: d.tail ? d.tail.rx : 0, topY: info.topY, gait: d.gait,
      a: neutral({ x: 0, y: 0, z: 0, gy: 0, ns: 1 }),
      yaw: 0, yawMode: 'camera', yawTarget: 0, yawTau: 0,
      pickPrio: 0, pickNew: false,
      ride: null, follow: null, tier: 0, stack: null, seq: 0,
      home: { kind: 'nest', slot: 0, tier: 0 },
      decor: 0, tok: 0, moving: false, gest: [], ov: [], faceName: 'idle', forceFace: null,
      blinkAt: idleT + rnd(1000, 5000), blinkUntil: 0, br: 0, zz: null,
      sel: null, threat: false, party: null, jelly: null, medalOn: false,
      pw: [0, 0, 0, 0], ew: [0, 0.12],
    };
  }

  function neutral(a) {
    return Object.assign(a, { hop: 0, tiltX: 0, tiltZ: 0, spin: 0, sq: 1, sqx: 1, sqz: 1, pop: 1, headX: 0, tailX: 0, tailY: 0, ear: 0, paws: null, tier: 0 });
  }

  /* ---------- 장면 그룹 ---------- */
  const rootG = new THREE.Group(); rootG.name = 'pieces';
  const pedG = new THREE.Group(), overG = new THREE.Group();
  rootG.add(pedG, overG);
  ctx.world.add(rootG);
  // 바닥 그림자와 금 좌대는 모든 말이 InstancedMesh 하나씩을 나눠 쓴다
  let blobs = null, peds = null;
  function ensureBlobs(n) {
    if (blobs && blobs.userData.cap >= n) { blobs.count = n; return; }
    if (blobs) { rootG.remove(blobs); blobs.dispose(); pedG.remove(peds); peds.dispose(); }
    const cap = Math.max(16, n);
    blobs = new THREE.InstancedMesh(R.blobGeo, R.blobMat, cap);
    blobs.userData.cap = cap; blobs.count = n; blobs.frustumCulled = false; blobs.renderOrder = 1;
    rootG.add(blobs);
    peds = new THREE.InstancedMesh(R.pedGeo, R.pedMat, cap);
    peds.count = 0; peds.visible = false; peds.frustumCulled = false;
    pedG.add(peds);
  }

  /* ---------- 상태 ---------- */
  let rigs = [], rigList = [];
  let side = ctx.matSide || 'bottom';
  let turn = null, spd = 1, PS = 1.25, epoch = 0, seqN = 0, lookPt = null;
  let lastAct = performance.now(), nextQuirk = lastAct + rnd(6000, 10000);
  // 대기 시계: 장면이 대기 동작을 그리는 동안만 흐른다(1초 하트비트 때 숨쉬기가 뚝뚝 끊겨 보이지 않게)
  let idleT = 0, lastFrame = -1, lastDraw = 0;
  // 잠들기: 입력도 연출도 없이 60초가 지나면 모두 눈을 감고 Z를 띄운다
  const SLEEP_MS = 60000;
  let asleep = false, lastInput = performance.now();
  let still = false;   // 잠들었거나 20초 동안 입력이 없으면 고르기·위험 동작을 멈춘다
  let party = null;   // { t, next }
  let lastW = 0, lastH = 0;
  const camPos = new THREE.Vector3(0, 17, 20);
  const byTier = (p, q) => (p.tier - q.tier) || (p.i - q.i);
  const touch = () => { lastAct = lastInput = performance.now(); if (asleep) wake(); };
  function wake() {
    asleep = false;
    for (const r of rigList) { faceOv(r, 'surprised', 200, 50); if (r.zz) r.zz.visible = false; }
    ctx.invalidate();
  }
  const onInput = () => touch();
  window.addEventListener('pointerdown', onInput, true);
  window.addEventListener('keydown', onInput, true);
  const nestS = () => Math.min(NEST_S, 0.88 / PS);
  // 품질: 'high' | 'low'(먼지·색종이·버릇 끔) | 'min'(low + 숨쉬기·깜빡임도 멈춰 대기 중에는 다시 그리지 않음)
  let quality = ctx.tier === 'low' ? 'low' : 'high';
  const lowQ = () => quality !== 'high';
  // 히트스톱: holdTo까지 이 모듈의 효과·몸짓 시계를 holdFrom에 멈춰 둔다(정지 화면)
  let holdFrom = 0, holdTo = 0;

  /** 화면 크기로 정하는 말 배율 PIECE_SCALE = clamp(44 / (pxPerUnit × .81), 1, 1.25) */
  function calcScale() {
    const el = renderer.domElement, w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    const ppu = side === 'right' ? h / 13.5 : w / 11.8;
    return clamp(44 / (ppu * 0.81), 1, 1.25);
  }
  /** 배율을 다시 재고, 바뀌었으면 쉬고 있는 방석·완주 말의 크기(ns)와 금 좌대도 맞춘다 */
  function rescale() {
    const ps = calcScale();
    if (Math.abs(ps - PS) <= 0.005) return false;
    PS = ps;
    for (const r of rigList) {
      if (!r.moving && !r.decor && r.home.kind !== 'board') r.a.ns = nestS();
      if (r.ped.visible) r.ped.scale.set(PS * nestS(), r.ped.scale.y, PS * nestS());
    }
    ctx.invalidate();
    return true;
  }

  /* ---------- 스프라이트 ---------- */
  function spriteArt(key) {
    const gold = '#FFC83D';
    if (key === 'dust') return [64, 64, g => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,249,238,0.95)'); gr.addColorStop(0.55, 'rgba(255,249,238,0.55)'); gr.addColorStop(1, 'rgba(255,249,238,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }];
    // 접두사 키: n숫자(칸 수), L번호(선택 핀), b팀숫자(업기 배지). 'bang'·'back'이 배지로 잘못 그려지지 않게 모양까지 본다
    if (/^n\d+$/.test(key)) return [128, 128, g => {
      g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.fillStyle = gold; g.fill(); g.lineWidth = 7; g.strokeStyle = INK; g.stroke();
      text(g, key.slice(1), 64, 69, 78, INK);
    }];
    if (/^L./.test(key)) return [128, 160, g => {
      g.beginPath(); g.arc(64, 60, 52, 0.28 * Math.PI, 0.72 * Math.PI, true); g.lineTo(64, 152); g.closePath();
      g.fillStyle = gold; g.fill(); g.lineWidth = 7; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
      g.beginPath(); g.arc(64, 60, 40, 0, TAU); g.fillStyle = '#FFF6DA'; g.fill();
      text(g, key.slice(1), 64, 64, 70, INK);
    }];
    if (/^b\d\d+$/.test(key)) {
      const tc = TEAM_COLORS[+key[1]] || TEAM_COLORS[0], num = key.slice(2);
      // 흰 알약 모양 "×2": 선택지 번호(색 동그라미)와 헷갈리지 않게 한다
      return [128, 80, g => {
        roundRect(g, 6, 8, 116, 64, 32); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 6; g.strokeStyle = tc.css; g.stroke();
        shapePath(g, tc.shape, 34, 40, 16); g.fillStyle = tc.css; g.fill();
        text(g, '×' + num, 80, 42, 44, INK);
      }];
    }
    switch (key) {
      case 'bang': return [128, 128, g => {
        g.beginPath(); g.arc(64, 60, 48, 0, TAU); g.moveTo(44, 100); g.lineTo(40, 124); g.lineTo(66, 106);
        g.fillStyle = '#FF5A3C'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
        g.beginPath(); g.arc(64, 60, 44, 0, TAU); g.fill();
        text(g, '!', 64, 64, 80, '#FFFFFF');
      }];
      case 'sweat': return [64, 96, g => {
        g.beginPath(); g.moveTo(32, 6); g.bezierCurveTo(40, 30, 56, 48, 56, 64); g.arc(32, 64, 24, 0, Math.PI); g.bezierCurveTo(8, 48, 24, 30, 32, 6);
        g.fillStyle = '#6EC6FF'; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
        g.beginPath(); g.ellipse(24, 64, 5, 9, -0.3, 0, TAU); g.fillStyle = '#fff'; g.fill();
      }];
      case 'star': return [64, 64, g => { starPath(g, 32, 34, 28, 12); g.fillStyle = gold; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke(); }];
      case 'heart': return [64, 64, g => {
        g.beginPath(); g.moveTo(32, 56); g.bezierCurveTo(4, 36, 6, 8, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 20);
        g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 8, 60, 36, 32, 56); g.closePath();
        g.fillStyle = '#FF5C7A'; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
      }];
      case 'z': return [64, 64, g => text(g, 'Z', 32, 35, 52, '#FFFFFF', INK, 8)];
      case 'kong': return [256, 160, g => {
        g.save(); g.translate(128, 80); g.scale(1.55, 1); starPath(g, 0, 0, 74, 54, 12); g.restore();
        g.fillStyle = '#FFE066'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
        text(g, '콩!', 128, 84, 66, INK);
      }];
      case 'back': return [256, 128, g => {
        roundRect(g, 10, 14, 236, 94, 44); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
        text(g, '뒤로 콩!', 128, 64, 52, '#D8402A');
      }];
      case 'short': return [256, 128, g => {
        roundRect(g, 10, 14, 236, 94, 44); g.fillStyle = gold; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
        text(g, '지름길!', 128, 64, 54, INK);
      }];
      case 'again': return [256, 128, g => {
        g.beginPath(); roundRect(g, 8, 8, 240, 88, 40); g.moveTo(96, 94); g.lineTo(84, 124); g.lineTo(124, 94);
        g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
        roundRect(g, 11, 11, 234, 82, 37); g.fill();
        text(g, '다시 올게!', 128, 54, 46, INK);
      }];
      case 'poof': return [160, 128, g => {
        const puffs = [[48, 72, 34], [82, 52, 40], [116, 70, 34], [70, 88, 30], [100, 90, 28]];
        g.fillStyle = '#FFFFFF'; g.lineWidth = 6; g.strokeStyle = INK;
        g.beginPath(); puffs.forEach(([x, y, r]) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }); g.stroke();
        g.beginPath(); puffs.forEach(([x, y, r]) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }); g.fill();
        text(g, '펑', 82, 72, 50, INK);
      }];
    }
    return [8, 8, () => {}];
  }
  const tex = key => { const [w, h, draw] = spriteArt(key); return drawnTex(key, w, h, draw); };

  const pool = [];
  function getSprite(key, depth = false) {
    let s = pool.find(p => !p.userData.busy);
    if (!s) {
      if (pool.length >= 64) return null;
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('dust'), transparent: true, depthWrite: false }));
      s.visible = false; overG.add(s); pool.push(s);
    }
    s.userData.busy = true; s.visible = false;
    s.material.map = tex(key); s.material.depthTest = depth; s.material.opacity = 1; s.material.rotation = 0;
    s.renderOrder = depth ? 3 : 15; s.center.set(0.5, 0.5); s.scale.set(1, 1, 1);
    return s;
  }
  function release(s) { s.userData.busy = false; s.visible = false; }

  /** 화면 고정 크기 스프라이트(선택 번호, 업기 배지, 땀, Z) */
  function fixedSprite(key, px) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(key), transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    s.renderOrder = 20; s.visible = false; s.userData.px = px; s.userData.key = key; overG.add(s);
    return s;
  }
  function setFixedKey(s, key) { if (s.userData.key !== key) { s.userData.key = key; s.material.map = tex(key); } }

  /* ---------- 효과 실행기(ticker가 진행) ---------- */
  const fxs = [];
  function fx(dur, fn, end, delay = 0) {
    fxs.push({ t0: performance.now() + delay * S(), dur: Math.max(1, dur * S()), fn, end, ep: epoch });
    ctx.invalidate();
  }
  function sprFx(key, dur, place, o = {}) {
    const s = getSprite(key, !!o.depth);
    if (!s) return;
    fx(dur, (k, now) => { s.visible = true; place(k, s, now); }, () => release(s), o.delay || 0);
  }
  function fxStep(now) {
    for (let j = fxs.length - 1; j >= 0; j--) {
      const f = fxs[j], k = (now - f.t0) / f.dur;
      if (k < 0) continue;
      f.fn(Math.min(1, k), now);
      if (k >= 1) { fxs.splice(j, 1); if (f.end) f.end(); }
    }
    return fxs.length > 0;
  }

  /** 말 머리 꼭대기 월드 높이 */
  function headTop(r) { return r.root.position.y + (r.lift.position.y + r.topY) * r.root.scale.y; }
  /** 머리 꼭대기 월드 좌표(업힌 말이 앞으로 기댄 만큼 앞·아래로 옮겨 감) */
  function headPt(r, out) {
    const h = (r.lift.position.y + r.topY) * r.root.scale.y, lean = r.root.rotation.x, yaw = r.root.rotation.y, f = h * Math.sin(lean);
    return out.set(r.root.position.x + f * Math.sin(yaw), r.root.position.y + h * Math.cos(lean), r.root.position.z + f * Math.cos(yaw));
  }

  function dust(x, y, z, n) {
    if (lowQ()) return;
    for (let j = 0; j < n; j++) {
      const ang = j / n * TAU + rnd(-0.3, 0.3), dist = rnd(0.25, 0.45) * PS;
      sprFx('dust', 320, (k, s) => {
        const e = ease.outQuad(k), sc = 0.35 * PS * e + 0.05;
        s.position.set(x + Math.sin(ang) * dist * e, y + 0.08 + 0.1 * e, z + Math.cos(ang) * dist * e);
        s.scale.set(sc, sc, 1); s.material.opacity = 0.6 * (1 - k);
      }, { depth: true });
    }
  }
  function numberPop(n, r) {
    const key = 'n' + Math.min(9, n);
    const x = r.root.position.x, z = r.root.position.z, y0 = headTop(r) + 0.3 * PS;
    sprFx(key, 500, (k, s) => {
      const sc = 0.5 * PS * (k < 0.15 ? ease.outBack(k / 0.15) : 1);
      s.position.set(x, y0 + 0.3 * k, z); s.scale.set(sc, sc, 1);
      s.material.opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    });
  }
  function bubbleOver(r, key, dur, w, h, dy = 0.35) {
    sprFx(key, dur, (k, s) => {
      const sc = k < 0.2 ? ease.outBack(k / 0.2) : 1;
      s.position.set(r.root.position.x, headTop(r) + dy * PS + 0.1 * k, r.root.position.z);
      s.scale.set(w * PS * sc, h * PS * sc, 1);
      s.material.opacity = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    });
  }
  function poofAt(x, y, z) {
    sfx('pop');
    sprFx('poof', 420, (k, s) => {
      const sc = 0.5 + 0.5 * ease.outBack(Math.min(1, k * 2));
      s.position.set(x, y + 0.4 * PS, z); s.scale.set(0.9 * PS * sc, 0.72 * PS * sc, 1);
      s.material.opacity = k > 0.5 ? 1 - (k - 0.5) / 0.5 : 1;
    });
  }
  const fxRings = [0, 1].map(() => { const m = new THREE.Mesh(R.ringGeo, R.fxRingMat.clone()); m.visible = false; m.renderOrder = 3; overG.add(m); return m; });
  function goldRing(x, y, z) {
    const m = fxRings.find(q => !q.visible) || fxRings[0];
    m.visible = true;
    fx(500, k => { m.position.set(x, y + 0.02, z); m.scale.setScalar(lerp(0.5, 1.2, ease.outQuad(k)) * PS); m.material.opacity = 0.9 * (1 - k); }, () => { m.visible = false; });
  }
  function confetti(x, y, z, t, count = 32) {
    if (!opts.fx || !opts.fx.confetti || lowQ()) return;
    const tc = TEAM_COLORS[rigs[t] && rigs[t][0] ? rigs[t][0].color : 0].hex;
    const colors = [tc, tc, tc, tc, tc, GOLD, GOLD, GOLD, 0xFFFFFF, 0xFFFFFF];
    try { opts.fx.confetti(new THREE.Vector3(x, y, z), { colors, count: reducedMotion ? 8 : count }); } catch (e) { setTimeout(() => { throw e; }); }
  }

  /* ---------- 몸짓·표정 ---------- */
  function gest(r, kind, ms, o = {}) {
    r.gest.push({ kind, ...o, t0: performance.now() + (o.delay || 0) * S(), dur: Math.max(1, ms * S()) });
    ctx.invalidate();
  }
  function faceOv(r, face, ms, prio = PRIO[face] || 20, delay = 0) {
    const from = performance.now() + delay * S();
    r.ov.push({ face, prio, from, until: from + ms * S() });
    if (r.ov.length > 10) r.ov.shift();
  }
  function isDozing(r) {
    return turn != null && r.t !== turn && r.home.kind === 'nest' && !r.moving && !r.decor && !r.sel && !party;
  }
  function faceOf(r, now) {
    if (r.forceFace) return r.forceFace;
    if (asleep) return 'blink';
    let best = null;
    for (let j = r.ov.length - 1; j >= 0; j--) {
      const o = r.ov[j];
      if (o.until <= now) { r.ov.splice(j, 1); continue; }
      if (o.from > now) continue;
      if (!best || o.prio > best.prio) best = o;
    }
    let f = best ? best.face : null;
    if (r.threat && (!best || best.prio < PRIO.surprised)) f = 'surprised';
    if (!f) f = r.sel || r.party ? 'happy' : (r.home.kind === 'fin' && !r.moving) ? 'proud' : isDozing(r) ? 'blink' : 'idle';
    if (f === 'idle' || f === 'happy') {   // 깜빡임은 대기 시계로 센다
      if (idleT >= r.blinkAt) { r.blinkUntil = idleT + 110; r.blinkAt = Math.random() < 0.15 ? idleT + 250 : idleT + rnd(2500, 5500); }
      if (idleT < r.blinkUntil) f = 'blink';
    }
    return f;
  }

  /* ---------- decor 토큰 ---------- */
  function stopDecor(r) { r.decor = 0; r.tok++; }
  function startDecor(r, fn) {
    const tok = ++r.tok, ep = epoch;
    r.decor = tok;
    const alive = () => r.decor === tok && ep === epoch;
    (async () => {
      try { await fn(alive); } finally { if (alive()) { r.decor = 0; applyHome(r); refreshStacks(); } }
    })();
  }

  /* ---------- 자리 ---------- */
  function slotOf(r, slot) { return nestSlot(r.t, slot, rigs.length, side); }
  function applyHome(r) {
    const h = r.home, a = r.a;
    neutral(a);
    r.moving = false; r.follow = null; r.yawMode = 'camera'; r.yawTau = 0; r.jelly = null;
    if (h.kind === 'board') {
      const q = NODE[h.node] || [0, 0];
      if (h.tier > 0 && h.bottom && h.bottom !== r) { r.ride = h.bottom; r.tier = h.tier; a.x = h.bottom.a.x; a.z = h.bottom.a.z; }
      else { r.ride = null; r.tier = 0; a.x = q[0]; a.z = q[1]; }
      a.y = a.gy = BT; a.ns = 1;
    } else {
      const s = slotOf(r, h.slot);
      r.ride = null; r.tier = 0; a.x = s.x; a.z = s.z; a.ns = nestS();
      a.y = a.gy = h.kind === 'fin' ? NEST_TOP + PED_H : NEST_TOP;
    }
    a.tier = r.tier;
    r.medalOn = h.kind === 'fin';
    placePed(r, h.kind === 'fin');
  }
  function placePed(r, on) {
    r.ped.visible = on;
    if (!on) return;
    const s = slotOf(r, r.home.slot != null ? r.home.slot : r.i);
    r.ped.position.set(s.x, NEST_TOP, s.z);
    r.ped.scale.set(PS * nestS(), 1, PS * nestS());
  }
  function refreshStacks() {
    for (const r of rigList) r.stack = r.ride ? null : [r];
    rigList.filter(r => r.ride).sort((p, q) => p.tier - q.tier).forEach(r => { if (r.ride.stack) r.ride.stack.push(r); });
    for (const r of rigList) updatePick(r);
  }
  /**
   * 탭 대상 정리. 업힌 말의 터치 원기둥은 뒤로 기대어 뒤 칸 말을 가리므로 평소엔 끄고
   * (맨 아래 말을 탭하면 main이 무리 전체로 바꿔 준다), 고를 수 있을 때만 켠다.
   * 고를 수 있는 말과 새로 올릴 수 있는 대기 말은 우선순위를 올려 다른 말보다 먼저 잡히게 한다.
   */
  function updatePick(r) {
    const hi = !!(r.sel || r.pickNew);
    r.proxy.visible = !r.ride || hi;
    // 업힌 말은 받침이 없고 몸통(.31)·머리만 보이므로 원기둥도 가늘게
    const w = r.ride ? 0.72 : 1;
    r.proxy.scale.set(w, 1, w);
    const prio = hi ? PICK_HI : PICK_LO;
    if (r.pickPrio !== prio) { r.pickPrio = prio; ctx.pick.add(r.proxy, { kind: 'piece', t: r.t, i: r.i }, prio); }
  }

  /* ---------- 매 프레임 ---------- */
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const camRight = new THREE.Vector3();

  function compose(r, now, dt, idt) {
    const a = r.a;
    // 잠들면 고르기·위험 표시도 멈춘 채로 둔다(탭하면 깬다)
    let act = r.moving || !!r.decor || ((!!r.sel || r.threat) && !still) || !!r.party;
    let hop = 0, hx = 0, hy = 0, hz = 0, tz = 0, sy = 1, sx = 1, pose = null, wave = 0, tailX = 0, tailY = 0, earX = 0, hs = 1, glow = 0;
    if (r.gest.length) {
      act = true;
      for (let j = r.gest.length - 1; j >= 0; j--) {
        const g = r.gest[j], k = (now - g.t0) / g.dur;
        if (k < 0) continue;
        if (k >= 1) { r.gest.splice(j, 1); continue; }
        switch (g.kind) {
          case 'hop': { const n = g.n || 1, kk = (k * n) % 1; hop += arcH(kk, g.h); if (g.paws) pose = g.paws; if (kk > 0.9) sy *= 1 - 0.1 * (1 - (kk - 0.9) / 0.1); break; }
          case 'squash': { const e = k < 0.3 ? k / 0.3 : 1 - ease.outBack((k - 0.3) / 0.7); sy *= lerp(1, g.y, e); sx *= lerp(1, 1 + (1 - g.y) * 0.6, e); break; }
          case 'recover': { const e = ease.outBack(k); sy *= lerp(g.y, 1, e); sx *= lerp(g.x || 1, 1, e); break; }
          case 'press': { const e = Math.sin(Math.PI * k); sy *= 1 - 0.15 * e; sx *= 1 + 0.15 * e; break; }
          case 'nod': hx += 0.25 * Math.sin(Math.PI * k); break;
          case 'shake': hy += 0.35 * Math.sin(k * TAU * 3); break;
          case 'look': hy += 0.45 * Math.sin(k * TAU); break;
          case 'tilt': hz += 0.3 * Math.sin(Math.PI * k) * (g.dir || 1); break;
          case 'toss': hx -= 0.35 * Math.sin(Math.PI * k); break;
          case 'sniff': hx -= 0.15 * Math.abs(Math.sin(k * TAU)); break;
          case 'paws': pose = g.pose; break;
          case 'wave': pose = 'waveR'; wave = 0.35 * Math.sin(k * TAU * 3); break;
          case 'scratch': pose = 'scratch'; wave = 0.25 * Math.sin(k * TAU * 5); break;
          case 'wag': tailY += (g.amp || 0.45) * Math.sin(k * TAU * (g.n || 4)); break;
          case 'spinTail': tailX += TAU * ease.inOutSine(k); break;
          case 'ears': earX -= 0.3 * Math.abs(Math.sin(k * TAU)); break;
          case 'stretch': { const e = Math.sin(Math.PI * k); sy *= 1 - 0.1 * e; sx *= 1 + 0.05 * e; pose = 'reach'; break; }
          case 'fluff': hs *= 1 + 0.06 * Math.sin(Math.PI * k); break;
          case 'glow': glow = Math.max(glow, Math.sin(Math.PI * k)); break;
          case 'twitch': hop += arcH(k, g.h || 0.15); break;
          case 'tremble': tz += 0.05 * Math.sin(now * TAU * 18 / 1000); break;
        }
      }
    }
    const tier = r.ride ? r.tier : a.tier;
    const free = !r.ride && !r.moving && !r.decor;
    if (r.sel && free && !still) {
      const s = Math.abs(Math.sin(Math.PI * (now - r.sel.ph * S()) / (450 * S())));
      hop += 0.12 * s; sy *= 1 - 0.08 * Math.max(0, 1 - 4 * s);
    }
    if (r.threat && !still) tz += 0.05 * Math.sin(now * TAU * 18 / 1000);
    if (r.party && free) {
      const k = (((now - r.party.t0) / (480 * S())) % 1 + 1) % 1;
      hop += arcH(k, 0.3); if (!pose) pose = 'up';
    }
    // 숨쉬기(위상을 쌓아서 주기가 바뀌어도 튀지 않음)
    const dozy = isDozing(r) || asleep;
    const P = (r.home.kind === 'fin' || dozy) ? 3000 : (turn === r.t ? 1600 : 2400);
    r.br = (r.br + TAU * idt / P) % TAU;
    const b = quality === 'min' ? 0 : Math.sin(r.br) * (reducedMotion ? 0.5 : 1);
    sy *= 1 + 0.03 * b; sx *= 1 - 0.015 * b;
    // 보는 방향
    const lead = r.ride || r.follow;
    let yaw;
    if (lead) { yaw = lead.yaw + lead.a.spin; r.yaw = lead.yaw; }
    else {
      let target, tau;
      if (r.yawMode === 'travel') { target = r.yawTarget; tau = 45; }
      else { const p = lookPt || camPos; target = Math.atan2(p.x - a.x, p.z - a.z); tau = r.yawTau || (lookPt ? 300 : 400); }
      const dd = angTo(r.yaw, target);
      r.yaw += dd * (1 - Math.exp(-dt * 1000 / tau));
      if (Math.abs(dd) > 0.01) act = true;
      yaw = r.yaw + a.spin;
    }
    // 자리
    const sc = PS * tierS(tier) * (r.ride ? r.ride.a.ns * r.ride.a.pop : a.ns) * a.pop;
    if (r.ride) {
      const bt = r.ride, bs = PS * bt.a.ns * bt.a.pop, oy = tierY(tier) * bs, oz = tierZ(tier) * bs;
      r.root.position.set(bt.root.position.x + Math.sin(yaw) * oz, bt.root.position.y + bt.lift.position.y * bt.root.scale.y + oy, bt.root.position.z + Math.cos(yaw) * oz);
    } else r.root.position.set(a.x, a.y, a.z);
    r.root.rotation.set(Math.min(1, tier) * 0.2, yaw, 0);
    r.root.scale.setScalar(Math.max(1e-4, sc));
    // 젤리 탑
    let jel = 0;
    if (r.jelly) {
      const q = (now - r.jelly.t0) / (300 * S());
      if (q >= 1) r.jelly = null; else { jel = r.jelly.amp * Math.cos(q * TAU * 1.5) * (1 - q); act = true; }
    }
    r.lift.position.y = a.hop + hop;
    r.lift.rotation.set(a.tiltX + jel, 0, a.tiltZ + tz);
    r.torso.scale.set(a.sqx * sx, a.sq * sy, a.sqx * sx * a.sqz);
    r.headG.rotation.set(HEAD_TILT + a.headX + hx, hy, hz);
    r.headG.scale.setScalar(hs);
    // 발
    const pn = pose || a.paws || (tier >= 0.5 ? 'hold' : r.orb ? 'orb' : 'rest');
    const pv = PAW[pn] || PAW.rest, kp = 1 - Math.exp(-dt / 0.07);
    let settle = 0;
    for (let j = 0; j < 4; j++) { const d = pv[j] - r.pw[j]; r.pw[j] += d * kp; settle = Math.max(settle, Math.abs(d)); }
    if (settle > 0.01) act = true;
    r.pawL.rotation.set(r.pw[0], 0, r.pw[1]);
    r.pawR.rotation.set(r.pw[2], 0, r.pw[3] + wave);
    if (r.tail) {
      let wag = 0;
      if (r.moving && r.gait.wag) wag = 0.5 * Math.sin(now * TAU * 8 / 1000);
      if (r.moving && r.gait.glide) wag = 0.35 * Math.sin(now * TAU * 2 / 1000);
      // 말: 달리는 동안 꼬리가 들려 휘날린다
      if (r.moving && r.gait.horse) { tailX += 0.55 + 0.15 * Math.sin(now * TAU * 5 / 1000); wag = 0.2 * Math.sin(now * TAU * 3 / 1000); }
      r.tail.rotation.set(r.tailRest + a.tailX + tailX, a.tailY + tailY + wag, 0);
    }
    if (r.earL) {
      const folded = tier >= 0.5, spread = !folded && r.stack && r.stack.length > 1;
      const ex = (folded ? -1.05 : 0) + a.ear + earX, ez = spread ? 0.9 : 0.12;
      r.ew[0] += (ex - r.ew[0]) * kp; r.ew[1] += (ez - r.ew[1]) * kp;
      r.earL.rotation.set(r.ew[0], 0, r.ew[1]); r.earR.rotation.set(r.ew[0], 0, -r.ew[1]);
    }
    const f = faceOf(r, now);
    if (f !== r.faceName) { r.faceName = f; r.face.material = R.faceMat[f] || R.faceMat.idle; }
    // 받침 빛·바닥 링
    const glowSel = !!r.sel && !r.ride && tier < 0.5;
    r.mat.emissiveIntensity = glowSel ? 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(pulseT * TAU * 1.4 / 1000)) : 0;
    r.ring.visible = glowSel;
    if (glowSel) { const e = 0.5 - 0.5 * Math.cos((pulseT % 900) / 900 * TAU); r.ring.scale.setScalar(0.95 + 0.17 * e); }
    r.base.scale.setScalar(tier < 0.5 ? 1 : HIDE);
    r.medal.visible = r.medalOn;
    if (r.orb) r.orb.material.emissiveIntensity = 0.35 + 0.45 * glow;
    return act;
  }

  let pulseT = 0;   // pulseT: 선택·위험 맥동 시각(잠들면 멈춤)
  /** 히트스톱 시계: 멈춘 동안은 멈춘 시각을, 끝나면 멈춘 만큼 효과·몸짓·표정 시각을 뒤로 민다 */
  function holdClock(now) {
    if (!holdTo) return now;
    if (now < holdTo) return holdFrom;
    const d = holdTo - holdFrom;
    holdTo = 0;
    for (const f of fxs) f.t0 += d;
    for (const r of rigList) {
      for (const g of r.gest) g.t0 += d;
      for (const o of r.ov) { o.from += d; o.until += d; }
      if (r.jelly) r.jelly.t0 += d;
    }
    return now;
  }
  function tick(dt, now) {
    const held = !!holdTo && now < holdTo;
    now = holdClock(now);
    if (held) dt = 0;
    if (!rigList.length) return fxStep(now) ? 'active' : false;
    const el = renderer.domElement;
    if (el.clientWidth !== lastW || el.clientHeight !== lastH) {
      lastW = el.clientWidth; lastH = el.clientHeight;
      rescale();
    }
    if (ctx.camera.position.lengthSq() > 1) camPos.copy(ctx.camera.position);
    camRight.setFromMatrixColumn(ctx.camera.matrixWorld, 0);
    // 지난 프레임을 장면이 그렸는지 보고 대기 시계를 흘린다
    const fr = renderer.info.render.frame;
    if (fr !== lastFrame) { lastFrame = fr; lastDraw = now; }
    const idt = !asleep && !held && now - lastDraw < 70 ? dt * 1000 : 0;
    idleT += idt;
    still = asleep || !ctx.idleLive();
    if (!still) pulseT = now;
    let act = fxStep(now) || held;
    for (const r of rigList) if (!r.ride && compose(r, now, dt, idt)) act = true;
    const riders = rigList.filter(r => r.ride).sort((p, q) => p.tier - q.tier);
    for (const r of riders) if (compose(r, now, dt, idt)) act = true;
    if (!asleep && !party && now - lastInput > SLEEP_MS && !fxs.length && rigList.every(r => !r.moving && !r.decor && !r.gest.length)) {
      asleep = true;
      ctx.invalidate();
    }
    // 바닥 그림자, 금 좌대(보이는 것만 앞에 모아 그린다)
    let np = 0;
    rigList.forEach((r, j) => {
      const tier = r.ride ? r.tier : r.a.tier;
      let s = 0;
      if (!r.ride && tier < 0.5) {
        const h = r.lift.position.y * r.root.scale.y + (r.root.position.y - r.a.gy);
        s = r.root.scale.x * (1 - 0.4 * Math.min(1, Math.max(0, h) / 1.2));
      }
      v3.set(r.root.position.x, r.a.gy + 0.006, r.root.position.z);
      s3.set(s || 1e-5, 1, s || 1e-5);
      m4.compose(v3, q0, s3);
      blobs.setMatrixAt(j, m4);
      const pd = r.ped;
      if (pd.visible) { m4.compose(pd.position, q0, pd.scale); peds.setMatrixAt(np++, m4); }
    });
    blobs.instanceMatrix.needsUpdate = true;
    peds.count = np; peds.visible = np > 0;
    peds.instanceMatrix.needsUpdate = true;
    // 선택 링 깜빡임
    const e = 0.5 - 0.5 * Math.cos((pulseT % 900) / 900 * TAU);
    R.ringMat.forEach(m => { m.opacity = 0.5 + 0.45 * e; });
    overlays(now);
    // 버릇(품질을 낮추면 끈다)
    if (now > nextQuirk) {
      nextQuirk = now + rnd(6000, 10000);
      if (now - lastAct < 20000 && !lowQ()) quirk();
    }
    if (party && now > party.until) { for (const r of rigList) r.party = null; party = null; ctx.invalidate(); }
    if (party && now > party.next) {
      party.next = now + 1400 * S();
      const team = rigs[party.t] || [];
      const r = team[Math.floor(Math.random() * team.length)];
      if (r) confetti(r.root.position.x, headTop(r) + 0.5, r.root.position.z, party.t, 24);
    }
    if (act || party) return 'active';
    return !asleep && quality !== 'min';
  }

  /** 화면 고정 스프라이트: 선택 번호, 업기 배지, 땀방울, 졸음 Z */
  function overlays(now) {
    const H = renderer.domElement.clientHeight || 600;
    const kpx = 2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) / H;
    const size = (s, px, ar = 1) => s.scale.set(px * kpx * ar, px * kpx, 1);
    for (const r of rigList) {
      // 선택 번호
      const showL = !!(r.sel && r.sel.label && !r.ride);
      if (showL) {
        if (!r.label) {
          r.label = fixedSprite('L1', 46); r.label.center.set(0.5, 0);
          // 번호 핀을 눌러도 그 무리를 고른 것으로(말 원기둥보다 먼저, 도착 링보다는 나중)
          ctx.pick.add(r.label, { kind: 'piece', t: r.t, i: r.i }, PICK_HI + 0.1);
        }
        setFixedKey(r.label, 'L' + r.sel.label);
        const top = r.sel.top || r;
        const bob = 0.06 * Math.sin(pulseT * TAU * 1.1 / 1000);   // 핀 끝이 머리에 가깝게(옆 칸·방석을 가리키는 것처럼 보이지 않게)
        headPt(top, r.label.position).y += (0.1 + bob) * PS;
        size(r.label, 46, 0.8); r.label.visible = true;
      } else if (r.label) r.label.visible = false;
      // 업기 배지
      const n = r.stack ? r.stack.length : 1;
      if (n > 1 && !r.ride && !r.moving) {
        if (!r.badge) { r.badge = fixedSprite('b00', 30); r.badge.center.set(0, 0.5); }
        setFixedKey(r.badge, 'b' + r.color + n);
        const top = r.stack[n - 1];
        const pop = r.badgePop ? clamp((now - r.badgePop) / (300 * S()), 0, 1) : 1;
        const k = pop < 1 ? lerp(1.4, 1, ease.outBack(pop)) : 1;
        const y = headTop(top) - 0.25 * PS;
        r.badge.position.set(top.root.position.x, y, top.root.position.z).addScaledVector(camRight, 0.32 * PS);
        if (side === 'bottom') keepOffNest(r.badge.position, r.root.position.y + 0.25 * PS, 30 * k);
        size(r.badge, 30 * k, 1.6); r.badge.visible = true;
      } else if (r.badge) r.badge.visible = false;
      // 땀방울
      if (r.threat) {
        if (!r.sweat) { r.sweat = fixedSprite('sweat', 22); }
        const bob = 0.03 * Math.sin(pulseT * TAU * 2 / 1000);
        r.sweat.position.set(r.root.position.x, headTop(r) - 0.12 * PS + bob, r.root.position.z).addScaledVector(camRight, -0.3 * PS);
        size(r.sweat, 22, 0.67); r.sweat.visible = true;
      } else if (r.sweat) r.sweat.visible = false;
    }
    spreadLabels(kpx);
    // 잠들기 Z — 무리마다 맨 위 말 위(멈춘 그림)
    if (asleep) {
      for (const r of rigList) {
        if (!r.stack) continue;
        const top = r.stack[r.stack.length - 1];
        if (!r.zz) r.zz = fixedSprite('z', 22);
        const lean = (r.t + r.i) % 2 ? 1 : -1;
        r.zz.position.set(top.root.position.x, headTop(top) + 0.22 * PS, top.root.position.z).addScaledVector(camRight, 0.2 * PS * lean);
        r.zz.material.opacity = 1; size(r.zz, 22); r.zz.visible = true;
      }
    }
    // 졸음 Z — 팀마다 첫 대기 말 위
    rigs.forEach((team, t) => {
      const zz = zSprites[t] || (zSprites[t] = fixedSprite('z', 20));
      const r = asleep ? null : team.filter(isDozing).sort((p, q) => p.i - q.i)[0];
      if (!r) { zz.visible = false; return; }
      const k = ((idleT + t * 300) % 1200) / 1200;
      zz.position.set(r.root.position.x, headTop(r) + (0.1 + 0.3 * k) * PS, r.root.position.z).addScaledVector(camRight, 0.18 * PS);
      zz.material.opacity = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      size(zz, 20 + 6 * k); zz.visible = true;
    });
  }
  const zSprites = [];

  /**
   * 번호 핀끼리 화면에서 겹치면(업힌 무리 바로 뒤 칸의 말 등) 옆으로 벌린다.
   * 핀은 말 원기둥보다 먼저 잡히므로, 겹치지만 않으면 아이가 번호를 하나씩 누를 수 있다.
   */
  const PIN_W = 46 * 0.8 + 6, PIN_H = 46 + 4;
  function spreadLabels(kpx) {
    const pts = [];
    for (const r of rigList) if (r.label && r.label.visible) { const s = ctx.toScreen(r.label.position); pts.push({ r, x: s.x, y: s.y, dx: 0 }); }
    if (pts.length < 2) return;
    for (let it = 0; it < 3; it++) {
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
        const p = pts[a], q = pts[b], gap = (q.x + q.dx) - (p.x + p.dx);
        const ox = PIN_W - Math.abs(gap), oy = PIN_H - Math.abs(q.y - p.y);
        if (ox <= 0 || oy <= 0) continue;
        const s = gap > 0 || (gap === 0 && p.r.sel.ph <= q.r.sel.ph) ? 1 : -1;
        p.dx -= s * ox / 2; q.dx += s * ox / 2;
      }
    }
    for (const p of pts) {
      if (!p.dx) continue;
      const d = p.r.label.position.distanceTo(ctx.camera.position);
      p.r.label.position.addScaledVector(camRight, p.dx * kpx * d);
    }
  }

  /**
   * 세로 화면에서 판 위쪽 줄의 업기 배지가 뒤 방석(완주 말)을 가리지 않게,
   * 배지 윗변이 판 뒤 가장자리(z = −5.3)보다 화면에서 위로 올라가면 배지를 아래로 내린다.
   */
  const edgeV = new THREE.Vector3(), badgeV = new THREE.Vector3();
  function keepOffNest(p, yMin, px) {
    const edgeY = ctx.toScreen(edgeV.set(p.x, BT, -5.3)).y;
    const scrY = y => ctx.toScreen(badgeV.set(p.x, y, p.z)).y - px / 2;
    if (scrY(p.y) >= edgeY) return;
    let lo = yMin, hi = p.y;
    if (scrY(lo) < edgeY) { p.y = lo; return; }
    for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (scrY(mid) >= edgeY) lo = mid; else hi = mid; }
    p.y = lo;
  }

  function quirk() {
    const cand = rigList.filter(r => !r.moving && !r.decor && !r.sel && !r.threat && !r.party && !r.ride && !r.gest.length && !isDozing(r));
    if (!cand.length) return;
    const r = cand[Math.floor(Math.random() * cand.length)];
    if (Math.random() < 0.35) { gest(r, 'look', 800); return; }
    switch (r.species) {
      case 'horse': gest(r, 'wag', 450, { amp: 0.5, n: 3 }); gest(r, 'toss', 400, { delay: 450 }); break;
      case 'pig': gest(r, 'spinTail', 400); gest(r, 'sniff', 500, { delay: 300 }); break;
      case 'dog': gest(r, 'wag', 480, { amp: 0.45, n: 4 }); gest(r, 'tilt', 600, { dir: Math.random() < 0.5 ? 1 : -1 }); break;
      case 'sheep': gest(r, 'fluff', 300); break;
      case 'cow': gest(r, 'nod', 500); break;
      case 'tiger': gest(r, 'stretch', 500); break;
      case 'rabbit': gest(r, 'ears', 300); break;
      case 'rooster': gest(r, 'nod', 400); gest(r, 'wag', 500, { amp: 0.3, n: 2, delay: 400 }); break;
    }
  }

  ctx.addTicker(tick);

  /* ---------------------------------------------------------------
   * 공개 API
   * --------------------------------------------------------------- */
  function disposeRig(r) {
    if (r.root.parent) r.root.parent.remove(r.root);
    ctx.pick.remove(r.proxy);
    if (r.label) ctx.pick.remove(r.label);
    r.mat.dispose();
    if (r.orb) r.orb.material.dispose();
    r.skin.skeleton.dispose();
    for (const s of [r.label, r.badge, r.sweat, r.zz]) if (s) { overG.remove(s); s.material.dispose(); }
  }

  function hardReset() {
    epoch++;
    fxs.length = 0;
    pool.forEach(release);
    fxRings.forEach(m => { m.visible = false; });
    for (const r of rigList) { stopDecor(r); r.gest.length = 0; r.ov.length = 0; r.party = null; r.moving = false; r.jelly = null; r.follow = null; r.yawTau = 0; }
    party = null;
    holdTo = 0;
  }

  function setTeams(teams) {
    touch();
    hardReset();
    rigList.forEach(disposeRig);
    zSprites.forEach(s => { overG.remove(s); s.material.dispose(); });
    zSprites.length = 0;
    PS = calcScale();
    rigs = (teams || []).map((tm, t) => Array.from({ length: tm.count || 4 }, (_, i) => {
      const r = buildRig(tm.species, tm.color != null ? tm.color : t);
      r.t = t; r.i = i; r.br = i * 0.9 + t * 0.5;
      r.ped = { visible: false, position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1) };   // 금 좌대(인스턴스 한 칸)
      rootG.add(r.root);
      r.home = { kind: 'nest', slot: i, tier: 0 };
      return r;
    }));
    rigList = rigs.flat();
    ensureBlobs(rigList.length);
    if (ctx.camera.position.lengthSq() > 1) camPos.copy(ctx.camera.position);
    for (const r of rigList) { applyHome(r); r.yaw = Math.atan2(camPos.x - r.a.x, camPos.z - r.a.z); }
    refreshStacks();
    // 나중에야 보이는 메시(금 좌대·메달 등)의 셰이더도 지금 만들어 둔다(첫 완주 때 멈칫하지 않게)
    try { renderer.compile(ctx.scene, ctx.camera); } catch (e) { /* 무시 */ }
    ctx.invalidate();
    // 배너·HUD가 곧 쓸 초상화를 쉬는 틈에 미리 구워 둔다(처음 뜨는 배너가 멈칫하지 않게)
    const list = [];
    const res = [...new Set(Object.values(RESULT_SPECIES))];
    const tms = (teams || []).map((tm, t) => [tm.species, tm.color != null ? tm.color : t]);
    tms.forEach(([sp, c]) => list.push([sp, c, 'happy']));
    tms.forEach(([, c]) => res.forEach(sp => list.push([sp, c, 'happy'])));
    tms.forEach(([, c]) => list.push(['pig', c, 'surprised']));
    tms.forEach(([sp, c]) => list.push([sp, c, 'proud'], [sp, c, 'idle']));
    prewarmPortraits(list);
  }

  function sync(state, o = {}) {
    if (!state || !state.teams) return;
    touch();
    if (o.force) hardReset();
    if (state.turn !== undefined) turn = state.turn;
    state.teams.forEach((tm, t) => {
      const team = rigs[t];
      if (!team || !tm || !tm.pieces) return;
      const byNode = new Map();
      tm.pieces.forEach((pc, i) => {
        const r = team[i];
        if (!r) return;
        const pos = pc ? pc.pos : -1;
        if (pos === 99) r.home = { kind: 'fin', slot: i, tier: 0 };
        else if (pos == null || pos < 0 || !NODE[pos]) r.home = { kind: 'nest', slot: i, tier: 0 };
        else {
          r.home = { kind: 'board', node: pos, tier: 0 };
          if (!byNode.has(pos)) byNode.set(pos, []);
          byNode.get(pos).push(r);
        }
      });
      for (const list of byNode.values()) {
        list.sort((p, q) => (p.seq - q.seq) || (p.i - q.i));
        list.forEach((r, k) => { r.home.tier = k; r.home.bottom = list[0]; });
      }
    });
    // 아래 말부터 자리를 잡아야 위층이 따라간다
    const order = rigList.slice().sort((p, q) => (p.home.tier || 0) - (q.home.tier || 0));
    for (const r of order) if (o.force || (!r.decor && !r.moving)) applyHome(r);
    refreshStacks();
    ctx.invalidate();
  }

  /** 화면 방향이 바뀜. 배율도 바로 다시 재서 뒤따르는 sync가 새 배율로 방석 말을 놓게 한다 */
  function setLayout(s) { touch(); side = s === 'right' ? 'right' : 'bottom'; lastW = -1; rescale(); }
  function setTurn(t) { touch(); turn = t; ctx.invalidate(); }

  function cheer(t) {
    touch();
    const team = rigs[t];
    if (!team || !team.length) return;
    const order = team.slice().sort((p, q) => ctx.toScreen(p.root.position).x - ctx.toScreen(q.root.position).x);
    order.forEach((r, j) => {
      if (r.moving) return;
      if (r.home.kind === 'nest') { faceOv(r, 'surprised', 200, 50, j * 60); faceOv(r, 'happy', 900, 20, 200 + j * 60); }
      else faceOv(r, 'happy', 900, 20, j * 60);
      if (!r.ride && !r.decor) gest(r, 'hop', 520, { h: 0.22, n: 2, paws: 'up', delay: j * 60 });
      else gest(r, 'paws', 520, { pose: 'up', delay: j * 60 });
    });
    sfx('cry', { species: team[0].species });
  }

  function reactThrow(t, res) {
    touch();
    const team = rigs[t] || [];
    const idle = r => !r.moving && !r.decor;
    if (res === 1 || res === 2 || res === 3) team.forEach((r, j) => idle(r) && gest(r, 'nod', 400, { delay: j * 40 }));
    else if (res === 4 || res === 5) {
      team.forEach((r, j) => {
        if (!idle(r)) return;
        faceOv(r, 'happy', 900);
        if (!r.ride) gest(r, 'hop', 560, { h: 0.3, n: 2, paws: 'up', delay: j * 50 });
        else gest(r, 'paws', 560, { pose: 'up', delay: j * 50 });
      });
      rigList.forEach(r => { if (r.t !== t && idle(r)) faceOv(r, 'surprised', 600); });
    } else if (res === -1) team.forEach(r => idle(r) && faceOv(r, 'surprised', 500));
    else if (res === 'nak') team.forEach(r => { if (!idle(r)) return; gest(r, 'paws', 500, { pose: 'cover' }); faceOv(r, 'sad', 400, 40, 500); });
  }

  function lookAt(p) { touch(); lookPt = p ? { x: p.x, z: p.z } : null; ctx.invalidate(); }

  function clearSelectable() {
    for (const r of rigList) { r.sel = null; r.pickNew = false; updatePick(r); }
    ctx.invalidate();
  }
  function setSelectable(list) {
    touch();
    for (const r of rigList) { r.sel = null; r.pickNew = false; }
    (list || []).forEach((o, oi) => {
      const team = rigs[o.t];
      if (!team) return;
      let grp;
      if (o.kind === 'new') {
        // 번호·깡충은 첫 대기 말에만, 탭은 방석의 어느 대기 말이든 받는다
        const waiting = team.filter(r => r.home.kind === 'nest' && !r.moving && !r.decor).sort((p, q) => p.i - q.i);
        waiting.forEach(r => { r.pickNew = true; });
        grp = waiting.slice(0, 1);
      } else grp = (o.idx || []).map(i => team[i]).filter(Boolean);
      if (!grp.length) return;
      grp.sort(byTier);
      const label = String(o.label != null ? o.label : oi + 1);
      const top = grp[grp.length - 1];
      grp.forEach((r, j) => { r.sel = { ph: oi * 90, label: j === 0 ? label : null, top, kind: o.kind || 'group' }; });
    });
    for (const r of rigList) updatePick(r);
    ctx.invalidate();
  }

  function clearThreat() { for (const r of rigList) r.threat = false; ctx.invalidate(); }
  function setThreat(list) {
    touch();
    clearThreat();
    (list || []).forEach(o => (o.idx || []).forEach(i => { const r = rigs[o.t] && rigs[o.t][i]; if (r) r.threat = true; }));
  }

  /** 탭했을 때 눌리는 느낌 (게임이 고른 말에 부른다). 소리는 부르는 쪽이 낸다('select') */
  function press(t, i) {
    touch();
    const r = rigs[t] && rigs[t][i];
    if (!r) return;
    gest(r.ride || r, 'press', 160);
  }

  /* ---------- 이동 연출 ---------- */
  const POSE = {};

  /** 한 구간 자세. u: 0..1 (준비 → 비행 → 착지) */
  function segPose(sg, u, o) {
    const A = sg.from, B = sg.to, f = sg.sqf, P = sg.prep, L = sg.land, F = 1 - P - L, g = sg.gait;
    o.hop = 0; o.tiltX = 0; o.tiltZ = 0; o.spin = 0; o.sqz = 1; o.ear = 0; o.L = sg.L0 || 0;
    if (u < P) {
      const k = P ? u / P : 1, e = ease.outQuad(k);
      o.x = A.x; o.y = A.y; o.z = A.z; o.gy = A.gy; o.ns = A.ns;
      o.sq = lerp(sg.sy0, 1 - sg.prepY * f, e); o.sqx = lerp(sg.sx0, 1 + 0.10 * f, e);
      if (g.horse) o.tiltX = lerp(sg.tx0 || 0, -0.25, e);
      if (sg.tilt) o.tiltX = sg.tilt * 0.3 * e;
      if (g.rabbit) o.ear = 0.4 * e;
    } else if (u < P + F) {
      const k = (u - P) / F;
      let e = ease.inOutSine(k);
      if (g.rabbit && sg.kind === 'hop') {
        e = k < 0.45 ? 0.45 * ease.inOutSine(k / 0.45) : 0.45 + 0.55 * ease.inOutSine((k - 0.45) / 0.55);
        o.hop = k < 0.45 ? arcH(k / 0.45, sg.h * 0.56) : arcH((k - 0.45) / 0.55, sg.h);
      } else o.hop = arcH(k, sg.h);
      o.x = lerp(A.x, B.x, e); o.z = lerp(A.z, B.z, e); o.y = lerp(A.y, B.y, e); o.gy = lerp(A.gy, B.gy, e); o.ns = lerp(A.ns, B.ns, ease.outQuad(k));
      const up = k < 0.5 ? 1 - k * 2 : 0, down = k > 0.8 ? (k - 0.8) / 0.2 : 0;
      o.sq = 1 + 0.12 * f * up - 0.05 * f * down; o.sqx = 1 - 0.06 * f * up + 0.03 * f * down;
      if (g.long) { o.sqz = 1 + 0.1 * Math.sin(Math.PI * k); o.sq *= 1 - 0.05 * Math.sin(Math.PI * k); }
      if (g.horse) o.tiltX = lerp(-0.25, 0.15, k);
      if (g.waddle) o.tiltZ = sg.wd * 0.15 * Math.sin(Math.PI * k);
      if (sg.tilt) o.tiltX = sg.tilt * Math.sin(Math.PI * Math.min(1, k * 1.3));
      if (g.rabbit) o.ear = lerp(0.4, -0.2, ease.outQuad(k));
      o.spin = sg.spin * ease.inOutCubic(k);
      o.tiltX += sg.flip * ease.inOutSine(k);
      o.L = lerp(sg.L0 || 0, sg.L1 || 0, ease.inOutSine(k));
    } else {
      const k = L ? (u - P - F) / L : 1;
      o.x = B.x; o.y = B.y; o.z = B.z; o.gy = B.gy; o.ns = B.ns;
      const ly = 1 - sg.landY * f, lx = 1 + 0.12 * f;
      o.sq = sg.hold ? ly : lerp(ly, 1 - 0.15 * f, k); o.sqx = sg.hold ? lx : lerp(lx, 1 + 0.10 * f, k);
      if (g.horse) o.tiltX = lerp(0.15, 0, k);
      if (g.rabbit) o.ear = lerp(-0.2, 0, k);
      o.spin = sg.spin; o.tiltX += sg.flip; o.L = sg.L1 || 0;
    }
    return o;
  }

  function putLead(r, p) {
    const a = r.a;
    a.x = p.x; a.y = p.y; a.z = p.z; a.gy = p.gy; a.ns = p.ns; a.hop = p.hop;
    a.sq = p.sq; a.sqx = p.sqx; a.sqz = p.sqz; a.tiltX = p.tiltX; a.tiltZ = p.tiltZ; a.spin = p.spin % TAU; a.ear = p.ear; a.tier = p.L;
  }
  function putTier(r, lead, p, j) {
    const a = r.a, L = p.L, sc = PS * p.ns;
    const oy = (tierY(L + j) - tierY(L)) * sc, oz = (tierZ(L + j) - tierZ(L)) * sc;
    const yaw = lead.yaw + lead.a.spin;
    a.x = p.x + Math.sin(yaw) * oz; a.z = p.z + Math.cos(yaw) * oz;
    a.y = p.y + p.hop * PS * tierS(L) * p.ns + oy; a.gy = p.gy; a.ns = p.ns; a.hop = 0;
    a.sq = p.sq; a.sqx = p.sqx; a.sqz = p.sqz; a.tiltX = p.tiltX; a.tiltZ = p.tiltZ; a.spin = 0; a.ear = p.ear; a.tier = L + j;
  }

  /** 무리(group)를 한 구간 옮긴다. 위층은 45ms·층 늦게 따라온다 */
  function runSeg(group, sg, alive) {
    const lead = group[0];
    const dx = sg.to.x - sg.from.x, dz = sg.to.z - sg.from.z;
    if (dx * dx + dz * dz > 1e-4) { lead.yawMode = 'travel'; lead.yawTarget = Math.atan2(dx, dz) + (sg.back ? Math.PI : 0); }
    let landed = false, apexed = false;
    const P = sg.prep, F = 1 - sg.prep - sg.land;
    if (sg.onStart) sg.onStart();
    return tween(sg.dur * spd, k => {
      if (!alive()) return;
      group.forEach((r, j) => {
        if (!j) { putLead(r, segPose(sg, k, POSE)); return; }
        const lag = Math.min(0.5, 45 * j / sg.dur);
        putTier(r, lead, segPose(sg, clamp((k - lag) / (1 - lag), 0, 1), POSE), j);
      });
      if (!apexed && k >= P + F * 0.5) { apexed = true; if (sg.onApex) sg.onApex(); }
      if (!landed && k >= P + F) { landed = true; if (sg.onLand) sg.onLand(); }
    });
  }

  const rawWait = ms => new Promise(res => setTimeout(res, ms));
  /** 개발용 시각 기록(막는 구간 계측) */
  const marks = [];
  const mark = name => { marks.push([name, performance.now()]); if (marks.length > 60) marks.shift(); };

  async function move(t, idx, path, o = {}) {
    mark('move');
    try { await moveCore(t, idx, path, o); } finally { mark('resolve'); }
  }

  async function moveCore(t, idx, path, o) {
    touch();
    const team = rigs[t];
    if (!team || !path || !path.length) return;
    const ep = epoch, alive = () => ep === epoch;
    const group = (Array.isArray(idx) ? idx : [idx]).map(i => team[i]).filter(Boolean).sort(byTier);
    if (!group.length) return;
    const lead = group[0], gait = lead.gait, sqf = gait.sq || 1;
    const caught = (o.caught || []).map(([vt, vi]) => rigs[vt] && rigs[vt][vi]).filter(Boolean);
    const last = path.length - 1, fin = path[last] === 'F';
    const destNode = fin ? null : path[last];
    const under = (!fin && (o.stack || o.stack === undefined))
      ? rigList.filter(r => r.t === t && !group.includes(r) && r.home.kind === 'board' && r.home.node === destNode && !r.moving && !r.decor).sort(byTier)
      : [];
    const m = under.length;
    // 준비: 지금 보이는 자리에서 떼어 낸다
    group.forEach((r, j) => {
      stopDecor(r); r.gest.length = 0; r.sel = null; r.pickNew = false; r.threat = false; r.party = null; r.jelly = null;
      const p = r.root.position;
      Object.assign(r.a, { x: p.x, y: p.y, z: p.z });
      r.a.tier = j; r.moving = true; r.ride = null; r.follow = j ? lead : null; r.medalOn = false;
      if (r.ped.visible && r.home.kind !== 'fin') r.ped.visible = false;
    });
    lead.a.tier = 0;
    refreshStacks();
    if (o.back) { group.forEach(r => faceOv(r, 'surprised', 600)); sfx('backdo'); }
    let cur = { x: lead.a.x, y: lead.a.y, z: lead.a.z, gy: lead.a.gy, ns: lead.a.ns };
    let prev = { sy: 1, sx: 1, tx: 0 };
    let hopNo = 0;
    for (let si = 0; si <= last; si++) {
      if (!alive()) return;
      const node = path[si];
      if (node === 'F') { await finishLeap(t, group, cur, prev, alive); return; }
      const isLast = si === last;
      const q = NODE[node] || [0, 0];
      const to = { x: q[0], y: BT, z: q[1], gy: BT, ns: 1 };
      const sg = { from: cur, to, gait, sqf, spin: 0, flip: 0, sy0: prev.sy, sx0: prev.sx, tx0: prev.tx, prepY: 0.15, landY: 0.2, wd: si % 2 ? -1 : 1, kind: 'hop' };
      let kind = 'hop';
      if (si === 0 && o.isNew) kind = 'new';
      if (o.back) kind = 'back';
      if (isLast && caught.length) kind = 'pounce';
      else if (isLast && m) kind = 'mount';
      sg.kind = kind;
      const base = STEP_MS[Math.min(si, 4)];
      if (kind === 'hop') {
        sg.dur = base; sg.h = gait.h; sg.prep = 0.15; sg.land = 0.15;
        if (isLast) { sg.dur = base * 1.3; sg.h = 0.8 * gait.h / 0.55; sg.landY = 0.25; }
      } else if (kind === 'new') {
        sg.dur = 560; sg.h = 2.4; sg.prep = 0.1; sg.land = 0.12; if (isLast) sg.landY = 0.25;
      } else if (kind === 'back') {
        sg.dur = 320; sg.h = 0.35; sg.prep = 0.15; sg.land = 0.15; sg.back = true;
      } else if (kind === 'pounce') {
        sg.dur = POUNCE_MS; sg.h = 1.2; sg.prep = 0.24; sg.land = 0; sg.prepY = 0.3; sg.tilt = 0.35; sg.landY = 0.3; sg.hold = true;
      } else if (kind === 'mount') {
        const ub = under[0], yb = ub.yaw, oz = tierZ(m) * PS;
        sg.to = { x: ub.a.x + Math.sin(yb) * oz, y: BT + tierY(m) * PS, z: ub.a.z + Math.cos(yb) * oz, gy: BT, ns: 1 };
        sg.dur = 420; sg.prep = 0.12; sg.land = 0.1; sg.h = 0.6 + (sg.to.y - cur.y) * 0.5;
        sg.flip = reducedMotion ? 0 : TAU; sg.L0 = 0; sg.L1 = m;
      }
      if (o.isNew && si === 0) {
        sg.from = { ...cur, ns: cur.ns }; sfx('whoosh');
        // 방석에서 바로 덮치거나 업히면 멀리서 오므로 크게 뛴다
        if (kind !== 'new') { sg.h = Math.max(sg.h, 2.0); if (kind === 'mount') sg.dur = 560; }
      }
      if (si === 0 && o.shortcut && !o.back) { sg.spin = reducedMotion ? 0 : TAU; sfx('shortcut'); }
      if (kind === 'pounce') {
        group.forEach(r => { r.a.paws = 'pounce'; faceOv(r, 'effort', 700); });
        caught.forEach(v => {
          v.threat = false; v.sel = null; stopDecor(v);
          faceOv(v, 'surprised', 700, 50);
          gest(v, 'twitch', 150, { h: 0.15 }); gest(v, 'tremble', 500);
          bubbleOver(v, 'bang', 500, 0.45, 0.45, 0.3);
        });
      }
      const lastHop = isLast;
      sg.onLand = () => {
        if (kind === 'pounce') return;
        hopNo++;
        const top = group[group.length - 1];
        if (kind === 'back') bubbleOver(top, 'back', 700, 1.0, 0.5, 0.35);
        else numberPop(hopNo, top);
        sfx('hop', { step: hopNo - 1 });
        const lp = kind === 'mount' ? sg.to : to;
        dust(lp.x, lp.gy, lp.z, lastHop ? 8 : 5);
        if (gait.cow) { sfx('bell'); if (lastHop) { sfx('bigLand'); ctx.shake(0.02, 150); } }
        else if (lastHop && kind !== 'mount') sfx('land');
        group.forEach((r, j) => { if (j) r.jelly = { t0: performance.now(), amp: 0.14 * j }; });
      };
      mark('seg:' + kind);
      const dl = performance.now() + CATCH_MS * S() - SLACK;   // 잡기 마감: 덮치기 시작부터 잰다
      await runSeg(group, sg, alive);
      if (!alive()) return;
      cur = sg.to;
      prev = { sy: 1 - 0.15 * sqf, sx: 1 + 0.10 * sqf, tx: 0 };
      if (kind === 'pounce') await impact(t, group, caught, alive, dl);
      if (!alive()) return;
      if (kind === 'mount') stackLanding(group, under);
    }
    // 끝 자세 정리
    const landY = 1 - (caught.length ? 0.3 : 0.25) * sqf;
    group.forEach((r, j) => {
      r.moving = false; r.follow = null; r.yawMode = 'camera';
      const a = r.a;
      a.hop = 0; a.tiltX = 0; a.tiltZ = 0; a.spin = 0; a.sq = 1; a.sqx = 1; a.sqz = 1; a.ns = 1; a.ear = 0; a.paws = null;
      r.seq = ++seqN;
      if (m) { r.ride = under[0]; r.tier = m + j; r.home = { kind: 'board', node: destNode, tier: m + j, bottom: under[0] }; }
      else { r.ride = j ? lead : null; r.tier = j; r.home = { kind: 'board', node: destNode, tier: j, bottom: lead }; }
      a.tier = r.tier;
      if (!m) { gest(r, 'recover', 120, { y: landY, x: 1 + 0.12 * sqf }); }
    });
    refreshStacks();
    // 지름길 칸에 멈춤
    if (!caught.length && !m && (destNode === 5 || destNode === 10 || destNode === 22)) {
      goldRing(lead.a.x, BT, lead.a.z);
      bubbleOver(group[group.length - 1], 'short', 900, 1.0, 0.5, 0.35);
    }
  }

  /** 업히는 순간 */
  function stackLanding(group, under) {
    const now = performance.now();
    sfx('stack');
    under.forEach(u => { faceOv(u, 'effort', 600, 30); faceOv(u, 'happy', 800, 20, 600); });
    gest(under[0], 'squash', 290, { y: 0.82 });
    group.forEach(r => faceOv(r, 'happy', 1400));
    under[0].badgePop = now;
    const top = group[group.length - 1];
    for (let j = 0; j < 3; j++) {
      const ox = (j - 1) * 0.28 * PS;
      sprFx('heart', 600, (k, s) => {
        s.position.set(top.root.position.x, headTop(top) + (0.1 + 0.6 * k) * PS, top.root.position.z).addScaledVector(camRight, ox);
        const sc = 0.24 * PS * (k < 0.2 ? ease.outBack(k / 0.2) : 1); s.scale.set(sc, sc, 1);
        s.material.opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      }, { delay: j * 80 });
    }
  }

  /** 히트스톱: ms 동안 이 모듈의 효과·몸짓을 멈춘 화면으로 둔다(시간 배율 없음) */
  function hitstop(ms) {
    const now = performance.now();
    holdFrom = now; holdTo = now + ms;
    ctx.invalidate();
  }

  /** 잡기: 충돌 → 히트스톱 → 날려 보내기(막는 구간), 이후는 decor. dl: 막는 구간 마감 시각 */
  async function impact(t, group, caught, alive, dl) {
    const lead = group[0];
    const x = lead.a.x, z = lead.a.z;
    const hit = reducedMotion ? 0 : HITSTOP;
    sfx('capture'); sfx('cry', { species: lead.species, vol: 0.6 });
    ctx.shake(0.06, 200);
    // '콩!'과 찌부는 가장 센 순간부터 보이게 조금 앞당겨 시작한다(히트스톱 동안 그 모습으로 멈춤)
    sprFx('kong', 500, (k, s) => {
      s.renderOrder = 22;   // 잡힌 무리의 업기 배지보다 위에
      const sc = k < 0.4 ? lerp(0.2, 1.1, ease.outBack(k / 0.4)) : 1.1;
      s.position.set(x, BT + 1.25 * PS, z).addScaledVector(camRight, 0.35 * PS); s.scale.set(1.0 * PS * sc, 0.62 * PS * sc, 1);
      s.material.opacity = k > 0.4 ? 1 - (k - 0.4) / 0.6 : 1;
    }, { delay: hit ? -110 : 0 });
    group.forEach(r => { r.a.paws = null; gest(r, 'squash', 230, { y: 0.7, delay: hit ? -69 : 0 }); });
    caught.forEach(v => { faceOv(v, 'dizzy', 2600, 60); v.gest.length = 0; });
    mark('impact');
    if (hit) { hitstop(hit); await rawWait(hit); }
    if (!alive()) return;
    // 날아가기: 마감까지 남은 시간 안에서(실제 ms). victimDecor에는 배율 전 값으로 넘긴다
    const flyReal = clamp(dl - performance.now(), 150 * S(), 600 * S());
    const fly = flyReal / S();
    const n = caught.length;
    caught.forEach((v, j) => {
      v.home = { kind: 'nest', slot: v.i, tier: 0 };
      startDecor(v, al => victimDecor(v, j, n, fly, x, z, al));
    });
    refreshStacks();
    await rawWait(flyReal);
    if (!alive()) return;
    // 잡은 말: 만세 + 두 번 뛰기, 같은 팀도 한 번
    group.forEach(r => faceOv(r, 'happy', 1200));
    gest(lead, 'hop', 440, { h: 0.2, n: 2, paws: 'up' });
    group.slice(1).forEach(r => gest(r, 'paws', 440, { pose: 'up' }));
    (rigs[t] || []).forEach((r, j) => { if (!group.includes(r) && !r.ride && !r.moving && !r.decor) gest(r, 'hop', 260, { h: 0.15, delay: 60 * j }); });
  }

  async function victimDecor(v, j, n, flyMs, cx, cz, alive) {
    const a = v.a, p0 = v.root.position.clone();
    v.ride = null; v.tier = 0; a.tier = 0; v.moving = false; v.follow = null;
    Object.assign(a, { x: p0.x, y: p0.y, z: p0.z, gy: BT, ns: 1, pop: 1, hop: 0 });
    refreshStacks();
    if (j) await wait(70 * j * spd);
    if (!alive()) return;
    const nc = nestCenter(v.t, rigs.length, side);
    let dx = nc.x - cx, dz = nc.z - cz;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const fan = n > 1 ? lerp(-0.52, 0.52, j / (n - 1)) : 0, cf = Math.cos(fan), sf = Math.sin(fan);
    [dx, dz] = [dx * cf - dz * sf, dx * sf + dz * cf];
    const ex = clamp(cx + dx * 1.4 * PS, -4.9, 4.9), ez = clamp(cz + dz * 1.4 * PS, -4.9, 4.9);
    if (reducedMotion) {
      // 움직임 줄이기: 날아가지 않고 사라졌다가 떨어질 자리에 다시 나타난다(합 300ms·SP)
      await tween(150 * spd, k => { if (alive()) a.pop = Math.max(0.001, 1 - k); });
      if (!alive()) return;
      Object.assign(a, { x: ex, z: ez, y: BT, hop: 0, tiltX: 0 });
      v.yawMode = 'camera'; v.yaw = Math.atan2(camPos.x - ex, camPos.z - ez);
      await tween(150 * spd, k => { if (alive()) a.pop = Math.max(0.001, k); });
      if (!alive()) return;
      a.pop = 1;
    } else {
      v.yawMode = 'travel'; v.yawTarget = Math.atan2(cx - ex, cz - ez);
      const roll = -3 * Math.PI;
      await tween(flyMs * spd, k => {
        if (!alive()) return;
        a.x = lerp(p0.x, ex, k); a.z = lerp(p0.z, ez, k); a.y = lerp(p0.y, BT, k);
        a.hop = arcH(k, 1.6); a.tiltX = roll * ease.outQuad(k);
      });
      if (!alive()) return;
      // 두 번 튕기며 바로 서고, 튕기는 동안 플레이어 쪽으로 돌아선다(어지러운 얼굴·말풍선이 보이게)
      v.yawMode = 'camera'; v.yawTau = 130;
      await tween(200 * spd, k => { if (alive()) { a.hop = arcH(k, 0.3); a.tiltX = lerp(roll, -4 * Math.PI, ease.outQuad(k)); } });
      a.tiltX = 0;
      await tween(160 * spd, k => { if (alive()) a.hop = arcH(k, 0.1); });
      if (!alive()) return;
    }
    a.hop = 0;
    // 별 3개 + 도리도리 + 머리 긁기
    for (let s = 0; s < 3; s++) {
      sprFx('star', 900, (k, sp, now) => {
        const ang = s / 3 * TAU + (now / (500 * S())) * TAU;
        sp.position.set(v.root.position.x + Math.cos(ang) * 0.28 * PS, headTop(v) + 0.05 * PS, v.root.position.z + Math.sin(ang) * 0.28 * PS);
        const sc = 0.18 * PS; sp.scale.set(sc, sc, 1); sp.material.opacity = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      });
    }
    gest(v, 'shake', 360);
    gest(v, 'scratch', 700, { delay: 360 });
    await wait(360 * spd);
    if (!alive()) return;
    faceOv(v, 'sad', 900, 61);
    if (!j) bubbleOver(v, 'again', 800, 1.1, 0.55, 0.4);   // 여럿이 잡혀도 말풍선은 하나만(겹치지 않게)
    await wait(600 * spd);
    if (!alive()) return;
    await goNest(v, alive);
  }

  /** 방석 칸으로 종종걸음(멀면 펑 하고 사라졌다 나타남) */
  async function goNest(r, alive) {
    const a = r.a, s = slotOf(r, r.i);
    const y1 = r.home.kind === 'fin' ? NEST_TOP + PED_H : NEST_TOP;
    const x0 = a.x, z0 = a.z, y0 = a.y, ns0 = a.ns;
    const d = Math.hypot(s.x - x0, s.z - z0);
    r.yawMode = 'travel'; r.yawTarget = Math.atan2(s.x - x0, s.z - z0); r.yawTau = 0;
    if (d > 5.4) {
      const run = 1.8 / d;
      await tween(300 * spd, k => { if (!alive()) return; a.x = lerp(x0, s.x, run * k); a.z = lerp(z0, s.z, run * k); a.hop = arcH((k * 3) % 1, 0.1); });
      if (!alive()) return;
      poofAt(a.x, a.gy, a.z);
      await tween(120 * spd, k => { if (alive()) a.pop = 1 - k; });
      if (!alive()) return;
      Object.assign(a, { x: s.x, z: s.z, y: y1, gy: y1, ns: nestS(), hop: 0 });
      r.yawMode = 'camera';
      await wait(140 * spd);
      if (!alive()) return;
      poofAt(s.x, y1, s.z);
      await tween(260 * spd, k => { if (alive()) a.pop = ease.outBack(k); });
    } else {
      const dur = Math.min(900, d / 6 * 1000);
      await tween(dur * spd, k => {
        if (!alive()) return;
        a.x = lerp(x0, s.x, k); a.z = lerp(z0, s.z, k); a.y = lerp(y0, y1, k); a.gy = a.y; a.ns = lerp(ns0, nestS(), k);
        a.hop = arcH((k * dur / 110) % 1, 0.1);
      });
    }
    a.pop = 1;
  }

  /** 완주: 마지막 도약(막는 구간 1160ms) 후 금 좌대로 날아감(decor) */
  async function finishLeap(t, group, from, prev, alive) {
    const lead = group[0], sqf = lead.gait.sq || 1;
    const to = { x: FIN_XZ[0], y: BT, z: FIN_XZ[1], gy: BT, ns: 1 };
    group.forEach(r => faceOv(r, 'proud', 2400, 25));
    const sg = {
      kind: 'finish', from, to, gait: lead.gait, sqf, dur: FIN_LEAP_MS, prep: 60 / FIN_LEAP_MS, land: 60 / FIN_LEAP_MS, h: 1.6,
      spin: reducedMotion ? 0 : TAU, flip: 0, sy0: prev.sy, sx0: prev.sx, tx0: 0, prepY: 0.15, landY: 0.25, hold: true, wd: 1,
    };
    sg.onApex = () => { confetti(lead.a.x, lead.a.y + 1.6 * PS, lead.a.z, t, 32); sfx('finish'); };
    sg.onLand = () => dust(to.x, to.gy, to.z, 8);
    mark('seg:finish');
    const dl = performance.now() + FIN_MS * S() - SLACK;   // 완주 마감: 도약 시작부터 잰다
    await runSeg(group, sg, alive);
    mark('landed');
    if (!alive()) return;
    group.forEach(r => { gest(r, 'recover', 600, { y: 1 - 0.25 * sqf, x: 1 + 0.12 * sqf }); gest(r, 'wave', 600); });
    await rawWait(Math.max(0, dl - performance.now()));
    if (!alive()) return;
    const team = rigs[t] || [];
    group.forEach(r => { r.home = { kind: 'fin', slot: r.i, tier: 0 }; });
    const teamDone = team.every(r => r.home.kind === 'fin');
    group.forEach((r, j) => {
      r.moving = false; r.follow = null;
      startDecor(r, al => toPedestal(r, j, al, teamDone && j === group.length - 1 ? t : -1));
    });
    refreshStacks();
  }

  async function toPedestal(r, j, alive, doneTeam) {
    const a = r.a, p0 = r.root.position.clone();
    r.ride = null; r.tier = 0; a.tier = 0; a.paws = null;
    Object.assign(a, { x: p0.x, y: p0.y, z: p0.z, hop: 0, spin: 0, tiltX: 0, sq: 1, sqx: 1, sqz: 1 });
    refreshStacks();
    if (j) await wait(90 * j * spd);
    if (!alive()) return;
    const s = slotOf(r, r.i), y1 = NEST_TOP + PED_H;
    r.yawMode = 'travel'; r.yawTarget = Math.atan2(s.x - p0.x, s.z - p0.z);
    r.ped.position.set(s.x, NEST_TOP, s.z); r.ped.scale.set(PS * nestS(), 0.001, PS * nestS()); r.ped.visible = true;
    let rose = false;
    await tween(700 * spd, k => {
      if (!alive()) return;
      const e = ease.inOutSine(k);
      a.x = lerp(p0.x, s.x, e); a.z = lerp(p0.z, s.z, e); a.y = lerp(p0.y, y1, e); a.gy = lerp(BT, y1, e);
      a.hop = arcH(k, 1.5); a.ns = lerp(1, nestS(), e);
      if (!rose && k > 0.55) {
        rose = true;
        tween(250 * spd, q => { if (alive()) r.ped.scale.y = Math.max(0.001, ease.outBack(q)); });
      }
    });
    if (!alive()) return;
    r.yawMode = 'camera';
    r.medalOn = true;
    a.hop = 0;
    gest(r, 'squash', 260, { y: 0.8 });
    sfx('land');
    sprFx('star', 500, (k, sp) => {
      sp.position.set(s.x, y1 + (0.9 + 0.3 * k) * PS * nestS(), s.z); const sc = 0.3 * PS * (1 - k * 0.5); sp.scale.set(sc, sc, 1); sp.material.opacity = 1 - k;
    });
    if (doneTeam >= 0) {
      await wait(200 * spd);
      if (!alive()) return;
      sfx('teamDone');
      (rigs[doneTeam] || []).forEach((q, i) => gest(q, 'hop', 720, { h: 0.3, n: 3, paws: 'up', delay: i * 60 }));
      const c = nestCenter(doneTeam, rigs.length, side);
      for (let b = 0; b < 8; b++) fx(1, () => {}, () => confetti(c.x, 1.0, c.z, doneTeam, 18), b * 250);
    }
  }

  /** 도깨비 문: 펑 사라졌다가 칸 node에 펑 나타남 */
  async function teleport(t, idx, node) {
    touch();
    const team = rigs[t];
    if (!team || !NODE[node]) return;
    const ep = epoch, alive = () => ep === epoch;
    const group = (Array.isArray(idx) ? idx : [idx]).map(i => team[i]).filter(Boolean).sort(byTier);
    if (!group.length) return;
    group.forEach(r => { stopDecor(r); r.sel = null; r.threat = false; r.moving = true; r.gest.length = 0; });
    poofAt(group[0].root.position.x, group[0].a.gy, group[0].root.position.z);
    await tween(200 * spd, k => { if (alive()) group.forEach(r => { r.a.pop = 1 - ease.inQuad(k); }); });
    if (!alive()) return;
    const under = rigList.filter(r => r.t === t && !group.includes(r) && r.home.kind === 'board' && r.home.node === node && !r.moving).sort(byTier);
    const m = under.length, lead = group[0];
    group.forEach((r, j) => {
      r.seq = ++seqN;
      if (m) { r.ride = under[0]; r.tier = m + j; r.home = { kind: 'board', node, tier: m + j, bottom: under[0] }; }
      else { r.ride = j ? lead : null; r.tier = j; r.home = { kind: 'board', node, tier: j, bottom: lead }; }
      const a = r.a;
      a.x = NODE[node][0]; a.z = NODE[node][1]; a.y = a.gy = BT; a.ns = 1; a.tier = r.tier; a.hop = 0; a.spin = 0;
    });
    refreshStacks();
    await wait(140 * spd);
    if (!alive()) return;
    poofAt(NODE[node][0], BT, NODE[node][1]);
    group.forEach(r => faceOv(r, 'surprised', 500));
    await tween(260 * spd, k => { if (alive()) group.forEach(r => { r.a.pop = Math.max(0.001, ease.outBack(k)); }); });
    if (!alive()) return;
    group.forEach(r => { r.a.pop = 1; r.moving = false; r.yawMode = 'camera'; });
    if (m) stackLanding(group, under);
  }

  /** 이벤트로 방석에 돌아가기 */
  async function goHome(t, idx) {
    touch();
    const team = rigs[t];
    if (!team) return;
    const ep = epoch, alive = () => ep === epoch;
    const group = (Array.isArray(idx) ? idx : [idx]).map(i => team[i]).filter(Boolean).sort(byTier);
    group.forEach(r => {
      stopDecor(r); r.sel = null; r.threat = false; r.gest.length = 0;
      const p = r.root.position.clone();
      r.ride = null; r.tier = 0; r.follow = null; r.moving = true;
      Object.assign(r.a, { x: p.x, y: p.y, z: p.z, hop: 0, tier: 0 });
      faceOv(r, 'surprised', 500);
    });
    refreshStacks();
    await Promise.all(group.map(async (r, j) => {
      if (j) await wait(80 * j * spd);
      if (!alive()) return;
      await tween(160 * spd, k => { if (alive()) r.a.y = lerp(r.a.y, BT, k); });
      r.home = { kind: 'nest', slot: r.i, tier: 0 };
      await goNest(r, alive);
    }));
    if (!alive()) return;
    group.forEach(r => { r.home = { kind: 'nest', slot: r.i, tier: 0 }; applyHome(r); });
    refreshStacks();
  }

  function celebrate(t, ms = 12000) {
    touch();
    const team = rigs[t];
    if (!team) return;
    const now = performance.now();
    team.forEach((r, j) => { r.party = { t0: now + j * 90 }; });
    party = { t, next: now, until: now + ms };
  }

  /* ---------- 초상화 ---------- */
  const portraits = new Map();
  let pScene = null, pCam = null;
  function portrait(species, color = 0, face = 'happy', size = 128) {
    const key = `${species}|${color}|${face}|${size}`;
    if (portraits.has(key)) return portraits.get(key);
    if (!pScene) {
      pScene = new THREE.Scene();
      pScene.add(new THREE.HemisphereLight(0xfff4e2, 0x8a7457, 1.9));
      const dl = new THREE.DirectionalLight(0xfff0d8, 2.4); dl.position.set(1.2, 3, 4); pScene.add(dl);
      pCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    }
    const r = buildRig(species, color);
    r.face.material = R.faceMat[face] || R.faceMat.happy;
    r.headG.rotation.x = -0.05;
    if (r.orb) { const p = PAW.orb; r.pawL.rotation.set(p[0], 0, p[1]); r.pawR.rotation.set(p[2], 0, p[3]); }
    r.root.rotation.y = 0.18;
    r.proxy.visible = false;
    pScene.add(r.root);
    const top = r.topY + 0.03, bot = -0.02;
    const cy = (top + bot) / 2 - 0.04, half = (top - bot) / 2 + 0.06;
    const dist = half / Math.tan(THREE.MathUtils.degToRad(15)) + 0.3;
    pCam.position.set(0, cy + dist * 0.3, dist); pCam.lookAt(0, cy, 0);
    const S2 = size * 2;
    const rt = new THREE.WebGLRenderTarget(S2, S2, { colorSpace: THREE.SRGBColorSpace });
    const prevRT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(pScene, pCam);
    const px = new Uint8Array(S2 * S2 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, S2, S2, px);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevC, prevA);
    rt.dispose();
    pScene.remove(r.root);
    r.mat.dispose();
    if (r.orb) r.orb.material.dispose();
    r.skin.skeleton.dispose();
    const big = mkCanvas(S2, S2), bg = big.getContext('2d'), img = bg.createImageData(S2, S2);
    for (let y = 0; y < S2; y++) img.data.set(px.subarray((S2 - 1 - y) * S2 * 4, (S2 - y) * S2 * 4), y * S2 * 4);
    bg.putImageData(img, 0, 0);
    const out = mkCanvas(size, size), og = out.getContext('2d');
    og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
    og.drawImage(big, 0, 0, size, size);
    const url = out.toDataURL('image/png');
    portraits.set(key, url);
    ctx.invalidate();
    return url;
  }

  /**
   * 초상화 미리 굽기: list = [[species, color, face, size=128], ...].
   * 쉬는 틈(requestIdleCallback, 없으면 setTimeout)마다 하나씩 굽고, 말이 움직이는 동안은 미룬다.
   */
  const warmQ = [];
  let warmOn = false;
  const idleCall = fn => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 500 }) : setTimeout(() => fn(null), 80));
  function prewarmPortraits(list) {
    for (const it of list || []) {
      const [species, color = 0, face = 'happy', size = 128] = it;
      const key = `${species}|${color}|${face}|${size}`;
      if (!portraits.has(key) && !warmQ.some(q => q.key === key)) warmQ.push({ key, args: [species, color, face, size] });
    }
    if (warmQ.length && !warmOn) { warmOn = true; idleCall(warmStep); }
  }
  function warmStep(dl) {
    warmOn = false;
    if (!warmQ.length || !rootG.parent) return;
    if (!holdTo && !rigList.some(r => r.moving)) {
      do {
        const q = warmQ.shift();
        if (!portraits.has(q.key)) portrait(...q.args);
      } while (warmQ.length && dl && dl.timeRemaining() > 25);
    }
    if (warmQ.length) { warmOn = true; idleCall(warmStep); }
  }

  function setSpeed(mult) { spd = clamp(+mult || 1, 0.2, 2); }
  /** 품질: 'high' | 'low'(먼지·색종이·버릇 끔) | 'min'(low + 숨쉬기 멈춤, 대기 중 다시 그리지 않음) */
  function setQuality(q) { quality = q === 'low' || q === 'min' ? q : 'high'; ctx.invalidate(); }

  function stats() {
    let meshes = 0, tris = 0;
    const triCount = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
    rootG.traverseVisible(o => {
      if (!(o.isMesh || o.isSprite) || (o.material && o.material.visible === false)) return;
      meshes++;
      if (o.geometry) tris += triCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
    });
    const perSpecies = {};
    for (const [k, g] of Object.entries(R.geo)) perSpecies[k.split('|')[0]] = Math.round(triCount(g));
    return { meshes, rigs: rigList.length, tris: Math.round(tris), perSpecies };
  }

  function dispose() {
    ctx.removeTicker(tick);
    window.removeEventListener('pointerdown', onInput, true);
    window.removeEventListener('keydown', onInput, true);
    hardReset();
    rigList.forEach(disposeRig);
    rigs = []; rigList = [];
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts);
    if (rootG.parent) rootG.parent.remove(rootG);
    if (blobs) { blobs.dispose(); peds.dispose(); }
    pool.forEach(s => s.material.dispose());
    zSprites.forEach(s => s.material.dispose());
    fxRings.forEach(m => m.material.dispose());
    trash.forEach(x => x.dispose && x.dispose());
    portraits.clear();
    warmQ.length = 0;
  }

  /** 개발용: 자리·표정 강제 */
  const _debug = {
    place(t, i, x, z, y = BT) {
      const r = rigs[t] && rigs[t][i];
      if (!r) return;
      r.home = { kind: 'board', node: 0, tier: 0 };
      applyHome(r);
      Object.assign(r.a, { x, z, y, gy: y });
      refreshStacks();
    },
    face(t, i, name) { const r = rigs[t] && rigs[t][i]; if (r) r.forceFace = name || null; },
    gesture(t, i, kind, ms, o) { const r = rigs[t] && rigs[t][i]; if (r) gest(r, kind, ms, o); },
    rig(t, i) { return rigs[t] && rigs[t][i]; },
    marks,
    get scale() { return PS; },
    get nestScale() { return nestS(); },
    get quality() { return quality; },
    get warmLeft() { return warmQ.length; },
    get cachedPortraits() { return portraits.size; },
    /** 60초를 기다리지 않고 바로 잠들게 */
    sleep() { lastInput = performance.now() - SLEEP_MS - 1; },
    get asleep() { return asleep; },
    get idleT() { return idleT; },
  };

  return {
    setTeams, sync, setLayout, setTurn, cheer, reactThrow, lookAt,
    setSelectable, clearSelectable, setThreat, clearThreat, press,
    move, teleport, goHome, celebrate, portrait, prewarmPortraits, setSpeed, setQuality, stats, dispose, _debug,
  };
}
