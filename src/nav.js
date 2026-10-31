// Navigation aids (all switchable in CONFIG.nav): a 3D ground arrow + distance to the nearest undelivered house,
// off-screen edge indicators for the remaining houses, and an "N houses left" pill. Beacons + minimap live in
// main.js / hud.js and read the same config.
import * as THREE from 'three';
import { CONFIG } from './config.js?v=4c34af6b';

const $ = id => document.getElementById(id);

export class Nav {
  constructor(scene) {
    this.C = CONFIG.nav || {};
    // 3D chevron arrow lying just above the snow, orbiting Santa toward the target
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.62); sh.lineTo(0.46, 0.02); sh.lineTo(0.2, 0.02); sh.lineTo(0.2, -0.5); sh.lineTo(-0.2, -0.5); sh.lineTo(-0.2, 0.02); sh.lineTo(-0.46, 0.02); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0.0, 0); // tip -> -z
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x3fc0ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false });
    const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, fog: false }));
    outline.scale.setScalar(1.12); outline.position.y = -0.01;
    this.arrow = new THREE.Group(); this.arrow.add(outline, new THREE.Mesh(geo, this.arrowMat));
    this.arrow.scale.setScalar(CONFIG.nav?.arrowScale ?? 0.8); this.arrow.renderOrder = 5; this.arrow.visible = false; this.arrow.name = 'navArrow';
    if (this.C.arrow !== false) scene.add(this.arrow); // arrow removed from the scene entirely when disabled
    this.dist = $('navDist'); this.left = $('housesLeft'); this.edge = $('navEdge');
    this.pool = []; this._v = new THREE.Vector3(); this._c = new THREE.Vector3(); this._dir = 0;
  }
  hide() { this.arrow.visible = false; this.dist?.classList.remove('show'); this.left?.classList.remove('show'); this.pool.forEach(e => e.style.display = 'none'); }

  update(dt, t, { player, targets, camera, playing }) {
    const C = this.C;
    if (!playing) return this.hide();
    const open = targets.filter(x => !x.delivered && !x.sending);
    // houses left
    if (this.left) {
      const n = open.length; this.left.classList.toggle('show', C.housesLeft !== false && n > 0);
      const txt = (n === 1 ? (C.houseLeftOne || '1 house left') : (C.housesLeftText || '{n} houses left').replace('{n}', n));
      if (this.left.textContent !== txt) this.left.textContent = txt;
    }
    // nearest
    let best = null, bd = 1e9;
    for (const x of open) { const d = Math.hypot(x.b.trigger.x - player.x, x.b.trigger.z - player.z); if (d < bd) { bd = d; best = x; } }
    const showArrow = C.arrow !== false && best && bd > (C.arrowHideNear ?? 4.5);
    this.arrow.visible = !!showArrow;
    if (showArrow) {
      const a = Math.atan2(best.b.trigger.x - player.x, best.b.trigger.z - player.z);
      let da = a - this._dir; da = Math.atan2(Math.sin(da), Math.cos(da)); this._dir += da * Math.min(1, dt * 8);
      const R = C.arrowRadius ?? 1.9, bob = Math.sin(t * 4) * 0.05;
      this.arrow.position.set(player.x + Math.sin(this._dir) * R, (player.y ?? 0) + 0.45 + bob, player.z + Math.cos(this._dir) * R);
      this.arrow.rotation.y = this._dir + Math.PI; // geometry tip points -z
      this.arrowMat.opacity = 0.7 + 0.2 * Math.sin(t * 5);
    }
    // distance label above the arrow
    if (this.dist) {
      if (showArrow && C.distance !== false) {
        this._v.copy(this.arrow.position); this._v.y += 0.55; this._v.project(camera);
        const vis = this._v.z < 1;
        this.dist.classList.toggle('show', vis);
        if (vis) {
          this.dist.style.transform = `translate(${((this._v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - this._v.y) / 2 * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
          const txt = `${Math.round(bd)} m`; if (this.dist.textContent !== txt) this.dist.textContent = txt;
        }
      } else this.dist.classList.remove('show');
    }
    // off-screen edge indicators (nearest first)
    if (!this.edge) return;
    const list = C.edgeIndicators === false ? [] : open.map(x => ({ x, d: Math.hypot(x.b.x - player.x, x.b.z - player.z) })).sort((p, q) => p.d - q.d).slice(0, C.edgeMax ?? 6);
    const W = innerWidth, H = innerHeight, m = C.edgeMargin ?? 44, cx = W / 2, cy = H / 2;
    let used = 0; const placed = []; camera.updateMatrixWorld();
    for (const { x, d } of list) {
      this._v.set(x.b.x, x.b.height + 3.2, x.b.z);
      const c = this._c.copy(this._v).applyMatrix4(camera.matrixWorldInverse);
      if (c.z < 0) { this._v.project(camera); if (Math.abs(this._v.x) < 0.94 && Math.abs(this._v.y) < 0.9) continue; } // on screen: gem/beacon marks it
      // direction by bearing: projected direction when in front, horizontal bearing (ahead = up, behind = down,
      // left/right by side) when behind, then clamped to a box that keeps clear of the bottom touch controls
      let px, py;
      if (c.z < 0) { px = c.x / -c.z * cy; py = -c.y / -c.z * cy; }
      else { const a = Math.atan2(c.x, -c.z); px = Math.sin(a) * W; py = -Math.cos(a) * H; }
      const bottomRes = document.body.classList.contains('touch') ? Math.min(190, H * 0.36) : 96, topRes = m + 40;
      const halfW = cx - m, up = cy - topRes, down = cy - bottomRes;
      const k = Math.min(halfW / Math.max(1e-3, Math.abs(px)), (py < 0 ? up : down) / Math.max(1e-3, Math.abs(py)));
      px *= k; py *= k;
      if (placed.some(q => Math.hypot(q[0] - px, q[1] - py) < 90)) continue; // nearer one already covers that spot
      placed.push([px, py]);
      let el = this.pool[used];
      if (!el) { el = document.createElement('div'); el.className = 'navEdgeItem'; el.innerHTML = '<i></i><span></span>'; this.edge.appendChild(el); this.pool.push(el); }
      el.style.display = ''; el.classList.toggle('slow', !!x.slow); el.classList.toggle('near', used === 0);
      el.style.transform = `translate(${(cx + px).toFixed(1)}px, ${(cy + py).toFixed(1)}px) translate(-50%, -50%)`;
      el.firstChild.style.transform = `rotate(${Math.atan2(py, px).toFixed(3)}rad)`;
      const txt = `${Math.round(d)} m`; if (el.lastChild.textContent !== txt) el.lastChild.textContent = txt;
      used++;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }
}
