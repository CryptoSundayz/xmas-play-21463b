// Village generation: ground, sky, roads, square, lake, buildings, lamps, forest, colliders, light pool.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { rng, worldUV, glowTexture, textTexture } from './util.js';
import { materials, windowMaterial, WINDOW_WARM, cloneTex } from './materials.js';
import { buildProcedural, BUILDING_WEIGHTS } from './buildings.js';
import { pineGeometry, lampGeometries, christmasTree, snowman, bench, giftPile, sleigh, reindeer } from './props.js';
import { MANIFEST, instantiate, bakedMeshes, addTextureGlow } from './assets.js';
import { makeLogoMesh } from './logo.js';
import { findChimney } from './fx.js';
import { smoothIco, snowBlend, snowSparkle, snowmanVariant, houseDecor, fenceGarland, fbm, hash2 } from './xmasdeco.js';
import { buildTerrain, conformDecals, makeTracks } from './terrain.js';
const chimneyCache = new Map();
const eaveCache = new Map();
const NO_STRING_LIGHTS = new Set(['windmill', 'church']);
const BULB_PALETTES = { warm: [0xffc86a, 0xffd88c, 0xffb050, 0xffe2a8], multi: [0xff3b3b, 0xffc93a, 0x39a8ff, 0x3dff7a, 0xff5fd2], blue: [0x3a9bff, 0x6ec1ff, 0xbfe6ff, 0x2b7dff], candy: [0xff3b3b, 0xfff1d8] };

/** Front roof-line silhouette of a building model in holder space -> bulb positions every ~0.3 m.
 *  Takes the highest vertex per x-bin within a thin slab at the front of the model (= the gable edge
 *  for front-gabled houses, the eave for side-gabled ones), clamps chimney spikes, adds a little droop. */
export function eaveProfile(obj, holder, side = 0) {
  holder.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().makeRotationY(-side).multiply(new THREE.Matrix4().copy(holder.matrixWorld).invert()), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const box = new THREE.Box3(); // tight box in holder space (a world AABB mapped back would be inflated by the rotation)
  obj.traverse(o => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld); const pa = o.geometry.attributes.position;
    for (let i = 0; i < pa.count; i += 3) box.expandByPoint(v.fromBufferAttribute(pa, i).applyMatrix4(m));
  });
  const W0 = box.min.x, Wd = box.max.x - box.min.x, H = box.max.y - box.min.y, zF = box.max.z, depth = box.max.z - box.min.z;
  const NB = 28, top = new Array(NB).fill(-1e9), topZ = new Array(NB).fill(zF);
  const slab = Math.min(1.6, depth * 0.22);
  obj.traverse(o => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pa = o.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 60000));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      if (v.z < zF - slab || v.y < box.min.y + H * 0.3) continue;
      const b = Math.min(NB - 1, Math.max(0, Math.floor((v.x - W0) / Wd * NB)));
      if (v.y > top[b] + 0.02 || (Math.abs(v.y - top[b]) < 0.02 && v.z > topZ[b])) { top[b] = Math.max(top[b], v.y); topZ[b] = v.z; }
    }
  });
  // drop empty bins at the ends, clamp chimney spikes (median of 5), keep a smooth outline
  let a = 0, e = NB - 1; while (a < NB && top[a] < -1e8) a++; while (e > a && top[e] < -1e8) e--;
  if (e - a < 4) return null;
  const ys = [], zs = [];
  for (let i = a; i <= e; i++) {
    const win = []; for (let k = -2; k <= 2; k++) { const j = Math.min(e, Math.max(a, i + k)); if (top[j] > -1e8) win.push(top[j]); }
    win.sort((p, q) => p - q); ys.push(win[Math.floor(win.length / 2)]);
    const wz = []; for (let k = -2; k <= 2; k++) { const j = Math.min(e, Math.max(a, i + k)); wz.push(topZ[j]); } wz.sort((p, q) => p - q); zs.push(wz[2] ?? topZ[i]);
  }
  const pts = ys.map((y, i) => new THREE.Vector3(W0 + (a + i + 0.5) / NB * Wd, y - 0.12, zs[i] + 0.1));
  // resample along the polyline every 0.3 m with a slight catenary droop between 1.5 m anchors
  const out = []; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], L = p0.distanceTo(p1);
    for (let t = 0; t < L; t += 0.3) {
      const q = p0.clone().lerp(p1, t / L); const ph = ((acc + t) % 1.5) / 1.5;
      q.y -= Math.sin(ph * Math.PI) * 0.12; out.push(q);
    }
    acc += L;
  }
  if (side) { const r = new THREE.Matrix4().makeRotationY(side); for (const q of out) q.applyMatrix4(r); }
  return out;
}


// Wet, glossy cobbles with patchy snow settled in the gaps, scattered drifts and a noisy
// snow edge. mode 0 = road ribbon (uv.x across the road, metres/4), mode 1 = round square.
export function snowyCobble(mat, mode, size) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMode = { value: mode }; sh.uniforms.uSize = { value: size };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSWP; varying vec2 vSUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vSUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vSWP; varying vec2 vSUv; uniform float uMode; uniform float uSize; float snowAmt = 0.0;
      float sh21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(sh21(i),sh21(i+vec2(1,0)),f.x), mix(sh21(i+vec2(0,1)),sh21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+17.1; a*=0.5; } return s; }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      {
        float rg = texture2D(roughnessMap, vRoughnessMapUv).g;
        float gap = smoothstep(0.525, 0.6, rg);
        vec2 wp = vSWP.xz;
        float n1 = fbm(wp*0.23), n2 = fbm(wp*1.1+7.3), n3 = vn(wp*4.5);
        float edgeD = uMode < 0.5 ? min(vSUv.x, uSize*0.25 - vSUv.x)*4.0 : uSize - length(wp);
        float edge = 1.0 - smoothstep(0.0, 0.9 + n1*1.8, edgeD + (n2-0.5)*1.3 + (n3-0.5)*0.3);
        float drift = smoothstep(0.66, 0.8, n1*0.75 + n2*0.45 - 0.02);
        float thin = smoothstep(0.45, 0.62, n2*0.7 + n1*0.5);
        float gapSnow = gap * smoothstep(0.5, 0.7, n1*0.45 + n2*0.55 + n3*0.12);
        snowAmt = clamp(max(max(edge, drift*0.92), max(gapSnow*0.95, thin*gap*0.45)), 0.0, 1.0);
        snowAmt = max(snowAmt, step(edgeD, -0.05));
        vec3 stone = diffuseColor.rgb;
        float l = dot(stone, vec3(0.3,0.59,0.11));
        stone = mix(vec3(l), stone, 0.55) * vec3(1.0,0.97,0.95);   // kill the grass, slightly warm
        stone *= 0.72 * (1.0 - gap*0.45);                         // wet = darker, gaps darker still
        vec3 snowC = vec3(0.78,0.83,0.93) * (0.9 + 0.18*n3);
        diffuseColor.rgb = mix(stone, snowC, snowAmt);
        roughnessFactor = mix(clamp(roughnessFactor*0.48 + gap*0.25, 0.18, 1.0), 0.88, snowAmt);
      }`)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(mix(normal, nonPerturbedNormal, snowAmt*0.85));');
  };
  mat.customProgramCacheKey = () => 'snowyCobble' + mode;
}

const W = CONFIG.world;

export class World {
  constructor(scene, quality) {
    this.scene = scene; this.q = quality;
    this.R = rng(W.seed);
    this.M = materials();
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = []; this.grid = new Map(); this.cell = 12;
    this.roads = []; // {curve, pts:[{x,z,tx,tz,s}], length}
    this.buildings = [];
    this.lightCandidates = [];
    this.animated = []; this.walkers = [];
    this.staticMeshes = [];
    this.bulbs = []; this.bulbCols = [];
    this.deco = []; this.snowmen = [];
    this.build();
  }

  // ---------------------------------------------------------------- build
  build() {
    this.makeSky();
    this.makeGround();
    this.makeRoads();
    this.makeSquare();
    this.makeLake();
    this.placeBuildings();
    this.makeLamps();
    this.makeStreetDressing();
    this.makeForest();
    this.makeProps();
    this.terrain = buildTerrain(this);
    this.heightAt = this.terrain.heightAt;
    this.finalizeDeco();
    if (this.lampPools) conformDecals(this, this.lampPools, 8);
    if (this.doorPools) conformDecals(this, this.doorPools, 6);
    if (this.q.name !== 'low') makeTracks(this, rng(W.seed + 99));
    this.mergeStatics();
    for (const c of this.colliders) this.indexCollider(c);
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uStorm: { value: 0 }, uFog: { value: this.scene.fog ? this.scene.fog.color : new THREE.Color(0x0d1a36) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `varying vec3 vDir; uniform float uTime; uniform float uStorm; uniform vec3 uFog;
        float h(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          float y = clamp(vDir.y, -0.2, 1.0);
          vec3 top = vec3(0.012,0.02,0.06), mid = vec3(0.04,0.07,0.16), hor = vec3(0.12,0.16,0.27);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, y)); c = mix(c, top, smoothstep(0.25, 0.9, y));
          // aurora-ish band
          float band = exp(-pow((y-0.32)*7.0,2.0)) * (0.5+0.5*sin(vDir.x*6.0+uTime*0.07+vDir.z*3.0));
          c += vec3(0.02,0.16,0.14)*band*0.55;
          // stars
          vec3 g = floor(vDir*320.0); float s = h(g); float tw = 0.6+0.4*sin(uTime*2.0+s*50.0);
          c += vec3(1.0)*step(0.9975, s)*smoothstep(0.02,0.2,y)*tw*1.2;
          c = mix(c, vec3(0.16,0.19,0.26), uStorm*0.85);
          // melt the horizon into the scene fog so the fogged far ground/forest has no hard edge
          c = mix(uFog, c, smoothstep(-0.03, 0.16 + uStorm * 0.2, vDir.y));
          gl_FragColor = vec4(c,1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat); this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    // moon
    const moon = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xfff6dd, fog: false }));
    moon.material.color.setScalar(1.6);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fb8ff, transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(160);
    this.moon = new THREE.Group(); this.moon.add(moon, glow);
    this.moon.position.set(-380, 420, -560); moon.lookAt(0, 0, 0);
    this.scene.add(this.moon);
  }

  makeGround() {
    const size = (W.radius + 160) * 2;
    const g = new THREE.PlaneGeometry(size, size, 1, 1); g.rotateX(-Math.PI / 2);
    const m = this.M.snowGround.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap']) { m[k] = cloneTex(m[k]); m[k].repeat.set(size / 9, size / 9); }
    this.ground = new THREE.Mesh(g, m); this.ground.receiveShadow = true; this.ground.position.y = -0.12;
    this.root.add(this.ground);
  }

  roadDef() {
    const deg = Math.PI / 180;
    const P = (r, a) => new THREE.Vector3(Math.cos(a * deg) * r, 0, Math.sin(a * deg) * r);
    const R = W.radius - 12;
    const mains = [[20, 26, 18, 10, 14], [110, 104, 114, 122, 116], [215, 222, 212, 205, 210], [300, 294, 304, 312, 306]];
    const rs = [W.squareRadius - 4, 60, 100, 140, R];
    const roads = mains.map(as => as.map((a, i) => P(rs[i], a)));
    roads.push([P(100, 18), P(125, 45), P(150, 60), P(R - 4, 70)]);
    roads.push([P(92, 213), P(120, 190), P(150, 176), P(R - 4, 168)]);
    roads.push([P(112, 304), P(135, 325), P(158, 340), P(R - 4, 348)]);
    return roads;
  }

  makeRoads() {
    const rw = W.roadWidth, EXT = 0.9; // ribbon extends under the snow banks; the shader blends it into snow
    const geos = [];
    for (const ctrl of this.roadDef()) {
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      const len = curve.getLength(); const n = Math.ceil(len / 1.5);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n; const p = curve.getPointAt(t); const tg = curve.getTangentAt(t);
        pts.push({ x: p.x, z: p.z, tx: tg.x, tz: tg.z, s: t * len });
      }
      this.roads.push({ curve, pts, length: len });
      // ribbon
      const pos = [], uv = [], idx = [];
      const hw = rw / 2 + EXT;
      pts.forEach((p, i) => {
        const nx = -p.tz, nz = p.tx;
        pos.push(p.x + nx * hw, 0.03, p.z + nz * hw, p.x - nx * hw, 0.03, p.z - nz * hw);
        uv.push(-EXT / 4, p.s / 4, (rw + EXT) / 4, p.s / 4);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      geos.push(g.toNonIndexed());
    }
    const roadMat = this.M.cobble.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap']) { roadMat[k] = cloneTex(roadMat[k]); }
    roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -1;
    roadMat.color.set(0xa49a92); roadMat.roughness = 1; roadMat.normalScale.set(1.4, 1.4);
    snowyCobble(roadMat, 0, rw);
    const rm = new THREE.Mesh(mergeGeometries(geos), roadMat); rm.receiveShadow = true; this.root.add(rm);
    this.roadMat = roadMat;
    this.makeSnowBanks();
  }

  // Lumpy, noisy snow heaps along both road edges (replaces the old flat white curb strips).
  // Inner edge dips under the road ribbon at a wandering offset so the shader's noisy
  // snow edge does the transition; sections that cross another road or the square sink away.
  makeSnowBanks() {
    const rw = W.roadWidth, R = rng(4242);
    const pos = [], uvs = [], idx = [];
    const roads = this.roads;
    const nearOther = (x, z, self) => {
      let best = 1e9;
      for (const r of roads) { if (r === self) continue; for (let i = 0; i < r.pts.length; i += 2) { const p = r.pts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; } }
      return Math.sqrt(best);
    };
    const COLS = 9;
    for (const road of roads) {
      const len = road.length, n = Math.ceil(len / 0.55);
      for (const side of [1, -1]) {
        const ph = [R() * 50, R() * 50, R() * 50, R() * 50];
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const t = i / n, s = t * len;
          const p = road.curve.getPointAt(t), tg = road.curve.getTangentAt(t);
          const nx = -tg.z * side, nz = tg.x * side;
          const w1 = Math.sin(s * 0.21 + ph[0]) * 0.5 + Math.sin(s * 0.57 + ph[1]) * 0.3 + Math.sin(s * 1.31 + ph[2]) * 0.2; // -1..1
          const w2 = Math.sin(s * 0.13 + ph[3]) * 0.6 + Math.sin(s * 0.83 + ph[0] * 1.7) * 0.4;
          let H = 0.16 + 0.24 * (w1 * 0.5 + 0.5) + 0.16 * Math.max(0, w2) + 0.07 * Math.sin(s * 2.3 + ph[1]) * Math.sin(s * 0.9 + ph[2]);
          H *= 0.7 + 0.6 * fbm(p.x * 0.45 + ph[0], p.z * 0.45, 3); // lumpy, shovelled-looking bank
          // fade under junctions / the square
          const cx = p.x + nx * (rw / 2 + 0.9), cz = p.z + nz * (rw / 2 + 0.9);
          const dOther = nearOther(cx, cz, road), dSq = Math.hypot(cx, cz) - W.squareRadius;
          const keep = Math.min(THREE.MathUtils.smoothstep(dOther, rw / 2 + 0.6, rw / 2 + 3.5), THREE.MathUtils.smoothstep(dSq, 0.5, 4));
          H *= keep;
          const inner = rw / 2 - 0.25 - 0.55 * (w2 * 0.5 + 0.5);
          const outer = rw / 2 + 1.5 + 0.9 * (w1 * 0.5 + 0.5);
          for (let c = 0; c < COLS; c++) {
            const u = c / (COLS - 1);
            const off = inner + (outer - inner) * u;
            let h = H * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.75) * (u < 0.1 ? u / 0.1 : 1);
            h += (R() - 0.5) * 0.07 * keep + 0.05 * Math.sin(s * 3.1 + c * 1.7 + ph[3]) * keep;
            if (c === 0) h = -0.02; if (c === COLS - 1) h = -0.03;
            const x = p.x + nx * off, z = p.z + nz * off;
            pos.push(x, h * (1 - 0.0) - (1 - keep) * 0.4, z); uvs.push(x / 3, z / 3);
          }
          if (i) {
            const a = base + (i - 1) * COLS, b = base + i * COLS;
            for (let c = 0; c < COLS - 1; c++) {
              const t1 = [a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1];
              if (side === -1) { [t1[1], t1[2]] = [t1[2], t1[1]]; [t1[4], t1[5]] = [t1[5], t1[4]]; }
              idx.push(...t1);
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // make sure normals point up
    const nr = g.attributes.normal; let down = 0; for (let i = 0; i < nr.count; i += 50) if (nr.getY(i) < 0) down++;
    if (down > nr.count / 100) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    const m = this.M.snowGround.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap']) m[k] = cloneTex(m[k]);
    m.color.set(0xd0dcf2); m.normalScale.set(1.3, 1.3);
    const bm = new THREE.Mesh(g, m); bm.receiveShadow = true; bm.castShadow = false; this.root.add(bm);
    this.snowBanks = bm;
  }

  distToRoad(x, z) {
    let best = 1e9;
    for (const r of this.roads) for (let i = 0; i < r.pts.length; i += 2) { const p = r.pts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  }

  makeSquare() {
    const sqMat = this.roadMat.clone(); snowyCobble(sqMat, 1, W.squareRadius);
    const sq = new THREE.Mesh(new THREE.CircleGeometry(W.squareRadius, 64).rotateX(-Math.PI / 2), sqMat);
    sq.position.y = 0.035; sq.receiveShadow = true; this.root.add(sq);
    // scale uv
    const uv = sq.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W.squareRadius / 2, uv.getY(i) * W.squareRadius / 2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(W.squareRadius, 0.35, 6, 80), this.M.stone); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; this.root.add(ring);
    // christmas tree
    const entry = MANIFEST.props.christmasTree; const glb = instantiate(entry);
    const tree = glb ? glb.object : christmasTree(); this.root.add(tree); this.tree = tree;
    // fence ring around tree
    const fr = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 48), this.M.gold); fr.rotation.x = Math.PI / 2; fr.position.y = 0.7; this.root.add(fr);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75, 6), this.M.gold); p.position.set(Math.cos(a) * 6.2, 0.37, Math.sin(a) * 6.2); this.root.add(p); }
    this.addCircle(0, 0, 6.4);
    this.lightCandidates.push({ x: 0, y: 6, z: 0, color: new THREE.Color(0xffd28a), intensity: 140, distance: 40, always: true });
    // gift piles + benches + sleigh with reindeer
    const glbOr = (entry, fallback) => instantiate(entry)?.object || fallback();
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; const gp = glbOr(MANIFEST.props.giftPile, giftPile); gp.position.set(Math.cos(a) * 4.3, 0, Math.sin(a) * 4.3); gp.rotation.y = -a + Math.PI / 2; this.root.add(gp); }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.52; const b = glbOr(MANIFEST.props.bench, bench); const r = W.squareRadius - 4;
      b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); b.rotation.y = -a - Math.PI / 2; this.root.add(b);
      this.addBox(b.position.x, b.position.z, 1.2, 0.4, b.rotation.y, 1);
    }
    const sl = MANIFEST.props.sleigh; const sg = instantiate(sl); const s = sg ? sg.object : sleigh();
    s.position.set(11, 0, -8); s.rotation.y = 0.9; this.root.add(s); this.addBox(11, -8, 1.0, 1.8, 0.9, 2);
    for (let i = 0; i < 4; i++) {
      const rd = this.makeReindeer(i === 3);
      const fx = Math.sin(0.9), fz = Math.cos(0.9);
      const row = Math.floor(i / 2), col = i % 2 ? 1 : -1;
      rd.group.position.set(11 + fx * (3.2 + row * 2.4) + fz * col * 0.75, 0, -8 + fz * (3.2 + row * 2.4) - fx * col * 0.75);
      rd.group.rotation.y = 0.9; this.root.add(rd.group);
      this.walkers.push({ rd, idle: true });
    }
    // wandering reindeer around the square
    // two walking + one running (run = same walk clip at a higher timeScale)
    for (let i = 0; i < 3; i++) {
      const rd = this.makeReindeer(false); this.root.add(rd.group);
      const r = [8.6, 10.8, 18.4][i]; // clear of fence (6.2), sleigh team (r 13-17.5) and benches (r 20)
      this.walkers.push({ rd, orbit: { r, speed: i === 2 ? 3.4 / r : (1.1 + i * 0.35) / r, a: i * 2.1 } });
    }
  }

  makeReindeer(rudolph) {
    const glb = instantiate(MANIFEST.characters.reindeer);
    if (glb) {
      const mixer = new THREE.AnimationMixer(glb.object);
      const e = MANIFEST.characters.reindeer;
      const clip = glb.animations.find(a => a.name.toLowerCase().includes(e.clips.walk.toLowerCase()));
      const idle = e.clips.idle ? glb.animations.find(a => a.name.toLowerCase().includes(e.clips.idle.toLowerCase())) : null;
      const wa = clip && mixer.clipAction(clip); const ia = idle && mixer.clipAction(idle);
      wa?.play(); ia?.play();
      if (wa) wa.time = Math.random() * clip.duration;
      // Tripo quadruped rig ships a walk clip only: idle = walk slowed to a near-still weight shift
      if (!ia) {
        // standing: hold the clip's first (neutral) frame; moving: walk, and walk at up to 2.4x timeScale reads as a trot/run
        if (wa) { wa.time = 0; mixer.update(0); }
        let still = true;
        // additive procedural layer on top of the clip: breathing, head look/nod/graze while idle,
        // and a running bob + spine pitch (stride reads stronger at the higher timeScale)
        const bones = {}; glb.object.traverse(o => { if (o.isBone) bones[o.name.replace(/^tripo:*/, '')] = o; });
        const layer = ['Head_0', 'Head_1', 'Spine_1', 'Spine_3'].map(n => bones[n]).filter(Boolean).map(b => ({ b, base: b.quaternion.clone() }));
        const ph = Math.random() * 100, eu = new THREE.Euler(), qq = new THREE.Quaternion();
        let time = 0, runPh = 0;
        const add = (L, x, y, z) => { L.b.quaternion.multiply(qq.setFromEuler(eu.set(x, y, z))); };
        const obj = glb.object;
        return { group: obj, update(dt, sp) {
          if (!wa) return;
          time += dt;
          for (const L of layer) L.b.quaternion.copy(L.base);
          const k = Math.min(1, sp / 2.5);
          if (sp > 0.05) { if (still) { still = false; wa.time = Math.random() * clip.duration; } wa.timeScale = Math.min(3.1, Math.max(0.7, sp * 1.15)); mixer.update(dt); }
          const [h0, h1, s1, s3] = [layer[0], layer[1], layer[2], layer[3]];
          const breathe = Math.sin(time * 1.7 + ph) * 0.025;
          if (sp <= 0.05) {
            const graze = Math.max(0, Math.sin(time * 0.23 + ph) - 0.6) * 1.6; // head dips now and then
            if (h0) add(h0, Math.sin(time * 0.6 + ph) * 0.06 + graze * 0.35, Math.sin(time * 0.31 + ph * 2) * 0.28, 0);
            if (h1) add(h1, Math.sin(time * 1.1 + ph) * 0.05, Math.sin(time * 0.5 + ph) * 0.1, 0);
            if (s1) add(s1, breathe, 0, 0); if (s3) add(s3, -breathe * 0.7, 0, 0);
          } else {
            runPh += dt * sp * 4.2;
            if (s1) add(s1, Math.sin(runPh) * 0.06 * k + breathe * 0.5, 0, 0);
            if (h0) add(h0, -Math.sin(runPh) * 0.07 * k, 0, 0);
            obj.position.y += Math.abs(Math.sin(runPh)) * 0.12 * k;
          }
        } };
      }
      return { group: glb.object, update(dt, sp) { wa?.setEffectiveWeight(Math.min(1, sp)); ia?.setEffectiveWeight(1 - Math.min(1, sp)); mixer.update(dt); } };
    }
    return reindeer(rudolph);
  }

  makeLake() {
    const [cx, cz] = W.lakeCenter, [rx, rz] = W.lakeRadii;
    const g = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    const m = this.M.ice.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap']) { m[k] = cloneTex(m[k]); m[k].repeat.set(6, 6); }
    m.polygonOffset = true; m.polygonOffsetFactor = -2;
    const lake = new THREE.Mesh(g, m); lake.scale.set(rx, 1, rz); lake.position.set(cx, 0.04, cz); lake.receiveShadow = true;
    this.root.add(lake);
    const shore = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 64), this.M.snow); shore.rotation.x = Math.PI / 2; shore.scale.set(rx + 0.4, rz + 0.4, 12); shore.position.set(cx, 0.0, cz);
    this.root.add(shore);
    // little wooden pier
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 9), this.M.wood); pier.position.set(cx + rx - 3, 0.25, cz - 2); pier.rotation.y = 1.2; this.root.add(pier);
    this.lake = { cx, cz, rx, rz };
  }
  inLake(x, z, margin = 0) {
    const L = this.lake; return ((x - L.cx) / (L.rx + margin)) ** 2 + ((z - L.cz) / (L.rz + margin)) ** 2 < 1;
  }

  // -------------------------------------------------------------- buildings
  pickType() {
    const ent = Object.entries(BUILDING_WEIGHTS); const tot = ent.reduce((s, e) => s + e[1], 0);
    let r = this.R() * tot; for (const [k, w] of ent) { if ((r -= w) <= 0) return k; } return ent[0][0];
  }

  canPlace(x, z, rot, w, d, margin = 1.5, roadPad = 1.6) {
    if (Math.hypot(x, z) > W.radius - 8 - Math.max(w, d) / 2) return false;
    if (Math.hypot(x, z) < W.squareRadius + Math.max(w, d) / 2 + 1) return false;
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, d / 2], [w / 2, 0], [-w / 2, 0], [0, -d / 2]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
    for (const [px, pz] of corners) {
      if (this.distToRoad(px, pz) < W.roadWidth / 2 + roadPad) return false;
      if (this.inLake(px, pz, 4)) return false;
    }
    for (const b of this.buildings) if (obbOverlap({ x, z, rot, hw: w / 2 + margin, hd: d / 2 + margin }, { x: b.x, z: b.z, rot: b.rot, hw: b.footprint[0] / 2 + margin, hd: b.footprint[1] / 2 + margin })) return false;
    return true;
  }

  placeBuildings() {
    // around the square: hand-picked landmark types facing the tree
    const ringTypes = ['church', 'bakery', 'validatorHouse', 'inn', 'townhouse', 'toyWorkshop', 'townhouse', 'gingerbread', 'stoneCottage'];
    let ti = 0;
    for (let a = 0; a < Math.PI * 2 && ti < ringTypes.length; a += 0.08) {
      const type = ringTypes[ti]; const fp = MANIFEST.buildings[type].footprint;
      const r = W.squareRadius + 3.5 + fp[1] / 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r; const rot = Math.atan2(-x, -z);
      if (this.canPlace(x, z, rot, fp[0], fp[1])) { this.addBuilding(type, x, z, rot); ti++; a += 0.25; }
    }
    // along roads, both sides. Inside the village core (r < W.denseRadius) houses line the street
    // shoulder to shoulder, close to the cobbles (concept art); further out they thin into hamlets.
    for (const road of this.roads) {
      for (const side of [1, -1]) {
        for (let s = 6; s < road.length - 4;) {
          const i = Math.min(road.pts.length - 1, Math.round(s / 1.5)); const p = road.pts[i];
          const dense = Math.hypot(p.x, p.z) < W.denseRadius;
          if (!dense && this.R() < 0.18) { s += this.R.range(9, 14); continue; }
          const type = this.pickType(); const fp = MANIFEST.buildings[type].footprint;
          const nx = -p.tz * side, nz = p.tx * side;
          const off = W.roadWidth / 2 + (dense ? 2.1 + this.R.range(0, 0.9) : 3 + this.R.range(0, 2)) + fp[1] / 2;
          const x = p.x + nx * off, z = p.z + nz * off;
          const rot = Math.atan2(-nx, -nz) + (dense ? this.R.range(-0.07, 0.07) : 0);
          if (this.canPlace(x, z, rot, fp[0], fp[1], dense ? 0.6 : 1.5, dense ? 1.0 : 1.6)) { this.addBuilding(type, x, z, rot); s += dense ? fp[0] / 2 + this.R.range(3.2, 5.5) : this.R.range(9, 14); }
          else s += dense ? 2 : this.R.range(9, 14);
        }
      }
    }
    // ensure enough validator-style houses exist
    const nVal = this.buildings.filter(b => b.type === 'validatorHouse').length;
    console.info(`[world] ${this.buildings.length} buildings (${nVal} validator houses)`);
  }

  addBuilding(type, x, z, rot) {
    const spec = MANIFEST.buildings[type];
    const glb = instantiate({ ...spec, fit: { footprint: spec.footprint } });
    const holder = new THREE.Group(); holder.position.set(x, 0, z); holder.rotation.y = rot;
    const winMat = windowMaterial();
    let windowMesh = null, animated = [];
    let gSize = null, gBox = null;
    if (glb) {
      holder.add(glb.object);
      glb.object.updateMatrixWorld(true);
      gBox = new THREE.Box3().setFromObject(glb.object); gSize = gBox.getSize(new THREE.Vector3());
      // Tripo textures bake lit windows: make those texels emissive and drive them from winMat
      // (warm by default, blue once the validator has the block, flicker for slow nodes).
      const glowI = { get value() { return winMat.emissiveIntensity * 1.15; } };
      const seen = new Map();
      glb.object.traverse(o => {
        if (!o.isMesh) return;
        if (MANIFEST.windowMaterials.some(s => (o.material?.name || '').toLowerCase().includes(s))) { o.material = winMat; return; }
        if (!seen.has(o.material)) {
          const m = o.material.clone(); m.envMapIntensity = 0.9;
          seen.set(o.material, snowBlend(addTextureGlow(m, winMat.emissive, glowI, 'bglow'), { minY: 1.9, thr: 0.5, soft: 0.22 }));
        }
        o.material = seen.get(o.material);
      });
      if (spec.logo) {
        // the in-engine vector Optimum logo (one closed peanut ring) over the facade sign
        const s = gSize.x, [lx, ly, lz, lw] = spec.logo;
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(lw * s * 1.25, lw * s * 0.72), new THREE.MeshStandardMaterial({ color: 0x07121f, roughness: 0.4, metalness: 0.3 }));
        plate.position.set(lx * s, ly * s, lz * s + 0.04);
        const logo = makeLogoMesh(lw * s * 0.5, 0.024, 0x4fc3ff, 1.5); logo.position.z = 0.03; plate.add(logo);
        plate.userData.logo = logo; holder.add(plate);
      }
      if (spec.sign) this.mountSign(holder, glb.object, gBox);
      if (spec.smoke !== false) {
        if (!chimneyCache.has(type)) chimneyCache.set(type, findChimney(glb.object));
        var chimneyLocal = chimneyCache.get(type);
      }
    } else {
      const b = buildProcedural(type);
      holder.add(b.group);
      animated = b.animated;
      if (b.windowGeos.length) {
        const g = mergeGeometries(b.windowGeos.map(g => g.index ? g.toNonIndexed() : g));
        windowMesh = new THREE.Mesh(g, winMat); holder.add(windowMesh);
      }
    }
    this.root.add(holder);
    holder.updateMatrixWorld(true);
    const fx = Math.sin(rot), fz = Math.cos(rot);
    const height = gSize ? gSize.y : spec.height;
    const fp = gSize ? [gSize.x, gSize.z] : spec.footprint;
    const door = new THREE.Vector3(...(gSize ? [0, 0, gBox.max.z - 0.15] : spec.door)).applyMatrix4(holder.matrixWorld);
    const b = {
      id: this.buildings.length, type, x, z, rot, footprint: fp, height,
      holder, winMat, door, front: new THREE.Vector3(fx, 0, fz),
      trigger: door.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), 1.6),
      light: { x: door.x + fx * 1.2, y: 3.2, z: door.z + fz * 1.2, color: WINDOW_WARM.clone(), intensity: 16, distance: 15 },
      isGLB: !!glb,
      chimney: chimneyLocal ? chimneyLocal.clone().applyMatrix4(holder.matrixWorld) : null,
    };
    this.lightCandidates.push(b.light);
    // string lights along the front roof line (gable/eave silhouette measured from the model itself)
    if (glb && !NO_STRING_LIGHTS.has(type) && Math.hypot(x, z) < W.stringLightRadius && this.q.name !== 'low') {
      // every side of the roof: front + back eaves/gables and both side gables
      const h = hash2(x * 0.37, z * 0.71);
      const pal = type === 'validatorHouse' ? BULB_PALETTES.blue : h < 0.48 ? BULB_PALETTES.warm : h < 0.88 ? BULB_PALETTES.multi : BULB_PALETTES.candy;
      for (const sd of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const k = type + ':' + sd.toFixed(2);
        if (!eaveCache.has(k)) eaveCache.set(k, eaveProfile(glb.object, holder, sd));
        const prof = eaveCache.get(k);
        if (prof) prof.forEach((v, i) => { this.bulbs.push(v.clone().applyMatrix4(holder.matrixWorld)); this.bulbCols.push(pal[i % pal.length]); });
      }
    }
    for (const a of animated) this.animated.push(a);
    this.buildings.push(b);
    this.addBox(x, z, fp[0] / 2 * (gSize ? 0.94 : 1), fp[1] / 2 * (gSize ? 0.94 : 1), rot, height, b);
    return b;
  }

  // -------------------------------------------------------------- lamps
  makeLamps() {
    const pts = [];
    for (const road of this.roads) {
      let side = 1;
      for (let s = 6; s < road.length;) {
        const p = road.pts[Math.min(road.pts.length - 1, Math.round(s / 1.5))];
        s += Math.hypot(p.x, p.z) < W.denseRadius ? W.lampSpacingDense : W.lampSpacing;
        const off = W.roadWidth / 2 + 0.9;
        const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
        side *= -1;
        if (Math.hypot(x, z) < W.squareRadius + 2) continue;
        if (this.buildingAt(x, z, 0.35)) continue;
        pts.push([x, z]);
      }
    }
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.15; pts.push([Math.cos(a) * (W.squareRadius - 1.2), Math.sin(a) * (W.squareRadius - 1.2)]); }
    // Tripo lamp GLB (instanced, lantern texels glow) or procedural post + head
    const glbParts = bakedMeshes(MANIFEST.props.streetLamp);
    let instParts;
    if (glbParts) {
      const lampC = new THREE.Color(0xffc070), lampI = { value: 3.2 };
      instParts = glbParts.map(({ geometry, material }) => {
        const m = addTextureGlow(material.clone(), lampC, lampI, 'lampglow');
        const im = new THREE.InstancedMesh(geometry, m, pts.length); im.castShadow = true; return im;
      });
      this.lampHeadY = MANIFEST.props.streetLamp.headY || 3.75;
    } else {
      const { post, head } = lampGeometries();
      const postM = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }), pts.length);
      postM.castShadow = true;
      const headMat = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffc070, emissiveIntensity: 4 });
      instParts = [postM, new THREE.InstancedMesh(head, headMat, pts.length)];
      this.lampHeadY = 4.02;
    }
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff9a48, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const poolM = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), poolMat, pts.length);
    const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffb070, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const m4 = new THREE.Matrix4();
    pts.forEach(([x, z], i) => {
      m4.makeRotationY(Math.atan2(-x, -z) + (i * 2.4)); m4.setPosition(x, 0, z); for (const im of instParts) im.setMatrixAt(i, m4);
      m4.makeTranslation(x, 0.06, z); poolM.setMatrixAt(i, m4);
      this.addCircle(x, z, 0.3);
      this.lightCandidates.push({ x, y: this.lampHeadY - 0.1, z, color: new THREE.Color(0xffa458), intensity: 46, distance: 20, lamp: true });
    });
    for (const im of instParts) { im.computeBoundingSphere(); this.root.add(im); }
    this.root.add(poolM); this.lampPools = poolM;
    // halos: camera-facing sprites are costly as individual objects -> use Points
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(([x, z]) => [x, this.lampHeadY, z]), 3));
    const halos = new THREE.Points(hg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb070, size: 2.6, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.root.add(halos);
    this.lamps = pts;
  }

  // ------------------------------------------------- street dressing (concept-art coziness)
  makeStreetDressing() {
    const R = rng(W.seed + 7), rw = W.roadWidth;
    const fences = [], pines = [];
    const nearLamp = (x, z, d) => this.lamps.some(l => (l[0] - x) ** 2 + (l[1] - z) ** 2 < d * d);
    for (const road of this.roads) for (const side of [1, -1]) {
      let run = R() < 0.7;
      for (let s = 2; s < road.length; s += 2.4) {
        const p = road.pts[Math.min(road.pts.length - 1, Math.round(s / 1.5))];
        const d0 = Math.hypot(p.x, p.z); if (d0 > W.denseRadius + 20) break;
        if (Math.floor(s / 12) !== Math.floor((s - 2.4) / 12)) run = R() < 0.65;
        const nx = -p.tz * side, nz = p.tx * side;
        // snowy picket fence just off the curb bank
        const fo = rw / 2 + 1.75, fx = p.x + nx * fo, fz = p.z + nz * fo;
        if (run && d0 > W.squareRadius + 3 && !this.buildingAt(fx, fz, 0.5) && !nearLamp(fx, fz, 1.1) && !this.inLake(fx, fz, 1) && this.distToRoad(fx, fz) > rw / 2 + 1.4)
          fences.push([fx, fz, Math.atan2(p.tx, p.tz)]);
        // small snowy pines in the gaps between houses
        if (R() < 0.8) {
          const po = rw / 2 + R.range(2.5, 5.2), px = p.x + nx * po + p.tx * R.range(-1, 1), pz = p.z + nz * po + p.tz * R.range(-1, 1);
          if (d0 > W.squareRadius + 3 && !this.buildingAt(px, pz, 1.0) && !nearLamp(px, pz, 1.8) && !this.inLake(px, pz, 1) && this.distToRoad(px, pz) > rw / 2 + 2.3
            && !pines.some(q => (q[0] - px) ** 2 + (q[1] - pz) ** 2 < 3.2)) pines.push([px, pz, R.range(0.3, 0.62), R() * 6.28]);
        }
      }
    }
    // fence segment (2.4 m): 2 posts, 2 rails, pickets; snow caps on top
    const wood = [], snow = [];
    const bx = (arr, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); arr.push(g); };
    // lumpy snow: a squashed, noise-displaced blob
    const blob = (w, h, d, x, y, z, seed) => {
      const g = smoothIco(1, 2); const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const vx = pa.getX(i), vy = pa.getY(i), vz = pa.getZ(i);
        const n = 1 + 0.16 * Math.sin(vx * 5.1 + seed) * Math.sin(vz * 4.3 + seed * 1.7) + 0.08 * Math.sin(vy * 7 + vx * 3 + seed);
        pa.setXYZ(i, vx * w * n, Math.max(vy, -0.15) * h * n, vz * d * n);
      }
      g.computeVertexNormals(); g.translate(x, y, z); return g;
    };
    for (const x of [-1.15, 1.15]) { bx(wood, 0.12, 1.05, 0.12, x, 0.52, 0); snow.push(blob(0.11, 0.09, 0.11, x, 1.06, 0, x * 3)); }
    bx(wood, 2.4, 0.08, 0.05, 0, 0.4, 0); bx(wood, 2.4, 0.08, 0.05, 0, 0.78, 0);
    for (let i = -4; i <= 4; i++) { bx(wood, 0.09, 0.9, 0.035, i * 0.25, 0.47, 0.04); snow.push(blob(0.07, 0.05, 0.05, i * 0.25, 0.93, 0.04, i)); }
    for (const x of [-0.6, 0.6]) snow.push(blob(0.68, 0.07, 0.09, x, 0.83, 0.0, x * 5));
    // snow drifted up against the fence base (road side and yard side)
    snow.push(blob(1.35, 0.32, 0.45, 0.1, 0.0, -0.32, 2.2), blob(1.0, 0.22, 0.35, -0.3, 0.0, 0.35, 4.1));
    const woodGeo = mergeGeometries(wood), snowGeo = mergeGeometries(snow.map(g => g.index ? g.toNonIndexed() : g));
    const woodMat = this.M.wood.clone(); woodMat.color = new THREE.Color(0x8a5f3e);
    const fw = new THREE.InstancedMesh(woodGeo, woodMat, Math.max(1, fences.length)), fs = new THREE.InstancedMesh(snowGeo, this.M.snow, Math.max(1, fences.length));
    const m4 = new THREE.Matrix4();
    fences.forEach(([x, z, r], i) => {
      m4.makeRotationY(r + Math.PI / 2); m4.setPosition(x, 0, z); fw.setMatrixAt(i, m4); fs.setMatrixAt(i, m4);
      this.addBox(x, z, 1.2, 0.12, r + Math.PI / 2, 1.1);
    });
    fw.count = fs.count = fences.length; fw.castShadow = true; fw.receiveShadow = fs.receiveShadow = true;
    for (const im of [fw, fs]) { im.computeBoundingSphere(); this.root.add(im); }
    // evergreen garlands with red bows and bulbs on ~55% of the fence segments
    if (this.q.name !== 'low') {
      const fg = fenceGarland(), gl = fences.filter(f => hash2(f[0] * 0.3, f[1] * 0.3) < 0.55);
      const gm = new THREE.InstancedMesh(fg.lit, this.decoMats().lit, Math.max(1, gl.length)), gg = new THREE.InstancedMesh(fg.glow, this.decoMats().glow, Math.max(1, gl.length));
      gl.forEach(([x, z, r], i) => { m4.makeRotationY(r + Math.PI / 2); m4.setPosition(x, 0, z); gm.setMatrixAt(i, m4); gg.setMatrixAt(i, m4); });
      gm.count = gg.count = gl.length; for (const im of [gm, gg]) { im.computeBoundingSphere(); this.root.add(im); }
    }
    // more snow-laden pines: behind / between houses and in a ring around the square
    for (const b of this.buildings) {
      if (Math.hypot(b.x, b.z) > W.denseRadius + 30) continue;
      const f = b.front, rx = f.z, rz = -f.x, hw = b.footprint[0] / 2, hd = b.footprint[1] / 2;
      const cand = [[-(hd + R.range(1.6, 3.5)), R.range(-hw, hw)], [-(hd + R.range(1.6, 4)), R.range(-hw, hw)], [R.range(-hd, hd * 0.3), (hw + R.range(1.4, 2.4)) * (R() < 0.5 ? -1 : 1)]];
      for (const [lz, lx] of cand) {
        const px = b.x + f.x * lz + rx * lx, pz = b.z + f.z * lz + rz * lx;
        if (this.buildingAt(px, pz, 0.9) || nearLamp(px, pz, 1.8) || this.inLake(px, pz, 1) || this.distToRoad(px, pz) < rw / 2 + 2.4 || Math.hypot(px, pz) < W.squareRadius + 2) continue;
        if (pines.some(q => (q[0] - px) ** 2 + (q[1] - pz) ** 2 < 3.5)) continue;
        pines.push([px, pz, R.range(0.32, 0.75), R() * 6.28]);
      }
    }
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * Math.PI * 2 + R() * 0.03, r = W.squareRadius + R.range(1.2, 3.2), px = Math.cos(a) * r, pz = Math.sin(a) * r;
      if (this.buildingAt(px, pz, 0.6) || this.distToRoad(px, pz) < rw / 2 + 1.6 || nearLamp(px, pz, 1.5) || pines.some(q => (q[0] - px) ** 2 + (q[1] - pz) ** 2 < 2.6)) continue;
      pines.push([px, pz, R.range(0.25, 0.5), R() * 6.28]);
    }
    // small pines (Tripo pine, instanced)
    const parts = this.pineParts();
    const pinst = parts ? parts.map(({ geometry, material }) => new THREE.InstancedMesh(geometry, material, Math.max(1, pines.length)))
      : [new THREE.InstancedMesh(pineGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), Math.max(1, pines.length))];
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    pines.forEach(([x, z, sz, r], i) => {
      m4.compose(pv.set(x, 0, z), q.setFromAxisAngle(up, r), sc.set(sz, sz, sz)); for (const im of pinst) im.setMatrixAt(i, m4);
      this.addCircle(x, z, 0.5 * sz + 0.2);
    });
    for (const im of pinst) { im.count = pines.length; im.castShadow = true; im.receiveShadow = !!parts; im.computeBoundingSphere(); this.root.add(im); }
    this.streetPines = pines;
    // eave string lights: one instanced mesh of warm emissive bulbs (bloom makes them twinkle-glow)
    if (this.bulbs.length) {
      const bulbs = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.065, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.bulbs.length);
      const c = new THREE.Color();
      this.bulbs.forEach((v, i) => {
        m4.makeTranslation(v.x, v.y, v.z); bulbs.setMatrixAt(i, m4);
        c.setHex(this.bulbCols[i] ?? 0xffc86a).multiplyScalar(2.6 + ((i * 7) % 5) * 0.25); bulbs.setColorAt(i, c);
      });
      bulbs.computeBoundingSphere(); this.root.add(bulbs); this.bulbMesh = bulbs;
    }
    this.makeYardLife(R);
    console.info(`[world] street dressing: ${fences.length} fence segments, ${pines.length} small pines, ${this.bulbs.length} string-light bulbs`);
  }

  // shared materials for the vertex-coloured decoration kits
  decoMats() {
    if (!this._decoMats) {
      this._decoMats = {
        lit: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 }),
        glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
        snow: snowSparkle(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0xf6f8ff }), { glint: 1.2, lift: 1.1 }),
        acc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      };
    }
    return this._decoMats;
  }
  // Tripo pine with an up-facing snow blend (snow-laden branches); shared by street pines and the forest
  pineParts() {
    if (this.q.name === 'low') return null;
    if (!this._pineParts) {
      const parts = bakedMeshes(MANIFEST.props.pine);
      if (!parts) return null;
      const mats = new Map();
      this._pineParts = parts.map(({ geometry, material }) => {
        if (!mats.has(material)) mats.set(material, snowBlend(material.clone(), { minY: 0.6, thr: 0.18, soft: 0.3, scale: 3.2, color: 0xf4f8ff }));
        return { geometry, material: mats.get(material) };
      });
    }
    return this._pineParts;
  }
  // Official Optimum mark as a mounted neon sign above the validator's door (replaces any baked texture logo).
  mountSign(holder, obj, gBox) {
    const ray = new THREE.Raycaster(); let wallZ = gBox.max.z;
    const hits = [];
    for (const x of [-0.6, 0, 0.6]) {
      ray.set(new THREE.Vector3(x, 3.1, gBox.max.z + 4), new THREE.Vector3(0, 0, -1));
      const h = ray.intersectObject(obj, true)[0]; if (h) hits.push(h.point.z);
    }
    if (hits.length) wallZ = Math.max(...hits);
    const sign = new THREE.Group(); sign.position.set(0, 3.15, wallZ + 0.12);
    const plateGeo = new THREE.BoxGeometry(2.5, 1.45, 0.08);
    const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0x0b1424, roughness: 0.35, metalness: 0.4 }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.62, 1.57, 0.05), new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.5, metalness: 0.6 })); frame.position.z = -0.03;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.1, 0.24), this.M.snow); cap.position.set(0, 0.8, 0.03); cap.scale.y = 1.4;
    const logo = makeLogoMesh(0.95, 0.02, 0x51b1fe, 0.95); logo.position.z = 0.05; logo.userData.halo.material.opacity = 0.75;
    sign.add(frame, plate, cap, logo); sign.userData.logo = logo; holder.add(sign);
    this.validatorSign = sign;
  }
  queueDeco(kind, x, z, rot, s = 1, lift = -0.03) { this.deco.push({ kind, x, z, rot, s, lift }); }

  // Lived-in street life: snow heaps against house walls, warm door pools, and a varied Christmas kit
  // in front of EVERY house (wreath, garland, candy canes, decorated mini trees, gift stacks, lantern posts,
  // sleds, code-built snowmen), all instanced per kit.
  makeYardLife(R) {
    const rw = W.roadWidth, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const near = this.buildings.filter(b => Math.hypot(b.x, b.z) < W.stringLightRadius + 15);
    const heaps = [], pools = [];
    const heapGeo = smoothIco(1, 3); { const pa = heapGeo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const n = 1 + 0.18 * Math.sin(x * 4.2 + 1.3) * Math.sin(z * 3.7) + 0.1 * Math.sin(y * 6 + x * 5); pa.setXYZ(i, x * n, Math.max(y, -0.2) * n, z * n); } heapGeo.computeVertexNormals(); }
    const tryHeap = (x, z, w, h, d, r) => { if (this.distToRoad(x, z) < rw / 2 + 0.2) return; heaps.push([x, z, w, h, d, r]); };
    const placed = [];
    const free = (x, z, rad = 0.5) => !this.buildingAt(x, z, rad * 0.6) && this.distToRoad(x, z) > rw / 2 + 0.9 + rad * 0.5 && !this.inLake(x, z, 0.5)
      && Math.hypot(x, z) > W.squareRadius + 1 && !placed.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < (p[2] + rad) ** 2)
      && !this.lamps.some(l => (l[0] - x) ** 2 + (l[1] - z) ** 2 < (rad + 0.6) ** 2);
    let nKits = 0, nSnowmen = 0;
    for (const b of near) {
      const f = b.front, rx = f.z, rz = -f.x, hw = b.footprint[0] / 2, hd = b.footprint[1] / 2;
      const fx = b.x + f.x * hd, fz = b.z + f.z * hd;
      for (const sd of [-1, 1]) {
        const o = hw * R.range(0.55, 0.95);
        tryHeap(fx + rx * o * sd + f.x * 0.4, fz + rz * o * sd + f.z * 0.4, R.range(0.7, 1.5), R.range(0.3, 0.6), R.range(0.45, 0.8), b.rot + R.range(-0.3, 0.3));
      }
      if (!b.isGLB) continue;
      pools.push([b.door.x + f.x * 2.6, b.door.z + f.z * 2.6, b.rot]);
      const dw = (lx, lz) => [b.door.x + rx * lx + f.x * lz, b.door.z + rz * lx + f.z * lz];
      const special = NO_STRING_LIGHTS.has(b.type);
      // door dressing
      if (!special) {
        const [wx, wz] = dw(0, 0.02); this.queueDeco('wreath', wx, wz, b.rot, 1, 0);
        if (R() < 0.6) this.queueDeco('garland', wx, wz, b.rot, 1, 0);
      }
      const h = R();
      if (h < 0.42) { const [x, z] = dw(0, 0); if (free(x + f.x * 1.1, z + f.z * 1.1, 0.4)) { this.queueDeco('canes', x, z, b.rot); placed.push([x + f.x * 1.1, z + f.z * 1.1, 0.9]); } }
      else if (h < 0.75) { const [x, z] = dw(0, 0); if (free(x + f.x * 0.9, z + f.z * 0.9, 0.4)) { this.queueDeco('lanterns', x, z, b.rot); placed.push([x + f.x * 0.9, z + f.z * 0.9, 1.0]); } }
      // yard slots: front corners, beside the house, a little further out
      const slots = [[-(hw * 0.62), 1.2], [hw * 0.62, 1.2], [-(hw + 1.3), 0.4 - hd * 0.3], [hw + 1.3, 0.4 - hd * 0.3], [-(hw * 0.35 + 1.4), 2.4], [hw * 0.35 + 1.4, 2.4]].sort(() => R() - 0.5);
      let want = 2 + (R() < 0.5 ? 1 : 0), got = 0;
      for (const [lx, lz] of slots) {
        if (got >= want) break;
        const [x, z] = dw(lx, lz); const k = R();
        const kind = k < 0.3 ? 'tree' : k < 0.55 ? 'gifts' : k < 0.8 ? 'snowman' : k < 0.92 ? 'sled' : 'tree';
        const rad = kind === 'snowman' ? 1.0 : kind === 'tree' ? 0.75 : 0.55;
        if (!free(x, z, rad)) continue;
        placed.push([x, z, rad]); got++; nKits++;
        if (kind === 'snowman') { this.snowmen.push([x, z, b.rot + R.range(-0.6, 0.6), nSnowmen % 3, R.range(0.9, 1.12)]); nSnowmen++; this.addCircle(x, z, 0.75); }
        else if (kind === 'tree') { this.queueDeco('tree' + (R() < 0.5 ? 0 : 1), x, z, R() * 6.28, R.range(0.9, 1.35)); this.addCircle(x, z, 0.55); }
        else if (kind === 'gifts') this.queueDeco('gifts' + Math.floor(R() * 3), x, z, R() * 6.28);
        else { this.queueDeco('sled', x, z, b.rot + R.range(-1, 1)); this.addCircle(x, z, 0.45); }
      }
    }
    const snowMat = this.M.snowGround.clone(); for (const k of ['map', 'normalMap', 'roughnessMap']) snowMat[k] = cloneTex(snowMat[k]); snowMat.color.set(0xd6e0f4);
    snowSparkle(snowMat, { glint: 0.8, lift: 0.8 });
    const hm = new THREE.InstancedMesh(heapGeo, snowMat, Math.max(1, heaps.length));
    heaps.forEach(([x, z, w, h, d, r], i) => { m4.compose(pv.set(x, -0.05, z), q.setFromAxisAngle(up, r), sc.set(w, h, d)); hm.setMatrixAt(i, m4); });
    hm.count = heaps.length; hm.receiveShadow = true; hm.computeBoundingSphere(); this.root.add(hm);
    // warm door pools on the snow (re-baked onto the terrain later)
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff9440, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const pm = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 6).rotateX(-Math.PI / 2), poolMat, Math.max(1, pools.length));
    pools.forEach(([x, z, r], i) => { m4.makeRotationY(r); m4.setPosition(x, 0.07, z); pm.setMatrixAt(i, m4); });
    pm.count = pools.length; pm.computeBoundingSphere(); this.root.add(pm); this.doorPools = pm;
    console.info(`[world] yard life: ${heaps.length} snow heaps, ${this.deco.length} deco kits queued (${nKits} yard items), ${nSnowmen} yard snowmen, ${pools.length} door pools`);
  }

  // instanced decoration kits + snowmen, placed on the snow terrain
  finalizeDeco() {
    const M = this.decoMats(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const kits = new Map();
    const kit = kind => {
      if (!kits.has(kind)) {
        const base = kind.replace(/\d$/, ''), seed = +(kind.match(/\d$/)?.[0] ?? 0);
        kits.set(kind, { geo: houseDecor(base, seed + (base === 'gifts' ? 2 : 0)), list: [] });
      }
      return kits.get(kind);
    };
    for (const d of this.deco) {
      if (this.q.name === 'low' && !['wreath'].includes(d.kind)) continue;
      kit(d.kind).list.push(d);
    }
    let draws = 0;
    for (const [kind, { geo, list }] of kits) {
      for (const [g, mat] of [[geo.lit, M.lit], [geo.glow, M.glow]]) {
        if (!g) continue;
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((d, i) => {
          // wall-mounted kits keep their height; ground kits sit in the snow
          const y = d.lift === 0 ? 0 : this.heightAt(d.x, d.z) + d.lift;
          m4.compose(pv.set(d.x, y, d.z), q.setFromAxisAngle(up, d.rot), sc.setScalar(d.s)); im.setMatrixAt(i, m4);
        });
        im.castShadow = mat === M.lit && kind !== 'wreath'; im.computeBoundingSphere(); this.root.add(im); draws++;
      }
    }
    // code-built snowmen (3 variants)
    const byV = [[], [], []]; for (const s of this.snowmen) byV[s[3]].push(s);
    byV.forEach((list, v) => {
      if (!list.length) return;
      const g = snowmanVariant(v);
      for (const [geo, mat] of [[g.snow, M.snow], [g.acc, M.acc]]) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([x, z, r, , s], i) => { m4.compose(pv.set(x, this.heightAt(x, z) - 0.06, z), q.setFromAxisAngle(up, r), sc.setScalar(s * 0.72)); im.setMatrixAt(i, m4); });
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.root.add(im); draws++;
      }
    });
    console.info(`[world] decorations: ${this.deco.length} kits in ${kits.size} types, ${this.snowmen.length} snowmen, ${draws} instanced draws`);
  }

  // -------------------------------------------------------------- forest
  makeForest() {
    const n = Math.round(W.forestTrees * this.q.forestScale);
    // Tripo pine GLB (instanced) on medium/high; light procedural pine on low
    const parts = this.pineParts();
    const insts = parts ? parts.map(({ geometry, material }) => new THREE.InstancedMesh(geometry, material, n))
      : [new THREE.InstancedMesh(pineGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), n)];
    const inst = { setMatrixAt: (i, m) => insts.forEach(x => x.setMatrixAt(i, m)) };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let c = 0, tries = 0;
    this.trees = [];
    const R = this.R;
    while (c < n && tries < n * 30) {
      tries++;
      let x, z;
      const mode = R();
      if (mode < 0.55) { const a = R() * Math.PI * 2; const r = W.radius - 14 + R() * 70; x = Math.cos(a) * r; z = Math.sin(a) * r; } // forest edge ring
      else if (mode < 0.72) { const a = R() * Math.PI * 2; const r = R.range(0, 1); x = W.lakeCenter[0] + Math.cos(a) * (W.lakeRadii[0] + 6 + r * 22); z = W.lakeCenter[1] + Math.sin(a) * (W.lakeRadii[1] + 6 + r * 22); } // around the lake
      else { const a = R() * Math.PI * 2; const r = R.range(W.squareRadius + 8, W.radius - 10); x = Math.cos(a) * r; z = Math.sin(a) * r; } // scattered
      const dr = this.distToRoad(x, z);
      if (dr < W.roadWidth / 2 + 2.5) continue;
      if (this.inLake(x, z, 2)) continue;
      if (Math.hypot(x, z) < W.squareRadius + 4) continue;
      if (this.buildingAt(x, z, 3)) continue;
      if (this.lamps.some(l => (l[0] - x) ** 2 + (l[1] - z) ** 2 < 9)) continue;
      const s = R.range(0.7, 1.45);
      p.set(x, 0, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28); sc.set(s, s * R.range(0.9, 1.15), s);
      m4.compose(p, q, sc); inst.setMatrixAt(c++, m4);
      if (Math.hypot(x, z) < W.radius + 2) this.addCircle(x, z, 0.55 * s);
      this.trees.push([x, z, s]);
    }
    for (const im of insts) { im.count = c; im.castShadow = this.q.name !== 'low'; im.receiveShadow = !!parts; im.computeBoundingSphere(); this.root.add(im); }
    this.forest = insts;
  }

  makeProps() {
    const R = this.R;
    for (let i = 0; i < 12; i++) {
      for (let t = 0; t < 40; t++) {
        const a = R() * 6.28, r = R.range(W.squareRadius + 4, W.radius - 20);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const d = this.distToRoad(x, z);
        if (d < W.roadWidth / 2 + 2 || d > W.roadWidth / 2 + 6 || this.buildingAt(x, z, 2) || this.inLake(x, z, 1)) continue;
        this.snowmen.push([x, z, R() * 6.28, i % 3, R.range(0.95, 1.2)]); this.addCircle(x, z, 0.75);
        break;
      }
    }
    // snowman family on the lake shore
    const lx = W.lakeCenter[0] + W.lakeRadii[0] + 3, lz = W.lakeCenter[1] + 6;
    this.snowmen.push([lx, lz, -1.2, 0, 1.15], [lx + 1.6, lz - 1.4, -1.0, 1, 0.8]);
    this.addCircle(lx, lz, 0.75); this.addCircle(lx + 1.6, lz - 1.4, 0.6);
  }

  // merge all static building meshes by material -> few draw calls
  mergeStatics() {
    const groups = new Map();
    this.root.updateMatrixWorld(true);
    for (const b of this.buildings) {
      if (b.isGLB) continue;
      const statics = [];
      b.holder.children[0].traverse(o => {
        if (!o.isMesh || o.userData.unique) return;
        let p = o.parent, skip = false; while (p) { if (p.userData.unique) skip = true; p = p.parent; }
        if (skip) return;
        statics.push(o);
      });
      for (const o of statics) {
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.clearGroups();
        g.applyMatrix4(o.matrixWorld);
        if (o.material.userData.worldUV) worldUV(g, o.material.userData.worldUV);
        const key = o.material.uuid;
        if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
        groups.get(key).geos.push(g);
        o.parent.remove(o);
      }
    }
    for (const { mat, geos } of groups.values()) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m); this.staticMeshes.push(m);
    }
  }

  // -------------------------------------------------------------- collision
  addCircle(x, z, r) { this.colliders.push({ kind: 'c', x, z, r }); }
  addBox(x, z, hw, hd, rot, h = 3, building = null) { this.colliders.push({ kind: 'b', x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), h, building }); }
  indexCollider(c) {
    const ext = c.kind === 'c' ? c.r : Math.hypot(c.hw, c.hd);
    const x0 = Math.floor((c.x - ext) / this.cell), x1 = Math.floor((c.x + ext) / this.cell);
    const z0 = Math.floor((c.z - ext) / this.cell), z1 = Math.floor((c.z + ext) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 10007 + j; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(c);
    }
  }
  query(x, z) { return this.grid.get(Math.floor(x / this.cell) * 10007 + Math.floor(z / this.cell)) || []; }
  buildingAt(x, z, margin = 0) {
    for (const b of this.buildings) {
      const dx = x - b.x, dz = z - b.z; const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.footprint[0] / 2 + margin && Math.abs(lz) < b.footprint[1] / 2 + margin) return b;
    }
    return null;
  }

  /** push a circle (x,z,r) out of colliders; returns corrected {x,z} */
  collide(pos, r) {
    for (let it = 0; it < 2; it++) {
      const list = this.query(pos.x, pos.z);
      for (const c of list) {
        if (c.kind === 'c') {
          const dx = pos.x - c.x, dz = pos.z - c.z; const d = Math.hypot(dx, dz); const m = c.r + r;
          if (d < m && d > 1e-5) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; }
        } else {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          // local frame: x' = dx*c - dz*s, z' = dx*s + dz*c   (rotation.y = rot)
          const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
          const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
          let ex = lx - cx, ez = lz - cz; let d = Math.hypot(ex, ez);
          if (d < r) {
            let nx, nz, push;
            if (d > 1e-5) { nx = ex / d; nz = ez / d; push = r - d; }
            else { // inside: push along smallest penetration
              const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
              if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
            }
            const nlx = lx + nx * push, nlz = lz + nz * push;
            pos.x = c.x + nlx * c.c + nlz * c.s; pos.z = c.z - nlx * c.s + nlz * c.c;
          }
        }
      }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > W.radius) { pos.x *= W.radius / d; pos.z *= W.radius / d; }
    return pos;
  }

  /** is a point inside any building box (for camera) */
  blocksCamera(x, y, z) {
    for (const c of this.query(x, z)) {
      if (c.kind === 'c') { if (c.r >= 0.6 && y < 9 && Math.hypot(x - c.x, z - c.z) < c.r + 0.5) return true; continue; }
      if (c.kind !== 'b' || y > c.h) continue;
      const dx = x - c.x, dz = z - c.z; const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
      if (Math.abs(lx) < c.hw + 0.3 && Math.abs(lz) < c.hd + 0.3) return true;
    }
    return false;
  }

  randomRoadPoint(R = Math.random, minR = 30, maxR = W.radius) {
    for (let t = 0; t < 200; t++) {
      const road = this.roads[Math.floor(R() * this.roads.length)];
      const p = road.pts[Math.floor(R() * road.pts.length)];
      const d = Math.hypot(p.x, p.z);
      if (d >= minR && d <= maxR) return { x: p.x, z: p.z, tx: p.tx, tz: p.tz };
    }
    return { x: 0, z: 30, tx: 1, tz: 0 };
  }

  update(dt, t) {
    this.sky.material.uniforms.uTime.value = t;
    for (const a of this.animated) a.rotation.z += dt * (a.userData.spin || 0.5);
    if (this.tree?.userData.star) this.tree.userData.star.rotation.y = t * 0.6;
    for (const w of this.walkers) {
      if (w.orbit) {
        const o = w.orbit; o.a += dt * o.speed;
        const g = w.rd.group; g.position.set(Math.cos(o.a) * o.r, 0, Math.sin(o.a) * o.r);
        g.rotation.y = -o.a; // tangent direction
        w.rd.update(dt, o.speed * o.r / 1.3); // ~1.3 m/s = clip's natural walk pace
      } else w.rd.update(dt, 0);
    }
  }
}

function obbOverlap(a, b) {
  const axes = [];
  for (const o of [a, b]) { const c = Math.cos(o.rot), s = Math.sin(o.rot); axes.push([c, -s], [s, c]); }
  const corners = o => { const c = Math.cos(o.rot), s = Math.sin(o.rot); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [o.x + u * o.hw * c + v * o.hd * s, o.z - u * o.hw * s + v * o.hd * c]); };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let amin = 1e9, amax = -1e9, bmin = 1e9, bmax = -1e9;
    for (const [x, z] of ca) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}
