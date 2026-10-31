// =====================================================================
//  Santa's Block Delivery — ALL gameplay / branding / quality tunables.
//  Edit this file only. Nothing here requires regenerating assets.
//  URL overrides (handy for testing): ?difficulty=hard&quality=low&level=2
// =====================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- branding
  branding: {
    title: "Santa's Block Delivery",
    subtitle: 'An Optimum mump2p Christmas',
    // Target total staked ETH. The score climbs to exactly this value when the
    // final level is cleared. Real figure is 3M+ today and will change in
    // December — just edit these numbers/labels.
    targetStakedEth: 3_000_000,
    targetLabel: '3M+ ETH staked', // free text shown on title + ending screens
    scoreLabel: 'Staked ETH',
    scoreUnit: 'ETH',
    gossipMs: 275.3, // normal gossip block propagation (ms)
    optimumMs: 135.6, // Optimum mump2p propagation (ms)
    gossipLabel: 'Gossip',
    optimumLabel: 'Optimum',
    mumpLabel: 'mump2p 3x',
    endingText: 'This is Optimum',
    endingSubtext: 'Every validator got the block. ~3x faster.',
  },

  // ---------------------------------------------------------- "Boosted" tag
  // Optimum's current tagline. All strings + combo tuning live here.
  // {n} is replaced by the combo count, {mult} by the score multiplier.
  boosted: {
    callout: 'BOOSTED!', // big animated callout when mump2p activates
    calloutSub: 'mump2p · {optimumMs} ms · {speed}x faster delivery', // {speed} = powerup.speedFactor, {optimumMs} = branding.optimumMs
    calloutDuration: 2.2, // seconds on screen
    houseLabel: 'Boosted', // small label floating over houses that got the block
    comboText: 'Boosted x{n}', // shown on consecutive deliveries (n >= 2)
    comboSubText: 'score x{mult}',
    comboWindow: 6, // seconds between deliveries to keep the combo alive
    comboMultStep: 0.25, // multiplier = 1 + (n-1) * step ...
    comboMaxMult: 3, // ... capped here
    resultsLabel: 'Houses Boosted', // stat on level complete / game over
    bestComboLabel: 'Best combo',
    trail: true, // blue light trail behind Santa while boosted
  },

  // ------------------------------------------------------------- difficulty
  // Presets only scale numbers at runtime -> no asset regeneration needed.
  difficulty: 'normal',
  difficultyPresets: {
    easy:   { timerMult: 1.45, holdMult: 0.7, speedMult: 1.08, powerupDurationMult: 1.35, powerupCountAdd: 1, stormMult: 0.6, iceSlipMult: 0.6, slowNodeMult: 0.7 },
    normal: { timerMult: 1.0,  holdMult: 1.0, speedMult: 1.0,  powerupDurationMult: 1.0,  powerupCountAdd: 0, stormMult: 1.0, iceSlipMult: 1.0, slowNodeMult: 1.0 },
    hard:   { timerMult: 0.78, holdMult: 1.3, speedMult: 0.96, powerupDurationMult: 0.75, powerupCountAdd: -1, stormMult: 1.4, iceSlipMult: 1.25, slowNodeMult: 1.3 },
  },

  // ----------------------------------------------------------------- levels
  // validators: number of marked houses; timer: seconds; areaRadius: radius
  // (world units, from the town square) inside which targets are picked.
  // powerups: Optimum pickups spawned on roads; powerupDuration: seconds.
  levels: [
    { name: 'Genesis Eve',      validators: 6,  timer: 110, areaRadius: 62,  powerups: 2, powerupDuration: 10, weather: 'clear',     ice: false, slowNodes: 0, iceCount: 0 },
    { name: 'Frosty Finality',  validators: 9,  timer: 130, areaRadius: 98, powerups: 3, powerupDuration: 10, weather: 'lightSnow', ice: true,  slowNodes: 2, iceCount: 10 },
    { name: 'Silent Slot',      validators: 13, timer: 150, areaRadius: 125, powerups: 3, powerupDuration: 9,  weather: 'storms',    ice: true,  slowNodes: 4, iceCount: 16 },
  ],

  // -------------------------------------------------------------- character
  // Player character. 'mascot' = the Optimum mascot in a Santa outfit (Tripo model, rigged + retargeted),
  // 'santa' = the earlier Santa GLB (kept as fallback). Only the chosen GLB is downloaded.
  character: {
    type: 'mascot', // 'mascot' | 'santa'   (URL override: ?character=santa)
    name: 'Optimum Santa', // display name
    storyName: 'Santa Optimum', // used in the title-screen story ("<storyName> is carrying the newest block")
    jumpVelocity: 5.6, // m/s celebrate-hop reference (the player jump itself lives in player.jump)
    grounding: { snowSink: 0.05, footSnap: 25, blobShadow: 0.42, stepPuffs: true, strideSync: true, strideAmpMax: 1.4, runCadenceMax: 3.6 },
    gravity: 16,
    celebrateHop: 3.4, // hop velocity on each delivery
    leanAmount: 0.05, // roll per (rad/s * m/s) of turning
    maxLean: 0.24,
    headBob: 0.06,
    expressions: {
      // which face shows for each game event (any key of FACES in src/mascotface.js)
      idle: 'neutral', deliver: 'happy', boosted: 'determined', storm: 'confused', slowNode: 'confused',
      iceSlip: 'confused', iceEnter: 'surprised', jump: 'surprised',
      deliverHold: 1.6, surprisedHold: 0.9, blinkEvery: [2.2, 5.0], // seconds
    },
    flame: { tongues: 14, height: 0.27, intensity: 0.75, embers: { high: 60, medium: 32, low: 0 }, light: { high: 0.9, medium: 0.7, low: 0 }, lightDistance: 7 },
    fur: { layers: { high: 7, medium: 4, low: 0 }, length: 0.016, density: 260 },
  },

  // ----------------------------------------------------------------- player
  player: {
    walkSpeed: 6.5, // units/s  (map is ~360 units across => ~55s walking)
    sprintSpeed: 11.5,
    accel: 28, // ground acceleration
    iceAccel: 3.2, // acceleration while on ice (lower = slipperier)
    iceFriction: 0.25, // velocity damping on ice (lower = slides longer)
    turnSpeed: 12,
    radius: 0.7,
    // real jump (Space / JUMP button): clears the snowy picket fences, benches, sleds, snow banks; walls stay solid
    jump: { velocity: 8.2, gravity: 22, coyoteTime: 0.12, bufferTime: 0.14, // apex = v^2/2g ~ 1.53 m
      fenceHeight: 1.0, benchHeight: 0.85, lowPropHeight: 0.5 }, // collider tops (m): feet above the top pass over
    // touch auto-sprint: joystick pushed past radiusFrac of its radius, or a direction held holdTime seconds
    autoSprint: { radiusFrac: 0.85, holdTime: 1.2, rampTime: 0.55, keyboardHold: false },
  },

  camera: {
    distance: 5.3, // low over-the-shoulder follow (Santa ~30% of frame height, like the concept art)
    height: 2.55,
    lookHeight: 1.45,
    lookAhead: 5.5, // look down the street ahead of Santa
    shoulder: 0.8, // camera sits a little to Santa's right
    followLerp: 6,
    autoYawRate: 1.4, // how fast the camera swings behind Santa
    fov: 58,
  },

  // --------------------------------------------------------------- delivery
  delivery: {
    doorRadius: 3.4, // how close to the door to auto-deliver
    holdTime: 0.9, // seconds standing at the door in gossip mode (one by one)
    slowNodeHoldMult: 2.6, // slow nodes need this x longer
    timerBonus: 4, // seconds added per delivered block
    gossipFlightTime: 0.55, // visual flight time of the gift (scaled 275 ms)
  },

  // --------------------------------------------------- Optimum mump2p power-up
  powerup: {
    pickupRadius: 2.4,
    shardRadius: 70, // marked houses within this radius get shards
    pulseInterval: 1.2, // while active, re-broadcast to houses that come in range
    speedFactor: 3, // delivery speed-up (hold time / 3, flight 3x faster)
    shardFlightTime: 1.3,
    respawn: true,
    respawnDelay: 12,
  },

  // -------------------------------------------------------------- obstacles
  obstacles: {
    // snowstorm timing/intensity now lives in CONFIG.weather.storm (levels opt in through their weather preset)
    ice: { minRadius: 3.5, maxRadius: 6.5 },
    slowNode: { flickerHz: 7 },
  },

  // ---------------------------------------------------------------- weather
  // Dynamic weather. Each level names a preset (levels[i].weather). A preset with storms:true runs the snowstorm
  // obstacle: fog density, snow amount and wind ramp up smoothly (rampIn s), hold, then clear (rampOut s).
  // fog = FogExp2 density · snow = fraction of the snow particle pool drawn (1 = all) · wind = 0..1 drift
  // fall = flake fall-speed multiplier · post = bloom/DOF so clear nights stay crisp and readable.
  // fake-interior parallax rooms behind the lit windows of the Tripo houses (src/interiors.js, rects in assets/windows.js)
  interiors: { enabled: true, push: 0.05, inset: 0.94 }, // push = metres in front of the glass, inset = quad scale vs the detected rect
  weather: {
    presets: {
      clear:     { fog: 0.0042, snow: 0.3,  wind: 0.08, fall: 0.85, storms: false },
      lightSnow: { fog: 0.0062, snow: 0.75, wind: 0.22, fall: 1.0,  storms: false },
      storms:    { fog: 0.0055, snow: 0.55, wind: 0.2,  fall: 1.0,  storms: true },
    },
    storm: { fog: 0.05, snow: 1.0, wind: 1.0, fall: 2.4, rampIn: 4.0, rampOut: 6.0, firstAt: 22, every: 38, duration: 14 },
    presetBlend: 1.5,                 // seconds to blend fog/snow/wind when the level (preset) changes
    fogColor: 0x0d1a36, stormFogColor: 0x2b3547,
    post: {
      clear: { bloomStrength: 0.42, bloomRadius: 0.32, bloomThreshold: 0.92, dofBlurPx: 1.4 },
      storm: { bloomStrength: 0.55, bloomRadius: 0.45, bloomThreshold: 0.88, dofBlurPx: 2.4 },
    },
  },

  // ------------------------------------------------------------------ world
  // navigation aids
  nav: { arrow: false, distance: false, arrowRadius: 2.2, arrowScale: 1.05, arrowHideNear: 4.5, beacons: true, beaconHeight: 70, edgeIndicators: true, edgeMax: 3, edgeMargin: 44,
         mapPath: true, mapChecks: true, housesLeft: true, housesLeftText: '{n} houses left', houseLeftOne: '1 house left' },
  // shop-sign names (crisp code-drawn lettering over the baked AI sign boards); '' = plain board. Church/houses: no text.
  signs: { bakery: 'Bakery', toyWorkshop: 'Toy Workshop', inn: 'Inn', font: "700 {px}px Georgia, 'Times New Roman', 'Palatino Linotype', serif" },
  // house string lights (all quality tiers): roof edges + ridge + door/window frames, one Points draw
  stringLights: { enabled: true, spacing: 0.15, spacingLow: 0.22, ridge: true, doors: true, windows: true, size: 0.34, intensity: 2.4, minPx: 2.2 },
  world: {
    seed: 1225,
    radius: 150, // playable radius (village ~ r 112, then the forest edge)
    // street layout: closed ring streets + radial mains (degrees) + cross streets; houses face the street
    layout: { rings: [56, 92], mains: [20, 110, 215, 300], cross: [65, 160, 258, 345], lakeLane: true,
              setback: [2.4, 3.4], gap: [0.8, 2.0], wideGapChance: 0.12, pathWidth: 1.6 },
    forestStart: 116, // forest edge ring around the village
    roadWidth: 7,
    squareRadius: 24,
    forestTrees: 1150,
    lampSpacing: 22,
    spawnRadius: 40, // Santa starts this far out on the main street, facing the square
    lampSpacingDense: 13, // street lamps inside the dense village core
    denseRadius: 130, // houses line the streets shoulder-to-shoulder inside this radius
    stringLightRadius: 1000, // eave string lights on houses inside this radius
    lakeCenter: [-112, 70],
    lakeRadii: [20, 14],
  },

  // ---------------------------------------------------------------- quality
  // 'auto' picks low on touch devices / small screens, high otherwise, and then
  // auto-degrades at runtime (DOF -> AO -> light shafts -> resolution -> shadows -> bloom)
  // if the frame rate stays under ~30 fps. An explicit ?quality= never degrades.
  quality: 'auto',
  qualityPresets: {
    //        render scale       shadows (PCF soft)                    post / FX
    // low = genuinely light: NO composer (direct render: no bloom / grade / NaN pass / probe), no shadows, no point
    // lights, 1x (0.75x on 3x phones), merged house add-ons, instancing culled to cullRadius, LOD1 beyond lodDistance,
    // draw distance `far` hidden by a fog floor. Target: < 150 draw calls, < 1.5M triangles at the busiest spot.
    low:    { pixelRatio: 1.0,  shadows: false, shadowMapSize: 512,  bloom: false, bloomScale: 0.5, msaa: 0, ao: false, dof: false, grade: false, env: true,
              shafts: false, smoke: false, footprints: true, sparkle: false, snowLayers: 1, snowCount: 600, forestScale: 0.4, lights: 0,  antialias: false,
              far: 64, fogMin: 0.026, cullRadius: 40, lodDistance: 24, chunkCell: 80, propRadius: 34 },
    medium: { pixelRatio: 1.25, shadows: true,  shadowMapSize: 2048, bloom: true, bloomScale: 0.75, msaa: 2, ao: false, dof: false, grade: true, env: true,
              shafts: true,  smoke: true,  footprints: true, sparkle: true,  snowLayers: 2, snowCount: 2500, forestScale: 0.8,  lights: 4,  antialias: false },
    // high = smooth 60 fps on an Apple M-series laptop: 1.5x render scale cap, 2K tight shadows, GTAO + DOF only in cutscenes
    high:   { pixelRatio: 1.5,  shadows: true,  shadowMapSize: 2048, bloom: true, bloomScale: 0.75, msaa: 4, ao: 'cinematic', dof: 'cinematic', grade: true, env: true,
              shafts: true,  smoke: true,  footprints: true, sparkle: true,  snowLayers: 3, snowCount: 3500, forestScale: 1.0,  lights: 5,  antialias: false },
    // ultra = beauty / screenshot preset (the old 'high'): 2x scale, 4K shadows, GTAO + DOF always on
    ultra:  { pixelRatio: 2.0,  shadows: true,  shadowMapSize: 4096, bloom: true, bloomScale: 1.0, msaa: 4, ao: true,  dof: true,  grade: true, env: true,
              shafts: true,  smoke: true,  footprints: true, sparkle: true,  snowLayers: 3, snowCount: 5000, forestScale: 1.0,  lights: 12, antialias: false },
  },
  // Look: tone mapping, image-based light (Poly Haven CC0 night HDRI), grade
  look: {
    toneMapping: 'ACES',            // 'ACES' | 'AgX'
    exposure: 0.98,
    hdri: 'assets/hdri/rogland_clear_night_1k.hdr',
    envIntensity: 0.55,
    vignette: 0.55, grain: 0.035,
    dofMaxBlurPx: 3.5,                // high preset only, subtle
    lampShaftIntensity: 0.12,
  },
  bloom: { strength: 0.7, radius: 0.5, threshold: 0.85 },
  // ---------------------------------------------------------------- performance
  performance: {
    targetFps: 60,              // dynamic resolution + quality governor aim for this (auto quality only)
    dynamicResolution: true,    // scale the render resolution with frame time (auto quality only)
    minScale: 0.6, maxScale: 1.0, // fraction of the preset pixel ratio
    maxPixels: { desktop: 4.2e6, mobile: 2.0e6 }, // hard cap on drawing-buffer pixels (also clamped to GPU limits)
    ios: { maxPixelRatio: 1.0, maxPixels: 1.3e6, msaa: 0, shadowMapSize: 512, bloomScale: 0.4 }, // iPhone/iPad Safari: lighter still (tile GPU memory, thermal throttling, jetsam kills)
    mobile: { maxPixelRatio: 1.5, ao: false, dof: false, msaa: 2, shadowMapSize: 1024 }, // always applied on touch devices
    shadowFrustum: 28,          // half-size (m) of the moon shadow box around the player
    viewCull: true, viewCullNear: 40, // MEDIUM/HIGH: whole-map instanced props kept within 40 m (shadow box) or inside the view cone
    pineNearRange: 58,          // m: full needle-card pines inside, impostor cards beyond
    decoRange: 70,              // m: decorations / bulbs drawn within this range of the camera
    lampRange: 110,
  },
  // audio: self-synthesised (src/audio.js, credits in assets/audio/CREDITS.md). Player volume/mute persist in localStorage.
  audio: { enabled: true, master: 0.9, music: 0.55, sfx: 0.8, footsteps: 0.5, boostLayer: 1, windBase: 0.02, windStorm: 0.22 },
};

// Apply URL overrides (?difficulty=easy|normal|hard, ?quality=low|medium|high, ?level=1..N)
export function applyUrlOverrides(cfg = CONFIG) {
  const p = new URLSearchParams(location.search);
  if (p.get('difficulty') && cfg.difficultyPresets[p.get('difficulty')]) cfg.difficulty = p.get('difficulty');
  if (['mascot', 'santa'].includes(p.get('character'))) cfg.character.type = p.get('character');
  if (p.get('quality') && (cfg.qualityPresets[p.get('quality')] || p.get('quality') === 'auto')) cfg.quality = p.get('quality');
  return cfg;
}

export function resolveQuality(cfg = CONFIG) {
  let q = cfg.quality;
  if (q === 'auto') {
    const touch = matchMedia('(pointer: coarse)').matches;
    q = touch ? 'low' : 'high'; // phones / tablets: the light preset (iOS Safari: memory + thermal headroom)
  }
  const Q = { name: q, auto: cfg.quality === 'auto', ...cfg.qualityPresets[q] };
  // touch devices (iPhone / iPad / Android): never GTAO / DOF, capped scale + MSAA + shadow size
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  Q.mobile = touch;
  if (touch && q === 'low' && (devicePixelRatio || 1) >= 3) Q.pixelRatio = 0.75;
  if (touch) { const M = cfg.performance.mobile; Q.pixelRatio = Math.min(Q.pixelRatio, M.maxPixelRatio); Q.ao = M.ao && Q.ao; Q.dof = M.dof && Q.dof; Q.msaa = Math.min(Q.msaa, M.msaa); Q.shadowMapSize = Math.min(Q.shadowMapSize, M.shadowMapSize); }
  // iOS Safari (incl. iPadOS that reports MacIntel): extra-light caps on top of the touch caps
  const ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || new URLSearchParams(location.search).get('ios') === '1';
  Q.ios = ios;
  if (ios) { const I = cfg.performance.ios; Q.pixelRatio = Math.min(Q.pixelRatio, I.maxPixelRatio); Q.msaa = Math.min(Q.msaa, I.msaa); Q.shadowMapSize = Math.min(Q.shadowMapSize, I.shadowMapSize); Q.bloomScale = Math.min(Q.bloomScale ?? 1, I.bloomScale); }
  // dev/QA: ?fx=ao:0,msaa:0,shadowMapSize:2048 overrides individual preset fields
  const fx = new URLSearchParams(location.search).get('fx');
  if (fx) for (const kv of fx.split(',')) { const [k, v] = kv.split(':'); if (k in Q) Q[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
  return Q;
}

export function difficulty(cfg = CONFIG) {
  return cfg.difficultyPresets[cfg.difficulty] || cfg.difficultyPresets.normal;
}

// Base Staked ETH per block: clearing every level with no combos == target.
// Boosted combos multiply this, so skilled runs can finish above the target.
export function ethPerBlock(cfg = CONFIG) {
  const total = cfg.levels.reduce((s, l) => s + l.validators, 0);
  return cfg.branding.targetStakedEth / total;
}

export function formatEth(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
  return Math.round(v).toString();
}

export function comboMult(n, cfg = CONFIG) {
  const b = cfg.boosted;
  return Math.min(b.comboMaxMult, 1 + Math.max(0, n - 1) * b.comboMultStep);
}
export function fmt(str, vars) { return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
