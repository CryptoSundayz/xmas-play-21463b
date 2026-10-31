// Santa's Block Delivery — game bootstrap, loop and state machine.
import * as THREE from 'three';
import { PostFX, loadEnvironment, LampCones, Footprints, SnowPuffs, ChimneySmoke, Sparkles, Shockwaves, Governor } from './fx.js?v=9e6ba718';
import { CONFIG, applyUrlOverrides, resolveQuality, difficulty, ethPerBlock, formatEth, comboMult, fmt } from './config.js?v=9e6ba718';
import { initAssets } from './assets.js?v=9e6ba718';
import { World } from './world.js?v=9e6ba718';
import { Interiors } from './interiors.js?v=9e6ba718';
import { PineSystem } from './pines.js?v=9e6ba718';
import { createSanta } from './santa.js?v=9e6ba718';
import { Input } from './input.js?v=9e6ba718';
import { HUD } from './hud.js?v=9e6ba718';
import { Snow, Particles, Flights, Fireworks } from './effects.js?v=9e6ba718';
import { makeLogoMesh, logoSVG } from './logo.js?v=9e6ba718';
import { WINDOW_WARM, WINDOW_BLUE } from './materials.js?v=9e6ba718';
import { InstanceCuller } from './lowcull.js?v=9e6ba718';
import { initAudio, resumeAudio, sfx, music, audioState, configureAudio, audioStatus, renderEndingOffline } from './audio.js?v=9e6ba718';
import { progress, starsFor, titleFor } from './progress.js?v=9e6ba718';
import { drawScoreCard, showCardUI, hideCardUI } from './scorecard.js?v=9e6ba718';
import { cosmetics, SLOTS, ITEMS, BY_ID } from './cosmetics.js?v=9e6ba718';
import { applyLook, Trail } from './costume.js?v=9e6ba718';
import { createLeaderboard, NAME_MAX } from './leaderboard.js?v=9e6ba718';
import { Obstacles, planStage, routeCheck } from './obstacles.js?v=9e6ba718';
import { RouteGraph } from './routegraph.js?v=9e6ba718';
import { rng, clamp, lerp, damp, angleDamp, angleDiff, glowTexture, textTexture, worldUV } from './util.js?v=9e6ba718';

applyUrlOverrides();
const params = new URLSearchParams(location.search);
const Q = resolveQuality();
const QA_FIXED_EARLY = !!params.get('qa');
const DEBUG = params.get('debug') === '1';
const B = CONFIG.branding;
const X = CONFIG.boosted;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);
const $ = id => document.getElementById(id);

// ------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
// ---- NaN-proof GLSL (Mac/Metal black patches): every shader the renderer compiles (three chunks, our ShaderMaterials,
// post passes) gets a safe normalize (zero-length -> 0 instead of NaN) and a safe pow (negative/zero base clamped);
// on Metal fast-math those NaNs survive into the HDR buffer and bloom smears them into black rectangles.
{
  const gl = renderer.getContext(), src0 = gl.shaderSource.bind(gl);
  const DEF = '#define SN(v) ((v) * inversesqrt(max(dot((v), (v)), 1e-12)))\n#define SPOW(a, b) pow(max((a), 1e-6), (b))\n#define RSTEP(a, b, x) (1.0 - smoothstep((a), (b), (x)))\n';
  gl.shaderSource = (sh, src) => {
    if (CONFIG.debug?.unsafeGLSL) return src0(sh, src);
    let s = src.replace(/\bnormalize\s*\(/g, 'SN(').replace(/\bpow\s*\(/g, 'SPOW(')
      // smoothstep(e0, e1, x) with e0 >= e1 is undefined in GLSL (Metal may return garbage) -> 1 - smoothstep(e1, e0, x)
      .replace(/\bsmoothstep\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g, (all, a, b) => (+a >= +b ? `RSTEP(${b}, ${a},` : all));
    const m = s.match(/^\s*#version[^\n]*\n/);
    s = m ? m[0] + DEF + s.slice(m[0].length) : DEF + s;
    return src0(sh, s);
  };
}
// ---- robust sizing: visualViewport (iOS address bar / rotation), drawing buffer capped to the GPU limits + a pixel budget
const PERF = CONFIG.performance;
const GL_MAX = (() => { const gl = renderer.getContext(); return Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [16384])); })();
let dynScale = 1;
function viewSize() {
  const vv = window.visualViewport;
  const w = Math.round(vv?.width || innerWidth) || innerWidth, h = Math.round(vv?.height || innerHeight) || innerHeight;
  return [Math.max(1, w), Math.max(1, h)];
}
function pixelRatioFor(w, h) {
  let pr = Math.min(devicePixelRatio || 1, Q.pixelRatio) * dynScale;
  const budget = Q.ios ? PERF.ios.maxPixels : Q.mobile ? PERF.maxPixels.mobile : PERF.maxPixels.desktop;
  pr = Math.min(pr, Math.sqrt(budget / (w * h)), (GL_MAX - 2) / w, (GL_MAX - 2) / h);
  return Math.max(0.35, pr);
}
renderer.setPixelRatio(pixelRatioFor(...viewSize()));
renderer.setSize(...viewSize(), false); // no inline px style: CSS keeps the canvas at 100% x 100%
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
{ const S = CONFIG.performance.shadowFrustum; Object.assign(moon.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 160 }); }
moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.035; moon.shadow.radius = Q.shadowMapSize >= 4096 ? 4 : 3; moon.shadow.blurSamples = 16;
scene.add(moon, moon.target);
// the shadow map is re-rendered only when something in it changed (see updateShadow), not unconditionally every frame
renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;

// pooled point lights (windows, lamps, tree) — fixed count => no shader recompiles
const lightPool = [];
for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffaa66, 0, 16, 2); scene.add(l); lightPool.push(l); }

// post stack: [GTAO] -> bloom -> output (tone map) -> DOF + grade + vignette + grain
const post = new PostFX(renderer, scene, camera, Q, CONFIG.bloom, LOOK);
const bloom = post.bloom;
post.weatherPost = CONFIG.weather.post;
if (!Q.grade) document.body.classList.add('cssVignette');
let _sizeKey = '';
function applySize(force = false) {
  const [w, h] = viewSize(), pr = pixelRatioFor(w, h), key = `${w}x${h}@${pr.toFixed(3)}`;
  if (!force && key === _sizeKey) return; _sizeKey = key;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  // updateStyle=false: the canvas CSS box stays 100% x 100% (style.css #c), so it always follows the window on rotation
  // even if iOS reports a stale visualViewport size for a moment; inline px sizes used to pin the old orientation
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false); post.setSize(w, h);
  document.documentElement.style.setProperty('--vh', h + 'px');
}
// rotation / resize: iOS Safari reports the new viewport late (and visualViewport sometimes after resize), so size now
// and force re-checks ~300 ms and ~900 ms later. Rotation is never locked (manifest orientation: any, no orientation.lock).
let _reT1 = 0, _reT2 = 0;
function onViewChange() {
  applySize(); clearTimeout(_reT1); clearTimeout(_reT2);
  _reT1 = setTimeout(() => applySize(true), 300); _reT2 = setTimeout(() => applySize(true), 900);
}
addEventListener('resize', onViewChange);
addEventListener('orientationchange', onViewChange);
window.visualViewport?.addEventListener('resize', onViewChange);
screen.orientation?.addEventListener?.('change', onViewChange);
matchMedia('(orientation: portrait)').addEventListener?.('change', onViewChange);
document.addEventListener('fullscreenchange', () => setTimeout(() => applySize(true), 100));
document.addEventListener('webkitfullscreenchange', () => setTimeout(() => applySize(true), 100));
// WebGL context loss (iOS drops the context when the tab is backgrounded, e.g. after 'Post on X', or on GPU reset).
// Recover in place: three re-creates programs / buffers / textures / render targets lazily after 'webglcontextrestored';
// we re-bake the only GPU-only content (night IBL, pine impostors), resize the composer and redraw shadows. If no
// restore arrives within ~2 s of the page being visible, a small 'Tap to resume' card reloads (progress is in localStorage).
const CTX = { lost: false, timer: 0, gen: 0 };
function ctxOverlay(show) {
  let d = document.getElementById('ctxLost');
  if (!show) { d?.remove(); return; }
  if (d) return;
  d = document.createElement('div'); d.id = 'ctxLost'; d.textContent = 'Graphics were paused by the device - tap to resume';
  d.onclick = () => location.reload(); document.body.appendChild(d);
}
function armCtxFallback() {
  clearTimeout(CTX.timer); if (document.hidden) return; // wait until the page is visible again
  CTX.timer = setTimeout(() => { if (CTX.lost) ctxOverlay(true); }, 2000);
}
async function restoreGraphics() {
  const gen = ++CTX.gen;
  clearTimeout(CTX.timer);
  if (Q.env) { const old = scene.environment; if (await loadEnvironment(renderer, scene, LOOK.hdri, LOOK.envIntensity) && old && old !== scene.environment) old.dispose(); }
  if (gen !== CTX.gen || renderer.getContext().isContextLost()) return; // lost again meanwhile
  pines?.rebake?.(renderer);
  applySize(true); renderer.shadowMap.needsUpdate = true; _sh.n = 0; _sh.x = 1e9;
  CTX.lost = false; G.contextLost = false; ctxOverlay(false);
  console.info('[gfx] WebGL context restored in place');
}
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); CTX.lost = true; G.contextLost = true; armCtxFallback(); }, false);
canvas.addEventListener('webglcontextrestored', () => { restoreGraphics().catch(err => { console.warn('[gfx] restore failed', err); ctxOverlay(true); }); }, false);
// back from another app / tab (visibilitychange) or from the bfcache (pageshow persisted): resize, redraw, resume audio
function onPageBack() {
  if (document.hidden) return;
  try { screen.orientation?.unlock?.(); } catch (e) { /* not supported */ }
  onViewChange(); renderer.shadowMap.needsUpdate = true;
  if (renderer.getContext().isContextLost()) { CTX.lost = true; G.contextLost = true; }
  if (CTX.lost) armCtxFallback();
  resumeAudio();
}
document.addEventListener('visibilitychange', onPageBack);
addEventListener('pageshow', onPageBack);
// runtime fallback for weak devices (only when quality = auto)
const governor = new Governor(!Q.auto || QA_FIXED_EARLY ? [] : [
  { name: 'mascot fur shells + flame light off', apply: () => santa?.lowFx?.() },
  { name: 'DOF off', apply: () => post.setDof(false) },
  { name: 'GTAO off', apply: () => post.setAO(false) },
  { name: 'light shafts + smoke off', apply: () => { if (fxs.cones) fxs.cones.mesh.visible = false; if (fxs.smoke) fxs.smoke.points.visible = false; } },
  { name: 'render scale floor 0.5', apply: () => { PERF.minScale = Math.min(PERF.minScale, 0.5); } },
  { name: 'shadows off', apply: () => { renderer.shadowMap.enabled = false; moon.castShadow = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); } },
  { name: 'bloom off', apply: () => post.setBloom(false) },

], { minFps: Math.round(PERF.targetFps * 0.75), window: 3, warmup: 5 });
const fxs = {};

// ------------------------------------------------------------ globals
let trail;
let nav, pines, world, santa, input, hud, snow, particles, fireworksParticles, flights, fireworks, giftLight, giftHalo, shardOrbit, boostTrail, interiors;
const G = {
  state: 'loading', level: 0, timer: 0, score: 0, levelStartScore: 0, levelTime: 0, total: 0, delivered: 0,
  targets: [], powerups: [], ice: [], mumpLeft: 0, mumpDur: 1, pulseT: 0, storm: 0, bonusFlash: 0,
  gossipBusy: false, hint: '', endingT: 0, lastTick: 0, levelObjects: [],
  combo: 0, bestCombo: 0, lastDeliverT: -1e9, boosted: 0, totalBoosted: 0,
};
import { Nav } from './nav.js?v=9e6ba718';
const _dbs = new THREE.Vector2();
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, speed: 0, jy: 0, vy: 0, air: false, coyote: 0, jumpBuf: 0, sprintK: 0, holdT: 0, surfY: 0, paved: false };
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), dist: CONFIG.camera.distance };
const perf = { frames: [], last: performance.now() };
let graph = null, obstacles = null; // stage road graph (route check) + stage obstacles

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
  { // needle-card pines (street + forest), impostor LOD beyond nearRange
    const T = (world.pineTrees || []).map(t => ({ ...t, y: (world.heightAt ? world.heightAt(t.x, t.z) : 0) - 0.12 }));
    pines = new PineSystem(scene, renderer, T, { variants: 2, nearRange: PERF.pineNearRange * (Q.name === 'low' ? 0.6 : 1), msaa: Q.msaa, shadows: Q.shadows });
    pines.update(camera.position, 0, true);
    if (DEBUG || params.get('qa')) world.floatingDecor(T.map(t => ({ kind: t.mini ? 'miniTree' : 'pine', x: t.x, y: t.y, z: t.z })));
    if (DEBUG) setTimeout(() => { try { world.decorGaps(0.03, 10); } catch (e) { console.warn('[decor] audit failed', e); } }, 1500);
  }
  if (CONFIG.interiors?.enabled !== false) { try { interiors = new Interiors(world, scene, Q.name, CONFIG.interiors); } catch (e) { console.warn('[interiors] disabled:', e); } }
  santa = createSanta(Q.name); scene.add(santa.root);
  santa.root.traverse(o => { if (o.isMesh && !o.name.startsWith('mascot')) o.castShadow = true; });
  cosmetics.check(); // record already-earned items silently (toasts are only for unlocks earned in a run)
  applyLook(santa, cosmetics.look());
  giftLight = new THREE.PointLight(0x3f9dff, 5, 9, 2); scene.add(giftLight);
  // soft additive halo so the carried gift reads from the chase camera
  giftHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x4aa8ff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  giftHalo.scale.setScalar(1.6); giftHalo.renderOrder = 5; scene.add(giftHalo);
  input = new Input(canvas); input.onPause = togglePause;
  hud = new HUD(world);
  nav = new Nav(scene);
  graph = new RouteGraph(world.roads, CONFIG.world.squareRadius);
  obstacles = new Obstacles(scene, world, { onHit: hitPlayer, onEvent: obstacleEvent });
  // layered snow: main fall, far fine dust, near soft "bokeh" flakes
  snow = new Snow(scene, Q.snowCount);
  fxs.snowLayers = [];
  if (Q.snowLayers > 1) fxs.snowLayers.push({ s: new Snow(scene, Math.round(Q.snowCount * 0.8), { box: 170, h: 70, size: 0.1, opacity: 0.55, speed: 0.7 }), near: false });
  if (Q.snowLayers > 2) fxs.snowLayers.push({ s: new Snow(scene, 140, { box: 18, h: 12, size: 0.3, opacity: 0.22, speed: 0.55, soft: 1 }), near: true });
  if (Q.shafts) fxs.cones = new LampCones(scene, world.lightCandidates.filter(l => l.lamp), LOOK.lampShaftIntensity);
  if (Q.smoke) { const src = world.buildings.filter(b => b.chimney).map(b => b.chimney); if (src.length) fxs.smoke = new ChimneySmoke(scene, src, Q.name === 'high' ? 24 : 16); }
  if (Q.footprints) fxs.feet = new Footprints(scene, 240);
  if (fxs.feet) fxs.feet.heightAt = world.heightAt;
  fxs.puffs = new SnowPuffs(scene, Q.name === 'low' ? 160 : 400);
  santa.onStep = (wp, side, k) => { // a boot planted: crunch/tap sound, print + kick-up on snow only
    if (player.air || G.state !== 'playing') return;
    sfx.step(k, player.paved || G.onIce ? 'stone' : 'snow');
    if (player.paved || G.onIce) return;
    fxs.feet?.stamp(wp.x, wp.z, player.heading, fxs.feet.uniforms.uTime.value, player.surfY - 0.01);
    if (CONFIG.character.grounding.stepPuffs) fxs.puffs.kick(wp.x, player.surfY + 0.03, wp.z, Math.sin(player.heading), Math.cos(player.heading), 4 + Math.round(k * 5), 0.6 + k * 0.6);
  };
  if (Q.sparkle) fxs.sparkles = new Sparkles(scene, Q.name === 'high' ? 1800 : 1000);
  fxs.waves = new Shockwaves(scene);
  if (Q.name === 'low') applyLow(true);
  particles = new Particles(scene, 2500, 0.35);
  trail = new Trail(scene, particles, Q.name);
  fireworksParticles = new Particles(scene, 7000, 0.9);
  flights = new Flights(scene, particles);
  flights.onImpact = (p) => fxs.waves.spawn(p.clone().setY(0), 3.2, 0.55, 0x6fd0ff);
  fireworks = new Fireworks(scene, fireworksParticles);
  fireworks.onLaunch = r => sfx.firework(r.logo ? 1 : 0.45 + Math.random() * 0.3, r.fuse);
  shardOrbit = makeShardOrbit(); scene.add(shardOrbit);
  boostTrail = makeBoostTrail(); scene.add(boostTrail.mesh);
  // MEDIUM / HIGH: whole-map instanced props (fences, lamps, decor kits, snowmen...) only draw what is near the
  // camera or inside its (widened) view cone - nothing on screen is dropped, the rest no longer costs main + shadow pass
  if (Q.name !== 'low' && PERF.viewCull !== false) culler = new InstanceCuller(scene, { radius: PERF.viewCullNear ?? 40, view: true, far: camera.far, margin: 0.28 });

  // title camera
  resetPlayer();
  bindUI();
  $('loading').classList.add('hidden');
  G.state = 'title';
  window.__xmas = debugAPI();
  requestAnimationFrame(loop);
}

// LOW preset extras (load time for ?quality=low, or live when LOW is picked in the menu - no reload):
// no composer (direct renderer.render, so no bloom / NaN pass / luminance probe), no shadows, no point lights,
// pixel ratio 1 (0.75 on >=3x phones), per-house static merge, distance-culled instancing, near LOD switch,
// short draw distance hidden in fog. The governor / dynamic resolution never touch an explicit preset.
let culler = null, lowApplied = false, lowChunkInfo = null;
function applyLow(atLoad = false) {
  if (lowApplied) return; lowApplied = true;
  const L = CONFIG.qualityPresets.low;
  if (!atLoad) { // live switch: copy the preset over the running Q
    Object.assign(Q, L, { name: 'low', auto: false });
    if (Q.mobile && (devicePixelRatio || 1) >= 3) Q.pixelRatio = 0.75;
  }
  post.enabled = false;                                  // renderer.render direct
  renderer.shadowMap.enabled = false; moon.castShadow = false;
  for (const l of lightPool) { l.intensity = 0; l.visible = false; }
  lightPool.length = 0; if (giftLight) giftLight.visible = false;
  for (const k of ['cones', 'smoke', 'sparkles']) { const f = fxs[k]; const o = f?.mesh || f?.points || f?.group; if (o) o.visible = false; }
  for (const L2 of fxs.snowLayers || []) L2.s.points && (L2.s.points.visible = false);
  dyn.on = false; dynScale = 1; governor.steps.length = 0;
  document.body.classList.add('cssVignette');
  lowChunkInfo = world.chunkStatic(L.chunkCell ?? 40, !!L.bakeInstances); console.info('[low] chunks', lowChunkInfo);
  scene.traverse(o => { if (o.isLOD && o.levels.length > 1) o.levels[1].distance = Math.min(o.levels[1].distance, L.lodDistance ?? 26); });
  const holders = new Set(world.buildings.map(b => b.holder)), props = [], _bs = new THREE.Box3(), _sz = new THREE.Vector3();
  for (const c of world.root.children) {
    if (holders.has(c) || c === world.lowChunks || c.isInstancedMesh || c.isPoints || /snowTerrain|stringLights|road|path/i.test(c.name || '')) continue;
    let inst = false; c.traverse(o => { if (o.isInstancedMesh || o.isPoints) inst = true; }); if (inst) continue;
    _bs.setFromObject(c).getSize(_sz); if (_sz.x > 24 || _sz.z > 24) continue;
    props.push(c);
  }
  culler?.dispose();
  culler = new InstanceCuller(scene, { radius: L.cullRadius ?? 55, props, propRadius: L.propRadius ?? 55 });
  camera.far = L.far ?? 160; camera.updateProjectionMatrix();
  if (!atLoad) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); // lights/shadows changed
  applySize(true);
}
function bindUI() {
  $('selQuality').addEventListener('change', e => { // LOW applies live; other presets rebuild the world on Play
    if (e.target.value !== 'low') return;
    applyLow(); CONFIG.quality = 'low';
    const u = new URL(location.href); u.searchParams.set('quality', 'low'); history.replaceState(null, '', u.toString());
  });
  $('playBtn').onclick = () => {
    const q = $('selQuality').value;
    CONFIG.difficulty = $('selDifficulty').value;
    if (q !== CONFIG.quality) { // quality affects world build -> reload with param (keeps the chosen stage)
      const u = new URL(location.href); u.searchParams.set('quality', q); u.searchParams.set('level', chosenStage() + 1); u.searchParams.set('difficulty', CONFIG.difficulty); u.searchParams.set('autostart', '1'); location.href = u.toString(); return;
    }
    const lv = chosenStage();
    initAudio(CONFIG.audio);
    G.score = CONFIG.levels.slice(0, lv).reduce((s, l) => s + l.validators, 0) * ethPerBlock();
    hud.displayScore = G.score;
    startLevel(lv);
  };
  $('stagesBtn').onclick = () => { renderStages(); $('title').classList.add('hidden'); $('stages').classList.remove('hidden'); };
  $('stBack').onclick = () => { $('stages').classList.add('hidden'); $('title').classList.remove('hidden'); };
  $('wardBtn').onclick = openWardrobe; $('wardBack').onclick = closeWardrobe; bindWardrobeDrag(); updateWardDot();
  $('lbBtn').onclick = openBoard; $('bdBack').onclick = closeBoard; bindBoard();
  if (params.get('unlock') === 'all' && (params.get('qa') || DEBUG)) progress.unlockAll(CONFIG.levels.length);
  updatePlayLabel();
  $('pauseBtn').onclick = togglePause;
  bindAudioUI(); bindScreenUI();
  $('endBtn').onclick = () => { $('ending').classList.add('hidden'); $('endCardBtn').classList.add('hidden'); hideOverlay(); G.score = 0; G.totalBoosted = 0; hud.displayScore = 0; resetVillageLights(); startLevel(0); };
  if (params.get('autostart')) setTimeout(() => $('playBtn').click(), 50);
}

// ---- leaderboard screen: overall + per-stage top 50, your rank, name entry
const BD = { board: 'all', seq: 0 };
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (t) => { t = +t || 0; const m = Math.floor(t / 60); return m ? `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${t.toFixed(1)}s`; };
function openBoard(board) {
  if (typeof board === 'number' || board === 'all') BD.board = board;
  $('title').classList.add('hidden'); $('board').classList.remove('hidden');
  $('bdNameIn').value = lb.name; $('bdNameMsg').textContent = ''; renderBoard();
}
function closeBoard() { $('board').classList.add('hidden'); $('title').classList.remove('hidden'); }
function bindBoard() {
  $('bdNameIn').maxLength = NAME_MAX;
  for (const ev of ['keydown', 'keyup']) $('bdNameIn').addEventListener(ev, e => e.stopPropagation()); // typing must not jump / pause / mute
  $('bdName').onsubmit = async (e) => {
    e.preventDefault(); const msg = $('bdNameMsg'); msg.className = ''; msg.textContent = '…';
    const r = await lb.setName($('bdNameIn').value);
    msg.className = r.ok ? 'ok' : 'bad'; msg.textContent = r.ok ? (r.offline ? 'Saved on this device' : 'Saved ✓') : r.why;
    if (r.ok) { $('bdNameIn').value = r.name; renderBoard(); }
  };
}
async function renderBoard() {
  const n = CONFIG.levels.length, b = BD.board, seq = ++BD.seq;
  $('bdTabs').innerHTML = `<button data-b="all" class="${b === 'all' ? 'on' : ''}">Overall</button>` +
    CONFIG.levels.map((L, i) => `<button data-b="${i + 1}" class="${b === i + 1 ? 'on' : ''}" title="${esc(L.name)}">${i + 1}</button>`).join('');
  for (const el of $('bdTabs').querySelectorAll('button')) el.onclick = () => { BD.board = el.dataset.b === 'all' ? 'all' : +el.dataset.b; renderBoard(); };
  $('bdTabs').querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  $('bdSub').textContent = b === 'all' ? `Overall · best run per stage, summed` : `Stage ${b} · ${CONFIG.levels[b - 1].name}`;
  $('bdList').innerHTML = '<li class="empty">Loading…</li>';
  const r = await lb.top(b); if (seq !== BD.seq) return;
  $('bdNote').textContent = r.note || r.error || ''; $('bdNote').classList.toggle('hidden', !(r.note || r.error));
  $('bdMe').innerHTML = r.me ? `You: <b>#${r.me.rank}</b>${r.players ? ` of ${r.players}` : ''} · ${formatEth(r.me.eth)} ETH · ${fmtT(r.me.time)} · ${r.me.stars}★`
    : `You: <i>${b === 'all' ? 'clear a stage' : `clear stage ${b}`} to get ranked</i>`;
  $('bdList').innerHTML = r.entries.length ? r.entries.map(e => `<li class="${e.me ? 'me' : ''}${e.rank <= 3 ? ' top' + e.rank : ''}"><span class="rk">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span><span class="nm">${esc(e.name)}</span><span class="eth">${formatEth(e.eth)}</span><span class="tm">${fmtT(e.time)}</span><span class="sr">${e.stars}★</span></li>`).join('')
    : `<li class="empty">${r.error ? 'Couldn’t load the board.' : 'No runs yet — be the first Santa here!'}</li>`;
}

// ---- wardrobe: slot tabs + item grid over a live close-up of the mascot (title scene, slow turntable)
const WD = { slot: 'hat', preview: null, yaw: 0, spin: 0.55, drag: null };
function updateWardDot() { const n = cosmetics.newCount(), d = $('wardNew'); if (!d) return; d.textContent = n; d.classList.toggle('hidden', !n); }
function openWardrobe() {
  $('title').classList.add('hidden'); $('wardrobe').classList.remove('hidden');
  G.wardrobe = true; WD.yaw = player.heading + 0.5; WD.preview = null; WD.camInit = false; WD.box = null; renderWardrobe(); wardrobeGift();
}
function closeWardrobe() {
  cosmetics.markSeen(WD.slot); G.wardrobe = false; WD.preview = null; applyLook(santa, cosmetics.look());
  camera.clearViewOffset(); santa.root.rotation.y = player.heading; $('wardrobe').classList.add('hidden');
  wardrobeGift(); wardrobeLights(false);
 $('title').classList.remove('hidden'); updateWardDot();
}
// the carried gift hides the suit: only shown in the wardrobe on the Back tab (it is part of the back-item silhouette)
function wardrobeGift() { santa.gift.visible = !G.wardrobe || WD.slot === 'back'; }
// ---- wardrobe preview light rig. Root cause of the near-black preview: the mascot is lit only by the night rig
// (deep-blue hemisphere + a moon fixed at (35,70,22) that back-lights it for half the turntable + a damped night IBL);
// on LOW there are no point lights at all (pool = 0, gift light hidden), on MEDIUM/HIGH the only near light is the
// blue gift light that tints the suit. The rig re-uses the EXISTING moon + hemisphere (same light count => no shader
// recompile, no extra per-fragment cost): while the wardrobe is open the moon becomes a warm camera-side key that
// follows the camera, the hemisphere a neutral fill, the gift light is dimmed, and a soft additive backdrop glow sits
// behind the mascot so it separates from the night. Everything is restored the frame the wardrobe closes.
const WL = { on: false, moonCol: new THREE.Color(), hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(), backdrop: null,
  key: new THREE.Color(0xfff0dc), sky: new THREE.Color(0xc4d2f0), gnd: new THREE.Color(0x5c5058) };
const _wlK = new THREE.Vector3();
function wardrobeLights(on) {
  if (on && !WL.on) { WL.moonCol.copy(moon.color); WL.hemiSky.copy(hemi.color); WL.hemiGnd.copy(hemi.groundColor); }
  if (!on && WL.on) { moon.color.copy(WL.moonCol); hemi.color.copy(WL.hemiSky); hemi.groundColor.copy(WL.hemiGnd); renderer.shadowMap.needsUpdate = true; _sh.n = 0; _sh.x = 1e9; }
  WL.on = on;
  if (!WL.backdrop) {
    WL.backdrop = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7fa6e6, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    WL.backdrop.renderOrder = -1; WL.backdrop.visible = false; scene.add(WL.backdrop);
  }
  WL.backdrop.visible = on;
  if (!on) return;
  const base = santa.root.position;
  // key: from the camera side, up and to the left (camera-relative so the turntable is lit at every angle)
  _wlK.subVectors(camera.position, base).setY(0).normalize();
  const sx = _wlK.z, sz = -_wlK.x; // camera-right
  _wlK.set(_wlK.x * 0.8 - sx * 0.55, 0.95, _wlK.z * 0.8 - sz * 0.55).normalize();
  moon.position.copy(base).addScaledVector(_wlK, 40); moon.target.position.copy(base); moon.target.updateMatrixWorld();
  moon.color.copy(WL.key); moon.intensity = 2.2;
  hemi.color.copy(WL.sky); hemi.groundColor.copy(WL.gnd); hemi.intensity = 1.1;
  if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
  giftLight.intensity = santa.gift.visible ? 0.6 : 0; // the blue gift light tinted the suit (gift hidden => off)
  // backdrop glow: behind the mascot (away from the camera), at chest height
  _wlK.subVectors(base, camera.position).setY(0).normalize();
  WL.backdrop.position.set(base.x + _wlK.x * 2.2, base.y + 1.0, base.z + _wlK.z * 2.2); WL.backdrop.scale.setScalar(4.2);
}
function previewLook() { const L = cosmetics.look(); if (WD.preview) L[WD.preview.slot] = WD.preview; applyLook(santa, L); }
function renderWardrobe() {
  const [u, n] = cosmetics.counts();
  $('wardCount').textContent = `${u} / ${n} unlocked`;
  $('wardTabs').innerHTML = SLOTS.map(s => `<button class="wTab${s.id === WD.slot ? ' on' : ''}" data-s="${s.id}"><span class="ic">${s.icon}</span><span class="tl">${s.name}</span>${cosmetics.newCount(s.id) ? '<i class="dot"></i>' : ''}</button>`).join('');
  const eq = cosmetics.equippedId(WD.slot);
  $('wardGrid').innerHTML = ITEMS.filter(i => i.slot === WD.slot).map(it => {
    const open = cosmetics.isUnlocked(it), [c, nd] = cosmetics.reqProgress(it), sel = WD.preview?.id === it.id;
    const rq = open ? (it.id === eq ? '✓ Equipped' : cosmetics.isNew(it) ? 'NEW' : 'Tap to wear') : `🔒 ${cosmetics.reqText(it)}${nd > 1 ? ` · ${c}/${nd}` : ''}`;
    return `<button class="wItem${open ? '' : ' locked'}${it.id === eq ? ' eq' : ''}${sel ? ' sel' : ''}${cosmetics.isNew(it) ? ' new' : ''}" data-id="${it.id}">
      <span class="sw${it.sw === 'none' ? ' none' : ''}" style="background:${it.sw === 'none' ? 'transparent' : it.sw}"></span><span class="nm">${it.name}</span><span class="rq">${rq}</span></button>`;
  }).join('');
  const cur = WD.preview || BY_ID[eq];
  $('wardInfo').innerHTML = WD.preview && !cosmetics.isUnlocked(WD.preview)
    ? `Previewing <b>${cur.name}</b> · 🔒 ${cosmetics.reqText(cur)} (${cosmetics.reqProgress(cur).join('/')})`
    : `Wearing <b>${cur.name}</b> ${SLOTS.find(s => s.id === WD.slot).name.toLowerCase()}`;
  for (const b of $('wardTabs').children) b.onclick = () => { cosmetics.markSeen(WD.slot); WD.slot = b.dataset.s; WD.preview = null; previewLook(); wardrobeGift(); WD.box = null; sfx.hold?.(); renderWardrobe(); };
  for (const b of $('wardGrid').children) b.onclick = () => {
    const it = BY_ID[b.dataset.id];
    if (cosmetics.isUnlocked(it)) { cosmetics.equip(it.id); WD.preview = null; sfx.equip?.(); }
    else { WD.preview = WD.preview?.id === it.id ? null : it; sfx.locked?.(); }
    previewLook(); renderWardrobe();
  };
}
function bindWardrobeDrag() {
  const el = $('wardrobe');
  el.addEventListener('pointerdown', e => { if (e.target !== el) return; WD.drag = { x: e.clientX, yaw: WD.yaw }; el.setPointerCapture?.(e.pointerId); });
  el.addEventListener('pointermove', e => { if (WD.drag) WD.yaw = WD.drag.yaw + (e.clientX - WD.drag.x) * 0.012; });
  const up = () => { WD.drag = null; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
const _wFwd = new THREE.Vector3(), _wSide = new THREE.Vector3(), _wLook = new THREE.Vector3();
const _wSz = new THREE.Vector2();
const _wBox = new THREE.Box3(), _wInv = new THREE.Matrix4();
function wardrobeCamera(dt) {
  if (!WD.drag) WD.yaw += dt * WD.spin;
  santa.root.rotation.y = WD.yaw;
  const base = santa.root.position, fov = 34;
  // character extent (hat / topper tip to shoes) in root-local metres, measured once per open / tab change
  if (!WD.box) {
    santa.root.updateMatrixWorld(true); _wInv.copy(santa.root.matrixWorld).invert(); _wBox.makeEmpty();
    santa.root.traverseVisible(o => { if (o.isMesh && !o.isSkinnedMesh && o.geometry && !o.isSprite) { // skinned body box is a padded culling box -> head-bound parts (flame, toppers) give the top
      o.geometry.boundingBox || o.geometry.computeBoundingBox();
      _wBox.union(new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(_wInv, o.matrixWorld))); } });
    const y0 = 0, y1 = Number.isFinite(_wBox.max.y) ? THREE.MathUtils.clamp(_wBox.max.y + 0.06, 1.8, 2.6) : 1.85;
    WD.box = { y0, y1, h: y1 - y0, w: 1.25 }; // width covers the arms / back items through the turntable // + flame tips above the hat; width covers arms / back items on the turntable
  }
  // free part of the screen = outside the wardrobe panel (above it in portrait, right of it in landscape)
  const sz = renderer.getSize(_wSz), fw = sz.x, fh = sz.y, portrait = fw < fh;
  const pr = document.querySelector('#wardrobe .wardPanel')?.getBoundingClientRect();
  let fx0 = 0, fx1 = fw, fy0 = 0, fy1 = fh;
  if (pr && pr.width > 0) { if (portrait) fy1 = Math.max(fh * 0.3, pr.top - 6); else fx0 = Math.min(fw * 0.7, pr.right + 6); }
  fy0 += Math.min(fh * 0.06, 14);
  const freeW = fx1 - fx0, freeH = fy1 - fy0, th = Math.tan(THREE.MathUtils.degToRad(fov / 2)), asp = fw / fh;
  // distance so the whole body (with a margin) fits the free height / width
  const dH = WD.box.h * 1.12 * fh / (2 * th * freeH), dW = WD.box.w * fw / (2 * th * asp * freeW);
  const d = THREE.MathUtils.clamp(Math.max(dH, dW), 2.2, 14);
  _wFwd.set(Math.sin(player.heading), 0, Math.cos(player.heading));
  const cy = base.y + (WD.box.y0 + WD.box.y0 + WD.box.h) / 2;
  camera.position.set(base.x + _wFwd.x * d, cy + 0.25, base.z + _wFwd.z * d);
  _wLook.set(base.x, cy, base.z);
  camera.lookAt(_wLook); cam.pos.copy(camera.position); cam.look.copy(_wLook);
  // shift the projection (not the aim) so the body centre lands in the centre of the free area
  camera.setViewOffset(fw, fh, fw / 2 - (fx0 + fx1) / 2, fh / 2 - (fy0 + fy1) / 2, fw, fh);
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
// unlock toasts (stacked above every screen, one bell per batch)
function showUnlocks(items) {
  sfx.unlock?.();
  const box = $('unlockToasts');
  items.slice(0, 4).forEach((it, i) => setTimeout(() => {
    const el = document.createElement('div'); el.className = 'uToast';
    el.innerHTML = `<span class="sw" style="background:${it.sw === 'none' ? '#223' : it.sw}"></span><span><small>Wardrobe unlock</small><b>${it.name}</b> ${SLOTS.find(s => s.id === it.slot).name.toLowerCase()}</span>`;
    box.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3600);
  }, i * 450));
  if (items.length > 4) setTimeout(() => hud.toast(`+${items.length - 4} more wardrobe unlocks`, 2), 2000);
}

// ---- stage select (unlocks + best stars from progress.js / localStorage)
let pickedStage = null;
function chosenStage() {
  const n = CONFIG.levels.length, p = parseInt(params.get('level'));
  let lv = pickedStage ?? (p ? p - 1 : progress.data.unlocked);
  lv = clamp(lv | 0, 0, n - 1);
  if (!progress.isUnlocked(lv) && !(params.get('qa') || DEBUG)) lv = progress.data.unlocked; // ?level= can't skip locked stages
  return lv;
}
function updatePlayLabel() {
  const lv = chosenStage(), fresh = lv === 0 && !progress.cleared(0);
  $('playBtn').textContent = fresh ? 'Start delivering' : `▶ Stage ${lv + 1}: ${CONFIG.levels[lv].name}`;
}
function renderStages() {
  const n = CONFIG.levels.length, cur = chosenStage(), stars = progress.totalStars();
  $('stSub').innerHTML = `<b>${stars}</b> / ${n * 3} ★ · ${progress.clearedCount()} of ${n} stages cleared`;
  $('stageGrid').innerHTML = CONFIG.levels.map((L, i) => {
    const open = progress.isUnlocked(i), best = progress.best(i), st = best?.stars || 0;
    const icons = stageIntros(i).map(k => CONFIG.intros[k][0]).slice(0, 3).join('');
    return `<button class="stTile${open ? '' : ' locked'}${i === cur ? ' cur' : ''}${L.finale ? ' finale' : ''}" data-i="${i}" ${open ? '' : 'aria-disabled="true"'}>
      <span class="n">STAGE ${i + 1}</span><span class="nm">${L.name}</span>
      <span class="st">${open ? '★'.repeat(st) + `<i>${'★'.repeat(3 - st)}</i>` : `🔒 <span class="lg">Clear stage </span><span class="sh">after </span>${i}`}</span>${icons ? `<span class="ob" title="New this stage">${icons}</span>` : ''}</button>`;
  }).join('');
  for (const el of $('stageGrid').querySelectorAll('.stTile')) el.onclick = () => {
    const i = +el.dataset.i;
    if (!progress.isUnlocked(i)) { el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 220 }); return; }
    pickedStage = i; updatePlayLabel(); $('stages').classList.add('hidden'); $('playBtn').click();
  };
}

function togglePause() {
  if (G.state === 'playing') { G.state = 'paused'; showOverlay('Paused', 'Take a breath — the slot is frozen.' + AUDIO_SLIDERS, null, 'Resume', () => { hideOverlay(); G.state = 'playing'; }, 'Quit to title', () => { hideOverlay(); toTitle(); }); }
  else if (G.state === 'paused') { hideOverlay(); G.state = 'playing'; }
}
function toTitle() { pickedStage = null; updatePlayLabel(); music.play('title'); clearLevel(); resetVillageLights(); G.state = 'title'; hud.show(false); $('touchUI').classList.add('hidden'); $('title').classList.remove('hidden'); }

function showOverlay(title, text, stats, btn, fn, btn2, fn2) {
  $('ovTitle').textContent = title; $('ovText').innerHTML = text;
  $('ovStats').innerHTML = stats ? stats.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('') : '';
  $('ovStats').classList.toggle('hidden', !stats);
  $('ovBtn').textContent = btn; $('ovBtn').onclick = fn;
  $('ovBtn2').classList.toggle('hidden', !btn2); if (btn2) { $('ovBtn2').textContent = btn2; $('ovBtn2').onclick = fn2; }
  hideCardUI(); $('overlay').classList.remove('withCard');
  $('overlay').classList.remove('hidden');
  bindPauseSliders();
}
const AUDIO_SLIDERS = `<div id="pauseAudio"><label for="volMusic">Music</label><input id="volMusic" type="range" min="0" max="1" step="0.05"><label for="volSfx">Sound FX</label><input id="volSfx" type="range" min="0" max="1" step="0.05"><label for="volMute">Mute</label><input id="volMute" type="checkbox" style="justify-self:start"></div>`;
function bindPauseSliders() {
  const a = audioState.get(), m = $('volMusic'), f = $('volSfx'), u = $('volMute'); if (!m) return;
  m.value = a.music; f.value = a.sfx; u.checked = a.muted;
  m.oninput = () => audioState.setMusic(m.value); f.oninput = () => audioState.setSfx(f.value); u.onchange = () => audioState.setMuted(u.checked);
}
function bindAudioUI() {
  configureAudio(CONFIG.audio);
  // browsers only allow audio after a gesture: start the context + title music on the first one
  const first = () => { if (CONFIG.audio?.enabled === false || G.qaMute) return; initAudio(CONFIG.audio); if (!music.current) music.play(G.state === 'title' ? 'title' : G.state === 'ending' ? 'ending' : 'game'); for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) removeEventListener(ev, first, true); };
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, first, true);
  addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) { audioState.toggleMute(); bindPauseSliders(); } });
  $('muteBtn').onclick = e => { e.stopPropagation(); audioState.toggleMute(); bindPauseSliders(); };
  audioState.onChange(a => { $('muteBtn').textContent = a.muted ? '🔇' : '🔊'; $('muteBtn').classList.toggle('off', a.muted); });
}
// fullscreen button (where the Fullscreen API exists — not iPhone Safari), one-time iOS "Add to Home Screen" tip, portrait rotate hint
function bindScreenUI() {
  const standalone = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  const fsOK = !!req && (document.fullscreenEnabled || document.webkitFullscreenEnabled) && !standalone && !(iOS && /iPhone|iPod/.test(navigator.userAgent));
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const toggleFs = async () => {
    try {
      if (isFs()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await req.call(el, { navigationUI: 'hide' }); // no orientation.lock: rotation stays free in fullscreen too
    } catch (e) { console.info('[fullscreen] not available', e?.message); }
  };
  for (const id of ['fsBtn', 'fsBtnTitle']) { $(id).classList.toggle('hidden', !fsOK); $(id).onclick = e => { e.stopPropagation(); toggleFs(); }; }
  const upd = () => { $('fsBtn').textContent = isFs() ? '🗗' : '⛶'; if (!isFs()) { try { screen.orientation?.unlock?.(); } catch (e) { /* not supported */ } } };
  document.addEventListener('fullscreenchange', upd); document.addEventListener('webkitfullscreenchange', upd);
  if (iOS && !standalone && !localStorage.getItem('xmas.iosTip')) {
    setTimeout(() => $('iosTip').classList.remove('hidden'), 1200);
    $('iosTipX').onclick = () => { $('iosTip').classList.add('hidden'); localStorage.setItem('xmas.iosTip', '1'); };
    setTimeout(() => { $('iosTip').classList.add('hidden'); localStorage.setItem('xmas.iosTip', '1'); }, 14000);
  }
  let portraitOK = sessionStorage.getItem('xmas.portrait') === '1';
  // portrait: a non-blocking hint card (the game stays playable underneath); fades out by itself after 6 s
  let rotT = 0;
  const rot = () => { const show = isTouch && !portraitOK && innerHeight > innerWidth * 1.15; $('rotateHint').classList.toggle('hidden', !show);
    clearTimeout(rotT); if (show) rotT = setTimeout(() => { portraitOK = true; $('rotateHint').classList.add('hidden'); }, 6000); };
  $('rotateX').onclick = () => { portraitOK = true; sessionStorage.setItem('xmas.portrait', '1'); rot(); };
  addEventListener('resize', rot); addEventListener('orientationchange', () => setTimeout(rot, 300)); rot();
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ------------------------------------------------------------ level setup
function spawnPoint() { // on the main street (road 0) at spawnRadius
  const road = world.roads[0];
  return road.pts.find(q => Math.hypot(q.x, q.z) >= CONFIG.world.spawnRadius) || road.pts[road.pts.length - 1];
}
function resetPlayer() {
  // spawn on the main street (road 0), looking back up the cobbles toward the big tree in the square
  const p = spawnPoint();
  player.pos.set(p.x, 0, p.z);
  player.vel.set(0, 0, 0);
  player.heading = Math.atan2(-p.tx, -p.tz);
  cam.yaw = player.heading;
  santa.root.position.copy(player.pos); santa.root.rotation.y = player.heading;
}

// per-level markers/rings/labels own their geometry + material: free them on level change (leak audit);
// module-shared materials stay alive (they are reused by the next level).
function disposeLevelObj(o) {
  const keep = new Set([beamMat, beaconMat, beaconMatSlow, beaconMatChimney, world?.M?.ice, _proxyMat]);
  o.traverse(m => { if (m.geometry && !m.geometry.userData?.shared) m.geometry.dispose(); for (const x of [].concat(m.material || [])) if (!keep.has(x)) x.dispose(); });
}
const _camW = new THREE.Vector3(), _camL = new THREE.Vector3(), _ORIGIN = new THREE.Vector3(); // per-frame scratch (no GC churn)
function clearLevel() {
  for (const o of G.levelObjects) { o.parent?.remove(o); disposeLevelObj(o); }
  G.levelObjects = []; G.targets = []; G.powerups = []; G.ice = []; fxs.sparkles?.setIce([]); fxs.feet?.reset();
  flights?.clear(); obstacles?.clear();
  G.mumpLeft = 0; G.gossipBusy = false; G.stun = 0; G.invuln = 0; G.plan = null;
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
  music.play('game');
  clearLevel(); resetVillageLights();
  const L = CONFIG.levels[idx], D = difficulty();
  G.level = idx; G.levelTime = 0; G.levelStartScore = G.score;
  G.timer = L.timer * D.timerMult; G.delivered = 0; G.storm = 0; G.stormLin = 0; G.endingT = 0;
  G.combo = 0; G.bestCombo = 0; G.lastDeliverT = -1e9; G.boosted = 0; boostTrail?.reset();
  G.baseTimer = G.timer; G.runJumps = 0; G.runPowerups = 0; G.runHits = 0; G.runChimneys = 0; G.lastRun = null; G.lbPending = null;
  lb.startRun(idx); // server-signed run token for this attempt (no-op in local mode)
  // --- deterministic stage layout: houses + obstacles (planStage keeps every house reachable; see routeCheck)
  const plan = planStage(world, graph, idx, spawnPoint()), R = plan.R; G.plan = plan;
  G.targets = plan.targets.map(t => makeTarget(t.b, t.slow, t.chimney));
  G.total = G.targets.length;
  // --- power-ups on roads
  const nP = Math.max(1, L.powerups + D.powerupCountAdd);
  for (let i = 0; i < nP; i++) spawnPowerup(R, L);
  // --- ice patches on roads
  plan.ice.forEach((p, i) => {
    const geo = new THREE.CircleGeometry(p.r, 28); geo.rotateX(-Math.PI / 2); worldUV(geo, 0.2);
    const m = new THREE.Mesh(geo, world.M.ice); m.position.set(p.x, 0.07 + i * 0.001, p.z); m.receiveShadow = true;
    scene.add(m); G.levelObjects.push(m); G.ice.push({ x: p.x, z: p.z, r: p.r });
  });
  if (G.ice.length) fxs.sparkles?.setIce(G.ice);
  obstacles.low = lowApplied; obstacles.build(plan);
  resetPlayer();
  hideOverlay(); $('title').classList.add('hidden');
  hud.show(true); $('touchUI').classList.toggle('hidden', !isTouch);
  G.state = 'playing';
  hud.toast(`Stage ${idx + 1}/${CONFIG.levels.length}: ${L.name}`, 2.4);
  showIntro(idx);
}

const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uC: { value: new THREE.Color(0x3fb6ff) }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }',
  // fades out when the camera is right next to / inside the beam (no full-screen glare)
  fragmentShader: 'varying vec2 vUv; varying float vD; uniform vec3 uC; uniform float uT; void main(){ float a = pow(clamp(1.0-vUv.y, 0.0, 1.0), 2.2)*0.32*(0.8+0.2*sin(uT*3.0+vUv.y*20.0)) * smoothstep(1.5, 7.0, vD); gl_FragColor = vec4(uC*1.6, a); }',
});
const ringShader = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uP: { value: 0 }, uC: { value: new THREE.Color(color) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'varying vec3 vP; uniform float uP; uniform vec3 uC; void main(){ float a = atan(vP.x, -vP.y)/6.2831853+0.5; if (a > uP) discard; gl_FragColor = vec4(uC*2.2, 0.95); }',
});
const beaconShader = (hex) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uC: { value: new THREE.Color(hex) }, uT: beamMat.uniforms.uT },
  vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'varying vec2 vUv; varying float vD; uniform vec3 uC; uniform float uT; void main(){ float a = pow(clamp(1.0-vUv.y, 0.0, 1.0), 1.4)*smoothstep(0.0, 0.06, vUv.y)*(0.85+0.15*sin(uT*2.0-vUv.y*30.0)) * mix(0.14, 0.6, smoothstep(12.0, 80.0, vD)); gl_FragColor = vec4(uC*1.4, a); }',
});
const beaconMat = beaconShader(0x3fb6ff), beaconMatSlow = beaconShader(0xffa63a), beaconMatChimney = beaconShader(0xffd25a);
let slowTex = null, chimneyTex = null;

function makeTarget(b, slow, chimney = false) {
  const g = new THREE.Group();
  // floating gem above the roof (gold = chimney drop: jump at the door)
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), new THREE.MeshBasicMaterial({ color: new THREE.Color(chimney ? 0xffc83a : 0x3fb6ff).multiplyScalar(2.2) }));
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
  // tall sky beacon above the roof: fog-free, fades in with distance so it marks the house through fog/storm
  let beacon = null;
  if (CONFIG.nav?.beacons !== false) {
    const H = CONFIG.nav?.beaconHeight ?? 70;
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, H, 12, 1, true), slow ? beaconMatSlow : chimney ? beaconMatChimney : beaconMat);
    beacon.position.set(b.x, b.height + 2 + H / 2, b.z); beacon.renderOrder = 2; g.add(beacon);
  }
  if (slow) {
    slowTex ??= textTexture('SLOW NODE', { w: 512, h: 128, bg: 'rgba(40,20,0,0.75)', fg: '#ffcf6b', border: '#ff9f2e', glow: '#ff9f2e', font: 'bold 70px system-ui, sans-serif' });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: slowTex, transparent: true, depthWrite: false }));
    label.scale.set(5, 1.25, 1); label.position.set(b.x, b.height + 6.2, b.z); g.add(label);
  }
  if (chimney) {
    chimneyTex ??= textTexture('CHIMNEY · JUMP', { w: 512, h: 128, bg: 'rgba(40,26,0,0.78)', fg: '#ffe08a', border: '#ffc83a', glow: '#ffb21a', font: 'bold 62px system-ui, sans-serif' });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: chimneyTex, transparent: true, depthWrite: false }));
    label.scale.set(5, 1.25, 1); label.position.set(b.x, b.height + 6.2, b.z); g.add(label);
  }
  scene.add(g); G.levelObjects.push(g);
  return { b, slow, chimney, delivered: false, sending: false, progress: 0, group: g, gem, halo, prog, ring, glow, beam, beacon, fadeT: -1 };
}

function spawnPowerup(R, L) {
  // never right at the spawn (a free mump2p in the first second would auto-deliver half the stage)
  const sp = spawnPoint(); let p, k = 0;
  do p = world.randomRoadPoint(R, 26, Math.min(CONFIG.world.radius - 10, L.areaRadius + 15));
  while (++k < 16 && Math.hypot(p.x - sp.x, p.z - sp.z) < 35);
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

let blob = null;
function updateBlob() { // soft contact shadow under the feet (fades/shrinks with jump height)
  if (!blob) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0.4, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8, fog: true }));
    blob.renderOrder = 1; blob.userData.noAO = true; scene.add(blob);
  }
  const k = 1 / (1 + player.jy * 0.9);
  blob.position.set(player.pos.x, player.surfY + 0.012, player.pos.z); blob.scale.setScalar(0.75 + 0.25 * k);
  blob.material.opacity = (CONFIG.character.grounding.blobShadow ?? 0.4) * k; blob.visible = santa.root.visible !== false;
}
function onLand(impact) { // landing: snow puff ring + small camera dip
  if (!player.paved && !G.onIce) fxs.puffs?.ring(player.pos.x, player.surfY + 0.05, player.pos.z, 0.25 + impact * 0.5, 14 + Math.round(impact * 20));
  cam.kick = Math.max(cam.kick || 0, impact * 0.25);
}

function updatePlayer(dt) {
  const P = CONFIG.player, D = difficulty();
  const ax = input.axes(), J = P.jump, AS = P.autoSprint;
  // sprint: Shift (desktop) or touch auto-sprint (joystick pushed past radiusFrac, or a direction held holdTime s); smooth ramp
  const mag = Math.hypot(ax.x, ax.y);
  player.holdT = mag > 0.35 ? player.holdT + dt : 0;
  const wantSprint = input.sprint || (input.joy.active && (mag >= AS.radiusFrac || player.holdT >= AS.holdTime)) || (AS.keyboardHold && player.holdT >= AS.holdTime);
  player.sprintK = THREE.MathUtils.clamp(player.sprintK + (wantSprint ? dt : -dt * 2) / AS.rampTime, 0, 1);
  const sprint = player.sprintK > 0.5;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw); // camera forward
  const rx = -fz, rz = fx; // camera right
  const sk = player.sprintK * player.sprintK * (3 - 2 * player.sprintK);
  const stunned = G.stun > 0; // knocked back by an obstacle: no control for a moment
  G.inLag = obstacles.inLag(player.pos.x, player.pos.z);
  const speedMax = lerp(P.walkSpeed, P.sprintSpeed, sk) * D.speedMult * obstacles.speedMult(player.pos.x, player.pos.z, G.mumpLeft > 0);
  const wantX = stunned ? 0 : (fx * ax.y + rx * ax.x) * speedMax, wantZ = stunned ? 0 : (fz * ax.y + rz * ax.x) * speedMax;
  const ice = onIce(player.pos.x, player.pos.z);
  const hasInput = !stunned && Math.hypot(ax.x, ax.y) > 0.05;
  let accel = ice ? P.iceAccel / D.iceSlipMult : P.accel;
  if (ice && !hasInput) accel = P.iceFriction / D.iceSlipMult;
  const k = 1 - Math.exp(-accel * dt / Math.max(1, speedMax) * (ice ? 1 : 2.2));
  player.vel.x += (wantX - player.vel.x) * k; player.vel.z += (wantZ - player.vel.z) * k;
  if (!ice && !hasInput) { player.vel.multiplyScalar(Math.exp((stunned ? -3 : -14) * dt)); }
  const before = player.pos.clone();
  player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
  const gust = obstacles.gust; if (gust.push) { player.pos.x += gust.x * gust.push * dt; player.pos.z += gust.z * gust.push * dt; } // wind shove
  // vertical: real jump arc with gravity, coyote time and input buffering
  const jumpKey = input.keys.has('Space') || input.jumpBtn;
  if (jumpKey && !G.jumpHeld) player.jumpBuf = J.bufferTime; G.jumpHeld = jumpKey;
  player.jumpBuf = Math.max(0, player.jumpBuf - dt);
  player.coyote = player.air ? Math.max(0, player.coyote - dt) : J.coyoteTime;
  if (player.jumpBuf > 0 && player.coyote > 0 && !G.slowHold && !stunned) {
    player.vy = J.velocity; player.air = true; player.coyote = 0; player.jumpBuf = 0;
    santa.jumpStart?.(); sfx.jump?.(); G.runJumps = (G.runJumps || 0) + 1;
  }
  if (player.air) {
    player.vy -= J.gravity * dt; player.jy += player.vy * dt;
    if (player.jy <= 0) { const impact = Math.min(1, -player.vy / 9); player.jy = 0; player.vy = 0; player.air = false; santa.land?.(impact); onLand(impact); }
  }
  world.collide(player.pos, P.radius, player.jy);
  // velocity follows actual displacement (so walls stop sliding momentum)
  if (dt > 0) { const ax2 = (player.pos.x - before.x) / dt, az2 = (player.pos.z - before.z) / dt; const kv = 1 - Math.exp(-41.6 * dt); player.vel.x = lerp(player.vel.x, ax2, kv); player.vel.z = lerp(player.vel.z, az2, kv); } // = 0.5 per frame at 60 fps, dt-independent
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  if (hasInput && player.speed > 0.3) {
    const dir = ice ? Math.atan2(wantX, wantZ) : Math.atan2(player.vel.x, player.vel.z);
    player.heading = angleDamp(player.heading, dir, P.turnSpeed, dt);
  }
  // grounding: stand on the real walkable surface (road / square / snow), sinking slightly into snow
  const surf = world.surfaceAt(player.pos.x, player.pos.z), GR = CONFIG.character.grounding;
  player.surfY = surf.y; player.paved = surf.paved;
  santa.root.position.copy(player.pos); santa.root.position.y = surf.y - (surf.paved || ice ? 0 : GR.snowSink);
  santa.extY = player.jy; santa.extAir = player.air; if (!santa.isMascot) santa.root.position.y += player.jy;
  updateBlob();
  santa.root.rotation.y = player.heading;
  santa.root.rotation.z = ice ? Math.sin(G.levelTime * 9) * 0.05 * Math.min(1, player.speed / 4) : 0;
  santa.setState?.({ storm: G.storm, ice, slow: G.slowHold, boosted: G.mumpLeft > 0 });
  santa.update(dt, player.speed, sprint && player.speed > P.walkSpeed * 0.9);
  G.onIce = ice;
}

function setFov(f, dt) { if (!Number.isFinite(f)) f = CONFIG.camera.fov; f = Math.min(110, Math.max(20, f)); if (!Number.isFinite(camera.fov)) camera.fov = f; const n = camera.fov + (f - camera.fov) * (1 - Math.exp(-3 * Math.min(0.1, Math.max(0, dt || 0)))); if (Math.abs(n - camera.fov) > 0.01) { camera.fov = n; camera.updateProjectionMatrix(); } }
function updateCamera(dt, t) {
  const C = CONFIG.camera;
  if (G.camOverride) { // QA / photo mode
    const o = G.camOverride;
    if (o.rel) { // offsets in the player's frame: [side, up, forward] — follows the player (QA walk close-ups)
      const h = player.heading, fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h), P = player.pos;
      const W = (v) => [P.x + sx * v[0] + fx * v[2], P.y + v[1], P.z + sz * v[0] + fz * v[2]];
      const lp = W(o.look); camera.position.set(...W(o.pos)); camera.lookAt(...lp); cam.pos.copy(camera.position); cam.look.set(...lp);
    } else { camera.position.set(...o.pos); camera.lookAt(...o.look); cam.pos.copy(camera.position); cam.look.set(...o.look); }
    if (o.fov && camera.fov !== o.fov) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
    return;
  }
  let fov = C.fov;
  if (G.state === 'title' && G.wardrobe) { wardrobeCamera(dt); return; }
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
    const want = _camW.set(player.pos.x + Math.sin(cam.orbit) * 7.5, 3.2, player.pos.z + Math.cos(cam.orbit) * 7.5);
    cam.pos.lerp(want, 1 - Math.exp(-2.5 * dt)); cam.look.lerp(_v0.set(player.pos.x, 1.4, player.pos.z), 1 - Math.exp(-4 * dt));
    camera.position.copy(cam.pos); camera.lookAt(cam.look); setFov(45, dt); return;
  }
  cam.orbit = undefined;
  if (G.state === 'ending') {
    setFov(52, dt);
    const a = 0.7 + G.endingT * 0.05, r = 78;
    const want = _camW.set(Math.cos(a) * r, 22 + Math.min(G.endingT, 6) * 2, Math.sin(a) * r);
    cam.pos.lerp(want, 1 - Math.exp(-1.5 * dt)); cam.look.lerp(_v0.set(0, 26, 0), 1 - Math.exp(-1.5 * dt));
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
  const look = _camL.set(player.pos.x + Math.sin(cam.yaw) * ahead, C.lookHeight, player.pos.z + Math.cos(cam.yaw) * ahead);
  cam.kick = Math.max(0, (cam.kick || 0) - dt * 1.6);
  // portrait phones: widen the vertical FOV so the horizontal view isn't a keyhole
  const portrait = camera.aspect < 0.9 ? 1.32 : 1;
  setFov((C.fov + Math.max(0, player.speed - 6) * 0.9 + (G.mumpLeft > 0 ? 3 : 0) + cam.kick * 8) * portrait, dt);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  const storm = G.storm;
  let dist = C.distance * (1 - storm * 0.15) * (camera.aspect < 0.9 ? 1.3 : 1);
  const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw); // camera-right on the ground plane
  const sh = C.shoulder * (camera.aspect < 0.9 ? 0.3 : 1);
  // camera collision: (1) collider march from Santa's head back toward the desired over-the-shoulder spot, then
  // (2) a real raycast against the nearby house meshes (eaves, porches, signs, lamps the footprint boxes miss),
  // so the near plane never slices into a wall/roof (= the big straight-edged dark rectangles while orbiting).
  let allowed = dist;
  for (let i = 1; i <= 16; i++) {
    const k = i / 16, s = dist * k, h = 1.6 + (C.height - 1.6) * k;
    if (world.blocksCamera(player.pos.x - fx * s + rx * sh * k, h, player.pos.z - fz * s + rz * sh * k)) { allowed = Math.max(1.2, dist * (i - 1) / 16); break; }
  }
  allowed = Math.min(allowed, camRayLimit(fx, fz, rx, rz, sh, dist));
  // pull in fast, ease back out slowly (frame-rate independent)
  cam.dist = damp(cam.dist, allowed, allowed < cam.dist ? 22 : 3, dt);
  if (cam.dist > allowed + 0.25) cam.dist = allowed + 0.25;
  const r = cam.dist / dist;
  // position comes straight from the (already damped) yaw + distance: no second cartesian lerp, so the camera never
  // cuts a chord through geometry when it swings, and there is no double smoothing (micro-stutter)
  cam.h = damp(cam.h ?? C.height, C.height + (1 - r) * 0.9, 8, dt);
  cam.pos.set(player.pos.x - fx * cam.dist + rx * sh * r, cam.h, player.pos.z - fz * cam.dist + rz * sh * r);
  cam.look.lerp(look, 1 - Math.exp(-12 * dt));
  if (!Number.isFinite(cam.pos.x + cam.pos.y + cam.pos.z + cam.look.x + cam.look.y + cam.look.z)) { cam.pos.set(player.pos.x - fx * dist, C.height, player.pos.z - fz * dist); cam.look.copy(look); }
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
}

const _proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), _crl = { t: -1, yaw: 0, x: 0, z: 0, v: 99 };
const _ray = new THREE.Raycaster(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _rt = new THREE.Vector3(), _near = [];
function camRayLimit(fx, fz, rx, rz, sh, dist) {
  // throttled: re-cast at most every 40 ms unless the camera swung / Santa moved noticeably
  const now = performance.now();
  if (now - _crl.t < 40 && Math.abs(angleDiff(_crl.yaw, cam.yaw)) < 0.04 && Math.hypot(_crl.x - player.pos.x, _crl.z - player.pos.z) < 0.3) return _crl.v;
  _crl.t = now; _crl.yaw = cam.yaw; _crl.x = player.pos.x; _crl.z = player.pos.z;
  return (_crl.v = camRayCast(fx, fz, rx, rz, sh, dist));
}
function camRayCast(fx, fz, rx, rz, sh, dist) {
  const C = CONFIG.camera; _ro.set(player.pos.x, 1.6, player.pos.z);
  _rt.set(player.pos.x - fx * dist + rx * sh, C.height, player.pos.z - fz * dist + rz * sh);
  _rd.subVectors(_rt, _ro); const L = _rd.length(); _rd.divideScalar(L);
  _near.length = 0;
  for (const b of world.buildings) { if (b.holder && Math.hypot(b.x - player.pos.x, b.z - player.pos.z) < L + 16) _near.push(b.camProxy ||= camProxyOf(b)); }
  if (world.camBlockers) for (const o of world.camBlockers) if (Math.hypot(o.position.x - player.pos.x, o.position.z - player.pos.z) < L + 4) _near.push(o);
  if (!_near.length) return dist;
  _ray.set(_ro, _rd); _ray.far = L + 0.6; _ray.near = 0;
  // near-plane half-diagonal (~0.12 m at near 0.1) + margin: stop 0.45 m before the first surface
  let best = dist;
  for (const o of _near) { const h = _ray.intersectObject(o, true); if (h.length) best = Math.min(best, Math.max(0.9, (h[0].distance - 0.45) * dist / L)); }
  return best;
}
// cheapest mesh set per house for camera rays: the LOD's lowest level + the non-LOD parts (signs, porches, decor)
function camProxyOf(b) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false;
  const parts = []; b.holder.updateMatrixWorld(true);
  b.holder.traverse(o => {
    if (o.isLOD) return;
    for (let p = o.parent; p && p !== b.holder; p = p.parent) if (p.isLOD) return;
    if ((o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.userData.noSnap && !(o.material?.transparent && o.material?.depthWrite === false))) parts.push(o);
  });
  b.holder.traverse(o => { if (o.isLOD) { const lv = o.levels[o.levels.length - 1]?.object; lv?.traverse(m => { if (m.isMesh) parts.push(m); }); } });
  for (const m of parts) { const c = new THREE.Mesh(m.geometry, _proxyMat); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.matrixWorld.copy(m.matrixWorld); c.raycast = THREE.Mesh.prototype.raycast; g.add(c); }
  g.updateMatrixWorld = () => {}; // matrices are baked world-space
  return g;
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
    fragmentShader: 'uniform vec3 uC; varying float vA; varying float vY; void main(){ float e = 1.0 - abs(vY*2.0-1.0); float c = pow(max(e, 0.0), 2.5); gl_FragColor = vec4(uC*1.6 + vec3(0.5,0.8,1.0)*c, vA*c); }',
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
  if (near?.chimney) { // chimney drop: no holding, the gift goes down the chimney when Santa jumps at the door
    G.hint = 'Chimney house: jump to drop it in!';
    if (player.air && player.jy >= CONFIG.obstacles.chimney.minJump) {
      near.progress = 1; near.sending = true; G.runChimneys = (G.runChimneys || 0) + 1;
      const ch = near.b.chimney, to = ch ? ch.clone().setY(ch.y + 0.4) : new THREE.Vector3(near.b.x, near.b.height + 1, near.b.z);
      flights.gossip(santa.giftWorldPos(), to, 0.7, () => { particles.burst(to, new THREE.Color(2.2, 1.5, 0.4), 50, 5, 0.9); deliver(near); });
      sfx.whoosh(0.5, 0.18);
    }
  } else if (near && !(G.gossipBusy && !mump)) {
    let hold = C.holdTime * D.holdMult / (mump ? CONFIG.powerup.speedFactor : 1);
    if (near.slow) hold *= C.slowNodeHoldMult * D.slowNodeMult;
    hold *= obstacles.holdMult(near.b.trigger.x, near.b.trigger.z, mump);
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
        if (!lowApplied) for (const k of [-1, 1]) flights.shard(from, doorTarget(t), dur * (1 + 0.08 * k), null, (sd + 0.22 * k + 1) % 1, 0.55);
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
      tg.gem.scale.set(s, s * 1.5, s); tg.beam.visible = false; if (tg.beacon) tg.beacon.visible = false; tg.ring.visible = false; tg.prog.visible = false; tg.halo.material.opacity = s;
      tg.group.children.forEach(c => { if (c.isSprite) c.visible = false; });
      if (tg.fadeT < 0) { tg.gem.visible = false; tg.glow.material.opacity = 0.75; }
      continue;
    }
    // LOW draw-call budget: door-level parts (ring, progress arc, beam, house glow) only near the player;
    // the gem + sky beacon still mark every house at range
    if (lowApplied) {
      const near = (player.pos.x - tg.b.x) ** 2 + (player.pos.z - tg.b.z) ** 2 < 42 * 42;
      tg.glow.visible = near;
      if (!tg.delivered) tg.ring.visible = tg.prog.visible = tg.beam.visible = near;
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
  G.mumpLeft = G.mumpDur; G.pulseT = 0; G.runPowerups = (G.runPowerups || 0) + 1;
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
  scene.fog.density = Math.max(G.weather.fog, lowApplied ? (CONFIG.qualityPresets.low.fogMin ?? 0) : 0);
  scene.fog.color.copy(FOG_COLOR).lerp(STORM_FOG, st); scene.background.copy(scene.fog.color);
  world.sky.material.uniforms.uStorm && (world.sky.material.uniforms.uStorm.value = st);
  G.wxDark = damp(G.wxDark ?? 0, P.dark || 0, 1.5, dt); // night / blizzard stages: dimmer ambient + darker fog
  hemi.intensity = (0.66 - st * 0.12) * (1 - G.wxDark);
  if (G.wardrobe) hemi.intensity = Math.max(hemi.intensity, 1.2); // wardrobe preview fill (no extra light = no recompile)
  moon.intensity = 0.9 * (1 - G.wxDark * 0.6);
  if (G.wxDark > 0.001) { scene.fog.color.multiplyScalar(1 - G.wxDark * 0.7); scene.background.copy(scene.fog.color); }
  post.setWeather?.(st);
}

// Pool of real point lights (every one is a per-fragment loop iteration in every lit material, so the pool is
// small): the candidates whose range best covers the area Santa / the camera look at win a slot. A slot that loses
// its light fades out before it is re-used and the new light fades in, so lights never pop on / off.
const _poolTop = [], _poolScore = new Map(), _poolSlot = [];
// Moon shadow: the shadow camera is snapped to whole shadow-map texels (no shimmer while Santa walks) and the map is
// refreshed only when the snapped camera moved or a shadow caster in its frustum moves (Santa walking / jumping,
// orbiting reindeer); idle scenes refresh at ~20 Hz for the idle animation, paused / overlay states not at all.
const _sh = { x: 1e9, z: 1e9, n: 0, u: new THREE.Vector3(), v: new THREE.Vector3() };
function updateShadow(focus) {
  if (!moon.castShadow || !renderer.shadowMap.enabled) return;
  const S = CONFIG.performance.shadowFrustum, tex = 2 * S / moon.shadow.mapSize.x;
  // light-space axes (fixed light direction): snap the focus in that basis
  const dir = _v1.set(35, 70, 22).normalize(), u = _sh.u.set(0, 1, 0).cross(dir).normalize(), v = _sh.v.copy(dir).cross(u);
  const a = Math.round(focus.dot(u) / tex) * tex, b = Math.round(focus.dot(v) / tex) * tex, c = focus.dot(dir);
  const fx = u.x * a + v.x * b + dir.x * c, fy = u.y * a + v.y * b + dir.y * c, fz = u.z * a + v.z * b + dir.z * c;
  moon.position.set(fx + 35, fy + 70, fz + 22); moon.target.position.set(fx, fy, fz);
  const moved = fx !== _sh.x || fz !== _sh.z; _sh.x = fx; _sh.z = fz;
  const st = G.state, live = st === 'playing' || st === 'title' || st === 'intro' || st === 'ending';
  const moving = st === 'playing' && (player.speed > 0.05 || player.air) || st === 'intro' || st === 'ending' || walkersNear(fx, fz, S + 6);
  if (moved || moving || (live && ++_sh.n % 3 === 0)) renderer.shadowMap.needsUpdate = true;
}
function walkersNear(x, z, r) {
  for (const w of world.walkers || []) { const o = w.rd?.group; if (!o || w.idle) continue; const p = o.position; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true; }
  return false;
}
function updateLightPool() {
  const fx = player.pos.x * 0.6 + cam.look.x * 0.4, fz = player.pos.z * 0.6 + cam.look.z * 0.4, n = lightPool.length;
  _poolTop.length = 0; _poolScore.clear();
  for (const l of world.lightCandidates) {
    const d2 = (l.x - fx) ** 2 + (l.z - fz) ** 2; if (d2 > 90 * 90) continue;
    const r = Math.max(1, l.distance || 16), sc = (l.always ? 0.15 : 1) * d2 / (r * r); // fraction of its own reach
    if (_poolTop.length < n || sc < _poolScore.get(_poolTop[_poolTop.length - 1])) {
      _poolScore.set(l, sc); let i = Math.min(_poolTop.length, n - 1); _poolTop[i] = l;
      while (i > 0 && _poolScore.get(_poolTop[i - 1]) > sc) { _poolTop[i] = _poolTop[i - 1]; _poolTop[--i] = l; }
    }
  }
  for (let i = 0; i < n; i++) { const S = _poolSlot[i] || (_poolSlot[i] = { l: null, k: 0 }); S.keep = S.l && _poolTop.includes(S.l); }
  for (const l of _poolTop) { // free slot (faded out) for each newly wanted light
    if (_poolSlot.some(S => S.l === l)) continue;
    const S = _poolSlot.find(S => !S.l || (!S.keep && S.k < 0.03)); if (!S) continue;
    const L = lightPool[_poolSlot.indexOf(S)]; S.l = l; S.keep = true; S.k = 0;
    L.position.set(l.x, l.y, l.z); L.distance = l.distance;
  }
}
function fadeLightPool(dt) { // every frame: ease intensities (1 - exp(-k dt), framerate independent)
  const a = 1 - Math.exp(-7 * dt);
  for (let i = 0; i < lightPool.length; i++) {
    const S = _poolSlot[i], L = lightPool[i]; if (!S || !S.l) { L.intensity = 0; continue; }
    S.k += ((S.keep ? 1 : 0) - S.k) * a; if (!S.keep && S.k < 0.003) { S.l = null; L.intensity = 0; continue; }
    L.color.copy(S.l.color); L.intensity = S.l.intensity * S.k;
  }
}

// ---- obstacles: hits, events, intro cards
function hitPlayer(kind, h) {
  if (G.state !== 'playing' || G.invuln > 0) return;
  const O = CONFIG.obstacles, D = difficulty();
  G.invuln = O.hitInvuln; G.stun = O.stun; G.runHits = (G.runHits || 0) + 1;
  const n = Math.hypot(h.nx, h.nz) || 1;
  player.vel.set(h.nx / n * O.knockback, 0, h.nz / n * O.knockback);
  if (!player.air) { player.vy = 4.2; player.air = true; player.coyote = 0; }
  const steal = (h.steal || 0) * (D.timerMult > 1.2 ? 0.6 : 1);
  if (steal) { G.timer = Math.max(0.5, G.timer - steal); hud.toast(`${h.msg} ${steal.toFixed(0)}s!`, 1.6); G.stealFlash = 1.2; sfx.steal?.(); }
  else hud.toast(h.msg, 1.1);
  sfx.hit?.(); cam.kick = 0.5; santa.react?.('hit');
  particles.burst(new THREE.Vector3(player.pos.x, 1.0, player.pos.z), new THREE.Color(1.6, 1.8, 2.2), 40, 5, 0.6);
}
function obstacleEvent(e, o) {
  if (G.state !== 'playing') return;
  const near = (x, z, r) => Math.hypot(player.pos.x - x, player.pos.z - z) < r;
  if (e === 'honk') sfx.honk?.();
  else if (e === 'gustWarn') { sfx.gust?.(0.5); }
  else if (e === 'gust') { sfx.gust?.(1); }
  else if (e === 'bossWake') { hud.toast('👹 The Reorg Grinch woke up!', 2.4); sfx.roar?.(); }
  else if (e === 'bossTele') { if (near(o.x, o.z, 40)) sfx.roar?.(0.5); }
  else if (e === 'slam') { if (near(o.x, o.z, 45)) { sfx.slam?.(); cam.kick = Math.max(cam.kick || 0, 0.6); } }
  else if (e === 'ballPop') { if (near(o.road.pts[0].x, o.road.pts[0].z, 30)) particles.burst(new THREE.Vector3(o.road.pts[0].x, 0.8, o.road.pts[0].z), new THREE.Color(1.8, 1.9, 2.1), 30, 4, 0.7); }
}
/** obstacle / weather keys a stage uses (for the first-time intro cards) */
function stageKeys(L) {
  const k = new Set();
  if (L.iceCount > 0) k.add('ice'); if (L.slowNodes > 0) k.add('slow');
  if (L.weather === 'storms' || L.weather === 'blizzard') k.add('storms');
  if (L.weather === 'night') k.add('night'); if (L.weather === 'blizzard') k.add('blizzard');
  for (const [key, n] of Object.entries(L.obs || {})) if (n) k.add(key);
  return k;
}
function stageIntros(idx) {
  const seen = new Set(); CONFIG.levels.slice(0, idx).forEach(L => stageKeys(L).forEach(k => seen.add(k)));
  return [...stageKeys(CONFIG.levels[idx])].filter(k => !seen.has(k) && CONFIG.intros[k]);
}
let introQ = [], introT = 0;
function showIntro(idx) { introQ = stageIntros(idx).map(k => CONFIG.intros[k]); introT = 0.9; $('intro').classList.add('hidden'); }
function updateIntro(dt) {
  if (introT <= 0 && !introQ.length) return;
  introT -= dt;
  if (introT > 0) return;
  const el = $('intro');
  if (!introQ.length) { el.classList.add('hidden'); return; }
  const [icon, title, text] = introQ.shift();
  el.innerHTML = `<div class="ic">${icon}</div><div><b>New: ${title}</b><span>${text}</span></div>`;
  el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  introT = 4.2; sfx.chime?.();
}

function levelComplete() {
  if (G.state !== 'playing') return;
  G.state = 'levelComplete'; music.stop(); sfx.jingle();
  const last = G.level >= CONFIG.levels.length - 1;
  const run = recordRun(true);
  const portrait = capturePortrait();
  if (last) { startEnding(); makeCard('final', run, portrait); return; }
  const timeLeft = Math.max(0, G.timer);
  const st = '★'.repeat(run.stars) + '☆'.repeat(3 - run.stars);
  showOverlay(`Stage ${G.level + 1} complete! ${st}`, `Every validator in <b>${CONFIG.levels[G.level].name}</b> got the block.${run.newBest && run.prevBest ? ' <b class="blue">New best!</b>' : ''}`,
    [['Staked ETH', formatEth(G.score)], [X.resultsLabel, `${G.boosted}/${G.total}`], ['Time left', `${timeLeft.toFixed(1)}s`], [X.bestComboLabel, G.bestCombo > 1 ? `x${G.bestCombo}` : '—']],
    `Next: ${CONFIG.levels[G.level + 1].name}`, () => startLevel(G.level + 1), 'Title', () => { hideOverlay(); G.score = 0; hud.displayScore = 0; toTitle(); });
  makeCard('clear', run, portrait);
}

function gameOver() {
  G.state = 'gameOver'; music.stop(); sfx.fail();
  const run = recordRun(false);
  const portrait = capturePortrait();
  showOverlay('Slot missed!', `The block didn't reach every validator in time.<br>${G.total - G.delivered} validator${G.total - G.delivered === 1 ? '' : 's'} still waiting.`,
    [['Staked ETH', formatEth(G.score)], [X.resultsLabel, `${G.boosted}/${G.total}`], ['Stage', `${G.level + 1}`]],
    'Retry stage', () => { G.score = G.levelStartScore; hud.displayScore = G.score; startLevel(G.level); }, 'Title', () => { hideOverlay(); G.score = 0; hud.displayScore = 0; toTitle(); });
  makeCard('over', run, portrait);
}

// ---- run record + share card
function recordRun(cleared) {
  const L = CONFIG.levels[G.level], time = G.levelTime;
  const stars = cleared ? starsFor(L, G.timer, G.baseTimer || L.timer) : 0;
  const r = { stage: G.level, cleared, stars, time, eth: G.score - G.levelStartScore, totalEth: G.score, delivered: G.delivered, total: G.total, hits: G.runHits || 0,
    combo: G.bestCombo || 0, jumps: G.runJumps || 0, powerups: G.runPowerups || 0, chimneys: G.runChimneys || 0, speedrun: cleared && G.timer >= (G.baseTimer || L.timer) * 0.5, difficulty: CONFIG.difficulty };
  Object.assign(r, progress.recordRun(G.level, r, CONFIG.levels.length));
  G.lastRun = r; for (const h of runHooks) h(r);
  return r;
}
const runHooks = []; // after every recorded run: cosmetic unlocks, leaderboard submit
const lb = createLeaderboard(CONFIG.leaderboard, progress, CONFIG.levels);
const cardHooks = { cosmetics: () => cosmetics.names(), rank: async (run) => { // global rank line on the score card (waits <= 2.5 s for the submit)
  if (!run.cleared || !G.lbPending || !lb.online) return '';
  const res = await Promise.race([G.lbPending, new Promise(r => setTimeout(r, 2500))]);
  return res?.rank ? `Global #${res.rank} of ${res.players} on stage ${run.stage + 1}` : '';
} };
runHooks.push((r) => {
  if (!r.cleared) return;
  G.lbPending = lb.submit(r).then(res => {
    G.lbLast = res;
    if (lb.online && res?.rank && res.improved) hud.toast(`🏆 Global #${res.rank} on stage ${r.stage + 1}`, 2.2);
    if (lb.online && res?.error && res.error !== 'offline') console.warn('leaderboard:', res.error);
    return res;
  });
});
runHooks.push(() => { const fresh = cosmetics.check(); if (fresh.length) showUnlocks(fresh); updateWardDot(); });
// mascot portrait: a short-lens camera in front of Santa, rendered once and copied out in the same task
function capturePortrait() {
  try {
    const el = renderer.domElement, W0 = el.width, H0 = el.height;
    const p0 = camera.position.clone(), q0 = camera.quaternion.clone(), f0 = camera.fov;
    const r = santa.root; r.updateMatrixWorld();
    const fwd = r.getWorldDirection(new THREE.Vector3()); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); fwd.normalize();
    const side = _v1.set(fwd.z, 0, -fwd.x), base = r.position;
    camera.position.copy(base).addScaledVector(fwd, 3.3).addScaledVector(side, 2.3); camera.position.y = base.y + 1.6;
    const A = 470 / 571, fr = Math.min(1, (W0 / H0) / A); // portrait screens: widen the lens so the cropped window still spans 30 deg
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(15)) / fr)); camera.updateProjectionMatrix(); camera.lookAt(base.x, base.y + 0.95, base.z); camera.updateMatrixWorld();
    const hv = giftHalo.visible, h0 = hemi.intensity; giftHalo.visible = false; hemi.intensity = Math.max(h0, 1.25); // portrait fill (no extra light = no shader recompile)
    post.update(t, { focus: camera.position.distanceTo(base), boost: 0, flash: 0, storm: G.storm });
    culler?.update(1, camera); post.render();
    const ch = Math.round(H0 * fr), cw = Math.min(W0, Math.round(ch * A)), s = Math.min(1, 640 / ch);
    const c = document.createElement('canvas'); c.width = Math.round(cw * s); c.height = Math.round(ch * s);
    c.getContext('2d').drawImage(el, (W0 - cw) / 2, (H0 - ch) / 2, cw, ch, 0, 0, c.width, c.height);
    giftHalo.visible = hv; hemi.intensity = h0; camera.position.copy(p0); camera.quaternion.copy(q0); camera.fov = f0; camera.updateProjectionMatrix();
    return c;
  } catch (e) { console.warn('portrait capture failed', e); return null; }
}
async function makeCard(result, run, portrait) {
  const L = CONFIG.levels[run.stage];
  const info = { result, stageNo: run.stage + 1, stageCount: CONFIG.levels.length, stageName: L.name, eth: run.totalEth, stageEth: run.eth, time: run.time,
    delivered: run.delivered, total: run.total, stars: run.stars, combo: run.combo, title: titleFor(progress.totalStars()), rank: (await cardHooks.rank(run)) || `${progress.totalStars()}★ collected · ${CONFIG.difficulty} mode`,
    cosmetics: cardHooks.cosmetics(), portrait, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), url: B.shareUrl };
  try {
    const cv = await drawScoreCard(info); G.lastCard = cv; G.lastCardInfo = info;
    if (result === 'final') {
      const btn = $('endCardBtn'); btn.classList.remove('hidden');
      btn.onclick = () => { showOverlay('Your score card', 'Share the run that brought Christmas to every validator.', null, 'Close', hideOverlay); showCardUI(cv, info, m => hud.toast(m, 1.8)); };
      return;
    }
    if (G.state === result.replace('clear', 'levelComplete').replace('over', 'gameOver')) showCardUI(cv, info, m => hud.toast(m, 1.8));
  } catch (e) { console.warn('score card failed', e); }
}

function startEnding() {
  music.play('ending');
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
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3();
let lightT = 0, t = 0;
// ?qa=1: fixed 1/30 s per frame so slow software-GL screenshots are deterministic; advance() steps the sim without rendering
const QA_FIXED = !!params.get('qa');
let simOnly = false;
// dynamic resolution: frame-time EMA -> render scale (auto quality only, never in QA); the feature governor
// only kicks in once the scale is already at its floor
const dyn = { ema: 1000 / 60, acc: 0, good: 0, bad: 0, last: -99, on: PERF.dynamicResolution && Q.auto && !QA_FIXED_EARLY };
// explicit MEDIUM / HIGH safety net: if the frame rate stays under ~40 fps for 3 s, quietly step down the bloom
// resolution, then the render scale (never shadows / lights / materials - the art style stays); steps back up after
// 10 s comfortably above target. Off in QA, on LOW and under ?nosafety=1.
const SAFE = { on: !Q.auto && Q.name !== 'low' && !QA_FIXED_EARLY && params.get('nosafety') !== '1', bad: 0, good: 0, acc: 0, level: 0, steps: [] };
const SAFE_STEPS = [
  { name: 'bloom res 0.5', on: () => post.setBloomScale?.(0.5), off: () => post.setBloomScale?.(Q.bloomScale || 1) },
  { name: 'render scale 0.85', on: () => { dynScale = 0.85; applySize(); }, off: () => { dynScale = 1; applySize(); } },
  { name: 'render scale 0.72', on: () => { dynScale = 0.72; applySize(); }, off: () => { dynScale = 0.85; applySize(); } },
];
function safetyNet(d, ema) {
  if (!SAFE.on || (G.state !== 'playing' && G.state !== 'title')) { SAFE.bad = SAFE.good = 0; return; }
  SAFE.acc += d; if (SAFE.acc < 0.5) return; SAFE.acc = 0;
  if (1000 / ema < 40) { SAFE.good = 0; if (++SAFE.bad >= 6 && SAFE.level < SAFE_STEPS.length) { const s = SAFE_STEPS[SAFE.level++]; s.on(); SAFE.steps.push(s.name); SAFE.bad = 0; console.info('[perf] safety net -> ' + s.name); } }
  else if (1000 / ema > 58) { SAFE.bad = 0; if (++SAFE.good >= 20 && SAFE.level > 0) { const s = SAFE_STEPS[--SAFE.level]; s.off(); SAFE.steps.push('undo ' + s.name); SAFE.good = 0; console.info('[perf] safety net <- ' + s.name); } }
  else { SAFE.bad = 0; SAFE.good = 0; }
}
function perfCtl(d) {
  const ms = d * 1000; if (ms <= 0 || ms > 250) return;
  dyn.ema += (ms - dyn.ema) * 0.08; dyn.acc += d;
  safetyNet(d, dyn.ema);
  if (!dyn.on || dyn.acc < 1) return; dyn.acc = 0;
  // hysteresis: a resize re-allocates every render target (a hitch by itself), so only step after 2 bad / 6 good
  // seconds in a row, never more than once per 4 s, with a wide dead band (0.75x..1.15x of the frame budget)
  const budget = 1000 / PERF.targetFps, now = performance.now() / 1000;
  if (dyn.ema > budget * 1.15) { dyn.good = 0; if (++dyn.bad >= 2 && dynScale > PERF.minScale && now - dyn.last > 4) { dynScale = Math.max(PERF.minScale, dynScale - (dyn.ema > budget * 1.6 ? 0.15 : 0.07)); dyn.bad = 0; dyn.last = now; applySize(); } }
  else if (dyn.ema < budget * 0.75) { dyn.bad = 0; if (++dyn.good >= 6 && dynScale < PERF.maxScale && now - dyn.last > 4) { dynScale = Math.min(PERF.maxScale, dynScale + 0.05); dyn.good = 0; dyn.last = now; applySize(); } }
  else { dyn.good = 0; dyn.bad = 0; }
}
// black-band safety net: every ~2 s read a 12x8 grid of canvas pixels right after the frame; if a wide
// band of columns on one side is pure black while the rest is lit, twice in a row, switch off the next
// suspect post pass (bloom -> grade -> whole composer). Logged to console + __xmas.fx().blackProbe.
const BP = { next: 3, hits: 0, steps: [], px: new Uint8Array(4), off: 0, enabled: params.get('probe') === '1' };
const BP_STEPS = [
  { name: 'bloom off', apply: () => post.setBloom(false) },
  { name: 'grade/final pass off', apply: () => { if (post.final) post.final.enabled = false; } },
  { name: 'post stack off', apply: () => { post.enabled = false; } },
];
function blackProbe(t) {
  if (!post.enabled || BP.off >= BP_STEPS.length || t < BP.next || (G.state !== 'playing' && G.state !== 'title')) return;
  BP.next = t + 2;
  const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, NX = 12, NY = 8;
  const dark = new Array(NX).fill(0); let lit = 0;
  try {
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      gl.readPixels(Math.floor((i + 0.5) * W / NX), Math.floor((j + 0.5) * H / NY), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, BP.px);
      const s = BP.px[0] + BP.px[1] + BP.px[2];
      if (s <= 3) dark[i]++; else if (s > 30) lit++;
    }
  } catch (e) { BP.off = BP_STEPS.length; return; }
  const full = dark.map(d => d >= NY - 1);
  let left = 0; while (left < NX && full[left]) left++;
  let right = 0; while (right < NX && full[NX - 1 - right]) right++;
  const band = Math.max(left, right);
  const allDark = dark.every(d => d >= NY - 1) && G.state === 'playing';
  if ((band >= 3 && band < NX && lit >= 6) || allDark) {
    if (++BP.hits >= 2) { const s = BP_STEPS[BP.off++]; s.apply(); BP.steps.push(s.name); BP.hits = 0; console.warn('[blackProbe] black band ' + band + '/12 cols -> ' + s.name); window.__toast?.('Render glitch detected - ' + s.name, 'info'); }
  } else BP.hits = 0;
}
// ?debug=1 overlay: fps / frame ms / draw calls / triangles / render scale / governor steps
let dbgEl = null, dbgT = 0;
function debugOverlay(d) {
  if (!DEBUG) return;
  if (!dbgEl) { dbgEl = document.createElement('div'); dbgEl.id = 'dbgFps'; document.body.appendChild(dbgEl); renderer.info.autoReset = false; }
  dbgT += d; if (dbgT < 0.5) { renderer.info.reset(); return; } dbgT = 0;
  const I = renderer.info.render, sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  dbgEl.textContent = `${(1000 / dyn.ema).toFixed(0)} fps · ${dyn.ema.toFixed(1)} ms\n${I.calls} calls · ${(I.triangles / 1e6).toFixed(2)}M tris\n${Q.name}${Q.auto ? ' (auto)' : ''} · composer ${post.enabled ? 'on' : 'off'} · scale ${dynScale.toFixed(2)} · ${sz.x}x${sz.y}\n${governor.applied.join(', ') || 'no fallbacks'}`;
  renderer.info.reset();
}
let sdt = 1 / 60;
function loop() {
  requestAnimationFrame(loop);
  if (G.contextLost) return;
  const d = clock.getDelta();
  perfCtl(d); debugOverlay(d);
  // rAF timestamps jitter by +-1-2 ms (more on 120 Hz ProMotion / vsync-off Macs). Feeding raw dt makes motion
  // visibly uneven at ~80 fps; a light EMA that snaps on real changes keeps speed exact over time but smooth.
  const dc = Math.min(0.05, d);
  sdt = Math.abs(dc - sdt) > sdt * 0.5 ? dc : sdt + (dc - sdt) * 0.3;
  frame(QA_FIXED ? 1 / 30 : sdt);
}
function frame(dt) {
  t += dt;
  const playing = G.state === 'playing';
  if (playing) {
    G.levelTime += dt; G.timer -= dt; G.bonusFlash -= dt;
    G.stun = Math.max(0, (G.stun || 0) - dt); G.invuln = Math.max(0, (G.invuln || 0) - dt); G.stealFlash = Math.max(0, (G.stealFlash || 0) - dt);
    updatePlayer(dt);
    updateDelivery(dt);
    if (G.timer < 10 && Math.floor(G.timer) !== G.lastTick) { G.lastTick = Math.floor(G.timer); if (G.timer > 0) sfx.tick(); }
    if (G.timer <= 0 && G.delivered < G.total) gameOver();
  } else if (G.state !== 'paused') { santa.update(dt, 0, false); }
  if (G.state !== 'paused') {
    updateTargets(dt, t);
    obstacles.update(dt, { player, t, levelTime: G.levelTime, playing });
    updateIntro(dt);
    updateStorm(dt);
    if (obstacles.gust.k > 0 && G.weather) G.weather.wind = Math.min(1.4, G.weather.wind + obstacles.gust.k * 0.9);
    world.update(dt, t);
    interiors?.update(t);
    if (world.bulbMat) { const u = world.bulbMat.uniforms; u.uTime.value = t; u.uFog.value = scene.fog?.density ?? 0;
      u.uPx.value = renderer.getDrawingBufferSize(_dbs).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); }
    pines?.update(camera.position, dt, false, G.state === 'playing' ? { x0: camera.position.x, z0: camera.position.z, x1: player.pos.x, z1: player.pos.z } : null);
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
  lightT -= dt; if (lightT <= 0) { lightT = 0.12; updateLightPool(); } fadeLightPool(dt);
  const focus = G.state === 'playing' || G.state === 'paused' || G.state === 'levelComplete' || G.state === 'gameOver' ? player.pos : _ORIGIN;
  updateShadow(focus);
  if (G.wardrobe && G.state === 'title') wardrobeLights(true); else if (WL.on) wardrobeLights(false);
  snow.update(t, _v0.set(camera.position.x, 0, camera.position.z), G.storm, G.weather);
  if (G.state !== 'title' && G.state !== 'ending') {
    const S = { score: G.score, delivered: G.delivered, total: G.total, timer: G.timer, level: G.level, levelName: CONFIG.levels[G.level].name, mump: G.mumpLeft > 0, mumpLeft: G.mumpLeft, mumpDur: G.mumpDur, inRange: G.inRange || 0, powerupsLeft: G.powerups.filter(p => p.active).length, storm: G.storm, hint: G.hint, bonusFlash: G.bonusFlash };
    hud.update(dt, S);
    const left = X.comboWindow - (G.levelTime - G.lastDeliverT);
    hud.combo(left > 0 && G.state === 'playing' ? G.combo : 0, comboMult(G.combo), Math.max(0, left / X.comboWindow));
    const Lv = CONFIG.levels[G.level];
    hud.drawMinimap({ player: player.pos, heading: player.heading, camYaw: cam.yaw, targets: G.targets, powerups: G.powerups, ice: G.ice, areaRadius: Lv.areaRadius, areaMin: Lv.areaMin, marks: obstacles.marks(), mump: G.mumpLeft > 0 });
    hud.gust(obstacles.gust, cam.yaw, G.state === 'playing');
    hud.status({ lag: G.inLag && G.mumpLeft <= 0, steal: G.stealFlash > 0 });
  }
  nav?.update(dt, t, { player: { x: player.pos.x, y: player.surfY || 0, z: player.pos.z }, targets: G.targets, camera, playing: G.state === 'playing' });
  // --- FX layer
  const camDist = camera.position.distanceTo(santa.root.position);
  fxs.cones?.update(dt, t, G.storm);
  fxs.smoke?.update(t, G.storm, renderer.domElement.height, camera.fov);
  fxs.feet?.update(t, player.pos, player.heading, !santa.stepEvents && playing && !G.onIce && !player.paved && player.speed > 0.3);
  fxs.puffs?.update(dt, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  fxs.sparkles?.update(t, player.pos);
  trail.update(dt, santa.trailKind, santa.root.position, player.heading, player.speed, playing);
  fxs.waves.update(dt);
  for (const L of fxs.snowLayers) L.s.update(t, L.near ? camera.position : _v0.set(camera.position.x, 0, camera.position.z), G.storm, G.weather);
  G.flash = Math.max(0, (G.flash || 0) - dt * 2.2);
  const dofFocus = G.state === 'title' ? cam.pos.distanceTo(cam.look) : G.state === 'ending' ? 200 : camDist;
  post.update(t, { focus: dofFocus, boost: G.mumpLeft > 0 ? 0.6 + 0.4 * Math.sin(t * 4) : 0, flash: G.flash, storm: G.storm });
  if (simOnly) return;
  culler?.update(dt, camera);
  post.render();
  if (BP.enabled) blackProbe(t); // opt-in (?probe=1): its synchronous readPixels stalled the GPU pipeline every 2 s (periodic hitch)
  music.setBoost(G.state === 'playing' && G.mumpLeft > 0); sfx.wind(G.state === 'playing' || G.state === 'paused' ? (G.storm || 0) : 0.15);
  governor.tick(dt, (G.state === 'playing' || G.state === 'title') && (!dyn.on || dynScale <= PERF.minScale + 1e-3));
  post.setCinematic(G.state === 'title' || G.state === 'levelComplete' || G.state === 'ending' || G.state === 'intro');
  // perf stats
  const now = performance.now(); perf.frames.push(now - perf.last); perf.last = now; if (perf.frames.length > 240) perf.frames.shift();
}

function debugAPI() {
  return {
    G, player, CONFIG, renderer, world, santa, scene, camera, post, get hud() { return hud; }, get nav() { return nav; },
    get state() { return G.state; },
    cosmetics, progress, showUnlocks, openWardrobe, closeWardrobe, WD, lb, openBoard, closeBoard, tryLook: (ids) => { const L = cosmetics.look(); for (const id of ids) { const it = BY_ID[id]; L[it.slot] = it; } applyLook(santa, L); return Object.values(L).map(i => i.id); },
    resolveWindows: async (rects) => { const { resolveWindows } = await import('./interiors.js?v=9e6ba718'); const out = {}; for (const b of world.buildings) { if (!b.isGLB || out[b.type] || !rects[b.type]) continue; out[b.type] = resolveWindows(b.holder.children[0], b.holder, rects[b.type]); } return out; },
    facadeShots: async (side = 0, mask = false) => { const { facadeShot } = await import('./interiors.js?v=9e6ba718'); const out = {}; for (const b of world.buildings) { if (!b.isGLB || out[b.type]) continue; out[b.type] = facadeShot(b.holder.children[0], b.holder, renderer, side, 48, mask); } return out; },
    // dev: detect lit window rects on each Tripo building type (output -> assets/windows.js)
    detectWindows: async () => { const { detectWindows } = await import('./interiors.js?v=9e6ba718'); const out = {}; for (const b of world.buildings) { if (!b.isGLB || out[b.type]) continue; const o = b.holder.children[0]; out[b.type] = detectWindows(o, b.holder, renderer); } return out; },
    start: (lv = 0) => { G.qaMute = true; initAudio(false); startLevel(lv); },
    // stage beatability: road-graph route estimate vs timer for one stage (i) or all of them
    routeCheck: (i = null) => { const sp = spawnPoint(); const one = k => routeCheck(graph, planStage(world, graph, k, sp), sp); return i == null ? CONFIG.levels.map((_, k) => one(k)) : one(i); },
    get obstacles() { return obstacles; }, graph: () => graph, plan: (i) => planStage(world, graph, i, spawnPoint()), intros: (i) => stageIntros(i),
    hit: (kind = 'plow') => hitPlayer(kind, { nx: 1, nz: 0, steal: 2, msg: 'QA hit' }),
    input, player, G,
    completeLevel: () => { for (const tg of G.targets) deliver(tg); },
    lastRun: () => G.lastRun, cardInfo: () => G.lastCardInfo && { ...G.lastCardInfo, portrait: !!G.lastCardInfo.portrait }, cardPNG: () => G.lastCard?.toDataURL('image/png'),
    fail: () => { G.timer = 0.01; },
    deliverSome: (n) => { G.targets.filter(t => !t.delivered).slice(0, n).forEach(deliver); },
    givePowerup: () => { const p = G.powerups.find(p => p.active) || G.powerups[0]; pickPowerup(p); },
    teleport: (x, z, heading) => { player.pos.set(x, 0, z); if (heading !== undefined) { player.heading = heading; cam.yaw = heading; } cam.pos.set(x, 30, z); },
    teleportNearTarget: (i = 0, back = 6) => { const tg = G.targets[i]; const b = tg.b; const x = b.trigger.x + b.front.x * back, z = b.trigger.z + b.front.z * back; player.pos.set(x, 0, z); player.heading = Math.atan2(-b.front.x, -b.front.z); cam.yaw = player.heading; },
    skipToEnding: () => { G.level = CONFIG.levels.length - 1; G.state = 'playing'; levelComplete(); },
    // setStorm(1) ramps the storm in (rampIn s), setStorm(0) clears it (rampOut s), setStorm(null) = back to the level schedule
    setStorm: (v) => { G.stormForce = v == null ? null : +v; },
    weather: () => ({ preset: CONFIG.levels[G.level]?.weather, storm: +G.storm.toFixed(3), ...Object.fromEntries(Object.entries(G.weather || {}).map(([k, v]) => [k, +v.toFixed(4)])) }),
    fps: () => { const f = perf.frames; const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length); return { avgFrameMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), samples: f.length }; },
    interiors: () => interiors && { n: interiors.windows.length, list: interiors.windows.map((w, i) => interiors.info(i)) },
    windowInfo: i => interiors?.info(i),
    nearSnow: v => fxs.snowLayers.forEach(L => { if (L.near) L.s.points.visible = !!v; }),
    cam: (pos, look, fov, rel = false) => { G.camOverride = pos ? { pos, look, fov, rel } : null; },
    injectNaN: on => { world.sky.material.uniforms.uNaN.value = on ? 1 : 0; return true; },
    sanitize: on => { if (post.sanitize) post.sanitize.enabled = on; return on; },
    build: new URL(import.meta.url).searchParams.get('v') || 'dev', // cache-bust stamp (tools/bump-version.mjs)
    audio: () => audioStatus(),
    audioOffline: (sec = 20, legacy = false, rate = 2.2) => renderEndingOffline(sec, legacy, rate),
    nanView: on => { post.nanView(on); return !!post.sanitize; },
    safety: () => ({ on: SAFE.on, level: SAFE.level, steps: SAFE.steps, dynScale, pixelRatio: renderer.getPixelRatio() }),
    fx: () => ({ blackProbe: BP.steps, quality: Q, governor: governor.applied, chimneys: world.buildings.filter(b => b.chimney).length, lamps: fxs.cones?.lamps.length || 0, env: !!scene.environment }),
    santaPos: () => player.pos.toArray(),
    camYaw: (y) => { if (y !== undefined) { cam.yaw = y; input.lastManualCam = performance.now(); } return { yaw: cam.yaw, dist: +cam.dist.toFixed(2), h: +(cam.h ?? 0).toFixed(2), pos: camera.position.toArray().map(v => +v.toFixed(2)), fov: +camera.fov.toFixed(1), near: camera.near }; },
    advance: (sec, step = 1 / 30) => { simOnly = true; try { for (let i = 0; i < Math.round(sec / step); i++) frame(step); } finally { simOnly = false; } return G.state; },
    // one fully rendered frame, all passes (shadow + scene + post): draw calls / triangles / pixel size
    pines: () => pines?.stats(),
    grounding: () => santa.grounding?.(),
    prints: () => fxs.feet ? Array.from(fxs.feet.birth).filter(b => b > -1e3).length : -1,
    jump: () => { player.jumpBuf = CONFIG.player.jump.bufferTime; },
    playerState: () => ({ x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), jy: +player.jy.toFixed(2), air: player.air, speed: +player.speed.toFixed(2), sprintK: +player.sprintK.toFixed(2), surfY: +player.surfY.toFixed(3), paved: player.paved }),
    decorGaps: (g, s) => world.decorGaps(g, s),
    floatingDecor: () => world.floatingDecor(pines ? pines.trees.map(t => ({ kind: t.mini ? 'miniTree' : 'pine', x: t.x, y: t.y, z: t.z })) : []),
    stats: () => {
      culler?.update(1, camera); const I = renderer.info; I.autoReset = false; I.reset(); renderer.shadowMap.needsUpdate = true; post.render(); const all = { calls: I.render.calls, triangles: I.render.triangles };
      I.reset(); const sm = renderer.shadowMap.autoUpdate; renderer.render(scene, camera); const sc = { calls: I.render.calls, triangles: I.render.triangles }; I.autoReset = true;
      let meshes = 0, inst = 0, lights = 0; scene.traverseVisible(o => { if (o.isMesh || o.isPoints || o.isLine) meshes++; if (o.isInstancedMesh) inst += o.count; if (o.isLight && o.intensity > 0) lights++; });
      const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
      return { quality: Q.name, post: post.enabled, lowApplied, lowChunkInfo, culled: culler ? culler.list.length : 0, far: camera.far, pixelRatio: renderer.getPixelRatio(), buffer: [sz.x, sz.y], shadowMap: moon.shadow.mapSize.x, shadows: renderer.shadowMap.enabled, msaa: Q.msaa, ao: !!post.ao?.enabled, dof: !!post.final?.uniforms.uDof?.value, frame: all, sceneOnly: sc, visibleObjects: meshes, instances: inst, lights, programs: I.programs?.length, textures: I.memory.textures, geometries: I.memory.geometries };
    },
    // triangle budget by object (visible, in-frustum), largest first
    breakdown: (top = 25) => {
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); const rows = new Map();
      scene.updateMatrixWorld(); scene.traverseVisible(o => {
        if (!(o.isMesh || o.isPoints) || !o.geometry) return; if (o.frustumCulled && !fr.intersectsObject(o)) return;
        const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isPoints ? 0 : 1), n = o.isInstancedMesh ? o.count : 1;
        let k = o.name || o.parent?.name || o.material?.name || o.type; let p = o; while (p && !p.userData?.type && p.parent) p = p.parent; if (p?.userData?.type) k = 'bld:' + p.userData.type;
        const r = rows.get(k) || { k, objs: 0, tris: 0, inst: 0, shadow: 0 }; r.objs++; r.tris += tri * n; r.inst += n; if (o.castShadow) r.shadow += tri * n; rows.set(k, r);
      });
      return [...rows.values()].sort((a, b) => b.tris - a.tris).slice(0, top).map(r => [r.k, r.objs, r.inst, Math.round(r.tris), Math.round(r.shadow)]);
    },
    info: () => ({ quality: Q.name, buildings: world.buildings.length, bulbs: world.bulbs.length, pines: world.streetPines?.length, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}

boot().catch(e => { console.error(e); $('loading').innerHTML = `<div style="color:#f88">Failed to start: ${e.message}</div>`; });
