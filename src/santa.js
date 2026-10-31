// Santa: GLB (rigged, AnimationMixer idle/walk/run blend) if present, else procedural.
// Santa always HOLDS the glowing blue gift (the block) in front of the chest.
import * as THREE from 'three';
import { MANIFEST, instantiate, findClip } from './assets.js';
import { glowGift } from './props.js';
import { materials } from './materials.js';
import { CONFIG } from './config.js';
import { glbMascot } from './mascot.js';

export function createSanta(quality = 'high') {
  const useMascot = CONFIG.character.type === 'mascot';
  const entry = useMascot ? MANIFEST.characters.mascot : MANIFEST.characters.santa;
  const root = new THREE.Group();
  const gift = glowGift(0.38);
  const giftLight = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), new THREE.MeshBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending }));
  gift.add(giftLight);
  const glb = instantiate(entry);
  let api;
  if (glb && useMascot) { api = glbMascot(root, glb, entry, gift, makeCarryIK, quality); api.isMascot = true; }
  else if (glb) api = glbSanta(root, glb, entry, gift);
  else api = proceduralSanta(root, gift);
  api.root = root; api.gift = gift; api.isGLB = !!glb; api.giftBase = gift.scale.x;
  const tmp = new THREE.Vector3();
  api.giftWorldPos = (out = new THREE.Vector3()) => gift.getWorldPosition(out);
  api.pulseGift = (t) => { const s = 1 + Math.sin(t * 6) * 0.04; gift.scale.setScalar(api.giftScale * s * (api.giftBase || 1)); };
  api.giftScale = 1;
  return api;
}

function proceduralSanta(root, gift) {
  const M = materials();
  const red = new THREE.MeshStandardMaterial({ color: 0xb3121d, roughness: 0.75 });
  const fur = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c3a0, roughness: 0.8 });
  const body = new THREE.Group(); root.add(body);
  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  // legs (pivot at hips)
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * 0.19, 0.82, 0); body.add(p);
    add(new THREE.CylinderGeometry(0.13, 0.12, 0.55, 10), red, 0, -0.3, 0, p);
    add(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10), fur, 0, -0.58, 0, p);
    const boot = add(new THREE.BoxGeometry(0.24, 0.24, 0.38), black, 0, -0.72, 0.06, p);
    legs.push(p);
  }
  // torso
  const torso = new THREE.Group(); torso.position.y = 0.82; body.add(torso);
  const belly = add(new THREE.SphereGeometry(0.46, 18, 14), red, 0, 0.45, 0.02, torso); belly.scale.set(1, 1.15, 0.92);
  add(new THREE.TorusGeometry(0.42, 0.07, 8, 24), fur, 0, 0.05, 0, torso).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.14, 0.85, 0.06), fur, 0, 0.42, 0.42, torso);
  const belt = add(new THREE.TorusGeometry(0.455, 0.06, 6, 24), black, 0, 0.3, 0, torso); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.92, 1);
  add(new THREE.BoxGeometry(0.2, 0.16, 0.06), M.gold, 0, 0.3, 0.44, torso);
  // head
  const head = new THREE.Group(); head.position.set(0, 1.02, 0.02); torso.add(head);
  add(new THREE.SphereGeometry(0.21, 16, 12), skin, 0, 0.08, 0, head);
  const beard = add(new THREE.SphereGeometry(0.22, 14, 10), fur, 0, -0.07, 0.08, head); beard.scale.set(1.05, 1.15, 0.8);
  const mus = add(new THREE.SphereGeometry(0.09, 10, 8), fur, 0, 0.02, 0.2, head); mus.scale.set(1.8, 0.6, 0.6);
  add(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe48a7a }), 0, 0.07, 0.22, head);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.025, 6, 4), black, s * 0.075, 0.14, 0.19, head);
  add(new THREE.TorusGeometry(0.2, 0.06, 8, 20), fur, 0, 0.22, 0, head).rotation.x = Math.PI / 2;
  const hat = add(new THREE.ConeGeometry(0.2, 0.5, 14), red, 0, 0.45, -0.06, head); hat.rotation.x = -0.45;
  add(new THREE.SphereGeometry(0.08, 10, 8), fur, 0, 0.62, -0.3, head);
  // arms reaching forward, holding the gift in front of the chest
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.43, 0.72, 0); torso.add(sh);
    const upper = add(new THREE.CylinderGeometry(0.1, 0.09, 0.5, 8), red, 0, -0.22, 0, sh);
    const fore = new THREE.Group(); fore.position.set(0, -0.45, 0); sh.add(fore);
    add(new THREE.CylinderGeometry(0.09, 0.08, 0.42, 8), red, 0, -0.18, 0, fore);
    add(new THREE.TorusGeometry(0.085, 0.035, 6, 12), fur, 0, -0.38, 0, fore).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.09, 8, 6), black, 0, -0.45, 0, fore);
    sh.rotation.x = -1.05; sh.rotation.z = s * 0.12; fore.rotation.x = -0.5; fore.rotation.z = -s * 0.45;
    arms.push(sh);
  }
  // gift sits between the gloves, in front of the chest
  gift.position.set(0, 1.42, 0.74);
  body.add(gift);
  let ph = 0;
  return {
    update(dt, speed, sprint) {
      const k = Math.min(1, speed / 6);
      ph += dt * (3 + speed * 1.25);
      const amp = 0.15 + k * (sprint ? 0.75 : 0.55);
      legs[0].rotation.x = Math.sin(ph) * amp * (speed > 0.2 ? 1 : 0);
      legs[1].rotation.x = -Math.sin(ph) * amp * (speed > 0.2 ? 1 : 0);
      const bob = speed > 0.2 ? Math.abs(Math.sin(ph)) * 0.07 * (0.5 + k) : Math.sin(ph * 0.4) * 0.012;
      body.position.y = bob;
      torso.rotation.x = k * (sprint ? 0.2 : 0.1);
      torso.rotation.z = Math.sin(ph) * 0.04 * k;
      head.rotation.y = Math.sin(ph * 0.5) * 0.05;
      for (let i = 0; i < 2; i++) arms[i].rotation.x = -1.05 + Math.sin(ph * 2) * 0.03 * k;
      gift.position.y = 1.42 + Math.sin(ph * 2) * 0.015 * k;
    },
  };
}

function glbSanta(root, glb, entry, gift) {
  root.add(glb.object);
  // velvet suit + soft fur: physical material with a sheen lobe, rougher base, lower env reflections
  const conv = new Map();
  glb.object.traverse(o => {
    if (!o.isMesh || !o.material || o.material === gift.material) return;
    if (!conv.has(o.material)) {
      const src = o.material, pm = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(pm, src);
      pm.roughness = Math.max(0.78, src.roughness); pm.metalness = 0; pm.envMapIntensity = 0.55;
      pm.sheen = 0.35; pm.sheenRoughness = 0.5; pm.sheenColor = (src.color ? src.color.clone() : new THREE.Color(1, 1, 1)).lerp(new THREE.Color(1, 0.9, 0.86), 0.35);
      conv.set(src, pm);
    }
    o.material = conv.get(o.material);
  });
  const mixer = new THREE.AnimationMixer(glb.object);
  const act = {};
  for (const [k, name] of Object.entries(entry.clips)) {
    const clip = findClip(glb.animations, name);
    if (clip) { act[k] = mixer.clipAction(clip); act[k].play(); act[k].setEffectiveWeight(0); }
  }
  // prefer carry variants when available
  const pick = (a, b) => act[a] || act[b];
  const idle = pick('carryIdle', 'idle'), walk = pick('carryWalk', 'walk'), run = pick('carryRun', 'run');
  // gift on chest bone (in front of chest), else fixed offset in front of chest
  let bone = null;
  glb.object.traverse(o => { if (!bone && o.isBone && o.name.toLowerCase().includes((entry.holdBone || '').toLowerCase())) bone = o; });
  if (bone) {
    glb.object.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); bone.getWorldScale(ws);
    bone.add(gift);
    gift.scale.setScalar(1 / ws.x);
    // place 0.42 m in front of the chest in root space
    const want = new THREE.Vector3(...entry.holdOffset);
    root.updateMatrixWorld(true);
    const local = bone.worldToLocal(root.localToWorld(want.clone()));
    gift.position.copy(local);
  } else {
    gift.position.set(...entry.holdOffset); root.add(gift);
  }
  const ik = entry.carryIK ? makeCarryIK(glb.object, root, gift, 0.19) : null;
  return {
    mixer,
    update(dt, speed, sprint) {
      const w = THREE.MathUtils.clamp(speed / entry.walkSpeedRef / 2.5, 0, 1);
      const r = THREE.MathUtils.clamp((speed - 6) / 4, 0, 1);
      if (idle) idle.setEffectiveWeight(1 - w);
      if (walk) { walk.setEffectiveWeight(w * (1 - r)); walk.timeScale = Math.max(0.6, speed / 6); }
      if (run) { run.setEffectiveWeight(w * r); run.timeScale = Math.max(0.7, speed / 10); }
      if (!run && walk) walk.setEffectiveWeight(w);
      mixer.update(dt);
      if (ik) ik();
    },
  };
}

// ---- carry pose: analytic 2-bone IK so both gloves grip the sides of the gift ----
const _v = Array.from({ length: 8 }, () => new THREE.Vector3());
const _q = Array.from({ length: 4 }, () => new THREE.Quaternion());
function aimBone(bone, child, target) {
  const bw = bone.getWorldPosition(_v[5]);
  const bq = bone.getWorldQuaternion(_q[0]);
  const cur = _v[6].copy(child.position).normalize().applyQuaternion(bq);
  const want = _v[7].copy(target).sub(bw).normalize();
  const delta = _q[1].setFromUnitVectors(cur, want);
  const nw = delta.multiply(bq);
  const pq = bone.parent.getWorldQuaternion(_q[2]).invert();
  bone.quaternion.copy(pq.multiply(nw));
  bone.updateMatrixWorld(true);
}
export function makeCarryIK(model, root, gift, halfW) {
  const find = (n) => { let b = null; model.traverse(o => { if (!b && o.isBone && o.name.replace(/[^a-z]/gi, '').toLowerCase().endsWith(n.toLowerCase())) b = o; }); return b; };
  const arms = [['Left', 1], ['Right', -1]].map(([side, sx]) => ({ up: find(side + 'Arm'), fore: find(side + 'ForeArm'), hand: find(side + 'Hand'), sx }))
    .filter(a => a.up && a.fore && a.hand);
  if (arms.length < 2) return null;
  return () => {
    model.updateMatrixWorld(true);
    const G = gift.getWorldPosition(_v[0]);
    const rq = root.getWorldQuaternion(_q[3]);
    const ax = _v[1].set(1, 0, 0).applyQuaternion(rq), fw = _v[2].set(0, 0, 1).applyQuaternion(rq);
    for (const a of arms) {
      const S = a.up.getWorldPosition(new THREE.Vector3());
      const E0 = a.fore.getWorldPosition(new THREE.Vector3()), H0 = a.hand.getWorldPosition(new THREE.Vector3());
      const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
      // hand target: side of the box, slightly low and back so the palm wraps it
      const T = G.clone().addScaledVector(ax, a.sx * (halfW + 0.03)).addScaledVector(fw, -0.04); T.y -= 0.05;
      const d0 = T.clone().sub(S); const dist = THREE.MathUtils.clamp(d0.length(), 0.05, (L1 + L2) * 0.999);
      const dir = d0.normalize();
      const pole = ax.clone().multiplyScalar(a.sx * 0.9).add(_v[3].set(0, -1, 0)).addScaledVector(fw, -0.35);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      const E = S.clone().addScaledVector(dir, along).addScaledVector(pole, h);
      aimBone(a.up, a.fore, E);
      aimBone(a.fore, a.hand, S.clone().addScaledVector(dir, dist));
    }
  };
}
