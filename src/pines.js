// Realistic snowy conifers: needle-card foliage (painted needle frond atlas, alpha cutout, snow clumps on the
// upward faces), irregular per-variant silhouettes, instanced; distant trees switch to baked impostor cards.
// One near InstancedMesh + one impostor InstancedMesh per variant, refilled from the camera position a few
// times a second -> ~4 draw calls for every pine in the world, and only nearby pines go into the shadow map.
import * as THREE from 'three';
import { rng } from './util.js?v=5361c3f3';

const H = 9; // reference tree height (m); instance scale multiplies it (same convention as the old Tripo pine)

function paintAtlas() {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const sv = document.createElement('canvas'); sv.width = sv.height = S; const sg = sv.getContext('2d');
  sg.fillStyle = '#000'; sg.fillRect(0, 0, S, S);
  const R = rng(77);
  // ---- frond (top half: u = trunk->tip along x, v across)
  const cy = 256, hull = u => 225 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.95)), 0.8) * (1 - 0.35 * u);
  const needle = (x, y, ang, len, col) => { g.strokeStyle = col; g.lineWidth = 2.6 + R() * 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke(); };
  const greens = ['#16301f', '#1b3a25', '#21452b', '#284f31', '#2f5a37', '#376640', '#3f6f45'];
  const twig = (x0, y0, ang, len, w, depth) => {
    const pts = []; let x = x0, y = y0, a = ang;
    for (let s = 0; s <= 1.0001; s += 0.04) { pts.push([x, y, s]); a += (R() - 0.5) * 0.08; x += Math.cos(a) * len * 0.04; y += Math.sin(a) * len * 0.04; }
    g.strokeStyle = '#3a2a1c'; g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) { g.lineWidth = w * (1 - pts[i][2] * 0.7); g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke(); }
    // needles: dense, angled forward, darker underneath / lighter on top
    for (const [px, py, s] of pts) {
      const n = depth ? 7 : 10;
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1, la = ang + side * (0.75 + R() * 0.45), len2 = (depth ? 26 : 36) * (1 - s * 0.45) * (0.75 + R() * 0.5);
        const ci = Math.min(greens.length - 1, Math.max(0, Math.floor(R() * 4 + (side < 0 ? 2.5 : 0.5) + s * 1.5)));
        needle(px + (R() - 0.5) * 4, py + (R() - 0.5) * 4, la, len2, greens[ci]);
      }
      // snow clumps resting on the twig (snow mask)
      if (R() < 0.55 && s > 0.05 && s < 0.92) {
        const r = (depth ? 9 : 14) * (0.6 + R() * 0.9) * (1 - s * 0.4);
        const grd = sg.createRadialGradient(px, py, 0, px, py, r * 1.6); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        sg.fillStyle = grd; sg.beginPath(); sg.ellipse(px, py, r * 1.6, r, ang, 0, 7); sg.fill();
      }
    }
    return pts;
  };
  g.save(); g.beginPath(); g.rect(0, 0, S, 512); g.clip();
  // dense under-layer: overlapping needle sprays filling the frond hull so alpha coverage survives mipmapping
  g.lineCap = 'round';
  for (let i = 0; i < 5200; i++) {
    const u = Math.pow(R(), 0.85), x = 8 + u * 990, side = R() < 0.5 ? -1 : 1, h = hull(u) * (0.25 + 0.8 * Math.sqrt(R()));
    const ang = side * (0.55 + R() * 0.5), len = h / Math.sin(Math.abs(ang)) ;
    const sx = x - Math.cos(ang) * len * 0.15, sy = cy + side * h * R() * 0.3;
    g.strokeStyle = greens[Math.floor(R() * 3)]; g.lineWidth = 5 + R() * 4;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(ang) * len * 0.55, sy + Math.sin(ang) * len * 0.55); g.stroke();
  }
  const main = twig(4, cy, 0, 990, 9, 0);
  for (let i = 3; i < main.length - 2; i++) {
    if (i % 2) continue;
    const [px, py, s] = main[i], side = (i / 2) % 2 ? 1 : -1, len = hull(s) * (0.85 + R() * 0.35) / Math.sin(0.8);
    twig(px, py, side * (0.7 + R() * 0.25), Math.min(len, 240), 4, 1);
  }
  g.restore();
  // ---- bark strip (bottom quarter)
  g.fillStyle = '#3b2b20'; g.fillRect(0, 768, S, 256);
  for (let i = 0; i < 900; i++) { const x = R() * S, y = 768 + R() * 256; g.fillStyle = `rgba(${R() < 0.5 ? '20,14,10' : '92,72,56'},${0.25 + R() * 0.35})`; g.fillRect(x, y, 2 + R() * 3, 10 + R() * 40); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
  const snow = new THREE.CanvasTexture(sv); snow.generateMipmaps = true;
  return { tex, snow };
}

// ---- one tree variant: trunk + whorls of branch cards (horizontal frond + vertical cross card) + top spire
function treeGeometry(seed) {
  const R = rng(seed), pos = [], uv = [], nor = [], col = [], idx = [];
  const quad = (a, b, c, d, ua, ub, uc, ud, n, ca, cb) => {
    const i = pos.length / 3; for (const [p, u, cc] of [[a, ua, ca], [b, ub, ca], [c, uc, cb], [d, ud, cb]]) { pos.push(p.x, p.y, p.z); uv.push(u[0], u[1]); nor.push(n.x, n.y, n.z); col.push(cc, cc, cc); }
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // trunk (bark region v 0..0.25)
  const seg = 6, r0 = 0.24, r1 = 0.05;
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
    const p = (a, r, y) => V(Math.cos(a) * r, y, Math.sin(a) * r);
    const n = V(Math.cos((a0 + a1) / 2), 0.1, Math.sin((a0 + a1) / 2)).normalize();
    quad(p(a0, r0, -0.2), p(a1, r0, -0.2), p(a1, r1, H * 0.97), p(a0, r1, H * 0.97), [k / seg, 0.0], [(k + 1) / seg, 0.0], [(k + 1) / seg, 0.24], [k / seg, 0.24], n, 0.7, 0.7);
  }
  const tiers = 17 + Math.floor(R() * 3), lean = (R() - 0.5) * 0.04;
  const radius = t => (2.75 + R() * 0.15) * Math.pow(1 - t, 0.92) + 0.18;
  for (let ti = 0; ti < tiers; ti++) {
    const t = (ti + R() * 0.45) / tiers, y = 1.1 + t * (H - 1.7);
    const nb = Math.max(5, Math.round(10 - t * 5 + R() * 1.5)), base = R() * 6.28;
    for (let k = 0; k < nb; k++) {
      if (R() < 0.08 && ti > 1) continue; // irregular gaps
      const yaw = base + k / nb * Math.PI * 2 + (R() - 0.5) * 0.5;
      const L = radius(t) * (0.78 + R() * 0.42), droop = 0.18 + t * 0.12 + R() * 0.2 - (1 - t) * 0.08;
      const d = V(Math.cos(yaw) * Math.cos(droop), -Math.sin(droop), Math.sin(yaw) * Math.cos(droop));
      const s = V(-Math.sin(yaw), 0, Math.cos(yaw)), up = new THREE.Vector3().crossVectors(d, s).negate();
      if (up.y < 0) up.negate();
      const o = V(lean * y + d.x * 0.08, y + (R() - 0.5) * 0.25, d.z * 0.08);
      const w = L * (0.8 + R() * 0.2);
      // horizontal frond: 2 segments, tip bends further down
      const mid = o.clone().addScaledVector(d, L * 0.55), tip = mid.clone().addScaledVector(d, L * 0.45).add(V(0, -L * 0.12 * (0.6 + R()), 0));
      const shade = 0.55 + t * 0.35 + R() * 0.12, inner = shade * 0.55;
      quad(o.clone().addScaledVector(s, -w * 0.18), o.clone().addScaledVector(s, w * 0.18), mid.clone().addScaledVector(s, w * 0.5), mid.clone().addScaledVector(s, -w * 0.5),
        [0, 0.5], [0, 1], [0.55, 1], [0.55, 0.5], up, inner, shade);
      quad(mid.clone().addScaledVector(s, -w * 0.5), mid.clone().addScaledVector(s, w * 0.5), tip.clone().addScaledVector(s, w * 0.3), tip.clone().addScaledVector(s, -w * 0.3),
        [0.55, 0.5], [0.55, 1], [1, 1], [1, 0.5], up, shade, shade * 1.05);
      // vertical cross card (reads from the side), lower density
      if (R() < 0.75) {
        const vw = w * 0.32, ctr = o.clone().addScaledVector(d, L * 0.5);
        const tipV = o.clone().addScaledVector(d, L * 0.92).add(V(0, -L * 0.1, 0));
        quad(o.clone().addScaledVector(up, -vw * 0.4), o.clone().addScaledVector(up, vw * 0.4), tipV.clone().addScaledVector(up, vw * 0.3), tipV.clone().addScaledVector(up, -vw * 0.3),
          [0, 0.55], [0, 0.95], [0.95, 0.95], [0.95, 0.55], s, inner, shade * 0.9);
        void ctr;
      }
    }
  }
  // top spire: 3 crossed vertical fronds pointing up
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI + R() * 0.3, s = V(Math.cos(a), 0, Math.sin(a)), n = V(-Math.sin(a), 0.2, Math.cos(a)).normalize();
    const b = V(lean * H, H * 0.83, 0), tp = V(lean * H, H * 1.04, 0), w = 0.55;
    quad(b.clone().addScaledVector(s, -w * 0.15), b.clone().addScaledVector(s, w * 0.15), tp.clone().addScaledVector(s, w * 0.12), tp.clone().addScaledVector(s, -w * 0.12), [0, 0.6], [0, 0.9], [1, 0.9], [1, 0.6], n, 0.8, 1.0);
    const b2 = V(lean * H, H * 0.74, 0);
    quad(b2.clone().addScaledVector(s, -w * 0.9), b2.clone().addScaledVector(s, w * 0.9), tp.clone().addScaledVector(s, w * 0.3), tp.clone().addScaledVector(s, -w * 0.3), [0, 0.5], [0, 1], [1, 1], [1, 0.5], n, 0.75, 1.0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeBoundingSphere();
  return geo;
}

function needleMaterial(atlas, msaa) {
  const m = new THREE.MeshStandardMaterial({ map: atlas.tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, color: 0xc8d8c4 });
  m.alphaToCoverage = !!msaa;
  m.userData.snowMap = { value: atlas.snow };
  m.onBeforeCompile = sh => {
    sh.uniforms.uSnowMap = m.userData.snowMap;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uSnowMap;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float sm = texture2D(uSnowMap, vMapUv).r;
  float top = smoothstep(0.05, 0.75, wN.y);
  float s = clamp(sm * (0.35 + 0.9 * top), 0.0, 1.0) * step(0.26, vMapUv.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), s);
  roughnessFactor = mix(roughnessFactor, 0.75, s);
}`);
  };
  m.customProgramCacheKey = () => 'needlePine1';
  return m;
}

// bake a variant into an impostor texture (front view; trees are near radially symmetric)
function bakeImpostor(renderer, geo, mat, rt0 = null) {
  const W = 256, Hh = 512, rt = rt0 || new THREE.WebGLRenderTarget(W, Hh, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(0.3, 1, 0.6); sc.add(dl);
  const mesh = new THREE.Mesh(geo, mat); sc.add(mesh);
  const R = 3.3, cam = new THREE.OrthographicCamera(-R, R, H * 1.06, -0.3, 0.1, 50); cam.position.set(0, 0, 20); cam.lookAt(0, 0, 0);
  // orthographic frame must match the card: width 2R, height H*1.06+0.3
  const prev = renderer.getRenderTarget(), pc = renderer.getClearColor(new THREE.Color()), pa = renderer.getClearAlpha();
  const ss = renderer.shadowMap.enabled; renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(rt); renderer.setClearColor(0x1a3022, 0); renderer.clear(); renderer.render(sc, cam);
  renderer.setRenderTarget(prev); renderer.setClearColor(pc, pa); renderer.shadowMap.enabled = ss;
  const tex = rt.texture; tex.colorSpace = THREE.LinearSRGBColorSpace;
  return { tex, w: 2 * R, h: H * 1.06 + 0.3, y0: -0.3, rt };
}

function impostorGeometry(I) {
  const g = new THREE.BufferGeometry(), pos = [], uv = [], nor = [], idx = [];
  for (const a of [0, Math.PI / 2]) {
    const c = Math.cos(a), s = Math.sin(a), i = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const x = (u - 0.5) * I.w; pos.push(x * c, I.y0 + v * I.h, x * s); uv.push(u, v);
      const n = new THREE.Vector3((u - 0.5) * c * 1.2, 0.8, (u - 0.5) * s * 1.2).normalize(); nor.push(n.x, n.y, n.z);
    }
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx); g.computeBoundingSphere(); return g;
}

export class PineSystem {
  /** trees: [{x, z, s, sy, r}] */
  constructor(scene, renderer, trees, { variants = 2, nearRange = 58, msaa = 4, shadows = true } = {}) {
    this.trees = trees; this.nearRange = nearRange; this.t = 1e9; this.last = new THREE.Vector2(1e9, 1e9);
    const atlas = paintAtlas(), mat = needleMaterial(atlas, msaa);
    this.mat = mat;
    this.vars = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let v = 0; v < variants; v++) {
      const geo = treeGeometry(101 + v * 17);
      const I = bakeImpostor(renderer, geo, mat);
      const imat = new THREE.MeshStandardMaterial({ map: I.tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95, color: 0xb8c6b6 });
      imat.alphaToCoverage = !!msaa;
      const list = trees.filter((_, i) => i % variants === v);
      const near = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); near.castShadow = shadows; near.receiveShadow = true; near.name = 'pinesNear';
      const far = new THREE.InstancedMesh(impostorGeometry(I), imat, Math.max(1, list.length)); far.name = 'pinesFar'; far.receiveShadow = false;
      const mats = new Float32Array(list.length * 16);
      list.forEach((t, i) => { m4.compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), q.setFromAxisAngle(up, t.r), new THREE.Vector3(t.s, t.s * (t.sy ?? 1), t.s)); m4.toArray(mats, i * 16); });
      near.count = 0; far.count = 0;
      scene.add(near, far);
      geo.computeBoundingBox(); const bb = geo.boundingBox;
      this.vars.push({ geo, I, list, mats, near, far, triNear: geo.index.count / 3, rad: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 });
    }
    this.triPerTree = this.vars[0].triNear;
  }
  /** re-render the impostor textures into their existing targets (after a WebGL context restore the GPU copy is gone) */
  rebake(renderer) { for (const V of this.vars) bakeImpostor(renderer, V.geo, this.mat, V.I.rt); }
  /** occ = {x0, z0, x1, z1}: camera -> Santa segment. Trees whose crown overlaps it (or holds the camera) are
   *  dropped from the draw so a pine never fills the screen / hides Santa; they come back once clear. */
  occluded(occ) {
    if (!occ) return '';
    const { x0, z0, x1, z1 } = occ, dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1; let key = '';
    for (let v = 0; v < this.vars.length; v++) { const V = this.vars[v]; V.hide = V.hide || new Set(); V.hide.clear();
      V.list.forEach((t, i) => {
        const r = V.rad * t.s + 0.35, ex = t.x - x0, ez = t.z - z0; if (ex * ex + ez * ez > l2 + 4 * r * r + 40) return;
        const k = Math.max(0, Math.min(1, (ex * dx + ez * dz) / l2)), qx = ex - dx * k, qz = ez - dz * k;
        if (qx * qx + qz * qz < r * r && k < 0.92) { V.hide.add(i); key += v + ':' + i + ','; }
      });
    }
    return key;
  }
  update(camPos, dt = 0, force = false, occ = null) {
    this.t += dt;
    const ok = this.occluded(occ); if (ok !== this.occKey) { this.occKey = ok; force = true; }
    if (!force && this.t < 0.25 && this.last.distanceToSquared(new THREE.Vector2(camPos.x, camPos.z)) < 36) return;
    this.t = 0; this.last.set(camPos.x, camPos.z);
    const R2 = this.nearRange * this.nearRange;
    for (const V of this.vars) {
      const na = V.near.instanceMatrix.array, fa = V.far.instanceMatrix.array; let n = 0, f = 0;
      V.list.forEach((t, i) => {
        if (V.hide && V.hide.has(i)) return;
        const d2 = (t.x - camPos.x) ** 2 + (t.z - camPos.z) ** 2;
        if (d2 < R2) { na.set(V.mats.subarray(i * 16, i * 16 + 16), n * 16); n++; }
        else { fa.set(V.mats.subarray(i * 16, i * 16 + 16), f * 16); f++; }
      });
      V.near.count = n; V.far.count = f;
      V.near.instanceMatrix.needsUpdate = true; V.far.instanceMatrix.needsUpdate = true;
      V.near.computeBoundingSphere(); V.far.computeBoundingSphere();
      V.near.visible = n > 0; V.far.visible = f > 0;
    }
  }
  stats() { return this.vars.map(V => ({ near: V.near.count, far: V.far.count })); }
}
