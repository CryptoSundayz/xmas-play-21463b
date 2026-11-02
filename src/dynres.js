// Dynamic resolution controller (all devices / presets; off only under ?qa=1 or ?dynres=0).
// Works from frame time alone (Safari has no GPU timer queries), so it treats every resolution change as an experiment:
//  - rolling mean fps over the last 1.5 s (stalls > 120 ms and the frames right after a resize are ignored)
//  - DOWN: fps < 90% of target for >= 1 s -> scale -0.05 (-0.10 when < 70%); 1.5 s settle after every change
//  - did it help? once a chain of down-steps has cut the pixel count by ~45% (or hit the floor), a fill-bound frame should
//    have sped up roughly in proportion; if it got < 30% of that, the game is not fill-bound (CPU-bound, Low Power Mode 30 Hz
//    rAF cap, background throttling): restore the resolution and adopt the measured fps as the cap, so it never
//    blurs the image for nothing and never wobbles; the cap is dropped when fps rises clearly above it
//  - UP: fps >= 95% of target for 2 s -> +0.05 (a probe); if that probe forces a down-step within 6 s the previous
//    level is restored and becomes a ceiling for 20 s, doubling up to 120 s (no flip-flopping between two sizes)
// Steps are small (0.05 of the preset pixel ratio) and rate-limited, so changes read as a slight softening, not a pop.
export class DynRes {
  constructor({ min = 0.6, max = 1, step = 0.05, target = 60, apply = () => {}, log = () => {} } = {}) {
    Object.assign(this, { min, max, step, target, apply, log });
    this.reset(max);
  }
  reset(scale = this.max) {
    this.scale = scale; this.t = 0; this.win = []; this.acc = 0; this.bad = 0; this.good = 0;
    this.lastChange = -99; this.lastUp = -99; this.ceil = this.max; this.ceilUntil = 0; this.backoff = 20;
    this.chain = null; this.cap = 0; this.history = [];
  }
  fps() { let s = 0; for (const w of this.win) s += w[1]; return s > 0 ? this.win.length * 1000 / s : 0; }
  span() { return this.win.length ? this.t - this.win[0][0] : 0; }
  _set(s, why) {
    s = Math.round(Math.min(this.max, Math.max(this.min, s)) / this.step) * this.step;
    s = +Math.min(this.max, Math.max(this.min, s)).toFixed(3);
    if (Math.abs(s - this.scale) < 1e-6) return false;
    this.history.push({ t: +this.t.toFixed(2), from: this.scale, to: s, fps: +this.fps().toFixed(1), why });
    if (this.history.length > 50) this.history.shift();
    this.log(`[dynres] ${this.scale.toFixed(2)} -> ${s.toFixed(2)} (${this.fps().toFixed(0)} fps, ${why})`);
    this.scale = s; this.lastChange = this.t; this.win.length = 0; this.bad = this.good = 0; this.apply(s);
    return true;
  }
  /** dt: real frame delta (s). active=false (menus, paused, loading): keep state, collect nothing.
   *  upOk=false: measure and step down as usual, but no up-probe (frames not representative of the load). */
  tick(dt, active = true, upOk = true) {
    const ms = dt * 1000; if (ms > 0) this.t += Math.min(dt, 0.25);
    if (!active) { this.win.length = 0; this.bad = this.good = 0; return; }
    if (!(ms > 0) || ms > 120 || this.t - this.lastChange < 0.35) return;
    this.win.push([this.t, ms]); while (this.t - this.win[0][0] > 1.5) this.win.shift();
    this.acc += dt; if (this.acc < 0.5) return; this.acc = 0;
    if (this.t - this.lastChange < 1.5 || this.span() < 1.0) return;
    const fps = this.fps(), T = this.cap ? Math.min(this.target, this.cap) : this.target;
    if (this.cap && fps > this.cap * 1.15) { this.log(`[dynres] cap ${this.cap.toFixed(0)} fps lifted (${fps.toFixed(0)} fps)`); this.cap = 0; return; }
    // verdict on the current chain of down-steps (vsync quantisation can hide the gain of one small step, so judge the chain)
    if (this.chain) {
      const c = this.chain;
      if (fps >= T * 0.9) this.chain = null;
      else if (this.scale <= c.top * 0.75 + 1e-6 || this.scale <= this.min + 1e-6) {
        // a fill-bound frame speeds up ~ with the pixel count; under 30% of that ideal gain = not worth the blur
        const ideal = (c.top / this.scale) ** 2, gain = fps / c.fps;
        if (gain - 1 < 0.3 * (ideal - 1)) {
          this.chain = null; this.cap = Math.max(1, c.fps); // the fps the restored level gave
          this._set(c.top, `not fill-bound (${((gain - 1) * 100).toFixed(0)}% for ${((1 - 1 / ideal) * 100).toFixed(0)}% fewer px): restore, cap ${fps.toFixed(0)} fps`); return;
        }
        this.chain = { top: this.scale, fps };
      }
    }
    if (fps < T * 0.9) {
      this.good = 0;
      if (++this.bad >= 2 && this.scale > this.min + 1e-6) {
        const from = this.scale, flip = this.t - this.lastUp < 6;
        if (flip) { // the last up-probe was one step too far: back to the level before it, which becomes a ceiling for a while
          if (this._set(from - this.step, 'up-probe failed')) { this.ceil = this.scale; this.ceilUntil = this.t + this.backoff; this.backoff = Math.min(120, this.backoff * 2); this.chain = null; }
        } else if (this._set(from - this.step * (fps < T * 0.7 ? 2 : 1), 'slow')) { this.backoff = 20; if (!this.chain) this.chain = { top: from, fps }; }
      }
    } else if (fps >= T * 0.95) {
      this.bad = 0;
      const ceil = this.t < this.ceilUntil ? this.ceil : this.max;
      if (++this.good >= 4 && upOk && this.scale < ceil - 1e-6) { if (this._set(this.scale + this.step, 'headroom')) this.lastUp = this.t; }
    } else { this.bad = 0; this.good = 0; }
  }
}
