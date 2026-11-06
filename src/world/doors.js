// Drehtueren: Kollision als orientierte Box, langsames Oeffnen (Mausrad), Eintreten.
import * as THREE from 'three';

export class Door {
  // hinge: Scharnierpunkt (x,z); dirAngle: Richtung des geschlossenen Blatts vom Scharnier aus (rad, in XZ)
  constructor(world, opts) {
    this.world = world;
    this.hx = opts.hx; this.hz = opts.hz;
    this.base = opts.angle;          // Winkel des geschlossenen Blatts
    this.width = opts.width;
    this.height = opts.height ?? 2.1;
    this.thick = opts.thick ?? 0.045;
    this.mat = opts.mat ?? 'wood';
    this.open = 0;                   // aktueller Oeffnungswinkel (rad, +/-)
    this.target = 0;
    this.speed = 0;
    this.locked = !!opts.locked;
    this.kind = opts.kind ?? 'wood';
    this.isDoor = true;
    this.blocksSight = true;
    this.name = opts.name || '';
    this.mesh = null;
    this.health = opts.kind === 'metal' ? 3 : 1;
    this.lastMove = 0;
    this.noise = 0;
    this._upd();
  }

  get angle() { return this.base + this.open; }
  get isClosed() { return Math.abs(this.open) < 0.08; }
  get center() { return { x: this.cx, z: this.cz }; }

  _upd() {
    const a = this.angle;
    this.ux = Math.cos(a); this.uz = Math.sin(a);       // entlang Blatt
    this.vx = -this.uz; this.vz = this.ux;              // Normale
    this.cx = this.hx + this.ux * this.width / 2;
    this.cz = this.hz + this.uz * this.width / 2;
  }

  // Seite eines Punktes relativ zur geschlossenen Tuer (+1/-1)
  sideOf(x, z) {
    const a = this.base;
    const vx = -Math.sin(a), vz = Math.cos(a);
    return Math.sign((x - this.hx) * vx + (z - this.hz) * vz) || 1;
  }

  // Oeffnet weg von Position (x,z)
  openAwayFrom(x, z, amount = 1.75) {
    if (this.locked) return false;
    const s = this.sideOf(x, z);
    this.target = -s * amount;
    return true;
  }
  close() { this.target = 0; }
  toggle(x, z) {
    if (this.locked) return false;
    if (Math.abs(this.target) > 0.1) { this.close(); return 'close'; }
    this.openAwayFrom(x, z); return 'open';
  }
  nudge(x, z, delta) {
    if (this.locked) return false;
    const s = this.sideOf(x, z);
    let t = this.target;
    if (Math.abs(t) < 0.02) t = 0;
    const dirSign = t !== 0 ? Math.sign(t) : -s;
    let mag = Math.abs(t) + delta;
    mag = Math.max(0, Math.min(1.75, mag));
    this.target = dirSign * mag;
    this.slow = true;
    return true;
  }

  update(dt, now) {
    const diff = this.target - this.open;
    if (Math.abs(diff) < 1e-3) { this.speed = 0; return; }
    const maxV = this.kicked ? 9 : (this.slow ? 1.6 : 3.2);
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxV * dt);
    const prev = this.open;
    this.open += step;
    this._upd();
    // Blockiert durch Kisten o.ae.: zuruecksetzen
    if (this._blockedByWorld()) { this.open = prev; this.target = prev; this._upd(); this.kicked = false; }
    if (Math.abs(this.target - this.open) < 1e-3) { this.kicked = false; this.slow = false; }
    this.lastMove = now;
    if (this.mesh) this.mesh.rotation.y = -this.angle;
  }

  _blockedByWorld() {
    // Testpunkt an der Blattspitze
    const tx = this.hx + this.ux * (this.width - 0.05), tz = this.hz + this.uz * (this.width - 0.05);
    const mx = this.hx + this.ux * this.width * 0.55, mz = this.hz + this.uz * this.width * 0.55;
    return !!(this.world.pointInSolid(tx, 0.5, tz, 0.02) || this.world.pointInSolid(mx, 0.5, mz, 0.02));
  }

  // Strahl gegen Tuerblatt
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    if (oy + dy * maxT < -1 && oy < 0) return null;
    // in lokales System: u (entlang), v (normal), y
    const rx = ox - this.cx, rz = oz - this.cz;
    const lu = rx * this.ux + rz * this.uz, lv = rx * this.vx + rz * this.vz, ly = oy - this.height / 2;
    const du = dx * this.ux + dz * this.uz, dv = dx * this.vx + dz * this.vz;
    const hu = this.width / 2, hv = this.thick / 2, hy = this.height / 2;
    let t0 = 0, t1 = maxT, axis = -1;
    const slab = (o, d, h, ax) => {
      if (Math.abs(d) < 1e-9) return o >= -h && o <= h;
      let a = (-h - o) / d, b = (h - o) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) { t0 = a; axis = ax; }
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (!slab(lu, du, hu, 0) || !slab(lv, dv, hv, 1) || !slab(ly, dy, hy, 2)) return null;
    if (t0 <= 0) return null;
    let nx = 0, nz = 0;
    if (axis === 1) { const s = -Math.sign(dv); nx = this.vx * s; nz = this.vz * s; }
    else if (axis === 0) { const s = -Math.sign(du); nx = this.ux * s; nz = this.uz * s; }
    return { t: t0, nx, nz };
  }

  pushCircle(pos, r, y0, y1) {
    if (y0 > this.height) return false;
    const rx = pos.x - this.cx, rz = pos.z - this.cz;
    const lu = rx * this.ux + rz * this.uz, lv = rx * this.vx + rz * this.vz;
    const hu = this.width / 2, hv = this.thick / 2;
    const cu = Math.max(-hu, Math.min(hu, lu)), cv = Math.max(-hv, Math.min(hv, lv));
    let du = lu - cu, dv = lv - cv;
    const d2 = du * du + dv * dv;
    if (d2 >= r * r) return false;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { dv = lv >= 0 ? 1 : -1; du = 0; d = 1e-6; const k = (r + hv - Math.abs(lv)); pos.x += this.vx * dv * k; pos.z += this.vz * dv * k; return true; }
    const k = (r - d) / d;
    pos.x += (du * this.ux + dv * this.vx) * k;
    pos.z += (du * this.uz + dv * this.vz) * k;
    return true;
  }

  // Abstand eines Punktes zur Tuermitte (fuer Interaktion)
  distTo(x, z) {
    const mx = this.hx + Math.cos(this.base) * this.width / 2, mz = this.hz + Math.sin(this.base) * this.width / 2;
    return Math.hypot(x - mx, z - mz);
  }
  closedCenter() {
    return { x: this.hx + Math.cos(this.base) * this.width / 2, z: this.hz + Math.sin(this.base) * this.width / 2 };
  }
}

// Mesh fuer ein Tuerblatt (Pivot am Scharnier)
export function buildDoorMesh(door, mats) {
  const g = new THREE.Group();
  g.position.set(door.hx, 0, door.hz);
  g.rotation.y = -door.angle;
  const w = door.width, h = door.height, t = door.thick;
  const leafMat = door.kind === 'glass' ? mats.glassDoor : door.kind === 'metal' ? mats.metalDoor : mats.woodDoor;
  if (door.kind === 'glass') {
    const frame = mats.alu;
    const add = (sx, sy, sz, px, py, pz, m) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.position.set(px, py, pz); me.castShadow = true; g.add(me); };
    add(w, 0.08, t + 0.01, w / 2, 0.04, 0, frame); add(w, 0.08, t + 0.01, w / 2, h - 0.04, 0, frame);
    add(0.06, h, t + 0.01, 0.03, h / 2, 0, frame); add(0.06, h, t + 0.01, w - 0.03, h / 2, 0, frame);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h - 0.14, 0.012), leafMat); gl.position.set(w / 2, h / 2, 0); g.add(gl);
    add(0.03, 0.5, 0.06, w - 0.15, 1.05, 0.05, frame); add(0.03, 0.5, 0.06, w - 0.15, 1.05, -0.05, frame);
  } else {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.01, h - 0.01, t), leafMat);
    leaf.position.set(w / 2, h / 2, 0); leaf.castShadow = true; leaf.receiveShadow = true; g.add(leaf);
    // Klinke beidseitig
    for (const s of [1, -1]) {
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 12), mats.handle);
      rose.rotation.x = Math.PI / 2; rose.position.set(w - 0.08, 1.02, s * (t / 2 + 0.006)); g.add(rose);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.022), mats.handle);
      lever.position.set(w - 0.13, 1.02, s * (t / 2 + 0.045)); g.add(lever);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.045), mats.handle);
      neck.position.set(w - 0.08, 1.02, s * (t / 2 + 0.024)); g.add(neck);
    }
    if (door.kind === 'metal') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.06, 0.05), mats.handle);
      bar.position.set(w * 0.5, 1.0, t / 2 + 0.04); g.add(bar);
    } else {
      // Kleines Sichtfenster in manchen Tueren
      if (door.window) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, t + 0.004), mats.glassDoor);
        win.position.set(w * 0.62, 1.45, 0); g.add(win);
      }
    }
  }
  door.mesh = g;
  return g;
}
