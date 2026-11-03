// Procedural placeholder buildings (10 types). Each faces +Z (door at +Z).
// Returns { group (static meshes), windowGeos (local), animated:[], footprint, height, door }
import * as THREE from 'three';
import { materials } from './materials.js?v=c331d8ef';
import { gableGeometry, textTexture, canvasTexture } from './util.js?v=c331d8ef';
import { makeLogoMesh } from './logo.js?v=c331d8ef';
import { MANIFEST } from '../assets/manifest.js?v=c331d8ef';

class B {
  constructor() { this.group = new THREE.Group(); this.windowGeos = []; this.animated = []; this.M = materials(); }
  mesh(geo, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); return m;
  }
  box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) { return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, ry); }
  cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0) { return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z); }
  cone(r, h, seg, mat, x = 0, y = 0, z = 0, ry = 0) { return this.mesh(new THREE.ConeGeometry(r, h, seg), mat, x, y + h / 2, z, ry); }
  gable(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) { return this.mesh(gableGeometry(w, h, d), mat, x, y, z, ry); }
  roof(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) {
    this.gable(w, h, d, mat, x, y, z, ry);
    const k = 0.62; // snow covers the upper part of the roof
    this.gable(w + 0.06, h * k, d * k, this.M.snow, x, y + h * (1 - k) + 0.09, z, ry);
    // eave snow lip
  }
  win(w, h, x, y, z, ry = 0, frame = true) {
    const g = new THREE.BoxGeometry(w, h, 0.14);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m); this.windowGeos.push(g);
    if (frame) {
      const f = this.box(w + 0.24, h + 0.24, 0.08, this.M.trim, x, y - (h + 0.24) / 2, z, ry);
      f.position.x -= Math.sin(ry) * 0.04; f.position.z -= Math.cos(ry) * 0.04;
      this.box(w + 0.4, 0.1, 0.25, this.M.snow, x + Math.sin(ry) * 0.06, y - h / 2 - 0.16, z + Math.cos(ry) * 0.06, ry);
    }
  }
  door(x, z, w = 1.3, h = 2.3, mat = this.M.woodDark, ry = 0) {
    this.box(w, h, 0.18, mat, x, 0, z, ry);
    this.box(w + 0.3, 0.18, 0.3, this.M.trim, x, h, z, ry);
    // lamp above door -> part of window glow (turns blue on delivery)
    this.win(0.28, 0.36, x + w / 2 + 0.35, h - 0.1, z + 0.12, ry, false);
  }
  sign(text, w, h, x, y, z, ry = 0, opts = {}) {
    const t = textTexture(text, opts);
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: opts.emissive ?? 0.55, roughness: 0.6 });
    const m = this.mesh(new THREE.BoxGeometry(w, h, 0.12), mat, x, y, z, ry);
    m.userData.unique = true; m.castShadow = false;
    return m;
  }
  chimney(x, y, z, h = 2.2, mat = this.M.stone) {
    this.box(0.9, h, 0.9, mat, x, y, z);
    this.box(1.05, 0.2, 1.05, this.M.snow, x, y + h, z);
  }
}

// ---------------------------------------------------------------- types
function logCabin(b) {
  const { M } = b; const w = 8, d = 6, h = 3.4;
  b.box(w, 0.4, d, M.stone, 0, 0, 0);
  b.box(w, h, d, M.wood, 0, 0.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.22, 0.22, h, 8, M.wood, sx * w / 2, 0.4, sz * d / 2); // log corners
  b.roof(w + 1.2, 2.7, d + 1.4, M.roofDark, 0, h + 0.4, 0);
  b.chimney(2.4, h + 1, -0.8, 2.6);
  b.door(0, d / 2 + 0.02);
  b.win(1.3, 1.1, -2.5, 2.2, d / 2 + 0.05); b.win(1.3, 1.1, 2.5, 2.2, d / 2 + 0.05);
  b.win(1.2, 1.0, w / 2 + 0.05, 2.2, 0, Math.PI / 2); b.win(1.2, 1.0, -w / 2 - 0.05, 2.2, 0, -Math.PI / 2);
  // porch
  b.box(4.4, 0.25, 1.8, M.woodDark, 0, 0, d / 2 + 0.9);
  for (const sx of [-2, 2]) b.cyl(0.12, 0.12, 2.8, 6, M.wood, sx, 0.25, d / 2 + 1.6);
  b.box(4.8, 0.18, 2.2, M.roofDark, 0, 3.05, d / 2 + 1.0);
  b.box(4.9, 0.14, 2.3, M.snow, 0, 3.23, d / 2 + 1.0);
}

function stoneCottage(b) {
  const { M } = b; const w = 7, d = 6, h = 3.2;
  b.box(w, h, d, M.stone, 0, 0, 0);
  b.roof(w + 1, 3.6, d + 1.2, M.roofSlate, 0, h, 0);
  // dormer
  b.box(1.6, 1.3, 1.6, M.plaster, 1.4, h + 0.4, 1.6);
  b.roof(1.9, 0.9, 2.0, M.roofSlate, 1.4, h + 1.7, 1.6, Math.PI / 2);
  b.win(0.8, 0.7, 1.4, h + 1.05, 2.45);
  b.chimney(-2.3, h + 1.2, 0, 2.4);
  b.door(-0.8, d / 2 + 0.02, 1.2, 2.2, M.roofGreen);
  b.win(1.4, 1.1, 1.8, 1.8, d / 2 + 0.05);
  b.win(1.0, 1.0, -w / 2 - 0.05, 1.8, 0, -Math.PI / 2);
  b.win(1.0, 1.0, w / 2 + 0.05, 1.8, -1, Math.PI / 2);
  // little picket fence
  for (let i = -3; i <= 3; i++) if (Math.abs(i) > 0) b.box(0.12, 0.8, 0.08, M.trim, i * 0.55 + (i > 0 ? 0.6 : -2.2), 0, d / 2 + 1.6);
}

function bakery(b) {
  const { M } = b; const w = 9, d = 7, h = 4.6;
  b.box(w, h, d, M.plasterPink, 0, 0, 0);
  b.box(w + 0.2, 0.9, d + 0.2, M.stone, 0, 0, 0);
  b.roof(w + 1, 3.0, d + 1.3, M.roofRed, 0, h, 0);
  b.chimney(-2.8, h + 0.8, -1, 2.4, M.stone);
  b.door(2.6, d / 2 + 0.02, 1.4, 2.4, M.woodRed);
  b.win(4.2, 1.8, -1.6, 1.9, d / 2 + 0.06); // shop window
  b.win(1.1, 1.0, -2.5, 3.9, d / 2 + 0.05); b.win(1.1, 1.0, 0.5, 3.9, d / 2 + 0.05); b.win(1.1, 1.0, 2.8, 3.9, d / 2 + 0.05);
  // striped awning
  const stripes = canvasTexture(256, 64, (g, W, H) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4efe6' : '#b3262c'; g.fillRect(i * W / 8, 0, W / 8, H); } });
  const aw = b.mesh(new THREE.BoxGeometry(5.0, 0.08, 1.5), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8 }), -1.6, 3.05, d / 2 + 0.7);
  aw.rotation.x = 0.35; aw.userData.unique = true;
  b.box(5.1, 0.08, 1.4, M.snow, -1.6, 3.18, d / 2 + 0.62).rotation.x = 0.35;
  b.sign('BAKERY', 4.6, 1.0, -0.3, 5.05, d / 2 + 0.6, 0, { bg: '#4a1f12', fg: '#ffe7b0', glow: '#ffb347' });
}

function church(b) {
  const { M } = b; const w = 8, d = 12, h = 6;
  b.box(w, h, d, M.stone, 0, 0, -1.5);
  b.roof(d + 0.6, 4.2, w + 1.2, M.roofSlate, 0, h, -1.5, Math.PI / 2);
  // tower at the front
  const tz = d / 2 + 0.3 - 1.5;
  b.box(4, 12, 4, M.stone, 0, 0, tz);
  b.box(4.4, 0.4, 4.4, M.trim, 0, 12, tz);
  b.cone(3.1, 7, 4, M.roofSlate, 0, 12.4, tz, Math.PI / 4);
  b.cone(1.6, 3.4, 4, M.snow, 0, 16.1, tz, Math.PI / 4);
  b.box(0.15, 1.4, 0.15, M.gold, 0, 19.3, tz); b.box(0.8, 0.15, 0.15, M.gold, 0, 19.9, tz);
  // clock faces
  const clock = canvasTexture(256, 256, (g, W) => {
    g.fillStyle = '#f7ecd0'; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 6, 0, 7); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#2b2118'; g.stroke();
    g.fillStyle = '#2b2118';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(W / 2 + Math.cos(a) * 100 - 6, W / 2 + Math.sin(a) * 100 - 6, 12, 12); }
    g.lineCap = 'round'; g.lineWidth = 12; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2, 52); g.stroke(); // 12
    g.lineWidth = 9; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 + 60, W / 2 - 20); g.stroke();
  });
  const cm = new THREE.MeshStandardMaterial({ map: clock, emissiveMap: clock, emissive: 0xfff0c8, emissiveIntensity: 0.7, transparent: true });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const m = b.mesh(new THREE.CircleGeometry(1.25, 32), cm, Math.sin(a) * 2.03, 9.6, tz + Math.cos(a) * 2.03, a);
    m.castShadow = false; m.userData.unique = true;
  }
  b.door(0, tz + 2.02, 1.6, 2.9, M.woodDark);
  b.win(0.9, 1.6, 0, 6.0, tz + 2.05);
  // tall stained windows on the sides
  for (const z of [-5, -2, 1]) { b.win(0.9, 2.4, w / 2 + 0.05, 2.8, z - 1.5 + 1.5, Math.PI / 2); b.win(0.9, 2.4, -w / 2 - 0.05, 2.8, z, -Math.PI / 2); }
}

function townhouse(b) {
  const { M } = b; const w = 7, d = 7;
  b.box(w, 3.2, d, M.stone, 0, 0, 0);
  // jettied upper floors with timber framing
  const tim = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#efe4cf'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3b2516';
    g.fillRect(0, 0, W, 16); g.fillRect(0, H - 16, W, 16); g.fillRect(0, H / 2 - 8, W, 16);
    for (const x of [0, W / 3, 2 * W / 3, W - 16]) g.fillRect(x, 0, 16, H);
    g.lineWidth = 12; g.strokeStyle = '#3b2516';
    g.beginPath(); g.moveTo(16, H / 2); g.lineTo(W / 3, 16); g.moveTo(2 * W / 3 + 16, 16); g.lineTo(W - 16, H / 2); g.stroke();
  });
  tim.wrapS = tim.wrapT = THREE.RepeatWrapping; tim.repeat.set(2, 1);
  const tm = new THREE.MeshStandardMaterial({ map: tim, roughness: 0.9 });
  const up = b.box(w + 0.8, 5.0, d + 0.8, tm, 0, 3.2, 0); up.userData.unique = true;
  b.roof(w + 1.6, 4.0, d + 2.0, M.roofDark, 0, 8.2, 0);
  b.chimney(2.2, 9.5, -1.2, 2.2);
  b.door(-1.6, d / 2 + 0.02, 1.2, 2.3, M.roofRed);
  b.win(1.6, 1.1, 1.4, 1.7, d / 2 + 0.05);
  for (const x of [-2.2, 0, 2.2]) { b.win(0.9, 1.1, x, 4.9, d / 2 + 0.45); b.win(0.9, 1.1, x, 7.2, d / 2 + 0.45); }
  for (const z of [-1.6, 1.6]) { b.win(0.9, 1.1, w / 2 + 0.45, 5.5, z, Math.PI / 2); b.win(0.9, 1.1, -w / 2 - 0.45, 5.5, z, -Math.PI / 2); }
}

function validatorHouse(b) {
  const { M } = b; const w = 11, d = 8;
  b.box(w + 0.6, 0.4, d + 0.6, M.concrete, 0, 0, 0);
  b.box(w, 3.4, d, M.glassDark, 0, 0.4, 0);
  // glowing interior (windows) on glass faces
  b.win(w - 1.2, 2.6, -0, 2.05, d / 2 + 0.03, 0, false);
  b.win(d - 1.2, 2.6, w / 2 + 0.03, 2.05, 0, Math.PI / 2, false);
  b.win(d - 1.2, 2.6, -w / 2 - 0.03, 2.05, 0, -Math.PI / 2, false);
  // cantilevered upper volume
  b.box(w * 0.7, 2.8, d + 1.6, M.concrete, -1.5, 3.8, -0.4);
  b.win(w * 0.7 - 1.0, 0.9, -1.5, 5.3, d / 2 + 0.43, 0, false);
  b.box(w * 0.7 + 0.2, 0.25, d + 1.8, M.snow, -1.5, 6.6, -0.4);
  b.box(w + 0.1, 0.12, d + 0.1, M.snow, 0, 3.8, 0);
  // door (glass)
  b.box(1.6, 2.5, 0.12, M.metal, 3.6, 0.4, d / 2 + 0.06);
  // neon strip
  const strip = new THREE.MeshStandardMaterial({ color: 0x07131f, emissive: 0x2fb4ff, emissiveIntensity: 2.6 });
  const s1 = b.mesh(new THREE.BoxGeometry(w + 0.6, 0.08, 0.08), strip, 0, 0.42, d / 2 + 0.32); s1.userData.unique = true; s1.castShadow = false;
  // Optimum logo sign on the upper facade
  const logo = makeLogoMesh(1.25, 0.024, 0x51b1fe, 1.5);
  logo.position.set(3.4, 5.25, d / 2 + 0.12);
  logo.userData.unique = true;
  b.group.add(logo);
  b.sign('VALIDATOR', 3.4, 0.55, 3.4, 3.7, d / 2 + 0.1, 0, { bg: '#06121e', fg: '#8fdcff', glow: '#2fb4ff', border: null, font: 'bold 80px Arial, sans-serif', emissive: 1.1 });
}

function toyWorkshop(b) {
  const { M } = b; const w = 11, d = 8, h = 4.6;
  b.box(w, h, d, M.woodRed, 0, 0, 0);
  b.roof(w + 1, 2.0, d + 1.4, M.roofGreen, 0, h, 0);
  b.roof(w + 0.6, 1.6, d * 0.55, M.roofGreen, 0, h + 1.1, 0);
  // big barn doors with white X
  b.box(3.2, 3.2, 0.15, M.woodRed, 0, 0, d / 2 + 0.05);
  b.box(3.4, 0.2, 0.2, M.trim, 0, 3.2, d / 2 + 0.1);
  const x1 = b.box(4.4, 0.18, 0.1, M.trim, 0, 1.5, d / 2 + 0.16); x1.rotation.z = 0.78;
  const x2 = b.box(4.4, 0.18, 0.1, M.trim, 0, 1.5, d / 2 + 0.16); x2.rotation.z = -0.78;
  b.win(0.28, 0.36, 2.0, 3.0, d / 2 + 0.1, 0, false);
  b.win(1.2, 1.0, -3.6, 2.2, d / 2 + 0.05); b.win(1.2, 1.0, 3.6, 2.2, d / 2 + 0.05);
  b.win(1.4, 0.9, 0, h + 0.9, d / 2 * 0.95 + 0.4);
  b.sign("ELF WORKSHOP", 5.2, 0.8, 0, 3.7, d / 2 + 0.25, 0, { bg: '#0f3b22', fg: '#fff3c4', glow: '#ffd36b', font: 'bold 64px Georgia, serif' });
  // candy cane posts
  for (const sx of [-2.1, 2.1]) {
    const cc = canvasTexture(32, 128, (g, W, H) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#d8232a'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 16); g.lineTo(W, i * 16 - 10); g.lineTo(W, i * 16); g.lineTo(0, i * 16 + 10); g.fill(); } });
    const m = b.mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.4, 10), new THREE.MeshStandardMaterial({ map: cc, roughness: 0.4 }), sx, 1.2, d / 2 + 1.0);
    m.userData.unique = true;
  }
}

function inn(b) {
  const { M } = b; const w = 9, d = 8;
  b.box(w, 3, d, M.stone, -1.5, 0, 0);
  b.box(w + 0.4, 3.2, d + 0.4, M.plaster, -1.5, 3, 0);
  for (const x of [-5.5, -3.5, -1.5, 0.5, 2.5]) b.box(0.22, 3.2, 0.1, M.timber, x, 3, d / 2 + 0.22);
  b.box(w + 0.5, 0.22, 0.1, M.timber, -1.5, 3.0, d / 2 + 0.24); b.box(w + 0.5, 0.22, 0.1, M.timber, -1.5, 6.0, d / 2 + 0.24);
  b.roof(w + 1.4, 3.2, d + 1.6, M.roofRed, -1.5, 6.2, 0);
  // wing
  b.box(4, 3.8, 6, M.plaster, 4.5, 0, -1);
  b.roof(4.8, 2.0, 6.8, M.roofRed, 4.5, 3.8, -1, Math.PI / 2);
  b.chimney(-4.5, 7, -1.5, 2.6);
  b.door(-1.5, d / 2 + 0.02, 1.5, 2.4, M.woodDark);
  b.win(1.3, 1.0, -4.5, 1.6, d / 2 + 0.05); b.win(1.3, 1.0, 1.5, 1.6, d / 2 + 0.05);
  for (const x of [-4.5, -1.5, 1.5]) b.win(1.0, 1.0, x, 4.6, d / 2 + 0.25);
  b.win(1.0, 1.0, 4.5, 2.0, 2.05);
  // hanging sign on bracket
  b.box(0.12, 0.12, 1.6, M.metal, 0.6, 3.2, d / 2 + 0.9);
  b.sign('INN', 1.6, 0.9, 0.6, 2.25, d / 2 + 1.5, Math.PI / 2, { bg: '#2d1608', fg: '#ffd27a', font: 'bold 96px Georgia, serif', w: 256, h: 128 });
}

function gingerbread(b) {
  const { M } = b; const w = 6, d = 6, h = 3.2;
  b.box(w, h, d, M.ginger, 0, 0, 0);
  // icing trims
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.14, 0.14, h, 6, M.icing, sx * w / 2, 0, sz * d / 2);
  b.box(w + 0.3, 0.18, d + 0.3, M.icing, 0, h - 0.05, 0);
  b.roof(w + 1.2, 3.0, d + 1.4, M.ginger, 0, h, 0);
  b.gable(w + 1.3, 2.4, (d + 1.4) * 0.8, M.icing, 0, h + 0.7, 0);
  // gumdrops on roof ridge
  const gm = [M.candyRed, M.candyGreen];
  for (let i = -3; i <= 3; i++) b.mesh(new THREE.SphereGeometry(0.22, 10, 8), gm[(i + 3) % 2], i * 0.95, h + 3.15, 0);
  b.door(0, d / 2 + 0.02, 1.2, 2.0, M.candyRed);
  b.win(0.9, 0.9, -1.9, 1.8, d / 2 + 0.05); b.win(0.9, 0.9, 1.9, 1.8, d / 2 + 0.05);
  b.win(0.9, 0.9, w / 2 + 0.05, 1.8, 0, Math.PI / 2);
  for (const sx of [-1.2, 1.2]) b.cyl(0.1, 0.1, 1.3, 8, M.candyRed, sx, 0, d / 2 + 1.2);
}

function windmill(b) {
  const { M } = b;
  b.cyl(2.2, 3.0, 9, 14, M.stone, 0, 0, 0);
  b.cone(2.7, 3.2, 14, M.roofDark, 0, 9, 0);
  b.cone(1.6, 1.9, 14, M.snow, 0, 10.4, 0);
  b.door(0, 2.82, 1.2, 2.2, M.woodDark);
  b.win(0.7, 0.9, 0, 5.2, 2.62); b.win(0.6, 0.8, 0, 7.4, 2.35);
  b.win(0.7, 0.9, 2.55, 3.6, 0, Math.PI / 2, false);
  // rotating blades (animated, not merged)
  const hub = new THREE.Group(); hub.position.set(0, 8.4, 2.6);
  const bladeMat = M.wood;
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Group(); a.rotation.z = i * Math.PI / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.2, 0.15), M.woodDark); arm.position.y = 3.1; arm.castShadow = true;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.6, 0.06), bladeMat); sail.position.set(0.7, 3.6, 0); sail.castShadow = true;
    a.add(arm, sail); hub.add(a);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), M.metal); hub.add(cap);
  b.group.add(hub); hub.userData.unique = true; hub.userData.spin = 0.6;
  b.animated.push(hub);
}

export const BUILDING_TYPES = { logCabin, stoneCottage, bakery, church, townhouse, validatorHouse, toyWorkshop, inn, gingerbread, windmill };
export const BUILDING_WEIGHTS = { logCabin: 3, stoneCottage: 3, bakery: 1.2, church: 0.6, townhouse: 3, validatorHouse: 1.6, toyWorkshop: 1.2, inn: 1, gingerbread: 1.5, windmill: 0.7 };

export function buildProcedural(type) {
  const b = new B();
  BUILDING_TYPES[type](b);
  const spec = MANIFEST.buildings[type];
  return { group: b.group, windowGeos: b.windowGeos, animated: b.animated, footprint: spec.footprint, height: spec.height, door: spec.door };
}
