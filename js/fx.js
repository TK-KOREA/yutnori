// 색종이·폭죽·반짝이 효과.
// 입자 종류마다 InstancedMesh 하나(instanceColor)로 그리고, 입자는 미리 잡아 둔 풀을 돌려 쓴다.
// 살아 있는 입자가 있을 때만 ticker가 'active'를 돌려준다(그 밖에는 그리기 루프를 깨우지 않는다).
import * as THREE from 'three';
import { reducedMotion } from './anim.js';
import { BS, BT } from './scene.js';
import { TEAM_COLORS } from './theme.js';

/** 기본 색: 팀 색 4개 + 금색 + 흰색 */
export const FX_COLORS = [...TEAM_COLORS.map(c => c.hex), 0xE8B23A, 0xFFFFFF];
const GOLD = 0xE8B23A;
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

/* 입자 한 개의 칸(Float32Array 한 줄) */
const PX = 0, VX = 3, RX = 6, WX = 9, AGE = 12, LIFE = 13, SIZE = 14, DRAG = 15, GRAV = 16,
  FLA = 17, FLF = 18, PH = 19, LANDED = 20, TWINK = 21, FADE = 22, FDRAG = 23, STRIDE = 24;

/** 5각 별 모양(반지름 1) */
function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.44 : 1, a = Math.PI / 2 + i * Math.PI / 5;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
}

/**
 * createFx(ctx, { floorAt })
 * floorAt(x, z): 판 밖 그 자리 바닥 윗면 높이(예: 멍석이면 짚 높이). 숫자가 아니면 마당 바닥(0)으로 본다.
 */
export function createFx(ctx, opts = {}) {
  let floorFn = typeof opts.floorAt === 'function' ? opts.floorAt : null;
  const tierK = ctx.tier === 'low' ? 0.5 : ctx.tier === 'mid' ? 0.75 : 1;
  const densK = tierK * (reducedMotion ? 0.3 : 1);
  const cap = Math.round(640 * tierK);

  function makePool(geo, mat, n, billboard) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.name = billboard ? 'fx-stars' : 'fx-paper';
    ctx.world.add(mesh);
    return { mesh, cap: n, n: 0, d: new Float32Array(n * STRIDE), col: new Float32Array(n * 3), billboard };
  }
  // 종이(색종이): 빛을 받아 뒤집힐 때마다 반짝인다
  const paperGeo = new THREE.PlaneGeometry(1, 0.62);
  const paperMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  const paper = makePool(paperGeo, paperMat, cap, false);
  // 별(반짝이·폭죽 불꽃): 늘 카메라를 보고, 빛과 상관없이 밝다
  const starGeo = starGeometry();
  const starMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const stars = makePool(starGeo, starMat, Math.round(cap * 0.7), true);
  const pools = [paper, stars];
  const emitters = [];

  const _c = new THREE.Color();
  /** 풀에 입자 하나를 넣는다. 가득 차면 가장 오래된(수명이 거의 끝난) 입자 자리를 쓴다 */
  function spawn(pool, o) {
    let i = pool.n;
    if (i >= pool.cap) {
      let best = 0, bk = -1;
      for (let j = 0; j < pool.n; j++) { const k = pool.d[j * STRIDE + AGE] / pool.d[j * STRIDE + LIFE]; if (k > bk) { bk = k; best = j; } }
      i = best;
    } else pool.n++;
    const d = pool.d, b = i * STRIDE;
    d[b + PX] = o.p.x; d[b + PX + 1] = o.p.y; d[b + PX + 2] = o.p.z;
    d[b + VX] = o.v.x; d[b + VX + 1] = o.v.y; d[b + VX + 2] = o.v.z;
    d[b + RX] = rnd(0, TAU); d[b + RX + 1] = rnd(0, TAU); d[b + RX + 2] = rnd(0, TAU);
    const w = o.spin ?? 0;
    d[b + WX] = rnd(-1, 1) * w; d[b + WX + 1] = rnd(-1, 1) * w; d[b + WX + 2] = rnd(-1, 1) * w;
    d[b + AGE] = 0; d[b + LIFE] = o.life; d[b + SIZE] = o.size; d[b + DRAG] = o.drag ?? 1.5; d[b + GRAV] = o.grav ?? 9;
    d[b + FLA] = o.flutter ?? 0; d[b + FLF] = o.ff ?? 6; d[b + PH] = rnd(0, TAU); d[b + LANDED] = 0;
    d[b + TWINK] = o.twinkle ?? 0; d[b + FADE] = (o.fade ?? 0.35) * o.life;   // 끝에서 작아지는 시간(초)
    d[b + FDRAG] = o.fdrag ?? d[b + DRAG];   // 떨어질 때 세로 저항(종이는 크게 — 팔랑팔랑 천천히)
    _c.set(o.color);
    pool.col[i * 3] = _c.r; pool.col[i * 3 + 1] = _c.g; pool.col[i * 3 + 2] = _c.b;
    return i;
  }
  const pickColor = (colors, k) => colors[(k + Math.floor(Math.random() * colors.length)) % colors.length];
  const vec = (x, y, z) => ({ x, y, z });
  const toP = p => (Array.isArray(p) ? vec(p[0], p[1], p[2]) : vec(p.x, p.y ?? 0, p.z));
  /** 내려앉을 높이: 윷판 위는 판 윗면, 그 밖은 floorAt(멍석 등) 또는 마당 바닥 — 조금 띄워 깜빡이지 않게 */
  function floorAt(x, z) {
    if (Math.abs(x) < BS / 2 && Math.abs(z) < BS / 2) return BT + 0.012;
    let y = null;
    if (floorFn) { try { y = floorFn(x, z); } catch (e) { y = null; } }
    return (typeof y === 'number' && Number.isFinite(y) ? y : 0) + 0.004;
  }

  /* ---------------- 효과 ---------------- */
  /** 색종이 한 번 터뜨리기(위로 퍼졌다 팔랑이며 떨어지다 작아져 사라짐) */
  function confetti(pos, { colors = FX_COLORS, count = 32, power = 1, duration = 900 } = {}) {
    const p = toP(pos);
    if (reducedMotion) {   // 움직임 줄이기: 날아가는 종이 대신 제자리 반짝이 몇 개
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU, r = rnd(0.3, 0.9);
        spawn(stars, {
          p: vec(p.x + Math.cos(a) * r, p.y + rnd(0.1, 0.6), p.z + Math.sin(a) * r), v: vec(0, 0.15, 0),
          life: duration / 1000 * rnd(0.8, 1.1), size: rnd(0.2, 0.32), drag: 2, grav: 0, color: pickColor(colors, k), twinkle: 1, fade: 0.5,
        });
      }
      return;
    }
    const n = Math.max(3, Math.round(count * densK)), pw = power;
    for (let k = 0; k < n; k++) {
      // 분수처럼: 옆으로 넓게, 위로 힘차게 솟았다가 팔랑팔랑 천천히(초속 1.5쯤) 내려온다
      const a = Math.random() * TAU, h = rnd(3, 8) * pw, up = rnd(7, 11) * pw;
      spawn(paper, {
        p: vec(p.x + rnd(-0.2, 0.2), p.y + rnd(0, 0.1), p.z + rnd(-0.2, 0.2)),
        v: vec(Math.cos(a) * h, up, Math.sin(a) * h),
        life: duration / 1000 * rnd(0.8, 1.25), size: rnd(0.32, 0.46), drag: rnd(1.6, 2.2), fdrag: 6, grav: 9,
        flutter: rnd(0.5, 1.0), ff: rnd(5, 9), spin: rnd(6, 14), color: pickColor(colors, k), fade: 0.35,
      });
    }
  }

  /** 폭죽: pos에서 불씨가 height만큼 솟아 별로 터진다(height 0이면 그 자리에서 바로) */
  function fireworks(pos, { colors = FX_COLORS, height = 3.4, count = 90 } = {}) {
    const p = toP(pos);
    if (reducedMotion || height <= 0) { burst(vec(p.x, p.y + (reducedMotion ? height * 0.6 : 0), p.z), colors, count); return; }
    const T = 0.5;
    emitters.push({ kind: 'rocket', p: vec(p.x, p.y, p.z), vy: height / T + 4.5 * T, t: 0, T, colors, count, acc: 0 });
  }
  function burst(p, colors, count) {
    const n = Math.max(6, Math.round(count * densK));
    for (let k = 0; k < n; k++) {
      const u = rnd(-1, 1), a = Math.random() * TAU, r = Math.sqrt(1 - u * u), sp = rnd(6.2, 8.2) * (reducedMotion ? 0.6 : 1);
      spawn(stars, {
        p, v: vec(r * Math.cos(a) * sp, u * sp + 0.8, r * Math.sin(a) * sp),
        life: rnd(1.0, 1.45), size: rnd(0.17, 0.27), drag: 2.3, grav: 2.6, spin: 5, color: pickColor(colors, k), twinkle: 1, fade: 0.45,
      });
    }
    const g = Math.round(n * 0.3);   // 금가루
    for (let k = 0; k < g; k++) {
      const u = rnd(-1, 1), a = Math.random() * TAU, r = Math.sqrt(1 - u * u), sp = rnd(1.5, 3.5);
      spawn(paper, {
        p, v: vec(r * Math.cos(a) * sp, u * sp + 1, r * Math.sin(a) * sp),
        life: rnd(1.3, 1.9), size: rnd(0.1, 0.15), drag: 2.6, grav: 3.5, flutter: 0.4, ff: 7, spin: 12, color: GOLD, fade: 0.4,
      });
    }
  }

  /** 색종이 비: duration 동안 화면 위에서 내려와 판 위에 잠깐 쌓였다 사라진다(움직임 줄이기면 없음) */
  function rain({ colors = FX_COLORS, duration = 3500 } = {}) {
    if (reducedMotion) return;
    emitters.push({ kind: 'rain', t: 0, T: duration / 1000, colors, rate: 80 * tierK, acc: 0, area: viewArea(), k: 0 });
  }
  /** 지금 카메라에 보이는 바닥 네모(대략) */
  function viewArea() {
    const cam = ctx.camera, ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
      if (!ray.ray.intersectPlane(plane, hit) || hit.distanceTo(cam.position) > 80) continue;
      x0 = Math.min(x0, hit.x); x1 = Math.max(x1, hit.x); z0 = Math.min(z0, hit.z); z1 = Math.max(z1, hit.z);
    }
    if (!isFinite(x0)) return { x0: -8, x1: 8, z0: -8, z1: 10 };
    return { x0: Math.max(x0, -16), x1: Math.min(x1, 16), z0: Math.max(z0 - 3, -16), z1: Math.min(z1, 18) };
  }

  /** 반짝이: pos 둘레에 작은 별들이 반짝이며 떠오른다 */
  function sparkle(pos, { color = 0xFFD54A, count = 14 } = {}) {
    const p = toP(pos), n = Math.max(4, Math.round(count * (reducedMotion ? 0.4 : tierK)));
    const cols = [color, 0xFFFFFF, GOLD];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, r = rnd(0.15, 0.7);
      spawn(stars, {
        p: vec(p.x + Math.cos(a) * r, p.y + rnd(0, 0.5), p.z + Math.sin(a) * r),
        v: vec(Math.cos(a) * rnd(0.3, 0.9), rnd(0.6, 1.6), Math.sin(a) * rnd(0.3, 0.9)),
        life: rnd(0.6, 1.0), size: rnd(0.2, 0.36), drag: 1.8, grav: -0.4, spin: 3, color: cols[k % 3], twinkle: 1, fade: 0.5,
      });
    }
  }

  function clear() {
    emitters.length = 0;
    pools.forEach(pl => { pl.n = 0; pl.mesh.count = 0; });
    ctx.invalidate();
  }

  /* ---------------- 매 프레임 ---------------- */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _e = new THREE.Euler(),
    _p = new THREE.Vector3(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

  function runEmitters(dt) {
    for (let i = emitters.length - 1; i >= 0; i--) {
      const em = emitters[i];
      em.t += dt;
      if (em.kind === 'rocket') {
        em.p.y += (em.vy - 9 * em.t) * dt;
        em.acc += dt * 60;
        while (em.acc >= 1) {   // 불씨 꼬리
          em.acc--;
          spawn(stars, {
            p: vec(em.p.x + rnd(-0.04, 0.04), em.p.y, em.p.z + rnd(-0.04, 0.04)), v: vec(rnd(-0.3, 0.3), rnd(-1.2, -0.3), rnd(-0.3, 0.3)),
            life: rnd(0.25, 0.4), size: rnd(0.09, 0.15), drag: 3, grav: 1, color: Math.random() < 0.6 ? GOLD : 0xFFF2C4, fade: 0.8,
          });
        }
        if (em.t >= em.T) { burst(vec(em.p.x, em.p.y, em.p.z), em.colors, em.count); emitters.splice(i, 1); }
      } else if (em.kind === 'rain') {
        if (em.t >= em.T) { emitters.splice(i, 1); continue; }
        em.acc += dt * em.rate;
        const A = em.area;
        while (em.acc >= 1) {
          em.acc--;
          spawn(paper, {
            p: vec(rnd(A.x0, A.x1), rnd(6.5, 9.5), rnd(A.z0, A.z1)), v: vec(rnd(-0.4, 0.4), rnd(-2.5, -1), rnd(-0.4, 0.4)),
            life: 7, size: rnd(0.22, 0.32), drag: 3.2, grav: 9, flutter: rnd(0.7, 1.4), ff: rnd(3, 6), spin: rnd(4, 9),
            color: pickColor(em.colors, em.k++), fade: 0.15,
          });
        }
      }
    }
  }

  function step(pool, dt) {
    const d = pool.d, col = pool.col;
    for (let i = pool.n - 1; i >= 0; i--) {
      const b = i * STRIDE;
      d[b + AGE] += dt;
      if (d[b + AGE] >= d[b + LIFE]) {   // 죽은 입자: 맨 끝 입자를 이 자리로(빈틈 없이)
        const last = --pool.n;
        if (i !== last) { d.copyWithin(b, last * STRIDE, last * STRIDE + STRIDE); col.copyWithin(i * 3, last * 3, last * 3 + 3); }
        continue;
      }
      if (d[b + LANDED]) continue;
      const k = Math.exp(-d[b + DRAG] * dt), age = d[b + AGE];
      const ky = d[b + VX + 1] < 0 ? Math.exp(-d[b + FDRAG] * dt) : k;   // 떨어질 때는 세로 저항을 따로
      d[b + VX] *= k; d[b + VX + 2] *= k;
      d[b + VX + 1] = d[b + VX + 1] * ky - d[b + GRAV] * dt;
      const fl = d[b + FLA];
      d[b + PX] += (d[b + VX] + Math.sin(age * d[b + FLF] + d[b + PH]) * fl) * dt;
      d[b + PX + 1] += d[b + VX + 1] * dt;
      d[b + PX + 2] += (d[b + VX + 2] + Math.cos(age * d[b + FLF] * 0.8 + d[b + PH]) * fl) * dt;
      d[b + RX] += d[b + WX] * dt; d[b + RX + 1] += d[b + WX + 1] * dt; d[b + RX + 2] += d[b + WX + 2] * dt;
      if (!pool.billboard) {
        const fy = floorAt(d[b + PX], d[b + PX + 2]);
        if (d[b + PX + 1] <= fy && d[b + VX + 1] < 0) {   // 내려앉기: 판판하게 눕고 잠깐 뒤 작아지며 사라진다
          d[b + PX + 1] = fy + Math.random() * 0.004;
          d[b + LANDED] = 1; d[b + RX] = -Math.PI / 2; d[b + RX + 1] = 0;
          const left = d[b + LIFE] - age;
          if (left > d[b + FADE]) { d[b + LIFE] = Math.min(d[b + LIFE], age + rnd(0.9, 1.5)); d[b + FADE] = Math.min(d[b + FADE], (d[b + LIFE] - age) * 0.7); }
        }
      }
    }
  }

  function write(pool) {
    const d = pool.d, arr = pool.mesh.instanceMatrix.array, carr = pool.mesh.instanceColor.array, camQ = ctx.camera.quaternion;
    for (let i = 0; i < pool.n; i++) {
      const b = i * STRIDE, age = d[b + AGE], life = d[b + LIFE], left = life - age;
      let s = d[b + SIZE] * Math.min(1, age / 0.06);
      const ft = d[b + FADE];
      if (left < ft) s *= Math.max(0, left / ft);
      if (d[b + TWINK]) s *= 0.72 + 0.28 * Math.sin(age * 26 + d[b + PH]);
      _p.set(d[b + PX], d[b + PX + 1], d[b + PX + 2]);
      if (pool.billboard) _q.copy(camQ).multiply(_qz.setFromAxisAngle(_z, d[b + RX + 2]));
      else _q.setFromEuler(_e.set(d[b + RX], d[b + RX + 1], d[b + RX + 2], 'YXZ'));
      _m.compose(_p, _q, _s.set(s, s, s)).toArray(arr, i * 16);
    }
    carr.set(pool.col.subarray(0, pool.n * 3));
    pool.mesh.count = pool.n;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.instanceColor.needsUpdate = true;
  }

  let wasLive = false;
  function tick(dt) {
    if (!emitters.length && !paper.n && !stars.n) {
      if (wasLive) { wasLive = false; pools.forEach(pl => { pl.mesh.count = 0; }); ctx.invalidate(); }
      return undefined;
    }
    runEmitters(dt);
    pools.forEach(pl => { step(pl, dt); write(pl); });
    wasLive = true;
    return 'active';
  }
  ctx.addTicker(tick);

  function dispose() {
    ctx.removeTicker(tick);
    pools.forEach(pl => pl.mesh.removeFromParent());
    [paperGeo, paperMat, starGeo, starMat].forEach(x => x.dispose());
    pools.forEach(pl => pl.mesh.dispose());
    ctx.invalidate();
  }

  /** 내려앉을 바닥 높이 함수를 나중에 바꾼다(createFx 뒤에 멍석이 생길 때) */
  function setFloor(fn) { floorFn = typeof fn === 'function' ? fn : null; }

  return {
    confetti, fireworks, rain, sparkle, clear, dispose, setFloor,
    /** 살아 있는 입자 수(시험용) */
    get live() { return paper.n + stars.n; },
  };
}
