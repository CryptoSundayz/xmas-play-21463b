// GLB-or-procedural loader. See assets/manifest.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MANIFEST } from '../assets/manifest.js?v=9e6ba718';
import { CONFIG } from './config.js?v=9e6ba718';

// Tripo GLBs are meshopt-compressed with KTX2 (UASTC/ETC1S) textures.
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let ktx2 = null;
export let LOD_DISTANCE = 75; // metres at which buildings switch to their LOD1 mesh
let available = new Set();
const cache = new Map();

export async function initAssets(renderer, onProgress) {
  if (renderer && !ktx2) {
    ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
  try {
    const r = await fetch('assets/models/models.json', { cache: 'no-cache' });
    if (r.ok) available = new Set((await r.json()).files || []);
  } catch (e) { /* offline / file:// — fall back to procedural */ }
  // preload everything that exists so later lookups are sync
  // only the chosen player character is downloaded (mascot falls back to santa if its GLB fails)
  const player = CONFIG.character.type === 'santa' ? 'santa' : 'mascot';
  const entries = [
    ...Object.entries(MANIFEST.characters).filter(([k]) => !['santa', 'mascot'].includes(k) || k === player).map(([, e]) => e),
    ...Object.values(MANIFEST.buildings),
    ...Object.values(MANIFEST.props),
  ];
  const todo = entries.filter(e => e.glb && available.has(e.glb));
  let done = 0;
  await Promise.all(todo.map(e => loadGLB(e.glb).then(() => onProgress?.(++done, todo.length))));
  if (player === 'mascot' && !cache.get(MANIFEST.characters.mascot.glb) && available.has(MANIFEST.characters.santa.glb)) {
    console.warn('[assets] mascot GLB missing - falling back to santa'); CONFIG.character.type = 'santa'; await loadGLB(MANIFEST.characters.santa.glb);
  }
  return { glbCount: cache.size };
}

function loadGLB(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  return new Promise(res => {
    loader.load(path, g => { cache.set(path, g); res(g); }, undefined, err => {
      console.warn('[assets] GLB failed, using procedural fallback:', path, err?.message || err);
      res(null);
    });
  });
}

export function hasGLB(entry) { return !!(entry && entry.glb && cache.get(entry.glb)); }

/** Returns {object, animations} — a fresh clone, grounded, scaled, rotated — or null. */
export function instantiate(entry) {
  if (!hasGLB(entry)) return null;
  const gltf = cache.get(entry.glb);
  const root = SkeletonUtils.clone(gltf.scene);
  // LOD0 / LOD1 nodes (written by tools/optimize-models.mjs) -> THREE.LOD
  const l0 = root.getObjectByName('LOD0'), l1 = root.getObjectByName('LOD1');
  if (l0 && l1 && l0.parent === l1.parent) {
    const lod = new THREE.LOD(); lod.name = 'LOD';
    const par = l0.parent; par.add(lod);
    lod.addLevel(l0, 0, 4); lod.addLevel(l1, entry.lodDistance || LOD_DISTANCE, 4);
  }
  const wrap = new THREE.Group();
  root.rotation.y = entry.rotationY || 0;
  wrap.add(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let s = entry.scale || 1;
  if (entry.fit) {
    if (entry.footprint || entry.fit.footprint) {
      const fp = entry.fit.footprint || entry.footprint;
      s = Math.min(fp[0] / size.x, fp[1] / size.z);
    } else if (entry.fit.height) s = entry.fit.height / size.y;
  } else if (entry.footprint && !entry.scale) {
    s = Math.min(entry.footprint[0] / size.x, entry.footprint[1] / size.z);
  }
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  root.position.y += -b2.min.y + (entry.yOffset || 0);
  root.position.x -= (b2.min.x + b2.max.x) / 2;
  root.position.z -= (b2.min.z + b2.max.z) / 2;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { object: wrap, animations: gltf.animations || [] };
}

/** Find clip by logical name using manifest clip map (case-insensitive contains). */
export function findClip(animations, wanted) {
  if (!wanted) return null;
  const w = wanted.toLowerCase();
  return animations.find(a => a.name.toLowerCase() === w) || animations.find(a => a.name.toLowerCase().includes(w)) || null;
}

export { MANIFEST };

/** Instantiate an entry and return its meshes with transforms baked (LOD1 skipped) — for InstancedMesh use. */
export function bakedMeshes(entry) {
  const inst = instantiate(entry);
  if (!inst) return null;
  inst.object.updateMatrixWorld(true);
  const out = [];
  inst.object.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.name === 'LOD1') return;
    const g = dequantize(o.geometry.clone()); g.applyMatrix4(o.matrixWorld);
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

// meshopt/KHR_mesh_quantization stores positions/normals as normalized int16/int8; baking a transform into
// those would clamp to [-1,1] (trees turn into boxes), so expand to Float32 first.
function dequantize(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) {
      const n = a.count, k = a.itemSize, arr = new Float32Array(n * k);
      for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) arr[i * k + j] = a.getComponent ? a.getComponent(i, j) : [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)][j];
      g.setAttribute(name, new THREE.BufferAttribute(arr, k, false));
    }
  }
  return g;
}

/**
 * Make bright warm texels of a GLB texture (lit windows, lanterns) emissive and recolourable.
 * colorRef: THREE.Color (live reference), intensity: object with a `value` getter.
 */
export function addTextureGlow(mat, colorRef, intensity, key = 'texglow') {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowC = { value: colorRef };
    sh.uniforms.uGlowI = intensity;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlowC; uniform float uGlowI;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 dc = diffuseColor.rgb;
        float wm = smoothstep(0.52, 0.85, dc.r) * smoothstep(0.28, 0.55, dc.g) * smoothstep(0.25, 0.5, dc.r - dc.b);
        totalEmissiveRadiance += wm * uGlowC * uGlowI * (0.55 + 0.6 * dc.g);
        diffuseColor.rgb *= 1.0 - wm * 0.75;
      }`);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
