// =====================================================================
//  ASSET MANIFEST — maps every game entity to a GLB (Tripo3D export) and
//  a procedural fallback. Drop GLBs in assets/models/, then run
//      node tools/scan-models.mjs
//  which rewrites assets/models/models.json (list of present files).
//  The loader only requests GLBs listed there (no 404 noise), and falls
//  back to the procedural placeholder if a GLB is missing or fails.
//
//  Fields:
//   glb        path relative to index.html
//   scale      uniform scale applied after load (ignored when fit is set)
//   fit        {height} or {footprint:[w,d], height}: auto-scale GLB to size
//   rotationY  radians, to make the model face +Z (door/front = +Z)
//   yOffset    vertical offset after grounding (GLB is grounded to y=0)
//   clips      logical -> clip name inside the GLB (Mixamo names by default)
//   holdBone   bone the gift box attaches to (Santa only)
//   holdOffset gift offset in Santa's local space (meters) when holdBone missing
//   footprint  collision footprint [w,d] (buildings) — also used by fallback
//   door       door position in local space [x,y,z] (front = +Z); GLB buildings use their real bbox for door/height/collider
//   logo       [x,y,z,width] normalised facade spot for the vector Optimum logo overlay
//   windowMaterials  material-name substrings that light up (warm -> blue)
// =====================================================================

export const MANIFEST = {
  characters: {
    santa: {
      glb: 'assets/models/santa.glb',
      fit: { height: 1.85 },
      rotationY: 0,
      clips: {
        idle: 'idle', walk: 'walk', run: 'run', // Tripo retarget presets (biped:idle/walk/run)
        // Tripo has no carry preset: santa.js overrides the arm bones (2-bone IK) to hold the gift
      },
      carryIK: true,
      holdBone: 'mixamorigSpine2', // gift is parented to chest bone, in front of chest
      holdOffset: [0, 1.1, 0.36],
      walkSpeedRef: 1.6, // m/s at which the walk clip looks right (timeScale sync)
      runSpeedRef: 4.2,
    },
    // Optimum mascot in a Santa outfit (Tripo v3.1 model / v3.5 texture, biped rig, retarget idle/walk/run/jump).
    // tools/mascot_bake.mjs adds a per-vertex _CLS attribute (velvet / fur trim / mask / face / flame edge).
    mascot: {
      glb: 'assets/models/mascot.glb',
      fit: { height: 1.7 },
      rotationY: 0,
      clips: { idle: 'idle', walk: 'walk', run: 'run', jump: 'jump' },
      carryIK: true,
      holdBone: 'mixamorigSpine1',
      holdOffset:[0.1,0.7,0.40], giftScale:1.45,
      walkSpeedRef: 1.6,
      runSpeedRef: 4.2,
      faceWhite: [166, 163, 172], // sRGB face colour sampled from the baked texture (decal fill)
    },
    reindeer: {
      glb: 'assets/models/reindeer.glb',
      fit: { height: 1.7 },
      rotationY: 0,
      clips: { walk: 'walk' }, // 'preset:quadruped:walk'; idle = paused walk (no quadruped idle preset)
      walkSpeedRef: 1.4,
    },
  },

  buildings: {
    logCabin:       { glb: 'assets/models/building_log_cabin.glb',       footprint: [8, 10],   height: 6.5,  door: [0, 0, 3.5] },
    stoneCottage:   { glb: 'assets/models/building_stone_cottage.glb',   footprint: [7.5, 9.4],   height: 7,    door: [0, 0, 3.5] },
    bakery:         { glb: 'assets/models/building_bakery.glb',          footprint: [9, 9],  height: 8,    door: [0, 0, 4] },
    church:         { glb: 'assets/models/building_church.glb',          footprint: [10, 16], height: 20,   door: [0, 0, 8], smoke: false },
    townhouse:      { glb: 'assets/models/building_townhouse.glb',       footprint: [7, 7],   height: 11,   door: [0, 0, 4] },
    validatorHouse: { glb: 'assets/models/building_townhouse.glb',       footprint: [7, 7],   height: 11,   door: [0, 0, 4], sign: true }, // official-mark neon sign (no baked logo)
    toyWorkshop:    { glb: 'assets/models/building_toy_workshop.glb',    footprint: [12, 9.5],  height: 8.5,  door: [0, 0, 4.5] },
    inn:            { glb: 'assets/models/building_inn.glb',             footprint: [13, 11],  height: 9,    door: [0, 0, 4.5] },
    gingerbread:    { glb: 'assets/models/building_gingerbread.glb',     footprint: [8, 7.4],   height: 7,    door: [0, 0, 3.5] },
    windmill:       { glb: 'assets/models/building_windmill.glb',        footprint: [9, 7.3],   height: 13,   door: [0, 0, 3.5], smoke: false },
  },
  // (GLB buildings: height/door/collider come from the model's real bounding box; footprint = placement box)
  windowMaterials: ['window', 'glass', 'light', 'emissive'],

  props: {
    pine:          { glb: 'assets/models/prop_pine.glb',           fit: { height: 9 },  instanced: true },
    streetLamp:    { glb: 'assets/models/prop_street_lamp.glb',    fit: { height: 4.2 }, instanced: true, headY: 3.75 },
    christmasTree: { glb: 'assets/models/prop_christmas_tree.glb', fit: { height: 15 } },
    snowman:       { glb: 'assets/models/prop_snowman.glb',        fit: { height: 1.9 } },
    sleigh:        { glb: 'assets/models/prop_sleigh.glb',         fit: { height: 1.8 } }, // front (curled dash) faces +Z
    bench:         { glb: 'assets/models/prop_bench.glb',          fit: { height: 0.9 } },
    giftPile:      { glb: 'assets/models/prop_gift_pile.glb',      fit: { height: 1.1 } },
    giftBox:       { glb: 'assets/models/prop_gift_box.glb',       fit: { height: 0.5 } },
    // Tripo snowplow (front faces +Z); obstacles.js instances it, places beacon/headlight glows at these local points
    snowplow:      { glb: 'assets/models/prop_snowplow.glb',       fit: { height: 2.36 }, instanced: true, zOffset: 0.2,
                     beacon: [0, 2.36, 0.47], headlights: [[-0.68, 1.05, 2.1], [0.68, 1.05, 2.1]] },
  },
};
