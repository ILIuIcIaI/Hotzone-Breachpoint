// Aktive Ragdoll nach dem Euphoria-Prinzip (Koerper + Muskeln + motorisches "Nervensystem"):
//  1. Gleichgewicht: Fuesse stehen fest, der Schwerpunkt wird beobachtet. Kippt er ueber die
//     Standflaeche (Capture-Point = Schwerpunkt + Geschwindigkeit * sqrt(h/g)), setzt die Figur einen
//     Ausfallschritt dorthin -> Taumeln in Schussrichtung, Beine halten das Becken oben.
//  2. Haltung: Oberkoerper kruemmt sich um die Wunde, eine/beide Haende greifen hin, der freie Arm rudert.
//  3. Kraftverlust: Muskelspannung bricht weg, Knie knicken ein, Sturz; Haende fangen den Fall ab,
//     beim Fallen nach hinten wird der Kopf geschuetzt (Kinn zur Brust).
//  4. Am Boden: kurzes Kruemmen (Beine anziehen, Hand auf der Wunde), dann erschlaffen.
//  Kopftreffer: sofort schlaff. Beintreffer: Bein knickt ein, Sturz zur Seite.
import * as THREE from 'three';
import { J, NJ, BONES } from './skeleton.js';

const RAD = [0.12, 0.14, 0.06, 0.11, 0.07, 0.05, 0.05, 0.07, 0.05, 0.05, 0.08, 0.065, 0.06, 0.08, 0.065, 0.06];
const MASS = [7, 7, 1.2, 1.6, 1.2, 0.7, 0.45, 1.2, 0.7, 0.45, 2.6, 1.6, 0.8, 2.6, 1.6, 0.8];
const GRAV = -12.5;
const H = 1 / 120;
const MAXD = 0.09; // max. Weg pro Teilschritt (~11 m/s) -> keine Explosionen

const BRACES = [
  [J.SL, J.SR], [J.HPL, J.HPR], [J.SL, J.HPL], [J.SR, J.HPR], [J.SL, J.HPR], [J.SR, J.HPL],
  [J.N, J.SL], [J.N, J.SR], [J.C, J.HPL], [J.C, J.HPR], [J.P, J.SL], [J.P, J.SR], [J.N, J.P],
];
const MINS = [
  [J.H, J.C, 0.2], [J.H, J.SL, 0.2], [J.H, J.SR, 0.2], [J.H, J.P, 0.6],
  [J.HL, J.SL, 0.16], [J.HR, J.SR, 0.16], [J.FL, J.HPL, 0.3], [J.FR, J.HPR, 0.3],
  [J.KL, J.C, 0.35], [J.KR, J.C, 0.35], [J.KL, J.KR, 0.12], [J.FL, J.FR, 0.1],
  [J.HL, J.P, 0.12], [J.HR, J.P, 0.12],
];

const _v = new THREE.Vector3(), _r = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Ragdoll {
  constructor(world, joints, prevJoints, dtPrev, hit) {
    this.world = world;
    this.p = new Float32Array(joints);
    this.o = new Float32Array(NJ * 3);
    const k = Math.min(1, H / Math.max(dtPrev, 1e-3)) * 0.9;
    for (let i = 0; i < NJ * 3; i++) this.o[i] = this.p[i] - (joints[i] - prevJoints[i]) * k;
    this.mass = Float32Array.from(MASS);
    this.cons = [];
    const addC = (a, b, stiff) => this.cons.push([a, b, Math.hypot(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2]), stiff]);
    for (const [a, b] of BONES) addC(a, b, 1);
    for (const [a, b] of BRACES) addC(a, b, 0.9);
    this.mins = MINS;
    this.t = 0; this.sleep = 0; this.asleep = false;
    this.events = []; this.impacted = {};
    this.hit = hit;
    const head = hit.zone === 'head', leg = hit.zone === 'leg';
    // ---- Nervensystem-Parameter (jedes Mal etwas anders) ----
    this.tone = head ? 0 : 1;
    this.balanceT = head ? 0 : leg ? rnd(0.15, 0.35) : rnd(0.55, 1.4);   // wie lange er sich auf den Beinen haelt
    this.stepsLeft = head ? 0 : leg ? 1 : Math.round(rnd(1, 4));
    this.hunch = head ? 0 : hit.zone === 'torso' ? rnd(0.35, 0.7) : rnd(0.1, 0.3); // Kruemmung um die Wunde
    this.writheT = !head && Math.random() < 0.7 ? rnd(1.5, 4.5) : 0;
    this.legHit = leg ? (hit.joint === J.KL || hit.joint === J.FL ? 'L' : 'R') : null;
    this.phase = head ? 'fall' : 'balance';
    this.standH = this.p[J.P * 3 + 1];
    // Fuesse
    this.feet = [
      { j: J.FL, k: J.KL, planted: !head, pos: new THREE.Vector3(this.p[J.FL * 3], this.p[J.FL * 3 + 1], this.p[J.FL * 3 + 2]), step: null },
      { j: J.FR, k: J.KR, planted: !head, pos: new THREE.Vector3(this.p[J.FR * 3], this.p[J.FR * 3 + 1], this.p[J.FR * 3 + 2]), step: null },
    ];
    // Bezugssystem + Ausgangspose (fuer Arm-/Kopfspannung)
    this._fr = { o: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    const F = this.frame(this.p, this._fr);
    this.local = new Float32Array(NJ * 3);
    for (let i = 0; i < NJ; i++) {
      _v.set(this.p[i * 3] - F.o.x, this.p[i * 3 + 1] - F.o.y, this.p[i * 3 + 2] - F.o.z);
      this.local[i * 3] = _v.dot(F.x); this.local[i * 3 + 1] = _v.dot(F.y); this.local[i * 3 + 2] = _v.dot(F.z);
    }
    // Wundgriff
    this.clutch = null;
    if (!head && hit.point && hit.zone !== 'leg') {
      _v.subVectors(hit.point, F.o);
      const lp = [_v.dot(F.x), Math.min(0.45, Math.max(0.05, _v.dot(F.y))), Math.max(_v.dot(F.z), 0.13)];
      this.clutch = { hand: lp[0] > 0 ? J.HL : J.HR, lp, until: rnd(2.5, 6) };
      if (Math.random() < 0.4) this.clutch.hand2 = this.clutch.hand === J.HR ? J.HL : J.HR;
    }
    this.fallDir = new THREE.Vector3(hit.dir.x, 0, hit.dir.z).normalize();
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
  }

  // Ursprung Becken, y Wirbelsaeule, x Schulterachse (links), z vorwaerts
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
    const add = (i, k) => { this.o[i * 3] -= dir.x * power * k * H; this.o[i * 3 + 1] -= dir.y * power * k * H * 0.3; this.o[i * 3 + 2] -= dir.z * power * k * H; };
    add(j, 1.0);
    for (const [a, b] of BONES) { if (a === j) add(b, 0.5); if (b === j) add(a, 0.5); }
    for (let i = 0; i < NJ; i++) add(i, 0.25);
    this.asleep = false; this.sleep = 0;
  }

  // Treffer an einer Leiche: nur ein sichtbares Zucken, kein Wegschleudern
  shot(j, dir, power) {
    const add = (i, k) => { this.o[i * 3] -= dir.x * 0.9 * k * H; this.o[i * 3 + 2] -= dir.z * 0.9 * k * H; this.o[i * 3 + 1] += 0.4 * k * H; };
    add(j, 1); for (const [a, b] of BONES) { if (a === j) add(b, 0.4); if (b === j) add(a, 0.4); }
    this.asleep = false; this.sleep = 0;
  }

  step(dt) {
    if (this.asleep) return;
    this._acc = (this._acc || 0) + Math.min(dt, 0.05);
    let n = 0;
    while (this._acc >= H && n < 6) { this._acc -= H; this.substep(H); n++; }
    this._rb = (this._rb || 0) + dt;
    if (this._rb > 0.4) { this._rb = 0; this.refreshBoxes(); }
  }

  com(out) {
    let x = 0, z = 0, vx = 0, vz = 0, m = 0;
    for (let i = 0; i < NJ; i++) { const w = MASS[i]; x += this.p[i * 3] * w; z += this.p[i * 3 + 2] * w; vx += (this.p[i * 3] - this.o[i * 3]) * w; vz += (this.p[i * 3 + 2] - this.o[i * 3 + 2]) * w; m += w; }
    out.x = x / m; out.z = z / m; out.vx = vx / m / H; out.vz = vz / m / H;
    return out;
  }

  substep(h) {
    const p = this.p, o = this.o;
    this.t += h;
    // Integration mit Geschwindigkeitsbegrenzung
    for (let i = 0; i < NJ; i++) {
      const ix = i * 3;
      let vx = (p[ix] - o[ix]) * 0.998, vy = (p[ix + 1] - o[ix + 1]) * 0.998, vz = (p[ix + 2] - o[ix + 2]) * 0.998;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > MAXD) { const s = MAXD / sp; vx *= s; vy *= s; vz *= s; }
      o[ix] = p[ix]; o[ix + 1] = p[ix + 1]; o[ix + 2] = p[ix + 2];
      p[ix] += vx; p[ix + 1] += vy + GRAV * h * h; p[ix + 2] += vz;
    }
    this.brain(h);
    // Zwangsbedingungen
    for (let k = 0; k < 8; k++) {
      for (const c of this.cons) this.solve(c[0], c[1], c[2], c[3], false);
      for (const m of this.mins) this.solve(m[0], m[1], m[2], 1, true);
      this.pinFeet();
      this.collide(k === 7);
    }
    this.kneeHinge();
    let e = 0;
    for (let i = 0; i < NJ * 3; i++) { const d = p[i] - o[i]; e += d * d; }
    if (e < 3e-8 && this.t > 1.5 && this.phase === 'limp') { this.sleep += h; if (this.sleep > 0.5) this.asleep = true; } else this.sleep = 0;
  }

  // ---------------- Nervensystem ----------------
  brain(h) {
    const p = this.p;
    const F = this.frame(p, this._fr);
    const c = this.com(this._com || (this._com = {}));
    const pelvisY = p[J.P * 3 + 1], chestY = p[J.C * 3 + 1];
    // Phasenwechsel
    if (this.phase === 'balance') {
      this.tone = Math.max(0, 1 - this.t / (this.balanceT + 0.45));
      if (this.t > this.balanceT || pelvisY < this.standH * 0.62) this.enterFall();
    } else if (this.phase === 'fall') {
      this.tone = Math.max(0, this.tone - h * 1.4);
      if (chestY < 0.32 && pelvisY < 0.3) this.phase = this.writheT > 0 ? 'writhe' : 'limp', this.groundT = this.t;
      if (this.t > 4) this.phase = 'limp';
    } else if (this.phase === 'writhe') {
      if (this.t - this.groundT > this.writheT) this.phase = 'limp';
    }
    if (this.phase === 'balance') this.balance(h, F, c);
    if (this.phase === 'balance' || this.phase === 'fall') this.posture(h, F, c);
    if (this.phase === 'writhe') this.writhe(h, F);
    this.hands(h, F);
  }

  enterFall() {
    this.phase = 'fall';
    for (const f of this.feet) { f.planted = false; f.step = null; }
    this.mass.set(MASS);
  }

  // Gleichgewicht: Becken halten, Ausfallschritte zum Capture-Point
  balance(h, F, c) {
    const p = this.p;
    const tone = this.tone;
    // Beine stuetzen das Becken (mit nachlassender Kraft), getroffenes Bein knickt ein
    const hT = this.standH * (0.98 - (1 - tone) * 0.3);
    const lift = (hT - p[J.P * 3 + 1]) * 0.22 * tone;
    if (lift > 0) { p[J.P * 3 + 1] += lift; p[J.C * 3 + 1] += lift * 0.9; p[J.N * 3 + 1] += lift * 0.85; }
    // Capture-Point
    const cpx = c.x + c.vx * 0.3, cpz = c.z + c.vz * 0.3;
    const L = this.feet[0], R = this.feet[1];
    const sx = (L.pos.x + R.pos.x) / 2, sz = (L.pos.z + R.pos.z) / 2;
    const err = Math.hypot(cpx - sx, cpz - sz);
    if (!L.step && !R.step && this.stepsLeft > 0 && err > 0.14) {
      // Fuss waehlen, der naeher an den Kipp-Punkt kommt (der hintere zieht nach)
      const dl = Math.hypot(cpx - L.pos.x, cpz - L.pos.z), dr = Math.hypot(cpx - R.pos.x, cpz - R.pos.z);
      let foot = dl > dr ? L : R;
      if (this.legHit === 'L') foot = R; else if (this.legHit === 'R') foot = L;
      const side = foot === L ? 1 : -1; // x zeigt nach links
      const dx = cpx - sx, dz = cpz - sz, dl2 = Math.hypot(dx, dz) || 1;
      let tx = cpx + dx / dl2 * 0.04 + F.x.x * side * 0.11, tz = cpz + dz / dl2 * 0.04 + F.x.z * side * 0.11;
      // realistische Schrittlaenge (max. ~55 cm vom anderen Fuss)
      const other = foot === L ? R : L;
      const ox = tx - other.pos.x, oz = tz - other.pos.z, od = Math.hypot(ox, oz);
      if (od > 0.55) { tx = other.pos.x + ox / od * 0.55; tz = other.pos.z + oz / od * 0.55; }
      if (!this.world.pointInSolid(tx, 0.3, tz, 0.08)) {
        foot.step = { from: foot.pos.clone(), to: new THREE.Vector3(tx, RAD[foot.j], tz), t: 0, dur: rnd(0.2, 0.3) };
        foot.planted = false;
        this.stepsLeft--;
      }
    }
    for (const f of this.feet) {
      if (!f.step) continue;
      f.step.t += h;
      const s = Math.min(1, f.step.t / f.step.dur);
      const e = s * s * (3 - 2 * s);
      const tx = f.step.from.x + (f.step.to.x - f.step.from.x) * e;
      const tz = f.step.from.z + (f.step.to.z - f.step.from.z) * e;
      const ty = RAD[f.j] + Math.sin(s * Math.PI) * 0.11 * (0.4 + tone * 0.6);
      const ix = f.j * 3;
      p[ix] += (tx - p[ix]) * 0.6; p[ix + 1] += (ty - p[ix + 1]) * 0.6; p[ix + 2] += (tz - p[ix + 2]) * 0.6;
      // Knie beim Schritt nach vorn/oben fuehren
      const kx = f.k * 3;
      p[kx + 1] += Math.sin(s * Math.PI) * 0.01;
      if (s >= 1) { f.pos.set(p[ix], RAD[f.j], p[ix + 2]); f.planted = true; f.step = null; this.events.push({ joint: -1, speed: 0.4, x: p[ix], z: p[ix + 2], step: true }); }
    }
  }

  pinFeet() {
    if (this.phase !== 'balance') return;
    const p = this.p, o = this.o;
    for (const f of this.feet) {
      if (!f.planted) { this.mass[f.j] = MASS[f.j]; continue; }
      this.mass[f.j] = 60; // gepflanzter Fuss traegt
      const ix = f.j * 3;
      p[ix] = f.pos.x; p[ix + 1] = f.pos.y; p[ix + 2] = f.pos.z;
      o[ix] = f.pos.x; o[ix + 1] = f.pos.y; o[ix + 2] = f.pos.z;
    }
  }

  // Oberkoerper aufrecht halten, um die Wunde kruemmen, Kopf schuetzen
  posture(h, F, c) {
    const p = this.p, tone = this.tone;
    if (tone < 0.02) return;
    // Kruemmungsrichtung: nach vorn (Bauch/Brust) gemischt mit Bewegungsrichtung
    const fx = F.z.x, fz = F.z.z, fl = Math.hypot(fx, fz) || 1;
    let lx = fx / fl * this.hunch + c.vx * 0.08, lz = fz / fl * this.hunch + c.vz * 0.08;
    const ll = Math.hypot(lx, lz);
    const ang = Math.min(0.9, ll);
    if (ll > 1e-4) { lx /= ll; lz /= ll; }
    const ux = Math.sin(ang) * lx, uy = Math.cos(ang), uz = Math.sin(ang) * lz;
    const P = J.P * 3;
    const tgt = (j, d) => [p[P] + ux * d, p[P + 1] + uy * d, p[P + 2] + uz * d];
    const k = 0.16 * tone;
    for (const [j, d, kk] of [[J.C, 0.45, 1], [J.N, 0.55, 0.9], [J.H, 0.66, 0.7]]) {
      const [tx, ty, tz] = tgt(j, d);
      const ix = j * 3;
      p[ix] += (tx - p[ix]) * k * kk; p[ix + 1] += (ty - p[ix + 1]) * k * kk; p[ix + 2] += (tz - p[ix + 2]) * k * kk;
    }
    // Arme behalten etwas Spannung (Ausgangspose relativ zum Torso)
    for (const j of [J.EL, J.ER, J.HL, J.HR]) {
      const lx2 = this.local[j * 3], ly2 = this.local[j * 3 + 1], lz2 = this.local[j * 3 + 2];
      const tx = F.o.x + F.x.x * lx2 + F.y.x * ly2 + F.z.x * lz2, ty = F.o.y + F.x.y * lx2 + F.y.y * ly2 + F.z.y * lz2, tz = F.o.z + F.x.z * lx2 + F.y.z * ly2 + F.z.z * lz2;
      const kk = 0.05 * tone;
      p[j * 3] += (tx - p[j * 3]) * kk; p[j * 3 + 1] += (ty - p[j * 3 + 1]) * kk; p[j * 3 + 2] += (tz - p[j * 3 + 2]) * kk;
    }
    // Kopf schuetzen beim Fallen nach hinten: Kinn zur Brust
    const back = -(c.vx * F.z.x + c.vz * F.z.z);
    if (this.phase === 'fall' && back > 0.6) {
      const hx = p[J.N * 3] + F.z.x * 0.1, hy = p[J.N * 3 + 1] + F.y.y * 0.08, hz = p[J.N * 3 + 2] + F.z.z * 0.1;
      p[J.H * 3] += (hx - p[J.H * 3]) * 0.08; p[J.H * 3 + 1] += (hy - p[J.H * 3 + 1]) * 0.08; p[J.H * 3 + 2] += (hz - p[J.H * 3 + 2]) * 0.08;
    }
  }

  // Haende: Wundgriff, freier Arm rudert/faengt ab
  hands(h, F) {
    const p = this.p, o = this.o;
    const cl = this.clutch;
    const clutchOn = cl && this.t < cl.until && this.phase !== 'limp';
    if (clutchOn) {
      const w = Math.min(1, this.t * 5) * 0.2;
      const [lx, ly, lz] = cl.lp;
      const tx = F.o.x + F.x.x * lx + F.y.x * ly + F.z.x * lz, ty = F.o.y + F.x.y * lx + F.y.y * ly + F.z.y * lz, tz = F.o.z + F.x.z * lx + F.y.z * ly + F.z.z * lz;
      for (const hand of [cl.hand, cl.hand2]) {
        if (hand === undefined) continue;
        p[hand * 3] += (tx - p[hand * 3]) * w; p[hand * 3 + 1] += (ty - p[hand * 3 + 1]) * w; p[hand * 3 + 2] += (tz - p[hand * 3 + 2]) * w;
      }
    }
    const vcy = (p[J.C * 3 + 1] - o[J.C * 3 + 1]) / H;
    for (const hand of [J.HL, J.HR]) {
      if (clutchOn && (hand === cl.hand || hand === cl.hand2)) continue;
      const side = hand === J.HL ? 1 : -1;
      let tx, ty, tz, w;
      if (this.phase === 'balance') {
        // Rudern: Arm seitlich gegen die Kipprichtung heben
        const c = this._com;
        tx = p[J.C * 3] + F.x.x * side * 0.45 - c.vx * 0.12; ty = p[J.C * 3 + 1] - 0.05 + Math.sin(this.t * 9 + side) * 0.06; tz = p[J.C * 3 + 2] + F.x.z * side * 0.45 - c.vz * 0.12;
        w = 0.06 * this.tone;
      } else if (this.phase === 'fall' && vcy < -0.8 && p[J.C * 3 + 1] < 1.2) {
        // Sturz abfangen: Haende Richtung Boden in Fallrichtung
        const vx = p[J.C * 3] - o[J.C * 3], vz = p[J.C * 3 + 2] - o[J.C * 3 + 2], vl = Math.hypot(vx, vz) || 1;
        tx = p[J.C * 3] + vx / vl * 0.45 + F.x.x * side * 0.2; ty = 0.05; tz = p[J.C * 3 + 2] + vz / vl * 0.45 + F.x.z * side * 0.2;
        w = 0.07 * Math.max(0.3, this.tone);
      } else continue;
      p[hand * 3] += (tx - p[hand * 3]) * w; p[hand * 3 + 1] += (ty - p[hand * 3 + 1]) * w; p[hand * 3 + 2] += (tz - p[hand * 3 + 2]) * w;
    }
  }

  // Am Boden kruemmen: Knie anziehen im Wechsel, Kopf leicht heben, langsam abklingend
  writhe(h, F) {
    const p = this.p;
    const k = Math.max(0, 1 - (this.t - this.groundT) / this.writheT);
    const s = this.t * 2.2;
    for (const [hp, kn, ft, ph] of [[J.HPL, J.KL, J.FL, 0], [J.HPR, J.KR, J.FR, 1.9]]) {
      const pull = (Math.sin(s + ph) * 0.5 + 0.5) * 0.06 * k;
      // Knie Richtung Brust ziehen
      const tx = p[J.C * 3], tz = p[J.C * 3 + 2];
      p[kn * 3] += (tx - p[kn * 3]) * pull; p[kn * 3 + 2] += (tz - p[kn * 3 + 2]) * pull;
      p[ft * 3] += (p[hp * 3] - p[ft * 3]) * pull * 0.6; p[ft * 3 + 2] += (p[hp * 3 + 2] - p[ft * 3 + 2]) * pull * 0.6;
    }
    p[J.H * 3 + 1] += 0.0012 * k * (Math.sin(s * 0.7) * 0.5 + 0.5);
    if (this.clutch) this.clutch.until = Math.max(this.clutch.until, this.t + 0.1);
    if (k <= 0 && this.clutch) this.clutch.until = 0;
  }

  solve(a, b, rest, stiff, minOnly) {
    const p = this.p;
    const ax = a * 3, bx = b * 3;
    const dx = p[bx] - p[ax], dy = p[bx + 1] - p[ax + 1], dz = p[bx + 2] - p[ax + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (minOnly && d >= rest) return;
    const diff = (d - rest) / d * stiff;
    const wa = 1 / this.mass[a], wb = 1 / this.mass[b], ws = wa + wb;
    const ka = diff * wa / ws, kb = diff * wb / ws;
    p[ax] += dx * ka; p[ax + 1] += dy * ka; p[ax + 2] += dz * ka;
    p[bx] -= dx * kb; p[bx + 1] -= dy * kb; p[bx + 2] -= dz * kb;
  }

  kneeHinge() {
    const p = this.p;
    const F = this.frame(p, this._fr);
    for (const [hp, kn, ft] of [[J.HPL, J.KL, J.FL], [J.HPR, J.KR, J.FR]]) {
      const mx = (p[hp * 3] + p[ft * 3]) / 2, my = (p[hp * 3 + 1] + p[ft * 3 + 1]) / 2, mz = (p[hp * 3 + 2] + p[ft * 3 + 2]) / 2;
      _v.set(p[kn * 3] - mx, p[kn * 3 + 1] - my, p[kn * 3 + 2] - mz);
      const f = _v.dot(F.z);
      if (f < 0.02) { const c = 0.02 - f; p[kn * 3] += F.z.x * c * 0.5; p[kn * 3 + 1] += F.z.y * c * 0.5; p[kn * 3 + 2] += F.z.z * c * 0.5; }
    }
  }

  collide(friction) {
    const p = this.p, o = this.o;
    const B = this.boxes;
    for (let i = 0; i < NJ; i++) {
      const ix = i * 3, r = RAD[i];
      if (p[ix + 1] < r) {
        const vy = (p[ix + 1] - o[ix + 1]) / H;
        if ((i === J.P || i === J.C || i === J.H) && !this.impacted[i] && vy < -1.6) { this.impacted[i] = true; this.events.push({ joint: i, speed: -vy, x: p[ix], z: p[ix + 2] }); }
        p[ix + 1] = r;
        if (friction) {
          o[ix] = p[ix] - (p[ix] - o[ix]) * 0.4; o[ix + 2] = p[ix + 2] - (p[ix + 2] - o[ix + 2]) * 0.4;
          if (o[ix + 1] < p[ix + 1]) o[ix + 1] = p[ix + 1];
        }
      }
      for (let k = 0; k < B.length; k++) {
        const b = B[k];
        if (!b.solid || b.max[1] < 0.02) continue;
        const x = p[ix], y = p[ix + 1], z = p[ix + 2];
        if (x < b.min[0] - r || x > b.max[0] + r || y < b.min[1] - r || y > b.max[1] + r || z < b.min[2] - r || z > b.max[2] + r) continue;
        const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cy = Math.max(b.min[1], Math.min(y, b.max[1])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k2 = (r - d) / d;
          p[ix] += dx * k2; p[ix + 1] += dy * k2; p[ix + 2] += dz * k2;
        } else {
          let best = 0, bestOut = -1e9, side = 0;
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
            p[ix + (m >> 1)] += ((m & 1) ? 1 : -1) * (pen[m] + r);
          }
          // Positionskorrektur nicht als Geschwindigkeit uebernehmen
          o[ix] = p[ix]; o[ix + 1] = p[ix + 1]; o[ix + 2] = p[ix + 2];
        }
        if (friction) { o[ix] = p[ix] - (p[ix] - o[ix]) * 0.6; o[ix + 2] = p[ix + 2] - (p[ix + 2] - o[ix + 2]) * 0.6; o[ix + 1] = p[ix + 1] - (p[ix + 1] - o[ix + 1]) * 0.6; }
      }
      for (const d of this.world.doors) {
        const pos = { x: p[ix], z: p[ix + 2] };
        if (p[ix + 1] < d.height && d.pushCircle(pos, r, p[ix + 1], p[ix + 1])) { p[ix] = pos.x; p[ix + 2] = pos.z; }
      }
    }
  }

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
    for (let k = 0; k < 3; k++) {
      const dx = g.p[3] - g.p[0], dy = g.p[4] - g.p[1], dz = g.p[5] - g.p[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, df = (d - g.len) / d * 0.5;
      g.p[0] += dx * df; g.p[1] += dy * df; g.p[2] += dz * df; g.p[3] -= dx * df; g.p[4] -= dy * df; g.p[5] -= dz * df;
    }
    if (g.t > 3) g.rest = true;
  }

  centre(out) { return out.set(this.p[0], this.p[1], this.p[2]); }
}
