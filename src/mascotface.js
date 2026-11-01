// Expression face for the Optimum mascot. The goggle/mask IS the official Optimum dark icon
// (assets/brand/optimum-icon-black.svg): mascot.js builds it as a raised glossy black 3D mesh conformed to the head,
// and this canvas (projected underneath as a DecalGeometry) paints:
//   - face colour over the baked (approximate) Tripo band and mouth,
//   - the same icon in black (backing, exact path), its hollow centre in white = the eye openings,
//   - expressive eyes INSIDE the openings (clipped to the official hole, so the outline never deforms),
//   - the mouth below.
// Every expression is a set of numbers, so changes blend smoothly and blinking is just eye openness.
import * as THREE from 'three';
import { ICON_BLACK_D } from './logo.js?v=77728b1a';

// eye (SVG units of the 900x492 icon): w,h = scale of the dark eye oval · tilt (rad, + = outer corner up)
//      brow = top edge cut, sloping down toward the nose (determined/cross) · squint = cheek pushed up from below (happy ^ ^)
//      dy = vertical offset (look up/down)
// mouth: w = half width (fraction of canvas width) · lift = corner lift · open = opening · wave = wobble · asym = smirk
export const FACES = {
  neutral:    { eyeL: { w: 1.0, h: 1.0, tilt: 0, brow: 0, squint: 0, dy: 0 }, eyeR: { w: 1.0, h: 1.0, tilt: 0, brow: 0, squint: 0, dy: 0 }, mouth: { w: 0.075, lift: 0.018, open: 0, wave: 0, asym: 0 } },
  happy:      { eyeL: { w: 1.3, h: 1.05, tilt: 0.0, brow: 0, squint: 0.72, dy: 4 }, eyeR: { w: 1.3, h: 1.05, tilt: 0.0, brow: 0, squint: 0.72, dy: 4 }, mouth: { w: 0.11, lift: 0.045, open: 0.07, wave: 0, asym: 0 } },
  confused:   { eyeL: { w: 0.8, h: 0.62, tilt: -0.15, brow: 0.45, squint: 0, dy: 8 }, eyeR: { w: 1.08, h: 1.15, tilt: 0.12, brow: 0, squint: 0, dy: -10 }, mouth: { w: 0.07, lift: -0.008, open: 0.004, wave: 0.012, asym: 0.012 } },
  surprised:  { eyeL: { w: 1.15, h: 1.35, tilt: 0, brow: 0, squint: 0, dy: -8 }, eyeR: { w: 1.15, h: 1.35, tilt: 0, brow: 0, squint: 0, dy: -8 }, mouth: { w: 0.035, lift: -0.01, open: 0.06, wave: 0, asym: 0 } },
  determined: { eyeL: { w: 1.12, h: 0.95, tilt: 0, brow: 0.75, squint: 0.25, dy: 4 }, eyeR: { w: 1.12, h: 0.95, tilt: 0, brow: 0.75, squint: 0.25, dy: 4 }, mouth: { w: 0.09, lift: 0.03, open: 0.03, wave: 0, asym: 0.014 } },
};
export const FACE_NAMES = Object.keys(FACES);

// official icon: centres of the two lobes of the hollow centre (SVG units)
const LOBES = [[275, 246], [626, 246]];
const ICON_PATH = typeof Path2D !== 'undefined' ? new Path2D(ICON_BLACK_D) : null;
// the hollow centre alone: the second sub-path of the official path data
const HOLE_D = 'M' + ICON_BLACK_D.split('ZM')[1];
const HOLE_PATH = typeof Path2D !== 'undefined' ? new Path2D(HOLE_D.endsWith('Z') ? HOLE_D : HOLE_D + 'Z') : null;

const lerp = (a, b, t) => a + (b - a) * t;
function mix(a, b, t) {
  if (typeof a === 'number') return lerp(a, b, t);
  const o = {}; for (const k in a) o[k] = mix(a[k], b[k], t); return o;
}

export class MascotFace {
  /** logo: {ox, oy, s} maps icon SVG units to canvas pixels (u = ox + x*s, v = oy + y*s); mouthY: canvas fraction */
  constructor({ aspect = 1, faceWhite = [166, 163, 172], res = 1024, logo, mouthY = 0.66 } = {}) {
    this.W = res; this.H = Math.round(res * aspect);
    this.canvas = document.createElement('canvas'); this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    this.white = `rgb(${faceWhite.join(',')})`; this.white0 = `rgba(${faceWhite.join(',')},0)`;
    this.logo = logo || { s: this.W * 0.7 / 900, ox: this.W * 0.15, oy: this.H * 0.2 };
    this.mouthY = mouthY;
    this.cur = JSON.parse(JSON.stringify(FACES.neutral)); this.target = 'neutral'; this.name = 'neutral';
    this.blink = 0; this.blinkT = 2.5; this.blinkPh = -1; this.dirty = true; this.mix = 1;
    this.blinkEvery = [2.2, 5.0];
    this.lens = null; // goggle lens tint {tint, sheen, rim} or null (default Optimum: clear)
    this.draw();
  }
  setLens(l) { const k = l ? l.tint + l.sheen + l.rim : ''; if (k === this.lensKey) return; this.lensKey = k; this.lens = l || null; this.dirty = true; this.draw(); this.dirty = false; }
  set(name) { if (!FACES[name] || name === this.target) return; this.target = name; this.mix = 0; }
  update(dt) {
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt * 7);
      this.cur = mix(this.cur, FACES[this.target], Math.min(1, dt * 14 + (this.mix >= 1 ? 1 : 0)));
      if (this.mix >= 1) { this.cur = JSON.parse(JSON.stringify(FACES[this.target])); this.name = this.target; }
      this.dirty = true;
    }
    // auto blink (closing 70 ms, opening 110 ms); double blink now and then
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkPh < 0) { this.blinkPh = 0; this.blinkT = lerp(this.blinkEvery[0], this.blinkEvery[1], Math.random()); if (Math.random() < 0.15) this.blinkT = 0.32; }
    if (this.blinkPh >= 0) {
      this.blinkPh += dt; const p = this.blinkPh;
      this.blink = p < 0.07 ? p / 0.07 : Math.max(0, 1 - (p - 0.07) / 0.11);
      if (p > 0.18) { this.blinkPh = -1; this.blink = 0; }
      this.dirty = true;
    }
    if (this.dirty) { this.draw(); this.dirty = false; }
  }
  draw() {
    const { ctx, W, H } = this, f = this.cur, L = this.logo;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // opaque face colour over the baked band + mouth (elliptical, feathered to transparent at the decal edge)
    ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.scale(W / H, 1);
    const g = ctx.createRadialGradient(0, 0, H * 0.2, 0, 0, H * 0.5);
    g.addColorStop(0, this.white); g.addColorStop(0.8, this.white); g.addColorStop(1, this.white0);
    ctx.fillStyle = g; ctx.fillRect(-H, -H, 2 * H, 2 * H); ctx.restore();
    // --- official icon in icon space ---
    ctx.save(); ctx.setTransform(L.s, 0, 0, L.s, L.ox, L.oy);
    if (ICON_PATH) { ctx.fillStyle = '#060608'; ctx.fill(ICON_PATH, 'evenodd'); }
    if (HOLE_PATH) {
      ctx.fillStyle = '#f7f8fc'; ctx.fill(HOLE_PATH);
      ctx.save(); ctx.clip(HOLE_PATH);
      const open = 1 - this.blink;
      for (const [side, e, [lx, ly]] of [[-1, f.eyeL, LOBES[0]], [1, f.eyeR, LOBES[1]]]) {
        const ew = 60 * e.w, eh = Math.max(5, 100 * e.h * open), ex = lx + side * 6, ey = ly + e.dy;
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(-side * e.tilt);
        ctx.fillStyle = '#0b1026';
        ctx.beginPath(); ctx.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2); ctx.fill();
        if (open > 0.45 && e.squint < 0.6) { // catch-lights
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-ew * 0.32, -eh * 0.42, ew * 0.26, ew * 0.3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(ew * 0.3, eh * 0.35, ew * 0.11, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#f7f8fc';
        if (e.squint > 0.01) { // cheek rises from below -> ^ ^
          ctx.beginPath(); ctx.ellipse(0, eh * (2.15 - e.squint * 1.55), ew * 1.9, eh * 1.45, 0, 0, Math.PI * 2); ctx.fill();
        }
        if (e.brow > 0.01) { // lid cut sloping down toward the nose (inner side = -side)
          const yo = -eh * 1.05 + e.brow * eh * 0.15, yi = -eh * 1.05 + e.brow * eh * 1.25;
          ctx.beginPath(); ctx.moveTo(side * ew * 1.6, yo); ctx.lineTo(-side * ew * 1.6, yi); ctx.lineTo(-side * ew * 1.6, -eh * 3); ctx.lineTo(side * ew * 1.6, -eh * 3); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      const Ln = this.lens;
      if (Ln) { // tinted lens over the eyes: colour wash, diagonal sheen, coloured inner rim
        ctx.fillStyle = Ln.tint; ctx.fillRect(0, 0, 900, 520);
        const sg = ctx.createLinearGradient(117, 90, 560, 402);
        sg.addColorStop(0, Ln.sheen); sg.addColorStop(0.22, Ln.sheen); sg.addColorStop(0.4, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, 900, 520);
        ctx.strokeStyle = Ln.rim; ctx.lineWidth = 34; ctx.stroke(HOLE_PATH);
      }
      ctx.restore();
    }
    ctx.restore();
    // --- mouth ---
    const cx = W / 2, m = f.mouth, mw = W * m.w, my = H * this.mouthY, P = 40;
    const up = [], lo = [];
    for (let i = 0; i <= P; i++) {
      const t = i / P * 2 - 1, x = cx + t * mw;
      const base = my - m.lift * H * t * t + m.asym * H * t + m.wave * H * Math.sin(t * Math.PI * 2.2);
      up.push([x, base + 0.012 * H * (1 - t * t) * (m.lift > 0 ? 0.4 : 0)]);
      lo.push([x, base + m.open * H * Math.pow(1 - t * t, 0.7) + 0.012 * H * (1 - t * t) * (m.lift > 0 ? 0.4 : 0)]);
    }
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); up.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
    ctx.closePath();
    ctx.fillStyle = '#3a1820'; ctx.fill();
    if (m.open > 0.025) { // teeth + tongue for the big grin
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#f6f6f8'; ctx.fillRect(cx - mw, my - H * 0.05, mw * 2, H * 0.05 + m.open * H * 0.22);
      ctx.fillStyle = '#e0607a'; ctx.beginPath(); ctx.ellipse(cx, my + m.open * H * 0.95, mw * 0.55, m.open * H * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#2a1218'; ctx.lineWidth = Math.max(3, W * 0.014); ctx.stroke();
    ctx.restore();
    this.texture.needsUpdate = true;
  }
}
