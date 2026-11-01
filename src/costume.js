// Applies a wardrobe look (cosmetics.js items) to the mascot: shader recolours through mascot LOOK_U uniforms,
// goggle finish, flame palette, procedural toppers / back items (one merged vertex-coloured mesh each, authored in
// the mascot's root-local rest-pose metres and parented to its head / spine slots), and a feet trail emitter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLAMES = { // linear RGB: deep, body, core, embers; light = sRGB hex
  icy: [[0.02, 0.12, 0.6], [0.16, 0.48, 1.05], [0.85, 0.97, 1.1], [0.5, 0.85, 2.2], 0x8fd0ff],
  ember: [[0.55, 0.06, 0.0], [1.1, 0.42, 0.04], [1.15, 1.0, 0.7], [2.2, 0.8, 0.2], 0xffa050],
  aurora: [[0.0, 0.42, 0.18], [0.12, 1.05, 0.5], [0.85, 1.1, 0.95], [0.4, 2.2, 1.0], 0x7dffb8],
  violet: [[0.28, 0.02, 0.6], [0.72, 0.24, 1.1], [1.05, 0.9, 1.15], [1.6, 0.5, 2.3], 0xc58bff],
  gold: [[0.5, 0.26, 0.0], [1.1, 0.78, 0.18], [1.15, 1.1, 0.85], [2.3, 1.7, 0.5], 0xffd36b],
  prism: [[0.02, 0.12, 0.6], [0.16, 0.48, 1.05], [1.0, 1.0, 1.05], [1.6, 1.6, 2.0], 0xe8e8ff],
};
const GOGGLES = { // color, metalness, roughness, env (IBL scale), emissive, emissiveIntensity
  obsidian: [0x030304, 0, 0.3, 0.22, 0x000000, 0],
  chrome: [0xe8edf3, 0.7, 0.16, 1.0, 0x5c6470, 1],
  ice: [0x8fd2ff, 0.15, 0.05, 0.7, 0x0b3a5c, 1],
  neon: [0x0a2cff, 0, 0.22, 0.3, 0x1d5bff, 1.1],
  gold: [0xffc24a, 1, 0.2, 1.0, 0x3a2400, 1],
};
// lens look painted into the face decal's hollow (over the eyes): tint wash, sheen, inner rim. obsidian = clear (unchanged default)
const LENSES = {
  chrome: { tint: 'rgba(55,72,95,0.72)', sheen: 'rgba(255,255,255,0.6)', rim: 'rgba(235,242,250,0.95)' },
  ice: { tint: 'rgba(70,185,255,0.58)', sheen: 'rgba(235,250,255,0.6)', rim: 'rgba(160,225,255,0.95)' },
  neon: { tint: 'rgba(20,60,255,0.6)', sheen: 'rgba(170,200,255,0.45)', rim: 'rgba(70,140,255,1)' },
  gold: { tint: 'rgba(255,145,0,0.62)', sheen: 'rgba(255,240,200,0.55)', rim: 'rgba(255,205,90,0.95)' },
};

// ---- procedural geometry helpers (all merged into one vertex-coloured geometry per item)
const _c = new THREE.Color();
function paint(g, hex) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); _c.set(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([_c.r, _c.g, _c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const at = (g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s))); return g; };
function mesh(parts, mat, name) { const m = new THREE.Mesh(mergeGeometries(parts), mat); m.name = name; m.castShadow = false; m.receiveShadow = false; return m; }
const stdMat = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, ...o });

function buildTopper(kind, R) {
  const w = R.hs.x, top = R.hat.max.y, cx = R.hc.x, cz = R.hc.z, P = [];
  if (kind === 'crown') {
    const r = w * 0.26, y = top - w * 0.06;
    P.push(paint(at(new THREE.CylinderGeometry(r, r * 0.96, w * 0.12, 20, 1, true), cx, y, cz), 0xf2b83a));
    P.push(paint(at(new THREE.TorusGeometry(r, w * 0.018, 6, 24), cx, y - w * 0.06, cz, Math.PI / 2), 0xffd36b));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      P.push(paint(at(new THREE.ConeGeometry(w * 0.05, w * 0.13, 6), x, y + w * 0.12, z), 0xf2b83a));
      P.push(paint(at(new THREE.SphereGeometry(w * 0.025, 8, 6), x, y + w * 0.19, z), 0xfff1b8));
      if (i % 2 === 0) P.push(paint(at(new THREE.SphereGeometry(w * 0.03, 8, 6), cx + Math.cos(a) * r * 1.02, y, cz + Math.sin(a) * r * 1.02), 0x2f7dff));
    }
    return mesh(P, stdMat({ metalness: 0.75, roughness: 0.28, emissive: 0x3a2600 }), 'cosCrown');
  }
  if (kind === 'halo') {
    const g = paint(at(new THREE.TorusGeometry(w * 0.3, w * 0.03, 8, 40), cx, top + w * 0.22, cz, Math.PI / 2 - 0.15), 0xffe7a0);
    return mesh([g], new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, toneMapped: false }), 'cosHalo');
  }
  if (kind === 'antlers') {
    const brown = 0x7a4f27, y0 = R.hat.min.y + (top - R.hat.min.y) * 0.45;
    for (const s of [-1, 1]) {
      const bx = cx + s * w * 0.36, by = y0, bz = cz - w * 0.02;
      const L = w * 0.42, tilt = s * -0.45;
      P.push(paint(at(new THREE.CylinderGeometry(w * 0.03, w * 0.045, L, 7), bx + s * Math.sin(-tilt) * L * 0.5, by + Math.cos(tilt) * L * 0.5, bz, 0, 0, tilt), brown));
      const tx = bx + s * Math.sin(-tilt) * L, ty = by + Math.cos(tilt) * L;
      P.push(paint(at(new THREE.SphereGeometry(w * 0.032, 7, 5), tx, ty, bz), brown));
      for (const [f, a, l] of [[0.45, -0.5, 0.2], [0.75, 0.55, 0.17], [0.62, -1.1, 0.15]]) {
        const px = bx + s * Math.sin(-tilt) * L * f, py = by + Math.cos(tilt) * L * f, aa = tilt + s * a;
        P.push(paint(at(new THREE.CylinderGeometry(w * 0.018, w * 0.028, w * l, 6), px - Math.sin(aa) * w * l * 0.5, py + Math.cos(aa) * w * l * 0.5, bz, 0, 0, aa), brown));
      }
    }
    return mesh(P, stdMat({ roughness: 0.8 }), 'cosAntlers');
  }
  if (kind === 'holly') {
    const x = cx - w * 0.3, y = R.hat.min.y + w * 0.1, z = R.hat.max.z - w * 0.06;
    for (const [a, dx, dy] of [[0.5, -0.06, 0.02], [-0.4, 0.06, 0.03], [1.6, 0, 0.08]]) {
      const g = new THREE.SphereGeometry(w * 0.09, 10, 6); g.scale(1, 0.45, 0.16);
      P.push(paint(at(g, x + dx * w, y + dy * w, z, 0.3, 0, a), 0x1d7a35));
    }
    for (const [dx, dy] of [[0, 0], [0.05, -0.03], [-0.045, -0.035]]) P.push(paint(at(new THREE.SphereGeometry(w * 0.035, 10, 8), x + dx * w, y + dy * w, z + w * 0.03), 0xe01f33));
    return mesh(P, stdMat({ roughness: 0.4 }), 'cosHolly');
  }
  return null;
}

function buildBack(kind, R) {
  const w = R.hs.x, b = R.back, P = [];
  if (kind === 'sack') {
    const s = new THREE.SphereGeometry(w * 0.42, 16, 12); s.scale(1, 1.12, 0.78);
    P.push(paint(at(s, b.x, b.y - w * 0.05, b.z - w * 0.3), 0x8a5a2b));
    P.push(paint(at(new THREE.CylinderGeometry(w * 0.1, w * 0.16, w * 0.22, 10), b.x, b.y + w * 0.47, b.z - w * 0.3), 0x8a5a2b));
    P.push(paint(at(new THREE.TorusGeometry(w * 0.12, w * 0.025, 6, 16), b.x, b.y + w * 0.42, b.z - w * 0.3, Math.PI / 2), 0xe0b13a));
    // gift corners peeking out of the top
    P.push(paint(at(new THREE.BoxGeometry(w * 0.16, w * 0.16, w * 0.16), b.x - w * 0.05, b.y + w * 0.6, b.z - w * 0.32, 0.3, 0.4, 0.2), 0x2f7dff));
    P.push(paint(at(new THREE.BoxGeometry(w * 0.13, w * 0.13, w * 0.13), b.x + w * 0.08, b.y + w * 0.62, b.z - w * 0.26, -0.2, 0.7, -0.3), 0xd8202e));
    // straps
    for (const s2 of [-1, 1]) P.push(paint(at(new THREE.TorusGeometry(w * 0.3, w * 0.03, 6, 16, Math.PI), b.x + s2 * w * 0.22, b.y + w * 0.08, b.z + w * 0.02, 0, Math.PI / 2, 0), 0x5b3a1c));
    return mesh(P, stdMat({ roughness: 0.85 }), 'cosSack');
  }
  if (kind === 'cane') {
    const L = w * 1.5, path = new THREE.CurvePath();
    const p0 = new THREE.Vector3(0, -L * 0.5, 0), p1 = new THREE.Vector3(0, L * 0.4, 0);
    path.add(new THREE.LineCurve3(p0, p1));
    const r = w * 0.17; path.add(new THREE.CubicBezierCurve3(p1, new THREE.Vector3(0, L * 0.4 + r * 1.3, 0), new THREE.Vector3(r * 2, L * 0.4 + r * 1.3, 0), new THREE.Vector3(r * 2, L * 0.4 - r * 0.2, 0)));
    let g = new THREE.TubeGeometry(path, 64, w * 0.055, 10, false);
    const uv = g.attributes.uv, n = uv.count, col = new Float32Array(n * 3), red = new THREE.Color(0xd81e2c), wh = new THREE.Color(0xf6f6f2);
    for (let i = 0; i < n; i++) { const c = (uv.getX(i) * 14 + uv.getY(i)) % 1 < 0.5 ? red : wh; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
    at(g, b.x, b.y + w * 0.1, b.z - w * 0.1, 0, 0, -0.6);
    return mesh([g.toNonIndexed()], stdMat({ roughness: 0.3 }), 'cosCane');
  }
  if (kind === 'node') {
    const z = b.z - w * 0.22;
    P.push(paint(at(new THREE.BoxGeometry(w * 0.62, w * 0.78, w * 0.32), b.x, b.y, z), 0x1a2238));
    for (const dy of [-0.22, 0, 0.22]) P.push(paint(at(new THREE.BoxGeometry(w * 0.5, w * 0.035, w * 0.02), b.x, b.y + dy * w, z - w * 0.165), 0x3fa9ff));
    for (const dx of [-0.2, -0.12]) P.push(paint(at(new THREE.SphereGeometry(w * 0.022, 6, 4), b.x + dx * w, b.y + w * 0.32, z - w * 0.165), 0x4dff9a));
    P.push(paint(at(new THREE.CylinderGeometry(w * 0.012, w * 0.012, w * 0.3, 5), b.x + w * 0.22, b.y + w * 0.52, z), 0x9aa4b8));
    P.push(paint(at(new THREE.SphereGeometry(w * 0.04, 8, 6), b.x + w * 0.22, b.y + w * 0.68, z), 0x6fd0ff));
    return mesh(P, stdMat({ roughness: 0.35, metalness: 0.3, emissive: 0x0a1830 }), 'cosNode');
  }
  return null;
}

/** apply a look {slot: item} to the santa api (mascot only; the procedural fallback santa ignores it) */
export function applyLook(santa, look) {
  if (!santa?.lookU) return;
  const U = santa.lookU, it = (s) => look[s] || {};
  const tint = (on, col, item) => { if (item.c != null) { col.value.setHex(item.c); on.value = 1; } else on.value = 0; };
  tint(U.uSuitOn, U.uSuit, it('suit')); tint(U.uHatOn, U.uHat, it('hat')); tint(U.uBootOn, U.uBoot, it('boots'));
  const F = FLAMES[it('flame').fl] || FLAMES.icy;
  U.uC0.value.setRGB(...F[0]); U.uC1.value.setRGB(...F[1]); U.uC2.value.setRGB(...F[2]); U.uEC.value.setRGB(...F[3]); U.uPrism.value = it('flame').fl === 'prism' ? 1 : 0; U.uFlameOn.value = it('flame').fl && it('flame').fl !== 'icy' ? 1 : 0;
  santa.flameLight?.color.setHex(F[4]);
  const G = GOGGLES[it('goggles').gg] || GOGGLES.obsidian, gm = santa.goggle?.material;
  if (gm) {
    gm.color.setHex(G[0]); gm.metalness = G[1]; gm.roughness = G[2]; U.uEnvK.value = G[3]; gm.emissive.setHex(G[4]); gm.emissiveIntensity = G[5];
    // The face decal (transparent pass, paints the black icon backing) used to cover the opaque frame, so every goggle looked
    // like the default black mask. Non-default frames move to the transparent pass (opacity 1, depth write on), where
    // renderOrder 3 draws them after the decal (renderOrder 2). Obsidian keeps the original opaque path = identical default look.
    const show = G !== GOGGLES.obsidian;
    if (gm.transparent !== show) {
      gm.transparent = show; gm.depthWrite = true; gm.opacity = 1; gm.needsUpdate = true;
      // the frame front sits only a few mm over the rest-pose head; pull it toward the camera so the posed skin can't streak through
      gm.polygonOffset = show; gm.polygonOffsetFactor = -2; gm.polygonOffsetUnits = -600;
    }
  }
  santa.face?.setLens?.(LENSES[it('goggles').gg] || null);
  const slot = (name, kind, build) => {
    const S = santa.slots?.[name]; if (!S) return;
    const cur = S.children[0];
    if (cur && cur.userData.kind === kind) return;
    if (cur) { S.remove(cur); cur.geometry.dispose(); cur.material.dispose(); }
    if (!kind) return;
    const m = build(kind, santa.lookRef); if (m) { m.userData.kind = kind; S.add(m); }
  };
  slot('head', it('topper').acc, buildTopper); slot('back', it('back').acc, buildBack);
  santa.trailKind = it('trail').tr || null;
}

/** feet trail: snow sparkle / aurora via the shared Particles pool, gold coins as one small InstancedMesh */
export class Trail {
  constructor(scene, particles, quality) {
    this.p = particles; this.acc = 0; this.k = quality === 'low' ? 0.5 : 1; this.hue = 0;
    const N = 28; this.N = N;
    const g = new THREE.CylinderGeometry(0.075, 0.075, 0.018, 14); g.rotateX(Math.PI / 2);
    this.coins = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 0.85, roughness: 0.3, emissive: 0x4a2c00 }), N);
    this.coins.name = 'trailCoins'; this.coins.frustumCulled = false; this.coins.visible = false; this.coins.count = 0; scene.add(this.coins);
    this.c = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, s: 0 }));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.sc = new THREE.Vector3(); this.col = new THREE.Color();
  }
  update(dt, kind, pos, heading, speed, on) {
    const moving = on && kind && speed > 1.2;
    if (moving) {
      const rate = (kind === 'coins' ? 9 : 34) * this.k * Math.min(1, speed / 6);
      this.acc += dt * rate;
      const bx = -Math.sin(heading) * 0.35, bz = -Math.cos(heading) * 0.35;
      while (this.acc >= 1) {
        this.acc -= 1; const jx = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.5;
        if (kind === 'snow') {
          const b = 1.2 + Math.random() * 1.2; this.col.setRGB(b * 0.8, b * 0.9, b * 1.1);
          this.p.spawn(pos.x + bx + jx, pos.y + 0.15 + Math.random() * 0.5, pos.z + bz + jz, jx * 0.6, 1.2 + Math.random(), jz * 0.6, this.col, 0.7, 0, 0, 0, 0, 2.5);
        } else if (kind === 'aurora') {
          this.hue = (this.hue + dt * 0.25 + 0.004) % 1; this.col.setHSL(0.33 + 0.45 * (0.5 + 0.5 * Math.sin(this.hue * 6.283)), 1, 0.55).multiplyScalar(2.2);
          this.p.spawn(pos.x + bx + jx * 0.4, pos.y + 0.4 + Math.random() * 1.1, pos.z + bz + jz * 0.4, jx * 0.2, 2.6 + Math.random() * 0.6, jz * 0.2, this.col, 1.1, 0, 0, 0, 0, 3);
        } else if (kind === 'coins') {
          const c = this.c.find(c => c.life <= 0) || this.c[0];
          c.life = 1.1; c.p.set(pos.x + bx + jx, pos.y + 0.5, pos.z + bz + jz); c.v.set(jx * 2, 2.6 + Math.random(), jz * 2); c.f = pos.y + 0.03; c.r = Math.random() * 6; c.s = 6 + Math.random() * 6;
          this.col.setRGB(2.2, 1.6, 0.4); this.p.spawn(c.p.x, c.p.y, c.p.z, 0, 0.8, 0, this.col, 0.4);
        }
      }
    }
    // coins sim
    let n = 0;
    for (const c of this.c) {
      if (c.life <= 0) continue;
      c.life -= dt; c.v.y -= 9 * dt; c.p.addScaledVector(c.v, dt); if (c.p.y < c.f) { c.p.y = c.f; c.v.set(0, 0, 0); }
      c.r += c.s * dt; this.e.set(0, c.r, 0); this.q.setFromEuler(this.e);
      this.sc.setScalar(Math.min(1, c.life * 3)); this.m.compose(c.p, this.q, this.sc); this.coins.setMatrixAt(n++, this.m);
    }
    this.coins.count = n; this.coins.visible = n > 0; if (n) this.coins.instanceMatrix.needsUpdate = true;
  }
  clear() { for (const c of this.c) c.life = 0; this.coins.count = 0; this.coins.visible = false; }
}
