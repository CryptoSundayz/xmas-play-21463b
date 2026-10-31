// Distance / view culling for whole-map InstancedMeshes (fences, lamps, gifts, wreaths...). Their bounds span the
// whole village, so frustum culling never drops them (and the moon shadow pass draws all of them too). Here the
// instances that can matter are compacted to the front of the buffer and `count` is cut:
//  - LOW: everything within `radius` of the camera (short fogged draw distance).
//  - MEDIUM / HIGH (`view: true`): everything within `radius` (covers the moon shadow frustum around Santa), plus
//    everything inside a widened horizontal view cone out to `far` - so nothing visible on screen is ever dropped,
//    only what sits behind / beside the camera. Re-run on camera move or turn, cheap (typed-array copies).
// Meshes that someone else updates later (version bump we did not cause) are restored and left alone, so dynamic
// instancing is never broken. Meshes with frustumCulled = false or userData.noCull are never touched.
import * as THREE from 'three';

const _fwd = new THREE.Vector3();
export class InstanceCuller {
  constructor(scene, { radius = 55, minCount = 1, skip = ['pinesNear', 'pinesFar', 'windowInteriors'], props = [], propRadius = 45,
    view = false, far = 1e9, margin = 0.45 } = {}) {
    this.radius = radius; this.list = []; this.propR2 = propRadius * propRadius;
    this.view = view; this.far = far; this.margin = margin; this.yaw = 1e9;
    // standalone static props (GLB reindeer, gift piles, big tree props...): hidden beyond propRadius, restored on dispose
    this.props = props.map(o => { o.updateMatrixWorld(true); const p = new THREE.Vector3(); o.getWorldPosition(p); return { o, p, vis: o.visible }; }); this.t = 1e9; this.last = new THREE.Vector3(1e9, 0, 0);
    scene.updateMatrixWorld(true);
    scene.traverse(m => {
      if (!m.isInstancedMesh || m.count < minCount || skip.includes(m.name) || m.userData.noCull || m.frustumCulled === false) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      // world-space instance origins (+ a size pad) so the test is right even under a moved parent
      const n = m.count, src = m.instanceMatrix.array.slice(), wp = new Float32Array(n * 3), pad = new Float32Array(n), mi = new THREE.Matrix4(), v = new THREE.Vector3();
      const gr = m.geometry.boundingSphere.radius, gc = m.geometry.boundingSphere.center;
      for (let i = 0; i < n; i++) {
        mi.fromArray(src, i * 16).premultiply(m.matrixWorld); v.copy(gc).applyMatrix4(mi);
        wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z; pad[i] = gr * mi.getMaxScaleOnAxis();
      }
      this.list.push({ m, n, src, wp, pad, col: m.instanceColor ? m.instanceColor.array.slice() : null, ver: -1, last: -1, slot: null });
    });
  }
  update(dt, cam) {
    this.t += dt;
    let yaw = 0;
    if (this.view) { cam.getWorldDirection(_fwd); yaw = Math.atan2(_fwd.x, _fwd.z); }
    const turned = this.view && Math.abs(Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))) > 0.1;
    if (turned && this.t < 0.06) return;
    if (!turned && this.t < 0.25 && cam.position.distanceToSquared(this.last) < (this.view ? 4 : 9)) return;
    this.t = 0; this.last.copy(cam.position); this.yaw = yaw;
    const cx = cam.position.x, cz = cam.position.z, far2 = this.far * this.far;
    // horizontal half-angle of the view + margin (camera turn between updates, pitch looking down)
    let fx = 0, fz = 0, cosA = -1;
    if (this.view) {
      const l = Math.hypot(_fwd.x, _fwd.z) || 1; fx = _fwd.x / l; fz = _fwd.z / l;
      const hh = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect) + this.margin;
      cosA = hh >= Math.PI ? -1 : Math.cos(Math.min(Math.PI, hh));
    }
    for (const e of this.props) { const dx = e.p.x - cx, dz = e.p.z - cz; e.o.visible = e.vis && dx * dx + dz * dz < this.propR2; }
    for (let k = this.list.length - 1; k >= 0; k--) {
      const e = this.list[k], m = e.m, A = m.instanceMatrix.array, wp = e.wp, pad = e.pad;
      if (e.ver >= 0 && m.instanceMatrix.version !== e.ver) { this.release(k); continue; }
      let j = 0, changed = false; const slot = e.slot || (e.slot = new Int32Array(e.n).fill(-1));
      for (let i = 0; i < e.n; i++) {
        const dx = wp[i * 3] - cx, dz = wp[i * 3 + 2] - cz, d2 = dx * dx + dz * dz, p = pad[i];
        if (d2 > (this.radius + p) ** 2) {
          if (!this.view || d2 > far2) continue;
          // in the view cone? (sphere vs cone, conservative: the pad widens the cone)
          const d = Math.sqrt(d2), along = (dx * fx + dz * fz + p) / d;
          if (along < cosA) continue;
        }
        if (slot[j] !== i) { // slot j holds another instance (or nothing yet): copy this one in
          const o = i * 16; for (let q = 0; q < 16; q++) A[j * 16 + q] = e.src[o + q];
          if (e.col) for (let q = 0; q < 3; q++) m.instanceColor.array[j * 3 + q] = e.col[i * 3 + q];
          slot[j] = i; changed = true;
        }
        j++;
      }
      if (changed || j !== e.last) {
        m.count = j; if (changed) { m.instanceMatrix.needsUpdate = true; if (e.col) m.instanceColor.needsUpdate = true; }
        m.boundingSphere = null; if (j) m.computeBoundingSphere(); m.visible = j > 0;
      }
      e.last = j; e.ver = m.instanceMatrix.version;
    }
  }
  release(k) {
    const e = this.list[k]; e.m.instanceMatrix.array.set(e.src); e.m.count = e.n; e.m.instanceMatrix.needsUpdate = true;
    if (e.col) { e.m.instanceColor.array.set(e.col); e.m.instanceColor.needsUpdate = true; }
    e.m.boundingSphere = null; e.m.computeBoundingSphere(); e.m.visible = true; this.list.splice(k, 1);
  }
  dispose() { for (const e of this.props) e.o.visible = e.vis; for (let k = this.list.length - 1; k >= 0; k--) this.release(k); }
}
