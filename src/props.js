// Procedural props + characters' placeholders (pine, lamp, christmas tree, snowman, sleigh, reindeer, bench, gift)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from './materials.js?v=0c77b1e6';

function colored(geo, color) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  const c = new THREE.Color(color);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Pine with snow caps, single vertex-colored geometry (for InstancedMesh). Height ~9. */
export function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 6); trunk.translate(0, 0.8, 0);
  parts.push(colored(trunk, 0x4a3221));
  const layers = [[2.6, 3.4, 1.2], [2.1, 3.0, 3.0], [1.55, 2.7, 4.7], [0.95, 2.3, 6.3]];
  for (const [r, h, y] of layers) {
    const g = new THREE.ConeGeometry(r, h, 8); g.translate(0, y + h / 2, 0);
    parts.push(colored(g, 0x1b3a29));
    const s = new THREE.ConeGeometry(r * 0.62, h * 0.55, 8); s.translate(0, y + h * 0.45 + h * 0.55 / 2 + 0.06, 0);
    parts.push(colored(s, 0xe9f1ff));
  }
  return mergeGeometries(parts);
}

/** Street lamp: returns { post (metal geometry), head (emissive lantern geometry) } — head origin at lantern. */
export function lampGeometries() {
  const base = new THREE.CylinderGeometry(0.22, 0.28, 0.4, 8); base.translate(0, 0.2, 0);
  const post = new THREE.CylinderGeometry(0.08, 0.1, 3.8, 8); post.translate(0, 2.1, 0);
  const cap = new THREE.ConeGeometry(0.34, 0.35, 6); cap.translate(0, 4.4, 0);
  const capSnow = new THREE.ConeGeometry(0.28, 0.2, 6); capSnow.translate(0, 4.55, 0);
  const postG = mergeGeometries([colored(base, 0x1f2226), colored(post, 0x1f2226), colored(cap, 0x1f2226), colored(capSnow, 0xf0f4ff)]);
  const head = new THREE.CylinderGeometry(0.22, 0.17, 0.42, 6); head.translate(0, 4.02, 0);
  return { post: postG, head };
}

export function christmasTree() {
  const M = materials();
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2, 10), M.trunk); trunk.position.y = 1; g.add(trunk);
  const layers = [[5.2, 4.6, 1.6], [4.3, 4.2, 4.2], [3.4, 3.8, 6.8], [2.4, 3.3, 9.2], [1.4, 2.8, 11.4]];
  const green = new THREE.MeshStandardMaterial({ color: 0x173d29, roughness: 0.85 });
  for (const [r, h, y] of layers) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), green); c.position.y = y + h / 2; c.castShadow = true; c.receiveShadow = true; g.add(c);
    const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, h * 0.42, 14), M.snow); s.position.y = y + h * 0.6 + 0.1; g.add(s);
  }
  // ornaments + string lights (instanced, unlit bright colors -> bloom)
  const cols = [0xff3344, 0xffd24a, 0x3fb6ff, 0x55ff99, 0xff77dd, 0xffffff];
  const N = 140;
  const om = new THREE.MeshBasicMaterial({ color: 0xffffff }); om.color.setScalar(2.2);
  const orn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), om, N);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const t = i / N; const y = 2.2 + t * 11.2; const r = 5.0 * (1 - t) + 0.35;
    const a = t * Math.PI * 2 * 7.5;
    m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); orn.setMatrixAt(i, m4);
    orn.setColorAt(i, c.setHex(cols[i % cols.length]));
  }
  g.add(orn);
  // star
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2; const r = i % 2 ? 0.45 : 1.05; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffc040, emissiveIntensity: 3.5 }));
  star.position.set(0, 14.9, -0.12); g.add(star);
  g.userData.star = star;
  return g;
}

export function snowman() {
  const M = materials(); const g = new THREE.Group();
  const s = (r, y) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), M.snow); m.position.y = y; m.castShadow = true; g.add(m); };
  s(0.6, 0.5); s(0.45, 1.25); s(0.32, 1.85);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xff7a1a })); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.86, 0.4); g.add(nose);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12), M.metal); hat.position.y = 2.32; g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12), M.metal); brim.position.y = 2.13; g.add(brim);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.08, 6, 14), M.candyRed); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.58; g.add(scarf);
  for (const x of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), M.metal); e.position.set(x, 1.95, 0.28); g.add(e); }
  return g;
}

export function bench() {
  const M = materials(); const g = new THREE.Group();
  const b = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
  b(2.2, 0.1, 0.6, M.wood, 0, 0.5, 0); b(2.2, 0.5, 0.08, M.wood, 0, 0.85, -0.28);
  for (const x of [-0.95, 0.95]) b(0.08, 0.5, 0.55, M.metal, x, 0.25, 0);
  b(2.25, 0.08, 0.62, M.snow, 0, 0.59, 0);
  return g;
}

export function giftBox(color = 0x1e7bff, emissive = 0x1e7bff, size = 0.5, glow = 1.4) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.85, size), new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: glow, roughness: 0.35, metalness: 0.1 }));
  box.castShadow = true; g.add(box);
  const rib = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, emissive: 0x9fd4ff, emissiveIntensity: 0.2 + glow * 0.4, roughness: 0.3 });
  const r1 = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.87, size * 0.16), rib); g.add(r1);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 0.87, size * 1.02), rib); g.add(r2);
  for (const s of [-1, 1]) { const bow = new THREE.Mesh(new THREE.TorusGeometry(size * 0.15, size * 0.05, 6, 12), rib); bow.position.set(s * size * 0.12, size * 0.5, 0); bow.rotation.y = Math.PI / 2; bow.rotation.z = s * 0.6; g.add(bow); }
  g.userData.box = box;
  return g;
}

// The block Santa carries: a glowing blue gift (emissive edges + soft inner glow + light ribbon/bow), ~0.38 m.
let _giftTex = null;
function giftFaceTexture() {
  if (_giftTex) return _giftTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 90); g.addColorStop(0, '#3f8dff'); g.addColorStop(0.55, '#1a55d8'); g.addColorStop(1, '#0a2470');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.shadowColor = '#7fd0ff'; x.shadowBlur = 10; x.strokeStyle = '#bfeaff'; x.lineWidth = 5; x.strokeRect(2.5, 2.5, 123, 123);
  x.shadowBlur = 0; x.lineWidth = 2; x.strokeStyle = '#ffffff'; x.strokeRect(1, 1, 126, 126);
  _giftTex = new THREE.CanvasTexture(c); _giftTex.colorSpace = THREE.SRGBColorSpace;
  return _giftTex;
}
export function glowGift(size = 0.38) {
  const g = new THREE.Group(), h = size * 0.86, tex = giftFaceTexture();
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), new THREE.MeshStandardMaterial({ color: 0x2a5fd0, map: tex, emissive: 0x7fbcff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.15, envMapIntensity: 1.2 }));
  box.castShadow = true; g.add(box);
  const rib = new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x6fc8ff, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.2 });
  const bw = size * 0.13;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(size * 1.025, h * 1.02, bw), rib));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(bw, h * 1.02, size * 1.025), rib));
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(size * 0.17, size * 0.045, 8, 16), rib);
    loop.scale.set(1, 0.62, 1); loop.position.set(s * size * 0.15, h / 2 + size * 0.08, 0); loop.rotation.set(0, 0, s * 0.35); g.add(loop);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(size * 0.06, size * 0.02, size * 0.22), rib);
    tail.position.set(s * size * 0.08, h / 2 + 0.01, size * 0.12); tail.rotation.y = s * 0.5; g.add(tail);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.065, 10, 8), rib); knot.position.y = h / 2 + size * 0.04; g.add(knot);
  g.userData.box = box;
  return g;
}

export function giftPile() {
  const g = new THREE.Group();
  const cols = [[0xc0242c, 0x300000], [0x1e7bff, 0x0a2a66], [0x1f9a4a, 0x002200], [0xd9a441, 0x332000]];
  const pos = [[0, 0, 0, 0.9], [0.9, 0, 0.3, 0.6], [-0.7, 0, 0.5, 0.7], [0.2, 0.75, 0.1, 0.5], [0.5, 0, -0.8, 0.65]];
  pos.forEach(([x, y, z, s], i) => { const b = giftBox(cols[i % 4][0], cols[i % 4][1], s, 0.4); b.position.set(x, y + s * 0.42, z); b.rotation.y = i; g.add(b); });
  return g;
}

export function sleigh() {
  const M = materials(); const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.6), M.candyRed); body.position.y = 0.95; body.castShadow = true; g.add(body);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16, 1, false, 0, Math.PI), M.candyRed); back.rotation.z = Math.PI / 2; back.position.set(0, 1.4, -1.1); g.add(back);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 1.2), new THREE.MeshStandardMaterial({ color: 0x1a4a2a })); seat.position.set(0, 1.45, -0.5); g.add(seat);
  for (const x of [-0.75, 0.75]) {
    const run = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.4), M.gold); run.position.set(x, 0.1, 0.2); g.add(run);
    const curl = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 12, Math.PI), M.gold); curl.rotation.y = Math.PI / 2; curl.position.set(x, 0.45, 1.9); g.add(curl);
    for (const z of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), M.gold); p.position.set(x, 0.35, z); g.add(p); }
  }
  const pile = giftPile(); pile.scale.setScalar(0.6); pile.position.set(0, 1.4, -0.9); g.add(pile);
  return g;
}

/** Procedural reindeer with leg pivots. Returns {group, update(dt, speed)} */
export function reindeer(rudolph = false) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
  const light = new THREE.MeshStandardMaterial({ color: 0xd9c3a3, roughness: 0.9 });
  const antlerM = new THREE.MeshStandardMaterial({ color: 0xcdb48c, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 4, 10), fur); body.rotation.x = Math.PI / 2; body.position.y = 1.15; body.castShadow = true; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.8, 8), fur); neck.position.set(0, 1.55, 0.75); neck.rotation.x = 0.6; g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.9, 1.0); g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), fur); skull.scale.set(1, 1, 1.4); head.add(skull);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), light); snout.position.set(0, -0.06, 0.28); head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(rudolph ? 0.085 : 0.06, 10, 8), rudolph ? new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 4 }) : new THREE.MeshStandardMaterial({ color: 0x111111 }));
  nose.position.set(0, -0.03, 0.42); head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 6), fur); ear.position.set(s * 0.18, 0.12, -0.05); ear.rotation.z = -s * 1.1; head.add(ear);
    const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5), antlerM); a1.position.set(s * 0.15, 0.4, -0.05); a1.rotation.z = -s * 0.45; head.add(a1);
    const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 5), antlerM); a2.position.set(s * 0.3, 0.62, 0.05); a2.rotation.set(0.5, 0, -s * 0.1); head.add(a2);
    const a3 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.28, 5), antlerM); a3.position.set(s * 0.2, 0.55, 0.1); a3.rotation.set(0.7, 0, s * 0.4); head.add(a3);
  }
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), light); tail.position.set(0, 1.3, -0.95); g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
    const p = new THREE.Group(); p.position.set(x, 1.0, z);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.0, 6), fur); l.position.y = -0.5; l.castShadow = true; p.add(l);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a10 })); h.position.y = -1.0; p.add(h);
    g.add(p); legs.push(p);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 14), materials().candyRed); collar.position.set(0, 1.62, 0.82); collar.rotation.x = 1.0; g.add(collar);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), materials().gold); bell.position.set(0, 1.46, 0.98); g.add(bell);
  let ph = Math.random() * 6;
  return {
    group: g,
    update(dt, speed) {
      ph += dt * (speed * 4.5 + 0.0001);
      const a = Math.min(1, speed) * 0.5;
      legs[0].rotation.x = Math.sin(ph) * a; legs[3].rotation.x = Math.sin(ph) * a;
      legs[1].rotation.x = Math.sin(ph + Math.PI) * a; legs[2].rotation.x = Math.sin(ph + Math.PI) * a;
      head.rotation.x = Math.sin(ph * 0.5) * 0.06 + (speed < 0.1 ? Math.sin(performance.now() * 0.0012) * 0.15 : 0);
    },
  };
}
