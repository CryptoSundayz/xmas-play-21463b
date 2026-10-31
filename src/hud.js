// DOM HUD: score, Gossip vs Optimum comparison, timer, minimap, power-up status.
import { CONFIG, formatEth, fmt } from './config.js';
import { logoSVG } from './logo.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(world) {
    this.world = world;
    const B = CONFIG.branding;
    $('scoreLabel').textContent = B.scoreLabel; $('scoreUnit').textContent = B.scoreUnit;
    $('scoreTarget').textContent = B.targetLabel;
    $('gossipName').textContent = B.gossipLabel; $('optimumName').textContent = B.optimumLabel;
    $('gossipMs').textContent = `${Math.round(B.gossipMs)} ms`; $('optimumMs').textContent = `${Math.round(B.optimumMs)} ms`;
    document.querySelector('#rowOptimum .bar i').style.width = (100 * B.optimumMs / B.gossipMs).toFixed(1) + '%';
    $('mumpTag').textContent = B.mumpLabel;
    $('powerLogo').innerHTML = logoSVG({ width: 64, height: 38, stroke: 2.4, color: '#51B1FE' });
    this.mm = $('minimap'); this.ctx = this.mm.getContext('2d');
    this.mmRange = 95; // world units shown from center to edge
    this.displayScore = 0; this.toastT = 0;
    this.bg = this.renderMapBackground();
  }
  show(v) { $('hud').classList.toggle('hidden', !v); }

  renderMapBackground() {
    // pre-render whole world once (1px = 1 unit * k)
    const W = CONFIG.world.radius + 10, k = 3, size = W * 2 * k;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const P = (x, z) => [(x + W) * k, (z + W) * k];
    g.fillStyle = '#10213d'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#e6eef8'; g.globalAlpha = 0.14; g.beginPath(); g.arc(...P(0, 0), CONFIG.world.radius * k, 0, 7); g.fill(); g.globalAlpha = 1;
    // forest ring
    g.fillStyle = '#0e3b2a'; for (const [tx, tz] of this.world.trees || []) { g.beginPath(); g.arc(...P(tx, tz), 1.6 * k, 0, 7); g.fill(); }
    // lake
    const L = this.world.lake; if (L) { g.fillStyle = '#5fa7d6'; g.beginPath(); g.ellipse(...P(L.cx, L.cz), L.rx * k, L.rz * k, 0, 0, 7); g.fill(); }
    // roads: straight from world.roads (the same polylines the road ribbons are built from), drawn wider than
    // life and snow-coloured so they read at 100 px; a dark casing keeps junctions legible. Door walkways
    // (world.paths) are no longer drawn - at minimap scale they looked like extra streets that don't exist.
    const road = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const r of this.world.roads) { g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(...P(p.x, p.z)) : g.moveTo(...P(p.x, p.z))); if (r.closed) g.closePath(); g.stroke(); } };
    const rw = CONFIG.world.roadWidth * 1.3 * k;
    road(rw + 1.6 * k, '#4f6684'); road(rw, '#eef5fd');
    g.fillStyle = '#4f6684'; g.beginPath(); g.arc(...P(0, 0), (CONFIG.world.squareRadius + 1) * k, 0, 7); g.fill();
    g.fillStyle = '#eef5fd'; g.beginPath(); g.arc(...P(0, 0), CONFIG.world.squareRadius * k, 0, 7); g.fill();
    g.fillStyle = '#2f8a3e'; g.beginPath(); g.arc(...P(0, 0), 5 * k, 0, 7); g.fill();
    // houses
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
    $('scoreVal').textContent = this.displayScore >= 1e3 ? formatEth(this.displayScore) : Math.round(this.displayScore);
    $('blocksLeft').textContent = `${s.delivered}/${s.total}`;
    // timer
    const t = Math.max(0, s.timer); const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    $('timerVal').textContent = `${m}:${sec.toString().padStart(2, '0')}`;
    $('hudTimer').classList.toggle('low', t < 15);
    $('levelName').textContent = `Level ${s.level + 1} · ${s.levelName}`;
    $('timerSub').textContent = s.bonusFlash > 0 ? `+${CONFIG.delivery.timerBonus}s block bonus` : '';
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
    $('powerState').textContent = s.mump ? `ACTIVE · ${s.mumpLeft.toFixed(1)}s · shards x${s.inRange}` : (s.powerupsLeft ? `${s.powerupsLeft} Optimum pickup${s.powerupsLeft > 1 ? 's' : ''} on the roads` : 'Next pickup respawning…');
    $('powerBar').style.width = s.mump ? (100 * s.mumpLeft / s.mumpDur).toFixed(1) + '%' : '0%';
    $('stormWarn').classList.toggle('show', s.storm > 0.3);
    // toast
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    // hold hint
    const hh = $('holdHint');
    if (s.hint) { hh.textContent = s.hint; hh.classList.add('show'); } else hh.classList.remove('show');
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
  toast(text, dur = 1.8) { const t = $('toast'); t.textContent = text; t.classList.add('show'); this.toastT = dur; }

  drawMinimap(s) {
    const g = this.ctx, S = this.mm.width, half = S / 2, R = this.mmRange, sc = half / R;
    const { canvas, W, k } = this.bg;
    g.save(); g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(half, half, half, 0, 7); g.clip();
    // rotate map so camera-forward is up
    g.translate(half, half); g.rotate(s.camYaw - Math.PI); // camera forward -> up
    const px = s.player.x, pz = s.player.z;
    g.drawImage(canvas, (px + W) * k - R * k * 1.5, (pz + W) * k - R * k * 1.5, R * k * 3, R * k * 3, -R * sc * 1.5, -R * sc * 1.5, R * sc * 3, R * sc * 3);
    const toM = (x, z) => [(x - px) * sc, (z - pz) * sc];
    // area ring
    g.strokeStyle = 'rgba(143,220,255,.25)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
    g.beginPath(); g.arc(...toM(0, 0), s.areaRadius * sc, 0, 7); g.stroke(); g.setLineDash([]);
    if (s.mump) { g.strokeStyle = 'rgba(58,160,255,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, CONFIG.powerup.shardRadius * sc, 0, 7); g.stroke(); }
    // ice
    g.fillStyle = 'rgba(190,235,255,.55)'; for (const p of s.ice) { g.beginPath(); g.arc(...toM(p.x, p.z), p.r * sc, 0, 7); g.fill(); }
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
      if (!t.delivered && !off) { g.fillStyle = t.slow ? `rgba(255,190,80,${0.25 * pulse})` : `rgba(63,182,255,${0.25 * pulse})`; g.beginPath(); g.arc(x, y, r + 4 + 3 * pulse, 0, 7); g.fill(); }
      g.fillStyle = t.delivered ? '#3dff9a' : (t.slow ? `rgba(255,190,80,${pulse})` : `rgba(63,182,255,${pulse})`);
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
    g.fillStyle = 'rgba(233,242,255,.8)'; g.font = 'bold 11px system-ui'; g.textAlign = 'center';
  }
}
