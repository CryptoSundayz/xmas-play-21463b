// DOM HUD: score, Gossip vs Optimum comparison, timer, minimap, power-up status.
import { CONFIG, formatEth, fmt } from './config.js?v=c331d8ef';
import { logoSVG } from './logo.js?v=c331d8ef';

const $ = id => document.getElementById(id);
// per-frame HUD text: only touch the DOM when the string changed (a same-value textContent write still replaces the
// text node and invalidates style / layout - measurable on Safari at 20-60 Hz)
const txt = (id, v) => { const e = $(id); if (!e) return; v = String(v); if (e._txt !== v) { e._txt = v; e.textContent = v; } };

export class HUD {
  constructor(world) {
    this.world = world;
    const B = CONFIG.branding;
    txt('scoreLabel', B.scoreLabel); txt('scoreUnit', B.scoreUnit);
    txt('scoreTarget', B.targetLabel);
    txt('gossipName', B.gossipLabel); txt('optimumName', B.optimumLabel);
    txt('gossipMs', `${Math.round(B.gossipMs)} ms`); txt('optimumMs', `${Math.round(B.optimumMs)} ms`);
    document.querySelector('#rowOptimum .bar i').style.width = (100 * B.optimumMs / B.gossipMs).toFixed(1) + '%';
    txt('mumpTag', B.mumpLabel);
    $('powerLogo').innerHTML = logoSVG({ width: 64, height: 38, stroke: 2.4, color: '#51B1FE' });
    this.mm = $('minimap'); this.ctx = this.mm.getContext('2d');
    this.mmRange = 95; // world units shown from center to edge
    this.displayScore = 0; this.toastT = 0;
    this.bg = this.renderMapBackground();
  }
  show(v) { $('hud').classList.toggle('hidden', !v); }

  renderMapBackground() {
    // Pre-render the whole village once, in world units (1 unit = k px), straight from the same data the 3D world
    // is built from: world.roads (the polylines the cobble ribbons are extruded from, at the real road width),
    // world.paths (door walkways), the square, the lake, world.buildings (position, rotation, footprint) and the forest.
    const WR = CONFIG.world, W = WR.radius + 10, k = 3, size = Math.ceil(W * 2 * k);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const P = (x, z) => [(x + W) * k, (z + W) * k];
    g.fillStyle = '#10213d'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#e6eef8'; g.globalAlpha = 0.14; g.beginPath(); g.arc(...P(0, 0), WR.radius * k, 0, 7); g.fill(); g.globalAlpha = 1;
    // forest ring
    g.fillStyle = '#0e3b2a'; for (const [tx, tz] of this.world.trees || []) { g.beginPath(); g.arc(...P(tx, tz), 1.6 * k, 0, 7); g.fill(); }
    // lake
    const L = this.world.lake; if (L) { g.fillStyle = '#5fa7d6'; g.beginPath(); g.ellipse(...P(L.cx, L.cz), L.rx * k, L.rz * k, 0, 0, 7); g.fill(); }
    // roads at their real width (+ a thin dark casing so junctions stay legible); no inflation, so houses sit
    // exactly where they stand next to the cobbles in the world
    const road = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const r of this.world.roads) { g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(...P(p.x, p.z)) : g.moveTo(...P(p.x, p.z))); if (r.closed) g.closePath(); g.stroke(); } };
    const rw = WR.roadWidth * k;
    road(rw + 1.4 * k, '#4f6684'); road(rw, '#eef5fd');
    g.fillStyle = '#4f6684'; g.beginPath(); g.arc(...P(0, 0), (WR.squareRadius + 0.7) * k, 0, 7); g.fill();
    g.fillStyle = '#eef5fd'; g.beginPath(); g.arc(...P(0, 0), WR.squareRadius * k, 0, 7); g.fill();
    g.fillStyle = '#2f8a3e'; g.beginPath(); g.arc(...P(0, 0), 5 * k, 0, 7); g.fill();
    // door walkways (real 1.6 m width, dimmer than streets so they read as paths, not extra roads)
    g.strokeStyle = 'rgba(214,228,245,.55)'; g.lineCap = 'butt';
    for (const q of this.world.paths || []) { g.lineWidth = (q.w || 1.6) * k; g.beginPath(); g.moveTo(...P(q.x0, q.z0)); g.lineTo(...P(q.x1, q.z1)); g.stroke(); }
    // houses (three.js rotation.y = theta  <=>  canvas rotate(-theta) with canvas y = world z)
    for (const b of this.world.buildings) {
      g.save(); g.translate(...P(b.x, b.z)); g.rotate(-b.rot);
      g.fillStyle = b.type === 'validatorHouse' ? '#6aa9d8' : '#8a6b52';
      g.fillRect(-b.footprint[0] / 2 * k, -b.footprint[1] / 2 * k, b.footprint[0] * k, b.footprint[1] * k);
      g.restore();
    }
    return { canvas: c, W, k };
  }

  setScore(v, target) { this.targetScore = v; }
  update(dt, s) {
    // score count-up
    this.displayScore += (s.score - this.displayScore) * Math.min(1, dt * 6);
    if (Math.abs(s.score - this.displayScore) < 1) this.displayScore = s.score;
    txt('scoreVal', this.displayScore >= 1e3 ? formatEth(this.displayScore) : Math.round(this.displayScore));
    txt('blocksLeft', `${s.delivered}/${s.total}`);
    // timer
    const t = Math.max(0, s.timer); const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    txt('timerVal', `${m}:${sec.toString().padStart(2, '0')}`);
    $('hudTimer').classList.toggle('low', t < 15);
    txt('levelName', `Stage ${s.level + 1} · ${s.levelName}`);
    txt('timerSub', s.bonusFlash > 0 ? `+${CONFIG.delivery.timerBonus}s block bonus` : '');
    // comparison
    $('rowGossip').classList.toggle('active', !s.mump);
    $('rowOptimum').classList.toggle('active', s.mump);
    $('hudCompare').classList.toggle('mump', s.mump);
    // power-up
    $('hudPower').classList.toggle('on', s.mump);
    // phones: the power-up card is a small top-centre toast that only peeks (3 s) when its message changes
    const pkey = s.mump ? 'on' : (s.powerupsLeft || 0) + '';
    if (pkey !== this._pkey) { this._pkey = pkey; this.peekT = 3; }
    this.peekT = Math.max(0, (this.peekT || 0) - dt); $('hudPower').classList.toggle('peek', this.peekT > 0);
    txt('powerState', s.mump ? `ACTIVE · ${s.mumpLeft.toFixed(1)}s · shards x${s.inRange}` : (s.powerupsLeft ? `${s.powerupsLeft} Optimum pickup${s.powerupsLeft > 1 ? 's' : ''} on the roads` : 'Next pickup respawning…'));
    $('powerBar').style.width = s.mump ? (100 * s.mumpLeft / s.mumpDur).toFixed(1) + '%' : '0%';
    $('stormWarn').classList.toggle('show', s.storm > 0.3);
    // toast
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    // hold hint
    const hh = $('holdHint');
    if (s.hint) { txt('holdHint', s.hint); hh.classList.add('show'); } else hh.classList.remove('show');
  }
  boost() {
    const X = CONFIG.boosted, el = $('boostCallout');
    el.querySelector('.bc-main').textContent = X.callout;
    el.querySelector('.bc-sub').textContent = fmt(X.calloutSub, { speed: CONFIG.powerup.speedFactor, optimumMs: Math.round(CONFIG.branding.optimumMs) });
    el.style.setProperty('--bd', X.calloutDuration + 's');
    $('toast').classList.remove('show'); this.toastT = 0;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  combo(n, mult, frac) {
    const X = CONFIG.boosted, el = $('combo');
    if (n < 2 || frac <= 0) { el.classList.remove('show'); this._comboN = 0; return; }
    if (n !== this._comboN) {
      el.querySelector('.cb-main').textContent = fmt(X.comboText, { n, mult: mult.toFixed(2).replace(/\.?0+$/, '') });
      el.querySelector('.cb-sub').textContent = fmt(X.comboSubText, { n, mult: mult.toFixed(2).replace(/\.?0+$/, '') });
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop', 'show'); this._comboN = n;
    }
    el.querySelector('.cb-bar i').style.width = (100 * frac).toFixed(1) + '%';
  }
  /** wind gust warning: arrow (screen-relative) showing where the gust will shove Santa */
  gust(G, camYaw, show) {
    const el = $('gust'); if (!el) return;
    const on = show && (G.warn || G.k > 0.05);
    if (on !== this._gustOn) { el.classList.toggle('show', !!on); this._gustOn = on; }
    if (!on) return;
    const th = camYaw - Math.PI, cx = G.x * Math.cos(th) - G.z * Math.sin(th), cy = G.x * Math.sin(th) + G.z * Math.cos(th);
    el.querySelector('i').style.transform = `rotate(${Math.atan2(cx, -cy).toFixed(3)}rad)`;
    el.classList.toggle('warn', !!G.warn);
  }
  status(s) {
    const el = $('hudStatus'); if (!el) return;
    const key = (s.lag ? 'L' : '') + (s.steal ? 'S' : '');
    if (key === this._stKey) return; this._stKey = key;
    el.innerHTML = (s.lag ? '<span class="lag">LAG +300 ms</span>' : '') + (s.steal ? '<span class="steal">⏱ time stolen!</span>' : '');
    el.classList.toggle('show', !!key);
  }
  toast(text, dur = 1.8) { const t = $('toast'); t.textContent = text; t.classList.add('show'); this.toastT = dur; }

  /** Redraws are throttled to CONFIG.hud.minimapHz (default 20 Hz; force=true always draws). */
  drawMinimap(s, force = false) {
    const now = performance.now(), hz = CONFIG.hud?.minimapHz ?? 20;
    if (!force && now - (this._mmT || 0) < 1000 / hz - 4) return false;
    this._mmT = now;
    // backing store = CSS size x devicePixelRatio (<= 2) so the map is sharp on Retina; all drawing below is in a
    // fixed 220-unit logical space (marker sizes unchanged)
    if (!this._mmSizeT || now - this._mmSizeT > 1000) {
      this._mmSizeT = now; const css = this.mm.clientWidth || 200, want = Math.max(120, Math.min(440, Math.round(css * Math.min(2, devicePixelRatio || 1))));
      if (Math.abs(this.mm.width - want) > 2) { this.mm.width = this.mm.height = want; }
    }
    const g = this.ctx, LS = 220, S = LS, half = S / 2, R = this.mmRange, sc = half / R;
    const { canvas, W, k } = this.bg;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.mm.width, this.mm.height);
    g.save(); g.scale(this.mm.width / LS, this.mm.height / LS); g.save();
    g.beginPath(); g.arc(half, half, half, 0, 7); g.clip();
    // rotate map so camera-forward is up
    g.translate(half, half); g.rotate(s.camYaw - Math.PI); // camera forward -> up
    const px = s.player.x, pz = s.player.z;
    // Whole pre-rendered village, placed by a plain transform (5-argument drawImage). The old 9-argument call cut a
    // 3R window around the player whose source rect ran past the bitmap edge whenever the player was > ~17 m off
    // centre; WebKit/Safari clips such a rect without moving the destination origin, so on Mac/iPhone the map slid
    // and scaled away from the real streets. No source rect -> identical on every browser.
    g.drawImage(canvas, (-W - px) * sc, (-W - pz) * sc, canvas.width / k * sc, canvas.height / k * sc);
    const toM = (x, z) => [(x - px) * sc, (z - pz) * sc];
    // area ring
    g.strokeStyle = 'rgba(143,220,255,.25)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
    g.beginPath(); g.arc(...toM(0, 0), s.areaRadius * sc, 0, 7); g.stroke(); g.setLineDash([]);
    if (s.mump) { g.strokeStyle = 'rgba(58,160,255,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, CONFIG.powerup.shardRadius * sc, 0, 7); g.stroke(); }
    if (s.areaMin > 22) { g.strokeStyle = 'rgba(143,220,255,.18)'; g.lineWidth = 1.5; g.setLineDash([2, 5]); g.beginPath(); g.arc(...toM(0, 0), s.areaMin * sc, 0, 7); g.stroke(); g.setLineDash([]); }
    // ice
    g.fillStyle = 'rgba(190,235,255,.55)'; for (const p of s.ice) { g.beginPath(); g.arc(...toM(p.x, p.z), p.r * sc, 0, 7); g.fill(); }
    // stage obstacles: fences (brown bar), road blocks (red/white bar), lag zones (purple), plows / grinches / boss (dots)
    for (const m of s.marks || []) {
      const [x, y] = toM(m.x, m.z); if (Math.hypot(x, y) > half + 12) continue;
      if (m.t === 'fence' || m.t === 'barrier') {
        const L = (m.t === 'fence' ? 5 : 6) * sc + 3, ux = m.nx * L, uy = m.nz * L;
        g.lineCap = 'round'; g.lineWidth = m.t === 'fence' ? 3 : 4.5; g.strokeStyle = m.t === 'fence' ? '#c98a4e' : '#ff3b3b';
        g.beginPath(); g.moveTo(x - ux, y - uy); g.lineTo(x + ux, y + uy); g.stroke();
        if (m.t === 'barrier') { g.lineWidth = 2; g.strokeStyle = '#fff'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x - ux, y - uy); g.lineTo(x + ux, y + uy); g.stroke(); g.setLineDash([]); }
        g.lineCap = 'butt';
      } else if (m.t === 'lag') { g.fillStyle = 'rgba(190,90,255,.33)'; g.beginPath(); g.arc(x, y, m.r * sc, 0, 7); g.fill(); }
      else { const c = m.t === 'plow' ? '#ffb020' : m.t === 'boss' ? '#ff2d6a' : '#54e04a', r = m.t === 'boss' ? 6.5 : 4;
        g.fillStyle = c; g.strokeStyle = '#111'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); }
    }
    // targets: undelivered pulse, delivered = green check; dotted path to the nearest open house
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180), NV = CONFIG.nav || {};
    let near = null, nd = 1e9;
    for (const t of s.targets) if (!t.delivered) { const d = Math.hypot(t.b.x - px, t.b.z - pz); if (d < nd) { nd = d; near = t; } }
    if (near && NV.mapPath !== false) {
      let [x, y] = toM(near.b.x, near.b.z); const d = Math.hypot(x, y), lim = half - 8; if (d > lim) { x *= lim / d; y *= lim / d; }
      g.strokeStyle = 'rgba(143,233,255,.85)'; g.lineWidth = 2; g.setLineDash([3, 4]); g.lineDashOffset = -performance.now() / 60;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
    }
    for (const t of s.targets) {
      let [x, y] = toM(t.b.x, t.b.z); const d = Math.hypot(x, y), lim = half - 8;
      const off = d > lim; if (off) { x *= lim / d; y *= lim / d; }
      if (t.delivered && NV.mapChecks !== false) {
        if (off) continue;
        g.fillStyle = '#1fbf6a'; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
        g.save(); g.translate(x, y); g.rotate(-(s.camYaw - Math.PI)); // keep the check upright
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(-2.6, 0.2); g.lineTo(-0.6, 2.3); g.lineTo(2.9, -2.2); g.stroke(); g.restore();
        continue;
      }
      const r = t.delivered ? 3.5 : (off ? 4.5 : 6) * (t === near ? 1 + 0.25 * pulse : 1);
      if (!t.delivered && !off) { g.fillStyle = t.slow ? `rgba(255,190,80,${0.25 * pulse})` : t.chimney ? `rgba(255,205,70,${0.25 * pulse})` : `rgba(63,182,255,${0.25 * pulse})`; g.beginPath(); g.arc(x, y, r + 4 + 3 * pulse, 0, 7); g.fill(); }
      g.fillStyle = t.delivered ? '#3dff9a' : (t.slow ? `rgba(255,190,80,${pulse})` : t.chimney ? `rgba(255,212,80,${pulse})` : `rgba(63,182,255,${pulse})`);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (!t.delivered && !off) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    }
    // power-ups
    for (const p of s.powerups) {
      if (!p.active) continue; let [x, y] = toM(p.x, p.z); const d = Math.hypot(x, y), lim = half - 8;
      if (d > lim) { x *= lim / d; y *= lim / d; }
      g.strokeStyle = '#3aa0ff'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 6, 3.5, 0, 0, 7); g.stroke();
    }
    g.restore();
    // player arrow (always pointing up relative to camera => rotate by heading-camYaw)
    g.save(); g.translate(half, half); g.rotate(-(s.heading - s.camYaw));
    g.fillStyle = '#ff4d5e'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(143,220,255,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(half, half, half - 1, 0, 7); g.stroke();
    g.restore();
    return true;
  }
}
