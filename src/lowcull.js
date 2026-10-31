// LOW preset: distance culling for whole-map InstancedMeshes (fences, lamps, gifts, wreaths...). Their bounds span
// the whole village, so frustum culling never drops them; here the instances within `radius` of the camera are
// compacted to the front of the buffer and `count` is cut. Meshes that someone else updates later (version bump we
// did not cause) are restored and left alone, so dynamic instancing is never broken.
import * as THREE from 'three';

export class InstanceCuller {
  constructor(scene, { radius = 55, minCount = 1, skip = ['pinesNear', 'pinesFar', 'windowInteriors'], props = [], propRadius = 45 } = {}) {
    this.radius = radius; this.list = []; this.propR2 = propRadius * propRadius;
    // standalone static props (GLB reindeer, gift piles, big tree props...): hidden beyond propRadius, restored on dispose
    this.props = props.map(o => { o.updateMatrixWorld(true); const p = new THREE.Vector3(); o.getWorldPosition(p); return { o, p, vis: o.visible }; }); this.t = 1e9; this.last = new THREE.Vector3(1e9, 0, 0);
    scene.traverse(m => {
      if (!m.isInstancedMesh || m.count < minCount || skip.includes(m.name) || m.userData.noCull) return;
      this.list.push({ m, n: m.count, src: m.instanceMatrix.array.slice(), col: m.instanceColor ? m.instanceColor.array.slice() : null, ver: -1 });
    });
  }
  update(dt, cam) {
    this.t += dt;
    if (this.t < 0.25 && cam.position.distanceToSquared(this.last) < 9) return;
    this.t = 0; this.last.copy(cam.position);
    const r2 = this.radius * this.radius, cx = cam.position.x, cz = cam.position.z;
    for (const e of this.props) { const dx = e.p.x - cx, dz = e.p.z - cz; e.o.visible = e.vis && dx * dx + dz * dz < this.propR2; }
    for (let k = this.list.length - 1; k >= 0; k--) {
      const e = this.list[k], m = e.m, A = m.instanceMatrix.array;
      if (e.ver >= 0 && m.instanceMatrix.version !== e.ver) { this.release(k); continue; }
      let j = 0;
      for (let i = 0; i < e.n; i++) {
        const o = i * 16, dx = e.src[o + 12] - cx, dz = e.src[o + 14] - cz;
        if (dx * dx + dz * dz > r2) continue;
        if (j !== i || e.ver < 0) { for (let q = 0; q < 16; q++) A[j * 16 + q] = e.src[o + q]; if (e.col) for (let q = 0; q < 3; q++) m.instanceColor.array[j * 3 + q] = e.col[i * 3 + q]; }
        j++;
      }
      m.count = j; m.instanceMatrix.needsUpdate = true; if (e.col) m.instanceColor.needsUpdate = true;
      m.boundingSphere = null; if (j) m.computeBoundingSphere(); m.visible = j > 0;
      e.ver = m.instanceMatrix.version;
    }
  }
  release(k) {
    const e = this.list[k]; e.m.instanceMatrix.array.set(e.src); e.m.count = e.n; e.m.instanceMatrix.needsUpdate = true;
    if (e.col) { e.m.instanceColor.array.set(e.col); e.m.instanceColor.needsUpdate = true; }
    e.m.boundingSphere = null; e.m.computeBoundingSphere(); e.m.visible = true; this.list.splice(k, 1);
  }
  dispose() { for (const e of this.props) e.o.visible = e.vis; for (let k = this.list.length - 1; k >= 0; k--) this.release(k); }
}
