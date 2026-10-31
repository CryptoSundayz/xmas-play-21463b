// Natural snow terrain: displaced grid with undulation, wind ripples and dunes, a noisy soft falloff into the
// cobbles, drifts piled against walls/porches/fences/trees/lamps (longer on the lee side), plus sled tracks
// and footprint trails pressed into it. Exposes heightAt(x, z) so Santa, footprints and props sit on it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { cloneTex } from './materials.js';
import { fbm, vnoise, hash2, sstep, snowSparkle } from './xmasdeco.js';

const W = CONFIG.world;
const WIND = new THREE.Vector2(0.8, 0.6).normalize();

export function buildTerrain(world) {
  const t0 = performance.now();
  const q = world.q.name, step = q === 'high' ? 1.2 : q === 'medium' ? 1.6 : 2.4;
  const R0 = W.radius + 30, rw = W.roadWidth;
  // ---- road distance field (1 m grid, stamped from the sampled centrelines)
  const RC = 1, RN = Math.ceil(R0 * 2 / RC) + 1, rd = new Float32Array(RN * RN).fill(30);
  for (const r of world.roads) for (const p of r.pts) {
    const ci = Math.round((p.x + R0) / RC), cj = Math.round((p.z + R0) / RC), K = 14;
    for (let i = Math.max(0, ci - K); i <= Math.min(RN - 1, ci + K); i++) for (let j = Math.max(0, cj - K); j <= Math.min(RN - 1, cj + K); j++) {
      const d = Math.hypot(i * RC - R0 - p.x, j * RC - R0 - p.z); const k = j * RN + i; if (d < rd[k]) rd[k] = d;
    }
  }
  // door paths: stamped as narrow "streets" (distance biased so roadD - rw/2 = distance to the path edge)
  for (const q of world.paths || []) {
    const len = Math.hypot(q.x1 - q.x0, q.z1 - q.z0), n = Math.ceil(len / 0.5), bias = (rw - q.w) / 2 + 0.35, K = 6;
    for (let t = 0; t <= n; t++) {
      const px = q.x0 + (q.x1 - q.x0) * t / n, pz = q.z0 + (q.z1 - q.z0) * t / n;
      const ci = Math.round((px + R0) / RC), cj = Math.round((pz + R0) / RC);
      for (let i = Math.max(0, ci - K); i <= Math.min(RN - 1, ci + K); i++) for (let j = Math.max(0, cj - K); j <= Math.min(RN - 1, cj + K); j++) {
        const d = Math.hypot(i * RC - R0 - px, j * RC - R0 - pz) + bias; const k = j * RN + i; if (d < rd[k]) rd[k] = d;
      }
    }
  }
  const roadD = (x, z) => {
    const fx = (x + R0) / RC, fz = (z + R0) / RC; const i = Math.max(0, Math.min(RN - 2, Math.floor(fx))), j = Math.max(0, Math.min(RN - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    return (rd[j * RN + i] * (1 - u) + rd[j * RN + i + 1] * u) * (1 - v) + (rd[(j + 1) * RN + i] * (1 - u) + rd[(j + 1) * RN + i + 1] * u) * v;
  };
  world.roadD = roadD;
  // ---- obstacle index for drifts
  const CELL = 6, idx = new Map(), key = (i, j) => i * 10007 + j;
  for (const c of world.colliders) {
    const ext = (c.kind === 'c' ? c.r : Math.hypot(c.hw, c.hd)) + 4;
    for (let i = Math.floor((c.x - ext) / CELL); i <= Math.floor((c.x + ext) / CELL); i++)
      for (let j = Math.floor((c.z - ext) / CELL); j <= Math.floor((c.z + ext) / CELL); j++) { const k = key(i, j); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(c); }
  }
  const L = world.lake;
  function height(x, z) {
    const dRoad = roadD(x, z) - rw / 2, dSq = Math.hypot(x, z) - W.squareRadius;
    const wob = (fbm(x * 0.13, z * 0.13, 3) - 0.5) * 1.8 + (vnoise(x * 0.9, z * 0.9) - 0.5) * 0.5;
    const dEdge = Math.min(dRoad, dSq);
    const ramp = sstep(-0.1, 3.4, dEdge + wob);
    // undulation + elongated wind dunes + fine wind ripples
    const along = x * WIND.x + z * WIND.y, across = -x * WIND.y + z * WIND.x;
    let h = 0.08 + 0.26 * fbm(x * 0.045, z * 0.045, 4);
    h += 0.3 * Math.pow(fbm(along * 0.018, across * 0.07, 3), 2.2);
    h += 0.03 * Math.sin(across * 2.1 + 6 * fbm(x * 0.08, z * 0.08, 2)) * sstep(0.35, 0.65, fbm(x * 0.03 + 5, z * 0.03, 2));
    h = h * ramp - (1 - ramp) * 0.07;
    // drifts against obstacles (windward pile + longer lee tail)
    let drift = 0;
    const list = idx.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) for (const c of list) {
      let d, A, fall;
      const dx = x - c.x, dz = z - c.z, dl = Math.hypot(dx, dz) || 1;
      const lee = (dx * WIND.x + dz * WIND.y) / dl;
      if (c.kind === 'c') {
        d = dl - c.r; A = Math.min(0.36, 0.16 + c.r * 0.3); fall = 0.4 + c.r * 0.5;
      } else {
        const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        d = Math.hypot(Math.max(0, Math.abs(lx) - c.hw), Math.max(0, Math.abs(lz) - c.hd));
        if (c.building) { A = 0.58; fall = 1.15; const b = c.building; const dd = Math.hypot(x - b.door.x, z - b.door.z); A *= sstep(0.9, 2.6, dd); }
        else { A = c.h > 1.5 ? 0.45 : 0.32; fall = 0.65; }
      }
      fall *= 1 + 0.9 * Math.max(0, lee); A *= 0.85 + 0.3 * Math.max(0, -lee) + 0.25 * (fbm(x * 0.6 + c.x, z * 0.6, 2) - 0.5) * 2;
      const v = A * Math.exp(-Math.max(0, d) / fall);
      if (v > drift) drift = v;
    }
    h += drift * sstep(-0.1, 0.9, dRoad) * sstep(-0.2, 0.8, dSq);
    // lake: dip under the ice with a soft shore lip
    const e = Math.sqrt(((x - L.cx) / L.rx) ** 2 + ((z - L.cz) / L.rz) ** 2);
    if (e < 1.35) { const k = sstep(0.98, 1.12, e); h = h * k - 0.25 * (1 - k) + 0.16 * Math.exp(-((e - 1.06) ** 2) * 600); }
    // fade at the outer edge into the flat far plane
    const r = Math.hypot(x, z); h *= sstep(R0, R0 - 12, r);
    return Math.min(0.95, h);
  }
  // ---- grid mesh
  const N = Math.ceil(R0 * 2 / step) + 1, H = new Float32Array(N * N);
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R0 + i * step, z = -R0 + j * step, k = j * N + i;
    const h = height(x, z); H[k] = h;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; uv[k * 2] = x / 9; uv[k * 2 + 1] = -z / 9;
  }
  const index = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    const cx = -R0 + (i + 0.5) * step, cz = -R0 + (j + 0.5) * step;
    if (Math.hypot(cx, cz) > R0 + step) continue;
    // skip cells fully under the road/square (always below the cobbles)
    if (H[a] < -0.05 && H[b] < -0.05 && H[c] < -0.05 && H[d] < -0.05 && !(Math.abs(cx - L.cx) < L.rx + 3 && Math.abs(cz - L.cz) < L.rz + 3)) continue;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  const m = world.M.snowGround.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap']) { m[k] = cloneTex(m[k]); m[k].repeat.set(1, 1); }
  m.color.multiplyScalar(1.04);
  snowSparkle(m, { glint: 1, lift: 1 });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'snowTerrain';
  world.root.add(mesh);
  const heightAt = (x, z) => {
    const fx = (x + R0) / step, fz = (z + R0) / step; const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return 0;
    const u = fx - i, v = fz - j, k = j * N + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + N] * (1 - u) + H[k + N + 1] * u) * v;
  };
  console.info(`[world] snow terrain: ${N}x${N} @ ${step} m, ${index.length / 3} tris, ${(performance.now() - t0).toFixed(0)} ms`);
  return { mesh, heightAt, height };
}

/** Re-bake flat instanced ground decals (glow pools) as terrain-conforming merged meshes. */
export function conformDecals(world, inst, seg = 6) {
  if (!inst || !inst.count) return null;
  const base = inst.geometry, m4 = new THREE.Matrix4(), out = [];
  const bb = new THREE.Box3().setFromBufferAttribute(base.attributes.position), sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
  const plane = new THREE.PlaneGeometry(sx, sz, seg, seg).rotateX(-Math.PI / 2);
  const off = inst.material.userData.lift ?? 0.06;
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, m4); const g = plane.clone().applyMatrix4(m4); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, Math.max(0.035, world.heightAt(p.getX(k), p.getZ(k))) + off);
    out.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(out), inst.material);
  mesh.renderOrder = inst.renderOrder; mesh.userData.noAO = true;
  inst.parent.add(mesh); inst.removeFromParent(); inst.geometry.dispose();
  return mesh;
}

/** Sled tracks and footprint trails pressed into the yards. Returns a merged mesh. */
export function makeTracks(world, R) {
  const rw = W.roadWidth, pos = [], idx = [];
  const quad = (ax, az, bx, bz, w) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w, b = pos.length / 3;
    for (const [x, z] of [[ax + nx, az + nz], [ax - nx, az - nz], [bx + nx, bz + nz], [bx - nx, bz - nz]]) pos.push(x, world.heightAt(x, z) + 0.022, z);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  const oval = (x, z, a, sx, sz) => {
    const b = pos.length / 3; const ca = Math.cos(a), sa = Math.sin(a);
    pos.push(x, world.heightAt(x, z) + 0.02, z);
    for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI * 2, lx = Math.cos(t) * sx, lz = Math.sin(t) * sz; const px = x + lx * ca + lz * sa, pz = z - lx * sa + lz * ca; pos.push(px, world.heightAt(px, pz) + 0.02, pz); }
    for (let k = 0; k < 8; k++) idx.push(b, b + 1 + ((k + 1) % 8), b + 1 + k);
  };
  const ok = (x, z) => { const d = world.roadD(x, z) - rw / 2; return d > 1.2 && Math.hypot(x, z) > W.squareRadius + 1 && !world.buildingAt(x, z, 0.8) && !world.inLake(x, z, 0.5); };
  let sleds = 0, trails = 0;
  for (let t = 0; t < 900 && (sleds < 40 || trails < 60); t++) {
    const a = R() * Math.PI * 2, r = R.range(W.squareRadius + 4, W.radius - 25);
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = world.roadD(x, z) - rw / 2; if (d < 1.4 || d > 18 || !ok(x, z)) continue;
    const isSled = sleds < 40 && R() < 0.45; let hd = R() * Math.PI * 2, curv = R.range(-0.08, 0.08);
    const len = R.range(9, 26), stepL = isSled ? 0.5 : 0.36; let side = 1, prev = [x, z];
    for (let s = 0; s < len; s += stepL) {
      curv += R.range(-0.03, 0.03); curv = Math.max(-0.12, Math.min(0.12, curv)); hd += curv * stepL * 2;
      const nx = x + Math.sin(hd) * stepL, nz = z + Math.cos(hd) * stepL;
      if (!ok(nx, nz)) break;
      if (isSled) {
        const ox = Math.cos(hd) * 0.27, oz = -Math.sin(hd) * 0.27;
        quad(x + ox, z + oz, nx + ox, nz + oz, 0.035); quad(x - ox, z - oz, nx - ox, nz - oz, 0.035);
        if (Math.floor(s / 0.7) !== Math.floor((s + stepL) / 0.7)) { const fo = 0.62; oval(nx + Math.sin(hd) * fo + Math.cos(hd) * 0.12 * side, nz + Math.cos(hd) * fo - Math.sin(hd) * 0.12 * side, hd, 0.07, 0.13); side = -side; }
      } else {
        oval(nx + Math.cos(hd) * 0.13 * side, nz - Math.sin(hd) * 0.13 * side, hd + side * 0.1, 0.075, 0.14); side = -side;
      }
      x = nx; z = nz;
    }
    if (isSled) sleds++; else trails++;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0x8796bd, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.userData.noAO = true; world.root.add(mesh);
  console.info(`[world] tracks: ${sleds} sled tracks, ${trails} footprint trails`);
  return mesh;
}
