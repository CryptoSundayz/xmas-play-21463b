// Grinch bots + Reorg Grinch boss look (assets/models/enemy_grinch.glb, no rig).
// Everything is code animation so all bots stay ONE instanced draw call:
//  - vertex shader: fake walk cycle. Legs (below the hip, split by the sign of local X) rotate around a hip pivot,
//    the swinging foot lifts, arms swing opposite to their leg around a shoulder pivot, and the hat/head sway
//    with a lag. All weights are smooth functions of the rest position, so the surface can bend but never tear.
//    Per-instance attribute aWalk = (phase, amplitude 0..1, forward lag, side lag).
//  - instance matrix (CPU, obstacles.js): hop, squash-stretch, lean, hip sway, steal spin/pop, flee wobble.
//  - fragment: the Tripo ORM marks the white fur trim (and much of the cloth) as metal, which reads as chrome in the
//    day and as black at night (no env reflections). Fur -> matte, cloth/skin metal capped, brass/iron keep theirs.
//    A subtle fresnel rim + diffuse lift keep the silhouette readable at night without glowing; eyes get emissive.
import * as THREE from 'three';

// Normalised (height = 1) landmarks measured on the GLB (front = +Z). See qa/grinch/anim.html (debug view).
export const RIG = {
  hipY: 0.30,                 // hip pivot height = leg length L; legs fade out between 0.17 and 0.30 (coat hem stays put)
  kneeY: 0.15, ankleY: 0.05,  // knee + ankle pivots (two-bone leg: shin bends back on the swing, the sole stays flat on stance)
  legX: 0.175, footX: 0.235,  // |x| limit of the legs above / below ankle height (0.08)
  backZ: -0.09,               // the cape tail hangs behind the legs (z < -0.09): never part of a leg
  shY: 0.58,                  // arm pivot height; only forearm + hand (|x| 0.22 -> 0.30) swing, the sack and cape stay
  armX: [0.22, 0.30], armY: [0.08, 0.2, 0.48, 0.58],
  upY: [0.22, 0.36],          // upper body (lean pitch/roll around the hip) fades in here
  swayY: 0.62,                // head/hat follow-through starts here
  legSwing: 0.58,             // max hip swing (rad, ~33 deg) at amp 1
  knee: 1.05,                 // max swing-leg knee bend (rad)
  armSwing: 0.85,             // arm angle = -armSwing x the same-side hip angle (~28 deg)
  hop: 0.035,                 // flight-phase hop at full run (x H)
};
// Stance fraction of one leg's cycle: walk (double support) -> bouncy run (flight phase). Shared by shader + stepWalk.
export const stanceOf = (run) => 0.6 + (0.36 - 0.6) * Math.min(1, Math.max(0, run));

const VERT_HEAD = (R) => /* glsl */`
attribute vec4 aWalk; attribute vec4 aLean;
uniform float uH;
varying vec3 vGP; varying vec4 vGW;
vec3 gRotX(vec3 p, vec2 pv, float a) { float c = cos(a), s = sin(a); vec2 d = p.yz - pv; return vec3(p.x, pv.x + d.x * c + d.y * s, pv.y + d.y * c - d.x * s); }
vec3 gRotZ(vec3 p, vec2 pv, float a) { float c = cos(a), s = sin(a); vec2 d = p.xy - pv; return vec3(pv.x + d.x * c - d.y * s, pv.y + d.x * s + d.y * c, p.z); }
// one leg at cycle position u (0..1): stance [0,s) sweeps the foot back at constant ground speed (sin(theta) linear),
// swing [s,1) brings it forward with a knee bend and toe drop. -> (hip angle, knee angle, ankle angle, stance weight)
vec4 gLeg(float u, float s, float thm, float amp) {
  if (u < s) { float k = u / s; float th = asin(clamp(sin(thm) * (1.0 - 2.0 * k), -0.99, 0.99));
    return vec4(th, 0.0, -th, smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.9, 1.0, k)) + 1e-3); }
  float k = (u - s) / (1.0 - s), e = k * k * (3.0 - 2.0 * k), b = sin(3.14159265 * k);
  float th = -thm + 2.0 * thm * e, kn = -b * b * ${R.knee.toFixed(3)} * amp;
  return vec4(th, kn, -th - kn - 0.35 * b * amp, 0.0);
}
`;
// sets the per-vertex angles; shared by beginnormal + begin_vertex
const WALK = (R) => /* glsl */`
  vec3 gp0 = position / uH; float ph = aWalk.x, amp = aWalk.y, run = aWalk.z, st = aWalk.w;
  float sl = smoothstep(-0.03, 0.03, gp0.x);                     // 0 = right side (-X), 1 = left side (+X)
  float ax = abs(gp0.x), thm = amp * ${R.legSwing.toFixed(3)}, uR = fract(ph / 6.2831853), uL = fract(uR + 0.5);
  vec4 lR = gLeg(uR, st, thm, amp), lL = gLeg(uL, st, thm, amp), lg = mix(lR, lL, sl);
  float wLeg = (1.0 - smoothstep(0.17, 0.30, gp0.y)) * smoothstep(${(R.backZ - 0.01).toFixed(3)}, ${(R.backZ + 0.01).toFixed(3)}, gp0.z)
             * (1.0 - smoothstep(mix(${R.footX.toFixed(3)}, ${R.legX.toFixed(3)}, smoothstep(0.06, 0.10, gp0.y)) - 0.02, mix(${R.footX.toFixed(3)}, ${R.legX.toFixed(3)}, smoothstep(0.06, 0.10, gp0.y)), ax));
  float wShin = (1.0 - smoothstep(${(R.kneeY - 0.035).toFixed(3)}, ${(R.kneeY + 0.035).toFixed(3)}, gp0.y)) * wLeg;
  float wFoot = (1.0 - smoothstep(${(R.ankleY - 0.02).toFixed(3)}, ${(R.ankleY + 0.025).toFixed(3)}, gp0.y)) * wLeg;
  float wArm = smoothstep(${R.armX[0].toFixed(3)}, ${R.armX[1].toFixed(3)}, ax) * smoothstep(${R.armY[0].toFixed(3)}, ${R.armY[1].toFixed(3)}, gp0.y)
             * (1.0 - smoothstep(${R.armY[2].toFixed(3)}, ${R.armY[3].toFixed(3)}, gp0.y)) * smoothstep(${(R.backZ - 0.01).toFixed(3)}, ${(R.backZ + 0.04).toFixed(3)}, gp0.z);
  float aArm = -mix(lR.x, lL.x, sl) * ${R.armSwing.toFixed(3)} * wArm;
  float wUp = smoothstep(${R.upY[0].toFixed(3)}, ${R.upY[1].toFixed(3)}, gp0.y);
  float wTop = smoothstep(${R.swayY.toFixed(3)}, 1.0, gp0.y); wTop *= wTop;
  // keep the planted foot on the ground: the hip arc lifts a straight leg by L(1 - cos th); drop the body by the stance legs' arc
  float arcM = ${R.hipY.toFixed(3)} * (1.0 - cos(thm));
  float gDrop = (${R.hipY.toFixed(3)} * ((1.0 - cos(lR.x)) * lR.w + (1.0 - cos(lL.x)) * lL.w) + arcM * 0.02) / (lR.w + lL.w + 0.02);
  // goblin bounce: a hop while both feet are in the air (run) - zero whenever a foot is planted
  float fl = 0.5 - st, uS = fract(uR * 2.0) - st;              // flight window per step: [s, 0.5) of each half cycle
  float gHop = fl > 0.0 && uS > 0.0 ? sin(3.14159265 * clamp(uS / (fl * 2.0), 0.0, 1.0)) * ${R.hop.toFixed(3)} * run * amp : 0.0;
`;
const APPLY_P = (R) => /* glsl */`
  { vec3 q = gp0;
    q = gRotX(q, vec2(${R.ankleY.toFixed(3)}, 0.0), lg.z * wFoot);
    q = gRotX(q, vec2(${R.kneeY.toFixed(3)}, 0.0), lg.y * wShin);
    q = gRotX(q, vec2(${R.hipY.toFixed(3)}, 0.0), lg.x * wLeg);
    q = gRotX(q, vec2(${R.shY.toFixed(3)}, 0.0), aArm);
    q = gRotX(q, vec2(${R.hipY.toFixed(3)}, 0.0), aLean.x * wUp);
    q = gRotZ(q, vec2(0.0, ${R.hipY.toFixed(3)}), aLean.y * wUp);
    q.z -= wTop * aLean.z * 0.09; q.x += wTop * aLean.w * 0.07;
    q.y += gHop - gDrop; q.y = max(q.y, 0.0);
    transformed = q * uH; vGP = gp0; vGW = vec4(wLeg, wArm, max(wTop, wShin * 0.6), sl); }
`;
const APPLY_N = /* glsl */`
  objectNormal = gRotX(objectNormal, vec2(0.0), lg.z * wFoot + lg.y * wShin + lg.x * wLeg + aArm + aLean.x * wUp);
  objectNormal = gRotZ(objectNormal, vec2(0.0), aLean.y * wUp);
`;

function patchVertex(sh, R, normals) {
  sh.vertexShader = VERT_HEAD(R) + sh.vertexShader
    .replace('#include <beginnormal_vertex>', normals ? `#include <beginnormal_vertex>\n${WALK(R)}${APPLY_N}` : '#include <beginnormal_vertex>')
    .replace('#include <begin_vertex>', (normals ? '#include <begin_vertex>\n' : `#include <begin_vertex>\n${WALK(R)}`) + APPLY_P(R));
}

/** Patch a MeshStandardMaterial (the GLB's, cloned) for the grinch: walk + fur/metal fix + night readability.
 *  opts: { H: model height in local units, boss: bool }. Returns { material, depth, uniforms }. */
export function grinchMaterial(base, { H = 2.4, boss = false } = {}) {
  const m = base.clone(); m.userData.sharedMaps = true;
  m.metalness = 1; m.roughness = 1; // factors are multiplied with the ORM texture; overridden per texel below
  const U = { uH: { value: H }, uRim: { value: boss ? 0.38 : 0.22 }, uRimC: { value: boss ? new THREE.Color(1.0, 0.32, 0.22) : new THREE.Color(0.55, 0.85, 0.6) },
    uLift: { value: 0.05 }, uEye: { value: boss ? 2.2 : 1.6 }, uAura: { value: 0 }, uDebug: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    patchVertex(sh, RIG, true);
    sh.fragmentShader = 'uniform float uRim, uLift, uEye, uAura, uDebug; uniform vec3 uRimC; varying vec3 vGP; varying vec4 vGW;\n' + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      { vec3 c = diffuseColor.rgb; float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
        float fur = smoothstep(0.20, 0.36, mx) * (1.0 - smoothstep(0.16, 0.30, sat));
        // brass/gold: warm yellow (r >= g >> b); iron: dark and grey -> may stay metallic
        float brass = smoothstep(0.45, 0.65, sat) * smoothstep(0.45, 0.62, c.g / max(c.r, 1e-4)) * step(c.b, c.g) * step(c.g, c.r * 1.05);
        float iron = (1.0 - smoothstep(0.10, 0.22, sat)) * (1.0 - smoothstep(0.05, 0.12, mx));
        metalnessFactor = min(metalnessFactor, mix(0.12, 0.85, max(brass, iron)));
        metalnessFactor *= 1.0 - fur; roughnessFactor = mix(max(roughnessFactor, 0.45), 0.92, fur); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 c = diffuseColor.rgb; vec3 vd = normalize(vViewPosition);
        float fr = pow(1.0 - clamp(abs(dot(normalize(normal), vd)), 0.0, 1.0), 3.0);
        float eye = smoothstep(0.35, 0.6, c.r) * (1.0 - smoothstep(0.05, 0.12, max(c.g, c.b))) // red texels inside two small windows around the eyes only (the hat is red too)
          * (1.0 - smoothstep(0.035, 0.055, length(vec2(abs(vGP.x) - 0.067, vGP.y - 0.79)))) * step(0.08, vGP.z);
        totalEmissiveRadiance += c * uLift + uRimC * fr * (uRim + uAura) * (0.35 + 0.65 * smoothstep(0.0, 0.25, vGP.y)) + vec3(1.0, 0.18, 0.08) * eye * uEye;
        if (uDebug > 0.5) { diffuseColor.rgb = mix(vec3(0.45), vec3(vGW.x, vGW.y, vGW.z), max(vGW.x, max(vGW.y, vGW.z))) * (0.45 + 0.55 * vGW.w); totalEmissiveRadiance = diffuseColor.rgb * 0.6; } }`);
  };
  m.customProgramCacheKey = () => 'grinch-v2';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => { sh.uniforms.uH = U.uH; patchVertex(sh, RIG, false); };
  depth.customProgramCacheKey = () => 'grinch-depth-v2';
  return { material: m, depth, uniforms: U };
}

/** Add the per-instance walk attributes (aWalk = phase, amp, run, stance; aLean = pitch, roll, head lag fwd, side). */
export function addWalkAttribute(geometry, count) {
  const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const w = mk(), l = mk(); geometry.setAttribute('aWalk', w); geometry.setAttribute('aLean', l); return { walk: w, lean: l };
}

/** Advance a walker's cycle from the ground distance it covered (local units, model height H) so planted feet do not skate:
 *  in stance a foot sweeps 2 L sin(thm) back while the body covers stance x cycle length, so one cycle = 2 L sin(thm) / stance.
 *  w = { ph, amp, run }; ampTarget 0..1 (stride size), runTarget 0..1 (walk -> bouncy run). Returns w with w.st (stance). */
export function stepWalk(w, moved, dt, H, ampTarget, runTarget = 0) {
  const k = 1 - Math.exp(-8 * dt);
  w.amp += (ampTarget - w.amp) * k; w.run = (w.run || 0) + (runTarget - (w.run || 0)) * k;
  w.st = stanceOf(w.run);
  const cyc = 2 * RIG.hipY * H * Math.sin(Math.max(0.15, w.amp) * RIG.legSwing) / w.st;
  w.ph = (w.ph + moved / cyc * Math.PI * 2) % (Math.PI * 200);
  return w;
}

// CPU mirror of the shader's leg phase (hip angle + stance weight), so attachments can ride the body exactly.
function legJS(u, s, thm) {
  if (u < s) { const k = u / s, sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return [Math.asin(Math.max(-0.99, Math.min(0.99, Math.sin(thm) * (1 - 2 * k)))), sm(0, 0.1, k) * (1 - sm(0.9, 1, k)) + 1e-3]; }
  const k = (u - s) / (1 - s), e = k * k * (3 - 2 * k); return [-thm + 2 * thm * e, 0];
}
/** Whole-body vertical offset (x H) the shader applies: stance-leg arc drop + flight hop. W = stepWalk state. */
export function walkLiftY(W) {
  const R = RIG, thm = W.amp * R.legSwing, st = W.st ?? stanceOf(W.run || 0), fr = x => x - Math.floor(x);
  const uR = fr(W.ph / (2 * Math.PI)), lR = legJS(uR, st, thm), lL = legJS(fr(uR + 0.5), st, thm), arcM = R.hipY * (1 - Math.cos(thm));
  const drop = (R.hipY * ((1 - Math.cos(lR[0])) * lR[1] + (1 - Math.cos(lL[0])) * lL[1]) + arcM * 0.02) / (lR[1] + lL[1] + 0.02);
  const fl = 0.5 - st, uS = fr(uR * 2) - st;
  const hop = fl > 0 && uS > 0 ? Math.sin(Math.PI * Math.min(1, uS / (fl * 2))) * R.hop * (W.run || 0) * W.amp : 0;
  return hop - drop;
}
/** Rigid transform (local units, model height H) that keeps an attachment at normalised height y on the deformed upper body:
 *  lean pitch/roll around the hip, head lag, walk lift. lean = [pitch, roll, lagF, lagS] (same as the aLean attribute). */
export function attachMatrix(m4, W, lean, y, H) {
  const R = RIG, sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wUp = sm(R.upY[0], R.upY[1], y); let wTop = sm(R.swayY, 1, y); wTop *= wTop;
  const hy = R.hipY * H, cx = Math.cos(lean[0] * wUp), sx = Math.sin(lean[0] * wUp), cz = Math.cos(lean[1] * wUp), sz = Math.sin(lean[1] * wUp);
  // M = T(lift + lag) * T(hip) * Rz * Rx' * T(-hip); Rx' is the shader's gRotX (y' = y c + z s, z' = z c - y s)
  const ty = walkLiftY(W) * H, tz = -wTop * lean[2] * 0.09 * H, tx = wTop * lean[3] * 0.07 * H;
  m4.set(cz, -sz * cx, -sz * sx, 0,
         sz, cz * cx, cz * sx, 0,
         0, -sx, cx, 0,
         0, 0, 0, 1);
  const e = m4.elements; // translation so the hip point maps onto itself, then the offsets
  e[12] = -(e[4] * hy) + tx; e[13] = hy - e[5] * hy + ty; e[14] = -(e[6] * hy) + tz;
  return m4;
}
