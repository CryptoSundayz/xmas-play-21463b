// Tiny WebAudio synth (no audio files needed).
let ctx = null, master = null, enabled = true;
export function initAudio(on = true) {
  enabled = on; if (!on || ctx) return;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination); } catch (e) { ctx = null; }
}
function tone(freq, t0, dur, type = 'sine', vol = 0.3, slideTo = 0) {
  if (!ctx || !enabled) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
}
const now = () => ctx ? ctx.currentTime : 0;
export const sfx = {
  deliver() { const t = now(); tone(1318, t, 0.5, 'sine', 0.25); tone(1976, t + 0.06, 0.6, 'sine', 0.15); tone(2637, t + 0.12, 0.4, 'triangle', 0.08); },
  powerup() { const t = now(); tone(300, t, 0.5, 'sawtooth', 0.12, 1800); tone(600, t + 0.05, 0.6, 'sine', 0.2, 2400); },
  shard() { const t = now(); tone(1800 + Math.random() * 600, t, 0.18, 'sine', 0.06, 3200); },
  tick() { tone(880, now(), 0.06, 'square', 0.05); },
  hold() { tone(660, now(), 0.05, 'sine', 0.04); },
  jingle() { const n = [659, 659, 659, 0, 659, 659, 659, 0, 659, 784, 523, 587, 659]; const t = now(); n.forEach((f, i) => f && tone(f, t + i * 0.16, 0.25, 'triangle', 0.18)); },
  fail() { const t = now(); tone(392, t, 0.3, 'triangle', 0.2); tone(330, t + 0.25, 0.3, 'triangle', 0.2); tone(262, t + 0.5, 0.6, 'triangle', 0.2); },
  boom() { const t = now(); tone(120 + Math.random() * 80, t, 0.5, 'sawtooth', 0.06, 40); },
};
