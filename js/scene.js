// 3D 장면의 뼈대: 렌더러, 카메라, 조명, 그리기 루프, 터치(돌리기·확대·고르기·쓸어 던지기).
// 윷판·말·윷가락 모듈은 여기서 만든 ctx를 받아 장면에 물건을 올린다.
import * as THREE from 'three';
import { nodeLayout } from './rules.js';
import { step as stepTweens, onTweenStart, tween, ease, reducedMotion } from './anim.js';

/** 판 크기(월드 단위) */
export const H = 4;          // 바깥 네모의 반 변(칸 중심 기준)
export const BS = 10.6;      // 윷판 한 변
export const BT = 0.35;      // 윷판 두께(윗면 높이)
export const NODE = nodeLayout(H);

/** 기기 성능 등급: high | mid | low */
function detectTier(pref) {
  if (pref === 'low' || pref === 'high' || pref === 'mid') return pref;
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mem <= 2 || (coarse && cores <= 4)) return 'low';
  if (coarse) return 'mid';
  return 'high';
}

export function createScene(stage, opts = {}) {
  const tier = detectTier(opts.tier);
  const dprCap = tier === 'high' ? 2 : tier === 'mid' ? 1.5 : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = tier !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.insertBefore(canvas, stage.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);

  const hemi = new THREE.HemisphereLight(0xfff4e2, 0x8a7457, 1.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.position.set(7, 18, 10);
  sun.castShadow = renderer.shadowMap.enabled;
  const sm = tier === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  sun.target.position.set(0, 0, 1.5);
  scene.add(sun, sun.target);

  const world = new THREE.Group();
  scene.add(world);

  /* ---------------- 그리기 루프 ---------------- */
  let dirty = true, lastRender = 0, lastIdle = 0, lastPoke = performance.now(), last = performance.now();
  const tickers = new Set();
  const invalidate = () => { dirty = true; };
  onTweenStart(invalidate);
  const poke = () => { lastPoke = performance.now(); dirty = true; };

  let shakeAmp = 0, shakeEnd = 0, shakeDur = 1;
  const shakeOff = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let active = stepTweens(now);
    let idle = false;
    for (const fn of tickers) { const r = fn(dt, now); if (r === 'active') active = true; else if (r) idle = true; }
    if (now < shakeEnd) {
      const k = (shakeEnd - now) / shakeDur, a = shakeAmp * k;
      shakeOff.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6, (Math.random() - 0.5) * a);
      active = true;
    } else shakeOff.set(0, 0, 0);
    if (camAnim) active = true;
    const idleOk = idle && now - lastPoke < 20000 && now - lastIdle > 33;
    if (active || dirty || gesture || idleOk || (now - lastRender > 1000 && now - lastPoke < 20000)) {
      if (idleOk) lastIdle = now;
      placeCamera();
      renderer.render(scene, camera);
      dirty = false;
      lastRender = now;
    }
  }

  /* ---------------- 카메라 ---------------- */
  const target = new THREE.Vector3();
  const cam = { theta: 0, phi: 0.7, r: 25, zoom: 1, base: 25 };
  let camAnim = null;       // 진행 중인 화면 맞춤 전환
  let framing = 'throw';
  let matSide = 'bottom';   // 멍석 위치: 세로 화면은 아래(bottom), 가로 화면은 오른쪽(right)
  const boxes = { board: null, mat: null };
  const listeners = { layout: [] };

  function placeCamera() {
    const r = cam.r * cam.zoom;
    camera.position.set(
      target.x + r * Math.sin(cam.phi) * Math.sin(cam.theta),
      target.y + r * Math.cos(cam.phi),
      target.z + r * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.position.add(shakeOff);
    camera.lookAt(target.x + shakeOff.x, target.y, target.z + shakeOff.z);
  }

  /** box = {x0,x1,z0,z1,y1}이 화면에 다 들어오는 카메라 거리 */
  function fitRadius(box, phi, tgt) {
    const pts = [];
    for (const x of [box.x0, box.x1]) for (const z of [box.z0, box.z1]) for (const y of [0, box.y1 || 1.2]) pts.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    const save = { theta: cam.theta, phi: cam.phi, r: cam.r, zoom: cam.zoom }, st = target.clone();
    cam.theta = 0; cam.phi = phi; cam.zoom = 1; target.copy(tgt);
    const sx = shakeOff.clone(); shakeOff.set(0, 0, 0);
    let lo = 3, hi = 200;
    const top = stage.clientHeight > stage.clientWidth ? 0.86 : 0.9;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      cam.r = mid; placeCamera(); camera.updateMatrixWorld(true);
      let ok = true;
      for (const p of pts) { v.copy(p).project(camera); if (v.x < -0.96 || v.x > 0.96 || v.y < -0.94 || v.y > top) { ok = false; break; } }
      if (ok) hi = mid; else lo = mid;
    }
    Object.assign(cam, save); target.copy(st); shakeOff.copy(sx);
    return hi;
  }

  function unionBox(a, b) {
    return { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1), y1: Math.max(a.y1 || 1, b.y1 || 1) };
  }

  function goalFor(mode) {
    const bb = boxes.board || { x0: -5.5, x1: 5.5, z0: -5.5, z1: 5.5, y1: 1.3 };
    const box = (mode === 'throw' && boxes.mat) ? unionBox(bb, boxes.mat) : bb;
    // 세로로 긴 화면은 조금 더 위에서 내려다봐 판을 세로로 넉넉하게 쓴다
    const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    const phi = matSide === 'right' ? 0.62 : aspect < 0.75 ? 0.56 : 0.7;
    const tgt = new THREE.Vector3((box.x0 + box.x1) / 2, 0, (box.z0 + box.z1) / 2);
    return { tgt, r: fitRadius(box, phi, tgt), phi };
  }

  /** 화면 비율에 맞춰 크기·멍석 위치를 정하고 카메라를 맞춘다 */
  let sideKey = '', sideH = 0;
  function resize(resetAngles) {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 멍석 위치는 창 크기가 바뀔 때만 다시 정한다. 아래 패널이 커졌다 작아졌다 해도(결과·선택지) 흔들리지 않게
    // 그 창 크기에서 가장 컸던 무대 높이를 기준으로 삼는다.
    const key = innerWidth + 'x' + innerHeight;
    if (key !== sideKey) { sideKey = key; sideH = 0; }
    const sideEl = document.getElementById('side');
    const stacked = sideEl && getComputedStyle(sideEl).display === 'contents';
    const grow = stacked ? ['choices', 'tokens', 'realPad'].reduce((a, id) => a + ((document.getElementById(id) || {}).offsetHeight || 0), 0) : 0;
    sideH = Math.max(sideH, h + grow);
    const side = w / sideH > 1.12 ? 'right' : 'bottom';
    if (side !== matSide) { matSide = side; listeners.layout.forEach(f => f(side)); }
    if (resetAngles) { cam.theta = 0; cam.zoom = 1; }
    const g = goalFor(framing);
    if (!resetAngles && !reducedMotion && camAnim) glide(g, 300);
    else {
      target.copy(g.tgt); cam.r = g.r; cam.base = g.r;
      if (resetAngles) cam.phi = g.phi;
      camAnim = null;
    }
    // 크기를 바꾸면 캔버스가 지워지므로 바로 한 번 그린다(한 프레임 빈 화면이 번쩍이지 않게)
    placeCamera();
    renderer.render(scene, camera);
    invalidate();
  }

  /** 카메라를 목표 자리로 부드럽게 옮긴다 */
  function glide(g, ms) {
    const t0 = target.clone(), r0 = cam.r, my = {};
    camAnim = my;
    tween(ms, k => {
      if (camAnim !== my) return;
      const e = ease.inOutCubic(k);
      target.lerpVectors(t0, g.tgt, e);
      cam.r = r0 + (g.r - r0) * e;
      if (k >= 1) { camAnim = null; cam.base = g.r; }
    });
  }

  /** 'board'(판만 크게) 또는 'throw'(판 + 멍석)로 부드럽게 전환 */
  function setFraming(mode, instant) {
    if (mode === framing && !instant) return;
    framing = mode;
    const g = goalFor(mode);
    if (instant || reducedMotion) { target.copy(g.tgt); cam.r = g.r; cam.base = g.r; invalidate(); return; }
    glide(g, 650);
  }

  function resetView() { cam.theta = 0; cam.zoom = 1; const g = goalFor(framing); cam.phi = g.phi; target.copy(g.tgt); cam.r = g.r; invalidate(); }

  function shake(amp, ms) {
    if (reducedMotion) return;
    shakeAmp = amp; shakeDur = ms; shakeEnd = performance.now() + ms; invalidate();
  }

  /** 잠깐 확대했다 돌아오기(윷·모, 잡기). focus={x,z}를 주면 그쪽으로 살짝 다가간다 */
  function punch(amount, ms, focus) {
    if (reducedMotion) return Promise.resolve();
    const z0 = cam.zoom, t0 = target.clone(), my = {};
    camAnim = camAnim || my;
    return tween(ms, k => {
      const s = Math.sin(Math.PI * k);
      cam.zoom = z0 * (1 - amount * s);
      if (focus && camAnim === my) { target.x = t0.x + (focus.x - t0.x) * amount * 1.6 * s; target.z = t0.z + (focus.z - t0.z) * amount * 1.6 * s; }
      if (k >= 1 && camAnim === my) camAnim = null;
    });
  }

  /* ---------------- 터치 ---------------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickables = new Map();  // Object3D → { data, prio }
  let flickZones = [];
  let onPick = null, onFlick = null, canFlick = () => false;
  const ptrs = new Map();
  let drag = null, pinch = null, gesture = false;

  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pickAt(cx, cy) {
    if (!pickables.size) return null;
    setRay(cx, cy);
    const objs = [...pickables.keys()].filter(o => o.visible !== false && isShown(o));
    const hits = ray.intersectObjects(objs, true);
    let best = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !pickables.has(o)) o = o.parent;
      if (!o) continue;
      const p = pickables.get(o);
      if (!best || p.prio > best.prio || (p.prio === best.prio && h.distance < best.dist)) best = { ...p, dist: h.distance };
    }
    return best ? best.data : null;
  }
  function isShown(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // 오른쪽·가운데 버튼은 무시(터치·펜은 그대로)
    poke();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    if (ptrs.size === 1) {
      let flick = false;
      if (canFlick() && flickZones.length) { setRay(e.clientX, e.clientY); flick = ray.intersectObjects(flickZones, true).length > 0; }
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, th: cam.theta, ph: cam.phi, flick };
    } else if (ptrs.size === 2) {
      drag = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.zoom };
    }
    gesture = true;
  });
  canvas.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      cam.zoom = Math.min(1.6, Math.max(0.5, pinch.z * pinch.d / d));
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const wasStill = drag.moved <= 8;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if (drag.flick) { if (wasStill) drag.t = performance.now(); return; }  // 손가락을 올려 두고 겨눈 시간은 세지 않는다
    if (drag.moved > 8) {
      cam.theta = drag.th - dx * 0.006;
      cam.phi = Math.min(1.15, Math.max(0.15, drag.ph - dy * 0.005));
    }
  });
  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && ptrs.size === 0) {
      const dy = e.clientY - drag.y, dt = performance.now() - drag.t;
      if (drag.flick) {
        if (dy < -30) onFlick && onFlick(dt < 1000 ? Math.min(1, -dy / 260) : 0.3);
        else if (drag.moved <= 8) onFlick && onFlick(0.5);
      } else if (drag.moved <= 8) {
        const d = pickAt(e.clientX, e.clientY);
        onPick && onPick(d, e);
      }
      drag = null;
    }
    if (!ptrs.size) gesture = false;
    invalidate();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('contextmenu', e => e.preventDefault());   // 판 위에서는 브라우저 메뉴를 띄우지 않는다
  canvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (!ptrs.size) { drag = null; pinch = null; gesture = false; } });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = Math.min(1.6, Math.max(0.5, cam.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    poke();
  }, { passive: false });

  // 화면이 가려져 그리기가 멈춰도 연출 시간은 흘러가게 한다(경기가 멈춰 서지 않도록)
  setInterval(() => { if (document.hidden) stepTweens(performance.now()); }, 200);

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', () => { invalidate(); });

  if (window.ResizeObserver) new ResizeObserver(() => resize(false)).observe(stage);
  else window.addEventListener('resize', () => resize(false));

  const tmp = new THREE.Vector3();
  const ctx = {
    THREE, renderer, scene, camera, canvas, world, sun, hemi, tier,
    invalidate, poke,
    /** 최근 20초 안에 입력이 있었는가(없으면 대기 동작을 멈춘다) */
    idleLive: () => performance.now() - lastPoke < 20000,
    addTicker(fn) { tickers.add(fn); invalidate(); return () => tickers.delete(fn); },
    removeTicker(fn) { tickers.delete(fn); },
    /** 칸 n 위의 k번째(업힌 순서) 자리 — 말 모듈이 더 정교한 배치를 쓸 수 있다 */
    nodeXZ(n) { return NODE[n]; },
    get matSide() { return matSide; },
    onLayout(fn) { listeners.layout.push(fn); },
    setBoxes(b) { Object.assign(boxes, b); },
    resize, setFraming, resetView, shake, punch,
    get framing() { return framing; },
    pick: {
      add(obj, data, prio = 0) { pickables.set(obj, { data, prio }); },
      remove(obj) { pickables.delete(obj); },
      clear(pred) { for (const [o, p] of pickables) if (!pred || pred(p.data)) pickables.delete(o); },
    },
    setFlickZones(objs) { flickZones = objs; },
    onPick(fn) { onPick = fn; },
    onFlick(fn, can) { onFlick = fn; canFlick = can; },
    /** 월드 좌표 → 화면(stage 기준) 픽셀 */
    toScreen(v) {
      tmp.copy(v).project(camera);
      return { x: (tmp.x + 1) / 2 * stage.clientWidth, y: (1 - tmp.y) / 2 * stage.clientHeight, behind: tmp.z > 1 };
    },
    start() { resize(true); requestAnimationFrame(frame); },
  };
  return ctx;
}
