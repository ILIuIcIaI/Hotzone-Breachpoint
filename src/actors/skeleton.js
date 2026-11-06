// Menschliche Figur: 16 Gelenke als Punktwolke. Lebend: prozedurale Pose mit IK.
// Tot: dieselben Punkte werden zur Verlet-Ragdoll -> nahtloser Uebergang.
import * as THREE from 'three';
import { probeify, makeProbe } from '../engine/materials.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const J = { P: 0, C: 1, N: 2, H: 3, SL: 4, EL: 5, HL: 6, SR: 7, ER: 8, HR: 9, HPL: 10, KL: 11, FL: 12, HPR: 13, KR: 14, FR: 15 };
export const NJ = 16;
export const LEN = { spine: 0.45, neck: 0.1, head: 0.13, sh: 0.19, ua: 0.29, fa: 0.27, hip: 0.1, th: 0.44, sn: 0.44 };

// Knochen (Paare) fuer Ragdoll-Constraints & Hitboxen
export const BONES = [
  [J.P, J.C], [J.C, J.N], [J.N, J.H], [J.C, J.SL], [J.C, J.SR], [J.SL, J.EL], [J.EL, J.HL], [J.SR, J.ER], [J.ER, J.HR],
  [J.P, J.HPL], [J.P, J.HPR], [J.HPL, J.KL], [J.KL, J.FL], [J.HPR, J.KR], [J.KR, J.FR],
];

// Hitbox-Kapseln: [a, b, radius, zone]
export const HITBOXES = [
  [J.P, J.N, 0.165, 'torso'], [J.N, J.H, 0.11, 'head'],
  [J.SL, J.EL, 0.055, 'arm'], [J.EL, J.HL, 0.05, 'arm'], [J.SR, J.ER, 0.055, 'arm'], [J.ER, J.HR, 0.05, 'arm'],
  [J.HPL, J.KL, 0.08, 'leg'], [J.KL, J.FL, 0.065, 'leg'], [J.HPR, J.KR, 0.08, 'leg'], [J.KR, J.FR, 0.065, 'leg'],
];

const V = THREE.Vector3;
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _p = new V(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new V(0, 1, 0);

export function getJ(arr, i, out) { return out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]); }
export function setJ(arr, i, v) { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }

// Zwei-Knochen-IK: A Wurzel, C Ziel, Ergebnis Gelenk B (C wird ggf. auf Reichweite gekuerzt)
export function ik2(A, C, l1, l2, pole, outB) {
  _a.subVectors(C, A);
  let L = _a.length();
  const maxL = l1 + l2 - 1e-3, minL = Math.abs(l1 - l2) + 1e-3;
  if (L < 1e-5) { _a.set(0, -1, 0); L = minL; }
  _a.divideScalar(L);
  if (L > maxL) { L = maxL; C.copy(A).addScaledVector(_a, L); }
  if (L < minL) { L = minL; C.copy(A).addScaledVector(_a, L); }
  const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_a, -_a.z);
  _b.normalize();
  outB.copy(A).addScaledVector(_a, a).addScaledVector(_b, h);
  return outB;
}

// ---------------- Pose ----------------
const P0 = new V(), CH = new V(), NK = new V(), HD = new V(), SL = new V(), SR = new V(), EL = new V(), ER = new V(), HL = new V(), HR = new V();
const HPL = new V(), HPR = new V(), KL = new V(), KR = new V(), FL = new V(), FR = new V();
const fwd = new V(), right = new V(), aF = new V(), aR = new V(), upS = new V(), md = new V(), pole = new V(), tmp = new V();

export function computePose(out, s, gunOut) {
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  fwd.set(sy, 0, cy); right.set(-cy, 0, sy);
  const cp = Math.cos(s.aimPitch), sp = Math.sin(s.aimPitch);
  aF.set(Math.sin(s.aimYaw) * cp, sp, Math.cos(s.aimYaw) * cp);
  aR.set(-Math.cos(s.aimYaw), 0, Math.sin(s.aimYaw));
  const aFh = tmp.set(Math.sin(s.aimYaw), 0, Math.cos(s.aimYaw));
  const c = s.crouch;
  const kneel = s.stance === 'kneel_handsup' || s.stance === 'cuffed' || s.stance === 'tied';
  const moving = s.speed > 0.05 && !kneel;
  md.set(Math.sin(s.moveDir), 0, Math.cos(s.moveDir));
  const ph = s.phase;
  // Becken
  let py;
  if (kneel) py = 0.53;
  else py = 0.95 - c * 0.4 + (moving ? -0.025 + 0.025 * Math.cos(ph * 2) : 0) + Math.sin(s.t * 1.7) * 0.004;
  P0.set(s.x, py, s.z).addScaledVector(fwd, kneel ? -0.04 : c * 0.06);
  // Wirbelsaeule
  let tilt = 0.06 + c * 0.32 + (moving ? Math.min(0.12, s.speed * 0.03) : 0);
  if (s.stance === 'rifle' && s.aiming) tilt += 0.06 + Math.max(0, -s.aimPitch) * 0.25;
  if (s.stance === 'cower') tilt += 0.5;
  if (s.stance === 'cuffed' || s.stance === 'tied') tilt = 0.12;
  if (s.stance === 'stunned') tilt = 0.35 + Math.sin(s.t * 3) * 0.1;
  upS.set(0, Math.cos(tilt), 0).addScaledVector(aFh, Math.sin(tilt)).addScaledVector(aR, s.lean * 0.32).normalize();
  CH.copy(P0).addScaledVector(upS, LEN.spine);
  if (s.flinch) CH.add(s.flinch);
  NK.copy(CH).addScaledVector(upS, LEN.neck);
  HD.copy(NK).addScaledVector(upS, LEN.head * 0.8).addScaledVector(aF, 0.035);
  if (s.flinch) HD.addScaledVector(s.flinch, 0.6);
  if (s.stance === 'cower') HD.y -= 0.05;
  SL.copy(CH).addScaledVector(aR, -LEN.sh).addScaledVector(upS, -0.035);
  SR.copy(CH).addScaledVector(aR, LEN.sh).addScaledVector(upS, -0.035);
  HPL.copy(P0).addScaledVector(right, -LEN.hip).y -= 0.05;
  HPR.copy(P0).addScaledVector(right, LEN.hip).y -= 0.05;

  // Beine
  if (kneel) {
    for (const [H, K, F, side] of [[HPL, KL, FL, -1], [HPR, KR, FR, 1]]) {
      K.copy(H).addScaledVector(fwd, 0.14).addScaledVector(right, side * 0.04); K.y = 0.075;
      F.copy(K).addScaledVector(fwd, -0.42); F.y = 0.06;
    }
  } else {
    const stride = Math.min(0.4, s.speed * 0.2), lift = Math.min(0.15, s.speed * 0.055);
    const sides = [[HPL, KL, FL, -1, 0], [HPR, KR, FR, 1, Math.PI]];
    for (const [H, K, F, side, off] of sides) {
      const q = ph + off;
      const o = moving ? Math.sin(q) * stride : 0;
      const l = moving ? Math.max(0, Math.cos(q)) * lift : 0;
      F.set(H.x, 0.075 + l, H.z).addScaledVector(md, o).addScaledVector(right, side * 0.03);
      if (c > 0.05) F.addScaledVector(fwd, (side < 0 ? 0.22 : -0.18) * c);
      pole.copy(fwd).addScaledVector(right, side * 0.25);
      ik2(H, F, LEN.th, LEN.sn, pole, K);
    }
  }

  // Arme
  let gun = false;
  const st = s.stance;
  if (st === 'rifle' || st === 'pistol') {
    gun = true;
    let gy = s.aimYaw, gp = s.aimPitch;
    if (!s.aiming) { gp = -0.75; gy = s.aimYaw + (st === 'rifle' ? 0.45 : 0.2); }
    const G = _c.set(Math.sin(gy) * Math.cos(gp), Math.sin(gp), Math.cos(gy) * Math.cos(gp));
    if (st === 'rifle') {
      HR.copy(SR).addScaledVector(G, 0.17).addScaledVector(upS, -0.075).addScaledVector(aR, -0.02);
      HL.copy(HR).addScaledVector(G, 0.33).addScaledVector(upS, 0.03).addScaledVector(aR, -0.05);
    } else {
      HR.copy(CH).addScaledVector(G, s.aiming ? 0.5 : 0.3).addScaledVector(upS, s.aiming ? -0.02 : -0.2).addScaledVector(aR, 0.03);
      HL.copy(HR).addScaledVector(aR, -0.04).addScaledVector(upS, -0.02).addScaledVector(G, -0.02);
    }
    if (s.recoil) { HR.addScaledVector(G, -s.recoil); HL.addScaledVector(G, -s.recoil * 0.8); }
    if (gunOut) { gunOut.pos.copy(HR); gunOut.dir.copy(G); gunOut.up.copy(upS); }
    pole.copy(UP).multiplyScalar(-1).addScaledVector(aR, 0.9).addScaledVector(aF, -0.3);
    ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    pole.copy(UP).multiplyScalar(-1).addScaledVector(aR, -0.7);
    ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
  } else {
    if (st === 'handsup' || st === 'kneel_handsup') {
      HL.copy(SL).addScaledVector(UP, 0.4).addScaledVector(aR, -0.12).addScaledVector(aFh, 0.12);
      HR.copy(SR).addScaledVector(UP, 0.4).addScaledVector(aR, 0.12).addScaledVector(aFh, 0.12);
      pole.copy(aR).multiplyScalar(-1).addScaledVector(UP, -0.5);
      ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
      pole.copy(aR).addScaledVector(UP, -0.5);
      ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    } else if (st === 'cuffed' || st === 'tied') {
      HL.copy(P0).addScaledVector(fwd, -0.2).addScaledVector(right, -0.05).y += 0.08;
      HR.copy(P0).addScaledVector(fwd, -0.2).addScaledVector(right, 0.05).y += 0.08;
      pole.copy(fwd).multiplyScalar(-1).addScaledVector(right, -0.6);
      ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
      pole.copy(fwd).multiplyScalar(-1).addScaledVector(right, 0.6);
      ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    } else if (st === 'cower') {
      HL.copy(HD).addScaledVector(aR, -0.1).addScaledVector(UP, 0.08).addScaledVector(aFh, 0.02);
      HR.copy(HD).addScaledVector(aR, 0.1).addScaledVector(UP, 0.08).addScaledVector(aFh, 0.02);
      pole.copy(aR).multiplyScalar(-1).addScaledVector(aFh, 0.6);
      ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
      pole.copy(aR).addScaledVector(aFh, 0.6);
      ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    } else if (st === 'stunned') {
      HL.copy(HD).addScaledVector(aFh, 0.11).addScaledVector(aR, -0.05).y -= 0.03;
      HR.copy(HD).addScaledVector(aFh, 0.11).addScaledVector(aR, 0.05).y -= 0.03;
      pole.copy(UP).multiplyScalar(-1).addScaledVector(aR, -0.5);
      ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
      pole.copy(UP).multiplyScalar(-1).addScaledVector(aR, 0.5);
      ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    } else {
      // haengende Arme mit leichtem Pendeln
      const sw = moving ? Math.sin(ph) * 0.18 * Math.min(1, s.speed) : 0;
      HL.copy(SL).addScaledVector(UP, -0.52).addScaledVector(aR, -0.05).addScaledVector(fwd, 0.06 - sw);
      HR.copy(SR).addScaledVector(UP, -0.52).addScaledVector(aR, 0.05).addScaledVector(fwd, 0.06 + sw);
      pole.copy(fwd).multiplyScalar(-1).addScaledVector(UP, 0.2);
      ik2(SL, HL, LEN.ua, LEN.fa, pole, EL);
      ik2(SR, HR, LEN.ua, LEN.fa, pole, ER);
    }
  }
  setJ(out, J.P, P0); setJ(out, J.C, CH); setJ(out, J.N, NK); setJ(out, J.H, HD);
  setJ(out, J.SL, SL); setJ(out, J.EL, EL); setJ(out, J.HL, HL);
  setJ(out, J.SR, SR); setJ(out, J.ER, ER); setJ(out, J.HR, HR);
  setJ(out, J.HPL, HPL); setJ(out, J.KL, KL); setJ(out, J.FL, FL);
  setJ(out, J.HPR, HPR); setJ(out, J.KR, KR); setJ(out, J.FR, FR);
  return gun;
}

// ---------------- Mesh ----------------
const capCache = new Map();
function capsule(r, len) {
  const k = r.toFixed(3) + '_' + len.toFixed(3);
  if (!capCache.has(k)) capCache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
  return capCache.get(k);
}

export const LOOKS = {
  suspect: [
    { top: 0x2b2f36, pants: 0x2a3140, shoes: 0x151515, head: 'balaclava', skin: 0xb08066, vest: false, gloves: 0x1a1a1a },
    { top: 0x4a3b2c, pants: 0x30343a, shoes: 0x1c1712, head: 'balaclava', skin: 0x8d5f45, vest: false, gloves: 0x111111 },
    { top: 0x253025, pants: 0x232628, shoes: 0x121212, head: 'cap', skin: 0xc49a7c, vest: false, gloves: null },
    { top: 0x5a1f22, pants: 0x1f2633, shoes: 0x141414, head: 'balaclava', skin: 0xa6765a, vest: false, gloves: 0x1a1a1a },
  ],
  hostage: [
    { top: 0xc9ced6, pants: 0x2c3442, shoes: 0x2a1c12, head: 'hair', skin: 0xd8b294, hair: 0x3b2a1e, tie: 0x7a1f2a },
    { top: 0x8aa3c2, pants: 0x3a3a3e, shoes: 0x111111, head: 'hair', skin: 0xb98a6c, hair: 0x101010 },
    { top: 0xe8e2d4, pants: 0x4a4038, shoes: 0x3a2618, head: 'hair', skin: 0xe2bfa2, hair: 0x9c7a4a },
  ],
  civilian: [
    { top: 0x6f7f5a, pants: 0x34302c, shoes: 0x1a1a1a, head: 'hair', skin: 0xc8a080, hair: 0x2a1c14 },
    { top: 0x3a4f6a, pants: 0x222831, shoes: 0x1a1a1a, head: 'hair', skin: 0x8a5a40, hair: 0x0e0e0e },
  ],
};

export class BodyMesh {
  constructor(look, opts = {}) {
    this.group = new THREE.Group();
    this.probe = makeProbe();
    const mk = (color, rough = 0.85, metal = 0) => probeify(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), this.probe);
    this.mats = {
      skin: mk(look.skin, 0.6), top: mk(look.top, 0.95), pants: mk(look.pants, 0.95), shoes: mk(look.shoes, 0.7),
      gloves: mk(look.gloves ?? look.skin, look.gloves ? 0.7 : 0.6), hair: mk(look.hair ?? 0x111111, 0.9),
      vest: mk(0x23262a, 1.0), mask: mk(0x141516, 0.95), tie: mk(look.tie ?? look.top, 0.6),
    };
    this.parts = [];
    this._f = new V(); this._rn = new V(); this._hr = new V(); this._hl = new V();
    const add = (geo, mat, a, b, kind = 'seg', extra = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.parts.push({ mesh: m, a, b, kind, ...extra });
      return m;
    };
    // Torso (breite Kapsel)
    add(capsule(0.15, LEN.spine + LEN.neck - 0.18), this.mats.top, J.P, J.N, 'torso', { sx: 1.3, sz: 0.78, off: 0.02 });
    if (look.vest || opts.armor) add(new RoundedBoxGeometry(0.4, 0.38, 0.27, 3, 0.07), this.mats.vest, J.P, J.N, 'vest');
    if (look.tie) add(new THREE.BoxGeometry(0.05, 0.3, 0.02), this.mats.tie, J.P, J.N, 'tie');
    // Becken
    add(capsule(0.12, 0.12), this.mats.pants, J.HPL, J.HPR, 'pelvis', { sx: 1.0, sz: 0.85 });
    // Hals + Kopf
    add(capsule(0.05, 0.06), this.mats.skin, J.N, J.H, 'seg');
    add(new THREE.SphereGeometry(0.105, 14, 12), look.head === 'balaclava' ? this.mats.mask : this.mats.skin, J.N, J.H, 'head');
    if (look.head === 'hair') add(new THREE.SphereGeometry(0.112, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.mats.hair, J.N, J.H, 'hair');
    if (look.head === 'cap') {
      add(new THREE.SphereGeometry(0.113, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), this.mats.top, J.N, J.H, 'hair');
      add(new THREE.BoxGeometry(0.16, 0.012, 0.09), this.mats.top, J.N, J.H, 'brim');
    }
    if (look.head === 'balaclava') add(new THREE.BoxGeometry(0.13, 0.03, 0.02), this.mats.skin, J.N, J.H, 'eyes');
    // Arme
    add(capsule(0.052, LEN.ua), this.mats.top, J.SL, J.EL); add(capsule(0.044, LEN.fa - 0.03), this.mats.top, J.EL, J.HL);
    add(capsule(0.052, LEN.ua), this.mats.top, J.SR, J.ER); add(capsule(0.044, LEN.fa - 0.03), this.mats.top, J.ER, J.HR);
    add(new THREE.BoxGeometry(0.075, 0.1, 0.035), this.mats.gloves, J.EL, J.HL, 'hand');
    add(new THREE.BoxGeometry(0.075, 0.1, 0.035), this.mats.gloves, J.ER, J.HR, 'hand');
    // Beine
    add(capsule(0.075, LEN.th - 0.04), this.mats.pants, J.HPL, J.KL); add(capsule(0.058, LEN.sn - 0.06), this.mats.pants, J.KL, J.FL);
    add(capsule(0.075, LEN.th - 0.04), this.mats.pants, J.HPR, J.KR); add(capsule(0.058, LEN.sn - 0.06), this.mats.pants, J.KR, J.FR);
    add(new THREE.BoxGeometry(0.1, 0.075, 0.26), this.mats.shoes, J.KL, J.FL, 'foot');
    add(new THREE.BoxGeometry(0.1, 0.075, 0.26), this.mats.shoes, J.KR, J.FR, 'foot');
  }

  // Meshes an Gelenkpositionen ausrichten. headFwd optional (Blickrichtung)
  update(Jt, headFwd) {
    // Torso-Basis
    const p = getJ(Jt, J.P, _a), n = getJ(Jt, J.N, _b);
    const up = _c.subVectors(n, p).normalize();
    const r = getJ(Jt, J.SR, _d).sub(getJ(Jt, J.SL, _p));
    r.addScaledVector(up, -r.dot(up)).normalize();
    const f = this._f.crossVectors(up, r); // vorwaerts
    const rn = this._rn.copy(r).negate();  // rechtshaendige Basis (x = links)
    // Hueft-Basis
    const hr = getJ(Jt, J.HPR, this._hr).sub(getJ(Jt, J.HPL, this._hl)).normalize();
    for (const part of this.parts) {
      const m = part.mesh;
      const A = getJ(Jt, part.a, _p), B = getJ(Jt, part.b, tmp);
      if (part.kind === 'seg') {
        const dir = _q.setFromUnitVectors(UP, md.subVectors(B, A).normalize());
        m.matrix.compose(_p.addVectors(A, B).multiplyScalar(0.5), dir, ONE);
      } else if (part.kind === 'torso' || part.kind === 'vest' || part.kind === 'tie') {
        _m.makeBasis(rn, up, f);
        const q = _q.setFromRotationMatrix(_m);
        const mid = _p.addVectors(A, B).multiplyScalar(0.5);
        if (part.kind === 'torso') { mid.addScaledVector(up, -0.02); m.matrix.compose(mid, q, SC.set(part.sx, 1, part.sz)); }
        else if (part.kind === 'vest') { mid.addScaledVector(up, 0.06).addScaledVector(f, 0.01); m.matrix.compose(mid, q, ONE); }
        else { mid.addScaledVector(up, 0.08).addScaledVector(f, 0.125); m.matrix.compose(mid, q, ONE); }
      } else if (part.kind === 'pelvis') {
        const mid = _p.addVectors(A, B).multiplyScalar(0.5);
        const pf = tmp2.crossVectors(hr, up).normalize();
        // Kapsel liegt quer (entlang Huefte)
        _m.makeBasis(tmp3.crossVectors(hr, pf), hr, pf);
        m.matrix.compose(mid.addScaledVector(UP, 0.03), _q.setFromRotationMatrix(_m), SC.set(1, 1, 0.85));
      } else if (part.kind === 'head' || part.kind === 'hair' || part.kind === 'eyes' || part.kind === 'brim') {
        const hu = md.subVectors(B, A).normalize();
        const hf = headFwd ? tmp2.copy(headFwd) : tmp2.copy(f);
        hf.addScaledVector(hu, -hf.dot(hu)).normalize();
        const hrt = tmp3.crossVectors(hu, hf);
        _m.makeBasis(hrt, hu, hf);
        const q = _q.setFromRotationMatrix(_m);
        const c = tmp4.copy(B).addScaledVector(hu, 0.02);
        if (part.kind === 'head') m.matrix.compose(c, q, SC.set(0.92, 1.1, 1.0));
        else if (part.kind === 'hair') m.matrix.compose(c.addScaledVector(hu, 0.012).addScaledVector(hf, -0.008), q, SC.set(0.95, 1.08, 1.04));
        else if (part.kind === 'eyes') m.matrix.compose(c.addScaledVector(hu, 0.025).addScaledVector(hf, 0.098), q, ONE);
        else m.matrix.compose(c.addScaledVector(hu, 0.06).addScaledVector(hf, 0.1), q, ONE);
      } else if (part.kind === 'hand') {
        const d = md.subVectors(B, A).normalize();
        const side = tmp2.copy(r).addScaledVector(d, -r.dot(d)).normalize();
        const fw = tmp3.crossVectors(side, d);
        _m.makeBasis(side, d, fw);
        m.matrix.compose(tmp4.copy(B).addScaledVector(d, 0.04), _q.setFromRotationMatrix(_m), ONE);
      } else if (part.kind === 'foot') {
        const shin = md.subVectors(A, B).normalize(); // nach oben
        const ff = tmp2.copy(f).addScaledVector(shin, -f.dot(shin));
        if (ff.lengthSq() < 1e-4) ff.copy(f);
        ff.normalize();
        const side = tmp3.crossVectors(shin, ff);
        _m.makeBasis(side, shin, ff);
        m.matrix.compose(tmp4.copy(B).addScaledVector(ff, 0.06).addScaledVector(shin, -0.03), _q.setFromRotationMatrix(_m), ONE);
      }
      m.matrixWorldNeedsUpdate = true;
    }
  }

  setVisible(v) { this.group.visible = v; }
  dispose() {}
}
const ONE = new V(1, 1, 1);
const SC = new V();
const tmp2 = new V(), tmp3 = new V(), tmp4 = new V();

// Einfaches Gewehr-/Pistolenmodell fuer NPCs
export function buildNpcGun(kind) {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.5 });
  const probe = makeProbe();
  probeify(black, probe);
  g.userData.probe = probe;
  const add = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), black); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
  if (kind === 'pistol') {
    add(0.03, 0.035, 0.19, 0, 0.045, 0.06); add(0.028, 0.11, 0.045, 0, -0.01, -0.005);
    g.userData.muzzle = new V(0, 0.05, 0.16); g.userData.length = 0.2;
  } else if (kind === 'smg') {
    add(0.045, 0.07, 0.36, 0, 0.05, 0.12); add(0.03, 0.1, 0.04, 0, -0.02, 0.0); add(0.03, 0.15, 0.035, 0, -0.03, 0.14);
    add(0.02, 0.02, 0.12, 0, 0.06, 0.36); add(0.03, 0.05, 0.16, 0, 0.04, -0.13);
    g.userData.muzzle = new V(0, 0.06, 0.42); g.userData.length = 0.6;
  } else {
    add(0.05, 0.08, 0.5, 0, 0.06, 0.15); add(0.03, 0.1, 0.045, 0, -0.02, 0.0); add(0.035, 0.18, 0.07, 0, -0.04, 0.13);
    add(0.022, 0.022, 0.3, 0, 0.07, 0.55); add(0.04, 0.09, 0.22, 0, 0.05, -0.2);
    g.userData.muzzle = new V(0, 0.07, 0.7); g.userData.length = 0.95;
  }
  return g;
}
