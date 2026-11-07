// First-Person-Waffenmodell mit Haenden/Armen (IK), Animationen und Rueckstoss.
import * as THREE from 'three';
import { probeify, makeProbe } from '../engine/materials.js';
import { ik2 } from '../actors/skeleton.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const V = THREE.Vector3, Q = THREE.Quaternion, E = THREE.Euler;
const _v = new V(), _w = new V(), _q = new Q(), _q2 = new Q(), _m = new THREE.Matrix4(), _e = new E();
const UP = new V(0, 1, 0);

export const GUNS = {
  carbine: {
    key: 'carbine', name: 'BP-16 Karabiner', cal: '5,56 mm', mag: 30, mags: 5, rpm: 780, modes: ['AUTO', 'EINZEL'], dmg: 56, pen: 1.0,
    hip: 2.2, ads: 0.08, recoilV: 0.42, recoilH: 0.2, reload: 2.25, reloadEmpty: 2.75, snd: 'rifle', adsFov: 0.7,
    hipPos: [0.165, -0.2, -0.37], adsPos: [0, 0, -0.27], sightH: 0.153, kickZ: 0.028, kickR: 0.05,
  },
  pistol: {
    key: 'pistol', name: 'BP-9 Pistole', cal: '9 mm', mag: 15, mags: 3, rpm: 450, modes: ['EINZEL'], dmg: 34, pen: 0.55,
    hip: 1.7, ads: 0.22, recoilV: 0.85, recoilH: 0.35, reload: 1.65, reloadEmpty: 1.95, snd: 'pistol', adsFov: 0.86,
    hipPos: [0.13, -0.19, -0.4], adsPos: [0, 0, -0.38], sightH: 0.072, kickZ: 0.035, kickR: 0.11,
  },
};

// Spring helper
class Spring3 {
  constructor(k = 120, d = 14) { this.x = new V(); this.v = new V(); this.k = k; this.d = d; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.exp(-this.d * h));
      this.x.addScaledVector(this.v, h);
    }
  }
}

const ss = (t) => t * t * (3 - 2 * t);

// Keyframe-Interpolation
function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b.t) {
      const k = ss((t - a.t) / (b.t - a.t));
      return {
        lh: a.lh.map((v, j) => v + (b.lh[j] - v) * k),
        rot: a.rot.map((v, j) => v + (b.rot[j] - v) * k),
        pos: a.pos.map((v, j) => v + (b.pos[j] - v) * k),
        grab: a.grab + (b.grab - a.grab) * k,
        mag: k < 0.5 ? a.mag : b.mag,
        slide: (a.slide ?? 0) + ((b.slide ?? 0) - (a.slide ?? 0)) * k,
      };
    }
  }
  return keys[keys.length - 1];
}

export class ViewModel {
  constructor(quality, envMap) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.probe = makeProbe();
    this.hemi = new THREE.HemisphereLight(0xdfe6f0, 0x2a2622, 0.25);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0dd, 0.35);
    this.key.position.set(-0.5, 1, 0.3);
    this.scene.add(this.key);
    this.flash = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    this.scene.add(this.flash);
    const mk = (color, rough, metal, envI = 0.5) => probeify(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMap, envMapIntensity: envI }), this.probe);
    this.M = {
      black: mk(0x1c1d1f, 0.55, 0.35, 0.35), metal: mk(0x2b2d30, 0.32, 0.85, 0.8), tan: mk(0x7d6a50, 0.75, 0.05, 0.2),
      glove: mk(0x2c2f34, 0.8, 0.0, 0.15), knuckle: mk(0x45494f, 0.7, 0.0, 0.15), sleeve: mk(0x3b4659, 0.95, 0.0, 0.05),
      cuff: mk(0x1d2330, 0.9, 0.0, 0.05), watch: mk(0x0e0e0e, 0.3, 0.6, 0.6),
      lens: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, envMap, envMapIntensity: 1.2 }),
      dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }),
      flashMat: null,
    };
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.guns = { carbine: this.buildCarbine(), pistol: this.buildPistol() };
    for (const k in this.guns) { this.guns[k].group.visible = false; this.root.add(this.guns[k].group); }
    this.rHand = this.buildHand(false); this.lHand = this.buildHand(true);
    this.root.add(this.rHand.group); this.root.add(this.lHand.group);
    this.arms = { r: this.buildArm(), l: this.buildArm() };
    this.root.add(this.arms.r.upper, this.arms.r.fore, this.arms.l.upper, this.arms.l.fore, this.arms.l.watch);
    this.shoulderR = new V(0.3, -0.36, 0.12);
    this.shoulderL = new V(-0.17, -0.46, 0.0);
    // Zustand
    this.cur = 'carbine';
    this.setWeapon('carbine');
    this.ads = 0; this.sprint = 0; this.block = 0; this.lower = 0;
    this.sway = new Spring3(90, 11); this.swayR = new Spring3(110, 12);
    this.kickP = new Spring3(260, 18); this.kickR = new Spring3(220, 16);
    this.bobT = 0; this.bobAmt = 0;
    this.reload = null; this.switchT = 0; this.switchTo = null;
    this.throwT = 0;
    this.flashT = 0;
    this.slideBack = 0;
    this.lean = 0;
    this.inspect = 0;
  }

  // ---------------- Modelle ----------------
  part(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m); return m;
  }
  box(g, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = Math.min(sx, sy, sz);
    const geo = m > 0.014 ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(0.006, m * 0.22)) : new THREE.BoxGeometry(sx, sy, sz);
    return this.part(g, geo, mat, x, y, z, rx, ry, rz);
  }
  cyl(g, r, len, mat, x, y, z, seg = 12, r2) {
    const geo = new THREE.CylinderGeometry(r, r2 ?? r, len, seg); geo.rotateX(Math.PI / 2);
    return this.part(g, geo, mat, x, y, z);
  }

  buildCarbine() {
    const g = new THREE.Group(); const M = this.M;
    // Unterteil / Griff
    this.box(g, 0.05, 0.062, 0.21, M.black, 0, 0.045, -0.06);
    this.box(g, 0.03, 0.095, 0.045, M.tan, 0, -0.025, 0.02, 0.28);            // Pistolengriff
    this.box(g, 0.012, 0.012, 0.07, M.black, 0, 0.0, -0.065);                 // Abzugsbuegel
    this.box(g, 0.006, 0.022, 0.006, M.metal, 0, 0.012, -0.055, 0.3);         // Abzug
    // Oberteil
    this.box(g, 0.052, 0.05, 0.26, M.black, 0, 0.098, -0.07);
    this.box(g, 0.024, 0.012, 0.3, M.metal, 0, 0.128, -0.1);                  // Schiene
    for (let i = 0; i < 14; i++) this.box(g, 0.026, 0.006, 0.006, M.metal, 0, 0.136, -0.23 + i * 0.019);
    this.box(g, 0.012, 0.02, 0.05, M.metal, 0.03, 0.1, -0.01);                // Huelsenauswurf
    this.box(g, 0.03, 0.014, 0.04, M.black, 0, 0.11, 0.06);                   // Ladehebel
    // Handschutz (M-LOK-artig, tan) mit Aussparungen
    this.box(g, 0.058, 0.058, 0.34, M.tan, 0, 0.095, -0.37);
    for (let i = 0; i < 5; i++) { this.box(g, 0.06, 0.012, 0.035, M.black, 0, 0.095, -0.25 - i * 0.055); }
    this.box(g, 0.026, 0.01, 0.32, M.metal, 0, 0.128, -0.37);
    // Lauf + Muendung
    this.cyl(g, 0.011, 0.12, M.metal, 0, 0.095, -0.6);
    this.cyl(g, 0.016, 0.06, M.black, 0, 0.095, -0.68, 8);
    for (let i = 0; i < 3; i++) this.box(g, 0.034, 0.004, 0.008, M.metal, 0, 0.095 + (i - 1) * 0.008, -0.69);
    // Schaft
    this.cyl(g, 0.016, 0.16, M.black, 0, 0.09, 0.13);
    this.box(g, 0.045, 0.075, 0.13, M.tan, 0, 0.075, 0.25);
    this.box(g, 0.05, 0.085, 0.02, M.black, 0, 0.07, 0.315);
    // Magazin (eigene Gruppe fuer Nachladen)
    const mag = new THREE.Group();
    this.box(mag, 0.028, 0.15, 0.07, M.tan, 0, -0.07, 0, -0.18);
    this.box(mag, 0.029, 0.07, 0.072, M.tan, 0, -0.165, 0.004, -0.36);
    this.box(mag, 0.03, 0.014, 0.076, M.black, 0, -0.205, 0.022, -0.36);
    for (let i = 0; i < 4; i++) this.box(mag, 0.031, 0.004, 0.06, M.black, 0, -0.03 - i * 0.03, -0.004 + i * 0.004, -0.2);
    mag.position.set(0, 0.03, -0.125);
    g.add(mag);
    // Rotpunktvisier
    this.box(g, 0.03, 0.012, 0.05, M.black, 0, 0.14, -0.08);
    const tube = new THREE.CylinderGeometry(0.021, 0.021, 0.065, 20, 1, true); tube.rotateX(Math.PI / 2);
    this.part(g, tube, M.black, 0, 0.153, -0.08).material.side = THREE.DoubleSide;
    this.cyl(g, 0.0195, 0.002, M.lens, 0, 0.153, -0.11, 20);
    const dot = this.part(g, new THREE.SphereGeometry(0.0009, 6, 6), M.dot, 0, 0.153, -0.4);
    dot.renderOrder = 10;
    this.box(g, 0.012, 0.012, 0.02, M.black, 0.024, 0.153, -0.08);
    // Waffenlampe rechts
    this.cyl(g, 0.014, 0.1, M.black, 0.038, 0.098, -0.45, 12);
    this.part(g, new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.2) }), 0.038, 0.098, -0.5011, 0, Math.PI, 0);
    // Details: Magazinschacht, Staubschutz, Schliesshilfe, Klappvisiere, Riemenbuegel
    this.box(g, 0.058, 0.04, 0.09, M.black, 0, 0.02, -0.125);
    this.box(g, 0.004, 0.03, 0.075, M.metal, 0.028, 0.098, -0.035);
    this.cyl(g, 0.009, 0.025, M.metal, 0.034, 0.108, 0.015, 10);
    this.box(g, 0.026, 0.02, 0.028, M.black, 0, 0.145, 0.045);
    this.box(g, 0.026, 0.018, 0.026, M.black, 0, 0.143, -0.49);
    this.box(g, 0.012, 0.016, 0.03, M.metal, -0.03, 0.08, 0.2);
    this.box(g, 0.006, 0.01, 0.05, M.metal, 0.03, 0.14, -0.3);
    for (let i = 0; i < 4; i++) this.box(g, 0.004, 0.006, 0.006, M.metal, 0, 0.118 - i * 0.012, -0.73);
    // Winkelgriff
    this.box(g, 0.03, 0.035, 0.06, M.black, 0, 0.052, -0.33, 0.6);
    // Muendungsfeuer
    const flash = this.muzzleFlash(); flash.position.set(0, 0.095, -0.73); g.add(flash);
    return {
      group: g, mag, magHome: mag.position.clone(), magRot: mag.rotation.clone(), flash, muzzle: new V(0, 0.095, -0.72), eject: new V(0.04, 0.1, -0.01),
      rh: { p: [0.03, -0.03, 0.035], x: [0, 0.96, 0.28], z: [-1, 0, 0], curl: [0.65, 1.55, 1.25], idx: [0.25, 0.7, 0.4] },
      lh: { p: [-0.03, 0.058, -0.3], x: [0, -0.2, 1], z: [0.55, 1, 0], curl: [0.6, 1.3, 1.05] },
      magWell: [0, -0.06, -0.13], bolt: [-0.035, 0.1, -0.07],
    };
  }

  buildPistol() {
    const g = new THREE.Group(); const M = this.M;
    this.box(g, 0.029, 0.03, 0.19, M.black, 0, 0.055, -0.07);                 // Schlitten
    const slide = g.children[g.children.length - 1];
    for (let i = 0; i < 6; i++) this.box(g, 0.031, 0.022, 0.003, M.metal, 0, 0.055, 0.0 + i * 0.006);
    this.box(g, 0.026, 0.024, 0.17, M.black, 0, 0.03, -0.065);                // Rahmen
    this.box(g, 0.028, 0.105, 0.048, M.black, 0, -0.025, 0.0, 0.22);          // Griff
    this.box(g, 0.011, 0.01, 0.055, M.black, 0, 0.0, -0.05);                  // Buegel
    this.box(g, 0.005, 0.02, 0.005, M.metal, 0, 0.012, -0.045, 0.3);
    this.box(g, 0.004, 0.008, 0.004, M.metal, 0, 0.073, -0.155);              // Korn
    this.box(g, 0.016, 0.007, 0.006, M.metal, 0, 0.073, 0.015);               // Kimme
    this.part(g, new THREE.SphereGeometry(0.0012, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 0.8) }), 0, 0.0775, -0.155);
    this.cyl(g, 0.0075, 0.01, M.metal, 0, 0.05, -0.166, 8);
    const mag = new THREE.Group();
    this.box(mag, 0.022, 0.1, 0.038, M.black, 0, -0.045, 0, 0.22);
    mag.position.set(0, 0.0, 0.0);
    g.add(mag);
    const flash = this.muzzleFlash(0.6); flash.position.set(0, 0.05, -0.18); g.add(flash);
    return {
      group: g, mag, magHome: mag.position.clone(), magRot: mag.rotation.clone(), flash, slide, slideHome: slide.position.z, muzzle: new V(0, 0.05, -0.17), eject: new V(0.02, 0.07, -0.05),
      rh: { p: [0.025, -0.035, 0.012], x: [0, 0.97, 0.22], z: [-1, 0, 0], curl: [0.75, 1.55, 1.2], idx: [0.25, 0.75, 0.5] },
      lh: { p: [-0.03, -0.04, -0.005], x: [0, 0.9, 0.3], z: [1, 0, 0.25], curl: [0.9, 1.5, 1.1] },
      magWell: [0, -0.09, 0.015], bolt: [0, 0.06, 0.02], pistol: true,
    };
  }

  muzzleFlash(s = 1) {
    const g = new THREE.Group();
    const tex = this.flashTex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(3, 2.4, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.M.flashMat = mat;
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16 * s, 0.16 * s), mat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.1 * s, 0.22 * s), mat); p2.rotation.y = Math.PI / 2; p2.position.z = -0.08 * s;
    const p3 = p2.clone(); p3.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(p1, p2, p3);
    g.visible = false;
    return g;
  }
  setGunTextures(T) {
    for (const k of ['black', 'metal']) { const m = this.M[k]; m.normalMap = T.metal.normal; m.normalScale.set(0.25, 0.25); m.needsUpdate = true; }
    const t = this.M.tan; t.normalMap = T.concrete.normal; t.normalScale.set(0.15, 0.15); t.needsUpdate = true;
  }
  setSleeveTexture(map, normal) {
    for (const k of ['sleeve', 'cuff']) { const m = this.M[k]; m.map = map; m.normalMap = normal; m.needsUpdate = true; }
    for (const k of ['glove', 'knuckle']) { const m = this.M[k]; m.normalMap = normal; m.normalScale.set(0.6, 0.6); m.needsUpdate = true; }
  }
  setFlashTexture(t) {
    this.flashTex = t;
    for (const k in this.guns) this.guns[k].flash.traverse((o) => { if (o.material) { o.material.map = t; o.material.needsUpdate = true; } });
  }

  // Hand: Ursprung Handflaechenmitte, +y Finger, +z Handflaechennormale, x Daumenseite (links gespiegelt)
  buildHand(left) {
    const g = new THREE.Group();
    const M = this.M;
    const sx = left ? -1 : 1;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.088, 0.03), M.glove); g.add(palm);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.008), M.knuckle); back.position.set(0, 0.012, -0.018); g.add(back);
    const fingers = [];
    const fx = [0.028, 0.009, -0.01, -0.028];
    const lens = [[0.042, 0.026, 0.022], [0.046, 0.029, 0.023], [0.044, 0.027, 0.022], [0.034, 0.022, 0.019]];
    for (let f = 0; f < 4; f++) {
      const segs = [];
      for (let s = 0; s < 3; s++) {
        const w = 0.019 - s * 0.0015 - (f === 3 ? 0.002 : 0);
        const geo = new THREE.BoxGeometry(w, lens[f][s], w * 0.95); geo.translate(0, lens[f][s] / 2, 0);
        const m = new THREE.Mesh(geo, M.glove);
        segs.push({ m, len: lens[f][s] });
        g.add(m);
      }
      fingers.push({ x: fx[f] * sx, segs });
    }
    // Daumen
    const thumb = [];
    for (let s = 0; s < 2; s++) {
      const geo = new THREE.BoxGeometry(0.021, 0.034, 0.02); geo.translate(0, 0.017, 0);
      const m = new THREE.Mesh(geo, M.glove); g.add(m); thumb.push(m);
    }
    // Handgelenk
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.05, 10), M.glove); wrist.position.set(0, -0.06, -0.003); g.add(wrist);
    g.userData = { fingers, thumb, left };
    return { group: g, fingers, thumb, left };
  }

  poseHand(hand, curl, idx) {
    for (let f = 0; f < 4; f++) {
      const F = hand.fingers[f];
      const c = f === 0 && idx ? idx : curl;
      let y = 0.044, z = 0.0, a = 0;
      for (let s = 0; s < 3; s++) {
        a += c[s];
        const seg = F.segs[s];
        seg.m.position.set(F.x, y, z);
        seg.m.rotation.set(a, 0, 0);
        y += Math.cos(a) * seg.len; z += Math.sin(a) * seg.len;
      }
    }
    const sx = hand.left ? -1 : 1;
    hand.thumb[0].position.set(0.038 * sx, -0.022, 0.012);
    hand.thumb[0].rotation.set(0.5, 0, -0.75 * sx);
    const t1 = hand.thumb[0];
    const d = new V(0, 0.034, 0).applyEuler(t1.rotation);
    hand.thumb[1].position.copy(t1.position).add(d);
    hand.thumb[1].rotation.set(0.9, 0, -0.5 * sx);
  }

  buildArm() {
    const M = this.M;
    // Aermel als Drehkoerper mit Falten (Profil r(y), y 0..1 wird auf Segmentlaenge skaliert)
    const lathe = (prof, seg = 20) => {
      const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(pts, seg);
      // leichte Unregelmaessigkeit (Stofffalten)
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(z, x);
        const w = 1 + Math.sin(a * 3 + y * 17) * 0.035 + Math.sin(a * 5 - y * 29) * 0.02;
        p.setXYZ(i, x * w, y, z * w);
      }
      g.computeVertexNormals();
      return g;
    };
    const ug = lathe([[0.0, -0.02], [0.05, -0.01], [0.054, 0.12], [0.05, 0.4], [0.045, 0.7], [0.043, 0.9], [0.046, 1.0], [0.0, 1.04]]);
    const fg = lathe([[0.0, -0.02], [0.044, 0.0], [0.046, 0.12], [0.041, 0.35], [0.037, 0.55], [0.035, 0.62], [0.039, 0.66], [0.036, 0.72], [0.031, 0.86], [0.034, 0.9], [0.0, 0.92]]);
    const upper = new THREE.Mesh(ug, M.sleeve), fore = new THREE.Mesh(fg, M.sleeve);
    const cuffG = new THREE.CylinderGeometry(0.042, 0.042, 0.035, 12); cuffG.translate(0, 0.95, 0);
    const cuff = new THREE.Mesh(cuffG, M.cuff); cuff.scale.set(1, 1, 1);
    const watch = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.012, 0.04), M.watch);
    return { upper, fore, watch };
  }

  setWeapon(key) {
    for (const k in this.guns) this.guns[k].group.visible = k === key;
    this.cur = key;
    const G = this.guns[key];
    this.poseHand(this.rHand, G.rh.curl, G.rh.idx);
    this.poseHand(this.lHand, G.lh.curl);
  }

  // ---------------- Animationen ----------------
  startReload(empty, dur) {
    const G = this.guns[this.cur];
    const L = G.lh.p, W = G.magWell;
    let keys;
    if (G.pistol) {
      keys = [
        { t: 0, lh: L, rot: [0, 0, 0], pos: [0, 0, 0], grab: 0, mag: 'gun' },
        { t: 0.18, lh: [-0.06, -0.1, 0.04], rot: [0.25, 0.15, 0.35], pos: [-0.02, 0.01, 0.03], grab: 1, mag: 'drop', snd: 'magout' },
        { t: 0.55, lh: [-0.12, -0.32, 0.12], rot: [0.25, 0.15, 0.35], pos: [-0.02, 0.01, 0.03], grab: 1, mag: 'hidden' },
        { t: 0.95, lh: [W[0] - 0.02, W[1] - 0.12, W[2] + 0.02], rot: [0.25, 0.15, 0.35], pos: [-0.02, 0.01, 0.03], grab: 1, mag: 'hand' },
        { t: 1.18, lh: [W[0] - 0.01, W[1] - 0.02, W[2]], rot: [0.28, 0.15, 0.35], pos: [-0.02, 0.0, 0.03], grab: 1, mag: 'gun', snd: 'magin' },
        ...(empty ? [
          { t: 1.45, lh: [-0.02, 0.07, 0.05], rot: [0.15, 0.1, 0.2], pos: [-0.01, 0.0, 0.02], grab: 1, mag: 'gun', slide: 1 },
          { t: 1.6, lh: [-0.02, 0.07, 0.1], rot: [0.12, 0.1, 0.15], pos: [-0.01, 0.0, 0.02], grab: 1, mag: 'gun', slide: 0, snd: 'bolt' },
        ] : []),
        { t: dur, lh: L, rot: [0, 0, 0], pos: [0, 0, 0], grab: 0, mag: 'gun' },
      ];
    } else {
      keys = [
        { t: 0, lh: L, rot: [0, 0, 0], pos: [0, 0, 0], grab: 0, mag: 'gun' },
        { t: 0.28, lh: [W[0] - 0.04, W[1] - 0.02, W[2] + 0.01], rot: [0.12, 0.25, 0.45], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'gun' },
        { t: 0.42, lh: [W[0] - 0.035, W[1] - 0.04, W[2]], rot: [0.12, 0.25, 0.45], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'hand', snd: 'magout' },
        { t: 0.7, lh: [W[0] - 0.08, W[1] - 0.28, W[2] + 0.06], rot: [0.1, 0.25, 0.42], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'hand' },
        { t: 0.95, lh: [-0.18, -0.48, 0.15], rot: [0.1, 0.25, 0.42], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'hidden' },
        { t: 1.3, lh: [W[0] - 0.08, W[1] - 0.26, W[2] + 0.05], rot: [0.12, 0.25, 0.45], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'hand' },
        { t: 1.55, lh: [W[0] - 0.035, W[1] - 0.05, W[2] + 0.005], rot: [0.14, 0.25, 0.47], pos: [-0.04, 0.03, 0.03], grab: 1, mag: 'hand' },
        { t: 1.68, lh: [W[0] - 0.035, W[1] - 0.025, W[2]], rot: [0.16, 0.25, 0.47], pos: [-0.04, 0.035, 0.03], grab: 1, mag: 'gun', snd: 'magin' },
        ...(empty ? [
          { t: 1.95, lh: [G.bolt[0] - 0.02, G.bolt[1] - 0.01, G.bolt[2]], rot: [0.08, 0.2, 0.3], pos: [-0.03, 0.02, 0.02], grab: 0.5, mag: 'gun' },
          { t: 2.1, lh: [G.bolt[0] - 0.012, G.bolt[1] - 0.005, G.bolt[2] + 0.01], rot: [0.06, 0.2, 0.28], pos: [-0.03, 0.02, 0.025], grab: 0.5, mag: 'gun', snd: 'bolt' },
        ] : []),
        { t: dur, lh: L, rot: [0, 0, 0], pos: [0, 0, 0], grab: 0, mag: 'gun' },
      ];
    }
    this.reload = { t: 0, dur, keys, fired: new Set(), empty };
  }

  startSwitch(to) { this.switchTo = to; this.switchT = 0; }

  // Mechanische Stoesse waehrend des Nachladens (Magazin raus/rein, Verschluss)
  reloadJolt(snd) {
    if (snd === 'magout') { this.kickR.v.x -= 1.2; this.kickP.v.y -= 0.25; }
    else if (snd === 'magin') { this.kickR.v.x += 2.2; this.kickP.v.y += 0.45; this.kickR.v.z += (Math.random() - 0.5) * 1.5; }
    else if (snd === 'bolt') { this.kickP.v.z += 0.9; this.kickR.v.x += 1.6; this.kickR.v.y += 0.8; }
    if (snd === 'magout' && this.reload && this.reload.empty && this.onDropMag) this.onDropMag();
  }

  fireKick(gun, adsK) {
    const G = GUNS[gun];
    const k = 1 - adsK * 0.45;
    this.kickP.v.z += G.kickZ * 60 * k;
    this.kickP.v.y += G.kickZ * 8 * k;
    this.kickR.v.x += G.kickR * 60 * k;
    this.kickR.v.y += (Math.random() - 0.5) * G.kickR * 30 * k;
    this.kickR.v.z += (Math.random() - 0.5) * G.kickR * 40 * k;
    this.flashT = 0.045;
    const f = this.guns[gun].flash;
    f.visible = true; f.rotation.z = Math.random() * Math.PI; f.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flash.intensity = 3;
    if (this.guns[gun].slide) this.slideBack = 1;
  }

  // ---------------- Update ----------------
  update(dt, s) {
    // s: {ads, sprint, block, moveSpeed, mdx, mdy, lean, crouch, lowered}
    const G = this.guns[this.cur], D = GUNS[this.cur];
    const k = (target, cur, rate) => cur + (target - cur) * Math.min(1, dt * rate);
    this.ads = k(s.ads ? 1 : 0, this.ads, 11);
    this.sprint = k(s.sprint ? 1 : 0, this.sprint, 8);
    this.block = k(s.block, this.block, 10);
    this.lean = k(s.lean, this.lean, 8);
    this.lower = k(s.lowered ? 1 : 0, this.lower, 9);
    // Sway durch Mausbewegung
    const sw = 1 - this.ads * 0.7;
    this.swayR.v.y += -s.mdx * 0.0016 * sw; this.swayR.v.x += -s.mdy * 0.0016 * sw;
    this.sway.v.x += -s.mdx * 0.00022 * sw; this.sway.v.y += s.mdy * 0.00018 * sw;
    this.sway.step(dt); this.swayR.step(dt); this.kickP.step(dt); this.kickR.step(dt);
    // Bob
    const mv = Math.min(1.5, s.moveSpeed / 3);
    this.bobAmt = k(mv, this.bobAmt, 6);
    this.bobT += dt * (5 + s.moveSpeed * 2.2);
    const bAmt = this.bobAmt * (1 - this.ads * 0.8);
    const bx = Math.sin(this.bobT) * 0.012 * bAmt, by = -Math.abs(Math.cos(this.bobT)) * 0.011 * bAmt;
    // Atmen
    const br = Math.sin(performance.now() * 0.0012) * 0.0018 * (1 - this.ads * 0.6);

    // Grundpose
    const hip = D.hipPos, ads = [D.adsPos[0], D.adsPos[1] - D.sightH, D.adsPos[2]];
    const a = ss(this.ads);
    const pos = _v.set(hip[0] + (ads[0] - hip[0]) * a, hip[1] + (ads[1] - hip[1]) * a, hip[2] + (ads[2] - hip[2]) * a);
    const rot = _e.set(0, 0, 0);
    let rx = 0, ry = 0, rz = 0;
    // Sprinthaltung
    const sp = ss(this.sprint);
    pos.x += 0.03 * sp; pos.y -= 0.05 * sp; pos.z += 0.04 * sp;
    rx -= 0.45 * sp; ry += 0.75 * sp; rz += 0.35 * sp;
    // Wand: Waffe senken (Low Ready)
    const bl = ss(this.block);
    pos.y -= 0.06 * bl; pos.z += 0.08 * bl; rx -= 0.75 * bl; ry += 0.15 * bl;
    // Gesenkt (Interaktion)
    const lo = ss(this.lower);
    pos.y -= 0.12 * lo; rx -= 0.6 * lo; ry += 0.3 * lo;
    // Lehnen: Waffe leicht mitkippen
    rz += -this.lean * 0.12 * (1 - a * 0.5);
    pos.x += this.lean * 0.01;
    // Ducken leicht neigen
    rz += s.crouch * 0.04 * (1 - a);
    pos.x += bx; pos.y += by + br;
    pos.add(this.sway.x).addScaledVector(this.kickP.x, 1);
    pos.z += this.kickP.x.z * 0; // (kickP enthaelt z bereits)
    rx += this.swayR.x.x + this.kickR.x.x; ry += this.swayR.x.y + this.kickR.x.y; rz += this.swayR.x.z + this.kickR.x.z + this.swayR.x.y * 0.6;
    // Waffenwechsel
    let sw2 = 0;
    if (this.switchTo) {
      this.switchT += dt;
      const half = 0.28;
      if (this.switchT < half) sw2 = ss(this.switchT / half);
      else {
        if (this.cur !== this.switchTo && this.switchT >= half) { this.setWeapon(this.switchTo); this.onSwitched && this.onSwitched(this.switchTo); }
        sw2 = 1 - ss(Math.min(1, (this.switchT - half) / 0.32));
        if (this.switchT > half + 0.32) this.switchTo = null;
      }
    }
    pos.y -= 0.25 * sw2; rx -= 0.9 * sw2;
    // Granatwurf
    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt);
      const tt = Math.sin(Math.min(1, (0.9 - this.throwT) / 0.9) * Math.PI);
      pos.y -= 0.2 * tt; pos.x += 0.08 * tt; rx -= 0.6 * tt; rz -= 0.4 * tt;
    }
    // Nachladen
    let lhOverride = null, grab = 0, magState = 'gun', slide = 0;
    if (this.reload) {
      const R = this.reload;
      R.t += dt;
      const kf = sampleKeys(R.keys, R.t);
      // Sounds an Schluesselbildern
      for (let i = 0; i < R.keys.length; i++) { const key = R.keys[i]; if (key.snd && R.t >= key.t && !R.fired.has(i)) { R.fired.add(i); this.onSound && this.onSound(key.snd); this.reloadJolt(key.snd); } }
      const ra = 1 - a * 0.3;
      rx += kf.rot[0] * ra; ry += kf.rot[1] * ra; rz += kf.rot[2] * ra;
      pos.x += kf.pos[0]; pos.y += kf.pos[1]; pos.z += kf.pos[2];
      lhOverride = kf.lh; grab = kf.grab; magState = kf.mag; slide = kf.slide || 0;
      if (R.t >= R.dur) this.reload = null;
    }
    G.group.position.copy(pos);
    G.group.rotation.set(rx, ry, rz, 'YXZ');
    G.group.updateMatrix();
    G.group.updateMatrixWorld(true);
    // Schlitten
    if (G.slide) {
      this.slideBack = Math.max(0, this.slideBack - dt * 18);
      G.slide.position.z = G.slideHome + (this.slideBack > 0 ? 0.025 * Math.sin(this.slideBack * Math.PI) : 0) + slide * 0.03 + (s.slideLocked ? 0.03 : 0);
    }
    // Magazin
    const mag = G.mag;
    if (magState === 'gun') { mag.visible = true; mag.position.copy(G.magHome); mag.rotation.copy(G.magRot); if (mag.parent !== G.group) G.group.add(mag); }
    else if (magState === 'hidden') { mag.visible = false; }
    else if (magState === 'drop') { mag.visible = true; mag.position.y -= dt * 0.9; }
    // Muendungsfeuer
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { G.flash.visible = false; this.flash.intensity = 0; } }
    this.flash.position.copy(G.muzzle).applyMatrix4(G.group.matrix);

    // Haende platzieren
    this.placeHand(this.rHand, G, G.rh, null, 0);
    this.placeHand(this.lHand, G, G.lh, lhOverride, grab);
    if (magState === 'hand') {
      // Magazin folgt linker Hand
      _v.set(0, -0.005, 0.045).applyMatrix4(this.lHand.group.matrix);
      _v.applyMatrix4(_m.copy(G.group.matrix).invert());
      mag.position.copy(_v).add(_w.set(0, 0.06, 0));
      mag.visible = true;
    }
    // Arme (IK)
    this.solveArm(this.arms.r, this.shoulderR, this.rHand, 1);
    this.solveArm(this.arms.l, this.shoulderL, this.lHand, -1);
  }

  placeHand(hand, G, spec, override, grab) {
    const p = override || spec.p;
    let x = _v.fromArray(spec.x).normalize(), z = _w.fromArray(spec.z).normalize();
    if (grab > 0 && hand.left && !G.pistol) {
      // Griff ans Magazin: Handflaeche nach rechts, Finger nach unten
      const gx = new V(0, -0.35, 1).normalize(), gz = new V(1, 0, 0);
      x = x.clone().lerp(gx, grab).normalize(); z = z.clone().lerp(gz, grab).normalize();
    }
    const y = new V().crossVectors(z, x).normalize();
    const zz = new V().crossVectors(x, y);
    _m.makeBasis(x, y, zz);
    _m.setPosition(p[0], p[1], p[2]);
    const g = hand.group;
    g.matrixAutoUpdate = false;
    g.matrix.multiplyMatrices(G.group.matrix, _m);
    g.matrixWorldNeedsUpdate = true;
    // Handgelenkpunkt (im View-Raum) fuer IK
    hand.wrist = (hand.wrist || new V()).set(0, -0.075, -0.003).applyMatrix4(g.matrix);
    hand.elbowHint = (hand.elbowHint || new V()).set(0, -1, 0).transformDirection(g.matrix);
  }

  solveArm(arm, sh, hand, side) {
    const W = hand.wrist;
    const elbow = new V();
    const pole = side > 0 ? new V(1.2, -1.0, 0.4) : new V(-0.6, -1.5, 0.2);
    const target = W.clone();
    ik2(sh, target, side > 0 ? 0.38 : 0.46, side > 0 ? 0.36 : 0.44, pole, elbow);
    const place = (mesh, a, b) => {
      const d = _v.subVectors(b, a); const L = d.length();
      _q.setFromUnitVectors(UP, d.normalize());
      mesh.position.copy(a); mesh.quaternion.copy(_q); mesh.scale.set(1, L, 1);
    };
    place(arm.upper, sh, elbow);
    place(arm.fore, elbow, target);
    if (side < 0) {
      arm.watch.position.copy(target).lerp(elbow, 0.12);
      arm.watch.quaternion.copy(arm.fore.quaternion);
      arm.watch.translateZ(-0.0); arm.watch.translateX(0.0); arm.watch.translateY(0); arm.watch.translateZ(0.04);
    }
  }

  ejectPoint(out) { const G = this.guns[this.cur]; return out.copy(G.eject).applyMatrix4(G.group.matrix); }
  muzzlePoint(out) { const G = this.guns[this.cur]; return out.copy(G.muzzle).applyMatrix4(G.group.matrix); }
}
