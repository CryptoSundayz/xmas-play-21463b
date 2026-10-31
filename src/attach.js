// Surface attachment for wall / roof decor. Each building type's real model is merged once into a single
// holder-space triangle soup with a BVH (three-mesh-bvh, MIT), so every decor point can be snapped with an exact
// raycast against the actual facade/roof triangles (not a bounding box) at ~microseconds per ray.
// SurfaceField gives a depth-field style API on top: front view at(x, y) -> frontmost z, top view at(x, z) -> top y.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export class SurfaceBVH {
  constructor(obj, holder) {
    holder.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    const parts = []; let total = 0;
    obj.traverse(o => {
      if (!o.isMesh || o.userData.noSnap) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry, pa = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : pa.count, P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, idx ? idx.getX(i) : i).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
      parts.push(P); total += P.length;
    });
    const all = new Float32Array(total); let o = 0; for (const P of parts) { all.set(P, o); o += P.length; }
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
    this.bvh = new MeshBVH(this.geo, { maxLeafTris: 8 });
    this.geo.computeBoundingBox(); this.box = this.geo.boundingBox;
    this.ray = new THREE.Ray();
  }
  /** first hit from origin (holder space) along dir within far: {distance, point, normal} or null */
  cast(ox, oy, oz, dx, dy, dz, far = 100) {
    this.ray.origin.set(ox, oy, oz); this.ray.direction.set(dx, dy, dz).normalize();
    const h = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far);
    if (!h) return null;
    if (h.face && h.face.normal.dot(this.ray.direction) > 0) h.face.normal.negate();
    return { distance: h.distance, point: h.point, normal: h.face ? h.face.normal : null };
  }
}

/** view 'front' => at(x, y) = frontmost z (ray along -z); 'top' => at(x, z) = topmost y (ray along -y). */
export class SurfaceField {
  constructor(S, view = 'front') { this.S = S; this.view = view; this.res = 0.025; }
  at(u, v) {
    const S = this.S, b = S.box;
    if (this.view === 'front') { const h = S.cast(u, v, b.max.z + 1, 0, 0, -1); return h ? h.point.z : null; }
    const h = S.cast(u, b.max.y + 1, v, 0, -1, 0); return h ? h.point.y : null;
  }
  hit(u, v) { const S = this.S, b = S.box; return this.view === 'front' ? S.cast(u, v, b.max.z + 1, 0, 0, -1) : S.cast(u, b.max.y + 1, v, 0, -1, 0); }
  maxAround(u, v, r) { let best = null; for (let dv = -r; dv <= r + 1e-6; dv += this.res) for (let du = -r; du <= r + 1e-6; du += this.res) { const d = this.at(u + du, v + dv); if (d != null && (best == null || d > best)) best = d; } return best; }
}

/** Exact gap from point p (holder space) back along -dir to the surface; Infinity on a miss within far.
 *  The ray starts 0.25 m out along dir so a point slightly embedded still reads a (negative) gap. */
export function rayGap(S, p, dir, far = 0.6) {
  const d = dir.clone().normalize(), h = S.cast(p.x + d.x * 0.25, p.y + d.y * 0.25, p.z + d.z * 0.25, -d.x, -d.y, -d.z, far + 0.25);
  return h ? h.distance - 0.25 : Infinity;
}
