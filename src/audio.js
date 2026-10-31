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
// iOS: Web Audio follows the ring/silent switch ("ambient") unless the page is a media-playback session.
// Safari 17+: navigator.audioSession.type = 'playback'. Older iOS: a looping silent <audio> element (a tiny
// generated WAV, no codec issues) playing from a gesture moves the page into the playback category.
let silentEl = null;
function silentWav() {
  const n = 2205, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
export function unlockAudioGesture() { // call synchronously inside a click/touchend handler
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  try {
    if (!silentEl) { silentEl = document.createElement('audio'); silentEl.src = silentWav(); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.volume = 0.01; }
    const p = silentEl.play(); if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
  if (ctx) {
    if (ctx.state !== 'running') ctx.resume().catch?.(() => {});
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* ignore */ }
  }
}
export const AUDIO_REV = 'smooth-env-2'; // shows in __xmas.audio() so a stale cached audio.js is easy to spot
export function audioStatus() { return { rev: AUDIO_REV, ctx: ctx ? ctx.state : 'none', sampleRate: ctx?.sampleRate ?? null, baseLatency: ctx?.baseLatency ?? null, limiter: true, session: navigator.audioSession?.type || 'n/a', silentEl: silentEl ? !silentEl.paused : false, muted: st.muted }; }
// output chain: master -> glue compressor -> brick-wall limiter -> soft clip (ceiling ~-1.1 dBFS) -> out.
// Click hygiene (the ending "kritik-kritik", Daniel 2026-10-31): every voice starts from gain 0 (a GainNode's
// default 1.0 used to leak one full-scale noise sample before setValueAtTime at a fractional start time), rises
// on a LINEAR attack of >= 8 ms, decays, then ramps linearly to exactly 0 before stop(). No crackle/pop effects.
const CEIL = 0.88, MIN_ATTACK = 0.008, RELEASE = 0.025; let lastFw = -1;
function softClipCurve(n = 2048) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = CEIL * Math.tanh(x * 1.25) / Math.tanh(1.25); } return c; }
function buildGraph(c) {
  master = c.createGain(); master.gain.value = (cfg?.master ?? 0.9);
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  master.connect(comp);
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
  const clip = c.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = '2x';
  comp.connect(lim); lim.connect(clip); clip.connect(c.destination);
  musicBus = c.createGain(); sfxBus = c.createGain(); boostBus = c.createGain(); boostBus.gain.value = 0;
  musicBus.connect(master); sfxBus.connect(master); boostBus.connect(musicBus);
  // shared noise buffer + a soft feedback-delay "room" for the music
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const dl = c.createDelay(1), fb = c.createGain(), wet = c.createGain(), lp = c.createBiquadFilter();
  dl.delayTime.value = 0.23; fb.gain.value = 0.28; wet.gain.value = 0.22; lp.type = 'lowpass'; lp.frequency.value = 2600;
  musicBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
  // wind bed (looping band-passed noise, level follows the storm)
  const wn = c.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
  windFilt = c.createBiquadFilter(); windFilt.type = 'bandpass'; windFilt.frequency.value = 420; windFilt.Q.value = 0.7;
  windGain = c.createGain(); windGain.gain.value = 0; wn.connect(windFilt); windFilt.connect(windGain); windGain.connect(sfxBus); wn.start();
}
// SFX voice cap: past maxVoices concurrent SFX sources new ones are dropped (music is never dropped)
// (counted by scheduled end time, so it also works for sounds scheduled ahead and in an OfflineAudioContext)
let ends = [];
const voiceOK = (out, t0 = ctx.currentTime) => {
  if (out !== sfxBus) return true;
  if (ends.length > 64) ends = ends.filter(e => e > ctx.currentTime);
  let n = 0; for (const e of ends) if (e > t0) n++; return n < (cfg?.maxVoices ?? 40);
};
const track = (end, out) => { if (out === sfxBus) ends.push(end); };
export function initAudio(on = true) {
  if (on && typeof on === 'object') { configureAudio(on); on = on.enabled !== false; }
  enabled = !!on; if (!enabled) return;
  if (ctx) { unlockAudioGesture(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: cfg?.latencyHint ?? 'balanced' });
    buildGraph(ctx);
    applyVol();
    unlockAudioGesture();
    // iOS only counts touchend / click / pointerup as activation (not pointerdown / touchstart)
    const unlock = () => { if (ctx.state !== 'running' || (silentEl && silentEl.paused)) unlockAudioGesture(); };
    for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) addEventListener(ev, unlock, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx.state !== 'running') ctx.resume().catch?.(() => {}); });
    ctx.onstatechange = () => { if (ctx.state === 'interrupted') setTimeout(() => ctx.resume().catch?.(() => {}), 300); };
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
// One envelope for every voice: gain is 0 before t0 (GainNode defaults to 1.0!), linear attack >= MIN_ATTACK
// (an exponential ramp from 1e-4 does ~90% of its rise in the last ms, i.e. a click), exponential decay to -60 dB,
// then a linear ramp to exactly 0. Returns the time the voice is silent; stop() goes a little after that.
function env(g, t0, a, peak, dec) {
  const p = g.gain, ta = t0 + Math.max(a, MIN_ATTACK), td = ta + Math.max(dec, 0.02), end = td + RELEASE;
  p.value = 0; p.setValueAtTime(0, t0); p.linearRampToValueAtTime(peak, ta);
  p.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), td); p.linearRampToValueAtTime(0, end);
  return end;
}
function osc(type, f, t0, dur, vol, out, { a = 0.01, dec = dur, detune = 0, slide = 0, filter = 0 } = {}) {
  if (!voiceOK(out, t0)) return;
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  const end = env(g, t0, a, vol, dec) + 0.02;
  let n = o; if (filter) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filter; o.connect(lp); n = lp; }
  n.connect(g); g.connect(out); o.start(t0); o.stop(end); track(end, out);
}
function noise(t0, dur, vol, out, { type = 'highpass', f = 6000, q = 0.7, a = 0.01, f2 = 0 } = {}) {
  if (!voiceOK(out, t0)) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.setValueAtTime(f, t0); bq.Q.value = q; if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain(), end = env(g, t0, a, vol, dur) + 0.02;
  s.connect(bq); bq.connect(g); g.connect(out); s.start(t0, Math.random() * 1.5); s.stop(end); track(end, out);
}
const V = {
  // bell / music box: soft 8-12 ms mallet attack; the inharmonic partial is a sine (a triangle's odd harmonics put a tick at 3-4 kHz)
  bell(m, t, d, v, out) { const f = mtof(m); osc('sine', f, t, Math.max(0.6, d * 1.6), v, out, { a: 0.008 }); osc('sine', f * 2.76, t, 0.35, v * 0.2, out, { a: 0.012 }); osc('sine', f * 2, t, 0.5, v * 0.16, out, { a: 0.01 }); },
  musicBox(m, t, d, v, out) { const f = mtof(m); osc('sine', f, t, 1.4, v, out, { a: 0.008, dec: 1.4 }); osc('sine', f * 4, t, 0.25, v * 0.1, out, { a: 0.012 }); osc('sine', f * 3.01, t, 0.5, v * 0.08, out, { a: 0.012 }); },
  pianoish(m, t, d, v, out) { const f = mtof(m); osc('triangle', f, t, d * 0.9, v, out, { filter: 1800 }); osc('sine', f * 2, t, d * 0.5, v * 0.25, out); },
  bass(m, t, d, v, out) { osc('triangle', mtof(m), t, d * 0.85, v, out, { a: 0.012, filter: 1200 }); osc('sine', mtof(m) / 2, t, d * 0.8, v * 0.5, out, { a: 0.015 }); },
  pad(m, t, d, v, out) { for (const dt of [-7, 7]) osc('sawtooth', mtof(m), t, d, v, out, { a: 0.25, dec: d, detune: dt, filter: 900 }); },
  arp(m, t, d, v, out) { osc('square', mtof(m), t, d, v, out, { filter: 2600, dec: d * 0.9, a: 0.008 }); },
  // sleigh bells: a soft high noise shimmer only. The old 2.9-3.3 kHz sine "ting" on every half beat (5 ms
  // exponential attack) was a tonal 3 kHz tick, exactly the band the ear calls "kritik".
  sleigh(t, v, out) { noise(t, 0.08, v, out, { type: 'highpass', f: 7000, q: 0.6, a: 0.02 }); },
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
  ending: { bpm: 112, mel: WISH_END, ch: [43, 48, 53, 50, 43, 48, 53, 43, 48], loop: false, voice: 'bell', vol: 0.13, bassVol: 0.1, comp: 0.05, sleigh: 0.03, pad: 0.015 },
};
function schedule(until) {
  if (!cur || !ctx) return;
  const T = cur.T, spb = 60 / T.bpm, ahead = until ?? ctx.currentTime + 0.25;
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
  tick() { if (!ok()) return; tone(880, now(), 0.06, 'triangle', 0.05); },
  hold() { if (!ok()) return; tone(660, now(), 0.05, 'sine', 0.03); },
  jingle() { if (!ok()) return; const nn = [76, 76, 76, 0, 76, 76, 76, 0, 76, 79, 72, 74, 76]; const t = now(); nn.forEach((m, i) => m && V.bell(m, t + i * 0.15, 0.2, 0.12, sfxBus)); this.bells(0.6); },
  fail() { if (!ok()) return; const t = now(); tone(392, t, 0.3, 'triangle', 0.18); tone(330, t + 0.25, 0.3, 'triangle', 0.18); tone(262, t + 0.5, 0.6, 'triangle', 0.18); },
  boom() { this.firework(0.6); },
  // stage obstacles (all through osc()/noise(): >= 8 ms attack + release ramp)
  hit() { if (!ok()) return; const t = now(); noise(t, 0.22, 0.2, sfxBus, { type: 'lowpass', f: 900, q: 0.8, a: 0.008 }); osc('triangle', 220, t, 0.25, 0.16, sfxBus, { a: 0.008, slide: 110 }); },
  steal() { if (!ok()) return; const t = now(); [660, 523, 392].forEach((f, i) => osc('square', f, t + i * 0.08, 0.12, 0.05, sfxBus, { a: 0.01, filter: 2200 })); },
  honk() { if (!ok()) return; const t = now(); for (const f of [233, 294]) osc('sawtooth', f, t, 0.32, 0.045, sfxBus, { a: 0.015, filter: 1400 }); },
  gust(v = 1) { if (!ok()) return; noise(now(), 1.2 + v * 0.8, 0.12 * v, sfxBus, { type: 'bandpass', f: 300, f2: 1400, q: 0.9, a: 0.35 }); },
  slam() { if (!ok()) return; const t = now(); osc('sine', 90, t, 0.6, 0.3, sfxBus, { a: 0.008, slide: 38 }); noise(t, 0.5, 0.18, sfxBus, { type: 'lowpass', f: 500, q: 0.7, a: 0.01 }); },
  roar(v = 1) { if (!ok()) return; const t = now(); osc('sawtooth', 110, t, 0.9, 0.06 * v, sfxBus, { a: 0.08, slide: 70, filter: 700 }); noise(t, 0.8, 0.07 * v, sfxBus, { type: 'bandpass', f: 380, q: 1.4, a: 0.08 }); },
  // wardrobe: equip blip / locked thud (osc(): 10 ms attack + release ramp)
  equip() { if (!ok()) return; const t = now(); osc('triangle', 988, t, 0.09, 0.05, sfxBus, { a: 0.01 }); osc('sine', 1319, t + 0.05, 0.14, 0.04, sfxBus, { a: 0.01 }); },
  locked() { if (!ok()) return; const t = now(); osc('triangle', 196, t, 0.16, 0.07, sfxBus, { a: 0.01, filter: 900 }); },
  unlock() { if (!ok()) return; const t = now(); [72, 76, 79, 84].forEach((m, i) => V.bell(m, t + i * 0.09, 0.4, 0.09, sfxBus)); this.bells(0.4); },
  // fireworks: soft rising whoosh on launch, warm low boom on burst, and (solo bursts only) a faint slow-attack
  // two-note shimmer below 2 kHz. No crackle of any kind (no pre-rendered pop buffer, no noise-grain pops).
  firework(v = 1, delay = 0) {
    if (!ok()) return; const t = now() + delay, t0 = now();
    // overlapping launches (finale salvos): later ones in the same 150 ms are quieter and skip whoosh + shimmer
    const dense = t - lastFw < 0.15; lastFw = Math.max(lastFw, t);
    v *= (cfg?.fireworkGain ?? 0.6) * (dense ? 0.5 : 1);
    if (!dense && t - t0 > 0.3) { const ws = Math.max(t0, t - 0.85); noise(ws, Math.max(0.15, t - ws - 0.3), 0.05 * v, sfxBus, { type: 'bandpass', f: 300, f2: 1300, q: 0.8, a: Math.min(0.3, (t - ws) * 0.45) }); }
    noise(t, 0.9, 0.2 * v, sfxBus, { type: 'lowpass', f: 520, f2: 90, q: 0.5, a: 0.018 });
    osc('sine', 66, t, 0.75, 0.16 * v, sfxBus, { slide: 36, a: 0.015 });
    osc('sine', 132, t, 0.35, 0.05 * v, sfxBus, { slide: 70, a: 0.015 }); // body, so small speakers hear the boom
    if (!dense && (cfg?.fireworkShimmer ?? true)) { const r = 84 + [0, 2, 4, 7][Math.floor(Math.random() * 4)];
      osc('sine', mtof(r), t + 0.12, 0.9, 0.007 * v, sfxBus, { a: 0.04 }); osc('sine', mtof(r + 7), t + 0.2, 0.8, 0.005 * v, sfxBus, { a: 0.05 }); }
  },
  wind(k) { if (!ctx || !windGain) return; const t = ctx.currentTime; windGain.gain.setTargetAtTime(enabled ? (cfg?.windBase ?? 0.025) + k * (cfg?.windStorm ?? 0.22) : 0, t, 0.4); windFilt.frequency.setTargetAtTime(380 + k * 500 + Math.sin(t * 0.7) * 120, t, 0.3); },
};

// QA: render the ending (music + a dense firework show) into an OfflineAudioContext and measure it.
// The old legacyMode argument is ignored (the pre-limiter chain and its crackle were removed); opts.samples=true
// also returns channel 0 as a Float32Array for spectrograms / click detection.
export async function renderEndingOffline(sec = 20, _legacy = false, fwPerSec = 2.2, opts = {}) {
  const saved = { ctx, master, musicBus, sfxBus, boostBus, windGain, windFilt, noiseBuf, cur, enabled, lastFw, ends };
  const SR = 48000, oc = new OfflineAudioContext(2, SR * sec, SR);
  try {
    ends = []; lastFw = -1; enabled = true; ctx = oc; buildGraph(oc);
    musicBus.gain.value = st.music * 0.5; sfxBus.gain.value = st.sfx;
    cur = { name: 'ending', T: TRACKS.ending, i: 0, beat: 0, loopN: 0, next: 0.12 };
    let nodes = 0; for (const m of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter']) { const f = oc[m].bind(oc); oc[m] = (...a) => { nodes++; return f(...a); }; }
    schedule(sec); // the whole ending score up front (offline time only advances during rendering)
    const fws = []; for (let t = 0.5; t < sec - 1.5; t += (0.6 + Math.random() * 0.9) / fwPerSec) fws.push(t);
    for (let k = sec - 6; k < sec - 3; k += 0.08) fws.push(k); // finale salvo
    fws.sort((x, y) => x - y); const n0 = nodes;
    for (const t of fws) sfx.firework(0.45 + Math.random() * 0.55, t);
    const fwNodes = nodes - n0; // offline currentTime = 0 -> delay = absolute time
    const buf = await oc.startRendering();
    let peak = 0, clicks = 0, jumps = 0, clipped = 0; const thr = 0.25;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch);
      for (let i = 2; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++;
        if (Math.abs(d[i] - d[i - 1]) > 0.05) jumps++; // sample-to-sample jump (a click at these levels)
        // click = a sample-to-sample jump far above the local slope (2nd difference)
        if (Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]) > thr) clicks++; } }
    let rms = 0; { const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / d.length); }
    const res = { rev: AUDIO_REV, sec, sampleRate: SR, fireworks: fws.length, peak: +peak.toFixed(4), peakDbfs: +(20 * Math.log10(peak || 1e-9)).toFixed(2), rmsDbfs: +(20 * Math.log10(rms || 1e-9)).toFixed(2), clippedSamples: clipped, jumpsOver005: jumps, clicks2ndDiff: clicks, audioNodesPerFirework: +(fwNodes / fws.length).toFixed(1), maxSfxVoices: cfg?.maxVoices ?? 40 };
    if (opts.samples) res.samples = buf.getChannelData(0);
    return res;
  } finally { ({ ctx, master, musicBus, sfxBus, boostBus, windGain, windFilt, noiseBuf, cur, enabled, lastFw, ends } = saved); }
}
