// Window interiors: fake-interior ("interior mapping") parallax rooms behind the lit windows of the Tripo houses.
// - window rects per building type come from assets/windows.js (detected once from the baked facade textures
//   with detectWindows() below, via the dev API __xmas.detectWindows()).
// - all windows of the village are ONE InstancedMesh with ONE ShaderMaterial and ONE canvas-painted atlas:
//   per window the shader ray-casts a virtual room box behind the glass (back wall, side walls, floor, ceiling,
//   plus a mid-depth furniture card for extra parallax), adds curtains, fireplace flicker, frost corners and a
//   fresnel glass reflection. No real interior geometry.
import * as THREE from 'three';

// ------------------------------------------------------------------ detection (dev-time)
/** Find lit window rectangles on a Tripo building: rasterise every vertical triangle in UV space over the
 *  baked base-colour texture (read back through the GPU because the textures are KTX2), keep texels that
 *  match the same warm-glow mask the facade shader uses, cluster them per facade plane and return rects in
 *  holder space: [{ c:[x,y,z], a: yaw of the outward normal, w, h }]. */
export function detectWindows(obj, holder, renderer, RES = 1024) {
  holder.updateMatrixWorld(true);
  const inv = holder.matrixWorld.clone().invert();
  const root = obj.getObjectByName('LOD0') || obj;
  const pix = new Map(); // texture -> Uint8Array RGBA (linear)
  const read = (tex) => {
    if (pix.has(tex)) return pix.get(tex);
    const rt = new THREE.WebGLRenderTarget(RES, RES);
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(sc, cam);
    const buf = new Uint8Array(RES * RES * 4); renderer.readRenderTargetPixels(rt, 0, 0, RES, RES, buf);
    renderer.setRenderTarget(prev); rt.dispose(); pix.set(tex, buf); return buf;
  };
  const mask = (r, g, b) => { // == addTextureGlow's wm
    const ss = (a, c, x) => { const t = Math.min(1, Math.max(0, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
    return ss(0.52, 0.85, r) * ss(0.28, 0.55, g) * ss(0.25, 0.5, r - b);
  };
  const CELL = 0.08, SECT = 8;
  const sectors = Array.from({ length: SECT }, () => new Map());
  const m = new THREE.Matrix4(), A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || !o.material?.map) return;
    const buf = read(o.material.map);
    m.multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry, pa = g.attributes.position, ua = g.attributes.uv, idx = g.index;
    const n = idx ? idx.count : pa.count;
    for (let t = 0; t < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      A.fromBufferAttribute(pa, i0).applyMatrix4(m); Bv.fromBufferAttribute(pa, i1).applyMatrix4(m); C.fromBufferAttribute(pa, i2).applyMatrix4(m);
      N.crossVectors(e1.subVectors(Bv, A), e2.subVectors(C, A)); const area2 = N.length(); if (area2 < 1e-8) continue;
      N.divideScalar(area2); if (Math.abs(N.y) > 0.35) continue;
      const az = Math.atan2(N.x, N.z); const s = ((Math.round(az / (Math.PI * 2 / SECT)) % SECT) + SECT) % SECT;
      const sa = s * Math.PI * 2 / SECT, nx = Math.sin(sa), nz = Math.cos(sa);
      const u0 = ua.getX(i0) * RES, v0 = ua.getY(i0) * RES, u1 = ua.getX(i1) * RES, v1 = ua.getY(i1) * RES, u2 = ua.getX(i2) * RES, v2 = ua.getY(i2) * RES;
      const den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2); if (Math.abs(den) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2))), x1 = Math.min(RES - 1, Math.ceil(Math.max(u0, u1, u2)));
      const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2))), y1 = Math.min(RES - 1, Math.ceil(Math.max(v0, v1, v2)));
      const grid = sectors[s];
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const l0 = ((v1 - v2) * (cx - u2) + (u2 - u1) * (cy - v2)) / den, l1 = ((v2 - v0) * (cx - u2) + (u0 - u2) * (cy - v2)) / den, l2 = 1 - l0 - l1;
        if (l0 < -0.01 || l1 < -0.01 || l2 < -0.01) continue;
        const k = (py * RES + px) * 4;
        if (mask(buf[k] / 255, buf[k + 1] / 255, buf[k + 2] / 255) < 0.45) continue;
        P.set(0, 0, 0).addScaledVector(A, l0).addScaledVector(Bv, l1).addScaledVector(C, l2);
        const u = P.x * nz - P.z * nx, v = P.y, d = P.x * nx + P.z * nz;
        const key = Math.round(u / CELL) + ',' + Math.round(v / CELL) + ',' + Math.round(d / 0.7);
        const c = grid.get(key); if (c) { c.n++; c.d = Math.max(c.d, d); } else grid.set(key, { n: 1, d });
      }
    }
  });
  const out = [];
  sectors.forEach((grid, s) => {
    const sa = s * Math.PI * 2 / SECT, nx = Math.sin(sa), nz = Math.cos(sa);
    const seen = new Set();
    for (const key of grid.keys()) {
      if (seen.has(key)) continue;
      const comp = [], stack = [key]; seen.add(key);
      while (stack.length) {
        const k = stack.pop(); comp.push(k); const [a, b, c] = k.split(',').map(Number);
        for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) for (let dc = -1; dc <= 1; dc++) {
          const k2 = (a + da) + ',' + (b + db) + ',' + (c + dc);
          if (!seen.has(k2) && grid.has(k2)) { seen.add(k2); stack.push(k2); }
        }
      }
      let ua = 1e9, ub = -1e9, va = 1e9, vb = -1e9, dm = -1e9;
      for (const k of comp) { const [a, b] = k.split(',').map(Number); ua = Math.min(ua, a); ub = Math.max(ub, a); va = Math.min(va, b); vb = Math.max(vb, b); dm = Math.max(dm, grid.get(k).d); }
      const w = (ub - ua + 1) * CELL, h = (vb - va + 1) * CELL, fill = comp.length / ((ub - ua + 1) * (vb - va + 1));
      if (w < 0.32 || h < 0.36 || w > 5 || h > 6 || fill < 0.3) continue;
      const uc = (ua + ub) / 2 * CELL, vc = (va + vb) / 2 * CELL;
      // back to holder space: P = u * tangent + d * normal (tangent = (nz, -nx))
      out.push({ c: [+(uc * nz + dm * nx).toFixed(3), +vc.toFixed(3), +(-uc * nx + dm * nz).toFixed(3)], a: +sa.toFixed(4), w: +w.toFixed(2), h: +h.toFixed(2), fill: +fill.toFixed(2) });
    }
  });
  return out;
}

/** dev: orthographic unlit base-colour render of one facade of a building (holder space, side = yaw of the
 *  outward normal). Returns { url (PNG data URL), ppm, x0, y0 } so pixels map back to facade coords. */
export function facadeShot(obj, holder, renderer, side = 0, ppm = 48, maskOnly = false) {
  const root = (obj.getObjectByName('LOD0') || obj);
  const sc = new THREE.Scene(); const g = new THREE.Group(); sc.add(g);
  holder.updateMatrixWorld(true); const inv = holder.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: o.material.map }, uMask: { value: maskOnly ? 1 : 0 } }, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float uMask; varying vec2 vUv; void main(){ vec3 dc = texture2D(map, vUv).rgb;
        float wm = smoothstep(0.52, 0.85, dc.r) * smoothstep(0.28, 0.55, dc.g) * smoothstep(0.25, 0.5, dc.r - dc.b);
        vec3 c = pow(max(dc, vec3(0.0)), vec3(1.0/2.2)); gl_FragColor = vec4(uMask > 0.5 ? vec3(wm) : c, 1.0); }` });
    const m = new THREE.Mesh(o.geometry, mat); m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(new THREE.Matrix4().makeRotationY(-side), new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    g.add(m); m.updateMatrixWorld(true); box.expandByObject(m);
  });
  const x0 = box.min.x, x1 = box.max.x, y0 = Math.max(0, box.min.y), y1 = box.max.y;
  const W = Math.ceil((x1 - x0) * ppm), H = Math.ceil((y1 - y0) * ppm);
  const cam = new THREE.OrthographicCamera(x0, x1, y1, y0, 0.01, 100); cam.position.set(0, 0, box.max.z + 10); cam.lookAt(0, 0, -1e3); cam.position.set(0, 0, box.max.z + 10);
  cam.left = x0; cam.right = x1; cam.top = y1; cam.bottom = y0; cam.updateProjectionMatrix();
  cam.matrixAutoUpdate = false; cam.matrix.makeTranslation(0, 0, box.max.z + 10); cam.updateMatrixWorld(true);
  const rt = new THREE.WebGLRenderTarget(W, H); const prev = renderer.getRenderTarget();
  const bg = sc.background = new THREE.Color(maskOnly ? 0x000000 : 0x2040ff);
  renderer.setRenderTarget(rt); renderer.render(sc, cam); const buf = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(prev); rt.dispose();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'); const id = cx.createImageData(W, H);
  for (let y = 0; y < H; y++) id.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  cx.putImageData(id, 0, 0);
  return { url: cv.toDataURL('image/png'), ppm, x0, y0, W, H, zmax: box.max.z };
}

/** dev: turn facade-space rects [side, u, v, w, h] (from the facade shots) into holder-space windows by
 *  ray-casting the glass depth. Returns [[x, y, z, yaw, w, h], ...]. */
export function resolveWindows(obj, holder, rects) {
  const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  holder.updateMatrixWorld(true);
  const root = obj.getObjectByName('LOD0') || obj, meshes = []; root.traverse(o => o.isMesh && meshes.push(o));
  const rc = new THREE.Raycaster(), out = [];
  for (const [s, u, v, w, h] of rects) {
    const a = SIDES[s], R = new THREE.Matrix4().makeRotationY(a);
    const n = new THREE.Vector3(0, 0, 1).applyMatrix4(R);
    const ds = [];
    for (const [fu, fv] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const o = new THREE.Vector3(u + fu * w, v + fv * h, 30).applyMatrix4(R).applyMatrix4(holder.matrixWorld);
      rc.set(o, n.clone().transformDirection(holder.matrixWorld).negate());
      const hit = rc.intersectObjects(meshes, false)[0];
      if (hit) ds.push(30 - hit.distance);
    }
    if (!ds.length) continue;
    ds.sort((p, q) => p - q); const d = ds[Math.floor(ds.length / 2)] + 0.012;
    const c = new THREE.Vector3(u, v, d).applyMatrix4(R);
    out.push([+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3), +a.toFixed(4), +w.toFixed(3), +h.toFixed(3)]);
  }
  return out;
}

// ------------------------------------------------------------------ runtime
import { WINDOWS } from '../assets/windows.js?v=41faccfa';

export const ROOM = { livingA: 0, livingB: 1, livingC: 2, bakery: 3, workshop: 4, church: 5 };
const N_ROOMS = 6, N_TILES = 4; // tiles per room: back wall, side wall, floor, mid-depth furniture card (alpha)

// ---- procedural painted atlas ---------------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function paintAtlas(T) {
  const cv = document.createElement('canvas'); cv.width = T * N_TILES; cv.height = T * N_ROOMS;
  const c = cv.getContext('2d');
  const tile = (room, t, fn, seed = 1) => {
    c.save(); c.translate(t * T, room * T); c.beginPath(); c.rect(0, 0, T, T); c.clip(); c.scale(T, T);
    fn(c, rng(seed + room * 97 + t * 13)); c.restore();
  };
  // helpers in unit space (0..1, y down)
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const lg = (x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, s]) => g.addColorStop(o, s)); return g; };
  const rg = (x, y, r0, r1, stops) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, s]) => g.addColorStop(o, s)); return g; };
  const circ = (x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const ell = (x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
  const poly = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); };
  const BULBS = ['#ff4040', '#ffd040', '#40a0ff', '#50ff80', '#ff70e0', '#fff0c0'];
  const wallpaper = (base, stripe, r, dam = true) => {
    R(0, 0, 1, 1, base);
    for (let x = 0; x < 1; x += 0.08) R(x, 0, 0.022, 1, stripe);
    if (dam) for (let y = 0.05; y < 0.7; y += 0.12) for (let x = 0.04; x < 1; x += 0.08) ell(x + ((y * 10 | 0) % 2) * 0.04, y, 0.012, 0.022, stripe);
  };
  const wainscot = (col, top = 0.68) => { R(0, top, 1, 1 - top, col); R(0, top - 0.015, 1, 0.025, '#3a2414'); for (let x = 0.02; x < 1; x += 0.12) { c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 0.006; c.strokeRect(x, top + 0.05, 0.09, 0.22); } R(0, 0.96, 1, 0.04, '#22140a'); };
  const tree = (x, base, h, r) => {
    R(x - 0.018, base - 0.05, 0.036, 0.05, '#4a2a12');
    for (let i = 0; i < 4; i++) { const y0 = base - 0.04 - i * h / 4.6, w = (0.5 - i * 0.1) * h * 0.9; poly([[x - w, y0], [x + w, y0], [x, y0 - h * 0.42]], i % 2 ? '#1d5a2c' : '#246b34'); }
    c.strokeStyle = '#e8c050'; c.lineWidth = 0.006; c.beginPath(); for (let i = 0; i < 5; i++) { const y = base - 0.08 - i * h * 0.17; c.moveTo(x - h * (0.4 - i * 0.07), y); c.quadraticCurveTo(x, y + 0.03, x + h * (0.4 - i * 0.07), y - 0.03); } c.stroke();
    for (let i = 0; i < 26; i++) { const t = r(), yy = base - 0.06 - t * h * 0.8, ww = (1 - t) * h * 0.4; circ(x + (r() * 2 - 1) * ww, yy, 0.009, BULBS[i % BULBS.length]); }
    poly([...Array(10)].map((_, i) => { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 0.012 : 0.03; return [x + Math.cos(a) * rr, base - h * 0.98 + Math.sin(a) * rr]; }), '#ffe070');
    for (let i = 0; i < 4; i++) { const gx = x - 0.12 + i * 0.07; R(gx, base - 0.05, 0.055, 0.05, ['#c02828', '#2a7ad0', '#e0b030', '#2a9a50'][i]); R(gx + 0.024, base - 0.05, 0.008, 0.05, '#f4f0e0'); }
  };
  const fireplace = (x, w, top, stone = '#6a5a50') => {
    R(x - w / 2, top, w, 0.96 - top, stone);
    for (let y = top; y < 0.96; y += 0.04) for (let xx = x - w / 2 + ((y * 25 | 0) % 2) * 0.03; xx < x + w / 2; xx += 0.06) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.004; c.strokeRect(xx, y, 0.06, 0.04); }
    R(x - w / 2 - 0.03, top - 0.03, w + 0.06, 0.035, '#4a2c16'); // mantel
    const ox = x - w * 0.3, ow = w * 0.6, oy = top + 0.1;
    R(ox, oy, ow, 0.96 - oy, '#120806');
    c.fillStyle = rg(x, 0.93, 0.01, ow * 0.6, [[0, '#fff2b0'], [0.25, '#ffb030'], [0.6, '#e04a10'], [1, 'rgba(60,10,0,0)']]); c.fillRect(ox, oy, ow, 0.96 - oy);
    for (let i = 0; i < 5; i++) { const fx = ox + ow * (0.2 + i * 0.15); poly([[fx - 0.03, 0.94], [fx + 0.03, 0.94], [fx + 0.005, 0.94 - 0.08 - (i % 2) * 0.05]], i % 2 ? '#ffd050' : '#ff8a20'); }
    R(ox + 0.02, 0.925, ow - 0.04, 0.02, '#3a1c0c');
    // garland + stockings
    c.strokeStyle = '#1f5a2a'; c.lineWidth = 0.02; c.beginPath(); c.moveTo(x - w / 2, top - 0.02); c.quadraticCurveTo(x, top + 0.04, x + w / 2, top - 0.02); c.stroke();
    for (let i = 0; i < 3; i++) { const sx = x - w * 0.3 + i * w * 0.3; R(sx - 0.015, top, 0.03, 0.07, ['#c42020', '#2a8a40', '#c42020'][i]); R(sx - 0.015, top, 0.03, 0.015, '#f4f0e8'); R(sx - 0.015, top + 0.06, 0.04, 0.025, ['#c42020', '#2a8a40', '#c42020'][i]); }
  };
  const frame = (x, y, w, h, inner) => { R(x - 0.01, y - 0.01, w + 0.02, h + 0.02, '#c8a050'); R(x, y, w, h, inner); };
  const shelf = (x, y, w, h, rows, r, col = '#5a3418', items = 'books') => {
    R(x, y, w, h, col); R(x + 0.01, y + 0.01, w - 0.02, h - 0.02, '#2a160a');
    for (let k = 0; k < rows; k++) {
      const yy = y + 0.01 + (k + 1) * (h - 0.02) / rows; R(x, yy - 0.01, w, 0.012, col);
      let xx = x + 0.015; const top = yy - (h - 0.02) / rows + 0.01;
      while (xx < x + w - 0.02) {
        if (items === 'books') { const bw = 0.01 + r() * 0.012, bh = (yy - top) * (0.6 + r() * 0.35); R(xx, yy - 0.01 - bh, bw, bh, ['#8a2020', '#204a7a', '#2a6a3a', '#b08a30', '#6a3a7a'][(r() * 5) | 0]); xx += bw + 0.002; }
        else if (items === 'bread') { ell(xx + 0.025, yy - 0.025, 0.024, 0.016, ['#b06a24', '#c8843a', '#8a4a18'][(r() * 3) | 0]); xx += 0.05; }
        else if (items === 'toys') { const t = (r() * 4) | 0; if (t === 0) { ell(xx + 0.02, yy - 0.035, 0.016, 0.02, '#8a5a30'); circ(xx + 0.02, yy - 0.06, 0.012, '#8a5a30'); } else if (t === 1) { R(xx, yy - 0.04, 0.03, 0.03, ['#d03030', '#3070d0', '#e0c030'][(r() * 3) | 0]); } else if (t === 2) { R(xx, yy - 0.035, 0.04, 0.022, '#c02020'); circ(xx + 0.01, yy - 0.012, 0.007, '#222'); circ(xx + 0.03, yy - 0.012, 0.007, '#222'); } else { R(xx + 0.008, yy - 0.06, 0.012, 0.05, '#2a4ad0'); circ(xx + 0.014, yy - 0.066, 0.008, '#f0c8a0'); R(xx + 0.006, yy - 0.08, 0.016, 0.012, '#111'); } xx += 0.045; }
        else { R(xx, yy - 0.05, 0.026, 0.04, ['#a0c0d0', '#d0a060', '#c06040'][(r() * 3) | 0]); xx += 0.035; }
      }
    }
  };
  const lampGlow = (x, y, rad, col = 'rgba(255,200,120,0.55)') => { c.fillStyle = rg(x, y, 0, rad, [[0, col], [1, 'rgba(255,190,110,0)']]); c.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
  const sconce = (x, y) => { lampGlow(x, y, 0.16); R(x - 0.008, y, 0.016, 0.05, '#c8a050'); poly([[x - 0.03, y + 0.005], [x + 0.03, y + 0.005], [x + 0.02, y - 0.045], [x - 0.02, y - 0.045]], '#ffe0a0'); };
  const planks = (base, line, vertical = true) => { R(0, 0, 1, 1, base); c.fillStyle = line; for (let i = 0; i < 12; i++) { const p = i / 12; vertical ? c.fillRect(p, 0, 0.005, 1) : c.fillRect(0, p, 1, 0.005); } };
  const candle = (x, base, h) => { R(x - 0.008, base - h, 0.016, h, '#f4ecd8'); lampGlow(x, base - h - 0.02, 0.07, 'rgba(255,190,90,0.6)'); poly([[x - 0.007, base - h], [x + 0.007, base - h], [x, base - h - 0.03]], '#ffd060'); };
  const armchair = (x, col) => { R(x - 0.11, 0.62, 0.22, 0.2, col); R(x - 0.13, 0.72, 0.05, 0.16, col); R(x + 0.08, 0.72, 0.05, 0.16, col); R(x - 0.09, 0.78, 0.18, 0.08, '#00000033'); R(x - 0.1, 0.88, 0.02, 0.06, '#2a160a'); R(x + 0.08, 0.88, 0.02, 0.06, '#2a160a'); };
  const table = (x, w, top, col = '#5a3418') => { R(x - w / 2, top, w, 0.025, col); R(x - w / 2 + 0.01, top, 0.016, 0.94 - top, col); R(x + w / 2 - 0.026, top, 0.016, 0.94 - top, col); };

  // ---- 0 living A: red damask, fireplace + tree
  tile(0, 0, (c, r) => { wallpaper('#7a1c1c', '#8e2a26', r); wainscot('#4a2a16'); fireplace(0.32, 0.36, 0.5); frame(0.24, 0.14, 0.16, 0.2, '#2a4060'); circ(0.32, 0.24, 0.05, '#e8d0a0'); tree(0.76, 0.95, 0.6, r); sconce(0.08, 0.36); });
  tile(0, 1, (c, r) => { wallpaper('#6e1818', '#822622', r); wainscot('#4a2a16'); frame(0.5, 0.2, 0.18, 0.22, '#3a5a3a'); sconce(0.25, 0.34); shelf(0.74, 0.18, 0.22, 0.76, 4, r); });
  tile(0, 2, (c, r) => { planks('#5a3418', '#2e1a0a'); ell(0.5, 0.45, 0.36, 0.3, '#8a1e1e'); ell(0.5, 0.45, 0.3, 0.24, '#a83a2a'); ell(0.5, 0.45, 0.2, 0.15, '#c8a050'); });
  tile(0, 3, (c, r) => { armchair(0.2, '#2a6a3a'); table(0.48, 0.12, 0.76); candle(0.48, 0.76, 0.06); for (let i = 0; i < 3; i++) R(0.62 + i * 0.05, 0.9 - (i % 2) * 0.03, 0.045, 0.05 + (i % 2) * 0.03, ['#c02828', '#e0b030', '#2a7ad0'][i]); });
  // ---- 1 living B: green, bookshelves, central fireplace, sofa + floor lamp
  tile(1, 0, (c, r) => { wallpaper('#1e4a2e', '#24583a', r); wainscot('#3a2414'); shelf(0.02, 0.12, 0.24, 0.82, 5, r); shelf(0.74, 0.12, 0.24, 0.82, 5, r); fireplace(0.5, 0.34, 0.52, '#7a6e64'); c.strokeStyle = '#2a7a3a'; c.lineWidth = 0.03; c.beginPath(); c.arc(0.5, 0.3, 0.07, 0, Math.PI * 2); c.stroke(); R(0.49, 0.36, 0.02, 0.04, '#c42020'); });
  tile(1, 1, (c, r) => { wallpaper('#1a4228', '#215034', r); wainscot('#3a2414'); R(0.3, 0.18, 0.3, 0.36, '#0c1830'); circ(0.52, 0.27, 0.025, '#e0e8ff'); R(0.25, 0.14, 0.08, 0.5, '#8a1e1e'); R(0.57, 0.14, 0.08, 0.5, '#8a1e1e'); R(0.22, 0.12, 0.46, 0.04, '#5a3418'); sconce(0.85, 0.34); });
  tile(1, 2, (c, r) => { planks('#7a4e26', '#4a2c14'); R(0.15, 0.2, 0.7, 0.55, '#24583a'); R(0.18, 0.23, 0.64, 0.49, '#2e6e46'); for (let i = 0; i < 6; i++) R(0.2 + i * 0.1, 0.25, 0.02, 0.45, '#c8a05055'); });
  tile(1, 3, (c, r) => { R(0.1, 0.66, 0.5, 0.18, '#7a2a2a'); R(0.08, 0.6, 0.54, 0.08, '#8a3434'); R(0.1, 0.84, 0.02, 0.08, '#2a160a'); R(0.58, 0.84, 0.02, 0.08, '#2a160a'); for (let i = 0; i < 3; i++) R(0.14 + i * 0.15, 0.56, 0.12, 0.08, '#c8a060'); R(0.8, 0.4, 0.012, 0.54, '#2a2a2a'); lampGlow(0.806, 0.4, 0.2); poly([[0.76, 0.42], [0.85, 0.42], [0.83, 0.34], [0.78, 0.34]], '#ffe6b0'); });
  // ---- 2 living C: cream/blue, big tree + dining table
  tile(2, 0, (c, r) => { wallpaper('#d8c8a0', '#c8b48a', r); wainscot('#2a3a5a', 0.7); tree(0.5, 0.95, 0.78, r); sconce(0.15, 0.34); sconce(0.85, 0.34); shelf(0.04, 0.42, 0.18, 0.26, 2, r, '#e8e0d0', 'jars'); c.strokeStyle = '#1f5a2a'; c.lineWidth = 0.025; c.beginPath(); c.moveTo(0, 0.08); for (let i = 1; i <= 4; i++) c.quadraticCurveTo(i * 0.25 - 0.125, 0.16, i * 0.25, 0.08); c.stroke(); for (let i = 0; i < 12; i++) circ(i / 12 + 0.04, 0.11, 0.008, BULBS[i % 6]); });
  tile(2, 1, (c, r) => { wallpaper('#d0c098', '#c0ac84', r); wainscot('#2a3a5a', 0.7); frame(0.2, 0.22, 0.14, 0.18, '#6a8aa0'); frame(0.42, 0.18, 0.12, 0.12, '#a07050'); R(0.7, 0.12, 0.12, 0.8, '#5a3418'); circ(0.76, 0.24, 0.045, '#f0e8d0'); R(0.755, 0.2, 0.006, 0.04, '#222'); });
  tile(2, 2, (c, r) => { planks('#3e2614', '#24140a'); ell(0.5, 0.5, 0.38, 0.3, '#2a3a6a'); ell(0.5, 0.5, 0.32, 0.24, '#3a5090'); });
  tile(2, 3, (c, r) => { table(0.32, 0.36, 0.7, '#6a4020'); R(0.14, 0.69, 0.36, 0.02, '#f0ece0'); candle(0.26, 0.69, 0.07); candle(0.38, 0.69, 0.07); for (const x of [0.1, 0.54]) { R(x, 0.56, 0.02, 0.38, '#4a2a12'); R(x - 0.02, 0.76, 0.06, 0.02, '#4a2a12'); } ell(0.82, 0.9, 0.06, 0.035, '#3a3a3a'); circ(0.86, 0.86, 0.025, '#3a3a3a'); });
  // ---- 3 bakery: tiles, bread shelves, oven, glass counter
  tile(3, 0, (c, r) => { R(0, 0, 1, 1, '#efe6d2'); c.fillStyle = '#d8ccb0'; for (let y = 0; y < 1; y += 0.05) c.fillRect(0, y, 1, 0.004); for (let x = 0; x < 1; x += 0.05) c.fillRect(x, 0, 0.004, 1); shelf(0.04, 0.2, 0.5, 0.6, 4, r, '#7a4a22', 'bread'); R(0.62, 0.3, 0.32, 0.66, '#8a3a24'); for (let y = 0.3; y < 0.96; y += 0.04) for (let x = 0.62 + ((y * 25 | 0) % 2) * 0.03; x < 0.94; x += 0.06) { c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.004; c.strokeRect(x, y, 0.06, 0.04); } c.fillStyle = '#120806'; c.beginPath(); c.arc(0.78, 0.66, 0.1, Math.PI, 0); c.fill(); c.fillRect(0.68, 0.66, 0.2, 0.08); c.fillStyle = rg(0.78, 0.72, 0.01, 0.12, [[0, '#fff0a0'], [0.4, '#ff9a30'], [1, 'rgba(80,20,0,0)']]); c.fillRect(0.66, 0.54, 0.24, 0.2); R(0.12, 0.06, 0.34, 0.1, '#22302a'); c.fillStyle = '#f0f0e0'; c.font = '0.05px sans-serif'; c.fillText('FRESH  BREAD', 0.14, 0.13); });
  tile(3, 1, (c, r) => { R(0, 0, 1, 1, '#ece2cc'); c.fillStyle = '#d4c8ac'; for (let y = 0; y < 1; y += 0.05) c.fillRect(0, y, 1, 0.004); for (let x = 0; x < 1; x += 0.05) c.fillRect(x, 0, 0.004, 1); shelf(0.2, 0.3, 0.6, 0.3, 2, r, '#7a4a22', 'jars'); for (let i = 0; i < 4; i++) { const x = 0.25 + i * 0.15; R(x, 0.08, 0.004, 0.1, '#555'); circ(x, 0.2, 0.04, '#b8743a'); } sconce(0.1, 0.3); });
  tile(3, 2, (c, r) => { for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) R(x / 10, y / 10, 0.1, 0.1, (x + y) % 2 ? '#1a1a1a' : '#e8e2d4'); });
  tile(3, 3, (c, r) => { R(0.04, 0.6, 0.92, 0.36, '#6a3a1c'); R(0.04, 0.58, 0.92, 0.03, '#c8a060'); R(0.06, 0.62, 0.88, 0.16, 'rgba(200,230,240,0.35)'); for (let i = 0; i < 8; i++) { const x = 0.1 + i * 0.105; ell(x, 0.74, 0.04, 0.02, ['#e8c8a0', '#8a4a20', '#f4e8e0', '#c87030'][i % 4]); if (i % 2) circ(x, 0.71, 0.012, '#d02020'); } for (let i = 0; i < 3; i++) { const x = 0.2 + i * 0.25; c.fillStyle = '#b06a2a'; circ(x, 0.52, 0.02, '#b06a2a'); R(x - 0.018, 0.53, 0.036, 0.05, '#b06a2a'); } R(0.8, 0.5, 0.1, 0.08, '#444'); R(0.82, 0.48, 0.06, 0.02, '#888'); });
  // ---- 4 toy workshop: plank walls, toy shelves, workbench
  tile(4, 0, (c, r) => { planks('#8a5a2e', '#5a3818'); R(0, 0.6, 1, 0.012, '#4a2a12'); shelf(0.04, 0.12, 0.42, 0.6, 3, r, '#5a3418', 'toys'); R(0.55, 0.14, 0.4, 0.3, '#c8a878'); for (let i = 0; i < 12; i++) { const x = 0.58 + (i % 6) * 0.06, y = 0.18 + ((i / 6) | 0) * 0.13; R(x, y, 0.008, 0.08, '#555'); R(x - 0.01, y, 0.028, 0.015, '#888'); } R(0.72, 0.62, 0.18, 0.32, '#2a2a2a'); c.fillStyle = rg(0.81, 0.86, 0.01, 0.08, [[0, '#ffe8a0'], [0.5, '#ff8a20'], [1, 'rgba(80,20,0,0)']]); c.fillRect(0.74, 0.78, 0.14, 0.12); c.strokeStyle = '#1f5a2a'; c.lineWidth = 0.03; c.beginPath(); c.arc(0.75, 0.07, 0.04, 0, Math.PI * 2); c.stroke(); });
  tile(4, 1, (c, r) => { planks('#845628', '#563414'); shelf(0.25, 0.15, 0.55, 0.5, 3, r, '#5a3418', 'toys'); for (const x of [0.12, 0.9]) { R(x - 0.003, 0, 0.006, 0.12, '#333'); lampGlow(x, 0.16, 0.14); R(x - 0.025, 0.12, 0.05, 0.07, '#ffd890'); } });
  tile(4, 2, (c, r) => { planks('#7a5028', '#4a2e14', false); for (let i = 0; i < 40; i++) circ(r(), r(), 0.006 + r() * 0.01, '#c8a06066'); R(0.3, 0.3, 0.4, 0.3, '#8a2a2a'); });
  tile(4, 3, (c, r) => { R(0.06, 0.64, 0.6, 0.05, '#a06a34'); R(0.08, 0.69, 0.04, 0.27, '#7a4a22'); R(0.6, 0.69, 0.04, 0.27, '#7a4a22'); R(0.1, 0.84, 0.52, 0.03, '#7a4a22'); R(0.14, 0.56, 0.1, 0.08, '#d03030'); circ(0.16, 0.64, 0.012, '#222'); circ(0.22, 0.64, 0.012, '#222'); R(0.3, 0.58, 0.012, 0.06, '#2a4ad0'); circ(0.306, 0.57, 0.01, '#f0c8a0'); R(0.36, 0.6, 0.06, 0.04, '#e0c030'); R(0.46, 0.55, 0.12, 0.09, '#8a5a30'); ell(0.52, 0.54, 0.05, 0.03, '#8a5a30'); c.strokeStyle = '#6a3a1a'; c.lineWidth = 0.012; c.beginPath(); c.arc(0.82, 0.86, 0.1, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); ell(0.82, 0.74, 0.07, 0.04, '#c8a878'); circ(0.89, 0.68, 0.03, '#c8a878'); R(0.78, 0.74, 0.012, 0.1, '#c8a878'); R(0.86, 0.74, 0.012, 0.1, '#c8a878'); });
  // ---- 5 church: stone, altar, candles, stained glass, pews
  const stone = (base) => { R(0, 0, 1, 1, base); for (let y = 0; y < 1; y += 0.06) for (let x = ((y * 16.7 | 0) % 2) * 0.05; x < 1; x += 0.1) { c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 0.004; c.strokeRect(x, y, 0.1, 0.06); } };
  const stained = (x, y, w, h) => { R(x - 0.012, y - 0.012, w + 0.024, h + 0.024, '#3a3430'); const cols = ['#c02a2a', '#2a5ad0', '#e0b030', '#2a9a50', '#8a3ad0']; for (let j = 0; j < 6; j++) for (let i = 0; i < 3; i++) R(x + i * w / 3, y + j * h / 6, w / 3, h / 6, cols[(i + j * 2) % 5]); c.fillStyle = '#3a3430'; c.beginPath(); c.moveTo(x - 0.02, y + 0.001); c.lineTo(x - 0.02, y - 0.06); c.lineTo(x + w + 0.02, y - 0.06); c.lineTo(x + w + 0.02, y + 0.001); c.arc(x + w / 2, y, w / 2, 0, Math.PI, true); c.fill(); };
  tile(5, 0, (c, r) => { stone('#8a8070'); stained(0.42, 0.14, 0.16, 0.34); R(0.3, 0.68, 0.4, 0.28, '#e8e2d0'); R(0.3, 0.68, 0.4, 0.04, '#c8a050'); R(0.48, 0.52, 0.04, 0.16, '#c8a050'); R(0.45, 0.56, 0.1, 0.03, '#c8a050'); for (const x of [0.2, 0.33, 0.67, 0.8]) candle(x, 0.68, 0.12); R(0.06, 0.1, 0.12, 0.5, '#8a1a1a'); R(0.82, 0.1, 0.12, 0.5, '#8a1a1a'); c.strokeStyle = '#1f5a2a'; c.lineWidth = 0.025; for (const x of [0.12, 0.88]) { c.beginPath(); c.arc(x, 0.3, 0.04, 0, Math.PI * 2); c.stroke(); } });
  tile(5, 1, (c, r) => { stone('#827868'); stained(0.3, 0.16, 0.12, 0.36); stained(0.66, 0.16, 0.12, 0.36); sconce(0.52, 0.36); sconce(0.9, 0.36); });
  tile(5, 2, (c, r) => { stone('#6a6258'); R(0.38, 0, 0.24, 1, '#8a1a1a'); R(0.38, 0, 0.012, 1, '#c8a050'); R(0.608, 0, 0.012, 1, '#c8a050'); });
  tile(5, 3, (c, r) => { for (const [x0, x1] of [[0.02, 0.4], [0.6, 0.98]]) { R(x0, 0.72, x1 - x0, 0.05, '#5a3418'); R(x0, 0.62, x1 - x0, 0.1, '#4a2a12'); R(x0, 0.77, 0.02, 0.17, '#3a2010'); R(x1 - 0.02, 0.77, 0.02, 0.17, '#3a2010'); } candle(0.45, 0.9, 0.2); candle(0.55, 0.9, 0.2); R(0.43, 0.9, 0.04, 0.04, '#c8a050'); R(0.53, 0.9, 0.04, 0.04, '#c8a050'); });
  return cv;
}

const VERT = /* glsl */`
  attribute vec4 aInfo;   // room kind, seed, mirror (0/1), light level
  attribute vec4 aBars;   // mullions nx, ny, bar colour id, arch top (church)
  varying vec2 vUv; varying vec3 vPos; varying vec3 vDir; varying vec2 vSize;
  varying vec4 vInfo; varying vec4 vBars; varying vec3 vTint;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vInfo = aInfo; vBars = aBars;
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #else
      vTint = vec3(1.0);
    #endif
    mat4 M = modelMatrix * instanceMatrix;
    vec3 ax = M[0].xyz, ay = M[1].xyz, az = M[2].xyz;
    vSize = vec2(length(ax), length(ay));
    ax /= vSize.x; ay /= vSize.y; az = normalize(az);
    vec4 wp = M * vec4(position, 1.0);
    vec3 v = wp.xyz - cameraPosition;
    vDir = vec3(dot(v, ax), dot(v, ay), dot(v, az));
    vPos = vec3(position.xy * vSize, 0.0);
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */`
  uniform sampler2D uAtlas; uniform float uTime; uniform float uGain;
  varying vec2 vUv; varying vec3 vPos; varying vec3 vDir; varying vec2 vSize;
  varying vec4 vInfo; varying vec4 vBars; varying vec3 vTint;
  #include <fog_pars_fragment>
  const float NR = ${N_ROOMS}.0, NT = ${N_TILES}.0;
  vec4 tileTex(float kind, float t, vec2 uv) {
    uv = clamp(uv, 0.012, 0.988);
    return texture2D(uAtlas, vec2((t + uv.x) / NT, 1.0 - (kind + 1.0 - uv.y) / NR));
  }
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash(dot(i, vec2(1.0, 57.0))), b = hash(dot(i + vec2(1, 0), vec2(1.0, 57.0))), c = hash(dot(i + vec2(0, 1), vec2(1.0, 57.0))), d = hash(dot(i + vec2(1, 1), vec2(1.0, 57.0)));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  void main() {
    float kind = vInfo.x, seed = vInfo.y;
    vec2 S = vSize;
    // church windows: gothic arch top
    if (vBars.w > 0.5) { float r = S.x * 0.5; vec2 q = vec2(vPos.x, vPos.y - (S.y * 0.5 - r)); if (q.y > 0.0 && length(q) > r) discard; }
    // ---- virtual room box behind the glass (metres, window centre = origin, room extends to -z)
    bool church = kind > 4.5;
    float RW = church ? max(S.x * 4.0, 6.0) : clamp(S.x + 1.8, 2.8, 6.5);
    float yF = church ? -(S.y * 0.5 + 1.0) : (S.y > 1.8 ? -S.y * 0.5 - 0.25 : -min(S.y * 0.5 + 0.9, 1.35));
    float RH = church ? S.y + 3.5 : max(2.7, S.y * 0.5 - yF + 0.35);
    float D = church ? 8.0 : (S.x > 2.4 ? 4.2 : 3.4);
    vec3 p = vPos, d = normalize(vDir);
    if (vInfo.z > 0.5) { p.x = -p.x; d.x = -d.x; }
    d.z = min(d.z, -1e-3);
    d.x = abs(d.x) < 1e-4 ? (d.x < 0.0 ? -1e-4 : 1e-4) : d.x; d.y = abs(d.y) < 1e-4 ? (d.y < 0.0 ? -1e-4 : 1e-4) : d.y;
    vec3 bmin = vec3(-RW * 0.5, yF, -D), bmax = vec3(RW * 0.5, yF + RH, 0.0);
    vec3 tA = (bmin - p) / d, tB = (bmax - p) / d, tF = max(tA, tB);
    float t = min(min(tF.x, tF.y), tF.z);
    vec3 h = p + d * t;
    vec4 tex; float shade; vec2 fuv; float face;
    if (t == tF.z) { fuv = vec2((h.x - bmin.x) / RW, (h.y - yF) / RH); tex = tileTex(kind, 0.0, fuv); shade = 1.0; face = 0.0; }
    else if (t == tF.x) { float u = -h.z / D; fuv = vec2(d.x > 0.0 ? u : 1.0 - u, (h.y - yF) / RH); tex = tileTex(kind, 1.0, vec2(u, fuv.y)); shade = 0.78; face = 1.0; }
    else if (d.y < 0.0) { fuv = vec2((h.x - bmin.x) / RW, -h.z / D); tex = tileTex(kind, 2.0, fuv); shade = 0.72; face = 2.0; }
    else { fuv = vec2((h.x - bmin.x) / RW, -h.z / D);
      vec3 wall = tileTex(kind, 0.0, vec2(0.5, 0.95)).rgb * 0.55;
      float beam = step(0.82, fract(fuv.y * 4.0));
      tex = vec4(mix(wall, wall * 0.45, beam), 1.0); shade = 0.6; face = 3.0; }
    vec3 col = tex.rgb;
    // fake AO toward the room's edges/corners
    vec3 rel = (h - bmin) / (bmax - bmin);
    float edge = min(min(min(rel.x, 1.0 - rel.x), min(rel.y, 1.0 - rel.y)), face == 0.0 ? 1.0 : 1.0 - rel.z * 0.0);
    float ao = mix(0.55, 1.0, smoothstep(0.0, 0.12, edge));
    // room light: ceiling lamp falloff + fireplace / oven / candles flicker
    float fl = 0.82 + 0.1 * sin(uTime * 9.1 + seed * 40.0) + 0.08 * sin(uTime * 23.7 + seed * 13.0) * sin(uTime * 3.3);
    float lamp = 0.75 + 0.45 * exp(-dot(h.xz - vec2(0.0, -D * 0.5), h.xz - vec2(0.0, -D * 0.5)) * 0.18) * smoothstep(yF, yF + RH, h.y + 0.6);
    vec2 fp = kind < 0.5 ? vec2(0.32, 0.0) : kind < 1.5 ? vec2(0.5, 0.0) : kind < 2.5 ? vec2(0.5, 0.0) : kind < 3.5 ? vec2(0.78, 0.0) : kind < 4.5 ? vec2(0.81, 0.0) : vec2(0.5, 0.0);
    vec3 fpw = vec3(bmin.x + fp.x * RW, yF + 0.3, -D + 0.2);
    float fire = (kind > 1.5 && kind < 2.5 ? 0.25 : 1.0) * 1.6 / (1.0 + dot(h - fpw, h - fpw) * 0.9);
    vec3 light = vTint * (lamp * shade * ao * vInfo.w) + vec3(1.0, 0.45, 0.12) * fire * fl * (0.7 + 0.3 * vInfo.w);
    // flames / fire texels themselves flicker
    float flame = smoothstep(0.85, 0.98, col.r) * smoothstep(0.35, 0.6, col.g) * (1.0 - smoothstep(0.35, 0.55, col.b));
    col = col * light * (1.0 + flame * (fl - 0.82) * 3.0) + col * flame * 0.6 * fl;
    // ---- mid-depth furniture card (parallax layer)
    float zm = -D * (church ? 0.35 : 0.5), tm = (zm - p.z) / d.z;
    if (tm < t) { vec3 hm = p + d * tm; vec2 mu = vec2((hm.x - bmin.x) / RW, (hm.y - yF) / RH);
      if (mu.x > 0.0 && mu.x < 1.0 && mu.y > 0.0 && mu.y < 1.0) { vec4 m = tileTex(kind, 3.0, mu);
        float fireM = 1.6 / (1.0 + dot(hm - fpw, hm - fpw) * 0.9);
        vec3 mc = m.rgb * (vTint * (0.8 + 0.2 * vInfo.w) * 0.85 + vec3(1.0, 0.45, 0.12) * fireM * fl * 0.5);
        col = mix(col, mc, m.a); } }
    // ---- curtains + valance (window space)
    vec2 wu = vUv;
    float cw = 0.13 + 0.07 * hash(seed * 7.0) + (hash(seed * 3.1) > 0.85 ? 0.12 : 0.0);
    vec3 curtC = kind < 0.5 ? vec3(0.45, 0.06, 0.05) : kind < 1.5 ? vec3(0.08, 0.3, 0.12) : kind < 2.5 ? vec3(0.75, 0.68, 0.52) : kind < 3.5 ? vec3(0.8, 0.75, 0.62) : vec3(0.5, 0.1, 0.08);
    float sway = 0.01 * sin(uTime * 0.7 + seed * 9.0);
    float cl = 1.0 - smoothstep(cw - 0.015, cw + 0.005, wu.x + (1.0 - wu.y) * 0.05 + sway), cr = smoothstep(1.0 - cw - 0.005, 1.0 - cw + 0.015, wu.x - (1.0 - wu.y) * 0.05 + sway);
    float fold = 0.65 + 0.35 * sin((wu.x * S.x) * 55.0);
    float curt = church ? 0.0 : max(cl, cr);
    col = mix(col, curtC * vTint * fold * (0.55 + 0.25 * vInfo.w) + vec3(1.0, 0.45, 0.12) * 0.06 * fl, curt);
    float val = church ? 0.0 : step(1.0 - 0.09 / max(S.y, 0.5), wu.y);
    col = mix(col, curtC * vTint * 0.45, val);
    // ---- glass: fresnel reflection of the night sky / street light
    float cosT = clamp(-d.z, 0.0, 1.0);
    float fres = 0.04 + 0.6 * pow(1.0 - cosT, 4.0);
    vec3 sky = mix(vec3(0.015, 0.03, 0.07), vec3(0.09, 0.13, 0.22), wu.y);
    float streak = smoothstep(0.06, 0.0, abs(fract(wu.x * 0.7 - wu.y * 0.45 + seed) - 0.5) - 0.18) * 0.35;
    col = mix(col, sky + vec3(0.55, 0.62, 0.75) * streak * 0.25, fres) + vec3(0.6, 0.7, 0.9) * streak * 0.04;
    // church: lead-came tint (stained glass over the nave)
    if (church) { vec2 g = vUv * vec2(3.0, 7.0); vec3 sg = vec3(0.9 + 0.3 * sin(floor(g.x) * 3.0 + floor(g.y) * 1.7), 0.6 + 0.3 * sin(floor(g.x) * 5.0 + floor(g.y) * 2.3 + 1.0), 0.7 + 0.3 * sin(floor(g.x) * 2.0 + floor(g.y) * 3.1 + 2.0));
      col *= mix(vec3(1.0), sg, 0.6); float lead = max(smoothstep(0.06, 0.0, abs(fract(g.x) - 0.5) - 0.44), smoothstep(0.08, 0.0, abs(fract(g.y) - 0.5) - 0.44)); col = mix(col, vec3(0.03), lead * 0.9); }
    // ---- frost creeping in from the corners + snow-dusted sill
    vec2 cm = min(wu, 1.0 - wu) * S;                       // distance to the frame in metres
    float fn = noise(wu * S * 9.0 + seed * 17.0) * 0.6 + noise(wu * S * 23.0) * 0.4;
    float rc = min(0.32, 0.28 * min(S.x, S.y));               // frost reach from each corner (metres)
    float frost = smoothstep(rc, rc * 0.2, length(cm) + (fn - 0.5) * rc * 0.5) + smoothstep(0.05, 0.0, cm.y + (fn - 0.5) * 0.04) * step(wu.y, 0.5) * 0.5;
    frost = clamp(frost, 0.0, 1.0) * 0.7;
    col = mix(col, vec3(0.5, 0.6, 0.75) * (0.3 + 0.3 * fn) + col * 0.4, frost);
    // ---- mullions / glazing bars
    if (vBars.x > 0.5) {
      vec2 n = vBars.xy, bw = vec2(0.035) / S;
      vec2 g = abs(fract(wu * n) - 0.5) * (1.0 / n);
      float edgeB = max(step(0.5 / n.x - bw.x * 0.5, g.x), step(0.5 / n.y - bw.y * 0.5, g.y));
      vec3 bc = vBars.z < 0.5 ? vec3(0.07, 0.04, 0.025) : vBars.z < 1.5 ? vec3(0.7, 0.68, 0.64) : vec3(0.03);
      col = mix(col, bc * (0.25 + 0.3 * vTint), edgeB);
    }
    gl_FragColor = vec4(col * uGain, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// per building type: room kind picker + glazing style [nx, ny, barColour(0 wood,1 white,2 iron)]
const STYLE = {
  church:        { room: () => ROOM.church, bars: [0, 0, 2], arch: 1 },
  bakery:        { room: (w) => w.w > 2.2 ? ROOM.bakery : null, bars: [2, 2, 0], shop: [3, 1, 0] },
  toyWorkshop:   { room: () => ROOM.workshop, bars: [3, 3, 1] },
  townhouse:     { bars: [2, 2, 0] }, validatorHouse: { bars: [2, 2, 0] },
  inn:           { bars: [2, 2, 0] }, gingerbread: { bars: [2, 2, 1] },
  stoneCottage:  { bars: [3, 3, 2] }, logCabin: { bars: [2, 2, 0] }, windmill: { bars: [1, 2, 0] },
};

export class Interiors {
  constructor(world, scene, quality = 'high', cfg = {}) {
    this.world = world; this.windows = [];
    const T = quality === 'high' ? 384 : 256;
    const atlas = new THREE.CanvasTexture(paintAtlas(T));
    atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas = atlas;
    const PUSH = cfg.push ?? 0.05, INSET = cfg.inset ?? 0.94;
    const list = [];
    for (const b of world.buildings) {
      const rects = b.isGLB && WINDOWS[b.type]; if (!rects) continue;
      for (const r of rects) list.push({ b, r });
    }
    const n = list.length;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uTime: { value: 0 }, uGain: { value: 1.0 } }]),
      vertexShader: VERT, fragmentShader: FRAG, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.material.uniforms.uAtlas.value = atlas;
    const geo = new THREE.PlaneGeometry(1, 1);
    const info = new Float32Array(n * 4), bars = new Float32Array(n * 4);
    const mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, n));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let seedN = 1;
    list.forEach(({ b, r }, i) => {
      const [x, y, z, yaw, w, h] = r, st = STYLE[b.type] || { bars: [2, 2, 0] };
      const hsh = Math.abs(Math.sin((b.x * 12.9898 + b.z * 78.233 + i * 37.719)) * 43758.5453) % 1;
      let room = st.room ? st.room({ w, h, y }) : null;
      if (room == null) room = [ROOM.livingA, ROOM.livingB, ROOM.livingC][Math.floor(hsh * 3)];
      const glaze = (st.shop && room === ROOM.bakery) ? st.shop : st.bars;
      // pushed a few cm proud of the (lumpy, photogrammetry-like) glass and inset so the frame still overlaps the edges
      pos.set(x + Math.sin(yaw) * PUSH, y, z + Math.cos(yaw) * PUSH).applyMatrix4(b.holder.matrixWorld);
      q.setFromAxisAngle(up, yaw + b.rot);
      s.set(w * INSET, h * INSET, 1);
      m4.compose(pos, q, s); mesh.setMatrixAt(i, m4);
      info.set([room, (seedN++ * 0.6180339) % 1, hsh > 0.5 ? 1 : 0, 0.85 + ((hsh * 7.3) % 1) * 0.35], i * 4);
      bars.set([glaze[0], glaze[1], glaze[2], st.arch || 0], i * 4);
      mesh.setColorAt(i, new THREE.Color(1, 0.78, 0.5));
      this.windows.push({ b, i, pos: pos.clone(), yaw: yaw + b.rot, w, h, room });
    });
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    geo.setAttribute('aBars', new THREE.InstancedBufferAttribute(bars, 4));
    mesh.count = n; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'windowInteriors';
    this.mesh = mesh; scene.add(mesh);
    this._last = new Map(); this._c = new THREE.Color();
    console.info(`[interiors] ${n} window interiors (${T}px atlas tiles)`);
  }
  /** per frame: time for flicker, and per-building light tint (follows winMat: warm -> blue once delivered, slow-node flicker) */
  update(t) {
    this.material.uniforms.uTime.value = t;
    if (!this.mesh.instanceColor) return;
    let dirty = false;
    for (const w of this.windows) {
      const wm = w.b.winMat, k = wm.emissiveIntensity / 1.9;
      const key = wm.emissive.getHex() * 1000 + Math.round(k * 100);
      if (this._last.get(w.i) === key) continue;
      this._last.set(w.i, key);
      // warm emissive (WINDOW_WARM) -> room light (1, 0.78, 0.5); other hues pass through normalised
      const e = wm.emissive, mx = Math.max(e.r, e.g, e.b, 1e-3);
      this._c.setRGB(e.r / mx, e.g / mx * 0.92, e.b / mx * 0.9).multiplyScalar(Math.min(1.4, k));
      this.mesh.setColorAt(w.i, this._c); dirty = true;
    }
    if (dirty) this.mesh.instanceColor.needsUpdate = true;
  }
  /** debug: world-space info for a window (QA camera framing) */
  info(i) { const w = this.windows[i]; return w && { i, type: w.b.type, room: w.room, pos: w.pos.toArray(), yaw: w.yaw, w: w.w, h: w.h }; }
}
