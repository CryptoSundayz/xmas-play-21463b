// Optimum mascot (Santa outfit) as the player character.
//  - Tripo GLB, biped mixamo rig, clips idle/walk/run/jump with damped crossfades
//  - procedural secondary motion: turn lean, squash/stretch, head bob, spring pom-pom (extra bone), jump + celebrate hop
//  - two-hand carry IK of the glowing gift (shared with santa.js)
//  - swappable expression decal (mascotface.js) with auto-blink
//  - always-burning icy flame along the flame-shaped head (shader tongues + embers + point light)
//  - fur shells on the cream trim, velvet sheen on the red cloth
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { CONFIG } from './config.js?v=1d9e3a63';
import { findClip } from './assets.js?v=1d9e3a63';
import { MascotFace } from './mascotface.js?v=1d9e3a63';
import { iconBlackShapes } from './logo.js?v=1d9e3a63';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Goggle mesh in root-local space: the official dark icon (outer contour + hollow centre) extruded with a rounded
 *  edge whose outer silhouette is exactly the icon outline (bevelOffset = -bevelSize), uniform scale k (m per SVG unit),
 *  then every vertex is projected front-on (along -Z) onto the head surface and raised by its extrusion height,
 *  so it hugs the head curvature while the front view keeps the icon's exact outline and proportions. */
function buildGoggle({ proxy, lx, ly, k, frontZ, hc }) {
  const BEV = 7, DEPTH = 4;
  let g = new THREE.ExtrudeGeometry(iconBlackShapes(), { depth: DEPTH, bevelEnabled: true, bevelThickness: 7, bevelSize: BEV, bevelOffset: -BEV, bevelSegments: 3, curveSegments: 40 });
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-3);
  // icon z runs -bevelThickness..DEPTH+bevelThickness; map so the back sits 2.5 mm under the skin, front ~7.5 mm above
  const zMin = -7, zMax = DEPTH + 7, under = 0.0025, raise = 0.0075;
  const pa = g.attributes.position, rc = new THREE.Raycaster(), o = new THREE.Vector3(), dn = new THREE.Vector3(0, 0, -1);
  const cache = new Map();
  for (let i = 0; i < pa.count; i++) {
    const sx = pa.getX(i), sy = pa.getY(i), sz = pa.getZ(i);
    const x = lx + (sx - 450) * k, y = ly - (sy - 246) * k;
    const key = Math.round(x * 2e4) + ',' + Math.round(y * 2e4);
    let zs = cache.get(key);
    if (zs === undefined) {
      o.set(x, y, frontZ + 0.5); rc.set(o, dn); rc.far = 2;
      const h = rc.intersectObject(proxy, false)[0];
      zs = h ? h.point.z : hc.z; cache.set(key, zs);
    }
    const t = (sz - zMin) / (zMax - zMin);
    pa.setXYZ(i, x, y, zs - under + t * (under + raise));
  }
  // y was flipped (SVG y-down) -> restore outward winding
  const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}

const CLS = { OTHER: 0, RED: 1, FUR: 2, BLACK: 3, WHITE: 4, EDGE: 5 };
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _va = new THREE.Vector3();
const _eu = new THREE.Euler();
const findBone = (model, n) => { let b = null; model.traverse(o => { if (!b && o.isBone && o.name.replace(/[^a-z0-9]/gi, '').toLowerCase().endsWith(n.toLowerCase())) b = o; }); return b; };

// ---------------------------------------------------------------- materials
// velvet sheen only where the albedo is red; low-saturation light pixels (face, gloves) lifted a little
// (Tripo's delighting leaves the white head grey-ish). Shared by the face decal so the fill matches.
// ---- wardrobe recolours: one shared uniform set (single mascot). aCos.x = boot mask, aCos.y = hat-cloth mask
export const LOOK_U = {
  uSuit: { value: new THREE.Color(1, 0, 0) }, uSuitOn: { value: 0 }, uHat: { value: new THREE.Color(1, 0, 0) }, uHatOn: { value: 0 },
  uBoot: { value: new THREE.Color(0, 0, 0) }, uBootOn: { value: 0 },
  uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPrism: { value: 0 }, uEC: { value: new THREE.Color() },
  uEnvK: { value: 0.22 }, uFlameOn: { value: 0 },
};
// default look = the original hard-coded flame colours (linear values, set raw)
LOOK_U.uC0.value.setRGB(0.02, 0.12, 0.6); LOOK_U.uC1.value.setRGB(0.16, 0.48, 1.05); LOOK_U.uC2.value.setRGB(0.85, 0.97, 1.1); LOOK_U.uEC.value.setRGB(0.5, 0.85, 2.2);
const LOOK_PATCH = (s) => {
  for (const k of ['uSuit', 'uSuitOn', 'uHat', 'uHatOn', 'uBoot', 'uBootOn', 'uC0', 'uC1', 'uC2', 'uFlameOn']) s.uniforms[k] = LOOK_U[k];
  s.vertexShader = 'attribute vec3 aCos;\nvarying vec3 vCos;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCos = aCos;');
  s.fragmentShader = 'varying vec3 vCos;\nuniform vec3 uSuit, uHat, uBoot, uC0, uC1, uC2;\nuniform float uSuitOn, uHatOn, uBootOn, uFlameOn;\n' + s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    { vec3 c = diffuseColor.rgb; float mx = max(c.r, max(c.g, c.b));
      float red = clamp((c.r - max(c.g, c.b) * 1.25) * 5.0, 0.0, 1.0);
      float hm = vCos.y; float on = mix(uSuitOn, uHatOn, hm) * (1.0 - vCos.x * uBootOn);
      diffuseColor.rgb = mix(c, mix(uSuit, uHat, hm) * (c.r * 1.9 + 0.015), red * on);
      float dk = (1.0 - smoothstep(0.22, 0.42, mx)) * vCos.x * uBootOn;
      diffuseColor.rgb = mix(diffuseColor.rgb, uBoot * (0.3 + mx * 2.6), dk);
      // flame head: blue texels on the head re-mapped onto the flame preset's gradient by brightness
      float blu = clamp((c.b - max(c.r, c.g) * 0.92) * 5.0, 0.0, 1.0) * vCos.z * uFlameOn;
      float L = clamp(dot(c, vec3(0.25, 0.45, 0.3)) * 1.05, 0.0, 1.0) * 0.82;
      vec3 fc = L < 0.4 ? mix(uC0, uC1, L / 0.4) : mix(uC1, uC2, (L - 0.4) / 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, min(fc * 0.85, vec3(1.0)), blu);
      // the pale face picks up a soft glow of the flame colour
      float pale = smoothstep(0.32, 0.6, mx) * (1.0 - blu) * vCos.z * uFlameOn;
      vec3 tn = uC1 / max(max(uC1.r, uC1.g), max(uC1.b, 0.001));
      diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.0), tn, 0.42), pale); }`);
};
const SKIN_PATCH = (shader, opts = {}) => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    { float mxc = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), mnc = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
      float satc = mxc > 0.0 ? (mxc - mnc) / mxc : 0.0;
      float lift = (1.0 - smoothstep(0.06, 0.16, satc)) * smoothstep(0.18, 0.3, mxc) * (1.0 - smoothstep(0.45, 0.62, mxc));
      diffuseColor.rgb *= mix(1.0, ${(opts.lift || 1.7).toFixed(2)}, lift); }`);
  if (!opts.noRed && shader.fragmentShader.includes('#include <lights_physical_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      { float red = clamp((diffuseColor.r - max(diffuseColor.g, diffuseColor.b) * 1.2) * 4.0, 0.0, 1.0);
        #ifdef USE_SHEEN
        material.sheenColor *= red; material.sheenRoughness = 0.42;
        #endif
        material.roughness = mix(material.roughness, 0.92, red); }`);
  }
};

// scene.environment ignores material.envMapIntensity (r163+): damp the IBL per material so glossy black stays black
const ENV_DAMP = (shader, k) => {
  const ks = typeof k === 'string' ? k : k.toFixed(3), kc = typeof k === 'string' ? `min(1.0, ${k} * 1.6)` : (k * 1.6).toFixed(3);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
    radiance *= ${ks}; iblIrradiance *= ${ks};
    #ifdef USE_CLEARCOAT
    clearcoatRadiance *= ${kc};
    #endif`);
};

function velvetMaterial(src) {
  const pm = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(pm, src);
  pm.metalness = 0; pm.envMapIntensity = 0.6; pm.roughness = Math.max(0.55, src.roughness);
  pm.sheen = 1; pm.sheenRoughness = 0.42; pm.sheenColor = new THREE.Color(1.0, 0.42, 0.42);
  pm.onBeforeCompile = (s) => { LOOK_PATCH(s); SKIN_PATCH(s); };
  pm.customProgramCacheKey = () => 'mascot-velvet-look';
  return pm;
}

function furMaterial(src, layer, n, lenObj, density) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, normalMap: null, roughness: 1, metalness: 0, color: 0xffffff });
  const t = layer / n;
  m.onBeforeCompile = (s) => {
    s.uniforms.uT = { value: t }; s.uniforms.uLen = { value: lenObj }; s.uniforms.uDen = { value: density };
    s.vertexShader = 'uniform float uT; uniform float uLen;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed += objectNormal * uLen * uT; transformed.y -= uLen * uT * uT * 0.35;`);
    s.fragmentShader = 'uniform float uT; uniform float uDen;\nfloat fhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 g = vMapUv * uDen; vec2 id = floor(g); vec2 f = fract(g) - 0.5 + (vec2(fhash(id), fhash(id + 7.3)) - 0.5) * 0.5;
        float h = fhash(id + 3.1);
        float r = length(f) * 2.0;
        if (h < uT * 0.85 || r > (1.0 - uT * 0.75)) discard;
        diffuseColor.rgb *= mix(0.62, 1.12, uT); }`);
  };
  m.customProgramCacheKey = () => 'mascot-fur-' + layer;
  return m;
}

// ---------------------------------------------------------------- flame
const FLAME_VS = `
attribute vec4 aCorner; // x: -1..1, y: 0..1, z: seed, w: size
uniform float uTime, uH;
varying vec2 vUv; varying float vSeed;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 rt = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
  float s = aCorner.w, y = aCorner.y;
  float sway = sin(uTime * 3.1 + aCorner.z * 6.28) * 0.18 + sin(uTime * 7.3 + aCorner.z * 11.0) * 0.06;
  float hh = uH * s * (0.82 + 0.18 * sin(uTime * 4.7 + aCorner.z * 9.0));
  mv.xyz += rt * (aCorner.x * 0.5 * s * uH * 0.48 + sway * y * y * uH * s) + upV * (y * hh - 0.05 * s);
  vUv = vec2(aCorner.x * 0.5 + 0.5, y); vSeed = aCorner.z;
  gl_Position = projectionMatrix * mv;
}`;
const FLAME_FS = `
uniform float uTime, uI, uPrism;
uniform vec3 uC0, uC1, uC2;
varying vec2 vUv; varying float vSeed;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  float y = vUv.y;
  float n = fbm(vec2(vUv.x * 2.6 + vSeed * 17.0, y * 2.2 - uTime * 2.6 - vSeed * 5.0));
  float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * y;
  float w = (1.0 - y) * (0.75 + 0.5 * n) * (0.55 + 0.45 * smoothstep(0.0, 0.18, y));
  float shape = 1.0 - smoothstep(w * 0.45, w, abs(x));
  shape *= 1.0 - smoothstep(0.45, 1.0, y + (n - 0.5) * 0.5);
  shape *= smoothstep(0.0, 0.08, y);
  float core = (1.0 - smoothstep(0.0, w * 0.5, abs(x))) * (1.0 - smoothstep(0.05, 0.5, y));
  vec3 col = mix(uC0, uC1, shape * shape);
  col = mix(col, uC2, core * 0.65);
  if (uPrism > 0.0) { vec3 hue = 0.5 + 0.5 * cos(6.2831 * (y * 0.9 - uTime * 0.3 + vSeed * 0.5 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, hue * (0.25 + 0.95 * shape * shape) + uC2 * core * 0.5, uPrism); }
  float a = shape * uI * (0.55 + 0.45 * n);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

function makeFlame(anchors, sizes, height) {
  const n = anchors.length, pos = new Float32Array(n * 4 * 3), cor = new Float32Array(n * 4 * 4), idx = [];
  anchors.forEach((p, i) => {
    const seed = Math.random(), s = sizes[i];
    [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([cx, cy], k) => {
      pos.set([p.x, p.y, p.z], (i * 4 + k) * 3); cor.set([cx, cy, seed, s], (i * 4 + k) * 4);
    });
    const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aCorner', new THREE.BufferAttribute(cor, 4)); geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uH: { value: height }, uI: { value: 1 }, uC0: LOOK_U.uC0, uC1: LOOK_U.uC1, uC2: LOOK_U.uC2, uPrism: LOOK_U.uPrism }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'mascotFlame';
  return mesh;
}

class Embers {
  constructor(n) {
    this.n = n; this.p = new Float32Array(n * 3); this.life = new Float32Array(n); this.vel = new Float32Array(n * 3); this.al = new Float32Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uS: { value: 70 }, uEC: LOOK_U.uEC }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aA; varying float vA; uniform float uS; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = uS * (0.4 + aA * 0.6) / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uEC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(mix(uEC, vec3(2.2,2.4,2.6), smoothstep(0.25,0.0,d)), a); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.name = 'mascotEmbers';
    for (let i = 0; i < n; i++) this.life[i] = -Math.random();
  }
  update(dt, spawn) { // spawn(i, outVec3) -> world position on the flame rim
    const { p, vel, life, al } = this;
    for (let i = 0; i < this.n; i++) {
      life[i] -= dt / 1.3;
      if (life[i] <= 0) {
        if (life[i] < -0.4 || Math.random() < dt * 3) {
          spawn(i, v0); p[i * 3] = v0.x; p[i * 3 + 1] = v0.y; p[i * 3 + 2] = v0.z;
          vel[i * 3] = (Math.random() - 0.5) * 0.35; vel[i * 3 + 1] = 0.55 + Math.random() * 0.7; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
          life[i] = 0.6 + Math.random() * 0.4;
        }
        al[i] = 0; continue;
      }
      vel[i * 3] += Math.sin(life[i] * 13 + i) * dt * 0.6; vel[i * 3 + 2] += Math.cos(life[i] * 11 + i) * dt * 0.6;
      p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
      al[i] = Math.min(1, life[i] * 3) * (0.5 + 0.5 * Math.sin(life[i] * 40 + i));
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.aA.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- main
export function glbMascot(root, glb, entry, gift, makeCarryIK, quality = 'high') {
  const C = CONFIG.character;
  const model = glb.object;
  const lean = new THREE.Group(); lean.name = 'mascotLean'; root.add(lean);
  const squash = new THREE.Group(); lean.add(squash); squash.add(model);
  root.updateMatrixWorld(true);
  const skinned = []; model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  const head = findBone(model, 'Head'), neck = findBone(model, 'Neck'), spine2 = findBone(model, 'Spine2');
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  // ---- materials: velvet + lift
  const conv = new Map();
  for (const m of skinned) { if (!conv.has(m.material)) conv.set(m.material, velvetMaterial(m.material)); m.material = conv.get(m.material); }

  // ---- analyse the rest pose (root-local positions + class + dominant bone)
  const info = [];
  for (const mesh of skinned) {
    const g = mesh.geometry, n = g.attributes.position.count, cls = g.attributes._cls, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = mesh.skeleton.bones, headIdx = new Set(bones.map((b, i) => (b === head || b.name.includes('HeadTop')) ? i : -1).filter(i => i >= 0));
    const P = new Float32Array(n * 3), K = new Uint8Array(n), Hd = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      mesh.getVertexPosition(i, v0); v0.applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInv);
      P[i * 3] = v0.x; P[i * 3 + 1] = v0.y; P[i * 3 + 2] = v0.z;
      K[i] = cls ? Math.round(cls.getX(i)) : 0;
      let best = 0, bi = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
      Hd[i] = headIdx.has(bi) ? 1 : 0;
    }
    info.push({ mesh, P, K, Hd, n, headIdx });
  }
  // ---- wardrobe masks: aCos.x = boots (lowest ~11% of the body, outside the head), aCos.y = hat cloth (head-bound red / fur)
  const bodyB = new THREE.Box3();
  for (const I of info) for (let i = 0; i < I.n; i++) if (!I.Hd[i]) bodyB.expandByPoint(v0.fromArray(I.P, i * 3));
  {
    const y0 = bodyB.min.y, H = bodyB.max.y - y0;
    for (const I of info) {
      const a = new Float32Array(I.n * 3);
      for (let i = 0; i < I.n; i++) {
        a[i * 3] = I.Hd[i] ? 0 : 1 - THREE.MathUtils.smoothstep(I.P[i * 3 + 1] - y0, H * 0.13, H * 0.17);
        a[i * 3 + 1] = I.Hd[i] && (I.K[i] === CLS.RED || I.K[i] === CLS.FUR) ? 1 : 0;
        a[i * 3 + 2] = I.Hd[i] && !a[i * 3 + 1] ? 1 : 0;
      }
      I.mesh.geometry.setAttribute('aCos', new THREE.BufferAttribute(a, 3));
    }
  }
  // head stats: face (non red/fur head verts) bounds, mask band bounds
  const hb = new THREE.Box3(), band = new THREE.Box3(), hat = new THREE.Box3(); let frontZ = -1e9;
  for (const I of info) for (let i = 0; i < I.n; i++) {
    if (!I.Hd[i]) continue; v0.fromArray(I.P, i * 3);
    if (I.K[i] === CLS.RED || I.K[i] === CLS.FUR) { hat.expandByPoint(v0); continue; }
    hb.expandByPoint(v0); if (I.K[i] === CLS.BLACK && v0.z > 0) band.expandByPoint(v0); frontZ = Math.max(frontZ, v0.z);
  }
  const hc = hb.getCenter(new THREE.Vector3()), hs = hb.getSize(new THREE.Vector3());
  { // robust band: percentiles of front-facing black head vertices (ignores stray outline/edge texels)
    const xs = [], ys = [];
    for (const I of info) for (let i = 0; i < I.n; i++) if (I.Hd[i] && I.K[i] === CLS.BLACK && I.P[i * 3 + 2] > hc.z + hs.z * 0.15) { xs.push(I.P[i * 3]); ys.push(I.P[i * 3 + 1]); }
    if (xs.length > 50) {
      xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); const pc = (a, p) => a[Math.floor(p * (a.length - 1))];
      band.min.set(pc(xs, 0.03), pc(ys, 0.06), band.min.z); band.max.set(pc(xs, 0.97), pc(ys, 0.94), band.max.z);
    }
  }
  if (band.isEmpty()) { band.min.set(hc.x - hs.x * 0.35, hc.y - hs.y * 0.12, 0); band.max.set(hc.x + hs.x * 0.35, hc.y + hs.y * 0.08, frontZ); }
  const bandC = band.getCenter(new THREE.Vector3()), bandS = band.getSize(new THREE.Vector3());
  const api = { model, lean, squash, head, mixer: null, faceName: 'neutral' };
  { // wardrobe slots: groups on the head / upper-spine bones whose children are authored in root-local rest-pose metres
    const mkSlot = (bone, name) => {
      const g = new THREE.Group(); g.name = name; bone.updateMatrixWorld(true);
      new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(root.matrixWorld).decompose(g.position, g.quaternion, g.scale);
      bone.add(g); return g;
    };
    const H = bodyB.max.y - bodyB.min.y, backY = bodyB.min.y + (hb.min.y - bodyB.min.y) * 0.62; let backZ = 1e9;
    for (const I of info) for (let i = 0; i < I.n; i++) {
      if (I.Hd[i]) continue; const x = I.P[i * 3], y = I.P[i * 3 + 1], z = I.P[i * 3 + 2];
      if (Math.abs(y - backY) < H * 0.05 && Math.abs(x - hc.x) < hs.x * 0.3) backZ = Math.min(backZ, z);
    }
    if (backZ > 1e8) backZ = bodyB.min.z;
    api.slots = { head: mkSlot(head, 'mascotHeadSlot'), back: mkSlot(spine2 || neck || head, 'mascotBackSlot') };
    api.lookRef = { hc: hc.clone(), hs: hs.clone(), hat: hat.clone(), hb: hb.clone(), body: bodyB.clone(), frontZ, back: new THREE.Vector3(hc.x, backY, backZ) };
    api.lookU = LOOK_U;
  }
  api.analysis = () => {
    const hist = {}; const r = (x) => Math.round(x * 100) / 100;
    for (const I of info) for (let i = 0; i < I.n; i++) {
      if (!I.Hd[i]) continue; const y = I.P[i * 3 + 1], z = I.P[i * 3 + 2], x = I.P[i * 3];
      if (z < hc.z) continue;
      const key = Math.floor((y - hb.min.y) / 0.02); hist[key] = hist[key] || [0, 0, 0, 0, 0, 0]; hist[key][I.K[i]]++;
    }
    return { hb: [hb.min.toArray().map(r), hb.max.toArray().map(r)], band: [band.min.toArray().map(r), band.max.toArray().map(r)], hat: [hat.min.toArray().map(r), hat.max.toArray().map(r)], frontZ: r(frontZ), hist };
  };

  // ---- expression decal over the baked face
  let face = null;
  try {
    const I = info[0];
    // goggle = official dark icon (900x492), uniform scale only. Sized to cover the baked Tripo band.
    const LW = Math.max(0.33, bandS.x * 0.98) * (entry.goggleScale || 1), k = LW / 900, LH = 492 * k;
    const lx = bandC.x, ly = bandC.y + bandS.y * 0.12;
    const dw = LW * 1.5, dh = LH * 2.55;
    const center = new THREE.Vector3(lx, ly - LH * 0.36, frontZ);
    // proxy: rest-pose head triangles only (not hat/body)
    const idx = I.mesh.geometry.index.array, tri = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (!(I.Hd[a] && I.Hd[b] && I.Hd[c])) continue;
      if ([a, b, c].some(k => I.K[k] === CLS.RED || I.K[k] === CLS.FUR)) continue;
      if (I.P[a * 3 + 2] < hc.z) continue;
      tri.push(a, b, c);
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(I.P, 3)); pg.setIndex(tri); pg.computeVertexNormals();
    const proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); proxy.updateMatrixWorld(true);
    const dg = new DecalGeometry(proxy, center, new THREE.Euler(0, 0, 0), new THREE.Vector3(dw, dh, hs.z * 1.2));
    { const pa = dg.attributes.position, na = dg.attributes.normal; // lift off the skin so head/neck blend skinning can't poke through
      for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + na.getX(i) * 0.0045, pa.getY(i) + na.getY(i) * 0.0045, pa.getZ(i) + na.getZ(i) * 0.0045); }
    // icon SVG units -> decal canvas pixels (same orthographic front projection as the goggle mesh)
    const RES = 1024, Wc = RES, Hc = Math.round(RES * dh / dw), pxm = Wc / dw;
    const logo = { s: k * pxm, ox: pxm * (lx - center.x + dw / 2) - 450 * k * pxm, oy: pxm * (center.y + dh / 2 - ly) - 246 * k * pxm };
    const mouthY = (center.y + dh / 2 - (ly - LH / 2 - 0.042)) / dh;
    face = new MascotFace({ aspect: dh / dw, faceWhite: entry.faceWhite, res: RES, logo, mouthY });
    face.blinkEvery = C.expressions.blinkEvery;
    const fm = new THREE.MeshStandardMaterial({ map: face.texture, transparent: true, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
    fm.onBeforeCompile = (s) => { SKIN_PATCH(s); ENV_DAMP(s, 0.35); }; fm.customProgramCacheKey = () => 'mascot-face';
    // root-local -> head-bone-local
    head.updateMatrixWorld(true);
    const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld);
    dg.applyMatrix4(toHead);
    const fmesh = new THREE.Mesh(dg, fm); fmesh.name = 'mascotFace'; fmesh.renderOrder = 2; fmesh.castShadow = false;
    head.add(fmesh); api.faceMesh = fmesh;
    // ---- the GOGGLE: official icon extruded (rounded edge), projected front-on onto the head surface and raised
    try {
      const gg = buildGoggle({ proxy, lx, ly, k, frontZ, hc });
      gg.applyMatrix4(toHead);
      const gm = new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.3, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.06, specularIntensity: 0.6, envMapIntensity: 0.3 });
      gm.onBeforeCompile = (s) => { SKIN_PATCH(s, { noRed: true }); s.uniforms.uEnvK = LOOK_U.uEnvK; s.fragmentShader = 'uniform float uEnvK;\n' + s.fragmentShader; ENV_DAMP(s, 'uEnvK'); };
      gm.customProgramCacheKey = () => 'mascot-goggle-look';
      const gmesh = new THREE.Mesh(gg, gm); gmesh.name = 'mascotGoggle'; gmesh.renderOrder = 3; gmesh.castShadow = false;
      head.add(gmesh); api.goggle = gmesh;
      // QA: world-space points of the official icon outline as placed on the head (for overlay checks)
      api.goggleOutline = (n = 240) => {
        const out = [], rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, 0, -1);
        for (const sh of iconBlackShapes()) for (const c of [sh, ...sh.holes]) for (const q of c.getSpacedPoints(n)) {
          const x = lx + (q.x - 450) * k, y = ly - (q.y - 246) * k;
          rc.set(new THREE.Vector3(x, y, frontZ + 0.5), dn); const h = rc.intersectObject(proxy, false)[0];
          const v = new THREE.Vector3(x, y, (h ? h.point.z : hc.z) + 0.0075).applyMatrix4(toHead); head.localToWorld(v); out.push(v);
        }
        return out;
      }; api.goggleInfo = { LW, LH, lx, ly, iconVB: [900, 492] };
    } catch (e) { console.warn('[mascot] goggle failed', e); }
  } catch (e) { console.warn('[mascot] face decal failed', e); }
  api.face = face;

  // ---- flame anchors along the head rim (front-view silhouette, left/top where the flame tips are)
  const tipsHead = [], tipSizes = [];
  {
    const bins = new Map();
    for (const I of info) for (let i = 0; i < I.n; i++) {
      if (!I.Hd[i] || I.K[i] === CLS.RED || I.K[i] === CLS.FUR || I.K[i] === CLS.BLACK) continue;
      const x = I.P[i * 3] - hc.x, y = I.P[i * 3 + 1] - hc.y, z = I.P[i * 3 + 2];
      let a = Math.atan2(y, x) * 180 / Math.PI; if (a < 0) a += 360;
      const r = Math.hypot(x, y), bin = Math.floor(a / 9);
      const cur = bins.get(bin); if (!cur || r > cur.r) bins.set(bin, { r, x: I.P[i * 3], y: I.P[i * 3 + 1], z, a });
    }
    const rim = [...bins.values()].filter(b => b.a >= 25 && b.a <= 232).sort((p, q) => p.a - q.a);
    // keep rim points not hidden inside the hat
    const hatGrow = hat.clone().expandByScalar(0.004);
    const pts = rim.filter(b => !hatGrow.containsPoint(v0.set(b.x, b.y, b.z)));
    const rMean = pts.reduce((s, b) => s + b.r, 0) / Math.max(1, pts.length);
    head.updateMatrixWorld(true);
    const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld);
    for (const b of pts) {
      const inward = 0.9; const p = new THREE.Vector3(hc.x + (b.x - hc.x) * inward, hc.y + (b.y - hc.y) * inward, b.z * 0.6);
      tipsHead.push(p.applyMatrix4(toHead)); tipSizes.push(0.7 + 0.5 * THREE.MathUtils.clamp((b.r - rMean * 0.92) / (rMean * 0.2), 0, 1));
      // a second, smaller tongue a little behind for volume
      const p2 = new THREE.Vector3(hc.x + (b.x - hc.x) * 0.82, hc.y + (b.y - hc.y) * 0.82, hc.z - hs.z * 0.15).applyMatrix4(toHead);
      tipsHead.push(p2); tipSizes.push(0.35 + Math.random() * 0.15);
    }
    api.rimCount = pts.length;
  }
  const qn = quality;
  const flame = makeFlame(tipsHead, tipSizes, C.flame.height / head.getWorldScale(v0).y * 1); // uH in view-space metres (bone scale not applied to offsets)
  flame.material.uniforms.uH.value = C.flame.height;
  head.add(flame); api.flame = flame;
  const emN = C.flame.embers[qn] ?? 40;
  const embers = emN > 0 ? new Embers(emN) : null; api.embers = embers;
  const lightI = C.flame.light[qn] ?? 0;
  let flameLight = null;
  if (lightI > 0) {
    flameLight = new THREE.PointLight(0x8fd0ff, lightI, C.flame.lightDistance, 1.6); flameLight.name = 'mascotFlameLight';
    flameLight.position.copy(new THREE.Vector3(hc.x - hs.x * 0.2, hc.y + hs.y * 0.45, hc.z).applyMatrix4(new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld)));
    head.add(flameLight); api.flameLight = flameLight;
  }

  // ---- pom-pom spring bone (re-weights the floppy hat tip onto a new bone parented to the head)
  let pom = null, pomTip = null;
  try {
    let T = null, td = -1, redC = new THREE.Vector3(), rn = 0;
    for (const I of info) for (let i = 0; i < I.n; i++) {
      if (!I.Hd[i] || I.K[i] !== CLS.RED) continue; v0.fromArray(I.P, i * 3); redC.add(v0); rn++;
      const d = v0.distanceTo(hc); if (d > td) { td = d; T = v0.clone(); }
    }
    redC.multiplyScalar(1 / rn);
    const Pv = redC.clone().lerp(T, 0.2), dir = T.clone().sub(Pv), L = dir.length(); dir.normalize();
    pom = new THREE.Bone(); pom.name = 'mascotPomPom';
    head.add(pom); head.updateMatrixWorld(true);
    pom.position.copy(head.worldToLocal(Pv.clone().applyMatrix4(root.matrixWorld))); pom.updateMatrixWorld(true);
    for (const I of info) {
      const mesh = I.mesh, sk = mesh.skeleton, hi = sk.bones.indexOf(head);
      const X = new THREE.Matrix4().multiplyMatrices(head.matrixWorld, sk.boneInverses[hi]);
      const pomInv = new THREE.Matrix4().copy(pom.matrixWorld).invert().multiply(X);
      const bones = [...sk.bones, pom], invs = [...sk.boneInverses, pomInv];
      const nsk = new THREE.Skeleton(bones, invs); const pi = bones.length - 1;
      const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      let moved = 0;
      for (let i = 0; i < I.n; i++) {
        if (!I.Hd[i] || (I.K[i] !== CLS.RED && I.K[i] !== CLS.FUR && I.K[i] !== CLS.OTHER)) continue;
        v0.fromArray(I.P, i * 3);
        const t = v0.clone().sub(Pv).dot(dir) / L; if (t <= 0) continue;
        const lat = v0.clone().sub(Pv).addScaledVector(dir, -t * L).length(); if (lat > L * 0.9) continue;
        const w = THREE.MathUtils.smoothstep(t, 0, 0.7);
        si.setXYZW(i, hi, pi, 0, 0); sw.setXYZW(i, 1 - w, w, 0, 0); moved++;
      }
      si.needsUpdate = true; sw.needsUpdate = true;
      mesh.bind(nsk, mesh.bindMatrix);
      I.pomMoved = moved;
    }
    pomTip = { local: pom.worldToLocal(T.clone().applyMatrix4(root.matrixWorld)), p: new THREE.Vector3(), v: new THREE.Vector3(), init: false, L };
    api.pom = pom;
  } catch (e) { console.warn('[mascot] pom-pom bone failed', e); pom = null; }

  // ---- fur shells on the cream trim
  const furLayers = C.fur.layers[qn] ?? 0, shells = [];
  if (furLayers > 0) for (const I of info) {
    const idx = I.mesh.geometry.index.array, tri = [];
    for (let t = 0; t < idx.length; t += 3) if (I.K[idx[t]] === CLS.FUR && I.K[idx[t + 1]] === CLS.FUR && I.K[idx[t + 2]] === CLS.FUR) tri.push(idx[t], idx[t + 1], idx[t + 2]);
    if (!tri.length) continue;
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (I.mesh.geometry.attributes[k]) g.setAttribute(k, I.mesh.geometry.attributes[k]);
    g.setIndex(tri); g.boundingSphere = I.mesh.geometry.boundingSphere; g.boundingBox = I.mesh.geometry.boundingBox;
    const ws = I.mesh.getWorldScale(v0).x / root.getWorldScale(v1).x;
    for (let l = 1; l <= furLayers; l++) {
      const s = new THREE.SkinnedMesh(g, furMaterial(I.mesh.material, l, furLayers, C.fur.length / ws, C.fur.density));
      s.bindMode = I.mesh.bindMode; s.bind(I.mesh.skeleton, I.mesh.bindMatrix);
      s.position.copy(I.mesh.position); s.quaternion.copy(I.mesh.quaternion); s.scale.copy(I.mesh.scale);
      s.castShadow = false; s.receiveShadow = true; s.frustumCulled = false; s.name = 'mascotFur' + l;
      I.mesh.parent.add(s); shells.push(s);
    }
    api.furTris = tri.length / 3;
  }
  api.shells = shells;

  // ---- animation
  const mixer = new THREE.AnimationMixer(model); api.mixer = mixer;
  const act = {};
  for (const [k, name] of Object.entries(entry.clips)) {
    const clip = findClip(glb.animations, name);
    if (clip) { act[k] = mixer.clipAction(clip); act[k].play(); act[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
  }
  if (act.jump) { act.jump.setLoop(THREE.LoopOnce, 1); act.jump.clampWhenFinished = true; act.jump.stop(); }
  const W = { idle: 1, walk: 0, run: 0, jump: 0 };

  // ---- grounding: sole offsets from the skinned feet (not the bind-pose bbox) + clip stride calibration
  const GR = C.grounding || {};
  const feet = (() => {
    const L = findBone(model, 'LeftFoot'), R = findBone(model, 'RightFoot'), tL = findBone(model, 'LeftToeBase'), tR = findBone(model, 'RightToeBase');
    if (!L || !R) return null;
    // in-place clips: some Tripo clips carry a constant forward hips offset (run: +0.65 m) -> strip the mean x/z drift
    const hipsB = findBone(model, 'Hips');
    if (hipsB) for (const k of ['walk', 'run', 'idle', 'jump']) {
      const clip = act[k]?.getClip(); const tr = clip?.tracks.find(t => t.name === hipsB.name + '.position'); if (!tr) continue;
      const v = tr.values, n = v.length / 3; let mx = 0, mz = 0; for (let i = 0; i < n; i++) { mx += v[i * 3]; mz += v[i * 3 + 2]; }
      mx = mx / n - hipsB.position.x; mz = mz / n - hipsB.position.z; for (let i = 0; i < n; i++) { v[i * 3] -= mx; v[i * 3 + 2] -= mz; }
    }
    const legs = ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map(n => findBone(model, n)).filter(Boolean).map(b => ({ b, rest: b.quaternion.clone() }));
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), loc = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
    // lowest rest-pose vertex dominated by a foot/toe bone = the boot sole
    const set = new Set([L, R, tL, tR].filter(Boolean)); let minY = Infinity;
    for (const I of info) {
      const si = I.mesh.geometry.attributes.skinIndex, sw = I.mesh.geometry.attributes.skinWeight, bones = I.mesh.skeleton.bones;
      for (let i = 0; i < I.n; i++) {
        let best = 0, bi = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
        if (set.has(bones[bi]) && I.P[i * 3 + 1] < minY) minY = I.P[i * 3 + 1];
      }
    }
    if (!isFinite(minY)) minY = 0;
    const f = { legs, L, R, tL: tL || L, tR: tR || R, dA: loc(L).y - minY, dT: loc(tL || L).y - minY, inv: new THREE.Matrix4(), v: new THREE.Vector3(),
      up: [true, true], off: 0, minY };
    // stride calibration: how fast the stance foot slides backwards in each in-place clip (m/s at timeScale 1)
    const speedOf = (clip) => {
      if (!clip) return 0;
      const tm = new THREE.AnimationMixer(model), a = tm.clipAction(clip); a.play();
      const N = 60, d = clip.duration; let travel = 0, prev = null, zr = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9, 1e9, -1e9]; const hips = findBone(model, 'Hips');
      for (let i = 0; i <= N; i++) {
        tm.setTime(i / N * d); model.updateMatrixWorld(true);
        const cur = [loc(L), loc(R)], hp = hips ? loc(hips) : cur[0];
        zr[0] = Math.min(zr[0], cur[0].z); zr[1] = Math.max(zr[1], cur[0].z); zr[2] = Math.min(zr[2], cur[0].x); zr[3] = Math.max(zr[3], cur[0].x);
        zr[4] = Math.min(zr[4], hp.z); zr[5] = Math.max(zr[5], hp.z); zr[6] = Math.min(zr[6], hp.y); zr[7] = Math.max(zr[7], hp.y);
        if (prev) { const k = cur[0].y < cur[1].y ? 0 : 1; if ((prev[0].y < prev[1].y ? 0 : 1) === k) travel += Math.hypot(cur[k].x - prev[k].x, cur[k].z - prev[k].z); }
        prev = cur;
      }
      a.stop(); tm.uncacheRoot(model);
      (f.dbg ||= []).push({ d: +d.toFixed(2), z: zr.map(v => +v.toFixed(3)), travel: +travel.toFixed(3) });
      return travel / d;
    };
    f.vWalk = speedOf(act.walk?.getClip()); f.vRun = speedOf(act.run?.getClip());
    return f;
  })();
  api.grounding = () => feet && { soleDropAnkle: +feet.dA.toFixed(3), soleDropToe: +feet.dT.toFixed(3), restSoleY: +feet.minY.toFixed(3), clipSpeedWalk: +feet.vWalk.toFixed(2), clipSpeedRun: +feet.vRun.toFixed(2), off: +feet.off.toFixed(3), walkTS: act.walk?.timeScale, runTS: act.run?.timeScale, dbg: feet.dbg, scale: model.scale.x, rootScale: root.getWorldScale(new THREE.Vector3()).x, h: info.reduce((m, I) => { for (let i = 1; i < I.P.length; i += 3) m = Math.max(m, I.P[i]); return m; }, 0) };
  api.stepEvents = !!feet;

  // ---- gift on the chest, held by both hands (2-bone IK)
  const bone = findBone(model, (entry.holdBone || 'Spine1').replace(/^mixamorig/, ''));
  if (bone) {
    model.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); bone.getWorldScale(ws);
    bone.add(gift); gift.scale.setScalar((entry.giftScale || 1) / ws.x);
    gift.position.copy(bone.worldToLocal(root.localToWorld(new THREE.Vector3(...entry.holdOffset))));
  } else { gift.position.set(...entry.holdOffset); root.add(gift); }
  const ik = entry.carryIK && makeCarryIK ? makeCarryIK(model, root, gift, 0.19 * (entry.giftScale || 1)) : null;

  // ---- state
  const st = { y: 0, vy: 0, air: false, sq: 0, sqv: 0, lean: 0, pitch: 0, lastYaw: null, ph: 0, prevSpeed: 0, t: 0,
    mood: 'neutral', moodT: 0, events: {} };
  const emitPos = new THREE.Vector3();
  api.jump = (v = C.jumpVelocity) => {
    if (st.air) return false;
    st.air = true; st.vy = v; st.sqv += 2.2;
    if (act.jump && v >= C.jumpVelocity * 0.9) { act.jump.reset(); act.jump.play(); act.jump.setEffectiveWeight(1); W.jump = 1; act.jump.timeScale = 1.25; }
    return true;
  };
  // player jump (physics in main.js): play the rig's jump clip (else procedural tuck), stretch, surprised face
  api.jumpStart = () => {
    st.sqv += 2.6; st.jumpT = 0;
    if (act.jump) { act.jump.reset(); act.jump.play(); act.jump.setEffectiveWeight(1); W.jump = 1; act.jump.timeScale = 1.15; }
    api.emote(C.expressions.jump || 'surprised', 3);
  };
  api.land = (impact = 0.5) => { st.sqv -= 3.6 * impact + 1.0; st.moodT = Math.min(st.moodT, 0.35); };
  api.celebrate = () => { api.emote(C.expressions.deliver, C.expressions.deliverHold); if (!st.air) api.jump(C.celebrateHop); };
  api.emote = (name, hold = 1) => { st.mood = name; st.moodT = hold; };
  api.state = { storm: 0, ice: false, slow: false, boosted: false };
  api.setState = (s) => Object.assign(api.state, s);
  let wasIce = false, lightOff = false;

  api.update = (dt, speed, sprint) => {
    st.t += dt;
    // -- clip weights: damped toward targets (smooth blends)
    const w = THREE.MathUtils.clamp(speed / 2.4, 0, 1), r = THREE.MathUtils.clamp((speed - 5.5) / 4, 0, 1);
    const r2 = feet && GR.strideSync !== false ? THREE.MathUtils.clamp((speed - 1.8) / 1.6, 0, 1) : r; // short-legged rig: run cycle from a brisk pace
    const tgt = { idle: 1 - w, walk: w * (1 - r2), run: w * r2 };
    const kk = 1 - Math.exp(-dt * 8);
    for (const k of ['idle', 'walk', 'run']) W[k] += (tgt[k] - W[k]) * kk;
    if (act.jump && W.jump > 0) { if (!st.air && !api.extAir) W.jump = Math.max(0, W.jump - dt * 5); }
    const ground = 1 - W.jump;
    if (act.idle) act.idle.setEffectiveWeight(W.idle * ground);
    // stride sync: playback rate = ground speed / calibrated clip speed (no foot sliding), smoothed
    // ground speed of a clip ~ clipSpeed * timeScale * strideAmp (thigh/knee swing amplified about the rest pose)
    const sync = GR.strideSync !== false && feet, ok = v => v > 0.2 && v < 20;
    const solve = (v, tsMax) => { const want = speed / v; const k = THREE.MathUtils.clamp(want / tsMax, 1, GR.strideAmpMax ?? 1.7); return [THREE.MathUtils.clamp(want / k, 0.45, tsMax), k]; };
    const [tsW, kW] = sync && ok(feet.vWalk) ? solve(feet.vWalk, 2.2) : [THREE.MathUtils.clamp(speed / 4.2, 0.7, 1.9), 1];
    const [tsR, kR] = sync && ok(feet.vRun) ? solve(feet.vRun, GR.runCadenceMax ?? 3.2) : [THREE.MathUtils.clamp(speed / 8.5, 0.8, 1.6), 1];
    const ampT = (W.walk * kW + W.run * kR) / Math.max(1e-3, W.walk + W.run) || 1;
    st.amp = (st.amp ?? 1) + (ampT - (st.amp ?? 1)) * (1 - Math.exp(-dt * 8));
    const kts = 1 - Math.exp(-dt * 10);
    if (act.walk) { act.walk.setEffectiveWeight(W.walk * ground); act.walk.timeScale += (tsW - act.walk.timeScale) * kts; }
    if (act.run) { act.run.setEffectiveWeight(W.run * ground); act.run.timeScale += (tsR - act.run.timeScale) * kts; }
    if (act.jump) act.jump.setEffectiveWeight(W.jump);
    mixer.update(dt);
    if (feet) for (const Lg of feet.legs) { // running centre of each leg bone's swing (the clip's mean pose, not the bind pose)
      if (!Lg.mean) Lg.mean = Lg.b.quaternion.clone(); else Lg.mean.slerp(Lg.b.quaternion, 1 - Math.exp(-dt * 1.5));
    }
    if (feet && st.amp > 1.001 && !api.extAir) for (const Lg of feet.legs) { // stride amplification (longer steps, same cadence)
      // amplify only the swing about the cycle centre, along the shortest arc, with a hard cap: amplifying the
      // offset from the bind pose (old code) could flip a >180 deg quaternion and leave one leg stuck pointing back
      const knee = /Leg$/.test(Lg.b.name) && !/UpLeg$/.test(Lg.b.name);
      const amp = 1 + (st.amp - 1) * (knee ? 0.4 : 1);
      _qa.copy(Lg.mean).invert().multiply(Lg.b.quaternion); if (_qa.w < 0) { _qa.x = -_qa.x; _qa.y = -_qa.y; _qa.z = -_qa.z; _qa.w = -_qa.w; }
      const ang = 2 * Math.acos(THREE.MathUtils.clamp(_qa.w, -1, 1));
      if (ang > 1e-4) { _va.set(_qa.x, _qa.y, _qa.z).normalize(); _qa.setFromAxisAngle(_va, Math.min(ang * amp, ang + 0.45, 1.2)); Lg.b.quaternion.copy(Lg.mean).multiply(_qa); }
    }


    // -- jump / hop
    if (st.air) {
      st.vy -= C.gravity * dt; st.y += st.vy * dt;
      if (st.y <= 0) { const impact = Math.min(1, -st.vy / 7); st.y = 0; st.vy = 0; st.air = false; st.sqv -= 3.2 * impact + 0.8; }
    }
    // -- squash & stretch spring (also a little on each footfall)
    st.ph += dt * (speed > 0.3 ? 2.6 + speed * 1.05 : 1.2);
    const step = speed > 0.5 && !st.air ? Math.pow(Math.abs(Math.sin(st.ph)), 6) * 0.025 * Math.min(1, speed / 5) : 0;
    st.sqv += (-st.sq * 160 - st.sqv * 13) * dt; st.sq += st.sqv * dt;
    const sq = THREE.MathUtils.clamp(st.sq, -0.2, 0.18) - step + (st.air ? THREE.MathUtils.clamp(st.vy * 0.012, -0.05, 0.08) : 0);
    squash.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    lean.position.y = (feet ? feet.off : 0) + st.y + (api.extY || 0);
    // -- lean into turns (roll) + accelerate / brake pitch
    const yaw = root.rotation.y;
    let turn = 0; if (st.lastYaw !== null && dt > 0) { let d = yaw - st.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); turn = d / dt; } st.lastYaw = yaw;
    const wantLean = THREE.MathUtils.clamp(-turn * speed * C.leanAmount, -C.maxLean, C.maxLean);
    st.lean += (wantLean - st.lean) * (1 - Math.exp(-dt * 7));
    const acc = dt > 0 ? (speed - st.prevSpeed) / dt : 0; st.prevSpeed = speed;
    const wantPitch = THREE.MathUtils.clamp(acc * 0.012, -0.12, 0.14) + Math.min(1, speed / 11) * (sprint ? 0.1 : 0.04);
    st.pitch += (wantPitch - st.pitch) * (1 - Math.exp(-dt * 5));
    lean.rotation.set(st.pitch, 0, st.lean);
    // -- head bob / look into the turn (on top of the clip)
    if (head) {
      const bob = Math.sin(st.ph * 2) * C.headBob * Math.min(1, speed / 6) + Math.sin(st.t * 1.7) * 0.02;
      q0.setFromEuler(_eu.set(bob - st.pitch * 0.6, THREE.MathUtils.clamp(turn * 0.08, -0.35, 0.35), -st.lean * 0.5));
      head.quaternion.multiply(q0);
    }
    if (spine2) { q0.setFromEuler(_eu.set(0, 0, -st.lean * 0.4)); spine2.quaternion.multiply(q0); }
    model.updateMatrixWorld(true);
    // -- foot grounding: put the lowest boot sole exactly on the surface (root y = ground), emit plant events
    if (feet) {
      root.updateWorldMatrix(true, true); feet.inv.copy(root.matrixWorld).invert();
      const ly = b => feet.v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(feet.inv).y;
      const cur = lean.position.y;
      const sole = [Math.min(ly(feet.L) - feet.dA, ly(feet.tL) - feet.dT) - cur, Math.min(ly(feet.R) - feet.dA, ly(feet.tR) - feet.dT) - cur];
      const low = Math.min(sole[0], sole[1]);
      if (!st.air && !api.extAir) {
        const want = THREE.MathUtils.clamp(-low, -0.3, 0.3);
        feet.off += (want - feet.off) * (1 - Math.exp(-dt * (GR.footSnap ?? 25)));
      }
      lean.position.y = feet.off + st.y + (api.extY || 0); lean.updateMatrixWorld(true);
      if (!api.extAir && !st.air && speed > 0.6) for (let k = 0; k < 2; k++) {
        const h = sole[k] - low;
        if (feet.up[k] && h < 0.02) { feet.up[k] = false; api.onStep?.(feet.v.setFromMatrixPosition((k ? feet.tR : feet.tL).matrixWorld), k, Math.min(1, speed / 11)); }
        else if (!feet.up[k] && h > 0.07) feet.up[k] = true;
      }
    }
    if (ik && gift.visible) ik(); // no carry pose while the gift is hidden (wardrobe preview)
    // -- pom-pom spring (verlet-ish point following the rigid tip)
    if (pom && pomTip) {
      pom.quaternion.identity(); pom.updateMatrixWorld(true);
      const rest = pom.localToWorld(v1.copy(pomTip.local)), piv = pom.getWorldPosition(v2);
      if (!pomTip.init) { pomTip.p.copy(rest); pomTip.v.set(0, 0, 0); pomTip.init = true; }
      const a = v0.copy(rest).sub(pomTip.p).multiplyScalar(70).addScaledVector(pomTip.v, -7); a.y -= 2.5;
      pomTip.v.addScaledVector(a, Math.min(dt, 0.05)); pomTip.p.addScaledVector(pomTip.v, Math.min(dt, 0.05));
      const dRest = rest.clone().sub(piv).normalize(), dNow = pomTip.p.clone().sub(piv).normalize();
      let ang = dRest.angleTo(dNow);
      if (ang > 0.7) { dNow.lerp(dRest, 1 - 0.7 / ang).normalize(); }
      pomTip.p.copy(piv).addScaledVector(dNow, rest.distanceTo(piv));
      q0.setFromUnitVectors(dRest, dNow);
      pom.parent.getWorldQuaternion(q1);
      pom.quaternion.copy(q1.clone().invert().multiply(q0).multiply(q1));
    }
    // -- flame + embers + light
    flame.material.uniforms.uTime.value = st.t;
    flame.material.uniforms.uI.value = C.flame.intensity * (api.state.boosted ? 1.35 : 1);
    if (flameLight && !lightOff) flameLight.intensity = lightI * (0.85 + 0.15 * Math.sin(st.t * 17) * Math.sin(st.t * 7.3)) * (api.state.boosted ? 1.35 : 1);
    if (embers) {
      if (!embers.points.parent && root.parent) root.parent.add(embers.points);
      embers.update(dt, (i, out) => { const a = tipsHead[(i * 7 + Math.floor(st.t * 13)) % tipsHead.length]; head.localToWorld(out.copy(a)); out.y += 0.05; });
    }
    // -- expressions from game state
    if (face) {
      const E = C.expressions, s = api.state;
      if (s.ice && !wasIce) api.emote(E.iceEnter, E.surprisedHold); wasIce = s.ice;
      st.moodT -= dt;
      let want = E.idle;
      if (s.storm > 0.45 || s.slow || (s.ice && speed > 2)) want = s.slow ? E.slowNode : s.ice ? E.iceSlip : E.storm;
      if (s.boosted) want = E.boosted;
      if (st.moodT > 0) want = st.mood;
      if (api.forceFace) want = api.forceFace;
      face.set(want); face.update(dt); api.faceName = face.target;
    }
  };
  api.giftHand = () => gift;
  api.lowFx = () => { for (const s of shells) s.visible = false; if (flameLight) flameLight.intensity = 0; lightOff = true; if (embers) embers.points.visible = false; };
  api.isAir = () => st.air;
  return api;
}
