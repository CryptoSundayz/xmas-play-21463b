// Snow, gift flights (gossip), mump2p light shards + trails, particle bursts, fireworks (Optimum logo).
import * as THREE from 'three';
import { glowTexture } from './util.js?v=41faccfa';
import { logoPoints } from './logo.js?v=41faccfa';
import { giftBox } from './props.js?v=41faccfa';

// ------------------------------------------------------------------ snow
export class Snow {
  /** opts: layered snow — near bokeh flakes / main / far fine dust */
  constructor(scene, count, { box = 70, h = 40, size = 0.16, opacity = 0.85, speed = 1, soft = 0, mobile = null } = {}) {
    this.box = box; this.h = h; this.o = { size, speed, opacity, mobile }; // mobile: CONFIG.mobileLook.snow (touch only)
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = Math.random() * this.box; pos[i * 3 + 1] = Math.random() * this.h; pos[i * 3 + 2] = Math.random() * this.box; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.6, 0.3) }, uSpeed: { value: 2.2 }, uBox: { value: this.box }, uH: { value: this.h }, uSize: { value: size }, uOpacity: { value: opacity }, uSoft: { value: soft }, uMap: { value: glowTexture() }, uDensity: { value: 1 }, uPxK: { value: 1 }, uMinPx: { value: 0 }, uNearFade: { value: new THREE.Vector2(0, 3) } };
    if (mobile) { this.uniforms.uMinPx.value = mobile.minPx; this.uniforms.uNearFade.value.fromArray(mobile.nearFade); }
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uTime,uSpeed,uBox,uH,uSize,uDensity,uPxK,uMinPx; uniform vec3 uCenter; uniform vec2 uWind,uNearFade; varying float vA;
        void main(){
          // weather: only a fraction of the pool falls (clear night = sparse, storm = all), decorrelated from size/speed
          if (fract(aSeed * 7.31 + 0.13) > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          vec3 p = position; float t = uTime;
          float fall = t*uSpeed*(0.6+aSeed*0.8);
          p.y = mod(p.y - fall, uH);
          float sx = p.x + uWind.x*fall*0.5 + sin(t*0.9+aSeed*40.0)*0.8;
          float sz = p.z + uWind.y*fall*0.5 + cos(t*0.7+aSeed*30.0)*0.8;
          vec3 o = uCenter - vec3(uBox*0.5, uH*0.35, uBox*0.5);
          p.y += o.y;
          vec3 w = vec3(o.x + mod(sx - o.x, uBox), p.y, o.z + mod(sz - o.z, uBox));
          vec4 mv = modelViewMatrix*vec4(w,1.0);
          gl_Position = projectionMatrix*mv;
          // desktop: uPxK = 1, uMinPx = 0, uNearFade = (0, 3). Touch: smaller flakes on small buffers, kept >= uMinPx px
          // with the alpha scaled by the lost area, and a longer fade-in right in front of the lens
          float ps = uSize*(0.6+aSeed)*(420.0*uPxK/-mv.z);
          float lost = ps < uMinPx ? (ps*ps)/(uMinPx*uMinPx) : 1.0;
          gl_PointSize = max(ps, uMinPx);
          vA = smoothstep(uNearFade.x, uNearFade.y, -mv.z) * lost;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uOpacity, uSoft; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = mix(smoothstep(0.5,0.15,d), smoothstep(0.5,0.0,d)*0.8, uSoft); gl_FragColor = vec4(vec3(0.92,0.95,1.0), a*uOpacity*vA); }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  /** weather (CONFIG.weather via main.updateStorm): { snow: density 0..1, wind: 0..1, fall: speed mult } */
  update(t, center, storm, weather) {
    const w = weather || { snow: 0.3 + storm * 0.7, wind: 0.08 + storm * 0.92, fall: 1 + storm * 1.4 };
    this.uniforms.uTime.value = t;
    this.uniforms.uCenter.value.set(center.x, Math.max(0, center.y), center.z);
    this.uniforms.uDensity.value = w.snow;
    this.uniforms.uSpeed.value = 2.2 * w.fall * this.o.speed;
    this.uniforms.uWind.value.set(0.4 + w.wind * 9.2, 0.2 + w.wind * 4.1);
    this.uniforms.uSize.value = this.o.size * (1 + storm * 0.4);
    const M = this.o.mobile; // touch: flake px follow the screen's projection scale (Snow.proj, set by main per frame)
    if (M && Snow.proj > 0) this.uniforms.uPxK.value = Math.min(1, Math.max(M.pxMin, Math.pow(Snow.proj / M.pxRef, M.pxExp)));
  }
}
Snow.proj = 0; // px per unit at 1 m: drawing-buffer height / (2 tan(fov/2))

// ------------------------------------------------------- particle bursts
export class Particles {
  constructor(scene, max = 3000, size = 0.35) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.target = new Float32Array(max * 3); this.mode = new Uint8Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.base = new Float32Array(max * 3);
  }
  spawn(x, y, z, vx, vy, vz, color, life, mode = 0, tx = 0, ty = 0, tz = 0, drag = 1.2) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life; this.maxLife[i] = life; this.mode[i] = mode; this.target.set([tx, ty, tz], i * 3); this.drag[i] = drag;
  }
  burst(p, color, count = 60, speed = 6, life = 1.1) {
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u), v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(p.x, p.y, p.z, Math.cos(th) * s * v, u * v + speed * 0.3, Math.sin(th) * s * v, color, life * (0.6 + Math.random() * 0.6));
    }
  }
  update(dt) {
    const P = this.pos, V = this.vel, C = this.col;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, a = Math.max(0, this.life[i] / this.maxLife[i]);
      if (this.mode[i] === 1) { // seek target (logo fireworks)
        const f = 1 - Math.exp(-4.0 * dt);
        P[k] += (this.target[k] - P[k]) * f; P[k + 1] += (this.target[k + 1] - P[k + 1]) * f; P[k + 2] += (this.target[k + 2] - P[k + 2]) * f;
        const fade = Math.min(1, a * 3);
        C[k] = this.base[k] * fade; C[k + 1] = this.base[k + 1] * fade; C[k + 2] = this.base[k + 2] * fade;
      } else {
        const d = Math.exp(-this.drag[i] * dt);
        V[k] *= d; V[k + 1] = V[k + 1] * d - 4.5 * dt; V[k + 2] *= d;
        P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
        C[k] = this.base[k] * a; C[k + 1] = this.base[k + 1] * a; C[k + 2] = this.base[k + 2] * a;
      }
    }
    // compact tail
    while (this.n > 0 && this.life[this.n - 1] <= 0) this.n--;
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// free GPU buffers of a finished one-shot object (geometries + materials; shared textures are cached, kept)
function disposeTree(o) { o.traverse(m => { m.geometry?.dispose?.(); [].concat(m.material || []).forEach(x => x.dispose?.()); }); }
const _flC = new THREE.Color(0.3, 0.6, 1.4);
// ---------------------------------------------------- gossip gift flight
export class Flights {
  constructor(scene, particles) { this.scene = scene; this.p = particles; this.list = []; }
  gossip(from, to, duration, onArrive) {
    const g = giftBox(0x1565ff, 0x1e88ff, 0.45, 2.4);
    g.position.copy(from); this.scene.add(g);
    this.list.push({ kind: 'gift', obj: g, from: from.clone(), to: to.clone(), t: 0, dur: duration, onArrive });
  }
  /** mump2p: shard flies along glowing curved trail */
  shard(from, to, duration, onArrive, seed = Math.random(), width = 1) {
    // low, sweeping ribbon from the gift across the street to the house, cresting around eave/roof
    // height (concept art): rises out of the sack, glides nearly level, then dips into the facade.
    const dir = to.clone().sub(from); dir.y = 0; const D = Math.max(1, dir.length()); dir.divideScalar(D);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((seed - 0.5) * Math.min(7, D * 0.35));
    const crest = Math.min(6.2, 2.6 + D * 0.12) + seed * 1.4;
    const c1 = from.clone().addScaledVector(dir, D * 0.18).add(side); c1.y = from.y + crest * 1.25;
    const c2 = to.clone().addScaledVector(dir, -D * 0.3).add(side.clone().multiplyScalar(0.55)); c2.y = to.y + crest * 0.85;
    const curve = new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
    // two-layer light trail: soft volumetric sheath + white-hot core, with energy pulses running along it
    const tubeMat = (core) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uP: { value: 0 }, uFade: { value: 1 }, uT: { value: 0 }, uC: { value: new THREE.Color(core ? 0x8fd2ff : 0x1673ff) } },
      vertexShader: 'varying vec2 vUv; varying float vE; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vec3 n = normalize(mat3(modelMatrix)*normal); vE = abs(dot(n, normalize(cameraPosition - w.xyz))); gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `varying vec2 vUv; varying float vE; uniform float uP, uFade, uT; uniform vec3 uC;
        void main(){ float x = vUv.x; if (x > uP) discard;
          float head = smoothstep(uP - 0.1, uP, x);
          float tail = smoothstep(0.0, 0.06, x) * (0.45 + 0.55 * x / max(uP, 0.001));
          float pulse = 0.65 + 0.35 * sin((x * 60.0 - uT * 22.0));
          float edge = ${core ? 'pow(clamp(vE, 0.0, 1.0), 0.6)' : 'pow(clamp(vE, 0.0, 1.0), 2.5)'};
          float a = edge * tail * pulse * uFade;
          gl_FragColor = vec4(uC * (${core ? '1.35' : '0.75'} + head * 2.6) * a, a); }`,
    });
    const geo = new THREE.TubeGeometry(curve, 128, 0.5 * width, 10, false);
    const trail = new THREE.Mesh(geo, tubeMat(false)); trail.frustumCulled = false; trail.userData.noAO = true;
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.085 * Math.sqrt(width), 6, false), tubeMat(true)); core.frustumCulled = false;
    trail.add(core); trail.userData.core = core;
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.3 * Math.sqrt(width)), new THREE.MeshBasicMaterial({ color: 0x9fe3ff }));
    head.material.color.multiplyScalar(4);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x49c2ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(3.2); head.add(halo);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    flare.scale.set(5.5, 0.35, 1); head.add(flare);
    this.scene.add(trail, head);
    this.list.push({ kind: 'shard', trail, head, curve, t: 0, dur: duration, onArrive, fade: -1 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (f.kind === 'gift') {
        f.t += dt / f.dur; const t = Math.min(1, f.t);
        f.obj.position.lerpVectors(f.from, f.to, t); f.obj.position.y += Math.sin(t * Math.PI) * 3;
        f.obj.rotation.y += dt * 8; f.obj.scale.setScalar(1 - t * 0.4);
        if (Math.random() < 0.6) this.p.spawn(f.obj.position.x, f.obj.position.y, f.obj.position.z, 0, 0.5, 0, _flC, 0.5);
        if (f.t >= 1) { this.scene.remove(f.obj); disposeTree(f.obj); this.list.splice(i, 1); f.onArrive?.(); }
      } else {
        if (f.fade < 0) {
          f.t += dt / f.dur; const t = Math.min(1, f.t);
          const e = 1 - Math.pow(1 - t, 2);
          for (const m of [f.trail, f.trail.userData.core]) { m.material.uniforms.uP.value = e; m.material.uniforms.uT.value += dt; }
          f.curve.getPointAt(e, f.head.position);
          f.head.rotation.y += dt * 10;
          for (let k = 0; k < 2; k++) this.p.spawn(f.head.position.x, f.head.position.y, f.head.position.z, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, new THREE.Color(0.35, 0.8, 1.8), 0.5 + Math.random() * 0.5);
          if (f.t >= 1) { f.fade = 1; this.scene.remove(f.head); disposeTree(f.head); if (f.onArrive) { this.p.burst(f.head.position, new THREE.Color(0.5, 0.9, 2.2), 36, 4.5, 0.7); this.onImpact?.(f.head.position); f.onArrive(); } }
        } else {
          f.fade -= dt * 0.33; // trails linger ~3 s after the hit
          for (const m of [f.trail, f.trail.userData.core]) { m.material.uniforms.uFade.value = Math.max(0, f.fade); m.material.uniforms.uT.value += dt; }
          if (f.fade <= 0) { this.scene.remove(f.trail); for (const m of [f.trail, f.trail.userData.core]) { m.geometry.dispose(); m.material.dispose(); } this.list.splice(i, 1); }
        }
      }
    }
  }
  clear() { for (const f of this.list) { const o = f.obj || f.trail; this.scene.remove(o); disposeTree(o); if (f.head) { this.scene.remove(f.head); if (f.head.geometry?.attributes?.position) disposeTree(f.head); } } this.list = []; }
  get activeShards() { return this.list.filter(f => f.kind === 'shard').length; }
}

// ------------------------------------------------------------ fireworks
export class Fireworks {
  constructor(scene, particles) { this.scene = scene; this.p = particles; this.rockets = []; this.timer = 0; this.logoTimer = 0.8; this.center = new THREE.Vector3(0, 55, 0); this.facing = new THREE.Vector3(0, 0, 1); }
  launch(x, z, logo = false) {
    this.rockets.push({ pos: new THREE.Vector3(x, 1, z), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 34 + Math.random() * 8, (Math.random() - 0.5) * 3), fuse: logo ? 1.35 : 0.9 + Math.random() * 0.6, logo });
    this.onLaunch?.(this.rockets[this.rockets.length - 1]);
  }
  explode(r) {
    const cols = [new THREE.Color(1.6, 0.35, 0.4), new THREE.Color(1.6, 1.3, 0.4), new THREE.Color(0.5, 1.6, 0.7), new THREE.Color(1.4, 0.6, 1.6), new THREE.Color(0.4, 1.1, 2.0)];
    if (r.logo) {
      // particles fly out from the burst and settle into the Optimum logo outline
      const pts = logoPoints(220); const S = 26;
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.facing).normalize();
      const c = new THREE.Color(0x51b1fe).multiplyScalar(2.2); // brand Azure
      for (const p of pts) for (let k = 0; k < 2; k++) {
        const tx = r.pos.x + right.x * p.x * S, ty = r.pos.y + p.y * S, tz = r.pos.z + right.z * p.x * S;
        this.p.spawn(r.pos.x, r.pos.y, r.pos.z, 0, 0, 0, c, 4.2, 1, tx + (Math.random() - 0.5) * 0.4, ty + (Math.random() - 0.5) * 0.4, tz);
      }
      this.p.burst(r.pos, new THREE.Color(0.6, 1.4, 2.2), 120, 16, 1.4);
    } else this.p.burst(r.pos, cols[Math.floor(Math.random() * cols.length)], 140, 15, 1.8);
  }
  update(dt, active) {
    if (active) {
      this.timer -= dt; this.logoTimer -= dt;
      if (this.timer <= 0) { this.timer = 0.35 + Math.random() * 0.5; const a = Math.random() * 6.28, r = 20 + Math.random() * 40; this.launch(this.center.x + Math.cos(a) * r, this.center.z + Math.sin(a) * r); }
      if (this.logoTimer <= 0) { this.logoTimer = 5.5; this.launch(this.center.x, this.center.z, true); }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]; r.fuse -= dt; r.vel.y -= 12 * dt; r.pos.addScaledVector(r.vel, dt);
      this.p.spawn(r.pos.x, r.pos.y, r.pos.z, 0, -1, 0, new THREE.Color(1.5, 1.1, 0.6), 0.45);
      if (r.fuse <= 0) { this.explode(r); this.rockets.splice(i, 1); }
    }
  }
}
