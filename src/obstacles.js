// Stage obstacles: picket fences (jump), closed-road barriers (detour), snowplows, rolling snowballs,
// Gossip-latency lag zones, wind gusts, grinch bots, chimney-drop houses and the finale boss.
// planStage() is pure data (seeded, deterministic) so the route check can prove a stage is beatable before it
// is built; Obstacles builds light meshes (merged / instanced: 1-2 draw calls per obstacle type) and runs them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG, difficulty } from './config.js?v=3c3cf266';
import { rng, lerp, clamp, textTexture, glowTexture } from './util.js?v=3c3cf266';
import { MANIFEST, bakedMeshes } from './assets.js?v=3c3cf266';
import { planRoute } from './routegraph.js?v=3c3cf266';

const TAU = Math.PI * 2;
const hyp = Math.hypot;

// ---------------------------------------------------------------- planning
function junctionDistances(world) { // per road point: distance to the nearest point of another street (cached)
  if (world._jd) return world._jd;
  const all = []; world.roads.forEach((r, ri) => r.pts.forEach(p => all.push([p.x, p.z, ri])));
  const cell = 12, grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const a of all) { const k = key(Math.floor(a[0] / cell), Math.floor(a[1] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(a); }
  world._jd = world.roads.map((r, ri) => r.pts.map(p => {
    let best = 99; const ci = Math.floor(p.x / cell), cj = Math.floor(p.z / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const a of grid.get(key(ci + di, cj + dj)) || []) {
      if (a[2] === ri) continue; const d = hyp(a[0] - p.x, a[1] - p.z); if (d < best) best = d;
    }
    return Math.min(best, hyp(p.x, p.z) - CONFIG.world.squareRadius); // the square counts as a junction
  }));
  return world._jd;
}

/** Deterministic stage layout (targets + obstacle positions). */
export function planStage(world, graph, idx, spawn) {
  const L = CONFIG.levels[idx], D = difficulty(), O = CONFIG.obstacles, ob = L.obs || {}, W = CONFIG.world;
  const R = rng(W.seed * 7 + idx * 131);
  const rMin = L.areaMin ?? 20, rMax = L.areaRadius;
  // --- validator houses inside the stage ring, spread out (validator-house type first)
  const cands = world.buildings.filter(b => {
    const d = hyp(b.x, b.z);
    return d < rMax && d > rMin && !world.inLake(b.trigger.x, b.trigger.z, 1) && !world.buildingAt(b.trigger.x, b.trigger.z, 0.3);
  });
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  cands.sort((a, b) => (b.type === 'validatorHouse') - (a.type === 'validatorHouse'));
  const picked = [];
  for (let minD = 26; picked.length < L.validators && minD >= 0; minD -= 6)
    for (const b of cands) {
      if (picked.length >= L.validators) break;
      if (picked.includes(b)) continue;
      if (picked.every(p => hyp(p.x - b.x, p.z - b.z) >= minD)) picked.push(b);
    }
  const nSlow = Math.round(L.slowNodes * D.slowNodeMult);
  const slowSet = new Set(picked.filter(b => b.type !== 'validatorHouse').slice(0, nSlow));
  while (slowSet.size < Math.min(nSlow, picked.length)) slowSet.add(picked[slowSet.size]);
  const chim = new Set();
  if (ob.chimneys) for (const b of [...picked].sort((a, b) => !!b.chimney - !!a.chimney)) { if (chim.size >= ob.chimneys) break; if (!slowSet.has(b)) chim.add(b); }
  const targets = picked.map(b => ({ b, slow: slowSet.has(b), chimney: chim.has(b) }));
  const doors = targets.map(t => t.b.trigger);

  // --- obstacle placement helpers
  const jd = junctionDistances(world), roads = world.roads;
  const inZone = (x, z, pad = 8) => { const d = hyp(x, z); return d > Math.max(W.squareRadius + 5, rMin - 14) && d < rMax + pad; };
  const far = (list, x, z, d) => list.every(p => hyp(p.x - x, p.z - z) >= d);
  const pick = (n, test, tries = 600) => {
    const out = [];
    for (let t = 0; t < tries && out.length < n; t++) {
      const ri = Math.floor(R() * roads.length), road = roads[ri], i = 2 + Math.floor(R() * Math.max(1, road.pts.length - 4)), p = road.pts[i];
      if (!p || !inZone(p.x, p.z) || world.inLake(p.x, p.z, 2)) continue;
      const s = { x: p.x, z: p.z, tx: p.tx, tz: p.tz, ri, i, kind: road.kind, jd: jd[ri][i] };
      if (test(s, out)) out.push(s);
    }
    return out;
  };
  const avoidMains = !!ob.snowballs;
  const plan = { idx, targets, ice: [], fences: [], barriers: [], lag: [], plows: [], snowballs: [], grinch: [], boss: null, wind: !!ob.wind };

  // closed roads first: everything else must keep every house reachable
  if (ob.barriers) {
    const doorNode = doors.map(d => graph.nearest(d.x, d.z).dist);
    for (let t = 0; t < 400 && plan.barriers.length < ob.barriers; t++) {
      const [s] = pick(1, s => s.kind !== 'lane' && !(avoidMains && s.kind === 'main') && s.jd > 12 && far(doors, s.x, s.z, 14) && hyp(s.x - spawn.x, s.z - spawn.z) > 22 && far(plan.barriers, s.x, s.z, 30), 20);
      const dbg = plan.dbg ||= { nos: 0, route: 0, door: 0 };
      if (!s) { dbg.nos++; continue; }
      const blocked = graph.blockMask([...plan.barriers, s], O.barrier.block);
      const route = planRoute(graph, spawn, doors.map(d => ({ x: d.x, z: d.z })), { blocked, speed: 10 });
      if (!route.ok) { dbg.route++; continue; }
      // a door must still sit next to an open street node (not only behind the barrier)
      if (doors.some((d, k) => graph.nearest(d.x, d.z, blocked).dist > doorNode[k] + 3)) { dbg.door++; continue; }
      plan.barriers.push(s);
    }
  }
  if (ob.fences) plan.fences = pick(ob.fences, (s, out) => s.kind !== 'lane' && !(avoidMains && s.kind === 'main') && s.jd > 9 && far(doors, s.x, s.z, 9)
    && hyp(s.x - spawn.x, s.z - spawn.z) > 14 && far(out, s.x, s.z, O.fence.minGap) && far(plan.barriers, s.x, s.z, 14));
  if (ob.lag) plan.lag = pick(ob.lag, (s, out) => far(out, s.x, s.z, 22) && hyp(s.x - spawn.x, s.z - spawn.z) > 14 && far(plan.barriers, s.x, s.z, 10))
    .map(s => ({ ...s, r: O.lag.radius }));
  if (ob.plows) {
    const used = new Set();
    for (let t = 0; t < 200 && plan.plows.length < ob.plows; t++) {
      const [s] = pick(1, s => (s.kind === 'ring' || s.kind === 'cross' || (!avoidMains && s.kind === 'main')) && !used.has(s.ri) && hyp(s.x - spawn.x, s.z - spawn.z) > 30, 30);
      if (!s) continue;
      const road = roads[s.ri], n = road.pts.length;
      // patrol section: between the fences / barriers on that street (never drives through them)
      const stops = [...plan.fences, ...plan.barriers].filter(o => o.ri === s.ri).map(o => o.i);
      let a = 1, b = n - 2, loop = road.closed && !stops.length;
      if (stops.length) {
        if (road.closed) { // unwrap: nearest stop behind and ahead of s.i
          const rel = stops.map(i => ((i - s.i) % n + n) % n).sort((x, y) => x - y);
          a = s.i - (n - rel[rel.length - 1]) + 4; b = s.i + rel[0] - 4;
        } else { a = Math.max(1, ...stops.filter(i => i < s.i).map(i => i + 4)); b = Math.min(n - 2, ...stops.filter(i => i > s.i).map(i => i - 4)); }
      }
      if (!loop && b - a < 18) continue;
      used.add(s.ri);
      plan.plows.push({ ri: s.ri, s: s.i, a, b, loop, dir: R() < 0.5 ? 1 : -1 });
    }
  }
  if (ob.snowballs) {
    const mains = roads.map((r, ri) => ri).filter(ri => roads[ri].kind === 'main');
    for (let k = 0; k < ob.snowballs; k++) plan.snowballs.push({ ri: mains[k % mains.length], delay: k * 1.7 + R() * 2 });
  }
  if (ob.grinch) plan.grinch = pick(ob.grinch, (s, out) => hyp(s.x - spawn.x, s.z - spawn.z) > 38 && far(out, s.x, s.z, 30) && far(plan.barriers, s.x, s.z, 10));
  if (ob.boss) { const a = Math.atan2(spawn.z, spawn.x) + Math.PI; plan.boss = { x: Math.cos(a) * 56, z: Math.sin(a) * 56 }; }
  // ice patches on the streets (as before)
  const nIce = Math.round((L.iceCount || 0) * (0.6 + 0.4 * D.iceSlipMult));
  for (let i = 0; i < nIce; i++) {
    const p = world.randomRoadPoint(R, 28, rMax + 10);
    plan.ice.push({ x: p.x, z: p.z, r: lerp(O.ice.minRadius, O.ice.maxRadius, R()) });
  }
  plan.R = R; // the caller continues with the same stream (power-ups)
  return plan;
}

/** Street-only time estimate for a plan (seconds) + slack vs the clock. */
export function routeCheck(graph, plan, spawn) {
  const L = CONFIG.levels[plan.idx], D = difficulty(), C = CONFIG.delivery, O = CONFIG.obstacles, P = CONFIG.player;
  const blocked = plan.barriers.length ? graph.blockMask(plan.barriers, O.barrier.block) : null;
  const cost = plan.lag.length ? graph.costMask(plan.lag, 1 / O.lag.speedMult) : null;
  const inLag = (x, z) => plan.lag.some(l => hyp(l.x - x, l.z - z) < l.r);
  const tg = plan.targets.map(t => {
    let hold = C.holdTime * D.holdMult * (t.slow ? C.slowNodeHoldMult * D.slowNodeMult : 1);
    if (inLag(t.b.trigger.x, t.b.trigger.z)) hold *= O.lag.holdMult;
    if (t.chimney) hold = 0.7;
    return { x: t.b.trigger.x, z: t.b.trigger.z, hold: hold + C.gossipFlightTime * 0.5 };
  });
  const speed = P.sprintSpeed * D.speedMult * 0.85;
  const r = planRoute(graph, spawn, tg, { blocked, cost, speed });
  const timer = L.timer * D.timerMult, n = tg.length;
  // tightest moment: the k-th delivery needs elapsed <= timer + bonus * (k-1)
  let worst = Infinity;
  r.splits.forEach((s, k) => { worst = Math.min(worst, (timer + C.timerBonus * k) / s); });
  return { stage: plan.idx + 1, name: L.name, ok: r.ok && worst >= 1.25, reachable: r.ok, unreachable: r.unreachable.length, houses: n, timer: +timer.toFixed(1),
    est: +r.est.toFixed(1), dist: Math.round(r.dist), slack: +((timer + C.timerBonus * (n - 1)) / r.est).toFixed(2), worstSlack: +worst.toFixed(2),
    barriers: plan.barriers.length, fences: plan.fences.length, lag: plan.lag.length, plows: plan.plows.length, grinch: plan.grinch.length };
}

// ---------------------------------------------------------------- meshes
const colorize = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const box = (w, h, d, hex, x = 0, y = 0, z = 0, ry = 0, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); return colorize(g, hex); };
const strip = g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
const merge = list => mergeGeometries(list.map(g => strip(g.index ? g.toNonIndexed() : g)));

function plowGeometry() {
  const P = [];
  P.push(box(2.2, 0.9, 3.6, 0xe8781c, 0, 0.85, -0.1));            // chassis
  P.push(box(1.9, 1.25, 1.6, 0xf08a1c, 0, 1.95, -0.85));          // cab
  P.push(box(1.95, 0.6, 1.2, 0x1d2b45, 0, 2.15, -0.75));          // windows band
  P.push(box(2.0, 0.12, 1.7, 0xf4f8ff, 0, 2.63, -0.85));          // snow on the roof
  P.push(box(3.1, 0.95, 0.22, 0xd8dde6, 0, 0.62, 2.0, 0, -0.25));  // blade
  for (let i = 0; i < 5; i++) P.push(box(0.32, 0.9, 0.05, i % 2 ? 0x222222 : 0xffc21a, -1.2 + i * 0.6, 0.64, 2.14, 0, -0.25)); // hazard stripes
  P.push(box(3.1, 0.5, 0.6, 0xf4f8ff, 0, 0.35, 2.45));            // snow pushed by the blade
  for (const [x, z] of [[-1.1, 1.0], [1.1, 1.0], [-1.1, -1.3], [1.1, -1.3]]) {
    const w = new THREE.CylinderGeometry(0.48, 0.48, 0.36, 12); w.rotateZ(Math.PI / 2); w.translate(x, 0.48, z); P.push(colorize(w, 0x1a1a1a));
  }
  return merge(P);
}
function grinchGeometry() {
  const P = [];
  const body = new THREE.CapsuleGeometry(0.42, 0.6, 4, 10); body.translate(0, 0.85, 0); P.push(colorize(body, 0x3fae3a));
  const head = new THREE.SphereGeometry(0.4, 12, 9); head.translate(0, 1.62, 0.02); P.push(colorize(head, 0x58c94a));
  const belly = new THREE.SphereGeometry(0.3, 10, 8); belly.scale(1, 1.1, 0.5); belly.translate(0, 0.85, 0.28); P.push(colorize(belly, 0x8fe07a));
  for (const s of [-1, 1]) { const e = new THREE.ConeGeometry(0.12, 0.42, 6); e.rotateZ(-s * 1.1); e.translate(s * 0.42, 1.78, 0); P.push(colorize(e, 0x3fae3a)); }
  const ant = new THREE.CylinderGeometry(0.025, 0.025, 0.4, 5); ant.translate(0, 2.15, 0); P.push(colorize(ant, 0x222222));
  const sack = new THREE.SphereGeometry(0.34, 10, 8); sack.translate(0, 1.0, -0.45); P.push(colorize(sack, 0x7a4a26)); // the stolen-gifts sack
  for (const s of [-1, 1]) { const l = new THREE.CylinderGeometry(0.11, 0.13, 0.42, 7); l.translate(s * 0.2, 0.2, 0); P.push(colorize(l, 0x2a7a28)); }
  const mouth = box(0.3, 0.05, 0.05, 0x14301a, 0, 1.47, 0.39); P.push(mouth);
  return merge(P);
}
function grinchEyes() {
  const P = [];
  for (const s of [-1, 1]) { const e = new THREE.SphereGeometry(0.075, 8, 6); e.translate(s * 0.15, 1.68, 0.36); P.push(colorize(e, 0xffffff)); }
  const tip = new THREE.SphereGeometry(0.06, 6, 5); tip.translate(0, 2.37, 0); P.push(colorize(tip, 0xffffff));
  return merge(P);
}
let _barrierTex = null;
function barrierTexture() {
  if (_barrierTex) return _barrierTex;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const g = cv.getContext('2d');
  // top half: red/white chevrons · next quarter: painted ROAD CLOSED board · last quarter: wood
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#d42a2a'; for (let x = -256; x < 512; x += 64) { g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 32, 256); g.lineTo(x + 32 + 256, 0); g.lineTo(x + 256, 0); g.fill(); }
  const wood = g.createLinearGradient(0, 384, 0, 512); wood.addColorStop(0, '#8a5a32'); wood.addColorStop(1, '#6b4224'); g.fillStyle = wood; g.fillRect(0, 384, 512, 128);
  g.strokeStyle = 'rgba(40,20,8,.35)'; g.lineWidth = 2; for (let y = 392; y < 512; y += 11) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + 4, 340, y - 4, 512, y + 2); g.stroke(); }
  g.fillStyle = '#f2e6c8'; g.fillRect(0, 256, 512, 128); g.strokeStyle = '#7a1414'; g.lineWidth = 10; g.strokeRect(8, 264, 496, 112);
  g.fillStyle = '#b81d1d'; g.font = "700 64px Georgia, 'Times New Roman', serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ROAD CLOSED', 256, 322);
  _barrierTex = new THREE.CanvasTexture(cv); _barrierTex.colorSpace = THREE.SRGBColorSpace; _barrierTex.anisotropy = 4;
  return _barrierTex;
}
const atlasBox = (w, h, d, v0, v1, x, y, z) => { // box whose faces all sample atlas rows v0..v1
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i));
  g.translate(x, y, z); return g;
};
// canvas y=0 is the TOP of the texture -> uv v = 1 - y/512 (flipY)
const ROW = { stripes: [0.5, 1.0], sign: [0.25, 0.5], wood: [0.0, 0.25] };

function lagMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uT;
      void main(){ vec2 p = vUv*2.0-1.0; float r = length(p); if (r > 1.0) discard;
        float rings = smoothstep(0.86, 1.0, fract(r*3.0 - uT*0.9));            // packets crawling outward (slowly: latency)
        float edge = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float a = atan(p.y, p.x); float dash = step(0.5, fract(a*6.0/6.2831853*4.0 + uT*0.25));
        float k = 0.10 + rings*0.30*(1.0-r) + edge*(0.55 + 0.35*dash);
        gl_FragColor = vec4(vec3(1.0, 0.28, 0.12)*k*1.6, k); }`,
  });
}

// ---------------------------------------------------------------- runtime
export class Obstacles {
  constructor(scene, world, { low = false, onHit = () => {}, onEvent = () => {} } = {}) {
    this.scene = scene; this.world = world; this.low = low; this.onHit = onHit; this.onEvent = onEvent;
    this.objs = []; this.plows = []; this.balls = []; this.bots = []; this.lag = []; this.fences = []; this.barriers = [];
    this.boss = null; this.wind = null; this.gust = { x: 0, z: 0, k: 0, warn: 0 };
    world.dyn = world.dyn || [];
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler();
  }
  add(o) { this.scene.add(o); this.objs.push(o); return o; }
  clear() {
    for (const o of this.objs) { o.parent?.remove(o); o.traverse(m => { m.geometry?.dispose(); for (const x of [].concat(m.material || [])) { if (x.map && x.map !== _barrierTex && !x.userData.sharedMaps) x.map.dispose(); x.dispose(); } }); }
    this.objs = []; this.plows = []; this.balls = []; this.bots = []; this.lag = []; this.fences = []; this.barriers = [];
    this.boss = null; this.wind = null; this.gust = { x: 0, z: 0, k: 0, warn: 0 }; this.world.dyn.length = 0; this.lagMat = null; this.lampMat = null; this.beaconMat = null;
    this.plowMesh = null; this.plowParts = null; this.plowBeacon = null; this.plowGlow = null; this.plowHalo = null; this.plowPools = null;
  }
  surf(x, z) { return this.world.surfaceAt(x, z).y; }

  build(plan) {
    this.clear();
    const O = CONFIG.obstacles, rw = CONFIG.world.roadWidth, W = this.world, shadow = !this.low;
    // ---- fences: red/white pickets + rails + snow caps, one merged mesh; colliders low enough to jump
    if (plan.fences.length) {
      const P = [];
      for (const f of plan.fences) {
        const hw = rw / 2 + O.fence.overhang, nx = f.tz, nz = -f.tx, n = Math.round(hw * 2 / 0.32);
        const yAt = (u) => this.surf(f.x + nx * u, f.z + nz * u);
        for (let k = 0; k <= n; k++) {
          const u = -hw + k * (hw * 2 / n), y = yAt(u), post = k % 6 === 0;
          const g = new THREE.BoxGeometry(post ? 0.14 : 0.09, post ? 1.08 : 0.92, post ? 0.14 : 0.045);
          const tip = new THREE.ConeGeometry(post ? 0.1 : 0.065, 0.14, 4); tip.rotateY(Math.PI / 4); tip.translate(0, post ? 0.6 : 0.53, 0);
          for (const q of [g, tip]) { q.translate(0, (post ? 0.54 : 0.46), 0); q.rotateY(Math.atan2(f.tx, f.tz)); q.translate(f.x + nx * u, y, f.z + nz * u); P.push(colorize(q, post ? 0x8a5a32 : (k % 2 ? 0xd42a2a : 0xf5f1e8))); }
        }
        const rot = Math.atan2(f.tx, f.tz); // rotateY(rot): local x -> road normal, local z -> road tangent
        for (const ry of [0.3, 0.72]) for (let k = 0; k < 6; k++) { // rails follow the ground in short pieces
          const u0 = -hw + k * hw / 3, um = u0 + hw / 6, y = (yAt(u0) + yAt(u0 + hw / 3)) / 2;
          const g = new THREE.BoxGeometry(hw / 3 + 0.02, 0.07, 0.05); g.translate(0, ry, 0.04); g.rotateY(rot); g.translate(f.x + nx * um, y, f.z + nz * um);
          P.push(colorize(g, 0x8a5a32));
          const sn = new THREE.BoxGeometry(hw / 3 + 0.02, 0.05, 0.11); sn.translate(0, ry + 0.06, 0.04); sn.rotateY(rot); sn.translate(f.x + nx * um, y, f.z + nz * um);
          P.push(colorize(sn, 0xf6faff)); // snow on the rails
        }
        const c = { kind: 'b', x: f.x, z: f.z, hw, hd: 0.14, c: f.tz, s: f.tx, h: O.fence.h, dyn: 'fence' };
        W.dyn.push(c); this.fences.push(f);
      }
      const m = new THREE.Mesh(merge(P), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
      m.castShadow = shadow; m.receiveShadow = true; m.name = 'fences'; this.add(m);
    }
    // ---- closed-road barriers: striped boards on wooden A-frames + a painted ROAD CLOSED board + blinking lamps
    if (plan.barriers.length) {
      const P = [], L = [];
      for (const b of plan.barriers) {
        const hw = rw / 2 + O.barrier.overhang, y0 = this.surf(b.x, b.z);
        const parts = [atlasBox(hw * 2, 0.36, 0.08, ...ROW.stripes, 0, 0.95, 0), atlasBox(hw * 2, 0.36, 0.08, ...ROW.stripes, 0, 1.55, 0), atlasBox(2.8, 0.75, 0.1, ...ROW.sign, 0, 2.35, 0.02)];
        for (let k = 0; k <= 4; k++) { const x = -hw + 0.3 + k * (hw * 2 - 0.6) / 4; for (const s of [-1, 1]) { const leg = atlasBox(0.12, 2.0, 0.12, ...ROW.wood, 0, 0, 0); leg.rotateX(s * 0.22); leg.translate(x, 0.95, s * 0.2); parts.push(leg); } }
        const lamps = [0, 2, 4].map(k => new THREE.SphereGeometry(0.11, 8, 6).translate(-hw + 0.3 + k * (hw * 2 - 0.6) / 4, 1.85, 0));
        // rotateY(rot) maps local x -> (cos rot, -sin rot) = (tz, -tx) = road normal: exactly the collider frame
        const rot = Math.atan2(b.tx, b.tz);
        for (const g of [...parts, ...lamps]) g.rotateY(rot).translate(b.x, y0, b.z);
        L.push(...lamps);
        P.push(...parts);
        W.dyn.push({ kind: 'b', x: b.x, z: b.z, hw, hd: 0.35, c: b.tz, s: b.tx, h: 3.0, dyn: 'barrier' });
        this.barriers.push(b);
      }
      const m = new THREE.Mesh(mergeGeometries(P.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; })),
        new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.7 }));
      m.castShadow = shadow; m.receiveShadow = true; m.name = 'barriers'; this.add(m);
      this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.1).multiplyScalar(2.5), toneMapped: false });
      const lm = new THREE.Mesh(mergeGeometries(L.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; })), this.lampMat);
      lm.name = 'barrierLamps'; this.add(lm);
    }
    // ---- lag zones: one merged disc mesh (shader) + a floating label each
    if (plan.lag.length) {
      const P = [];
      for (const z of plan.lag) { const g = new THREE.PlaneGeometry(z.r * 2, z.r * 2, 1, 1); g.rotateX(-Math.PI / 2); g.translate(z.x, this.surf(z.x, z.z) + 0.16, z.z); P.push(g); this.lag.push(z); }
      this.lagMat = lagMaterial();
      const m = new THREE.Mesh(mergeGeometries(P), this.lagMat); m.renderOrder = 1; m.name = 'lagZones'; this.add(m);
      const tex = textTexture('LAG +300 ms', { w: 512, h: 128, bg: 'rgba(48,8,4,0.78)', fg: '#ffb39a', border: '#ff5a3a', glow: '#ff5a3a', font: 'bold 64px system-ui, sans-serif' });
      for (const z of plan.lag) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); sp.scale.set(3.6, 0.9, 1); sp.position.set(z.x, this.surf(z.x, z.z) + 2.6, z.z); this.add(sp); }
    }
    // ---- snowplows: Tripo GLB (instanced, LOD1 on LOW) or procedural fallback, + blinking beacon, headlight glows
    if (plan.plows.length) {
      const n = plan.plows.length, E = MANIFEST.props.snowplow;
      const parts = E && bakedMeshes(E, { lod: this.low ? 1 : 0 });
      let beaconAt = [0, 2.8, -0.85], heads = [[-0.75, 0.95, 1.95], [0.75, 0.95, 1.95]];
      if (parts && parts.length) {
        this.plowParts = parts.map(({ geometry, material }) => {
          geometry.translate(0, 0, E.zOffset || 0);
          const m = material.clone(); m.userData.sharedMaps = true; // textures belong to the GLB cache
          if (m.emissiveMap) { m.emissive.setRGB(1, 0.86, 0.62); m.emissiveIntensity = 2.2; }
          const im = new THREE.InstancedMesh(geometry, m, n);
          im.castShadow = shadow; im.receiveShadow = !this.low; im.name = 'plows'; im.frustumCulled = false; return this.add(im);
        });
        beaconAt = E.beacon; heads = E.headlights;
      } else {
        const body = new THREE.InstancedMesh(plowGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }), n);
        body.castShadow = shadow; body.name = 'plows'; body.frustumCulled = false; this.add(body);
        this.plowParts = [body];
      }
      this.plowMesh = this.plowParts[0];
      const glb = !!(parts && parts.length);
      const bg = glb ? new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10);
      bg.translate(beaconAt[0], beaconAt[1] - (glb ? 0.06 : 0), beaconAt[2]);
      this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.05).multiplyScalar(3), toneMapped: false });
      const bea = new THREE.InstancedMesh(bg, this.beaconMat, n); bea.frustumCulled = false; this.add(bea);
      this.plowBeacon = bea;
      // glow sprites: small blinking beacon halo + 2 headlight flares per plow (Points, positions/colours set per frame)
      this.plowGlowLocal = [beaconAt, ...heads].map(a => new THREE.Vector3(...a).add(new THREE.Vector3(0, 0, 0.12)));
      const pts = (count, size) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const m = new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
        m.userData.sharedMaps = true;
        const o = this.add(new THREE.Points(g, m)); o.frustumCulled = false; o.renderOrder = 2; return o;
      };
      this.plowHalo = pts(n, 1.3); this.plowGlow = pts(n * 2, 2.4);
      // headlight pools on the snow ahead of each plow
      const pg = new THREE.PlaneGeometry(4.2, 7.5).rotateX(-Math.PI / 2); pg.translate(0, 0.06, 2.9 + 3.6);
      const pm = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
      pm.userData.sharedMaps = true;
      this.plowPools = this.add(new THREE.InstancedMesh(pg, pm, n)); this.plowPools.frustumCulled = false;
      for (const p of plan.plows) this.plows.push({ ...p, road: W.roads[p.ri], s: p.s, x: 0, z: 0, yaw: 0, honkT: 0 });
    }
    // ---- rolling snowballs (instanced spheres)
    if (plan.snowballs.length) {
      const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, this.low ? 1 : 2), new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.95, flatShading: this.low }), plan.snowballs.length);
      m.castShadow = shadow; m.frustumCulled = false; m.name = 'snowballs'; this.add(m); this.ballMesh = m;
      for (const b of plan.snowballs) this.balls.push({ ...b, road: W.roads[b.ri], s: -1, wait: b.delay, rot: new THREE.Quaternion(), x: 0, z: 0, y: -50, r: 0.6 });
    }
    // ---- grinch bots (+ boss)
    const nb = plan.grinch.length;
    if (nb) {
      const body = new THREE.InstancedMesh(grinchGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), nb);
      const eyes = new THREE.InstancedMesh(grinchEyes(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.2, 0.15), toneMapped: false }), nb);
      body.castShadow = shadow; body.frustumCulled = eyes.frustumCulled = false; body.name = 'grinch'; this.add(body); this.add(eyes);
      this.botMesh = body; this.botEyes = eyes;
      for (const s of plan.grinch) this.bots.push({ hx: s.x, hz: s.z, x: s.x, z: s.z, yaw: 0, state: 'idle', rest: 0, ph: Math.random() * 9, wa: Math.random() * TAU });
    }
    if (plan.boss) {
      const g = new THREE.Group(); g.name = 'boss';
      const body = new THREE.Mesh(grinchGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, color: 0xbfe0b0 }));
      const eyes = new THREE.Mesh(grinchEyes(), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.1), toneMapped: false }));
      const crown = []; for (let k = 0; k < 5; k++) { const c = new THREE.ConeGeometry(0.09, 0.3, 4); c.translate(Math.cos(k / 5 * TAU) * 0.26, 2.05, Math.sin(k / 5 * TAU) * 0.26); crown.push(colorize(c, 0xffc83a)); }
      const band = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12, 1, true); band.translate(0, 1.9, 0); crown.push(colorize(band, 0xffb21a));
      const cm = new THREE.Mesh(merge(crown), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.3, emissive: 0x331d00 }));
      g.add(body, eyes, cm); g.scale.setScalar(2.4); body.castShadow = shadow;
      g.position.set(plan.boss.x, this.surf(plan.boss.x, plan.boss.z), plan.boss.z); this.add(g);
      const wave = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      wave.visible = false; wave.renderOrder = 2; this.add(wave);
      this.boss = { g, x: plan.boss.x, z: plan.boss.z, yaw: 0, awake: false, slamT: CONFIG.obstacles.boss.slamEvery, tele: 0, wave, waveT: -1, wx: 0, wz: 0, rest: 0, roared: false };
    }
    if (plan.wind) { const Wd = O.wind; this.wind = { next: lerp(Wd.every[0], Wd.every[1], Math.random()) + 4, phase: 'idle', t: 0 }; }
  }

  /** speed multiplier for the player at (x,z) */
  speedMult(x, z, mump) { if (mump) return 1; for (const l of this.lag) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.r * l.r) return CONFIG.obstacles.lag.speedMult; return 1; }
  holdMult(x, z, mump) { if (mump) return 1; for (const l of this.lag) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.r * l.r) return CONFIG.obstacles.lag.holdMult; return 1; }
  inLag(x, z) { return this.speedMult(x, z, false) < 1; }

  /** ctx {player:{pos, jy, air}, t, levelTime, playing} -> wind push vector in this.gust */
  update(dt, ctx) {
    const O = CONFIG.obstacles, p = ctx.player.pos, jy = ctx.player.jy, playing = ctx.playing, t = ctx.t;
    const m4 = this._m4, q = this._q, v = this._v, sc = this._s;
    if (this.lagMat) this.lagMat.uniforms.uT.value = t;
    if (this.lampMat) this.lampMat.color.setRGB(1, 0.55, 0.1).multiplyScalar(Math.sin(t * 6) > 0 ? 2.6 : 0.25);
    if (this.beaconMat) this.beaconMat.color.setRGB(1, 0.6, 0.05).multiplyScalar(Math.sin(t * 9) > 0 ? 3 : 0.3);
    // --- plows
    for (let i = 0; i < this.plows.length; i++) {
      const P = this.plows[i], pts = P.road.pts, n = pts.length;
      if (playing) {
        P.s += P.dir * O.plow.speed * dt / 1.5;
        if (P.loop) P.s = (P.s + n) % n;
        else if (P.s > P.b) { P.s = P.b; P.dir = -1; } else if (P.s < P.a) { P.s = P.a; P.dir = 1; }
      }
      const i0 = Math.floor(P.s), f = P.s - i0, A = pts[((i0 % n) + n) % n], B = pts[(((i0 + 1) % n) + n) % n];
      P.x = lerp(A.x, B.x, f); P.z = lerp(A.z, B.z, f);
      const want = Math.atan2(A.tx * P.dir, A.tz * P.dir); P.yaw = P.yaw + Math.atan2(Math.sin(want - P.yaw), Math.cos(want - P.yaw)) * (1 - Math.exp(-6 * dt));
      const y = this.surf(P.x, P.z);
      q.setFromAxisAngle(v.set(0, 1, 0), P.yaw); m4.compose(v.set(P.x, y, P.z), q, sc.set(1, 1, 1));
      for (const im of this.plowParts) im.setMatrixAt(i, m4);
      this.plowBeacon.setMatrixAt(i, m4); this.plowPools.setMatrixAt(i, m4);
      { const on = Math.sin(t * 9) > 0 ? 0.8 : 0.06, hp = this.plowHalo.geometry.attributes, gp = this.plowGlow.geometry.attributes;
        v.copy(this.plowGlowLocal[0]).applyMatrix4(m4); hp.position.setXYZ(i, v.x, v.y, v.z); hp.color.setXYZ(i, on, 0.45 * on, 0.05 * on);
        for (let k = 0; k < 2; k++) { v.copy(this.plowGlowLocal[k + 1]).applyMatrix4(m4); gp.position.setXYZ(i * 2 + k, v.x, v.y, v.z); gp.color.setXYZ(i * 2 + k, 0.85, 0.72, 0.5); } }
      if (!playing) continue;
      const dx = p.x - P.x, dz = p.z - P.z, c = Math.cos(P.yaw), s = Math.sin(P.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // local: z forward, x right
      P.honkT -= dt;
      if (lz > 2 && lz < O.plow.honkDist && Math.abs(lx) < 4 && P.honkT <= 0) { P.honkT = 3.5; this.onEvent('honk', P); }
      if (Math.abs(lx) < 1.55 + 0.55 && lz > -2.2 - 0.55 && lz < 2.6 + 0.4 && jy < 1.3) {
        const side = lx >= 0 ? 1 : -1;
        this.onHit('plow', { nx: c * side + Math.sin(P.yaw) * 0.6, nz: -s * side + Math.cos(P.yaw) * 0.6, steal: O.plow.steal, msg: 'Plowed!' });
      }
    }
    if (this.plowMesh) {
      for (const im of this.plowParts) im.instanceMatrix.needsUpdate = true;
      this.plowBeacon.instanceMatrix.needsUpdate = true; this.plowPools.instanceMatrix.needsUpdate = true;
      for (const o of [this.plowHalo, this.plowGlow]) { o.geometry.attributes.position.needsUpdate = true; o.geometry.attributes.color.needsUpdate = true; }
    }
    // --- snowballs: roll from the outer end of a main street down to the square, then start again
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i], pts = b.road.pts, n = pts.length;
      if (playing) {
        if (b.s < 0) { b.wait -= dt; if (b.wait <= 0) { b.s = n - 1; } }
        else {
          b.s -= O.snowball.speed * dt / 1.5;
          if (b.s <= 0) { b.s = -1; b.wait = lerp(O.snowball.gap[0], O.snowball.gap[1], Math.random()); this.onEvent('ballPop', b); }
        }
      }
      if (b.s >= 0) {
        const i0 = Math.min(n - 2, Math.floor(b.s)), f = b.s - i0, A = pts[i0], B = pts[i0 + 1];
        const nx = lerp(A.x, B.x, f), nz = lerp(A.z, B.z, f), moved = hyp(nx - b.x, nz - b.z);
        b.r = lerp(O.snowball.rMin, O.snowball.rMax, clamp(1 - b.s / (n - 1), 0, 1));
        if (moved < 3) { const ax = v.set(-(A.tz), 0, A.tx).normalize(); b.rot.premultiply(q.setFromAxisAngle(ax, moved / b.r)); } // rolling toward -tangent
        b.x = nx; b.z = nz; b.y = this.surf(nx, nz) + b.r * 0.92;
        if (playing) { const d = hyp(p.x - b.x, p.z - b.z); if (d < b.r + 0.6 && jy < b.r * 1.55 - 0.25) this.onHit('snowball', { nx: (p.x - b.x) / (d || 1) - A.tx * 0.8, nz: (p.z - b.z) / (d || 1) - A.tz * 0.8, steal: 0, msg: 'Snowballed!' }); }
      } else b.y = -50;
      m4.compose(v.set(b.x, b.y, b.z), b.rot, sc.setScalar(b.s >= 0 ? b.r : 0.001));
      this.ballMesh.setMatrixAt(i, m4);
    }
    if (this.ballMesh) this.ballMesh.instanceMatrix.needsUpdate = true;
    // --- grinch bots
    const G0 = O.grinch;
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i]; b.ph += dt;
      if (playing) {
        const dp = hyp(p.x - b.x, p.z - b.z), dh = hyp(b.x - b.hx, b.z - b.hz);
        b.rest -= dt;
        if (b.state !== 'flee' && b.rest <= 0 && dp < G0.sight && dh < G0.leash) b.state = 'chase';
        else if (b.state === 'chase' && (dp > G0.sight * 1.35 || dh > G0.leash)) b.state = 'home';
        else if (b.state === 'flee' && b.rest <= 0) b.state = 'home';
        let tx = b.hx + Math.cos(b.wa + b.ph * 0.3) * 4, tz = b.hz + Math.sin(b.wa + b.ph * 0.3) * 4, sp = 1.6;
        if (b.state === 'chase') { tx = p.x; tz = p.z; sp = G0.speed; }
        else if (b.state === 'flee') { tx = b.x + (b.x - p.x); tz = b.z + (b.z - p.z); sp = G0.speed * 0.8; }
        else if (b.state === 'home') { sp = G0.speed * 0.6; if (dh < 5) b.state = 'idle'; }
        const dx = tx - b.x, dz = tz - b.z, d = hyp(dx, dz);
        if (d > 0.3) { const k = Math.min(d, sp * dt) / d; const pos = { x: b.x + dx * k, z: b.z + dz * k }; this.world.collide(pos, 0.55, 0); b.x = pos.x; b.z = pos.z;
          const want = Math.atan2(dx, dz); b.yaw += Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw)) * (1 - Math.exp(-8 * dt)); }
        if (b.state === 'chase' && dp < 1.25 && jy < 1.1) {
          this.onHit('grinch', { nx: (p.x - b.x) / (dp || 1), nz: (p.z - b.z) / (dp || 1), steal: G0.steal, msg: 'A grinch bot stole' , who: b });
          b.state = 'flee'; b.rest = G0.rest;
        }
      }
      const hop = b.state === 'chase' ? Math.abs(Math.sin(b.ph * 9)) * 0.18 : Math.abs(Math.sin(b.ph * 3)) * 0.06;
      this._e.set(0, b.yaw, b.state === 'chase' ? Math.sin(b.ph * 9) * 0.12 : 0); q.setFromEuler(this._e);
      m4.compose(v.set(b.x, this.surf(b.x, b.z) + hop, b.z), q, sc.set(1, 1, 1));
      this.botMesh.setMatrixAt(i, m4); this.botEyes.setMatrixAt(i, m4);
    }
    if (this.botMesh) { this.botMesh.instanceMatrix.needsUpdate = true; this.botEyes.instanceMatrix.needsUpdate = true; }
    // --- boss
    const B = this.boss, OB = O.boss;
    if (B) {
      if (playing && !B.awake && ctx.levelTime > OB.wakeAt) { B.awake = true; this.onEvent('bossWake', B); }
      const dp = hyp(p.x - B.x, p.z - B.z);
      if (playing && B.awake) {
        B.rest -= dt;
        if (B.tele > 0) { // telegraph: crouch, then slam
          B.tele -= dt; if (B.tele <= 0) { B.waveT = 0; B.wx = B.x; B.wz = B.z; B.hitWave = false; this.onEvent('slam', B); }
        } else if (B.rest <= 0) {
          const dx = p.x - B.x, dz = p.z - B.z;
          if (dp > 2) { const k = OB.speed * dt / dp, pos = { x: B.x + dx * k, z: B.z + dz * k }; this.world.collide(pos, 1.2, 0); B.x = pos.x; B.z = pos.z; }
          const want = Math.atan2(dx, dz); B.yaw += Math.atan2(Math.sin(want - B.yaw), Math.cos(want - B.yaw)) * (1 - Math.exp(-4 * dt));
          B.slamT -= dt; if (B.slamT <= 0 && dp < OB.slamRange) { B.slamT = OB.slamEvery; B.tele = 0.9; this.onEvent('bossTele', B); }
          if (dp < 2.4 && jy < 2.2) { this.onHit('boss', { nx: dx / (dp || 1), nz: dz / (dp || 1), steal: OB.steal, msg: 'The Reorg Grinch stole' }); B.rest = 3; }
        }
      }
      if (B.waveT >= 0) {
        B.waveT += dt; const k = B.waveT / OB.waveT, r = k * OB.waveR;
        B.wave.visible = k < 1; B.wave.position.set(B.wx, this.surf(B.wx, B.wz) + 0.2, B.wz); B.wave.scale.set(Math.max(0.01, r), 1, Math.max(0.01, r));
        B.wave.material.opacity = 1 - k * k;
        const d = hyp(p.x - B.wx, p.z - B.wz);
        if (playing && !B.hitWave && Math.abs(d - r) < 1.0 && jy < 0.4) { B.hitWave = true; this.onHit('wave', { nx: (p.x - B.wx) / (d || 1), nz: (p.z - B.wz) / (d || 1), steal: OB.slamSteal, msg: 'Shockwave! Lost' }); }
        if (k >= 1) B.waveT = -1;
      }
      const squash = B.tele > 0 ? 1 - 0.25 * (1 - B.tele / 0.9) : 1, bob = B.awake ? Math.abs(Math.sin(t * 5)) * 0.25 : 0;
      B.g.position.set(B.x, this.surf(B.x, B.z) + bob, B.z); B.g.rotation.y = B.yaw; B.g.scale.set(2.4 / Math.sqrt(squash), 2.4 * squash, 2.4 / Math.sqrt(squash));
    }
    // --- wind gusts
    const Wn = this.wind, Gs = this.gust;
    Gs.warn = 0;
    if (Wn && playing) {
      const OW = O.wind; Wn.t += dt;
      if (Wn.phase === 'idle' && Wn.t >= Wn.next) { Wn.phase = 'warn'; Wn.t = 0; const a = Math.random() * TAU; Gs.x = Math.cos(a); Gs.z = Math.sin(a); this.onEvent('gustWarn', Gs); }
      else if (Wn.phase === 'warn') { Gs.warn = 1; if (Wn.t >= OW.warn) { Wn.phase = 'gust'; Wn.t = 0; this.onEvent('gust', Gs); } }
      else if (Wn.phase === 'gust' && Wn.t >= OW.dur) { Wn.phase = 'idle'; Wn.t = 0; Wn.next = lerp(OW.every[0], OW.every[1], Math.random()); }
      const target = Wn.phase === 'gust' ? Math.sin(Math.PI * clamp(Wn.t / OW.dur, 0, 1)) ** 0.6 : 0;
      Gs.k = target; Gs.push = OW.push * target;
    } else { Gs.k = 0; Gs.push = 0; }
  }

  /** minimap markers */
  marks() {
    const out = [];
    for (const f of this.fences) out.push({ t: 'fence', x: f.x, z: f.z, nx: f.tz, nz: -f.tx });
    for (const b of this.barriers) out.push({ t: 'barrier', x: b.x, z: b.z, nx: b.tz, nz: -b.tx });
    for (const l of this.lag) out.push({ t: 'lag', x: l.x, z: l.z, r: l.r });
    for (const p of this.plows) out.push({ t: 'plow', x: p.x, z: p.z });
    for (const b of this.bots) out.push({ t: 'grinch', x: b.x, z: b.z });
    if (this.boss) out.push({ t: 'boss', x: this.boss.x, z: this.boss.z });
    return out;
  }
}
