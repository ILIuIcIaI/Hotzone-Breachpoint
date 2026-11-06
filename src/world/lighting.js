// Licht-Baking: berechnet pro Vertex direkte Beleuchtung mit Schatten, Raumfuellung (Fake-GI),
// Mondlicht durch Fenster und Umgebungsverdeckung. Ergebnis landet im Vertex-Attribut "bake".
// Dynamische Objekte bekommen ihr Umgebungslicht aus einem Probe-Gitter.
import * as THREE from 'three';
import { roomAt, rooms } from './level.js';

const MOON_DIR = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();
const MOON_COL = [0.55, 0.68, 1.05];
const SKY_COL = [0.07, 0.095, 0.16];
const BASE = [0.012, 0.013, 0.016];

export class LightBaker {
  constructor(world, lights) {
    this.world = world;
    this.lights = lights;
    // Raumfuellung: Summe der Lichtleistung je Raum / Flaeche
    this.fill = new Map();
    for (const r of rooms) {
      let s = [0, 0, 0];
      for (const L of lights) if (L.room === r.id) { s[0] += L.color[0] * L.I; s[1] += L.color[1] * L.I; s[2] += L.color[2] * L.I; }
      const area = (r.x1 - r.x0) * (r.z1 - r.z0);
      const k = 1.1 / Math.sqrt(area + 4);
      this.fill.set(r.id, [s[0] * k * 0.26, s[1] * k * 0.26, s[2] * k * 0.26]);
    }
    // Lichtgitter fuer schnelle Kandidatensuche
    this.lgrid = new Map();
    for (const L of lights) {
      const R = L.range;
      for (let gx = Math.floor((L.x - R) / 4); gx <= Math.floor((L.x + R) / 4); gx++)
        for (let gz = Math.floor((L.z - R) / 4); gz <= Math.floor((L.z + R) / 4); gz++) {
          const k = gx * 10007 + gz;
          if (!this.lgrid.has(k)) this.lgrid.set(k, []);
          this.lgrid.get(k).push(L);
        }
    }
    // feste Hemisphaeren-Richtungen fuer AO
    this.aoDirs = [];
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 7);
      this.aoDirs.push([Math.cos(a) * r, Math.sqrt(1 - r * r), Math.sin(a) * r]);
    }
    this.probeCache = new Map();
  }

  near(x, z) { return this.lgrid.get(Math.floor(x / 4) * 10007 + Math.floor(z / 4)) || EMPTY; }

  // Kern: Irradianz an Punkt p mit Normale n
  sample(px, py, pz, nx, ny, nz, hx, hz, out, quality = 1) {
    const W = this.world;
    let sx = px + nx * 0.035, sy = py + ny * 0.035, sz = pz + nz * 0.035;
    // Punkt steckt in Geometrie (z.B. Boden unter Wand): Richtung Raummitte schieben
    if (W.pointInSolid(sx, sy, sz, 0.01)) {
      if (!isNaN(hx)) {
        const dx = hx - sx, dz = hz - sz, d = Math.hypot(dx, dz) || 1;
        for (let k = 1; k <= 4; k++) {
          const tx = sx + dx / d * 0.1 * k, tz = sz + dz / d * 0.1 * k;
          if (!W.pointInSolid(tx, sy, tz, 0.01)) { sx = tx; sz = tz; break; }
        }
      }
    }
    let r = 0, g = 0, b = 0, ir = 0, ig = 0, ib = 0;
    const cand = this.near(sx, sz);
    for (let i = 0; i < cand.length; i++) {
      const L = cand[i];
      const dx = L.x - sx, dy = L.y - sy, dz = L.z - sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > L.range * L.range) continue;
      const d = Math.sqrt(d2) + 1e-6;
      const ndl = (dx * nx + dy * ny + dz * nz) / d;
      const fade = 1 - smooth(L.range * 0.55, L.range, d);
      const fall = L.I / (1 + d2 / 2.4) * fade;
      if (fall < 0.002) continue;
      const emit = L.ceiling ? Math.max(0.12, dy / d) : 1;
      // weiche Schatten: 2 Samples auf der Leuchtflaeche
      let vis = 0;
      const ns = quality > 0 && L.sx > 0.5 ? 2 : 1;
      for (let s = 0; s < ns; s++) {
        const ox = ns === 2 ? (s ? 0.28 : -0.28) * L.sx : 0, oz = ns === 2 ? (s ? -0.2 : 0.2) * L.sz : 0;
        if (!W.occluded(sx, sy, sz, L.x + ox, L.y, L.z + oz)) vis += 1 / ns;
      }
      if (vis <= 0) continue;
      const f = fall * vis;
      if (ndl > 0) { const k = f * ndl * emit; r += L.color[0] * k; g += L.color[1] * k; b += L.color[2] * k; }
      const kk = f * 0.09;
      ir += L.color[0] * kk; ig += L.color[1] * kk; ib += L.color[2] * kk;
    }
    // Mond (durch Fenster / draussen)
    const mdl = nx * MOON_DIR.x + ny * MOON_DIR.y + nz * MOON_DIR.z;
    if (mdl > 0 && !W.occluded(sx, sy, sz, sx + MOON_DIR.x * 60, sy + MOON_DIR.y * 60, sz + MOON_DIR.z * 60)) {
      r += MOON_COL[0] * mdl; g += MOON_COL[1] * mdl; b += MOON_COL[2] * mdl;
    }
    // Himmel + AO
    let open = 0, sky = 0;
    const tx = Math.abs(ny) < 0.9 ? 0 : 1;
    // Basis um n
    let ux, uy, uz;
    if (tx === 0) { ux = 0; uy = 1; uz = 0; } else { ux = 1; uy = 0; uz = 0; }
    // t = normalize(cross(u, n)), bt = cross(n, t)
    let t1x = uy * nz - uz * ny, t1y = uz * nx - ux * nz, t1z = ux * ny - uy * nx;
    const tl = Math.hypot(t1x, t1y, t1z) || 1; t1x /= tl; t1y /= tl; t1z /= tl;
    const b1x = ny * t1z - nz * t1y, b1y = nz * t1x - nx * t1z, b1z = nx * t1y - ny * t1x;
    const rot = (px * 3.1 + pz * 1.7 + py * 2.3) % 6.283;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const nAO = quality > 0 ? this.aoDirs.length : 3;
    for (let i = 0; i < nAO; i++) {
      const d = this.aoDirs[i];
      const lx = d[0] * cr - d[2] * sr, lz = d[0] * sr + d[2] * cr;
      const wx = t1x * lx + nx * d[1] + b1x * lz, wy = t1y * lx + ny * d[1] + b1y * lz, wz = t1z * lx + nz * d[1] + b1z * lz;
      if (!W.occluded(sx, sy, sz, sx + wx * 0.75, sy + wy * 0.75, sz + wz * 0.75)) open++;
      if (wy > 0.25 && i < 3 && !W.occluded(sx, sy, sz, sx + wx * 40, sy + wy * 40, sz + wz * 40)) sky++;
    }
    const ao = 0.28 + 0.72 * (open / nAO);
    const skyK = sky / 3;
    const room = roomAt(sx, sz);
    const fill = room && sy < 3.05 ? this.fill.get(room.id) : NOFILL;
    out[0] = r + (ir + fill[0] + SKY_COL[0] * skyK * 3 + BASE[0]) * ao;
    out[1] = g + (ig + fill[1] + SKY_COL[1] * skyK * 3 + BASE[1]) * ao;
    out[2] = b + (ib + fill[2] + SKY_COL[2] * skyK * 3 + BASE[2]) * ao;
    return out;
  }

  // Lichtprobe fuer bewegliche Objekte (richtungsunabhaengig), gecacht auf 0.75-m-Gitter
  probe(x, y, z, out) {
    const gx = Math.round(x / 0.75), gy = Math.round(y / 0.75), gz = Math.round(z / 0.75);
    const key = (gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791);
    let c = this.probeCache.get(key);
    if (!c) {
      c = [0, 0, 0];
      const px = gx * 0.75, py = Math.max(0.2, gy * 0.75), pz = gz * 0.75;
      const W = this.world;
      let qx = px, qz = pz;
      if (W.pointInSolid(px, py, pz, 0.02)) { qx = x; qz = z; }
      const tmp = [0, 0, 0];
      // Mittel aus 4 Normalen (oben + 3 seitlich)
      const N = [[0, 1, 0], [1, 0, 0], [-0.5, 0, 0.866], [-0.5, 0, -0.866]];
      for (const n of N) { this.sample(qx, py, qz, n[0], n[1], n[2], NaN, NaN, tmp, 0); c[0] += tmp[0] / 4; c[1] += tmp[1] / 4; c[2] += tmp[2] / 4; }
      this.probeCache.set(key, c);
    }
    out.setRGB(c[0], c[1], c[2]);
    return out;
  }

  // Alle Buckets backen, in Haeppchen (UI bleibt fluessig)
  async bakeBuckets(builder, M, onProgress, quality) {
    const meshes = [];
    let total = 0, done = 0;
    for (const [, B] of builder.buckets) total += B.pos.length / 3;
    const tmp = [0, 0, 0];
    let lastYield = performance.now();
    for (const [key, B] of builder.buckets) {
      const m = M[key];
      const n = B.pos.length / 3;
      const bake = new Float32Array(n * 3);
      if (!m.unlit) {
        for (let i = 0; i < n; i++) {
          this.sample(B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2], B.nor[i * 3], B.nor[i * 3 + 1], B.nor[i * 3 + 2], B.hint[i * 2], B.hint[i * 2 + 1], tmp, quality === 'low' ? 0 : 1);
          bake[i * 3] = tmp[0]; bake[i * 3 + 1] = tmp[1]; bake[i * 3 + 2] = tmp[2];
          done++;
          if ((done & 511) === 0 && performance.now() - lastYield > 30) {
            onProgress(done / total);
            await new Promise((r) => setTimeout(r, 0));
            lastYield = performance.now();
          }
        }
      } else done += n;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      geo.setAttribute('bake', new THREE.BufferAttribute(bake, 3));
      geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, m.mat);
      mesh.receiveShadow = !m.unlit;
      mesh.castShadow = !m.unlit;
      mesh.matrixAutoUpdate = false;
      mesh.userData.key = key;
      meshes.push(mesh);
    }
    onProgress(1);
    return meshes;
  }
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const EMPTY = [];
const NOFILL = [0, 0, 0];
