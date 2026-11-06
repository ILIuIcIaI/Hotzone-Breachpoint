// Verlet-Ragdoll mit "aktiven Muskeln" (Euphoria-Anmutung):
//  - Koerper behaelt nach Treffer kurz Spannung (Pose-Federn im Torso-Bezugssystem), die abklingt
//  - Knie knicken ein, Getroffener greift an die Wunde, Arme fangen den Sturz ab
//  - Kopftreffer: sofort schlaff
import * as THREE from 'three';
import { J, NJ, BONES, LEN, getJ } from './skeleton.js';

const RAD = [0.12, 0.14, 0.06, 0.11, 0.07, 0.05, 0.05, 0.07, 0.05, 0.05, 0.08, 0.065, 0.06, 0.08, 0.065, 0.06];
const MASS = [3, 3, 0.8, 1.2, 0.8, 0.6, 0.4, 0.8, 0.6, 0.4, 1.5, 1.2, 0.6, 1.5, 1.2, 0.6];
const GRAV = -9.81;

// Zusaetzliche Versteifungen (Torso als Block, Kopf nicht in den Brustkorb)
const BRACES = [
  [J.SL, J.SR], [J.HPL, J.HPR], [J.SL, J.HPL], [J.SR, J.HPR], [J.SL, J.HPR], [J.SR, J.HPL],
  [J.N, J.SL], [J.N, J.SR], [J.C, J.HPL], [J.C, J.HPR], [J.P, J.SL], [J.P, J.SR], [J.N, J.P],
];
// Mindestabstaende (grobe Gelenkgrenzen)
const MINS = [
  [J.H, J.C, 0.2], [J.H, J.SL, 0.2], [J.H, J.SR, 0.2], [J.H, J.P, 0.6],
  [J.HL, J.SL, 0.16], [J.HR, J.SR, 0.16], [J.FL, J.HPL, 0.3], [J.FR, J.HPR, 0.3],
  [J.KL, J.C, 0.35], [J.KR, J.C, 0.35], [J.KL, J.KR, 0.12], [J.FL, J.FR, 0.1],
  [J.HL, J.P, 0.12], [J.HR, J.P, 0.12],
];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

export class Ragdoll {
  // joints: aktuelle Pose, prev: Pose des letzten Frames (fuer Startgeschwindigkeit)
  constructor(world, joints, prevJoints, dtPrev, hit) {
    this.world = world;
    this.p = new Float32Array(joints);
    this.o = new Float32Array(NJ * 3);
    // Geschwindigkeit aus der Animation uebernehmen (gedaempft)
    const sub = 1 / 120;
    const k = Math.min(1, sub / Math.max(dtPrev, 1e-3)) * 0.85;
    for (let i = 0; i < NJ * 3; i++) this.o[i] = this.p[i] - (joints[i] - prevJoints[i]) * k;
    this.cons = [];
    const addC = (a, b, stiff = 1) => {
      const d = Math.hypot(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2]);
      this.cons.push([a, b, d, stiff]);
    };
    for (const [a, b] of BONES) addC(a, b, 1);
    for (const [a, b] of BRACES) addC(a, b, 0.9);
    this.mins = MINS;
    this.t = 0;
    this.sleep = 0;
    this.asleep = false;
    this.hit = hit; // {joint, dir:Vector3, power, zone, point}
    // Muskel-Profil
    const head = hit.zone === 'head';
    this.tone = head ? 0.0 : 1.0;
    this.toneDecay = head ? 10 : (hit.zone === 'leg' ? 1.6 : 0.85 + Math.random() * 0.5);
    this.buckle = head ? 1 : 0;
    this.buckleRate = hit.zone === 'leg' ? 2.5 : 0.9 + Math.random() * 0.6;
    // Zielpose im Torso-Bezugssystem speichern
    this.local = new Float32Array(NJ * 3);
    this.frame(this.p, this._fr = { o: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() });
    const F = this._fr;
    for (let i = 0; i < NJ; i++) {
      _v.set(this.p[i * 3] - F.o.x, this.p[i * 3 + 1] - F.o.y, this.p[i * 3 + 2] - F.o.z);
      this.local[i * 3] = _v.dot(F.x); this.local[i * 3 + 1] = _v.dot(F.y); this.local[i * 3 + 2] = _v.dot(F.z);
    }
    // Wundgriff: Trefferpunkt relativ zum Torso, Hand der Gegenseite
    this.clutch = null;
    if (!head && hit.point && (hit.zone === 'torso')) {
      _v.subVectors(hit.point, F.o);
      const lp = [_v.dot(F.x), _v.dot(F.y), _v.dot(F.z)];
      // auf Koerperoberflaeche ziehen
      lp[2] = Math.max(lp[2], 0.12);
      this.clutch = { hand: lp[0] > 0 ? J.HR : J.HL, lp, until: 1.4 + Math.random() * 1.5 };
      if (Math.random() < 0.35) this.clutch.hand2 = this.clutch.hand === J.HR ? J.HL : J.HR;
    }
    // Impuls
    this.impulse(hit.joint, hit.dir, hit.power);
    this.gun = null;
    this.boxes = [];
    this.refreshBoxes();
  }

  refreshBoxes() {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < NJ; i++) { x0 = Math.min(x0, this.p[i * 3]); x1 = Math.max(x1, this.p[i * 3]); z0 = Math.min(z0, this.p[i * 3 + 2]); z1 = Math.max(z1, this.p[i * 3 + 2]); }
    this.boxes.length = 0;
    this.world.query(x0 - 1.2, z0 - 1.2, x1 + 1.2, z1 + 1.2, this.boxes);
    this._bx = [x0, z0, x1, z1];
  }

  // Bezugssystem: Ursprung Becken, y Wirbelsaeule, x Schulterachse (links), z vorwaerts
  frame(p, F) {
    F.o.set(p[J.P * 3], p[J.P * 3 + 1], p[J.P * 3 + 2]);
    F.y.set(p[J.N * 3] - F.o.x, p[J.N * 3 + 1] - F.o.y, p[J.N * 3 + 2] - F.o.z).normalize();
    _r.set(p[J.SR * 3] - p[J.SL * 3], p[J.SR * 3 + 1] - p[J.SL * 3 + 1], p[J.SR * 3 + 2] - p[J.SL * 3 + 2]);
    _r.addScaledVector(F.y, -_r.dot(F.y)).normalize();
    F.z.crossVectors(F.y, _r).normalize();
    F.x.crossVectors(F.y, F.z);
    return F;
  }

  impulse(j, dir, power) {
    // Geschwindigkeit = Positionsdifferenz; Impuls auf getroffenes Gelenk + Nachbarn
    const s = 1 / 120;
    const add = (i, k) => {
      this.o[i * 3] -= dir.x * power * k * s; this.o[i * 3 + 1] -= dir.y * power * k * s; this.o[i * 3 + 2] -= dir.z * power * k * s;
    };
    add(j, 1.0);
    for (const [a, b] of BONES) { if (a === j) add(b, 0.45); if (b === j) add(a, 0.45); }
    for (let i = 0; i < NJ; i++) add(i, 0.12);
    this.asleep = false; this.sleep = 0;
  }

  // Treffer an bereits liegender/fallender Leiche
  shot(j, dir, power) {
    this.impulse(j, dir, power * 0.8);
    this.tone = Math.max(0, this.tone - 0.4);
  }

  step(dt) {
    if (this.asleep) return;
    const sub = 1 / 120;
    this._acc = (this._acc || 0) + Math.min(dt, 0.05);
    let n = 0;
    while (this._acc >= sub && n < 6) { this._acc -= sub; this.substep(sub); n++; }
    if (this.t > 0.5 && (this.t % 0.5) < dt) this.refreshBoxes();
  }

  substep(h) {
    const p = this.p, o = this.o;
    this.t += h;
    this.tone = Math.max(0, this.tone - h * this.toneDecay * (this.t > 0.25 ? 1 : 0.35));
    this.buckle = Math.min(1, this.buckle + h * this.buckleRate);
    // Integration
    const damp = 0.996;
    for (let i = 0; i < NJ; i++) {
      const ix = i * 3;
      const vx = (p[ix] - o[ix]) * damp, vy = (p[ix + 1] - o[ix + 1]) * damp, vz = (p[ix + 2] - o[ix + 2]) * damp;
      o[ix] = p[ix]; o[ix + 1] = p[ix + 1]; o[ix + 2] = p[ix + 2];
      p[ix] += vx; p[ix + 1] += vy + GRAV * h * h; p[ix + 2] += vz;
    }
    // Muskeln
    if (this.tone > 0.01 || (this.clutch && this.t < this.clutch.until)) this.muscles(h);
    // Constraints
    const it = 8;
    for (let k = 0; k < it; k++) {
      for (const c of this.cons) this.solve(c[0], c[1], c[2], c[3], false);
      for (const m of this.mins) this.solve(m[0], m[1], m[2], 1, true);
      this.collide(k === it - 1);
    }
    this.kneeHinge();
    // Schlaf-Erkennung
    let e = 0;
    for (let i = 0; i < NJ * 3; i++) { const d = p[i] - o[i]; e += d * d; }
    if (e < 2e-8 && this.t > 1.5) { this.sleep += h; if (this.sleep > 0.6) this.asleep = true; } else this.sleep = 0;
  }

  solve(a, b, rest, stiff, minOnly) {
    const p = this.p;
    const ax = a * 3, bx = b * 3;
    const dx = p[bx] - p[ax], dy = p[bx + 1] - p[ax + 1], dz = p[bx + 2] - p[ax + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (minOnly && d >= rest) return;
    const diff = (d - rest) / d * stiff;
    const wa = 1 / MASS[a], wb = 1 / MASS[b], ws = wa + wb;
    const ka = diff * wa / ws, kb = diff * wb / ws;
    p[ax] += dx * ka; p[ax + 1] += dy * ka; p[ax + 2] += dz * ka;
    p[bx] -= dx * kb; p[bx + 1] -= dy * kb; p[bx + 2] -= dz * kb;
  }

  // Knie / Ellbogen sollen nicht nach hinten durchknicken
  kneeHinge() {
    const p = this.p;
    const F = this.frame(p, this._fr);
    for (const [hp, kn, ft] of [[J.HPL, J.KL, J.FL], [J.HPR, J.KR, J.FR]]) {
      const mx = (p[hp * 3] + p[ft * 3]) / 2, my = (p[hp * 3 + 1] + p[ft * 3 + 1]) / 2, mz = (p[hp * 3 + 2] + p[ft * 3 + 2]) / 2;
      _v.set(p[kn * 3] - mx, p[kn * 3 + 1] - my, p[kn * 3 + 2] - mz);
      const f = _v.dot(F.z);
      if (f < 0) { p[kn * 3] -= F.z.x * f * 0.5; p[kn * 3 + 1] -= F.z.y * f * 0.5; p[kn * 3 + 2] -= F.z.z * f * 0.5; }
    }
  }

  muscles(h) {
    const p = this.p;
    const F = this.frame(p, this._fr);
    const tone = this.tone;
    // Pose-Federn (oberkoerper staerker als beine; beine knicken ein)
    for (let i = 0; i < NJ; i++) {
      if (i === J.P) continue;
      let lx = this.local[i * 3], ly = this.local[i * 3 + 1], lz = this.local[i * 3 + 2];
      let k = 0.18 * tone;
      const isLeg = i === J.KL || i === J.KR || i === J.FL || i === J.FR;
      if (isLeg) {
        // Einknicken: Knie nach vorn/unten, Fuesse Richtung Becken
        const b = this.buckle;
        if (i === J.KL || i === J.KR) { lz += 0.25 * b; ly += 0.18 * b; }
        else { ly += 0.35 * b; lz -= 0.05 * b; }
        k = 0.12 * tone;
      }
      if (i === J.HL || i === J.HR || i === J.EL || i === J.ER) k *= 0.5;
      const tx = F.o.x + F.x.x * lx + F.y.x * ly + F.z.x * lz;
      const ty = F.o.y + F.x.y * lx + F.y.y * ly + F.z.y * lz;
      const tz = F.o.z + F.x.z * lx + F.y.z * ly + F.z.z * lz;
      p[i * 3] += (tx - p[i * 3]) * k; p[i * 3 + 1] += (ty - p[i * 3 + 1]) * k; p[i * 3 + 2] += (tz - p[i * 3 + 2]) * k;
    }
    // Wundgriff
    const c = this.clutch;
    if (c && this.t < c.until) {
      const w = Math.min(1, this.t * 4) * 0.22 * (1 - this.t / c.until);
      for (const hand of [c.hand, c.hand2]) {
        if (hand === undefined) continue;
        const [lx, ly, lz] = c.lp;
        const tx = F.o.x + F.x.x * lx + F.y.x * ly + F.z.x * lz;
        const ty = F.o.y + F.x.y * lx + F.y.y * ly + F.z.y * lz;
        const tz = F.o.z + F.x.z * lx + F.y.z * ly + F.z.z * lz;
        p[hand * 3] += (tx - p[hand * 3]) * w; p[hand * 3 + 1] += (ty - p[hand * 3 + 1]) * w; p[hand * 3 + 2] += (tz - p[hand * 3 + 2]) * w;
      }
    }
    // Abfangen: Brust faellt schnell -> Haende Richtung Boden vor dem Koerper
    const vy = (p[J.C * 3 + 1] - this.o[J.C * 3 + 1]) / h;
    if (tone > 0.05 && vy < -1.0 && p[J.C * 3 + 1] < 1.1) {
      _f.set(p[J.C * 3 + 0] - this.o[J.C * 3], 0, p[J.C * 3 + 2] - this.o[J.C * 3 + 2]);
      if (_f.lengthSq() < 1e-8) _f.copy(F.z).setY(0);
      _f.normalize();
      for (const hand of [J.HL, J.HR]) {
        if (c && (hand === c.hand || hand === c.hand2) && this.t < c.until) continue;
        const side = hand === J.HL ? 1 : -1;
        const tx = p[J.C * 3] + _f.x * 0.45 + F.x.x * side * 0.2, ty = 0.05, tz = p[J.C * 3 + 2] + _f.z * 0.45 + F.x.z * side * 0.2;
        const w = 0.08 * tone;
        p[hand * 3] += (tx - p[hand * 3]) * w; p[hand * 3 + 1] += (ty - p[hand * 3 + 1]) * w; p[hand * 3 + 2] += (tz - p[hand * 3 + 2]) * w;
      }
    }
  }

  collide(friction) {
    const p = this.p, o = this.o;
    const B = this.boxes;
    for (let i = 0; i < NJ; i++) {
      const ix = i * 3, r = RAD[i];
      // Boden
      if (p[ix + 1] < r) {
        p[ix + 1] = r;
        if (friction) {
          const f = 0.35;
          o[ix] = p[ix] - (p[ix] - o[ix]) * (1 - f); o[ix + 2] = p[ix + 2] - (p[ix + 2] - o[ix + 2]) * (1 - f);
          if (o[ix + 1] < p[ix + 1]) o[ix + 1] = p[ix + 1] - (p[ix + 1] - o[ix + 1]) * -0.1;
        }
      }
      // Boxen
      for (let k = 0; k < B.length; k++) {
        const b = B[k];
        if (!b.solid || b.max[1] < 0.02) continue;
        const x = p[ix], y = p[ix + 1], z = p[ix + 2];
        if (x < b.min[0] - r || x > b.max[0] + r || y < b.min[1] - r || y > b.max[1] + r || z < b.min[2] - r || z > b.max[2] + r) continue;
        const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cy = Math.max(b.min[1], Math.min(y, b.max[1])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
        let dx = x - cx, dy = y - cy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k2 = (r - d) / d;
          p[ix] += dx * k2; p[ix + 1] += dy * k2; p[ix + 2] += dz * k2;
        } else {
          // innen: zur Seite hinaus, von der das Teilchen kam (verhindert Durchtunneln)
          let best = -1, bestOut = -1e9, side = 0;
          for (let a = 0; a < 3; a++) {
            const ov = o[ix + a];
            const outMin = b.min[a] - ov, outMax = ov - b.max[a];
            if (outMin > bestOut) { bestOut = outMin; best = a; side = -1; }
            if (outMax > bestOut) { bestOut = outMax; best = a; side = 1; }
          }
          if (bestOut > -0.02) p[ix + best] = side < 0 ? b.min[best] - r : b.max[best] + r;
          else {
            const pen = [x - b.min[0], b.max[0] - x, y - b.min[1], b.max[1] - y, z - b.min[2], b.max[2] - z];
            let m = 0; for (let q = 1; q < 6; q++) if (pen[q] < pen[m]) m = q;
            const ax = m >> 1, s = (m & 1) ? 1 : -1;
            p[ix + ax] += s * (pen[m] + r);
          }
        }
        if (friction) { o[ix] = p[ix] - (p[ix] - o[ix]) * 0.7; o[ix + 2] = p[ix + 2] - (p[ix + 2] - o[ix + 2]) * 0.7; o[ix + 1] = p[ix + 1] - (p[ix + 1] - o[ix + 1]) * 0.7; }
      }
      // Tueren (als Hindernis)
      for (const d of this.world.doors) {
        const pos = { x: p[ix], z: p[ix + 2] };
        if (p[ix + 1] < d.height && d.pushCircle(pos, r, p[ix + 1], p[ix + 1])) { p[ix] = pos.x; p[ix + 2] = pos.z; }
      }
    }
  }

  // Waffe faellt als 2-Punkt-Koerper
  dropGun(a, b, vel) {
    this.gun = { p: new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), o: new Float32Array([a.x - vel.x / 60, a.y - vel.y / 60, a.z - vel.z / 60, b.x - vel.x / 60, b.y - vel.y / 60, b.z - vel.z / 60]), len: a.distanceTo(b), t: 0 };
  }
  stepGun(dt, world) {
    const g = this.gun;
    if (!g || g.rest) return;
    const h = Math.min(dt, 1 / 30);
    g.t += h;
    for (let i = 0; i < 2; i++) {
      const ix = i * 3;
      const vx = (g.p[ix] - g.o[ix]) * 0.995, vy = (g.p[ix + 1] - g.o[ix + 1]) * 0.995, vz = (g.p[ix + 2] - g.o[ix + 2]) * 0.995;
      g.o[ix] = g.p[ix]; g.o[ix + 1] = g.p[ix + 1]; g.o[ix + 2] = g.p[ix + 2];
      g.p[ix] += vx; g.p[ix + 1] += vy + GRAV * h * h; g.p[ix + 2] += vz;
      if (g.p[ix + 1] < 0.025) { g.p[ix + 1] = 0.025; g.o[ix] = g.p[ix] - vx * 0.5; g.o[ix + 2] = g.p[ix + 2] - vz * 0.5; g.o[ix + 1] = g.p[ix + 1] + vy * 0.3; }
      const s = world.pointInSolid(g.p[ix], g.p[ix + 1], g.p[ix + 2]);
      if (s && s.max[1] > 0.05) { g.p[ix] = g.o[ix]; g.p[ix + 2] = g.o[ix + 2]; if (g.p[ix + 1] < s.max[1] + 0.03 && g.o[ix + 1] >= s.max[1]) g.p[ix + 1] = s.max[1] + 0.025; }
    }
    // Laengen-Constraint
    for (let k = 0; k < 3; k++) {
      const dx = g.p[3] - g.p[0], dy = g.p[4] - g.p[1], dz = g.p[5] - g.p[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, df = (d - g.len) / d * 0.5;
      g.p[0] += dx * df; g.p[1] += dy * df; g.p[2] += dz * df; g.p[3] -= dx * df; g.p[4] -= dy * df; g.p[5] -= dz * df;
    }
    if (g.t > 3) g.rest = true;
  }

  centre(out) { return out.set(this.p[0], this.p[1], this.p[2]); }
}
