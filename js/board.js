// 윷판, 배경(한옥 마당), 팀 방석, 잔치 칸 토큰, 선택 표시(링·번호·발자국).
import * as THREE from 'three';
import { H, BS, BT, NODE } from './scene.js';
import { EDGES, CORNER, FIN } from './rules.js';
import { FIN_XZ, NEST_SIZE, NEST_TOP, nestCenter, boardBox } from './layout.js';
import { TEAM_COLORS, INK } from './theme.js';
import { TILES } from './party.js';
import { tween, ease } from './anim.js';

export const FONT = '"Jua", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

function canvasTex(c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (aniso) t.anisotropy = aniso;
  return t;
}

/** 팀 모양 경로 (캔버스) */
export function shapePath(g, shape, cx, cy, r) {
  g.beginPath();
  if (shape === 'circle') g.arc(cx, cy, r, 0, Math.PI * 2);
  else if (shape === 'square') { const s = r * 0.86; g.roundRect ? g.roundRect(cx - s, cy - s, s * 2, s * 2, s * 0.25) : g.rect(cx - s, cy - s, s * 2, s * 2); }
  else if (shape === 'triangle') { g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.95, cy + r * 0.7); g.lineTo(cx - r * 0.95, cy + r * 0.7); g.closePath(); }
  else { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); }
}

/** 매화 모양(모서리·방 칸) */
function blossom(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    g.moveTo(cx + Math.cos(a) * r * 0.55 + r * 0.5, cy + Math.sin(a) * r * 0.55);
    g.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2);
  }
}

function boardTexture(N) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const u = N / BS;                         // 1 월드 단위 = u px
  const P = (x, z) => [(x + BS / 2) * u, (z + BS / 2) * u];
  // 느티나무 판
  const grd = g.createLinearGradient(0, 0, N, N);
  grd.addColorStop(0, '#EBC98F'); grd.addColorStop(0.55, '#DDB073'); grd.addColorStop(1, '#CF9D5E');
  g.fillStyle = grd; g.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = '#7A4E24';
  for (let i = 0; i < 110; i++) {
    g.globalAlpha = 0.04 + rnd() * 0.07; g.lineWidth = u * (0.01 + rnd() * 0.03);
    g.beginPath();
    const y = rnd() * N; g.moveTo(0, y);
    for (let x = 0; x <= N; x += N / 24) g.lineTo(x, y + Math.sin(x / (N / 7) + i) * u * 0.08 + (rnd() - 0.5) * u * 0.02);
    g.stroke();
  }
  g.globalAlpha = 1;
  // 테두리: 먹선 + 붉은 옻칠 띠
  g.lineWidth = u * 0.05; g.strokeStyle = 'rgba(58,36,20,.55)'; g.strokeRect(u * 0.22, u * 0.22, N - u * 0.44, N - u * 0.44);
  g.lineWidth = u * 0.03; g.strokeStyle = 'rgba(160,45,30,.55)'; g.strokeRect(u * 0.34, u * 0.34, N - u * 0.68, N - u * 0.68);
  // 길
  g.lineCap = 'round';
  const line = (a, b, w, col) => { const A = P(NODE[a][0], NODE[a][1]), B = P(NODE[b][0], NODE[b][1]); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); };
  EDGES.forEach(([a, b]) => line(a, b, u * 0.13, 'rgba(255,240,210,.35)'));
  EDGES.forEach(([a, b]) => line(a, b, u * 0.075, '#3A2414'));
  // 출발 방향 말굽 표시 (0 → 1)
  g.fillStyle = 'rgba(154,42,31,.85)';
  for (let k = 0; k < 2; k++) {
    const x = NODE[0][0] + 0.62, z = NODE[0][1] - 0.55 - k * 0.42;
    const [px, pz] = P(x, z);
    g.beginPath(); g.moveTo(px, pz - u * 0.16); g.lineTo(px - u * 0.12, pz + u * 0.06); g.lineTo(px + u * 0.12, pz + u * 0.06); g.closePath(); g.fill();
  }
  // 칸
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 29; i++) {
    const [px, pz] = P(NODE[i][0], NODE[i][1]);
    const big = i in CORNER;
    if (big) {
      const R = u * 0.5;
      blossom(g, px, pz, R);
      g.fillStyle = i === 0 ? '#F6D9A2' : '#FBEFD3'; g.fill();
      g.lineWidth = u * 0.05; g.strokeStyle = '#3A2414'; g.stroke();
      g.beginPath(); g.arc(px, pz, R * 0.42, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? '#C0392B' : '#E9B949'; g.fill();
      const label = i === 0 ? '출발' : CORNER[i];
      g.fillStyle = i === 0 ? '#FFF6E6' : '#3A2414';
      g.font = `${Math.round(u * (label.length > 1 ? 0.2 : 0.26))}px ${FONT}`;
      g.fillText(label, px, pz + u * 0.01);
    } else {
      const R = u * 0.3;
      g.beginPath(); g.arc(px, pz, R, 0, Math.PI * 2);
      g.fillStyle = '#FBF1DA'; g.fill();
      g.lineWidth = u * 0.05; g.strokeStyle = '#3A2414'; g.stroke();
      g.beginPath(); g.arc(px, pz, R * 0.55, 0, Math.PI * 2);
      g.lineWidth = u * 0.018; g.strokeStyle = 'rgba(58,36,20,.35)'; g.stroke();
    }
  }
  // 완주 자리
  const [fx, fz] = P(FIN_XZ[0], FIN_XZ[1]);
  g.setLineDash([u * 0.09, u * 0.08]); g.lineWidth = u * 0.035; g.strokeStyle = 'rgba(58,36,20,.6)';
  g.beginPath(); g.arc(fx, fz, u * 0.36, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(58,36,20,.8)'; g.font = `${Math.round(u * 0.17)}px ${FONT}`; g.fillText('완주', fx, fz + u * 0.01);
  return c;
}

function woodSideTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#9C6433'; g.fillRect(0, 0, 256, 32);
  g.strokeStyle = 'rgba(60,30,10,.35)';
  for (let i = 0; i < 10; i++) { g.lineWidth = 1 + (i % 3); g.beginPath(); g.moveTo(0, 3 * i + 2); g.lineTo(256, 3 * i + 1 + Math.sin(i) * 2); g.stroke(); }
  return c;
}

/** 마루 바닥 */
function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const colors = ['#D9B98A', '#D2B081', '#DDBF92', '#CFAB7B'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = colors[i % 4]; g.fillRect(0, i * 64, 512, 64);
    g.strokeStyle = 'rgba(110,70,35,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke();
    const off = (i * 173) % 512;
    g.beginPath(); g.moveTo(off, i * 64); g.lineTo(off, i * 64 + 64); g.stroke();
    g.strokeStyle = 'rgba(120,80,40,.12)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(0, i * 64 + 10 + k * 11); g.bezierCurveTo(170, i * 64 + 6 + k * 11, 340, i * 64 + 16 + k * 11, 512, i * 64 + 9 + k * 11); g.stroke(); }
  }
  return c;
}

function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#9FD3F0'); grd.addColorStop(0.55, '#D8EEF6'); grd.addColorStop(1, '#FFF3DC');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  return c;
}

function nestTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#FFF6E6'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = color.css; g.lineWidth = 26; g.strokeRect(13, 13, 230, 230);
  g.strokeStyle = 'rgba(43,33,24,.35)'; g.lineWidth = 3; g.strokeRect(28, 28, 200, 200);
  // 칸 윤곽(말 자리 4개)
  g.globalAlpha = 0.28; g.strokeStyle = color.css; g.lineWidth = 5;
  [[80, 80], [176, 80], [80, 176], [176, 176]].forEach(([x, y]) => { shapePath(g, color.shape, x, y, 30); g.stroke(); });
  g.globalAlpha = 1;
  return c;
}

function tileTexture(tile) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fillStyle = '#FFF8EA'; g.fill();
  g.lineWidth = 8; g.strokeStyle = tile.id === 'puddle' ? '#4A90C8' : tile.id === 'mission' ? '#8E5BC8' : '#D4A017'; g.stroke();
  g.font = `64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(tile.icon, 64, 70);
  return c;
}

/** 번호 풍선(선택지 번호) */
function labelTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#FFFFFF'; g.stroke();
  g.fillStyle = fg; g.font = `${text.length > 1 ? 44 : 70}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  return c;
}

export function createBoard(ctx) {
  const { scene, world, renderer } = ctx;
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const N = ctx.tier === 'high' ? 2048 : 1024;

  /* 배경과 바닥 */
  scene.background = canvasTex(skyTexture());
  scene.fog = new THREE.Fog(0xF3EAD6, 34, 70);
  const floorTex = canvasTex(floorTexture());
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(10, 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  world.add(floor);

  /* 윷판 */
  const topTex = canvasTex(boardTexture(N), aniso);
  const side = canvasTex(woodSideTexture());
  const sideMat = new THREE.MeshStandardMaterial({ map: side, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.72 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BS, BT, BS), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  board.position.y = BT / 2; board.castShadow = true; board.receiveShadow = true;
  world.add(board);
  // 판 다리(낮은 받침)
  const legGeo = new THREE.BoxGeometry(0.7, 0.14, 0.7);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const f = new THREE.Mesh(legGeo, sideMat); f.position.set(sx * (BS / 2 - 0.6), 0.02, sz * (BS / 2 - 0.6)); world.add(f);
  });

  /** 글꼴이 늦게 도착하면 판 글자를 다시 굽는다 */
  function redrawText() { topTex.image = boardTexture(N); topTex.needsUpdate = true; ctx.invalidate(); }

  /* 오방색 깃발 줄 */
  const deco = new THREE.Group();
  world.add(deco);
  const FLAG = [0x1F5FAD, 0xD7263D, 0xF2C230, 0xFFFFFF, 0x2B2118];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.28, 0, 0, 0.28, 0, 0, 0, -0.62, 0], 3));
  flagGeo.computeVertexNormals();
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 18);
  deco.add(flags);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x7A4A22, roughness: 0.8 });
  const poles = [new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 8), poleMat), new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 8), poleMat)];
  poles.forEach(p => { p.castShadow = true; deco.add(p); });
  const rope = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6B4A2A }));
  deco.add(rope);
  let flagPhase = 0;
  function layoutDeco(side) {
    // 방석 뒤쪽에 깃발 줄을 건다
    const back = side === 'right' ? { a: [-9.2, -6.2], b: [-9.2, 6.2] } : { a: [-6.6, -9.0], b: [6.6, -9.0] };
    poles[0].position.set(back.a[0], 2.3, back.a[1]);
    poles[1].position.set(back.b[0], 2.3, back.b[1]);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const k = i / 24, x = back.a[0] + (back.b[0] - back.a[0]) * k, z = back.a[1] + (back.b[1] - back.a[1]) * k;
      pts.push(new THREE.Vector3(x, 4.4 - Math.sin(Math.PI * k) * 0.9, z));
    }
    rope.geometry.setFromPoints(pts);
    deco.userData.back = back;
    for (let i = 0; i < 18; i++) flags.setColorAt(i, new THREE.Color(FLAG[i % 5]));
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    placeFlags(0);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function placeFlags(t) {
    const back = deco.userData.back;
    if (!back) return;
    const dirYaw = Math.atan2(back.b[0] - back.a[0], back.b[1] - back.a[1]) - Math.PI / 2;
    for (let i = 0; i < 18; i++) {
      const k = (i + 0.5) / 18;
      v.set(back.a[0] + (back.b[0] - back.a[0]) * k, 4.4 - Math.sin(Math.PI * k) * 0.9, back.a[1] + (back.b[1] - back.a[1]) * k);
      e.set(Math.sin(t * 1.3 + i * 0.7) * 0.25, dirYaw, 0);
      q.setFromEuler(e);
      m4.compose(v, q, one);
      flags.setMatrixAt(i, m4);
    }
    flags.instanceMatrix.needsUpdate = true;
  }
  // 실제로 그려지는 동안에만 깃발을 흔든다(가끔 그리는 화면에서 깃발이 튀지 않게)
  let flagFrame = -1, flagDrawn = 0;
  ctx.addTicker((dt, now) => {
    const fr = ctx.renderer.info.render.frame;
    if (fr !== flagFrame) { flagFrame = fr; flagDrawn = now; }
    if (now - flagDrawn < 70) { flagPhase += dt; placeFlags(flagPhase); }
    return true;
  });

  /* 팀 방석 */
  const nests = new THREE.Group();
  world.add(nests);
  let teamInfo = [], curSide = ctx.matSide;
  function buildNests() {
    nests.children.slice().forEach(n => { nests.remove(n); n.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); if (o.geometry) o.geometry.dispose(); }); });
    teamInfo.forEach((tm, t) => {
      const col = TEAM_COLORS[tm.color];
      const g = new THREE.Group();
      const baseMat = new THREE.MeshStandardMaterial({ color: col.hex, roughness: 0.9 });
      const top = new THREE.MeshStandardMaterial({ map: canvasTex(nestTexture(col)), roughness: 0.9 });
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(NEST_SIZE, 0.1, NEST_SIZE), [baseMat, baseMat, top, baseMat, baseMat, baseMat]);
      cushion.position.y = NEST_TOP - 0.05; cushion.receiveShadow = true;
      g.add(cushion);
      nests.add(g);
    });
    placeNests();
  }
  function placeNests() {
    nests.children.forEach((g, t) => { const c = nestCenter(t, teamInfo.length, curSide); g.position.set(c.x, 0, c.z); });
    ctx.invalidate();
  }

  /* 잔치 칸 토큰 */
  const tiles = new THREE.Group();
  world.add(tiles);
  const tileMeshes = {};
  const tokenGeo = new THREE.CylinderGeometry(0.36, 0.38, 0.05, 32);
  Object.entries(TILES).forEach(([node, tile]) => {
    const topM = new THREE.MeshStandardMaterial({ map: canvasTex(tileTexture(tile)), roughness: 0.6 });
    const sideM = new THREE.MeshStandardMaterial({ color: 0xE9B949, roughness: 0.6 });
    const m = new THREE.Mesh(tokenGeo, [sideM, topM, sideM]);
    m.position.set(NODE[node][0], BT + 0.026, NODE[node][1]);
    m.rotation.y = -Math.PI / 2;
    m.receiveShadow = true;
    m.visible = false;
    m.userData = { node: +node, tile, topM };
    tiles.add(m);
    tileMeshes[node] = m;
  });
  let partyOn = false, spicyOn = false;
  function setParty(on, spicy) {
    partyOn = !!on; spicyOn = !!spicy;
    Object.values(tileMeshes).forEach(m => { m.visible = partyOn && (!m.userData.tile.spicy || spicyOn); });
    ctx.invalidate();
  }
  /** 쉬는 칸은 흐리게 */
  function refreshTiles(G) {
    Object.values(tileMeshes).forEach(m => {
      const cd = G && G.party && G.party.cool[m.userData.node];
      const cooling = cd != null && G.turnSerial < cd;
      m.userData.topM.color.setScalar(cooling ? 0.45 : 1);
    });
    ctx.invalidate();
  }
  function pulseTile(node) {
    const m = tileMeshes[node];
    if (!m) return Promise.resolve();
    return tween(600, k => { const s = 1 + Math.sin(Math.PI * k) * 0.45; m.scale.set(s, 1 + Math.sin(Math.PI * k) * 3, s); m.position.y = BT + 0.026 + Math.sin(Math.PI * k) * 0.25; });
  }

  /* 선택 표시: 도착 링 + 번호 + 발자국 */
  const marks = new THREE.Group();
  world.add(marks);
  const ringGeo = new THREE.RingGeometry(0.46, 0.64, 40);
  const hitGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const labelCache = new Map();
  function labelMat(text, color) {
    const key = text + color.css;
    if (!labelCache.has(key)) labelCache.set(key, canvasTex(labelTexture(text, color.css, color.ink)));
    return new THREE.SpriteMaterial({ map: labelCache.get(key), depthTest: false, transparent: true });
  }
  const footCache = new Map();
  function footGeo(shape) {
    if (footCache.has(shape)) return footCache.get(shape);
    const s = new THREE.Shape(), r = 0.13;
    if (shape === 'circle') s.absarc(0, 0, r, 0, Math.PI * 2);
    else if (shape === 'square') { s.moveTo(-r, -r); s.lineTo(r, -r); s.lineTo(r, r); s.lineTo(-r, r); s.closePath(); }
    else if (shape === 'triangle') { s.moveTo(0, r); s.lineTo(r, -r * 0.8); s.lineTo(-r, -r * 0.8); s.closePath(); }
    else { for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; i ? s.lineTo(rr * Math.cos(a), rr * Math.sin(a)) : s.moveTo(rr * Math.cos(a), rr * Math.sin(a)); } s.closePath(); }
    const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
    footCache.set(shape, geo);
    return geo;
  }
  let ringAnim = null;
  function clearChoices() {
    marks.children.slice().forEach(m => { marks.remove(m); if (m.material && m.material !== hitMat) m.material.dispose(); });
    ctx.pick.clear(d => d && d.kind === 'dest');
    if (ringAnim) { ctx.removeTicker(ringAnim); ringAnim = null; }
    ctx.invalidate();
  }
  /**
   * choices: [{ k, label, dest(칸|'F'), opt }] — 같은 도착 칸이면 번호를 모아서 보여 준다
   */
  function showChoices(choices, colorIdx) {
    clearChoices();
    const col = TEAM_COLORS[colorIdx];
    const byDest = new Map();
    choices.forEach(ch => { const key = String(ch.dest); if (!byDest.has(key)) byDest.set(key, []); byDest.get(key).push(ch); });
    const rings = [];
    for (const [key, list] of byDest) {
      const fin = key === FIN;
      const xz = fin ? FIN_XZ : NODE[+key];
      const color = fin ? 0xE8B23A : col.hex;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(xz[0], BT + 0.06, xz[1]); ring.renderOrder = 2;
      marks.add(ring); rings.push(ring);
      const text = list.map(c => c.label).join('·');
      const sp = new THREE.Sprite(labelMat(fin ? `${text}` : text, fin ? { css: '#E8B23A', ink: '#2B2118' } : col));
      sp.scale.set(0.62, 0.62, 1); sp.center.set(-0.35, 0.5); sp.position.set(xz[0], BT + 1.05, xz[1]); sp.renderOrder = 10; // 번호는 칸 옆에(말 머리를 가리지 않게)
      marks.add(sp);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.set(xz[0], BT + 0.3, xz[1]);
      marks.add(hit);
      ctx.pick.add(hit, { kind: 'dest', dest: fin ? FIN : +key, ks: list.map(c => c.k) }, 1.2); // 고를 수 있는 말(1.5)보다 낮게: 내 말을 누르면 그 말이 움직인다
      ctx.pick.add(sp, { kind: 'dest', dest: fin ? FIN : +key, ks: list.map(c => c.k) }, 3);
      // 발자국
      list.forEach(ch => {
        ch.opt.move.path.slice(0, -1).forEach(n => {
          if (n === FIN) return;
          const f = new THREE.Mesh(footGeo(col.shape), new THREE.MeshBasicMaterial({ color: col.hex, transparent: true, opacity: 0.7, depthWrite: false }));
          f.position.set(NODE[n][0], BT + 0.05, NODE[n][1]);
          marks.add(f);
        });
      });
    }
    ringAnim = (dt, now) => {
      if (!ctx.idleLive()) return false;   // 20초 동안 입력이 없으면 링을 멈춘다(배터리)
      const s = 0.5 + 0.5 * Math.sin(now / 150);
      rings.forEach(r => { r.scale.setScalar(0.94 + 0.16 * s); r.material.opacity = 0.5 + 0.45 * s; });
      return true;
    };
    ctx.addTicker(ringAnim);
  }

  function setTeams(teams) { teamInfo = teams.map(t => ({ color: t.color })); buildNests(); }
  function setLayout(side) { curSide = side; placeNests(); layoutDeco(side); }
  layoutDeco(curSide);

  return {
    setTeams, setLayout, setParty, refreshTiles, pulseTile, showChoices, clearChoices, redrawText,
    box: side => boardBox(side),
    tileMesh: node => tileMeshes[node],
  };
}
