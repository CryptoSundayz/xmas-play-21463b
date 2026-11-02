// ?hitch=1 frame-spike log (debug only, zero cost when off). Every rendered frame records its rAF interval and the
// main-thread sections (update / pines / culler / render), whether the shadow map was re-rendered, whether the
// instance culler or the pine LOD re-uploaded instances, the GL program and texture counts (a new program = a shader
// compile, a new texture = an upload), the render scale and the active perf tiers. A frame whose interval exceeds
// `ms` (default 25) is logged with all of that, plus a GC hint (JS heap shrank since the last frame, Chrome only).
// window.__hitch: { spikes: [...], summary(), reset() }.
export class HitchLog {
  constructor({ ms = 25, ring = 900 } = {}) {
    this.ms = ms; this.ring = ring; this.frames = []; this.spikes = []; this.last = 0; this.cur = null; this.prev = null;
    this.heap = 0; this.t0 = performance.now();
    window.__hitch = this;
    console.info(`[hitch] logging frames > ${ms} ms (window.__hitch.summary())`);
  }
  /** start of a loop iteration (rAF callback) */
  begin(now = performance.now()) {
    const dt = this.last ? now - this.last : 0; this.last = now;
    this.cur = { t: +(now - this.t0).toFixed(1), dt: +dt.toFixed(1), s: {}, f: {} };
    return this.cur;
  }
  /** time a section: const t = h.t(); ...; h.add('pines', t) */
  t() { return performance.now(); }
  add(name, t0) { if (this.cur) this.cur.s[name] = (this.cur.s[name] || 0) + performance.now() - t0; }
  flag(name, v = true) { if (this.cur && v) this.cur.f[name] = (this.cur.f[name] || 0) + (v === true ? 1 : v); }
  /** end of a rendered frame: ctx = { programs, textures, geometries, scale, tiers, moving } */
  end(ctx) {
    const c = this.cur; if (!c) return; this.cur = null;
    Object.assign(c, ctx);
    for (const k in c.s) c.s[k] = +c.s[k].toFixed(2);
    const hp = performance.memory?.usedJSHeapSize || 0; c.gc = !!(this.heap && hp && hp < this.heap - 256 * 1024); this.heap = hp;
    const p = this.prev;
    if (p) { c.newPrograms = c.programs - p.programs; c.newTextures = c.textures - p.textures; c.tierChange = c.tiers !== p.tiers || c.scale !== p.scale; }
    this.frames.push(c); if (this.frames.length > this.ring) this.frames.shift();
    // the interval that ENDS at this frame's start belongs to the previous frame's work, so log it against both
    if (c.dt > this.ms && p) {
      const e = { ...c, before: { s: p.s, f: p.f, newPrograms: p.newPrograms, newTextures: p.newTextures, tierChange: p.tierChange } };
      this.spikes.push(e); if (this.spikes.length > 300) this.spikes.shift();
      console.warn(`[hitch] ${c.dt} ms at ${(c.t / 1000).toFixed(2)} s | prev frame: ${JSON.stringify(p.s)} ${JSON.stringify(p.f)} progs+${p.newPrograms ?? 0} tex+${p.newTextures ?? 0}${p.tierChange ? ' TIER/SCALE CHANGE' : ''}${c.gc ? ' GC?' : ''} | programs ${c.programs} textures ${c.textures} scale ${c.scale} ${c.tiers || ''}`);
    }
    this.prev = c;
  }
  /** frame-time stats over the ring (optionally only frames matching pred) */
  summary(pred = null) {
    const F = this.frames.filter(f => f.dt > 0 && (!pred || pred(f))), d = F.map(f => f.dt).sort((a, b) => a - b);
    if (!d.length) return { frames: 0 };
    const q = x => d[Math.min(d.length - 1, Math.floor(x * d.length))], sum = d.reduce((a, b) => a + b, 0);
    const avgS = {}; for (const f of F) for (const k in f.s) avgS[k] = (avgS[k] || 0) + f.s[k] / F.length;
    const flags = {}; for (const f of F) for (const k in f.f) flags[k] = (flags[k] || 0) + f.f[k] / F.length;
    for (const k in avgS) avgS[k] = +avgS[k].toFixed(2); for (const k in flags) flags[k] = +flags[k].toFixed(2);
    return { frames: d.length, avg: +(sum / d.length).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1],
      hitches25: d.filter(x => x > 25).length, hitches50: d.filter(x => x > 50).length, sections: avgS, flagsPerFrame: flags,
      newPrograms: F.reduce((a, f) => a + Math.max(0, f.newPrograms || 0), 0), newTextures: F.reduce((a, f) => a + Math.max(0, f.newTextures || 0), 0),
      gcHints: F.filter(f => f.gc).length };
  }
  reset() { this.frames.length = 0; this.spikes.length = 0; this.prev = null; }
}
