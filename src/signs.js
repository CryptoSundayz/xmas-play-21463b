// Diegetic, hand-crafted shop signs: painted/gilded wooden boards (fascia boards with bevelled moulding, or a
// blade sign hanging from a wrought-iron bracket), storybook serif lettering with letter-spacing, a painted
// icon per shop, a snow cap, a holly sprig and a small wall lantern lighting the board from above.
// No emissive text: the board is lit by scene light (the lantern feeds the world's dynamic light pool).
// Text is code-rendered (canvas), font: IM Fell English SC (SIL OFL, assets/fonts/).
import * as THREE from 'three';

const FONT = 'IMFellSC';
const fontReady = (() => {
  try {
    const ff = new FontFace(FONT, 'url(assets/fonts/IMFellEnglishSC-Regular.ttf)');
    document.fonts.add(ff);
    return ff.load().catch(() => null);
  } catch (e) { return Promise.resolve(null); }
})();
export const signFontReady = fontReady;

const STYLE = {
  bakery: { paint: '#24452f', paint2: '#1b3826', icon: 'bread', layout: 'fascia' },
  toyWorkshop: { paint: '#6b1f1c', paint2: '#561615', icon: 'horse', layout: 'fascia' },
  inn: { paint: '#1d2d4a', paint2: '#16233b', icon: 'mug', layout: 'hang' },
};
export const signLayout = type => (STYLE[type] || STYLE.bakery).layout;

// sign board box with 2 draw groups (wood sides+back, painted front) instead of 6
function boardBox(W, H, D) {
  const g = new THREE.BoxGeometry(W, H, D), ix = Array.from(g.index.array);
  g.setIndex([...ix.slice(0, 24), ...ix.slice(30, 36), ...ix.slice(24, 30)]); // move +z face to the end
  g.clearGroups(); g.addGroup(0, 30, 0); g.addGroup(30, 6, 1); return g;
}
function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

// --- icons (drawn with paths, centred at 0,0 in a box of size s) ---
function iconPath(g, kind, s) {
  g.save(); g.scale(s / 100, s / 100); g.beginPath();
  if (kind === 'bread') { // loaf with three score marks + a wheat ear
    g.moveTo(-46, 18); g.bezierCurveTo(-50, -22, -20, -34, 0, -34); g.bezierCurveTo(22, -34, 50, -22, 46, 18); g.quadraticCurveTo(0, 26, -46, 18); g.closePath();
  } else if (kind === 'mug') { // tankard with foam and handle
    g.moveTo(-30, -20); g.lineTo(22, -20); g.lineTo(20, 38); g.quadraticCurveTo(-4, 44, -28, 38); g.closePath();
    g.moveTo(-34, -20); g.bezierCurveTo(-38, -38, -22, -44, -12, -36); g.bezierCurveTo(-4, -48, 14, -46, 18, -36); g.bezierCurveTo(30, -42, 36, -26, 26, -20); g.closePath();
    g.moveTo(22, -8); g.bezierCurveTo(48, -10, 50, 26, 21, 26); g.lineTo(21, 16); g.bezierCurveTo(38, 16, 36, 0, 22, 2); g.closePath();
  } else if (kind === 'horse') { // rocking horse (faces right): rocker, body, arched neck, long head with muzzle, ears, tail
    g.moveTo(-52, 36); g.quadraticCurveTo(0, 56, 52, 36); g.lineTo(54, 42); g.quadraticCurveTo(0, 64, -54, 42); g.closePath();
    g.moveTo(-30, -4); // body
    g.bezierCurveTo(-34, -18, 10, -20, 18, -10); // back to withers
    g.bezierCurveTo(22, -24, 24, -34, 30, -40); // neck front-top (crest)
    g.lineTo(34, -46); g.lineTo(37, -40); // ear
    g.bezierCurveTo(44, -38, 52, -30, 56, -22); // forehead -> muzzle
    g.bezierCurveTo(58, -16, 52, -12, 47, -15); // muzzle/chin
    g.bezierCurveTo(40, -20, 36, -18, 32, -10); // jaw -> throat
    g.bezierCurveTo(30, 0, 26, 6, 18, 8); // chest
    g.bezierCurveTo(6, 12, -20, 12, -30, 6); g.closePath(); // belly
    g.moveTo(-30, -6); g.bezierCurveTo(-42, -10, -48, 0, -46, 14); g.bezierCurveTo(-42, 6, -38, 2, -31, 2); g.closePath(); // tail
    for (const [x0, x1] of [[-26, -34], [-14, -16], [8, 10], [16, 24]]) { g.moveTo(x0, 6); g.lineTo(x0 + 6, 6); g.lineTo(x1 + 4, 42); g.lineTo(x1 - 2, 42); g.closePath(); }
  }
  g.restore();
}
function iconDetail(g, kind, s, col) { // darker strokes on top of the filled icon
  g.save(); g.scale(s / 100, s / 100); g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'round';
  if (kind === 'bread') for (const x of [-22, 0, 22]) { g.beginPath(); g.moveTo(x - 8, -8); g.quadraticCurveTo(x, -22, x + 10, -24); g.stroke(); }
  if (kind === 'mug') { g.beginPath(); for (const x of [-16, -2, 12]) { g.moveTo(x, -8); g.lineTo(x, 32); } g.stroke(); }
  if (kind === 'horse') { g.beginPath(); g.arc(44, -30, 2.2, 0, 7); g.stroke(); g.beginPath(); for (let k = 0; k < 5; k++) { g.moveTo(26 - k * 2, -38 + k * 6); g.lineTo(18 - k * 2, -32 + k * 6); } g.moveTo(-10, -6); g.quadraticCurveTo(0, 2, 10, -4); g.stroke(); }
  g.restore();
}

function spacedText(g, text, x, y, spacing, mode) { // manual letter-spacing (Safari-safe)
  const ws = [...text].map(c => g.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0) + spacing * (ws.length - 1);
  let cx = x - tot / 2;
  [...text].forEach((c, i) => { mode === 'stroke' ? g.strokeText(c, cx, y) : g.fillText(c, cx, y); cx += ws[i] + spacing; });
  return tot;
}

/** Paint a board: colour map, height map (-> normal map) and roughness/metalness map. W,H in metres. */
function paintBoard(type, text, W, H, seed, opts = {}) {
  const st = STYLE[type] || STYLE.bakery, R = rnd(seed);
  const ppm = Math.min(300, 2048 / W), cw = Math.round(W * ppm), ch = Math.round(H * ppm);
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const C = mk(), Hh = mk(), M = mk(), g = C.getContext('2d'), h = Hh.getContext('2d'), m = M.getContext('2d');
  // wood planks (horizontal) with grain
  const planks = Math.max(1, Math.round(H / 0.22));
  h.fillStyle = '#808080'; h.fillRect(0, 0, cw, ch);
  for (let p = 0; p < planks; p++) {
    const y0 = p * ch / planks, y1 = (p + 1) * ch / planks, tint = 0.85 + R() * 0.3;
    g.fillStyle = `rgb(${110 * tint | 0},${72 * tint | 0},${42 * tint | 0})`; g.fillRect(0, y0, cw, y1 - y0);
    for (let k = 0; k < 26; k++) { // grain lines
      const yy = y0 + R() * (y1 - y0), a = R() * 6, f = 0.004 + R() * 0.01;
      g.strokeStyle = `rgba(50,28,14,${0.18 + R() * 0.25})`; g.lineWidth = 1 + R() * 2; g.beginPath();
      h.strokeStyle = 'rgba(70,70,70,0.5)'; h.lineWidth = g.lineWidth; h.beginPath();
      for (let x = 0; x <= cw; x += 12) { const yv = yy + Math.sin(x * f + a) * 3 + Math.sin(x * f * 3.1 + a) * 1.5; x ? (g.lineTo(x, yv), h.lineTo(x, yv)) : (g.moveTo(x, yv), h.moveTo(x, yv)); }
      g.stroke(); h.stroke();
    }
    g.fillStyle = 'rgba(25,14,6,0.8)'; g.fillRect(0, y1 - 2, cw, 3); h.fillStyle = '#303030'; h.fillRect(0, y1 - 3, cw, 4);
  }
  // weathered paint layer over the wood (chipped, thinner near edges)
  const paint = document.createElement('canvas'); paint.width = cw; paint.height = ch; const pg = paint.getContext('2d');
  const pgr = pg.createLinearGradient(0, 0, 0, ch); pgr.addColorStop(0, st.paint); pgr.addColorStop(1, st.paint2);
  pg.fillStyle = pgr; pg.fillRect(0, 0, cw, ch);
  pg.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 70; k++) { // chips
    const edge = R() < 0.7, x = edge ? (R() < 0.5 ? R() * cw * 0.08 : cw - R() * cw * 0.08) : R() * cw, y = edge && R() < 0.5 ? (R() < 0.5 ? R() * ch * 0.1 : ch - R() * ch * 0.1) : R() * ch;
    pg.fillStyle = `rgba(0,0,0,${0.5 + R() * 0.5})`; pg.beginPath(); const r = 1.5 + R() * 4;
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283, rr = r * (0.5 + R()); i ? pg.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr) : pg.moveTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr); }
    pg.fill();
  }
  pg.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.93; g.drawImage(paint, 0, 0); g.globalAlpha = 1;
  // inner painted border line (gold) like a sign-writer's frame
  const bw = Math.max(3, ch * 0.025), inset = ch * 0.09;
  g.strokeStyle = '#c9a24e'; g.lineWidth = bw; g.strokeRect(inset, inset, cw - 2 * inset, ch - 2 * inset);
  h.strokeStyle = '#a8a8a8'; h.lineWidth = bw; h.strokeRect(inset, inset, cw - 2 * inset, ch - 2 * inset);
  m.fillStyle = 'rgb(0,205,0)'; m.fillRect(0, 0, cw, ch);
  m.strokeStyle = 'rgb(0,110,200)'; m.lineWidth = bw; m.strokeRect(inset, inset, cw - 2 * inset, ch - 2 * inset);

  // layout: icon(s) + lettering
  const iconOnTop = opts.square || (cw / ch < 3.2 && text.length > 6), fs0 = iconOnTop ? ch * 0.3 : ch * 0.52;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  const font = s => `${s}px ${FONT}, "IM Fell English SC", Georgia, "Times New Roman", serif`;
  let fs = fs0; g.font = font(fs);
  const spacing = () => fs * 0.09, width = () => [...text].reduce((a, c) => a + g.measureText(c).width, 0) + spacing() * (text.length - 1);
  const iconS = iconOnTop ? ch * 0.42 : ch * 0.44, maxW = iconOnTop ? cw * 0.82 : cw - 2 * inset - (iconS * 2 + ch * 0.25);
  while (width() > maxW && fs > 8) { fs *= 0.95; g.font = font(fs); }
  const ty = iconOnTop ? ch * 0.73 : ch * 0.53, iy = iconOnTop ? ch * 0.36 : ch * 0.5;
  const tw = width(), icons = iconOnTop ? [cw / 2] : [cw / 2 - tw / 2 - iconS * 0.68, cw / 2 + tw / 2 + iconS * 0.68];
  const gold = g.createLinearGradient(0, ty - fs / 2, 0, ty + fs / 2); gold.addColorStop(0, '#f3dc96'); gold.addColorStop(0.45, '#d8b25a'); gold.addColorStop(0.55, '#b88a34'); gold.addColorStop(1, '#e6c777');
  const drawAll = (ctx, fill, shadow) => {
    ctx.font = font(fs); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (shadow) { ctx.fillStyle = 'rgba(10,6,2,0.55)'; spacedText(ctx, text, cw / 2 + fs * 0.035, ty + fs * 0.05, spacing()); icons.forEach((x, i) => { ctx.save(); ctx.translate(x + fs * 0.035, iy + fs * 0.05); if (i) ctx.scale(-1, 1); iconPath(ctx, st.icon, iconS); ctx.fill(); ctx.restore(); }); }
    ctx.fillStyle = fill; spacedText(ctx, text, cw / 2, ty, spacing());
    icons.forEach((x, i) => { ctx.save(); ctx.translate(x, iy); if (i) ctx.scale(-1, 1); iconPath(ctx, st.icon, iconS); ctx.fill(); ctx.restore(); });
  };
  drawAll(g, gold, true);
  const flatIcons = (ctx, fill) => icons.forEach((x, i) => { ctx.save(); ctx.translate(x, iy); if (i) ctx.scale(-1, 1); iconPath(ctx, st.icon, iconS); ctx.fillStyle = fill; ctx.fill(); ctx.restore(); });
  flatIcons(g, '#a8814a'); // icons: muted ochre paint, only the lettering is gilded
  g.strokeStyle = 'rgba(90,60,20,0.8)'; g.lineWidth = Math.max(1, fs * 0.02); spacedText(g, text, cw / 2, ty, spacing(), 'stroke');
  icons.forEach((x, i) => { g.save(); g.translate(x, iy); if (i) g.scale(-1, 1); iconDetail(g, st.icon, iconS, 'rgba(110,70,25,0.9)'); g.restore(); });
  // wear on the gilding
  g.globalCompositeOperation = 'multiply'; for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${150 + R() * 80 | 0},${130 + R() * 70 | 0},${100 + R() * 60 | 0},0.5)`; g.fillRect(R() * cw, R() * ch, 1 + R() * 3, 1 + R() * 2); } g.globalCompositeOperation = 'source-over';
  // height: letters/icons raised (gilded relief), slightly blurred for a soft bevel
  h.filter = `blur(${Math.max(1, fs * 0.03)}px)`; drawAll(h, '#e8e8e8', false); h.filter = 'none';
  drawAll(m, 'rgb(0,110,160)', false); flatIcons(m, 'rgb(0,175,40)');
  return { C, Hh, M, cw, ch };
}

function normalFromHeight(Hc, strength = 2.2) {
  const w = Hc.width, hgt = Hc.height, src = Hc.getContext('2d').getImageData(0, 0, w, hgt).data;
  const out = document.createElement('canvas'); out.width = w; out.height = hgt; const o = out.getContext('2d'), img = o.createImageData(w, hgt), d = img.data;
  const H = (x, y) => src[((Math.min(hgt - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  o.putImageData(img, 0, 0); return out;
}

const texCache = new Map();
function boardMaterial(type, text, W, H, square) {
  const key = type + '|' + text + '|' + W.toFixed(2) + 'x' + H.toFixed(2);
  if (texCache.has(key)) return texCache.get(key);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1.4, 1.4) });
  const build = () => {
    const P = paintBoard(type, text, W, H, [...key].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7), { square });
    const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    for (const k of ['map', 'normalMap', 'roughnessMap']) mat[k]?.dispose?.();
    mat.map = mk(P.C, true); mat.normalMap = mk(normalFromHeight(P.Hh), false);
    mat.roughnessMap = mat.metalnessMap = mk(P.M, false); mat.needsUpdate = true;
  };
  build(); fontReady.then(f => { if (f) build(); }); // redraw once the storybook font has loaded
  texCache.set(key, mat); return mat;
}

const M = {
  wood: new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.8 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.55, metalness: 0.75 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x8a6a30, roughness: 0.4, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb04a, emissiveIntensity: 2.2, roughness: 0.3 }), // the lantern flame glass (the only lit part)
  snow: new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x1d5a2a, roughness: 0.5, side: THREE.DoubleSide }),
  berry: new THREE.MeshStandardMaterial({ color: 0xc0141c, roughness: 0.35 }),
};
function holly(s = 1) { // three leaves + berries
  const g = new THREE.Group(), sh = new THREE.Shape();
  sh.moveTo(0, 0); for (let i = 1; i <= 4; i++) { sh.lineTo(i * 0.025, (i % 2 ? 0.022 : 0.012)); } sh.lineTo(0.12, 0); for (let i = 4; i >= 1; i--) sh.lineTo(i * 0.025, -(i % 2 ? 0.022 : 0.012)); sh.lineTo(0, 0);
  const lg = new THREE.ShapeGeometry(sh);
  for (const a of [0.5, 2.0, 3.6]) { const l = new THREE.Mesh(lg, M.leaf); l.rotation.set(0.2, 0.3, a); g.add(l); }
  const bg = new THREE.SphereGeometry(0.018, 8, 6);
  for (const [x, y] of [[0, 0.012], [0.02, -0.008], [-0.018, -0.01]]) { const b = new THREE.Mesh(bg, M.berry); b.position.set(x, y, 0.02); g.add(b); }
  g.scale.setScalar(s); return g;
}
function snowCap(len, depth) {
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, len - 0.07, 4, 8), M.snow); c.rotation.z = Math.PI / 2; c.scale.set(1, 1, depth / 0.07); return c;
}
/** Small wall lantern on a curled iron arm; returns {group, lightPos(local)} */
function wallLantern(armLen = 0.32) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.012), M.iron); plate.position.z = 0.006; g.add(plate);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, armLen, 6), M.iron); arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.02, armLen / 2); g.add(arm);
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 5, 12, Math.PI * 1.4), M.iron); curl.rotation.y = Math.PI / 2; curl.position.set(0, -0.03, armLen * 0.45); g.add(curl);
  const L = new THREE.Group(); L.position.set(0, -0.09, armLen);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.06, 4), M.iron); cap.rotation.y = Math.PI / 4; cap.position.y = 0.06; L.add(cap);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), M.glass); L.add(glass);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.012), M.iron); p.position.set(x * 0.042, 0, z * 0.042); L.add(p); }
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.015, 0.095), M.iron); base.position.y = -0.057; L.add(base);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 4, 8), M.iron); hook.position.y = 0.1; L.add(hook);
  const snowTop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 4, 0, 6.3, 0, 1.2), M.snow); snowTop.scale.y = 0.5; snowTop.position.y = 0.085; L.add(snowTop);
  g.add(L); return { group: g, light: new THREE.Vector3(0, -0.12, armLen + 0.05) };
}
function frameMoulding(W, H, D, t = 0.055) { // bevelled frame round a board (4 chamfered battens)
  const g = new THREE.Group();
  const bat = (len, rotZ, x, y) => {
    const sh = new THREE.Shape(); sh.moveTo(-t / 2, 0); sh.lineTo(t / 2, 0); sh.lineTo(t * 0.3, D); sh.lineTo(-t * 0.3, D); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2);
    const m = new THREE.Mesh(geo, M.wood); m.rotation.set(Math.PI / 2, 0, 0); // extrude along y, profile in x/z
    const p = new THREE.Group(); p.add(m); p.rotation.z = rotZ; p.position.set(x, y, 0); g.add(p);
  };
  bat(H + t, 0, -W / 2 - t / 2 + 0.005, 0); bat(H + t, 0, W / 2 + t / 2 - 0.005, 0);
  bat(W + 2 * t, Math.PI / 2, 0, H / 2 + t / 2 - 0.005); bat(W + 2 * t, Math.PI / 2, 0, -H / 2 - t / 2 + 0.005);
  return g;
}

/**
 * Build a shop sign for `type` in holder space. F = front depth field of the building (attach.js).
 * rect = [x, y, z, yaw, w, h] of the facade's sign area. Returns { group, light (holder-space Vector3),
 * audit: [{p, dirs, pts}] attachment points (board back / bracket plates) } or null when no wall is found.
 */
export function buildShopSign(type, text, rect, F, rayUp) {
  const [x, y, z, , w, h] = rect, st = STYLE[type] || STYLE.bakery, g = new THREE.Group(), audit = [], Zd = new THREE.Vector3(0, 0, 1);
  if (st.layout === 'hang') { // the inn's hanging sign: a new carved board fixed flush onto the model's own hanging sign board
    const W = w + 0.08, H = h + 0.08, D = 0.04, zs = [];
    for (const u of [-0.4, 0, 0.4]) for (const v of [-0.4, 0, 0.4]) { const q = F.at(x + u * W, y + v * H); if (q != null) zs.push(q); }
    if (zs.length < 7) return null;
    zs.sort((a, b) => a - b); const zf = zs[Math.floor(zs.length / 2)];
    if (Math.abs(zf - z) > 0.3) return null;
    const zb = zf + 0.003, top = y + H / 2;
    const mat = boardMaterial(type, text, W, H, true);
    const board = new THREE.Mesh(boardBox(W, H, D), [M.wood, mat]);
    board.position.set(x, y, zb + D / 2); g.add(board);
    const fr = frameMoulding(W, H, D + 0.02); fr.position.set(x, y, zb); g.add(fr);
    const cap = snowCap(W + 0.08, D + 0.08); cap.position.set(x, top + 0.05, zb + D / 2); g.add(cap);
    const ho = holly(1.25); ho.position.set(x - W / 2 + 0.03, top + 0.03, zb + D + 0.03); g.add(ho);
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const bo = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), M.brass); bo.rotation.x = Math.PI / 2; bo.position.set(x + u * (W / 2 - 0.07), y + v * (H / 2 - 0.07), zb + D + 0.004); g.add(bo); }
    const pts = [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0, 0]].map(([u, v]) => new THREE.Vector3(x + u * W, y + v * H, zb));
    audit.push({ kind: 'sign-board', p: pts[4], pts, dirs: [Zd] });
    // lantern: hung from the beam above the sign if there is one, else on a long iron arm from the wall above
    let light = new THREE.Vector3(x, top + 0.35, zb + 0.5);
    const lx = x, beam = rayUp ? rayUp(lx, top + 0.12, zb - 0.06) : null;
    if (beam != null && beam - top < 1.2) {
      const lt = wallLantern(0.001); lt.group.children.slice(0, 3).forEach(c => c.visible = false); lt.group.position.set(lx, beam - 0.03, zb + 0.25);
      const hk = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.33), M.iron); hk.position.set(lx, beam - 0.007, zb + 0.095); g.add(hk, lt.group); // iron bar fixed under the beam
      light = new THREE.Vector3(lx, beam - 0.3, zb + 0.35); audit.push({ kind: 'sign-lantern', p: new THREE.Vector3(lx, beam, zb - 0.06), dirs: [new THREE.Vector3(0, -1, 0)] });
    } else {
      const ly = top + 0.45, wz = F.at(x - W / 2 - 0.15, ly);
      if (wz != null && zb - wz < 2.2) { const lt = wallLantern(zb - wz + 0.25); lt.group.position.set(x - W / 2 - 0.15, ly, wz + 0.001); g.add(lt.group); light = lt.light.clone().add(lt.group.position); audit.push({ kind: 'sign-lantern', p: new THREE.Vector3(x - W / 2 - 0.15, ly, wz + 0.001), dirs: [Zd] }); }
    }
    return { group: g, light, audit };
  }
  if (st.layout === 'fascia') {
    const W = w + 0.12, H = h + 0.06, D = 0.05;
    const zs = []; // facade depth under the board
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 3; j++) { const v = F.at(x - W / 2 + W * i / 8, y - H / 2 + H * j / 3); if (v != null) zs.push(v); }
    if (zs.length < 12) return null;
    zs.sort((a, b) => a - b); const zb = zs[Math.floor(zs.length * 0.5)] + 0.004; // flush on the wall face (ignore the odd protrusion)
    if (Math.abs(zb - z) > 0.6) return null;
    const mat = boardMaterial(type, text, W, H, false);
    const board = new THREE.Mesh(boardBox(W, H, D), [M.wood, mat]);
    board.position.set(x, y, zb + D / 2); g.add(board);
    const fr = frameMoulding(W, H, D + 0.025); fr.position.set(x, y, zb); g.add(fr);
    const cap = snowCap(W + 0.08, 0.1); cap.position.set(x, y + H / 2 + 0.06, zb + 0.05); g.add(cap);
    const ho = holly(1.3); ho.position.set(x - W / 2 + 0.02, y + H / 2 + 0.02, zb + D + 0.03); g.add(ho);
    const ho2 = holly(1.0); ho2.position.set(x + W / 2 - 0.02, y + H / 2 + 0.03, zb + D + 0.03); ho2.rotation.z = 2.4; g.add(ho2);
    // bolts (brass) at the four corners
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), M.brass); b.rotation.x = Math.PI / 2; b.position.set(x + u * (W / 2 - 0.08), y + v * (H / 2 - 0.08), zb + D + 0.004); g.add(b); }
    // lantern above the board centre, bolted to the wall
    const ly = y + H / 2 + 0.42, lz = F.at(x, ly);
    let light = new THREE.Vector3(x, y + H / 2 + 0.3, zb + 0.45);
    if (lz != null && Math.abs(lz - zb) < 0.4) {
      const lt = wallLantern(0.34); lt.group.position.set(x, ly, lz + 0.001); g.add(lt.group); light = lt.light.clone().add(lt.group.position);
      audit.push({ kind: 'sign-lantern', p: new THREE.Vector3(x, ly, lz + 0.001), dirs: [Zd] });
    }
    const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [-0.5, 0], [0.5, 0]].map(([u, v]) => new THREE.Vector3(x + u * W * 0.45, y + v * H * 0.4, zb));
    audit.push({ kind: 'sign-board', p: pts[4], pts, dirs: [Zd] });
    return { group: g, light, audit };
  }
  // blade sign: wrought-iron bracket bolted to the wall, board hanging perpendicular to the facade
  const by = y + h / 2 + 0.25, bz = F.at(x, by);
  if (bz == null || Math.abs(bz - z) > 0.6) return null;
  const arm = 1.05, B = new THREE.Group(); B.position.set(x, by, bz); g.add(B);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.014), M.iron); plate.position.set(0, -0.2, 0.007); B.add(plate);
  for (const yy of [0.04, -0.44]) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), M.iron); bolt.position.set(0, yy, 0.016); B.add(bolt); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, arm), M.iron); bar.position.set(0, 0, arm / 2); B.add(bar);
  const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, Math.hypot(arm * 0.62, 0.46), 6), M.iron); brace.position.set(0, -0.23, arm * 0.31); brace.rotation.x = Math.atan2(arm * 0.62, 0.46); B.add(brace);
  for (const [r, zz, yy, a] of [[0.1, 0.36, -0.1, 0], [0.07, 0.62, -0.08, Math.PI], [0.05, arm - 0.06, 0.06, 0.4]]) { const sc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 5, 16, Math.PI * 1.5), M.iron); sc.rotation.set(0, Math.PI / 2, a); sc.position.set(0, yy, zz); B.add(sc); }
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.iron); fin.position.set(0, 0, arm + 0.02); B.add(fin);
  const snowBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, arm - 0.1), M.snow); snowBar.position.set(0, 0.028, arm / 2 + 0.03); B.add(snowBar);
  const bw = Math.max(0.8, w * 0.95), bh = Math.max(0.7, h * 0.85), D = 0.05, z0 = 0.14, zc = z0 + bw / 2;
  for (const zz of [z0 + 0.08, z0 + bw - 0.08]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 4, 10), M.iron); ring.rotation.y = Math.PI / 2; ring.position.set(0, -0.06, zz); B.add(ring); const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 4), M.iron); ch.position.set(0, -0.11, zz); B.add(ch); }
  const mat = boardMaterial(type, text, bw, bh, true);
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, D), [M.wood, M.wood, M.wood, M.wood, mat, mat]);
  const S = new THREE.Group(); S.position.set(0, -0.15 - bh / 2, zc); S.rotation.y = Math.PI / 2; B.add(S); // board plane faces +-x (readable walking along the street)
  S.add(board);
  const fr = frameMoulding(bw, bh, D / 2 + 0.012); fr.position.z = 0.0; S.add(fr); const fr2 = frameMoulding(bw, bh, D / 2 + 0.012); fr2.rotation.y = Math.PI; S.add(fr2);
  const cap = snowCap(bw + 0.08, D + 0.07); cap.position.set(0, bh / 2 + 0.05, 0); S.add(cap);
  for (const sgn of [1, -1]) { const ho = holly(1.1); ho.position.set(-bw / 2 + 0.06, bh / 2 + 0.02, sgn * (D / 2 + 0.035)); if (sgn < 0) ho.rotation.y = Math.PI; S.add(ho); }
  // lantern on the wall above the bracket
  const ly = by + 0.45, lz = F.at(x, ly); let light = new THREE.Vector3(x, by - 0.1, bz + zc);
  if (lz != null && Math.abs(lz - bz) < 0.4) { const lt = wallLantern(0.42); lt.group.position.set(x, ly, lz + 0.001); g.add(lt.group); light = new THREE.Vector3(x, by + 0.15, bz + 0.55); audit.push({ kind: 'sign-lantern', p: new THREE.Vector3(x, ly, lz + 0.001), dirs: [Zd] }); }
  audit.push({ kind: 'sign-bracket', p: new THREE.Vector3(x, by, bz), pts: [new THREE.Vector3(x, by, bz), new THREE.Vector3(x, by - 0.4, bz)], dirs: [Zd] });
  return { group: g, light, audit };
}
