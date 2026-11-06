// Tastatur/Maus mit Pointer-Lock
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    this.buttons = 0; this.mPressed = 0; this.mReleased = 0;
    this.locked = false;
    this.crouchToggle = false;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'AltLeft' || e.code === 'ControlLeft') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('mousemove', (e) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    addEventListener('mousedown', (e) => { if (!this.locked) return; this.buttons |= 1 << e.button; this.mPressed |= 1 << e.button; });
    addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); this.mReleased |= 1 << e.button; });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.buttons = 0; }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }
  lock() { try { const r = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => this.canvas.requestPointerLock()); } catch (e) { this.canvas.requestPointerLock(); } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  up(c) { return this.released.has(c); }
  mouse(b) { return (this.buttons & (1 << b)) !== 0; }
  mouseHit(b) { return (this.mPressed & (1 << b)) !== 0; }
  endFrame() { this.pressed.clear(); this.released.clear(); this.mdx = 0; this.mdy = 0; this.wheel = 0; this.mPressed = 0; this.mReleased = 0; }
}
