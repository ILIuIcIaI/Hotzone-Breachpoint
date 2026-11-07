// Detaillierte Waffenmodelle fuer NPCs. Lokales System: Ursprung am Griff (rechte Hand), +z = Laufrichtung, +y = oben.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { probeify, makeProbe } from '../engine/materials.js';

let MATS = null;
function mats() {
  // je Waffe eigene Materialien (eigene Lichtprobe)
  const probe = makeProbe();
  const mk = (color, rough, metal) => probeify(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), probe);
  MATS = { probe, steel: mk(0x2a2b2d, 0.38, 0.85), black: mk(0x18191b, 0.6, 0.25), wood: mk(0x6b3f22, 0.55, 0.0), poly: mk(0x232427, 0.75, 0.05) };
  return MATS;
  // (MATS dient nur als letzte Referenz zum Debuggen)
}

function rb(g, m, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0, r = 0.006) {
  const geo = Math.min(sx, sy, sz) > 0.012 ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, Math.min(sx, sy, sz) * 0.4)) : new THREE.BoxGeometry(sx, sy, sz);
  const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; g.add(mesh); return mesh;
}
function cyl(g, m, r1, r2, len, x, y, z, seg = 10) {
  const geo = new THREE.CylinderGeometry(r1, r2, len, seg); geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
}

export function buildNpcGun(kind) {
  const M = mats();
  const g = new THREE.Group();
  if (kind === 'pistol') {
    rb(g, M.black, 0.03, 0.033, 0.19, 0, 0.048, 0.06, 0, 0, 0, 0.005);            // Schlitten
    for (let i = 0; i < 5; i++) rb(g, M.steel, 0.032, 0.022, 0.003, 0, 0.05, -0.02 + i * 0.006);
    rb(g, M.poly, 0.028, 0.022, 0.16, 0, 0.022, 0.06);                            // Rahmen
    rb(g, M.poly, 0.03, 0.105, 0.048, 0, -0.03, 0.0, -0.22, 0, 0, 0.008);          // Griff
    rb(g, M.poly, 0.008, 0.008, 0.05, 0, 0.0, 0.05);                              // Buegel
    cyl(g, M.steel, 0.006, 0.006, 0.01, 0, 0.05, 0.157, 8);
    g.userData.muzzle = new THREE.Vector3(0, 0.05, 0.16); g.userData.length = 0.2;
  } else if (kind === 'carbine') {
    rb(g, M.black, 0.046, 0.058, 0.26, 0, 0.05, 0.1, 0, 0, 0, 0.008);              // Gehaeuse
    rb(g, M.poly, 0.05, 0.05, 0.3, 0, 0.055, 0.37, 0, 0, 0, 0.012);                // Handschutz
    rb(g, M.steel, 0.022, 0.012, 0.5, 0, 0.09, 0.22);                              // Schiene
    cyl(g, M.steel, 0.01, 0.01, 0.14, 0, 0.055, 0.58, 8);
    cyl(g, M.black, 0.014, 0.014, 0.05, 0, 0.055, 0.66, 8);
    rb(g, M.poly, 0.03, 0.1, 0.045, 0, -0.025, 0.0, -0.3, 0, 0, 0.01);             // Griff
    rb(g, M.black, 0.027, 0.15, 0.065, 0, -0.04, 0.14, 0.15, 0, 0, 0.006);         // Magazin
    cyl(g, M.black, 0.015, 0.015, 0.18, 0, 0.06, -0.1, 8);                        // Puffer
    rb(g, M.poly, 0.042, 0.07, 0.12, 0, 0.045, -0.23, 0, 0, 0, 0.012);             // Schaft
    cyl(g, M.black, 0.02, 0.02, 0.06, 0, 0.115, 0.15, 12);                        // Rotpunkt
    cyl(g, M.black, 0.014, 0.014, 0.09, 0.035, 0.06, 0.42, 10);                   // Lampe
    g.userData.muzzle = new THREE.Vector3(0, 0.055, 0.69); g.userData.length = 0.9;
  } else if (kind === 'smg') {
    rb(g, M.black, 0.045, 0.06, 0.3, 0, 0.055, 0.1, 0, 0, 0, 0.01);               // Gehaeuse
    rb(g, M.poly, 0.04, 0.04, 0.12, 0, 0.04, 0.27, 0, 0, 0, 0.012);               // Handschutz
    cyl(g, M.steel, 0.011, 0.011, 0.08, 0, 0.06, 0.37, 10);
    cyl(g, M.black, 0.016, 0.016, 0.05, 0, 0.06, 0.43, 10);                       // Daempfer-Stummel
    rb(g, M.poly, 0.03, 0.1, 0.045, 0, -0.025, 0.0, -0.25, 0, 0, 0.01);            // Griff
    const mag = rb(g, M.black, 0.026, 0.16, 0.035, 0, -0.045, 0.13, 0.18, 0, 0, 0.006); // gebogenes Magazin (angedeutet)
    mag.scale.set(1, 1, 1);
    rb(g, M.steel, 0.022, 0.02, 0.24, 0, 0.088, 0.1);                             // Schiene
    rb(g, M.black, 0.03, 0.03, 0.04, 0, 0.11, 0.06);                              // Visier
    // Klappschaft
    rb(g, M.steel, 0.012, 0.012, 0.2, 0.02, 0.06, -0.12); rb(g, M.steel, 0.012, 0.012, 0.2, -0.02, 0.06, -0.12);
    rb(g, M.poly, 0.05, 0.07, 0.02, 0, 0.05, -0.22, 0, 0, 0, 0.006);
    g.userData.muzzle = new THREE.Vector3(0, 0.06, 0.46); g.userData.length = 0.68;
  } else {
    // Sturmgewehr mit Holzmoebeln
    rb(g, M.steel, 0.048, 0.06, 0.3, 0, 0.055, 0.12, 0, 0, 0, 0.008);              // Gehaeuse
    rb(g, M.steel, 0.044, 0.02, 0.26, 0, 0.09, 0.11, 0, 0, 0, 0.008);              // Deckel
    rb(g, M.wood, 0.05, 0.05, 0.2, 0, 0.045, 0.37, 0, 0, 0, 0.014);                // Handschutz unten
    rb(g, M.wood, 0.036, 0.026, 0.16, 0, 0.088, 0.36, 0, 0, 0, 0.01);              // Handschutz oben
    cyl(g, M.steel, 0.009, 0.009, 0.18, 0, 0.088, 0.48, 8);                        // Gasrohr
    cyl(g, M.steel, 0.011, 0.011, 0.34, 0, 0.062, 0.6, 10);                        // Lauf
    rb(g, M.steel, 0.01, 0.04, 0.012, 0, 0.09, 0.72);                              // Korn
    cyl(g, M.black, 0.015, 0.013, 0.06, 0, 0.062, 0.78, 10);                       // Muendung
    rb(g, M.wood, 0.032, 0.105, 0.05, 0, -0.025, 0.0, -0.3, 0, 0, 0.012);          // Pistolengriff
    // gebogenes Magazin aus drei Gliedern
    for (let i = 0; i < 3; i++) rb(g, M.black, 0.028, 0.065, 0.07, 0, -0.01 - i * 0.055, 0.17 + i * 0.022, 0.22 + i * 0.16, 0, 0, 0.008);
    rb(g, M.steel, 0.012, 0.025, 0.07, 0, 0.0, 0.08);                              // Abzugsbuegel
    // Holzschaft
    rb(g, M.wood, 0.042, 0.08, 0.26, 0, 0.03, -0.17, -0.12, 0, 0, 0.016);
    rb(g, M.black, 0.044, 0.1, 0.02, 0, 0.0, -0.3, -0.12, 0, 0, 0.006);
    g.userData.muzzle = new THREE.Vector3(0, 0.062, 0.81); g.userData.length = 1.0;
  }
  g.userData.probe = M.probe;
  return g;
}
