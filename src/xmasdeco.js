// Pass-2 Christmas dressing: snow shader patches, displaced snow terrain, code-built snowmen and decoration kits.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
/** Icosphere with shared vertices, so displaced lumps shade smoothly (Icosahedron is non-indexed in r170). */
export function smoothIco(r, detail) { const g = new THREE.IcosahedronGeometry(r, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); return mergeVertices(g, 1e-4 * r); }

// ------------------------------------------------------------------ JS noise
export function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z); let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, o = 4) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x, z); n += a; x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5; } return s / n; }
function n3(x, y, z) { return (vnoise(x + y * 1.7, z - y * 0.9) + vnoise(z * 1.3 - y, x + y * 1.1)) * 0.5; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ GLSL bits
const GLSL_NOISE = `
float snH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float snN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(snH(i), snH(i + vec3(1,0,0)), f.x), mix(snH(i + vec3(0,1,0)), snH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(snH(i + vec3(0,0,1)), snH(i + vec3(1,0,1)), f.x), mix(snH(i + vec3(0,1,1)), snH(i + vec3(1,1,1)), f.x), f.y), f.z); }
// view-dependent glints: tiny cells that flash as the camera moves
float snGlint(vec3 wp, vec3 n){
  vec3 c = floor(wp * 22.0); float h = snH(c);
  if (h < 0.93) return 0.0;
  vec3 V = normalize(cameraPosition - wp);
  vec3 f = normalize(vec3(snH(c + 3.1) - 0.5, 1.2, snH(c + 7.7) - 0.5));
  float g = pow(max(0.0, dot(reflect(-V, f), normalize(vec3(0.3, 1.0, 0.2)))), 40.0) + pow(max(0.0, sin(h * 211.0 + dot(cameraPosition, vec3(1.3, 0.7, 1.9)) * 1.6)), 24.0) * 0.6;
  return g * smoothstep(28.0, 4.0, length(cameraPosition - wp));
}`;

function worldPosVertex(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnW;')
    .replace('#include <project_vertex>', `#include <project_vertex>
    { vec4 snw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      snw = instanceMatrix * snw;
      #endif
      vSnW = (modelMatrix * snw).xyz; }`);
}

function chain(mat, key, fn) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, r) => { if (prev) prev.call(mat, sh, r); fn(sh); };
  mat.customProgramCacheKey = () => prevKey + '|' + key;
  mat.needsUpdate = true;
  return mat;
}

/** Snow on every up-facing surface above minY (roofs, ledges, pine branches): white, rough, sparkly. */
export function snowBlend(mat, o = {}) {
  const minY = (o.minY ?? 1.5).toFixed(2), thr = (o.thr ?? 0.45).toFixed(2), soft = (o.soft ?? 0.25).toFixed(2), amt = (o.amount ?? 1).toFixed(2), sc = (o.scale ?? 1.7).toFixed(2);
  return chain(mat, `snowB${minY}_${thr}_${soft}_${amt}_${sc}`, sh => {
    sh.uniforms.uSnowC = { value: new THREE.Color(o.color ?? 0xf2f6ff) };
    worldPosVertex(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSnW; uniform vec3 uSnowC; float snowAmt = 0.0;
${GLSL_NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wNg = normalize((vec4(nonPerturbedNormal, 0.0) * viewMatrix).xyz);
  float n1 = snN(vSnW * ${sc}), n2 = snN(vSnW * ${sc} * 4.0);
  float up = wNg.y + (n1 - 0.5) * 0.38 + (n2 - 0.5) * 0.14;
  float s = smoothstep(${thr}, ${thr} + ${soft}, up) * smoothstep(${minY}, ${minY} + 0.5, vSnW.y) * ${amt};
  snowAmt = s;
  diffuseColor.rgb = mix(diffuseColor.rgb, uSnowC * (0.9 + 0.1 * n2), s);
  roughnessFactor = mix(roughnessFactor, 0.8, s);
  normal = normalize(mix(normal, nonPerturbedNormal, s * 0.75));
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += snowAmt * (vec3(0.05, 0.07, 0.12) + vec3(0.9, 0.95, 1.0) * snGlint(vSnW, vec3(0.0, 1.0, 0.0)) * 2.2);`);
  });
}

/** Sparkle + soft subsurface-like lift for materials that are snow everywhere (terrain, snowmen, heaps). */
export function snowSparkle(mat, o = {}) {
  const k = (o.glint ?? 1).toFixed(2), lift = (o.lift ?? 1).toFixed(2);
  return chain(mat, `snowS${k}_${lift}`, sh => {
    worldPosVertex(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSnW;
${GLSL_NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 V = normalize(cameraPosition - vSnW);
  float rim = pow(clamp(1.0 - dot(wN, V), 0.0, 1.0), 3.0);
  // light scatters through thin crests -> faint cool glow on rims, deeper blue in hollows
  totalEmissiveRadiance += ${lift} * (vec3(0.05, 0.075, 0.13) * (0.5 + 0.5 * wN.y) + vec3(0.07, 0.1, 0.16) * rim);
  totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * snGlint(vSnW, wN) * 2.4 * ${k};
}`);
  });
}

// ------------------------------------------------------------------ geometry helpers
export function colorize(geo, color, jitter = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
  const c = new THREE.Color(color), n = geo.attributes.position.count, arr = new Float32Array(n * 3), p = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (hash2(p.getX(i) * 13.1 + p.getY(i) * 5.3, p.getZ(i) * 9.7) - 0.5) * jitter : 1;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
/** Per-vertex colour from a callback (x,y,z) -> THREE.Color */
function paint(geo, fn) {
  geo = colorize(geo, 0xffffff); const p = geo.attributes.position, c = geo.attributes.color, col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c.setXYZ(i, col.r, col.g, col.b); }
  return geo;
}
function tubeAlong(points, r, seg = 24, rad = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), seg, r, rad, false);
}
/** Lumpy hand-rolled ball. */
function lumpy(r, seed, detail = 4, amp = 0.05) {
  const g = smoothIco(r, detail); const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const d = v.clone().normalize();
    const n = n3(d.x * 2.2 + seed, d.y * 2.2, d.z * 2.2 - seed) - 0.5, m = n3(d.x * 7 + seed * 3, d.y * 7, d.z * 7) - 0.5;
    // hand-rolled: slightly flattened band around the "rolling" axis
    const band = 1 - 0.035 * Math.pow(Math.abs(d.x), 3);
    v.multiplyScalar((1 + n * amp * 2.2 + m * amp * 0.6) * band); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------------ snowmen
const SNOW = new THREE.Color(0xf4f7ff), DIRT = new THREE.Color(0x6b5a48), GRASS = new THREE.Color(0x56603a), PACK = new THREE.Color(0xd9e2f2);

/** Returns { snow: geometry (vertex coloured), acc: geometry (vertex coloured accessories), glow: null } */
export function snowmanVariant(v) {
  const seed = v * 3.7 + 1.3;
  const R = [[0.62, 0.5, 0.36], [0.55, 0.42, 0.3], [0.68, 0.48, 0.34]][v % 3];
  const snow = [], acc = [];
  // base drift
  const drift = lumpy(1.0, seed + 9, 4, 0.1); drift.scale(1.05, 0.2, 0.95); drift.translate(0, -0.02, 0);
  snow.push(paint(drift, (x, y, z, c) => {
    const d = Math.hypot(x, z), n = n3(x * 3, y * 3, z * 3);
    c.copy(SNOW).lerp(PACK, sstep(0.6, 1.3, d) * 0.5);
    if (d > 0.8 && n > 0.58) c.lerp(n > 0.66 ? GRASS : DIRT, sstep(0.58, 0.72, n) * 0.85); // ground showing where the snow was rolled up
  }));
  let y = R[0] * 0.82, prevR = 0; const centers = [];
  R.forEach((r, i) => {
    const b = lumpy(r, seed + i * 5.1, 4, 0.045 + 0.015 * (2 - i));
    b.scale(1, i === 0 ? 0.9 : 0.95, 1);
    if (i > 0) y += prevR * 0.78 + r * 0.72;
    b.translate(0, y, 0); centers.push([y, r]);
    const by = y;
    snow.push(paint(b, (x, yy, z, c) => {
      const h = yy - (by - r), n = n3(x * 5 + i, yy * 5, z * 5);
      c.copy(SNOW).multiplyScalar(0.94 + 0.08 * n);
      if (i === 0) { // picked-up dirt and leaves near the ground
        const k = sstep(0.42, 0.05, h) * sstep(0.35, 0.7, n + 0.15);
        c.lerp(n > 0.62 ? GRASS : DIRT, k * 0.85);
      }
      if (n > 0.71) c.lerp(PACK, 0.6); // compacted, icier patches
    }));
    prevR = r;
  });
  const [hy, hr] = centers[2], [my, mr] = centers[1];
  // coal: eyes, smile, buttons
  const coal = (x, yy, z, s) => { const g = new THREE.DodecahedronGeometry(s, 0); g.scale(1, 0.85, 0.8); g.rotateY(hash2(x * 9, yy) * 6); g.translate(x, yy, z); acc.push(colorize(g, 0x15151a, 0.4)); };
  const onSphere = (cy, r, ax, ay) => [Math.sin(ax) * Math.cos(ay) * r * 0.97, cy + Math.sin(ay) * r * 0.97, Math.cos(ax) * Math.cos(ay) * r * 0.97];
  for (const s of [-1, 1]) { const p = onSphere(hy, hr, s * 0.32, 0.22); coal(p[0], p[1], p[2], 0.045); }
  for (let k = 0; k < 6; k++) { const a = -0.42 + k * 0.168; const p = onSphere(hy, hr, a, -0.28 - 0.1 * Math.cos(a * 3.2)); coal(p[0], p[1], p[2], 0.028); }
  for (let k = 0; k < 3; k++) { const p = onSphere(my, mr, 0, 0.35 - k * 0.35); coal(p[0], p[1], p[2], 0.05); }
  const pb = onSphere(centers[0][0], centers[0][1], 0, 0.3); coal(pb[0], pb[1], pb[2], 0.055);
  // carrot nose (wrinkled, slightly crooked)
  const nose = new THREE.ConeGeometry(0.05, 0.34 + v * 0.03, 9, 6); nose.rotateX(Math.PI / 2); nose.rotateY(0.12 * (v - 1)); nose.rotateX(-0.08);
  nose.translate(0, hy + 0.02, hr + 0.14);
  acc.push(paint(nose, (x, yy, z, c) => { c.setHex(0xe8721c).multiplyScalar(0.8 + 0.25 * (0.5 + 0.5 * Math.sin(z * 90))); }));
  // twig arms with little fingers
  for (const s of [-1, 1]) {
    const up = s > 0 ? 0.35 + v * 0.1 : -0.05 + v * 0.12;
    const x0 = s * mr * 0.85, y0 = my + 0.08, L = 0.85;
    const x1 = x0 + s * L * Math.cos(up), y1 = y0 + L * Math.sin(up);
    const mid = [x0 + s * L * 0.5 * Math.cos(up), y0 + L * 0.5 * Math.sin(up) + 0.05, 0.04 * s];
    acc.push(colorize(tubeAlong([[x0, y0, 0], mid, [x1, y1, -0.03]], 0.022, 10, 5), 0x3a2818, 0.3));
    for (const [da, l] of [[0.6, 0.2], [-0.5, 0.18], [0.1, 0.16]]) {
      const a = up + da; acc.push(colorize(tubeAlong([[x1, y1, -0.03], [x1 + s * l * 0.5 * Math.cos(a), y1 + l * 0.5 * Math.sin(a), 0], [x1 + s * l * Math.cos(a), y1 + l * Math.sin(a), 0.02]], 0.011, 5, 4), 0x3a2818, 0.3));
    }
    // a side twig on the arm
    acc.push(colorize(tubeAlong([mid, [mid[0] + s * 0.1, mid[1] + 0.14, mid[2]], [mid[0] + s * 0.16, mid[1] + 0.22, mid[2] + 0.03]], 0.01, 5, 4), 0x3a2818, 0.3));
  }
  // knitted scarf: ribbed torus + tail with fringe
  const pal = [[0xc8202c, 0xf1e6d2], [0x1f6b3a, 0xe9dcc0], [0x2c5fb8, 0xf2f2f2]][v % 3];
  const ny = hy - hr * 0.88;
  const sc = new THREE.TorusGeometry(hr * 0.98, 0.075, 10, 40); sc.rotateX(Math.PI / 2); sc.scale(1, 1.25, 1); sc.translate(0, ny, 0);
  const knit = (x, yy, z, c) => { const a = Math.atan2(z, x), band = Math.floor((yy + 10) * 22) % 3 === 0; c.setHex(band ? pal[1] : pal[0]); c.multiplyScalar(0.85 + 0.2 * (0.5 + 0.5 * Math.sin(a * 60 + yy * 40))); };
  acc.push(paint(sc, knit));
  const tail = tubeAlong([[hr * 0.55, ny, hr * 0.75], [hr * 0.75, ny - 0.18, hr * 0.85], [hr * 0.78, ny - 0.42, mr * 0.95]], 0.06, 10, 6); tail.scale(1, 1, 1);
  acc.push(paint(tail, (x, yy, z, c) => { c.setHex(Math.floor((yy + 10) * 14) % 2 ? pal[0] : pal[1]).multiplyScalar(0.85 + 0.15 * Math.sin(yy * 120)); }));
  for (let k = 0; k < 6; k++) { const f = new THREE.BoxGeometry(0.014, 0.08, 0.014); f.translate(hr * 0.72 + (k - 2.5) * 0.022, ny - 0.5, mr * 0.95 + 0.02); acc.push(colorize(f, pal[1])); }
  // hats: knitted beanie with pompom / old top hat
  const top = hy + hr * 0.82;
  if (v % 3 === 1) {
    const crown = new THREE.CylinderGeometry(hr * 0.62, hr * 0.66, hr * 0.85, 16, 1); crown.translate(0, top + hr * 0.42, 0); crown.rotateZ(0.06);
    const brim = new THREE.CylinderGeometry(hr * 1.05, hr * 1.05, 0.035, 20); brim.translate(0, top + 0.01, 0);
    const band = new THREE.CylinderGeometry(hr * 0.665, hr * 0.665, 0.07, 16, 1, true); band.translate(0, top + 0.07, 0);
    acc.push(colorize(crown, 0x1b1b20, 0.25), colorize(brim, 0x1b1b20, 0.25), colorize(band, 0x7a1a20));
    const sn = lumpy(hr * 0.6, seed, 2, 0.08); sn.scale(1, 0.2, 1); sn.translate(0, top + hr * 0.86, 0); snow.push(colorize(sn, 0xf4f7ff));
  } else {
    const hat = new THREE.SphereGeometry(hr * 0.86, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); hat.scale(1, 1.15, 1); hat.translate(0, top - hr * 0.22, 0);
    acc.push(paint(hat, (x, yy, z, c) => { const a = Math.atan2(z, x); c.setHex(pal[0]).multiplyScalar(0.8 + 0.25 * (0.5 + 0.5 * Math.sin(a * 48))); if (Math.floor((yy - top) * 14 + 10) % 3 === 0) c.setHex(pal[1]); }));
    const cuff = new THREE.TorusGeometry(hr * 0.84, 0.06, 8, 32); cuff.rotateX(Math.PI / 2); cuff.translate(0, top - hr * 0.2, 0);
    acc.push(paint(cuff, (x, yy, z, c) => { c.setHex(pal[1]).multiplyScalar(0.85 + 0.2 * (0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 70))); }));
    const pom = lumpy(0.11, seed + 2, 2, 0.2); pom.translate(0.02, top + hr * 0.82, 0);
    acc.push(colorize(pom, pal[1], 0.3));
  }
  return { snow: mergeGeometries(snow), acc: mergeGeometries(acc), height: top + hr };
}

// ------------------------------------------------------------------ decorations (vertex coloured kits)
const BULB = [0xff3b3b, 0xffc93a, 0x39a8ff, 0x3dff7a, 0xff5fd2, 0xfff1c8];
function bulbs(list, pts, palette = BULB, r = 0.05) {
  pts.forEach((p, i) => { const g = new THREE.SphereGeometry(r, 6, 4); g.translate(...p); list.push(colorize(g, new THREE.Color(palette[i % palette.length]).multiplyScalar(2.2))); });
}
function bow(list, x, y, z, color = 0xc4141f, s = 1) {
  for (const k of [-1, 1]) { const t = new THREE.TorusGeometry(0.07 * s, 0.024 * s, 6, 10); t.scale(1, 0.7, 0.5); t.rotateZ(k * 0.5); t.translate(x + k * 0.07 * s, y, z); list.push(colorize(t, color)); }
  const k = new THREE.SphereGeometry(0.035 * s, 6, 4); k.translate(x, y, z + 0.01); list.push(colorize(k, color));
  for (const k2 of [-1, 1]) { const r = new THREE.BoxGeometry(0.04 * s, 0.16 * s, 0.01); r.rotateZ(k2 * 0.25); r.translate(x + k2 * 0.04 * s, y - 0.1 * s, z); list.push(colorize(r, color)); }
}
function candyCane(lit, x, z, rot = 0, h = 0.85) {
  const pts = []; for (let i = 0; i <= 6; i++) pts.push([0, i / 6 * h, 0]);
  for (let i = 1; i <= 6; i++) { const a = i / 6 * Math.PI; pts.push([0.11 - Math.cos(a) * 0.11, h + Math.sin(a) * 0.11, 0]); }
  pts.push([0.24, h - 0.08, 0]);
  const g = tubeAlong(pts, 0.032, 32, 8); g.rotateY(rot); g.translate(x, 0, z);
  lit.push(paint(g, (px, py, pz, c) => { c.setHex(Math.floor((py * 9 + (px - x) * 9 + (pz - z) * 9) + 100) % 2 ? 0xd8141e : 0xf6f1ea); }));
}
function miniTree(lit, glow, x, z, s = 1, seed = 0) {
  // foliage is a needle-card fir from the PineSystem (no cone stacks); this kit only adds bulbs, a star and a bow
  const pts = []; for (let i = 0; i < 16; i++) { const t = i / 16, a = t * Math.PI * 7 + seed; const r = (0.56 - t * 0.44) * s, yy = (0.3 + t * 1.05) * s; pts.push([x + Math.cos(a) * r, yy, z + Math.sin(a) * r]); }
  bulbs(glow, pts, seed % 2 ? BULB : [0xffd27a, 0xffe7b0], 0.045 * s);
  const st = new THREE.OctahedronGeometry(0.1 * s, 0); st.scale(1, 1.3, 0.5); st.translate(x, 1.5 * s, z); glow.push(colorize(st, new THREE.Color(0xffd84a).multiplyScalar(2.6)));
}
function giftStack(lit, x, z, rot, seed) {
  const cols = [0xc81d25, 0x1f7a3a, 0xd9a521, 0x2b5fc4, 0xf0ece4, 0x7a2bb0];
  const boxes = [[0.5, 0.4, 0.45, 0, 0], [0.38, 0.32, 0.36, 0.05, 0.4], [0.32, 0.22, 0.3, -0.38, 0]];
  boxes.forEach(([w, h, d, ox, oy], i) => {
    const c = cols[(seed + i * 2) % cols.length], rc = cols[(seed + i * 2 + 3) % cols.length];
    const parts = [colorize(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), c, 0.1),
      colorize(new THREE.BoxGeometry(w + 0.01, h + 0.01, 0.06).translate(0, h / 2, 0), rc),
      colorize(new THREE.BoxGeometry(0.06, h + 0.01, d + 0.01).translate(0, h / 2, 0), rc)];
    const g = mergeGeometries(parts); g.rotateY(rot + i * 0.4); g.translate(x + Math.cos(rot) * ox, oy, z - Math.sin(rot) * ox); lit.push(g);
    const b = []; bow(b, 0, h + 0.03, 0, rc, 0.8); const bg = mergeGeometries(b); bg.rotateX(-Math.PI / 2 * 0.6); bg.rotateY(rot + i * 0.4); bg.translate(x + Math.cos(rot) * ox, oy, z - Math.sin(rot) * ox); lit.push(bg);
  });
}
function lanternPost(lit, glow, x, z, warm = true) {
  const p = new THREE.CylinderGeometry(0.035, 0.05, 1.0, 6); p.translate(x, 0.5, z); lit.push(colorize(p, 0x1d2024));
  const top = new THREE.ConeGeometry(0.14, 0.12, 4); top.rotateY(Math.PI / 4); top.translate(x, 1.31, z); lit.push(colorize(top, 0x1d2024));
  const sn = new THREE.ConeGeometry(0.12, 0.06, 4); sn.rotateY(Math.PI / 4); sn.translate(x, 1.37, z); lit.push(colorize(sn, 0xf2f6ff));
  const l = new THREE.BoxGeometry(0.16, 0.22, 0.16); l.translate(x, 1.13, z); glow.push(colorize(l, new THREE.Color(warm ? 0xffb050 : 0x6ab8ff).multiplyScalar(2.4)));
  bow(lit, x, 0.92, z + 0.06, 0xc4141f, 0.8);
}
function sled(lit, x, z, rot) {
  const parts = [];
  for (const s of [-1, 1]) {
    const run = tubeAlong([[s * 0.24, 0.02, -0.55], [s * 0.24, 0.02, 0.45], [s * 0.24, 0.1, 0.62], [s * 0.24, 0.24, 0.6]], 0.02, 12, 5); parts.push(colorize(run, 0x8a1c1c));
    for (const zz of [-0.35, 0.25]) { const l = new THREE.BoxGeometry(0.03, 0.16, 0.03); l.translate(s * 0.24, 0.1, zz); parts.push(colorize(l, 0x5a3a22)); }
  }
  for (let k = 0; k < 5; k++) { const sl = new THREE.BoxGeometry(0.58, 0.03, 0.15); sl.translate(0, 0.19, -0.42 + k * 0.19); parts.push(colorize(sl, 0xa86b3c, 0.15)); }
  const snow = new THREE.SphereGeometry(0.3, 8, 5); snow.scale(0.8, 0.12, 1.5); snow.translate(0.02, 0.22, -0.1); parts.push(colorize(snow, 0xf2f6ff));
  const g = mergeGeometries(parts); g.rotateY(rot); g.translate(x, 0, z); lit.push(g);
}
/** Door garland: sagging evergreen swag with bulbs and bows; local frame: door at origin, +z out of wall. */
function doorGarland(lit, glow, w = 1.0, y = 2.7) {
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, x = (t - 0.5) * 2 * w; pts.push([x, y - Math.sin(t * Math.PI) * 0.22, 0.12]); }
  const swag = tubeAlong([[-w - 0.05, y - 0.5, 0.1], ...pts, [w + 0.05, y - 0.5, 0.1]], 0.075, 40, 6);
  lit.push(paint(swag, (x, yy, z, c) => { const n = hash2(x * 40, yy * 40); c.setHex(n > 0.82 ? 0xe9f0ff : 0x1c4a2a).multiplyScalar(0.75 + 0.5 * n); }));
  bulbs(glow, pts.filter((_, i) => i % 2).map(p => [p[0], p[1] - 0.05, 0.2]), BULB, 0.045);
  bow(lit, -w, y + 0.02, 0.2); bow(lit, w, y + 0.02, 0.2);
}
function wreath(lit, glow, y = 2.05) {
  const w = new THREE.TorusGeometry(0.3, 0.1, 8, 20); w.translate(0, y, 0.12);
  lit.push(paint(w, (x, yy, z, c) => { c.setHex(hash2(x * 30, yy * 30) > 0.85 ? 0xb01b22 : 0x1d4a2a).multiplyScalar(0.8 + 0.4 * hash2(yy * 50, x * 20)); }));
  bow(lit, 0, y - 0.3, 0.24);
  const pts = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push([Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, 0.24]); }
  bulbs(glow, pts, [0xffd27a, 0xff3b3b], 0.035);
}

/** Front-yard kit for one house, in house-local space (door at origin, +z = out of the front wall). */
export function houseDecor(kind, seed, opts = {}) {
  const lit = [], glow = [];
  if (kind === 'wreath') wreath(lit, glow, opts.y ?? 2.05);
  else if (kind === 'garland') doorGarland(lit, glow, opts.w ?? 0.95, opts.y ?? 2.75);
  else if (kind === 'canes') { candyCane(lit, -0.85, 0.6, 0.3); candyCane(lit, 0.85, 0.6, Math.PI - 0.3); candyCane(lit, -0.85, 1.6, 0.2, 0.7); candyCane(lit, 0.85, 1.6, Math.PI - 0.2, 0.7); }
  else if (kind === 'tree') miniTree(lit, glow, 0, 0, opts.s ?? 1, seed);
  else if (kind === 'gifts') giftStack(lit, 0, 0, seed * 0.7, seed);
  else if (kind === 'lanterns') { lanternPost(lit, glow, -0.95, 0.9, seed % 3 !== 0); lanternPost(lit, glow, 0.95, 0.9, seed % 3 !== 0); }
  else if (kind === 'sled') sled(lit, 0, 0, seed);
  return { lit: lit.length ? mergeGeometries(lit) : null, glow: glow.length ? mergeGeometries(glow) : null };
}

/** Fence garland for the fence segment (local: rail along x, 2.4 m long, top ~0.95 m). */
export function fenceGarland() {
  const lit = [], glow = [];
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([(t - 0.5) * 2.4, 0.98 - Math.sin(t * Math.PI) * 0.16, 0.07]); }
  const sw = tubeAlong(pts, 0.05, 24, 5);
  lit.push(paint(sw, (x, y, z, c) => { const n = hash2(x * 40, y * 40); c.setHex(n > 0.84 ? 0xe9f0ff : 0x1c4a2a).multiplyScalar(0.75 + 0.5 * n); }));
  bow(lit, -1.2, 1.0, 0.12, 0xc4141f, 0.9);
  bulbs(glow, pts.filter((_, i) => i % 2).map(p => [p[0], p[1] - 0.04, 0.12]), BULB, 0.04);
  return { lit: mergeGeometries(lit), glow: mergeGeometries(glow) };
}

export { sstep };

/** Door wreath built directly in holder space, its back flush on the door panel: centre (cx, cy), back plane zb,
 *  facing +z. surf(x, y) -> panel z (for the bow/bulbs following the panel). */
export function attachedWreath(cx, cy, zb, s = 1) {
  const lit = [], glow = [], R = 0.3 * s, T = 0.1 * s, zc = zb + T;
  const w = new THREE.TorusGeometry(R, T, 8, 20); w.translate(cx, cy, zc);
  lit.push(paint(w, (x, yy, z, c) => { c.setHex(hash2(x * 30, yy * 30) > 0.85 ? 0xb01b22 : 0x1d4a2a).multiplyScalar(0.8 + 0.4 * hash2(yy * 50, x * 20)); }));
  bow(lit, cx, cy - R, zc + T * 0.9);
  const pts = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R, zc + T * 0.95]); }
  bulbs(glow, pts, [0xffd27a, 0xff3b3b], 0.035);
  return { lit: mergeGeometries(lit), glow: mergeGeometries(glow) };
}
/** Door garland swag along a holder-space path whose points already sit on the facade (each z = surface z);
 *  the tube's back touches the wall along its whole length. */
export function attachedGarland(path, tube = 0.075) {
  const lit = [], glow = [];
  const P = path.map(([x, y, z]) => [x, y, z + tube]);
  const swag = tubeAlong(P, tube, Math.max(24, P.length * 3), 6);
  lit.push(paint(swag, (x, yy, z, c) => { const n = hash2(x * 40, yy * 40); c.setHex(n > 0.82 ? 0xe9f0ff : 0x1c4a2a).multiplyScalar(0.75 + 0.5 * n); }));
  const inner = P.slice(2, -2);
  bulbs(glow, inner.filter((_, i) => i % 2).map(p => [p[0], p[1] - 0.04, p[2] + tube * 0.9]), BULB, 0.045);
  const top = P.filter(p => p[1] >= Math.max(...P.map(q => q[1])) - 0.3);
  for (const p of [top[0], top[top.length - 1]]) bow(lit, p[0], p[1] + 0.02, p[2] + tube * 0.9);
  return { lit: mergeGeometries(lit), glow: mergeGeometries(glow) };
}
