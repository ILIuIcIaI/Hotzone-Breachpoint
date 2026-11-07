// Durchgehender, verformbarer Figurenkoerper (SkinnedMesh) auf Basis der 16 Gelenkpunkte.
// Gleiche Gelenke fuer lebende Pose und Ragdoll -> Koerper verformt sich in beiden Faellen korrekt.
// Alles prozedural: Rumpf/Arme/Beine als Lofts mit Querschnittsprofilen, Kopf mit Gesichtsform,
// Kleidung, Handschuhe, Stiefel, Schutzweste mit Taschen.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { J, NJ, computePose, getJ } from './skeleton.js';
import { probeify, makeProbe } from '../engine/materials.js';

const V = THREE.Vector3;
// Knochen
export const B = { pelvis: 0, spineLow: 1, spineUp: 2, neck: 3, head: 4, uaL: 5, faL: 6, handL: 7, uaR: 8, faR: 9, handR: 10, thL: 11, shL: 12, footL: 13, thR: 14, shR: 15, footR: 16 };
const NB = 17;

const _a = new V(), _b = new V(), _r = new V(), _hr = new V(), _f = new V(), _y = new V(), _x = new V(), _z = new V(), _s = new V(), _t = new V();
const DOWN = new V(0, -1, 0);

// Rahmen eines Knochens: y entlang Segment, x = Seitenreferenz orthogonalisiert, z = x * y
function frame(out, pos, y, side, fallback) {
  _y.copy(y).normalize();
  let d = side.dot(_y);
  _x.copy(side).addScaledVector(_y, -d);
  if (_x.lengthSq() < 0.04 && fallback) { _x.copy(fallback).addScaledVector(_y, -fallback.dot(_y)); }
  _x.normalize();
  _z.crossVectors(_x, _y);
  out.makeBasis(_x, _y, _z).setPosition(pos);
  return out;
}

// Alle Knochenmatrizen aus Gelenkpositionen
export function boneFrames(Jt, headFwd, footBlend, mats) {
  const P = getJ(Jt, J.P, new V()), C = getJ(Jt, J.C, new V()), N = getJ(Jt, J.N, new V()), H = getJ(Jt, J.H, new V());
  const SL = getJ(Jt, J.SL, new V()), SR = getJ(Jt, J.SR, new V()), EL = getJ(Jt, J.EL, new V()), ER = getJ(Jt, J.ER, new V());
  const HL = getJ(Jt, J.HL, new V()), HR = getJ(Jt, J.HR, new V());
  const HPL = getJ(Jt, J.HPL, new V()), HPR = getJ(Jt, J.HPR, new V()), KL = getJ(Jt, J.KL, new V()), KR = getJ(Jt, J.KR, new V());
  const FL = getJ(Jt, J.FL, new V()), FR = getJ(Jt, J.FR, new V());
  const r = _r.subVectors(SR, SL).normalize();
  const up = new V().subVectors(N, P).normalize();
  const fwd = new V().crossVectors(up, r).normalize();
  const hr = _hr.subVectors(HPR, HPL).normalize();
  const hf = new V().crossVectors(new V(0, 1, 0), hr); // Hueft-vorwaerts (horizontal)
  if (hf.lengthSq() < 0.01) hf.copy(fwd);
  hf.normalize();
  frame(mats[B.pelvis], P, new V().subVectors(C, P), hr, fwd);
  frame(mats[B.spineLow], P, new V().subVectors(C, P), r, fwd);
  frame(mats[B.spineUp], C, new V().subVectors(N, C), r, fwd);
  frame(mats[B.neck], N, new V().subVectors(H, N), r, fwd);
  // Kopf
  const hu = new V().subVectors(H, N).normalize();
  const hfw = (headFwd ? headFwd.clone() : fwd.clone());
  const hside = new V().crossVectors(hu, hfw);
  if (hside.lengthSq() < 0.01) hside.copy(r);
  frame(mats[B.head], H, hu, hside.normalize(), r);
  // Arme
  frame(mats[B.uaL], SL, new V().subVectors(EL, SL), r, fwd);
  frame(mats[B.faL], EL, new V().subVectors(HL, EL), r, fwd);
  mats[B.handL].copy(mats[B.faL]).setPosition(HL);
  frame(mats[B.uaR], SR, new V().subVectors(ER, SR), r, fwd);
  frame(mats[B.faR], ER, new V().subVectors(HR, ER), r, fwd);
  mats[B.handR].copy(mats[B.faR]).setPosition(HR);
  // Beine
  frame(mats[B.thL], HPL, new V().subVectors(KL, HPL), hr, hf);
  frame(mats[B.shL], KL, new V().subVectors(FL, KL), hr, hf);
  frame(mats[B.thR], HPR, new V().subVectors(KR, HPR), hr, hf);
  frame(mats[B.shR], KR, new V().subVectors(FR, KR), hr, hf);
  // Fuesse: lebend eher senkrecht (flach auf dem Boden), tot entlang Schienbein
  const dl = new V().subVectors(FL, KL).normalize().lerp(DOWN, 1 - footBlend).normalize();
  const dr = new V().subVectors(FR, KR).normalize().lerp(DOWN, 1 - footBlend).normalize();
  frame(mats[B.footL], FL, dl, hr, hf);
  frame(mats[B.footR], FR, dr, hr, hf);
  return mats;
}

// ---------------- Geometrie-Bausteine ----------------
class Part {
  constructor() { this.pos = []; this.uv = []; this.si = []; this.sw = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  vert(p, u, v, w) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v);
    const ws = w.slice(0, 4); while (ws.length < 4) ws.push([0, 0]);
    let sum = 0; for (const [, x] of ws) sum += x;
    for (const [b, x] of ws) { this.si.push(b); this.sw.push(sum > 0 ? x / sum : 0); }
  }
  // fremde Geometrie (in Ruhepose transformiert) starr an einen Knochen haengen
  addGeo(geo, matrix, bone, w2) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position, uv = g.attributes.uv;
    const base = this.n;
    for (let i = 0; i < p.count; i++) {
      _t.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.vert(_t, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, w2 || [[bone, 1]]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
}

// Loft: Ringe mit Superellipsen-Querschnitt. rings: [{c, x, z, rx, rz, w}]
function loft(part, rings, segs, n = 2.4, capStart = false, capEnd = false, uScale = 1) {
  const base = part.n;
  let vlen = 0;
  for (let i = 0; i < rings.length; i++) {
    const R = rings[i];
    if (i > 0) vlen += R.c.distanceTo(rings[i - 1].c);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n), ez = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n);
      _t.copy(R.c).addScaledVector(R.x, ex * R.rx).addScaledVector(R.z, ez * R.rz);
      part.vert(_t, (k / segs) * uScale, vlen * 3, R.w);
    }
  }
  const S = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < segs; k++) {
    const a = base + i * S + k, b = a + 1, c = a + S, d = c + 1;
    part.idx.push(a, c, b, b, c, d);
  }
  const cap = (ri, flip) => {
    const R = rings[ri];
    const ci = part.n;
    part.vert(R.c, 0.5, 0.5, R.w);
    for (let k = 0; k < segs; k++) {
      const a = base + ri * S + k, b = a + 1;
      if (flip) part.idx.push(ci, a, b); else part.idx.push(ci, b, a);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(rings.length - 1, false);
}

const lerpW = (b1, b2, t) => (t <= 0 ? [[b1, 1]] : t >= 1 ? [[b2, 1]] : [[b1, 1 - t], [b2, t]]);
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- Koerper ----------------
export class SkinnedBody {
  constructor(look, opts = {}) {
    this.probe = makeProbe();
    this.group = new THREE.Group();
    const mk = (color, rough, map, nmap, metal = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map: map || null, normalMap: nmap || null });
      if (map) { map.wrapS = map.wrapT = THREE.RepeatWrapping; }
      return probeify(m, this.probe);
    };
    const T = opts.textures || {};
    const fab = T.fabric, den = T.carpet;
    this.mats = [
      mk(look.skin, 0.62),                                            // 0 Haut
      mk(look.top, 0.95, fab && fab.map, fab && fab.normal),          // 1 Oberteil
      mk(look.pants, 0.95, den && den.map, den && den.normal),        // 2 Hose
      mk(look.shoes ?? 0x151515, 0.65),                               // 3 Schuhe
      mk(look.gloves ?? look.skin, look.gloves ? 0.75 : 0.62),        // 4 Haende
      mk(look.head === 'balaclava' ? 0x141516 : (look.hair ?? 0x1a1410), 0.95, fab && fab.map, fab && fab.normal), // 5 Maske/Haare
      mk(0x2a2d27, 0.9, fab && fab.map, fab && fab.normal),           // 6 Weste
      mk(0x161616, 0.55, null, null, 0.2),                            // 7 Guertel/Riemen
      mk(look.tie ?? 0x7a1f2a, 0.6),                                  // 8 Krawatte/Akzent
      mk(0x0c0c0c, 0.3),                                              // 9 Augen
    ];
    // Ruhepose
    this.rest = new Float32Array(NJ * 3);
    computePose(this.rest, { x: 0, z: 0, yaw: 0, aimYaw: 0, aimPitch: 0, speed: 0, moveDir: 0, phase: 0, crouch: 0, stance: 'idle', t: 0, aiming: false, lean: 0, flinch: null, recoil: 0 }, null);
    this.restMats = Array.from({ length: NB }, () => new THREE.Matrix4());
    boneFrames(this.rest, new V(0, 0, 1), 0, this.restMats);
    const parts = Array.from({ length: this.mats.length }, () => new Part());
    this.buildBody(parts, look, opts);
    // Geometrie zusammenfuehren (Gruppen je Material)
    const pos = [], uv = [], si = [], sw = [], idx = [];
    const geo = new THREE.BufferGeometry();
    let off = 0;
    parts.forEach((p, mi) => {
      if (!p.idx.length) return;
      const start = idx.length;
      for (const i of p.idx) idx.push(i + off);
      pos.push(...p.pos); uv.push(...p.uv); si.push(...p.si); sw.push(...p.sw);
      geo.addGroup(start, p.idx.length, mi);
      off += p.n;
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Knochen (nicht im Szenengraph: Matrizen werden direkt gesetzt)
    this.bones = Array.from({ length: NB }, () => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
    const inverses = this.restMats.map((m) => m.clone().invert());
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    this.mesh = new THREE.SkinnedMesh(geo, this.mats);
    this.mesh.bindMode = THREE.DetachedBindMode;
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.cur = Array.from({ length: NB }, () => new THREE.Matrix4());
    this.footBlend = 0;
  }

  // Ruheposition eines Gelenks
  rj(i) { return getJ(this.rest, i, new V()); }
  rf(b) { // Achsen eines Ruheknochens
    const m = this.restMats[b];
    const x = new V(), y = new V(), z = new V(); m.extractBasis(x, y, z);
    return { x, y, z, o: new V().setFromMatrixPosition(m) };
  }

  buildBody(P, look, opts) {
    const SKIN = 0, TOP = 1, PANTS = 2, SHOES = 3, HANDS = 4, HAIR = 5, VEST = 6, STRAP = 7, ACC = 8, EYE = 9;
    const susp = look.head === 'balaclava' || look.head === 'cap';
    const bulk = susp ? 1.06 : 1.0;
    // ---------- Rumpf ----------
    const Pp = this.rj(J.P), Np = this.rj(J.N), Cp = this.rj(J.C);
    const up = new V().subVectors(Np, Pp).normalize();
    const fr = this.rf(B.spineLow);
    const torsoRing = (h, rx, rz, zo) => {
      const c = Pp.clone().addScaledVector(up, h).addScaledVector(fr.z, zo);
      let w;
      if (h < 0.02) w = lerpW(B.pelvis, B.spineLow, sm(-0.08, 0.02, h));
      else if (h < 0.46) w = lerpW(B.spineLow, B.spineUp, sm(0.26, 0.44, h));
      else w = lerpW(B.spineUp, B.neck, sm(0.54, 0.6, h));
      return { c, x: fr.x, z: fr.z, rx: rx * bulk, rz: rz * bulk, w };
    };
    const lower = [[-0.13, 0.1, 0.085, 0], [-0.07, 0.16, 0.112, -0.012], [0.0, 0.172, 0.116, -0.005], [0.07, 0.165, 0.11, 0.0], [0.11, 0.158, 0.106, 0.004]];
    loft(P[PANTS], lower.map((r) => torsoRing(...r)), 20, 2.5, true, false, 2);
    const upper = [[0.08, 0.164, 0.112, 0.004], [0.16, 0.158, 0.108, 0.008], [0.26, 0.165, 0.114, 0.014], [0.35, 0.18, 0.124, 0.02], [0.43, 0.192, 0.126, 0.014], [0.49, 0.198, 0.112, 0.0], [0.535, 0.165, 0.095, -0.006], [0.565, 0.085, 0.07, -0.004]];
    loft(P[TOP], upper.map((r) => torsoRing(...r)), 20, 2.6, false, true, 2);
    // Kragen / Kapuze
    if (susp) {
      const hood = [[0.5, 0.15, 0.11, -0.03], [0.55, 0.13, 0.1, -0.045], [0.6, 0.085, 0.075, -0.04]];
      loft(P[TOP], hood.map((r) => torsoRing(...r)), 16, 2.2, false, false, 1);
    }
    // Guertel
    const belt = new THREE.TorusGeometry(1, 0.11, 6, 24); belt.rotateX(Math.PI / 2);
    const bm = new THREE.Matrix4().makeBasis(fr.x, up, fr.z).scale(new V(0.168 * bulk, 0.18, 0.114 * bulk)).setPosition(Pp.clone().addScaledVector(up, 0.08));
    P[STRAP].addGeo(belt, bm, B.spineLow);
    const buckle = new RoundedBoxGeometry(0.05, 0.035, 0.012, 1, 0.004);
    P[STRAP].addGeo(buckle, new THREE.Matrix4().makeBasis(fr.x, up, fr.z).setPosition(Pp.clone().addScaledVector(up, 0.08).addScaledVector(fr.z, 0.12 * bulk)), B.spineLow);
    // ---------- Hals & Kopf ----------
    const Hp = this.rj(J.H);
    const nf = this.rf(B.neck);
    loft(susp && look.head === 'balaclava' ? P[HAIR] : P[SKIN], [0, 0.5, 1].map((t) => ({
      c: Np.clone().lerp(Hp, t * 0.8).addScaledVector(nf.y, -0.03), x: nf.x, z: nf.z, rx: 0.05 - t * 0.008, rz: 0.052 - t * 0.006, w: lerpW(B.neck, B.head, sm(0.4, 1, t)),
    })), 12, 2, false, false, 1);
    const hf = this.rf(B.head);
    const headM = new THREE.Matrix4().makeBasis(hf.x, hf.y, hf.z).setPosition(hf.o.clone().addScaledVector(hf.y, 0.03));
    const head = new THREE.SphereGeometry(0.1, 24, 18);
    const hp = head.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
      x *= 0.86; y *= 1.13; z *= 0.98;
      if (y < 0) { const k = Math.min(1, -y / 0.11); x *= 1 - k * 0.28; z *= 1 - k * (z < 0 ? 0.35 : 0.12); if (z > 0) z += k * 0.012; }
      if (z < 0 && y > -0.02) z *= 1.06;                       // Hinterkopf
      if (z > 0.05 && Math.abs(y + 0.0) < 0.03 && Math.abs(x) < 0.045) z -= 0.008 * (1 - Math.abs(y) / 0.03); // Augenhoehlen leicht
      hp.setXYZ(i, x, y, z);
    }
    P[look.head === 'balaclava' ? HAIR : SKIN].addGeo(head, headM, B.head);
    // Nase, Ohren
    const nose = new THREE.ConeGeometry(0.014, 0.04, 8); nose.rotateX(Math.PI * 0.62);
    P[look.head === 'balaclava' ? HAIR : SKIN].addGeo(nose, headM.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.018, 0.094)), B.head);
    for (const s of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.022, 8, 6); ear.scale(0.4, 1, 0.75);
      P[look.head === 'balaclava' ? HAIR : SKIN].addGeo(ear, headM.clone().multiply(new THREE.Matrix4().makeTranslation(s * 0.087, -0.005, -0.005)), B.head);
    }
    if (look.head === 'balaclava') {
      // Augenschlitz: Hautstreifen + Augen
      const slit = new THREE.CapsuleGeometry(0.016, 0.06, 4, 8); slit.rotateZ(Math.PI / 2);
      P[SKIN].addGeo(slit, headM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.012, 0.088)).multiply(new THREE.Matrix4().makeScale(1, 1, 0.5)), B.head);
    }
    for (const s of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.009, 8, 6);
      P[EYE].addGeo(eye, headM.clone().multiply(new THREE.Matrix4().makeTranslation(s * 0.032, 0.012, 0.09)), B.head);
    }
    if (look.head === 'hair') {
      const hair = new THREE.SphereGeometry(0.106, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
      const hpos = hair.attributes.position;
      for (let i = 0; i < hpos.count; i++) { hpos.setX(i, hpos.getX(i) * 0.9); hpos.setY(i, hpos.getY(i) * 1.12); if (hpos.getZ(i) > 0.06 && hpos.getY(i) < 0.07) hpos.setY(i, hpos.getY(i) + 0.012); }
      P[HAIR].addGeo(hair, headM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.012, -0.004)), B.head);
    }
    if (look.head === 'cap') {
      const cap = new THREE.SphereGeometry(0.108, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5); cap.scale(0.9, 1.0, 1.0);
      P[TOP].addGeo(cap, headM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.03, 0)), B.head);
      const brim = new THREE.CylinderGeometry(0.07, 0.075, 0.008, 16, 1, false, -Math.PI / 2, Math.PI); brim.scale(1, 1, 1.2);
      P[TOP].addGeo(brim, headM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.035, 0.06)), B.head);
    }
    // ---------- Arme ----------
    for (const side of ['L', 'R']) {
      const S = this.rj(side === 'L' ? J.SL : J.SR), E = this.rj(side === 'L' ? J.EL : J.ER), W = this.rj(side === 'L' ? J.HL : J.HR);
      const ua = side === 'L' ? B.uaL : B.uaR, fa = side === 'L' ? B.faL : B.faR, hand = side === 'L' ? B.handL : B.handR;
      const fU = this.rf(ua), fF = this.rf(fa);
      const sgn = side === 'L' ? -1 : 1;
      const prof = [[-0.08, 0.058, 0.062], [0.0, 0.062, 0.064], [0.2, 0.052, 0.054], [0.45, 0.048, 0.05], [0.75, 0.044, 0.046], [0.95, 0.041, 0.042],
        [1.05, 0.041, 0.043], [1.25, 0.043, 0.046], [1.5, 0.038, 0.04], [1.78, 0.031, 0.033], [1.86, 0.03, 0.032]];
      const rings = prof.map(([t, rx, rz]) => {
        let c, fr2;
        if (t <= 1) { c = S.clone().lerp(E, t); fr2 = fU; } else { c = E.clone().lerp(W, t - 1); fr2 = fF; }
        if (t < 0) c = S.clone().addScaledVector(fU.y, t * 0.29).addScaledVector(fU.x, -sgn * 0.01);
        const w = t < 0.85 ? (t < 0.08 ? lerpW(B.spineUp, ua, sm(-0.08, 0.08, t)) : [[ua, 1]]) : lerpW(ua, fa, sm(0.85, 1.15, t));
        const x = fU.x.clone().lerp(fF.x, sm(0.85, 1.15, t)).normalize(), z = fU.z.clone().lerp(fF.z, sm(0.85, 1.15, t)).normalize();
        return { c, x, z, rx: rx * bulk, rz: rz * bulk, w };
      });
      loft(P[TOP], rings, 14, 2.2, true, false, 1);
      // Aermelbuendchen
      const cuff = new THREE.TorusGeometry(0.034, 0.008, 6, 14); cuff.rotateX(Math.PI / 2);
      P[TOP].addGeo(cuff, new THREE.Matrix4().makeBasis(fF.x, fF.y, fF.z).setPosition(E.clone().lerp(W, 0.8)), fa);
      // Hand (Faust mit Daumen)
      const hm = new THREE.Matrix4().makeBasis(fF.x, fF.y, fF.z).setPosition(W);
      const palm = new RoundedBoxGeometry(0.08, 0.085, 0.036, 2, 0.014);
      P[HANDS].addGeo(palm, hm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.03, 0)), hand);
      const fing = new RoundedBoxGeometry(0.078, 0.04, 0.05, 2, 0.015);
      P[HANDS].addGeo(fing, hm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.075, 0.012)).multiply(new THREE.Matrix4().makeRotationX(0.5)), hand);
      const thumb = new THREE.CapsuleGeometry(0.012, 0.035, 3, 6);
      P[HANDS].addGeo(thumb, hm.clone().multiply(new THREE.Matrix4().makeTranslation(sgn * -0.035, 0.045, 0.02)).multiply(new THREE.Matrix4().makeRotationZ(sgn * 0.6)), hand);
    }
    // ---------- Beine ----------
    for (const side of ['L', 'R']) {
      const Hh = this.rj(side === 'L' ? J.HPL : J.HPR), K = this.rj(side === 'L' ? J.KL : J.KR), F = this.rj(side === 'L' ? J.FL : J.FR);
      const th = side === 'L' ? B.thL : B.thR, sh = side === 'L' ? B.shL : B.shR, ft = side === 'L' ? B.footL : B.footR;
      const fT = this.rf(th), fS = this.rf(sh);
      const sgn = side === 'L' ? -1 : 1;
      const prof = [[-0.15, 0.09, 0.1, 0], [0.0, 0.088, 0.095, 0], [0.3, 0.08, 0.084, 0.004], [0.65, 0.066, 0.068, 0.006], [0.92, 0.055, 0.058, 0.008],
        [1.02, 0.054, 0.058, 0.006], [1.25, 0.058, 0.062, -0.012], [1.5, 0.052, 0.054, -0.006], [1.8, 0.042, 0.045, 0], [1.95, 0.04, 0.043, 0]];
      const rings = prof.map(([t, rx, rz, zo]) => {
        let c;
        if (t < 0) c = Hh.clone().addScaledVector(fT.y, t * 0.44).addScaledVector(fT.x, -sgn * 0.015);
        else if (t <= 1) c = Hh.clone().lerp(K, t); else c = K.clone().lerp(F, t - 1);
        const k = sm(0.85, 1.12, t);
        const x = fT.x.clone().lerp(fS.x, k).normalize(), z = fT.z.clone().lerp(fS.z, k).normalize();
        c.addScaledVector(z, zo);
        const w = t < 0.1 ? lerpW(B.pelvis, th, sm(-0.15, 0.1, t)) : t < 0.85 ? [[th, 1]] : lerpW(th, sh, k);
        return { c, x, z, rx: rx * bulk, rz: rz * bulk, w };
      });
      loft(P[PANTS], rings, 14, 2.2, false, false, 1);
      // Stiefel / Schuh
      const ff = this.rf(ft);
      const fm = new THREE.Matrix4().makeBasis(ff.x, ff.y, ff.z).setPosition(F);
      // y zeigt beim Fuss nach unten -> Sohle bei +y
      const boot = new RoundedBoxGeometry(0.1, 0.11, 0.27, 2, 0.03);
      P[SHOES].addGeo(boot, fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.015, 0.055)), ft);
      const sole = new RoundedBoxGeometry(0.106, 0.025, 0.28, 1, 0.008);
      P[STRAP].addGeo(sole, fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.07, 0.055)), ft);
      const shaft = new THREE.CylinderGeometry(0.047, 0.05, 0.12, 12);
      P[SHOES].addGeo(shaft, fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.04, -0.005)), ft, susp ? [[ft, 0.5], [sh, 0.5]] : null);
      if (opts.armor || susp) {
        // Knieschoner bei Bewaffneten
        if (opts.armor) {
          const pad = new RoundedBoxGeometry(0.09, 0.11, 0.035, 2, 0.015);
          P[STRAP].addGeo(pad, new THREE.Matrix4().makeBasis(fS.x, fS.y, fS.z).setPosition(K.clone().addScaledVector(fS.z, 0.06).addScaledVector(fS.y, 0.03)), sh);
        }
      }
    }
    // ---------- Ausruestung ----------
    const fu = this.rf(B.spineUp);
    const chestC = Pp.clone().addScaledVector(up, 0.38);
    const tm = (x, y, z) => new THREE.Matrix4().makeBasis(fr.x, up, fr.z).setPosition(chestC.clone().addScaledVector(fr.x, x).addScaledVector(up, y).addScaledVector(fr.z, z));
    if (opts.armor) {
      const plate = new RoundedBoxGeometry(0.31, 0.33, 0.045, 3, 0.02);
      P[VEST].addGeo(plate, tm(0, 0, 0.135 * bulk), B.spineUp);
      P[VEST].addGeo(plate, tm(0, 0.01, -0.13 * bulk), B.spineUp);
      const cumm = new THREE.CylinderGeometry(0.2, 0.19, 0.16, 20, 1, true); cumm.scale(1, 1, 0.68);
      P[VEST].addGeo(cumm, tm(0, -0.1, 0), B.spineUp, [[B.spineUp, 0.6], [B.spineLow, 0.4]]);
      for (let i = -1; i <= 1; i++) {
        const pouch = new RoundedBoxGeometry(0.075, 0.11, 0.05, 2, 0.012);
        P[VEST].addGeo(pouch, tm(i * 0.085, -0.08, 0.175 * bulk), B.spineUp);
        const mag = new RoundedBoxGeometry(0.028, 0.05, 0.03, 1, 0.006);
        P[STRAP].addGeo(mag, tm(i * 0.085, -0.01, 0.17 * bulk), B.spineUp);
      }
      for (const s of [-1, 1]) {
        const strap = new RoundedBoxGeometry(0.05, 0.03, 0.27, 1, 0.01);
        P[VEST].addGeo(strap, tm(s * 0.11, 0.17, 0), B.spineUp);
      }
      const radio = new RoundedBoxGeometry(0.05, 0.1, 0.03, 1, 0.008);
      P[STRAP].addGeo(radio, tm(-0.11, 0.04, 0.17 * bulk), B.spineUp);
    } else if (susp) {
      // einfaches Brustrig mit Magazintaschen
      const rig = new RoundedBoxGeometry(0.26, 0.12, 0.04, 2, 0.012);
      P[VEST].addGeo(rig, tm(0, -0.07, 0.135 * bulk), B.spineUp);
      for (const s of [-1, 1]) {
        const strap = new RoundedBoxGeometry(0.035, 0.45, 0.012, 1, 0.005);
        P[STRAP].addGeo(strap, new THREE.Matrix4().makeBasis(fr.x, up, fr.z).multiply(new THREE.Matrix4().makeRotationZ(s * 0.5)).setPosition(chestC.clone().addScaledVector(fr.z, 0.128 * bulk).addScaledVector(up, 0.05)), B.spineUp);
      }
    }
    if (look.tie) {
      const tie = new THREE.ConeGeometry(0.03, 0.3, 4); tie.rotateZ(Math.PI); tie.scale(1, 1, 0.2);
      P[ACC].addGeo(tie, tm(0, 0.0, 0.122), B.spineUp);
      const collar = new THREE.TorusGeometry(0.06, 0.012, 6, 16); collar.rotateX(Math.PI / 2);
      P[TOP].addGeo(collar, tm(0, 0.18, 0.0), B.spineUp);
    }
    // Holster am Oberschenkel bei Verdaechtigen
    if (susp) {
      const fT = this.rf(B.thR);
      const hol = new RoundedBoxGeometry(0.05, 0.16, 0.08, 2, 0.012);
      P[STRAP].addGeo(hol, new THREE.Matrix4().makeBasis(fT.x, fT.y, fT.z).setPosition(this.rj(J.HPR).clone().lerp(this.rj(J.KR), 0.3).addScaledVector(fT.x, 0.085)), B.thR);
    }
  }

  // Pro Frame: Knochen aus Gelenken
  update(Jt, headFwd, dead) {
    this.footBlend += ((dead ? 1 : 0.15) - this.footBlend) * 0.2;
    boneFrames(Jt, headFwd, this.footBlend, this.cur);
    for (let i = 0; i < NB; i++) this.bones[i].matrixWorld.copy(this.cur[i]);
  }
  setVisible(v) { this.group.visible = v; }
}
