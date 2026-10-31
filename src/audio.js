// Self-synthesised Christmas music + SFX (WebAudio, no audio files, nothing to license).
// Melodies are public-domain carols (Jingle Bells — J. Pierpont 1857; Deck the Halls — trad. Welsh;
// We Wish You a Merry Christmas — trad. English); arrangements/synthesis are original code. See assets/audio/CREDITS.md.
// Tracks: title (music-box Deck the Halls), gameplay loop (Jingle Bells w/ bass, comp, sleigh bells),
// BOOSTED layer (arpeggiator + bright bells, crossfaded in while mump2p is active), ending jingle.
// SFX: footsteps (snow crunch), sleigh bells, pickup, delivery chime, whoosh, wind (follows storm), fireworks.
// AudioContext is created lazily on the first user gesture; volumes in CONFIG.audio, persisted in localStorage.
const LS = 'xmas.audio.v1';
let ctx = null, master, musicBus, sfxBus, boostBus, windGain, windFilt, noiseBuf, enabled = true, cfg = null;
const st = { music: 0.55, sfx: 0.8, muted: false };
try { Object.assign(st, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* private mode */ }
const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* ignore */ } };
const listeners = new Set();
const notify = () => listeners.forEach(f => f(st));

export function configureAudio(c) { // CONFIG.audio = true | false | { enabled, music, sfx, master }
  cfg = typeof c === 'object' && c ? c : { enabled: c !== false };
  if (localStorage.getItem(LS) == null) { if (cfg.music != null) st.music = cfg.music; if (cfg.sfx != null) st.sfx = cfg.sfx; }
}
export function initAudio(on = true) {
  if (on && typeof on === 'object') { configureAudio(on); on = on.enabled !== false; }
  enabled = !!on; if (!enabled) return;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = (cfg?.master ?? 0.9);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); sfxBus = ctx.createGain(); boostBus = ctx.createGain(); boostBus.gain.value = 0;
    musicBus.connect(master); sfxBus.connect(master); boostBus.connect(musicBus);
    // shared noise buffer + a soft feedback-delay "room" for the music
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.23; fb.gain.value = 0.28; wet.gain.value = 0.22; lp.type = 'lowpass'; lp.frequency.value = 2600;
    musicBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
    // wind bed (looping band-passed noise, level follows the storm)
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    windFilt = ctx.createBiquadFilter(); windFilt.type = 'bandpass'; windFilt.frequency.value = 420; windFilt.Q.value = 0.7;
    windGain = ctx.createGain(); windGain.gain.value = 0; wn.connect(windFilt); windFilt.connect(windGain); windGain.connect(sfxBus); wn.start();
    applyVol();
    const unlock = () => { if (ctx.state === 'suspended') ctx.resume(); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('touchend', unlock);
    if (pendingTrack) { const p = pendingTrack; pendingTrack = null; music.play(p); }
  } catch (e) { ctx = null; }
}
function applyVol() {
  if (!ctx) return; const t = ctx.currentTime;
  musicBus.gain.setTargetAtTime(st.muted ? 0 : st.music * 0.5, t, 0.05);
  sfxBus.gain.setTargetAtTime(st.muted ? 0 : st.sfx, t, 0.05);
}
export const audioState = {
  get: () => ({ ...st }),
  setMusic(v) { st.music = +v; save(); applyVol(); notify(); },
  setSfx(v) { st.sfx = +v; save(); applyVol(); notify(); },
  setMuted(m) { st.muted = !!m; save(); applyVol(); notify(); },
  toggleMute() { this.setMuted(!st.muted); return st.muted; },
  onChange(f) { listeners.add(f); f(st); },
  get running() { return !!ctx && enabled; },
};

// ---------------------------------------------------------------- voices
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function env(g, t0, a, peak, dec, sus = 0.0001, rel = 0) {
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t0 + a + dec);
  if (rel) g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec + rel);
}
function osc(type, f, t0, dur, vol, out, { a = 0.005, dec = dur, detune = 0, slide = 0, filter = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  env(g, t0, a, vol, dec);
  let n = o; if (filter) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filter; o.connect(lp); n = lp; }
  n.connect(g); g.connect(out); o.start(t0); o.stop(t0 + a + dec + 0.05);
}
function noise(t0, dur, vol, out, { type = 'highpass', f = 6000, q = 0.7, a = 0.002, f2 = 0 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.setValueAtTime(f, t0); bq.Q.value = q; if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain(); env(g, t0, a, vol, dur);
  s.connect(bq); bq.connect(g); g.connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + a + dur + 0.05);
}
const V = {
  bell(m, t, d, v, out) { const f = mtof(m); osc('sine', f, t, Math.max(0.6, d * 1.6), v, out); osc('sine', f * 2.76, t, 0.35, v * 0.25, out); osc('triangle', f * 2, t, 0.5, v * 0.18, out); },
  musicBox(m, t, d, v, out) { const f = mtof(m); osc('sine', f, t, 1.4, v, out, { dec: 1.4 }); osc('sine', f * 4, t, 0.25, v * 0.12, out); osc('sine', f * 3.01, t, 0.5, v * 0.08, out); },
  pianoish(m, t, d, v, out) { const f = mtof(m); osc('triangle', f, t, d * 0.9, v, out, { filter: 1800 }); osc('sine', f * 2, t, d * 0.5, v * 0.25, out); },
  bass(m, t, d, v, out) { osc('triangle', mtof(m), t, d * 0.85, v, out, { a: 0.01 }); osc('sine', mtof(m) / 2, t, d * 0.8, v * 0.5, out); },
  pad(m, t, d, v, out) { for (const dt of [-7, 7]) osc('sawtooth', mtof(m), t, d, v, out, { a: 0.25, dec: d, detune: dt, filter: 900 }); },
  arp(m, t, d, v, out) { osc('square', mtof(m), t, d, v, out, { filter: 2600, dec: d * 0.9 }); },
  sleigh(t, v, out) { noise(t, 0.09, v, out, { f: 7500 }); osc('sine', 2900 + Math.random() * 400, t, 0.12, v * 0.25, out); },
};

// ---------------------------------------------------------------- scores (public-domain melodies)
const n = (s) => s.trim().split(/\s+/).map(x => { const [m, d] = x.split(':'); return [m === 'r' ? 0 : +m, +d]; });
const JINGLE = n(`64:1 64:1 64:2  64:1 64:1 64:2  64:1 67:1 60:1.5 62:.5  64:4  65:1 65:1 65:1.5 65:.5  65:1 64:1 64:1 64:.5 64:.5  64:1 62:1 62:1 64:1  62:2 67:2
  64:1 64:1 64:2  64:1 64:1 64:2  64:1 67:1 60:1.5 62:.5  64:4  65:1 65:1 65:1.5 65:.5  65:1 64:1 64:1 64:.5 64:.5  67:1 67:1 65:1 62:1  60:4`);
const JINGLE_CH = [48, 48, 48, 48, 53, 48, 50, 43, 48, 48, 48, 48, 53, 48, 43, 48]; // bar roots (C C C C F C D G | ... G C)
const DECK_A = n(`67:1.5 65:.5 64:1 62:1  60:1 62:1 64:1 60:1  62:.5 64:.5 65:.5 62:.5 64:1.5 62:.5  60:1 59:1 60:2`);
const DECK_B = n(`62:1.5 64:.5 65:1 62:1  64:1.5 65:.5 67:1 62:1  64:.5 66:.5 67:1 69:.5 71:.5 72:1  71:1 69:1 67:2`);
const DECK = [...DECK_A, ...DECK_A, ...DECK_B, ...DECK_A], DECK_CH = [48, 48, 43, 48, 48, 48, 43, 48, 43, 48, 50, 43, 48, 48, 43, 48];
const WISH_END = n(`67:1 72:1 72:.5 74:.5 72:.5 71:.5  69:1 69:1 69:1  74:1 74:.5 76:.5 74:.5 72:.5  71:1 67:1 67:1  64:1 64:1 65:1 64:1 62:1  60:1 67:.5 67:.5 69:1 74:1  71:1 72:3`);
const triad = r => [r, r + (r % 12 === 2 ? 3 : 4), r + 7]; // D -> minor-ish colour, others major

// ---------------------------------------------------------------- sequencer
let cur = null, pendingTrack = null, boostOn = false, schedTimer = 0;
const TRACKS = {
  title: { bpm: 84, mel: DECK, ch: DECK_CH, loop: true, voice: 'musicBox', vol: 0.16, bassVol: 0.0, pad: 0.018 },
  game: { bpm: 132, mel: JINGLE, ch: JINGLE_CH, loop: true, voice: 'bell', vol: 0.11, bassVol: 0.12, comp: 0.05, sleigh: 0.05 },
  ending: { bpm: 112, mel: WISH_END, ch: [43, 48, 53, 50, 43, 48, 53, 43, 48], loop: false, voice: 'bell', vol: 0.13, bassVol: 0.1, comp: 0.05, sleigh: 0.04, pad: 0.015 },
};
function schedule() {
  if (!cur || !ctx) return;
  const T = cur.T, spb = 60 / T.bpm, ahead = ctx.currentTime + 0.25;
  while (cur.next < ahead) {
    if (cur.i >= T.mel.length) { if (!T.loop) { cur = null; return; } cur.i = 0; cur.beat = 0; cur.loopN++; }
    const [m, d] = T.mel[cur.i], t = cur.next;
    const out = musicBus, oct = T.voice === 'bell' && cur.loopN % 2 ? 12 : 0;
    if (m) V[T.voice](m + oct, t, d * spb, T.vol * (oct ? 0.7 : 1), out);
    // per-beat accompaniment
    const b0 = Math.ceil(cur.beat - 1e-6), b1 = cur.beat + d;
    for (let b = b0; b < b1 - 1e-6; b++) {
      const tb = t + (b - cur.beat) * spb, bar = Math.floor(b / 4) % T.ch.length, r = T.ch[bar], inBar = b % 4;
      if (T.bassVol) V.bass(inBar % 2 ? r + 7 - 12 : r - 12 + 12 * (inBar === 0 ? 0 : 0), tb, spb, T.bassVol, out);
      if (T.comp && inBar % 2 === 1) for (const x of triad(r + 12)) V.pianoish(x, tb, spb * 0.5, T.comp, out);
      if (T.pad && inBar === 0) for (const x of triad(r + 12)) V.pad(x, tb, spb * 4, T.pad, out);
      if (T.sleigh) { V.sleigh(tb, T.sleigh * (inBar % 2 ? 1 : 0.6), out); V.sleigh(tb + spb / 2, T.sleigh * 0.45, out); }
      if (boostOn && cur.name === 'game') { // BOOSTED layer: 16th-note arpeggio + high bells
        const ar = triad(r + 24); for (let k = 0; k < 4; k++) V.arp(ar[(b * 4 + k) % 3] + (k === 3 ? 12 : 0), tb + k * spb / 4, spb / 4, 0.03, boostBus);
        if (inBar === 0) V.bell(r + 36, tb, spb, 0.05, boostBus);
      }
    }
    cur.beat = b1; cur.next += d * spb; cur.i++;
  }
}
export const music = {
  play(name) {
    if (!ctx || !enabled) { pendingTrack = name; return; }
    if (cur?.name === name && TRACKS[name].loop) return;
    const T = TRACKS[name]; if (!T) return;
    cur = { name, T, i: 0, beat: 0, loopN: 0, next: ctx.currentTime + 0.12 };
    if (!schedTimer) schedTimer = setInterval(schedule, 60);
  },
  stop() { cur = null; pendingTrack = null; },
  setBoost(on) {
    if (on === boostOn) return; boostOn = on; if (!ctx) return;
    boostBus.gain.setTargetAtTime(on ? (cfg?.boostLayer ?? 1) : 0, ctx.currentTime, on ? 0.15 : 0.6);
  },
  get current() { return cur?.name || null; },
};

// ---------------------------------------------------------------- SFX
const now = () => ctx ? ctx.currentTime : 0;
const ok = () => ctx && enabled;
const tone = (f, t, d, type, v, slide = 0) => osc(type, f, t, d, v, sfxBus, { slide });
let lastStep = 0;
export const sfx = {
  deliver() { if (!ok()) return; const t = now(); tone(1318, t, 0.5, 'sine', 0.22); tone(1976, t + 0.06, 0.6, 'sine', 0.14); tone(2637, t + 0.12, 0.5, 'triangle', 0.07); this.bells(0.5); },
  chime() { if (!ok()) return; const t = now(); [1047, 1319, 1568, 2093].forEach((f, i) => V.bell(84 + [0, 4, 7, 12][i], t + i * 0.07, 0.4, 0.07, sfxBus)); },
  powerup() { if (!ok()) return; const t = now(); tone(300, t, 0.5, 'sawtooth', 0.08, 1800); tone(600, t + 0.05, 0.6, 'sine', 0.16, 2400); this.whoosh(1.2); this.chime(); },
  pickup() { this.powerup(); },
  whoosh(len = 0.7, v = 0.25) { if (!ok()) return; noise(now(), len, v, sfxBus, { type: 'bandpass', f: 400, f2: 3200, q: 1.2, a: len * 0.35 }); },
  bells(v = 1) { if (!ok()) return; const t = now(); for (let i = 0; i < 7; i++) V.sleigh(t + i * 0.055 + Math.random() * 0.02, 0.07 * v, sfxBus); },
  step(k = 0.5, surface = 'snow') { // snow crunch: short low band-passed noise burst (+ squeak)
    if (!ok()) return; const t = now(); if (t - lastStep < 0.12) return; lastStep = t;
    const v = (cfg?.footsteps ?? 0.5) * (0.35 + k * 0.4);
    if (surface === 'snow') { noise(t, 0.09, v * 0.5, sfxBus, { type: 'bandpass', f: 900 + Math.random() * 500, q: 0.9 }); noise(t + 0.02, 0.06, v * 0.25, sfxBus, { type: 'highpass', f: 3500 }); }
    else noise(t, 0.05, v * 0.35, sfxBus, { type: 'bandpass', f: 1800, q: 2 });
  },
  jump() { if (!ok()) return; this.whoosh(0.35, 0.12); },
  land() { this.step(1); },
  shard() { if (!ok()) return; const t = now(); tone(1800 + Math.random() * 600, t, 0.18, 'sine', 0.05, 3200); },
  tick() { if (!ok()) return; tone(880, now(), 0.06, 'square', 0.04); },
  hold() { if (!ok()) return; tone(660, now(), 0.05, 'sine', 0.03); },
  jingle() { if (!ok()) return; const nn = [76, 76, 76, 0, 76, 76, 76, 0, 76, 79, 72, 74, 76]; const t = now(); nn.forEach((m, i) => m && V.bell(m, t + i * 0.15, 0.2, 0.12, sfxBus)); this.bells(0.6); },
  fail() { if (!ok()) return; const t = now(); tone(392, t, 0.3, 'triangle', 0.18); tone(330, t + 0.25, 0.3, 'triangle', 0.18); tone(262, t + 0.5, 0.6, 'triangle', 0.18); },
  boom() { this.firework(0.6); },
  firework(v = 1, delay = 0) { // whistle up, then boom + crackle
    if (!ok()) return; const t = now() + delay;
    osc('sine', 900, t - 0.9 < now() ? now() : t - 0.9, 0.8, 0.02 * v, sfxBus, { slide: 2400 });
    noise(t, 0.8, 0.22 * v, sfxBus, { type: 'lowpass', f: 900, f2: 120, a: 0.004 });
    osc('sine', 70, t, 0.6, 0.18 * v, sfxBus, { slide: 35 });
    for (let i = 0; i < 14; i++) noise(t + 0.25 + Math.random() * 0.9, 0.03, 0.05 * v, sfxBus, { f: 5000 });
  },
  wind(k) { if (!ctx || !windGain) return; const t = ctx.currentTime; windGain.gain.setTargetAtTime(enabled ? (cfg?.windBase ?? 0.025) + k * (cfg?.windStorm ?? 0.22) : 0, t, 0.4); windFilt.frequency.setTargetAtTime(380 + k * 500 + Math.sin(t * 0.7) * 120, t, 0.3); },
};
