// Santa's Block Delivery — game bootstrap, loop and state machine.
import * as THREE from 'three';
import { PostFX, loadEnvironment, LampCones, Footprints, ChimneySmoke, Sparkles, Shockwaves, Governor } from './fx.js';
import { CONFIG, applyUrlOverrides, resolveQuality, difficulty, ethPerBlock, formatEth, comboMult, fmt } from './config.js';
import { initAssets } from './assets.js';
import { World } from './world.js';
import { createSanta } from './santa.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Snow, Particles, Flights, Fireworks } from './effects.js';
import { makeLogoMesh, logoSVG } from './logo.js';
import { WINDOW_WARM, WINDOW_BLUE } from './materials.js';
import { initAudio, sfx } from './audio.js';
import { rng, clamp, lerp, damp, angleDamp, angleDiff, glowTexture, textTexture, worldUV } from './util.js';

applyUrlOverrides();
const params = new URLSearchParams(location.search);
const Q = resolveQuality();
const B = CONFIG.branding;
const X = CONFIG.boosted;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);
const $ = id => document.getElementById(id);

// ------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
const LOOK = CONFIG.look;
renderer.toneMapping = LOOK.toneMapping === 'AgX' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = LOOK.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(CONFIG.weather.fogColor), STORM_FOG = new THREE.Color(CONFIG.weather.stormFogColor);
scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), CONFIG.weather.presets.clear.fog);
scene.background = FOG_COLOR.clone();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 900);

// moonlight
const hemi = new THREE.HemisphereLight(0x4a66b8, 0x2a2232, 0.66); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9ab6ff, 0.9);
moon.castShadow = Q.shadows; moon.shadow.mapSize.set(Q.shadowMapSize, Q.shadowMapSize);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.035; moon.shadow.radius = Q.shadowMapSize >= 4096 ? 4 : 3; moon.shadow.blurSamples = 16;
scene.add(moon, moon.target);

// pooled point lights (windows, lamps, tree) — fixed count => no shader recompiles
const lightPool = [];
for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffaa66, 0, 16, 2); scene.add(l); lightPool.push(l); }

// post stack: [GTAO] -> bloom -> output (tone map) -> DOF + grade + vignette + grain
const post = new PostFX(renderer, scene, camera, Q, CONFIG.bloom, LOOK);
const bloom = post.bloom;
post.weatherPost = CONFIG.weather.post;
if (!Q.grade) document.body.classList.add('cssVignette');
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
});
// runtime fallback for weak devices (only when quality = auto)
const governor = new Governor(!Q.auto ? [] : [
  { name: 'mascot fur shells + flame light off', apply: () => santa?.lowFx?.() },
  { name: 'DOF off', apply: () => post.setDof(false) },
  { name: 'GTAO off', apply: () => post.setAO(false) },
  { name: 'light shafts + smoke off', apply: () => { if (fxs.cones) fxs.cones.mesh.visible = false; if (fxs.smoke) fxs.smoke.points.visible = false; } },
  { name: 'render scale 1.0', apply: () => { renderer.setPixelRatio(1); post.setSize(innerWidth, innerHeight); } },
  { name: 'shadows off', apply: () => { renderer.shadowMap.enabled = false; moon.castShadow = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); } },
  { name: 'bloom off', apply: () => post.setBloom(false) },
  { name: 'render scale 0.75', apply: () => { renderer.setPixelRatio(0.75); post.setSize(innerWidth, innerHeight); } },
]);
const fxs = {};

// ------------------------------------------------------------ globals
let world, santa, input, hud, snow, particles, fireworksParticles, flights, fireworks, giftLight, giftHalo, shardOrbit, boostTrail;
const G = {
  state: 'loading', level: 0, timer: 0, score: 0, levelStartScore: 0, levelTime: 0, total: 0, delivered: 0,
  targets: [], powerups: [], ice: [], mumpLeft: 0, mumpDur: 1, pulseT: 0, storm: 0, bonusFlash: 0,
  gossipBusy: false, hint: '', endingT: 0, lastTick: 0, levelObjects: [],
  combo: 0, bestCombo: 0, lastDeliverT: -1e9, boosted: 0, totalBoosted: 0,
};
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, speed: 0 };
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), dist: CONFIG.camera.distance };
const perf = { frames: [], last: performance.now() };

// ------------------------------------------------------------ boot
async function boot() {
  $('selDifficulty').value = CONFIG.difficulty;
  $('selQuality').value = CONFIG.quality;
  $('titleText').textContent = B.title; $('subtitleText').textContent = B.subtitle;
  $('storyChar').textContent = CONFIG.character.storyName; $('storyGossip').textContent = `${B.gossipMs} ms`; $('storyOpt').textContent = `${B.optimumMs} ms`;
  $('titleFoot').textContent = `Target: ${B.targetLabel}`;
  $('heroLogo').innerHTML = logoSVG({ width: 260, height: 130, stroke: 4, color: '#51B1FE' });
  $('endLogo').innerHTML = logoSVG({ width: 200, height: 100, stroke: 3.5, color: '#51B1FE' });

  await initAssets(renderer);
  if (Q.env) await loadEnvironment(renderer, scene, LOOK.hdri, LOOK.envIntensity);
  world = new World(scene, Q);
  santa = createSanta(Q.name); scene.add(santa.root);
  santa.root.traverse(o => { if (o.isMesh && !o.name.startsWith('mascot')) o.castShadow = true; });
  giftLight = new THREE.PointLight(0x3f9dff, 5, 9, 2); scene.add(giftLight);
  // soft additive halo so the carried gift reads from the chase camera
  giftHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x4aa8ff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  giftHalo.scale.setScalar(1.6); giftHalo.renderOrder = 5; scene.add(giftHalo);
  input = new Input(canvas); input.onPause = togglePause;
  hud = new HUD(world);
  // layered snow: main fall, far fine dust, near soft "bokeh" flakes
  snow = new Snow(scene, Q.snowCount);
  fxs.snowLayers = [];
  if (Q.snowLayers > 1) fxs.snowLayers.push({ s: new Snow(scene, Math.round(Q.snowCount * 0.8), { box: 170, h: 70, size: 0.1, opacity: 0.55, speed: 0.7 }), near: false });
  if (Q.snowLayers > 2) fxs.snowLayers.push({ s: new Snow(scene, 140, { box: 18, h: 12, size: 0.3, opacity: 0.22, speed: 0.55, soft: 1 }), near: true });
  if (Q.shafts) fxs.cones = new LampCones(scene, world.lightCandidates.filter(l => l.lamp), LOOK.lampShaftIntensity);
  if (Q.smoke) { const src = world.buildings.filter(b => b.chimney).map(b => b.chimney); if (src.length) fxs.smoke = new ChimneySmoke(scene, src, Q.name === 'high' ? 24 : 16); }
  if (Q.footprints) fxs.feet = new Footprints(scene, 240);
  if (fxs.feet) fxs.feet.heightAt = world.heightAt;
  if (Q.sparkle) fxs.sparkles = new Sparkles(scene, Q.name === 'high' ? 1800 : 1000);
  fxs.waves = new Shockwaves(scene);
  particles = new Particles(scene, 2500, 0.35);
  fireworksParticles = new Particles(scene, 7000, 0.9);
  flights = new Flights(scene, particles);
  flights.onImpact = (p) => fxs.waves.spawn(p.clone().setY(0), 3.2, 0.55, 0x6fd0ff);
  fireworks = new Fireworks(scene, fireworksParticles);
  shardOrbit = makeShardOrbit(); scene.add(shardOrbit);
  boostTrail = makeBoostTrail(); scene.add(boostTrail.mesh);

  // title camera
  resetPlayer();
  bindUI();
  $('loading').classList.add('hidden');
  G.state = 'title';
  window.__xmas = debugAPI();
  requestAnimationFrame(loop);
}

function bindUI() {
  $('playBtn').onclick = () => {
    const q = $('selQuality').value;
    CONFIG.difficulty = $('selDifficulty').value;
    if (q !== CONFIG.quality) { // quality affects world build -> reload with param
      const u = new URL(location.href); u.searchParams.set('quality', q); u.searchParams.set('difficulty', CONFIG.difficulty); u.searchParams.set('autostart', '1'); location.href = u.toString(); return;
    }
    initAudio(CONFIG.audio);
    const lv = clamp((parseInt(params.get('level')) || 1) - 1, 0, CONFIG.levels.length - 1);
    G.score = CONFIG.levels.slice(0, lv).reduce((s, l) => s + l.validators, 0) * ethPerBlock();
    hud.displayScore = G.score;
    startLevel(lv);
  };
  $('pauseBtn').onclick = togglePause;
  $('endBtn').onclick = () => { $('ending').classList.add('hidden'); G.score = 0; G.totalBoosted = 0; hud.displayScore = 0; resetVillageLights(); startLevel(0); };
  if (params.get('autostart')) setTimeout(() => $('playBtn').click(), 50);
}

function togglePause() {
  if (G.state === 'playing') { G.state = 'paused'; showOverlay('Paused', 'Take a breath — the slot is frozen.', null, 'Resume', () => { hideOverlay(); G.state = 'playing'; }, 'Quit to title', () => { hideOverlay(); toTitle(); }); }
  else if (G.state === 'paused') { hideOverlay(); G.state = 'playing'; }
}
function toTitle() { clearLevel(); resetVillageLights(); G.state = 'title'; hud.show(false); $('touchUI').classList.add('hidden'); $('title').classList.remove('hidden'); }

function showOverlay(title, text, stats, btn, fn, btn2, fn2) {
  $('ovTitle').textContent = title; $('ovText').innerHTML = text;
  $('ovStats').innerHTML = stats ? stats.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('') : '';
  $('ovStats').classList.toggle('hidden', !stats);
  $('ovBtn').textContent = btn; $('ovBtn').onclick = fn;
  $('ovBtn2').classList.toggle('hidden', !btn2); if (btn2) { $('ovBtn2').textContent = btn2; $('ovBtn2').onclick = fn2; }
  $('overlay').classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ------------------------------------------------------------ level setup
function resetPlayer() {
  // spawn on the main street (road 0), looking back up the cobbles toward the big tree in the square
  const road = world.roads[0];
  const p = road.pts.find(q => Math.hypot(q.x, q.z) >= CONFIG.world.spawnRadius) || road.pts[road.pts.length - 1];
  player.pos.set(p.x, 0, p.z);
  player.vel.set(0, 0, 0);
  player.heading = Math.atan2(-p.tx, -p.tz);
  cam.yaw = player.heading;
  santa.root.position.copy(player.pos); santa.root.rotation.y = player.heading;
}

function clearLevel() {
  for (const o of G.levelObjects) { o.parent?.remove(o); }
  G.levelObjects = []; G.targets = []; G.powerups = []; G.ice = []; fxs.sparkles?.setIce([]); fxs.feet?.reset();
  flights?.clear();
  G.mumpLeft = 0; G.gossipBusy = false;
}

function setBuildingBlue(b, on, strong = 1) {
  b.winMat.emissive.copy(on ? WINDOW_BLUE : WINDOW_WARM);
  b.winMat.emissiveIntensity = on ? 2.4 * strong : 1.9;
  b.light.color.copy(on ? WINDOW_BLUE : WINDOW_WARM);
  b.light.intensity = on ? 22 : 10; b.light.distance = on ? 18 : 14;
}
function resetVillageLights() {
  for (const b of world.buildings) setBuildingBlue(b, false);
  for (const l of world.lightCandidates) if (l._orig) l.color.copy(l._orig);
}

function startLevel(idx) {
  clearLevel(); resetVillageLights();
  const L = CONFIG.levels[idx], D = difficulty();
  G.level = idx; G.levelTime = 0; G.levelStartScore = G.score;
  G.timer = L.timer * D.timerMult; G.delivered = 0; G.storm = 0; G.stormLin = 0; G.endingT = 0;
  G.combo = 0; G.bestCombo = 0; G.lastDeliverT = -1e9; G.boosted = 0; boostTrail?.reset();
  const R = rng(CONFIG.world.seed * 7 + idx * 131);
  // --- choose validator houses inside the level area, spread out
  const cands = world.buildings.filter(b => {
    const d = Math.hypot(b.x, b.z);
    return d < L.areaRadius && d > 20 && !world.inLake(b.trigger.x, b.trigger.z, 1) && !world.buildingAt(b.trigger.x, b.trigger.z, 0.3);
  });
  // shuffle (validator-house type preferred first)
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  cands.sort((a, b) => (b.type === 'validatorHouse') - (a.type === 'validatorHouse'));
  const picked = [];
  for (let minD = 26; picked.length < L.validators && minD >= 0; minD -= 6) {
    for (const b of cands) {
      if (picked.length >= L.validators) break;
      if (picked.includes(b)) continue;
      if (picked.every(p => Math.hypot(p.x - b.x, p.z - b.z) >= minD)) picked.push(b);
    }
  }
  const nSlow = Math.round(L.slowNodes * D.slowNodeMult);
  const slowSet = new Set(picked.filter(b => b.type !== 'validatorHouse').slice(0, nSlow));
  while (slowSet.size < Math.min(nSlow, picked.length)) slowSet.add(picked[slowSet.size]);
  G.targets = picked.map(b => makeTarget(b, slowSet.has(b)));
  G.total = G.targets.length;
  // --- power-ups on roads
  const nP = Math.max(1, L.powerups + D.powerupCountAdd);
  for (let i = 0; i < nP; i++) spawnPowerup(R, L);
  // --- ice patches on roads
  if (L.ice) {
    const n = Math.round(L.iceCount * (0.6 + 0.4 * D.iceSlipMult));
    for (let i = 0; i < n; i++) {
      const p = world.randomRoadPoint(R, 28, L.areaRadius + 10);
      const r = lerp(CONFIG.obstacles.ice.minRadius, CONFIG.obstacles.ice.maxRadius, R());
      const geo = new THREE.CircleGeometry(r, 28); geo.rotateX(-Math.PI / 2); worldUV(geo, 0.2);
      const m = new THREE.Mesh(geo, world.M.ice); m.position.set(p.x, 0.07 + i * 0.001, p.z); m.receiveShadow = true;
      scene.add(m); G.levelObjects.push(m); G.ice.push({ x: p.x, z: p.z, r });
    }
    fxs.sparkles?.setIce(G.ice);
  }
  resetPlayer();
  hideOverlay(); $('title').classList.add('hidden');
  hud.show(true); $('touchUI').classList.toggle('hidden', !isTouch);
  G.state = 'playing';
  hud.toast(`Level ${idx + 1}: ${L.name}`, 2.4);
}

const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uC: { value: new THREE.Color(0x3fb6ff) }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }',
  // fades out when the camera is right next to / inside the beam (no full-screen glare)
  fragmentShader: 'varying vec2 vUv; varying float vD; uniform vec3 uC; uniform float uT; void main(){ float a = pow(1.0-vUv.y, 2.2)*0.32*(0.8+0.2*sin(uT*3.0+vUv.y*20.0)) * smoothstep(1.5, 7.0, vD); gl_FragColor = vec4(uC*1.6, a); }',
});
const ringShader = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uP: { value: 0 }, uC: { value: new THREE.Color(color) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'varying vec3 vP; uniform float uP; uniform vec3 uC; void main(){ float a = atan(vP.x, -vP.y)/6.2831853+0.5; if (a > uP) discard; gl_FragColor = vec4(uC*2.2, 0.95); }',
});
let slowTex = null;

function makeTarget(b, slow) {
  const g = new THREE.Group();
  // floating gem above the roof
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3fb6ff).multiplyScalar(2.2) }));
  gem.position.set(b.x, b.height + 3.2, b.z); gem.scale.y = 1.5;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x3fb6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  halo.scale.setScalar(7); gem.add(halo);
  // beam at the door
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 11, 10, 1, true), beamMat);
  beam.position.set(b.trigger.x, 5.5, b.trigger.z); // thin, short, soft: the floating gem does the long-range marking
  // door ring + progress arc
  const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.delivery.doorRadius - 0.45, CONFIG.delivery.doorRadius - 0.15, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3fb6ff).multiplyScalar(1.6), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(b.trigger.x, 0.12, b.trigger.z);
  const prog = new THREE.Mesh(new THREE.RingGeometry(CONFIG.delivery.doorRadius - 0.1, CONFIG.delivery.doorRadius + 0.35, 64), ringShader(0x8fe9ff));
  prog.rotation.x = -Math.PI / 2; prog.position.set(b.trigger.x, 0.14, b.trigger.z);
  // house glow decal
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x2f8fff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(b.x, 0.1, b.z); glow.scale.set(b.footprint[0] * 2.6, b.footprint[1] * 2.6, 1);
  g.add(gem, beam, ring, prog, glow);
  if (slow) {
    slowTex ??= textTexture('SLOW NODE', { w: 512, h: 128, bg: 'rgba(40,20,0,0.75)', fg: '#ffcf6b', border: '#ff9f2e', glow: '#ff9f2e', font: 'bold 70px system-ui, sans-serif' });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: slowTex, transparent: true, depthWrite: false }));
    label.scale.set(5, 1.25, 1); label.position.set(b.x, b.height + 6.2, b.z); g.add(label);
  }
  scene.add(g); G.levelObjects.push(g);
  return { b, slow, delivered: false, sending: false, progress: 0, group: g, gem, halo, prog, ring, glow, beam, fadeT: -1 };
}

function spawnPowerup(R, L) {
  const p = world.randomRoadPoint(R, 26, Math.min(CONFIG.world.radius - 10, L.areaRadius + 15));
  const g = new THREE.Group(); g.position.set(p.x, 0, p.z);
  const logo = makeLogoMesh(1.25, 0.032, 0x51b1fe, 1.45); logo.position.y = 1.8; g.add(logo); // thin neon-blue ring, billboarded in updateTargets
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x2f9bff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }));
  halo.scale.setScalar(4.2); halo.position.y = 1.8; g.add(halo);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.85, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2b8dff).multiplyScalar(2.4), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true), beamMat); beam.position.y = 5.8; g.add(beam); // starts above the ring so nothing crosses its hollow centre
  scene.add(g); G.levelObjects.push(g);
  const pu = { x: p.x, z: p.z, group: g, logo, active: true, respawnT: 0, L };
  G.powerups.push(pu); return pu;
}

function makeShardOrbit() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd8ff).multiplyScalar(2.5) });
  for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), mat); m.userData.a = i / 7 * Math.PI * 2; m.userData.tilt = (i % 3 - 1) * 0.5; g.add(m); }
  g.visible = false; return g;
}

// ------------------------------------------------------------ gameplay
function onIce(x, z) {
  if (world.inLake(x, z)) return true;
  for (const p of G.ice) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return true;
  return false;
}

function updatePlayer(dt) {
  const P = CONFIG.player, D = difficulty();
  const ax = input.axes(), sprint = input.sprint;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw); // camera forward
  const rx = -fz, rz = fx; // camera right
  const speedMax = (sprint ? P.sprintSpeed : P.walkSpeed) * D.speedMult;
  const wantX = (fx * ax.y + rx * ax.x) * speedMax, wantZ = (fz * ax.y + rz * ax.x) * speedMax;
  const ice = onIce(player.pos.x, player.pos.z);
  const hasInput = Math.hypot(ax.x, ax.y) > 0.05;
  let accel = ice ? P.iceAccel / D.iceSlipMult : P.accel;
  if (ice && !hasInput) accel = P.iceFriction / D.iceSlipMult;
  const k = 1 - Math.exp(-accel * dt / Math.max(1, speedMax) * (ice ? 1 : 2.2));
  player.vel.x += (wantX - player.vel.x) * k; player.vel.z += (wantZ - player.vel.z) * k;
  if (!ice && !hasInput) { player.vel.multiplyScalar(Math.exp(-14 * dt)); }
  const before = player.pos.clone();
  player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
  world.collide(player.pos, P.radius);
  // velocity follows actual displacement (so walls stop sliding momentum)
  if (dt > 0) { const ax2 = (player.pos.x - before.x) / dt, az2 = (player.pos.z - before.z) / dt; player.vel.x = lerp(player.vel.x, ax2, 0.5); player.vel.z = lerp(player.vel.z, az2, 0.5); }
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  if (hasInput && player.speed > 0.3) {
    const dir = ice ? Math.atan2(wantX, wantZ) : Math.atan2(player.vel.x, player.vel.z);
    player.heading = angleDamp(player.heading, dir, P.turnSpeed, dt);
  }
  santa.root.position.copy(player.pos); santa.root.position.y = world.heightAt ? world.heightAt(player.pos.x, player.pos.z) * 0.85 : 0; // boots sink a little into the snow
  santa.root.rotation.y = player.heading;
  santa.root.rotation.z = ice ? Math.sin(G.levelTime * 9) * 0.05 * Math.min(1, player.speed / 4) : 0;
  santa.setState?.({ storm: G.storm, ice, slow: G.slowHold, boosted: G.mumpLeft > 0 });
  const jumpKey = input.keys.has('Space') || input.jumpBtn;
  if (jumpKey && !G.jumpHeld) santa.jump?.(); G.jumpHeld = jumpKey;
  santa.update(dt, player.speed, sprint && player.speed > P.walkSpeed * 0.9);
  G.onIce = ice;
}

function setFov(f, dt) { const n = camera.fov + (f - camera.fov) * (1 - Math.exp(-3 * dt)); if (Math.abs(n - camera.fov) > 0.01) { camera.fov = n; camera.updateProjectionMatrix(); } }
function updateCamera(dt, t) {
  const C = CONFIG.camera;
  if (G.camOverride) { // QA / photo mode
    const o = G.camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); cam.pos.copy(camera.position); cam.look.set(...o.look);
    if (o.fov && camera.fov !== o.fov) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
    return;
  }
  let fov = C.fov;
  if (G.state === 'title') {
    // slow crane: orbit + breathing radius/height, the look target drifts between tree and rooftops
    const a = t * 0.05; const r = 24 + Math.sin(t * 0.09) * 5;
    cam.pos.set(Math.cos(a) * r, 6.5 + Math.sin(t * 0.13) * 2.5, Math.sin(a) * r);
    cam.look.set(Math.cos(a + 0.5) * 3, 6.5 + Math.sin(t * 0.11) * 1.5, Math.sin(a + 0.5) * 3);
    camera.position.copy(cam.pos); camera.lookAt(cam.look); setFov(50 + Math.sin(t * 0.07) * 2, dt); return;
  }
  if (G.state === 'levelComplete' || G.state === 'gameOver') {
    // hero orbit around Santa
    cam.orbit = (cam.orbit ?? cam.yaw + Math.PI) + dt * 0.25;
    const want = new THREE.Vector3(player.pos.x + Math.sin(cam.orbit) * 7.5, 3.2, player.pos.z + Math.cos(cam.orbit) * 7.5);
    cam.pos.lerp(want, 1 - Math.exp(-2.5 * dt)); cam.look.lerp(_v0.set(player.pos.x, 1.4, player.pos.z), 1 - Math.exp(-4 * dt));
    camera.position.copy(cam.pos); camera.lookAt(cam.look); setFov(45, dt); return;
  }
  cam.orbit = undefined;
  if (G.state === 'ending') {
    setFov(52, dt);
    const a = 0.7 + G.endingT * 0.05, r = 78;
    const want = new THREE.Vector3(Math.cos(a) * r, 22 + Math.min(G.endingT, 6) * 2, Math.sin(a) * r);
    cam.pos.lerp(want, 1 - Math.exp(-1.5 * dt)); cam.look.lerp(new THREE.Vector3(0, 26, 0), 1 - Math.exp(-1.5 * dt));
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    fireworks.facing.set(cam.pos.x, 0, cam.pos.z).normalize();
    return;
  }
  const manual = input.takeCamDelta();
  cam.yaw -= manual;
  const sinceManual = performance.now() - input.lastManualCam;
  if (player.speed > 0.5 && sinceManual > 1200) {
    const d = angleDiff(cam.yaw, player.heading);
    if (Math.abs(d) < 1.9) cam.yaw = angleDamp(cam.yaw, player.heading, C.autoYawRate * Math.min(1, player.speed / 6), dt);
  }
  // look down the street ahead of Santa (more when running); FOV opens on sprint and kicks on BOOSTED
  const ahead = C.lookAhead + Math.min(2.5, player.speed * 0.2);
  const look = new THREE.Vector3(player.pos.x + Math.sin(cam.yaw) * ahead, C.lookHeight, player.pos.z + Math.cos(cam.yaw) * ahead);
  cam.kick = Math.max(0, (cam.kick || 0) - dt * 1.6);
  // portrait phones: widen the vertical FOV so the horizontal view isn't a keyhole
  const portrait = camera.aspect < 0.9 ? 1.32 : 1;
  setFov((C.fov + Math.max(0, player.speed - 6) * 0.9 + (G.mumpLeft > 0 ? 3 : 0) + cam.kick * 8) * portrait, dt);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  const storm = G.storm;
  let dist = C.distance * (1 - storm * 0.15) * (camera.aspect < 0.9 ? 1.3 : 1);
  const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw); // camera-right on the ground plane
  const sh = C.shoulder * (camera.aspect < 0.9 ? 0.3 : 1);
  // camera collision: march from Santa's head back toward the desired (over-the-shoulder) camera position
  let allowed = dist;
  for (let i = 1; i <= 12; i++) {
    const k = i / 12, s = dist * k, h = 1.6 + (C.height - 1.6) * k;
    if (world.blocksCamera(player.pos.x - fx * s + rx * sh * k, h, player.pos.z - fz * s + rz * sh * k)) { allowed = Math.max(2.2, dist * (i - 1) / 12); break; }
  }
  cam.dist = damp(cam.dist, allowed, allowed < cam.dist ? 20 : 3, dt);
  const r = cam.dist / dist;
  const want = new THREE.Vector3(player.pos.x - fx * cam.dist + rx * sh * r, C.height + (1 - r) * 0.9, player.pos.z - fz * cam.dist + rz * sh * r);
  cam.pos.lerp(want, 1 - Math.exp(-C.followLerp * dt));
  if (cam.pos.distanceTo(want) > 30) cam.pos.copy(want);
  cam.look.lerp(look, 1 - Math.exp(-12 * dt));
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
}

function deliver(t) {
  if (t.delivered) return;
  t.delivered = true; t.sending = false; t.fadeT = 0.6;
  G.delivered++; G.boosted++; G.totalBoosted++;
  // Boosted combo: consecutive deliveries inside the window stack a multiplier
  G.combo = (G.levelTime - G.lastDeliverT <= X.comboWindow) ? G.combo + 1 : 1;
  G.lastDeliverT = G.levelTime; G.bestCombo = Math.max(G.bestCombo, G.combo);
  const mult = comboMult(G.combo);
  G.score += ethPerBlock() * mult;
  addBoostedLabel(t);
  G.timer += CONFIG.delivery.timerBonus; G.bonusFlash = 1.5;
  setBuildingBlue(t.b, true);
  particles.burst(new THREE.Vector3(t.b.door.x, 2.5, t.b.door.z), new THREE.Color(0.35, 0.8, 2.0), 70, 7, 1.2);
  t.glow.material.opacity = 0.9;
  sfx.deliver(); santa.celebrate?.();
  if (G.delivered >= G.total && G.state === 'playing') setTimeout(levelComplete, 700);
}

let boostedTex = null;
function addBoostedLabel(t) {
  boostedTex ??= textTexture(X.houseLabel, { w: 512, h: 128, bg: 'rgba(4,22,44,0.78)', fg: '#bff0ff', border: '#3fb6ff', glow: '#3fb6ff', font: 'italic 900 76px system-ui, sans-serif' });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: boostedTex, transparent: true, depthWrite: false }));
  sp.scale.set(3.2, 0.8, 1); sp.position.set(t.b.door.x + t.b.front.x * 0.8, Math.min(t.b.height, 3.4) + 0.9, t.b.door.z + t.b.front.z * 0.8); sp.userData.baseY = sp.position.y; sp.userData.t0 = G.levelTime;
  scene.add(sp); G.levelObjects.push(sp); t.label = sp;
}

// Blue light ribbon that follows Santa while Boosted
function makeBoostTrail() {
  const N = 48;
  const pos = new Float32Array(N * 2 * 3), alpha = new Float32Array(N * 2), side = new Float32Array(N * 2).map((_, i) => i % 2);
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aA', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aS', new THREE.BufferAttribute(side, 1)); geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(0x3fb6ff) } },
    vertexShader: 'attribute float aA; attribute float aS; varying float vA; varying float vY; void main(){ vA = aA; vY = aS; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uC; varying float vA; varying float vY; void main(){ float e = 1.0 - abs(vY*2.0-1.0); float c = pow(e, 2.5); gl_FragColor = vec4(uC*1.6 + vec3(0.5,0.8,1.0)*c, vA*c); }',
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false;
  const pts = []; let acc = 0, level = 0;
  return {
    mesh,
    reset() { pts.length = 0; level = 0; mesh.visible = false; },
    update(dt, on, p) {
      level = damp(level, on ? 1 : 0, on ? 6 : 2.5, dt);
      acc += dt;
      if (pts.length && Math.hypot(pts[0][0] - p.x, pts[0][1] - p.z) > 4) pts.length = 0; // teleport / respawn
      if (acc > 0.025) { acc = 0; pts.unshift([p.x, p.z]); if (pts.length > N) pts.pop(); }
      mesh.visible = level > 0.01 && pts.length > 2;
      if (!mesh.visible) return;
      for (let i = 0; i < N; i++) {
        const q = pts[Math.min(i, pts.length - 1)];
        const f = 1 - i / (N - 1), w = 0.25 + 0.75 * f;
        pos.set([q[0], 0.55 - 0.3 * w, q[1], q[0], 0.55 + 0.75 * w, q[1]], i * 6);
        const a = 0.55 * f * f * level * (i < pts.length ? 1 : 0); alpha[i * 2] = a; alpha[i * 2 + 1] = a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.aA.needsUpdate = true;
    },
  };
}

function doorTarget(t) { return new THREE.Vector3(t.b.door.x + t.b.front.x * 0.6, 3.0, t.b.door.z + t.b.front.z * 0.6); }

function updateDelivery(dt) {
  const C = CONFIG.delivery, D = difficulty(), mump = G.mumpLeft > 0;
  let near = null, best = 1e9;
  for (const t of G.targets) {
    if (t.delivered || t.sending) continue;
    const d = Math.hypot(player.pos.x - t.b.trigger.x, player.pos.z - t.b.trigger.z);
    if (d < C.doorRadius && d < best) { best = d; near = t; }
  }
  G.hint = ''; G.slowHold = !!near?.slow;
  for (const t of G.targets) if (t !== near && !t.sending && !t.delivered) t.progress = Math.max(0, t.progress - dt * 1.5);
  if (near && !(G.gossipBusy && !mump)) {
    let hold = C.holdTime * D.holdMult / (mump ? CONFIG.powerup.speedFactor : 1);
    if (near.slow) hold *= C.slowNodeHoldMult * D.slowNodeMult;
    near.progress += dt / hold;
    G.hint = near.slow ? 'Slow node… hold position' : (mump ? 'mump2p delivering…' : 'Gossiping block…');
    if (near.progress >= 1) {
      near.progress = 1; near.sending = true;
      const from = santa.giftWorldPos();
      if (mump) { flights.shard(from, doorTarget(near), CONFIG.powerup.shardFlightTime / 2, () => deliver(near)); sfx.shard(); }
      else { G.gossipBusy = true; flights.gossip(from, doorTarget(near), C.gossipFlightTime, () => { G.gossipBusy = false; deliver(near); }); }
    }
  } else if (near && G.gossipBusy) G.hint = 'Gossip is one-at-a-time…';
  // mump2p broadcast pulses
  if (mump) {
    G.pulseT -= dt;
    if (G.pulseT <= 0) {
      G.pulseT = CONFIG.powerup.pulseInterval;
      const from = santa.giftWorldPos(); let i = 0;
      for (const t of G.targets) {
        if (t.delivered || t.sending) continue;
        if (Math.hypot(player.pos.x - t.b.x, player.pos.z - t.b.z) > CONFIG.powerup.shardRadius) continue;
        t.sending = true;
        const dur = CONFIG.powerup.shardFlightTime * (t.slow ? 1.6 * D.slowNodeMult : 1) + i * 0.04;
        const sd = (t.b.id * 0.618) % 1;
        flights.shard(from, doorTarget(t), dur, () => deliver(t), sd);
        // extra cosmetic streams braid alongside the main one (multi-path mump2p broadcast)
        for (const k of [-1, 1]) flights.shard(from, doorTarget(t), dur * (1 + 0.08 * k), null, (sd + 0.22 * k + 1) % 1, 0.55);
        i++;
      }
      if (i) { sfx.shard(); santa.giftScale = 0.55; particles.burst(from, new THREE.Color(0.4, 0.8, 2), 60, 6, 0.7); fxs.waves.spawn(player.pos.clone(), CONFIG.powerup.shardRadius * 0.6, 0.8, 0x49c2ff); G.flash = Math.max(G.flash || 0, 0.45); }
    }
    G.mumpLeft -= dt;
    if (G.mumpLeft <= 0) { G.mumpLeft = 0; hud.toast('mump2p ended — back to gossip', 1.6); }
  }
  santa.giftScale = damp(santa.giftScale, 1, 3, dt);
  G.inRange = mump ? G.targets.filter(t => !t.delivered && Math.hypot(player.pos.x - t.b.x, player.pos.z - t.b.z) <= CONFIG.powerup.shardRadius).length : 0;
}

function updateTargets(dt, t) {
  for (const tg of G.targets) {
    if (tg.fadeT >= 0) {
      tg.fadeT -= dt; const s = Math.max(0, tg.fadeT / 0.6);
      tg.gem.scale.set(s, s * 1.5, s); tg.beam.visible = false; tg.ring.visible = false; tg.prog.visible = false; tg.halo.material.opacity = s;
      tg.group.children.forEach(c => { if (c.isSprite) c.visible = false; });
      if (tg.fadeT < 0) { tg.gem.visible = false; tg.glow.material.opacity = 0.75; }
      continue;
    }
    if (tg.delivered) continue;
    tg.gem.rotation.y = t * 1.6 + tg.b.id;
    tg.gem.position.y = tg.b.height + 3.2 + Math.sin(t * 2 + tg.b.id) * 0.4;
    tg.prog.material.uniforms.uP.value = tg.progress;
    tg.glow.material.opacity = 0.4 + 0.2 * Math.sin(t * 3 + tg.b.id);
    if (tg.slow) {
      const on = Math.sin(t * CONFIG.obstacles.slowNode.flickerHz * 6.28 + tg.b.id) + Math.sin(t * 13.7) > 0.3;
      tg.b.winMat.emissiveIntensity = on ? 2.2 : 0.25;
      tg.b.light.intensity = on ? 14 : 2;
      tg.gem.material.color.setRGB(on ? 0.3 : 2.2, on ? 1.2 : 1.3, on ? 2.4 : 0.3);
    }
  }
  for (const p of G.powerups) {
    if (p.active) {
      // billboard around Y so the ring always reads as the Optimum logo (never a side-on "8"), gentle in-plane sway
      p.logo.quaternion.copy(camera.quaternion); // brand rule: never rotate the mark // full camera billboard: always the front-on ring
      p.logo.position.y = 1.8 + Math.sin(t * 2.5 + p.x) * 0.25;
      if (G.state === 'playing' && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < CONFIG.powerup.pickupRadius) pickPowerup(p);
    } else if (CONFIG.powerup.respawn) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        const np = world.randomRoadPoint(Math.random, 26, Math.min(CONFIG.world.radius - 10, p.L.areaRadius + 15));
        p.x = np.x; p.z = np.z; p.group.position.set(np.x, 0, np.z); p.group.visible = true; p.active = true;
      }
    }
  }
}

function pickPowerup(p) {
  const D = difficulty(), L = CONFIG.levels[G.level];
  p.active = false; p.group.visible = false; p.respawnT = CONFIG.powerup.respawnDelay;
  G.mumpDur = L.powerupDuration * D.powerupDurationMult;
  G.mumpLeft = G.mumpDur; G.pulseT = 0;
  particles.burst(new THREE.Vector3(p.x, 1.8, p.z), new THREE.Color(0.3, 1.1, 2.4), 90, 9, 1.0);
  particles.burst(new THREE.Vector3(p.x, 1.4, p.z), new THREE.Color(0.35, 0.85, 2.4), 140, 14, 1.2);
  fxs.waves.spawn(player.pos.clone(), CONFIG.powerup.shardRadius * 0.9, 1.1, 0x49c2ff, true);
  fxs.waves.spawn(player.pos.clone(), 9, 0.6, 0x3a9bff);
  G.flash = 1; cam.kick = 1;
  hud.boost();
  sfx.powerup();
}

// ---- dynamic weather: per-level preset (CONFIG.weather.presets) + snowstorm envelope with smooth ramps
const _ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function weatherPreset(level = G.level) {
  const W = CONFIG.weather, L = CONFIG.levels[level];
  return W.presets[L?.weather] || W.presets[W.levels?.[level]] || W.presets.clear;
}
G.wx = { ...weatherPreset(0) }; G.stormLin = 0; G.stormForce = null;
function updateStorm(dt) {
  const W = CONFIG.weather, S = W.storm, D = difficulty(), P = weatherPreset();
  // blend preset values (fog / snow / wind / fall) toward the current level's preset
  const k = 1 - Math.exp(-dt * 3 / Math.max(0.05, W.presetBlend));
  for (const key of ['fog', 'snow', 'wind', 'fall']) G.wx[key] = lerp(G.wx[key], P[key], k);
  // storm intensity 0..1
  if (G.stormForce != null) { // QA / debug: ramp toward the forced value at the configured rates
    const up = G.stormForce > G.stormLin;
    G.stormLin = clamp(G.stormLin + (up ? dt / S.rampIn : -dt / S.rampOut), up ? 0 : G.stormForce, up ? G.stormForce : 1);
    G.storm = _ss(0, 1, G.stormLin);
  } else if (G.state === 'playing' && P.storms) {
    const dur = Math.min(S.every - S.rampIn - S.rampOut - 2, S.duration * D.stormMult);
    const t = G.levelTime - S.firstAt, tt = ((t % S.every) + S.every) % S.every;
    const env = t < 0 ? 0 : _ss(0, S.rampIn, tt) * (1 - _ss(S.rampIn + dur, S.rampIn + dur + S.rampOut, tt));
    G.storm = Math.abs(env - G.storm) > 0.2 ? damp(G.storm, env, 1.5, dt) : env; G.stormLin = G.storm;
  } else { G.storm = damp(G.storm, 0, 1.0, dt); G.stormLin = G.storm; }
  const st = G.storm;
  G.weather = { fog: lerp(G.wx.fog, S.fog, Math.pow(st, 1.3)), snow: lerp(G.wx.snow, S.snow, st), wind: lerp(G.wx.wind, S.wind, st), fall: lerp(G.wx.fall, S.fall, st) };
  scene.fog.density = G.weather.fog;
  scene.fog.color.copy(FOG_COLOR).lerp(STORM_FOG, st); scene.background.copy(scene.fog.color);
  world.sky.material.uniforms.uStorm && (world.sky.material.uniforms.uStorm.value = st);
  hemi.intensity = 0.66 - st * 0.12;
  post.setWeather?.(st);
}

function updateLightPool() {
  const px = player.pos.x, pz = player.pos.z;
  const c = world.lightCandidates;
  const scored = [];
  for (const l of c) { const d = (l.x - px) ** 2 + (l.z - pz) ** 2; if (d < 90 * 90) scored.push([l.always ? d * 0.15 : d, l]); }
  scored.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < lightPool.length; i++) {
    const L = lightPool[i], s = scored[i];
    if (!s) { L.intensity = 0; continue; }
    const l = s[1]; L.position.set(l.x, l.y, l.z); L.color.copy(l.color); L.intensity = l.intensity; L.distance = l.distance;
  }
}

function levelComplete() {
  if (G.state !== 'playing') return;
  G.state = 'levelComplete'; sfx.jingle();
  const last = G.level >= CONFIG.levels.length - 1;
  if (last) { startEnding(); return; }
  const timeLeft = Math.max(0, G.timer);
  showOverlay(`Level ${G.level + 1} complete!`, `Every validator in <b>${CONFIG.levels[G.level].name}</b> got the block.`,
    [['Staked ETH', formatEth(G.score)], [X.resultsLabel, `${G.boosted}/${G.total}`], ['Time left', `${timeLeft.toFixed(1)}s`], [X.bestComboLabel, G.bestCombo > 1 ? `x${G.bestCombo}` : '—']],
    `Next: ${CONFIG.levels[G.level + 1].name}`, () => startLevel(G.level + 1));
}

function gameOver() {
  G.state = 'gameOver'; sfx.fail();
  showOverlay('Slot missed!', `The block didn't reach every validator in time.<br>${G.total - G.delivered} validator${G.total - G.delivered === 1 ? '' : 's'} still waiting.`,
    [['Staked ETH', formatEth(G.score)], [X.resultsLabel, `${G.boosted}/${G.total}`], ['Level', `${G.level + 1}`]],
    'Retry level', () => { G.score = G.levelStartScore; hud.displayScore = G.score; startLevel(G.level); }, 'Title', () => { hideOverlay(); G.score = 0; hud.displayScore = 0; toTitle(); });
}

function startEnding() {
  G.state = 'ending'; G.endingT = 0; G.finalScore = G.score; hud.displayScore = G.score;
  clearLevel();
  // blue wave outward from the tree
  const sorted = [...world.buildings].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  sorted.forEach(b => setTimeout(() => setBuildingBlue(b, true, 1.2), 300 + Math.hypot(b.x, b.z) * 18));
  for (const l of world.lightCandidates) if (!l.always) l._orig ??= l.color.clone();
  for (const l of world.lightCandidates) if (!l.always) setTimeout(() => l.color.copy(WINDOW_BLUE), 300 + Math.hypot(l.x, l.z) * 18);
  hud.show(false); $('touchUI').classList.add('hidden');
  $('endText').textContent = B.endingText;
  $('endSub').textContent = `${B.targetLabel} · ${B.endingSubtext} · ${X.resultsLabel}: ${world.buildings.length} · Your ${B.scoreLabel}: ${formatEth(G.finalScore)}`;
  setTimeout(() => $('ending').classList.remove('hidden'), 2500);
  cam.pos.copy(camera.position);
}

// ------------------------------------------------------------ loop
const clock = new THREE.Clock();
const _v0 = new THREE.Vector3();
let lightT = 0, t = 0;
// ?qa=1: fixed 1/30 s per frame so slow software-GL screenshots are deterministic; advance() steps the sim without rendering
const QA_FIXED = !!params.get('qa');
let simOnly = false;
function loop() {
  requestAnimationFrame(loop);
  const d = clock.getDelta();
  frame(QA_FIXED ? 1 / 30 : Math.min(0.05, d));
}
function frame(dt) {
  t += dt;
  const playing = G.state === 'playing';
  if (playing) {
    G.levelTime += dt; G.timer -= dt; G.bonusFlash -= dt;
    updatePlayer(dt);
    updateDelivery(dt);
    if (G.timer < 10 && Math.floor(G.timer) !== G.lastTick) { G.lastTick = Math.floor(G.timer); if (G.timer > 0) sfx.tick(); }
    if (G.timer <= 0 && G.delivered < G.total) gameOver();
  } else if (G.state !== 'paused') { santa.update(dt, 0, false); }
  if (G.state !== 'paused') {
    updateTargets(dt, t);
    updateStorm(dt);
    world.update(dt, t);
    flights.update(dt);
    particles.update(dt);
    fireworks.update(dt, G.state === 'ending');
    fireworksParticles.update(dt);
    beamMat.uniforms.uT.value = t;
    if (G.state === 'ending') G.endingT += dt;
  }
  updateCamera(dt, t);
  // gift glow + mump2p orbiting shards
  const gp = santa.giftWorldPos(); giftLight.position.copy(gp);
  giftHalo.position.copy(gp); giftHalo.visible = G.state === 'playing' || G.state === 'intro'; giftHalo.material.opacity = (G.mumpLeft > 0 ? 0.5 : 0.3) + Math.sin(t * 3) * 0.05;
  giftLight.intensity = G.mumpLeft > 0 ? 4 + Math.sin(t * 12) * 1.5 : 2.2;
  santa.pulseGift(t);
  shardOrbit.visible = G.mumpLeft > 0; shardOrbit.position.copy(gp);
  boostTrail.update(dt, X.trail && G.mumpLeft > 0 && G.state === 'playing', player.pos);
  for (const tg of G.targets) if (tg.label) { tg.label.position.y = tg.label.userData.baseY + Math.sin(t * 2 + tg.b.id) * 0.15; }
  if (shardOrbit.visible) shardOrbit.children.forEach(m => { const a = m.userData.a + t * 4; m.position.set(Math.cos(a) * 0.55, Math.sin(a * 2 + m.userData.tilt) * 0.25, Math.sin(a) * 0.55); m.rotation.y = a * 2; });
  // lights / shadow follow
  lightT -= dt; if (lightT <= 0) { lightT = 0.12; updateLightPool(); }
  const focus = G.state === 'playing' || G.state === 'paused' || G.state === 'levelComplete' || G.state === 'gameOver' ? player.pos : new THREE.Vector3();
  moon.position.set(focus.x + 35, 70, focus.z + 22); moon.target.position.copy(focus);
  snow.update(t, _v0.set(camera.position.x, 0, camera.position.z), G.storm, G.weather);
  if (G.state !== 'title' && G.state !== 'ending') {
    const S = { score: G.score, delivered: G.delivered, total: G.total, timer: G.timer, level: G.level, levelName: CONFIG.levels[G.level].name, mump: G.mumpLeft > 0, mumpLeft: G.mumpLeft, mumpDur: G.mumpDur, inRange: G.inRange || 0, powerupsLeft: G.powerups.filter(p => p.active).length, storm: G.storm, hint: G.hint, bonusFlash: G.bonusFlash };
    hud.update(dt, S);
    const left = X.comboWindow - (G.levelTime - G.lastDeliverT);
    hud.combo(left > 0 && G.state === 'playing' ? G.combo : 0, comboMult(G.combo), Math.max(0, left / X.comboWindow));
    hud.drawMinimap({ player: player.pos, heading: player.heading, camYaw: cam.yaw, targets: G.targets, powerups: G.powerups, ice: G.ice, areaRadius: CONFIG.levels[G.level].areaRadius, mump: G.mumpLeft > 0 });
  }
  // --- FX layer
  const camDist = camera.position.distanceTo(santa.root.position);
  fxs.cones?.update(dt, t, G.storm);
  fxs.smoke?.update(t, G.storm, renderer.domElement.height, camera.fov);
  fxs.feet?.update(t, player.pos, player.heading, playing && !G.onIce && player.speed > 0.3);
  fxs.sparkles?.update(t, player.pos);
  fxs.waves.update(dt);
  for (const L of fxs.snowLayers) L.s.update(t, L.near ? camera.position : _v0.set(camera.position.x, 0, camera.position.z), G.storm, G.weather);
  G.flash = Math.max(0, (G.flash || 0) - dt * 2.2);
  const dofFocus = G.state === 'title' ? cam.pos.distanceTo(cam.look) : G.state === 'ending' ? 200 : camDist;
  post.update(t, { focus: dofFocus, boost: G.mumpLeft > 0 ? 0.6 + 0.4 * Math.sin(t * 4) : 0, flash: G.flash, storm: G.storm });
  if (simOnly) return;
  post.render();
  governor.tick(dt, G.state === 'playing' || G.state === 'title');
  // perf stats
  const now = performance.now(); perf.frames.push(now - perf.last); perf.last = now; if (perf.frames.length > 240) perf.frames.shift();
}

function debugAPI() {
  return {
    G, player, CONFIG, renderer, world, santa, scene, camera, post,
    get state() { return G.state; },
    start: (lv = 0) => { initAudio(false); startLevel(lv); },
    completeLevel: () => { for (const tg of G.targets) deliver(tg); },
    deliverSome: (n) => { G.targets.filter(t => !t.delivered).slice(0, n).forEach(deliver); },
    givePowerup: () => { const p = G.powerups.find(p => p.active) || G.powerups[0]; pickPowerup(p); },
    teleport: (x, z, heading) => { player.pos.set(x, 0, z); if (heading !== undefined) { player.heading = heading; cam.yaw = heading; } cam.pos.set(x, 30, z); },
    teleportNearTarget: (i = 0, back = 6) => { const tg = G.targets[i]; const b = tg.b; const x = b.trigger.x + b.front.x * back, z = b.trigger.z + b.front.z * back; player.pos.set(x, 0, z); player.heading = Math.atan2(-b.front.x, -b.front.z); cam.yaw = player.heading; },
    skipToEnding: () => { G.level = CONFIG.levels.length - 1; G.state = 'playing'; levelComplete(); },
    // setStorm(1) ramps the storm in (rampIn s), setStorm(0) clears it (rampOut s), setStorm(null) = back to the level schedule
    setStorm: (v) => { G.stormForce = v == null ? null : +v; },
    weather: () => ({ preset: CONFIG.levels[G.level]?.weather, storm: +G.storm.toFixed(3), ...Object.fromEntries(Object.entries(G.weather || {}).map(([k, v]) => [k, +v.toFixed(4)])) }),
    fps: () => { const f = perf.frames; const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length); return { avgFrameMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), samples: f.length }; },
    cam: (pos, look, fov) => { G.camOverride = pos ? { pos, look, fov } : null; },
    fx: () => ({ quality: Q, governor: governor.applied, chimneys: world.buildings.filter(b => b.chimney).length, lamps: fxs.cones?.lamps.length || 0, env: !!scene.environment }),
    santaPos: () => player.pos.toArray(),
    advance: (sec, step = 1 / 30) => { simOnly = true; try { for (let i = 0; i < Math.round(sec / step); i++) frame(step); } finally { simOnly = false; } return G.state; },
    info: () => ({ quality: Q.name, buildings: world.buildings.length, bulbs: world.bulbs.length, pines: world.streetPines?.length, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}

boot().catch(e => { console.error(e); $('loading').innerHTML = `<div style="color:#f88">Failed to start: ${e.message}</div>`; });
