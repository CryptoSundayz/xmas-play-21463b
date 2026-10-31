// Keyboard (WASD/arrows + Shift), mouse-drag camera, mobile joystick (auto-sprint) + JUMP button + touch-drag camera.
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.joy = { x: 0, y: 0, active: false }; this.jumpBtn = false;
    this.camDelta = 0; this.lastManualCam = -1e9; this.paused = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // mouse drag orbit
    let drag = null;
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { drag = e.clientX; } });
    addEventListener('pointermove', e => { if (drag !== null && e.pointerType === 'mouse') { this.camDelta += (e.clientX - drag) * 0.006; drag = e.clientX; this.lastManualCam = performance.now(); } });
    addEventListener('pointerup', e => { if (e.pointerType === 'mouse') drag = null; });
    this.setupTouch(canvas);
  }
  setupTouch(canvas) {
    const zone = document.getElementById('joyZone'), knob = document.getElementById('joyKnob'), base = document.getElementById('joyBase');
    const jump = document.getElementById('jumpBtn');
    let jid = null, cx = 0, cy = 0; const R = 55;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    zone?.addEventListener('pointerdown', e => {
      jid = e.pointerId; zone.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.joy.active = true; move(e); e.preventDefault();
    });
    const move = e => {
      if (e.pointerId !== jid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob(dx, dy); this.joy.x = dx / R; this.joy.y = -dy / R;
    };
    zone?.addEventListener('pointermove', move);
    const end = e => { if (e.pointerId !== jid) return; jid = null; this.joy = { x: 0, y: 0, active: false }; setKnob(0, 0); };
    zone?.addEventListener('pointerup', end); zone?.addEventListener('pointercancel', end);
    jump?.addEventListener('pointerdown', e => { this.jumpBtn = true; jump.classList.add('on'); jump.setPointerCapture?.(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) jump?.addEventListener(ev, () => { this.jumpBtn = false; jump.classList.remove('on'); });
    // touch-drag camera on the canvas (right side)
    let tid = null, tx = 0;
    canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && tid === null) { tid = e.pointerId; tx = e.clientX; } });
    canvas.addEventListener('pointermove', e => { if (e.pointerId === tid) { this.camDelta += (e.clientX - tx) * 0.008; tx = e.clientX; this.lastManualCam = performance.now(); } });
    const tend = e => { if (e.pointerId === tid) tid = null; };
    canvas.addEventListener('pointerup', tend); canvas.addEventListener('pointercancel', tend);
  }
  /** movement axes: x = right, y = forward */
  axes() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); } // touch: auto-sprint in main.js
  takeCamDelta() { const d = this.camDelta; this.camDelta = 0; const q = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0); return d + q * 0.035; }
}
