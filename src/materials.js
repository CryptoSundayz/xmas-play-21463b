import * as THREE from 'three';

const tl = new THREE.TextureLoader();
function tex(name, repeat = 1, srgb = false) {
  const url = `assets/textures/${name}.jpg`;
  const t = tl.load(url); t.userData.url = url;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pbr(name, opts = {}, repeat = 1) {
  return new THREE.MeshStandardMaterial({
    map: tex(name + '_color', repeat, true),
    normalMap: tex(name + '_normal', repeat),
    roughnessMap: tex(name + '_rough', repeat),
    ...opts,
  });
}

let M = null;
export function materials() {
  if (M) return M;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M = {
    snowGround: pbr('snow', { color: 0xc4d2ec, roughness: 0.95, normalScale: new THREE.Vector2(0.8, 0.8) }),
    cobble: pbr('cobble', { color: 0xb8b0a8, roughness: 1 }),
    ice: pbr('ice', { color: 0xa9d8ff, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.92 }),
    stone: pbr('stone', { color: 0xc9c2b8 }),
    wood: pbr('wood', { color: 0x9a6a45 }),
    woodRed: pbr('wood', { color: 0xb3322a }),
    woodDark: std({ color: 0x3a2617, roughness: 0.85 }),
    plaster: std({ color: 0xefe3cc, roughness: 0.92 }),
    plasterPink: std({ color: 0xe9c1b4, roughness: 0.92 }),
    timber: std({ color: 0x3b2516, roughness: 0.8 }),
    roofRed: std({ color: 0x7a2420, roughness: 0.75 }),
    roofDark: std({ color: 0x2e2a2c, roughness: 0.7 }),
    roofSlate: std({ color: 0x3b4352, roughness: 0.6 }),
    roofGreen: std({ color: 0x24493a, roughness: 0.7 }),
    snow: std({ color: 0xd8e4f8, roughness: 0.85 }),
    trim: std({ color: 0xf2efe8, roughness: 0.6 }),
    metal: std({ color: 0x23262b, roughness: 0.45, metalness: 0.7 }),
    gold: std({ color: 0xd9a441, roughness: 0.3, metalness: 0.9, emissive: 0x3a2400, emissiveIntensity: 0.4 }),
    concrete: std({ color: 0x9aa0a8, roughness: 0.85 }),
    glassDark: std({ color: 0x0c1a2c, roughness: 0.08, metalness: 0.6 }),
    ginger: std({ color: 0x9c5a2c, roughness: 0.8 }),
    icing: std({ color: 0xffffff, roughness: 0.4, emissive: 0x222233, emissiveIntensity: 0.2 }),
    candyRed: std({ color: 0xd8232a, roughness: 0.35, emissive: 0x330000 }),
    candyGreen: std({ color: 0x1f9a4a, roughness: 0.35 }),
    pineGreen: std({ color: 0x1d3b2a, roughness: 0.9 }),
    trunk: std({ color: 0x4a3221, roughness: 0.9 }),
  };
  // which materials get baked world-space UVs when statics are merged
  for (const k of ['cobble', 'stone', 'wood', 'woodRed', 'snowGround']) M[k].userData.worldUV = 0.22;
  M.stone.userData.worldUV = 0.3;
  return M;
}

export const WINDOW_WARM = new THREE.Color(0xffa74d);
export const WINDOW_BLUE = new THREE.Color(0x3aa8ff);
export function windowMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: WINDOW_WARM.clone(), emissiveIntensity: 1.9, roughness: 0.4 });
}

/** Independent copy of a texture (own repeat) — re-requests the cached image, no early-upload warnings. */
export function cloneTex(t) {
  const c = tl.load(t.userData.url);
  c.wrapS = t.wrapS; c.wrapT = t.wrapT; c.repeat.copy(t.repeat); c.anisotropy = t.anisotropy; c.colorSpace = t.colorSpace;
  return c;
}
