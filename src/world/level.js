// Map: Meridian Logistik – Verwaltungsgebaeude (ein Geschoss, 48 x 32 m) + Parkplatz.
// Erzeugt Kollisionsboxen, Render-Geometrie (pro Material zusammengefuehrt), Tueren, Lichter, Spawns.
import * as THREE from 'three';
import { Door } from './doors.js';

export const CEIL = 3.0;
const EXT_TOP = 3.6;

// ---------------- Raeume ----------------
const ROOMS = [
  ['break', 'Pausenraum', 0, 0, 12, 10, 'tile', 'paint_green', 'on'],
  ['security', 'Sicherheitsbüro', 12, 0, 18, 10, 'carpet_grey', 'paint_grey', 'dim'],
  ['lobby', 'Empfang', 18, 0, 30, 10, 'tile_dark', 'paint_white', 'on'],
  ['conference', 'Konferenzraum', 30, 0, 40, 10, 'carpet_blue', 'paint_beige', 'on'],
  ['storage', 'Lager', 40, 0, 48, 10, 'concrete_floor', 'paint_grey', 'emergency'],
  ['corrS', 'Hauptflur', 0, 10, 48, 12.5, 'tile', 'paint_white', 'corridor'],
  ['officeWS', 'Büro West 1', 0, 12.5, 12, 17, 'carpet_red', 'paint_beige', 'off'],
  ['officeWN', 'Büro West 2', 0, 17, 12, 22, 'carpet_red', 'paint_beige', 'on'],
  ['connW', 'Durchgang West', 12, 12.5, 14, 22, 'tile', 'paint_white', 'corridor'],
  ['open', 'Großraumbüro', 14, 12.5, 36, 22, 'carpet_blue', 'paint_white', 'half'],
  ['connE', 'Durchgang Ost', 36, 12.5, 38, 22, 'tile', 'paint_white', 'off'],
  ['server', 'Serverraum', 38, 12.5, 48, 22, 'concrete_floor', 'paint_grey', 'server'],
  ['corrN', 'Nordflur', 0, 22, 48, 24.5, 'tile', 'paint_white', 'corridor'],
  ['officeA', 'Büro A', 0, 24.5, 8, 32, 'carpet_grey', 'paint_blue', 'on'],
  ['officeB', 'Büro B', 8, 24.5, 16, 32, 'carpet_grey', 'paint_blue', 'off'],
  ['exec', 'Geschäftsführung', 16, 24.5, 28, 32, 'carpet_red', 'paint_beige', 'on'],
  ['archive', 'Archiv', 28, 24.5, 36, 32, 'carpet_grey', 'paint_grey', 'flicker'],
  ['stairs', 'Treppenhaus', 36, 24.5, 42, 32, 'concrete_floor', 'paint_grey', 'off'],
  ['officeC', 'Büro C', 42, 24.5, 48, 32, 'carpet_grey', 'paint_blue', 'off'],
].map(([id, name, x0, z0, x1, z1, floor, wall, light]) => ({ id, name, x0, z0, x1, z1, floor, wall, light, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 }));

export function roomAt(x, z) {
  // engste Raumdefinition gewinnt (Flure ueberlappen nicht, aber sicherheitshalber)
  let best = null, area = 1e9;
  for (const r of ROOMS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      const a = (r.x1 - r.x0) * (r.z1 - r.z0);
      if (a < area) { area = a; best = r; }
    }
  }
  return best;
}
export const rooms = ROOMS;

// ---------------- Waende ----------------
// [achse, lage, von, bis, oeffnungen, ext]
// achse 'x': Wand laeuft entlang x bei z=lage. Oeffnung: [mitte, breite, typ, extra]
const WALLS = [
  // Aussenwaende
  ['x', 0, -0.3, 48.3, [[3.5, 2, 'win'], [8.5, 2, 'win'], [15, 1.6, 'win'], [20.5, 2.4, 'win'], [24, 2.0, 'door2'], [27.5, 2.4, 'win'], [33, 2, 'win'], [37, 2, 'win'], [44, 1.4, 'win']], 'S'],
  ['x', 32, -0.3, 48.3, [[4, 2, 'win'], [12, 2, 'win'], [19, 2, 'win'], [25, 2, 'win'], [32, 2, 'win'], [45, 1.6, 'win']], 'N'],
  ['z', 0, 0, 32, [[5, 2, 'win'], [14.7, 1.6, 'win'], [19.5, 1.6, 'win'], [28, 2, 'win']], 'W'],
  ['z', 48, 0, 32, [[5, 1.0, 'metal'], [28, 1.6, 'win']], 'E'],
  // Suedtrakt
  ['x', 10, 0, 48, [[9, 0.95, 'door', { window: true }], [15, 0.95, 'door'], [24, 4, 'open'], [32, 0.95, 'door', { window: true }], [38, 0.95, 'door'], [44, 0.95, 'door']]],
  ['z', 12, 0, 10, []],
  ['z', 18, 0, 10, [[5, 1.6, 'win']]],
  ['z', 30, 0, 10, [[5, 3.0, 'win']]],
  ['z', 40, 0, 10, [[7, 0.95, 'door']]],
  // Mitteltrakt
  ['x', 12.5, 0, 48, [[6, 0.95, 'door'], [13, 1.8, 'open'], [18, 2, 'open'], [26, 3, 'open'], [33, 2, 'open'], [37, 1.8, 'open'], [43, 0.95, 'door', { window: true }]]],
  ['x', 17, 0, 12, []],
  ['z', 12, 12.5, 22, [[19.5, 0.95, 'door']]],
  ['z', 14, 12.5, 22, [[17, 2, 'open']]],
  ['z', 36, 12.5, 22, [[17, 2, 'open']]],
  ['z', 38, 12.5, 22, []],
  ['x', 22, 0, 48, [[13, 1.8, 'open'], [18, 2, 'open'], [26, 3, 'open'], [33, 2, 'open'], [37, 1.8, 'open'], [45, 0.95, 'door']]],
  // Nordtrakt
  ['x', 24.5, 0, 48, [[4, 0.95, 'door'], [12, 0.95, 'door'], [19.5, 0.95, 'door', { window: true }], [25.5, 0.95, 'door'], [32, 0.95, 'door'], [39, 0.95, 'locked'], [45, 0.95, 'door']]],
  ['z', 8, 24.5, 32, [[28, 0.95, 'door']]],
  ['z', 16, 24.5, 32, []],
  ['z', 28, 24.5, 32, [[29, 0.95, 'door']]],
  ['z', 36, 24.5, 32, []],
  ['z', 42, 24.5, 32, []],
];

// ---------------- Spawns ----------------
export const SPAWNS = {
  player: { x: 24, z: -8, yaw: 0 },
  suspects: [
    { x: 22.8, z: 7.6, yaw: Math.PI, weapon: 'rifle', patrol: [[22.8, 7.6], [21, 9.2], [19.6, 5.2]], aggression: 0.6, morale: 0.6, name: 'Lobby' },
    { x: 15, z: 4.8, yaw: Math.PI / 2 + 0.6, weapon: 'pistol', aggression: 0.4, morale: 0.4 },
    { x: 35, z: 3.2, yaw: Math.PI + 0.3, weapon: 'rifle', aggression: 0.5, morale: 0.35 },
    { x: 17, z: 19.6, yaw: Math.PI / 2, weapon: 'rifle', patrol: [[15, 19.6], [31.5, 19.6], [31.5, 13.2], [22.7, 13.2], [22.7, 19.6]], aggression: 0.7, morale: 0.7 },
    { x: 30.5, z: 19.5, yaw: Math.PI, weapon: 'smg', aggression: 0.8, morale: 0.6 },
    { x: 42.5, z: 18, yaw: -Math.PI / 2, weapon: 'rifle', armor: true, aggression: 0.7, morale: 0.85 },
    { x: 18.8, z: 26.4, yaw: Math.PI / 2, weapon: 'pistol', aggression: 0.5, morale: 0.5 },
    { x: 26, z: 30.2, yaw: -Math.PI / 2 - 0.4, weapon: 'rifle', armor: true, aggression: 0.75, morale: 0.8 },
    { x: 3, z: 23.2, yaw: Math.PI / 2, weapon: 'pistol', patrol: [[3, 23.2], [46, 23.2]], aggression: 0.5, morale: 0.5 },
    { x: 31, z: 30, yaw: Math.PI, weapon: 'smg', aggression: 0.6, morale: 0.45 },
    { x: 44.5, z: 3, yaw: -Math.PI / 2, weapon: 'rifle', patrol: [[42.5, 3], [46, 7.5], [43, 8]], aggression: 0.5, morale: 0.5 },
    { x: 45, z: 29, yaw: Math.PI, weapon: 'pistol', aggression: 0.2, morale: 0.25 },
    { x: 6.5, z: 6, yaw: -Math.PI / 2, weapon: 'pistol', aggression: 0.55, morale: 0.5 },
  ],
  hostages: [
    { x: 21, z: 30.6, yaw: Math.PI },
    { x: 23.2, z: 30.6, yaw: Math.PI },
    { x: 1.5, z: 7.6, yaw: Math.PI / 2 },
  ],
  civilians: [
    { x: 13.2, z: 30.6, yaw: Math.PI },
    { x: 2.8, z: 20.8, yaw: Math.PI / 2 },
  ],
  evidence: { x: 40.4, y: 0.79, z: 14.3 },
};

// ---------------- Builder ----------------
export class LevelBuilder {
  constructor(world, M) {
    this.world = world;
    this.M = M;
    this.buckets = new Map();   // matKey -> {pos:[],nor:[],uv:[],idx:[],hint:[]}
    this.lights = [];
    this.dynLights = [];        // flackernde Lichter
    this.doors = [];
    this.decor = [];            // {mesh} sonstige Objekte
    this.glassBoxes = [];
    this.panels = [];           // Leuchtenmeshes je Material
    this.exitSigns = [];
    this.flickerPanels = [];
    this.floorType = (x, z) => { const r = roomAt(x, z); return r ? r.floor : 'asphalt'; };
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { pos: [], nor: [], uv: [], idx: [], hint: [] }; this.buckets.set(key, b); }
    return b;
  }

  // Box: Kollision + Render. faces: {px,nx,py,ny,pz,nz}: key|null
  box(x0, y0, z0, x1, y1, z1, key, opts = {}) {
    const phys = opts.phys ?? (this.M[key] ? this.M[key].phys : 'concrete');
    if (opts.collide !== false) {
      const b = this.world.addBox(x0, y0, z0, x1, y1, z1, phys, opts);
      b.visual = key;
    }
    if (opts.visible !== false) this.renderBox(x0, y0, z0, x1, y1, z1, key, opts.faces || {}, opts.hint, opts.step);
  }

  renderBox(x0, y0, z0, x1, y1, z1, key, faces = {}, hint = null, step = 0.5) {
    const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    const F = (name) => (name in faces ? faces[name] : key);
    const skipBottom = lo[1] <= 0.001 && !('ny' in faces);
    // +X
    this.face(F('px'), [hi[0], lo[1], lo[2]], [0, hi[1] - lo[1], 0], [0, 0, hi[2] - lo[2]], [1, 0, 0], 'X+', hint, step);
    this.face(F('nx'), [lo[0], lo[1], lo[2]], [0, 0, hi[2] - lo[2]], [0, hi[1] - lo[1], 0], [-1, 0, 0], 'X-', hint, step);
    this.face(F('py'), [lo[0], hi[1], lo[2]], [0, 0, hi[2] - lo[2]], [hi[0] - lo[0], 0, 0], [0, 1, 0], 'Y+', hint, step);
    if (!skipBottom) this.face(F('ny'), [lo[0], lo[1], lo[2]], [hi[0] - lo[0], 0, 0], [0, 0, hi[2] - lo[2]], [0, -1, 0], 'Y-', hint, step);
    this.face(F('pz'), [lo[0], lo[1], hi[2]], [hi[0] - lo[0], 0, 0], [0, hi[1] - lo[1], 0], [0, 0, 1], 'Z+', hint, step);
    this.face(F('nz'), [lo[0], lo[1], lo[2]], [0, hi[1] - lo[1], 0], [hi[0] - lo[0], 0, 0], [0, 0, -1], 'Z-', hint, step);
  }

  face(key, o, u, v, n, kind, hint, step = 0.5) {
    if (!key) return;
    const m = this.M[key];
    if (!m) { console.warn('Material fehlt', key); return; }
    if (m.transparent) return;
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (lu < 1e-4 || lv < 1e-4) return;
    const st = m.unlit ? 100 : step;
    const nu = Math.max(1, Math.ceil(lu / st - 0.01)), nv = Math.max(1, Math.ceil(lv / st - 0.01));
    const B = this.bucket(key);
    const base = B.pos.length / 3;
    const tex = m.tex;
    const faceUV = m.mat.map && (key === 'server' || key === 'screen' || key === 'camscreen' || key === 'logo' || key === 'police' || key === 'exit_sign');
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      const px = o[0] + u[0] * a + v[0] * b, py = o[1] + u[1] * a + v[1] * b, pz = o[2] + u[2] * a + v[2] * b;
      B.pos.push(px, py, pz); B.nor.push(n[0], n[1], n[2]);
      if (faceUV) {
        let U, V;
        switch (kind) {
          case 'Z+': U = a; V = b; break;
          case 'Z-': U = 1 - b; V = a; break;
          case 'X+': U = 1 - b; V = a; break;
          case 'X-': U = a; V = b; break;
          default: U = a; V = b;
        }
        B.uv.push(U, V);
      } else if (kind[0] === 'X') B.uv.push(pz / tex, py / tex);
      else if (kind[0] === 'Y') B.uv.push(px / tex, pz / tex);
      else B.uv.push(px / tex, py / tex);
      B.hint.push(hint ? hint[0] : NaN, hint ? hint[1] : NaN);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + (nu + 1) + 1, d = a + (nu + 1);
      B.idx.push(a, b, c, a, c, d);
    }
  }

  // Lokale Teile mit Drehung (rot = Vierteldrehungen) platzieren
  place(x, z, rot, parts) {
    for (const p of parts) {
      let [ax, ay, az, bx, by, bz, key, opts] = p;
      opts = opts ? { ...opts } : {};
      const tr = (lx, lz) => {
        switch (rot & 3) {
          case 0: return [x + lx, z + lz];
          case 1: return [x + lz, z - lx];
          case 2: return [x - lx, z - lz];
          default: return [x - lz, z + lx];
        }
      };
      const [p0x, p0z] = tr(ax, az), [p1x, p1z] = tr(bx, bz);
      if (opts.faces) {
        // Flaechennamen mitdrehen
        const f = opts.faces, nf = {};
        const mapFace = (name) => {
          const seq = ['pz', 'px', 'nz', 'nx']; // Drehung um -90 Grad je Schritt (rot 1: lokal +z -> welt +x)
          const i = seq.indexOf(name);
          if (i < 0) return name;
          return seq[(i + (rot & 3)) % 4];
        };
        for (const k in f) nf[mapFace(k)] = f[k];
        opts.faces = nf;
      }
      this.box(p0x, ay, p0z, p1x, by, p1z, key, opts);
    }
  }

  // ---------- Waende ----------
  buildWalls() {
    for (const w of WALLS) {
      const [axis, at, from, to, openings, ext] = w;
      const t = ext ? 0.3 : 0.2;
      // Querschnitt
      let c0, c1;
      if (ext === 'S' || ext === 'W') { c0 = at - t; c1 = at; }
      else if (ext === 'N' || ext === 'E') { c0 = at; c1 = at + t; }
      else { c0 = at - t / 2; c1 = at + t / 2; }
      const top = ext ? EXT_TOP : CEIL;
      const ops = [...openings].sort((a, b) => a[0] - b[0]);
      let cur = from;
      const seg = (a, b, y0, y1) => {
        if (b - a < 0.005 || y1 - y0 < 0.005) return;
        this.wallPiece(axis, a, b, c0, c1, y0, y1, !!ext);
      };
      for (const op of ops) {
        const [mid, wid, type, extra] = op;
        const a = mid - wid / 2, b = mid + wid / 2;
        seg(cur, a, 0, top);
        if (type === 'win') {
          seg(a, b, 0, 0.9); seg(a, b, 2.3, top);
          this.windowPane(axis, a, b, c0, c1, 0.9, 2.3, !!ext);
        } else if (type === 'open') {
          seg(a, b, 2.45, top);
          this.openingTrim(axis, a, b, c0, c1, 2.45);
        } else {
          const dh = 2.1;
          seg(a, b, dh, top);
          this.doorway(axis, a, b, c0, c1, (c0 + c1) / 2, type, extra || {}, dh);
        }
        cur = b;
      }
      seg(cur, to, 0, top);
    }
    // Dach + Decken-Kollision
    this.box(-0.3, CEIL, -0.3, 48.3, 3.35, 32.3, 'roof', { faces: { ny: null, px: null, nx: null, pz: null, nz: null } });
    // Boden-Kollision (unsichtbar, gerendert wird je Raum)
    this.world.addBox(-60, -1, -60, 110, 0, 110, 'concrete', {}).visual = null;
  }

  sideKey(axis, a, b, c, y, ext, side) {
    // Material einer Wandseite per Raumabfrage
    const m = (a + b) / 2;
    const x = axis === 'x' ? m : c, z = axis === 'x' ? c : m;
    const r = roomAt(x, z);
    if (!r) return 'facade';
    // Lobby: Akzentwand an der Nordseite hinter dem Empfang
    return r.wall;
  }

  wallPiece(axis, a, b, c0, c1, y0, y1, ext) {
    const eps = 0.06;
    if (axis === 'x') {
      const kNeg = this.sideKey('x', a, b, c0 - eps, y0, ext), kPos = this.sideKey('x', a, b, c1 + eps, y0, ext);
      const faces = { nz: kNeg, pz: kPos, py: ext ? 'roof' : null, px: kNeg === 'facade' || kPos === 'facade' ? 'facade' : kPos, nx: kNeg === 'facade' || kPos === 'facade' ? 'facade' : kNeg };
      if (y0 > 0.01) faces.ny = kPos;
      this.box(a, y0, c0, b, y1, c1, kPos === 'facade' ? kNeg : kPos, { faces, phys: ext ? 'concrete' : 'drywall' });
      if (y0 < 0.01) {
        if (kNeg !== 'facade') this.box(a, 0, c0 - 0.014, b, 0.09, c0, 'baseboard', { collide: false, faces: { pz: null } });
        if (kPos !== 'facade') this.box(a, 0, c1, b, 0.09, c1 + 0.014, 'baseboard', { collide: false, faces: { nz: null } });
      }
    } else {
      const kNeg = this.sideKey('z', a, b, c0 - eps, y0, ext), kPos = this.sideKey('z', a, b, c1 + eps, y0, ext);
      const faces = { nx: kNeg, px: kPos, py: ext ? 'roof' : null, pz: kNeg === 'facade' || kPos === 'facade' ? 'facade' : kPos, nz: kNeg === 'facade' || kPos === 'facade' ? 'facade' : kNeg };
      if (y0 > 0.01) faces.ny = kPos;
      this.box(c0, y0, a, c1, y1, b, kPos === 'facade' ? kNeg : kPos, { faces, phys: ext ? 'concrete' : 'drywall' });
      if (y0 < 0.01) {
        if (kNeg !== 'facade') this.box(c0 - 0.014, 0, a, c0, 0.09, b, 'baseboard', { collide: false, faces: { px: null } });
        if (kPos !== 'facade') this.box(c1, 0, a, c1 + 0.014, 0.09, b, 'baseboard', { collide: false, faces: { nx: null } });
      }
    }
  }

  windowPane(axis, a, b, c0, c1, y0, y1, ext) {
    const mid = (c0 + c1) / 2;
    const fr = 'metal_dark';
    if (axis === 'x') {
      const gb = this.world.addBox(a, y0, mid - 0.01, b, y1, mid + 0.01, 'glass', { blocksLight: false, blocksSight: false }); gb.visual = 'glass';
      this.glassBoxes.push([a, y0, mid - 0.006, b, y1, mid + 0.006, gb]);
      this.box(a + 0.002, y0 - 0.03, c0 - 0.04, b - 0.002, y0 + 0.012, c1 + 0.04, 'laminate', { collide: false });
      this.box(a, y0, mid - 0.03, a + 0.05, y1, mid + 0.03, fr, { collide: false });
      this.box(b - 0.05, y0, mid - 0.03, b, y1, mid + 0.03, fr, { collide: false });
      this.box(a, y1 - 0.05, mid - 0.03, b, y1, mid + 0.03, fr, { collide: false });
      if (b - a > 1.7) this.box((a + b) / 2 - 0.025, y0, mid - 0.03, (a + b) / 2 + 0.025, y1, mid + 0.03, fr, { collide: false });
    } else {
      const gb = this.world.addBox(mid - 0.01, y0, a, mid + 0.01, y1, b, 'glass', { blocksLight: false, blocksSight: false }); gb.visual = 'glass';
      this.glassBoxes.push([mid - 0.006, y0, a, mid + 0.006, y1, b, gb]);
      this.box(c0 - 0.04, y0 - 0.03, a + 0.002, c1 + 0.04, y0 + 0.012, b - 0.002, 'laminate', { collide: false });
      this.box(mid - 0.03, y0, a, mid + 0.03, y1, a + 0.05, fr, { collide: false });
      this.box(mid - 0.03, y0, b - 0.05, mid + 0.03, y1, b, fr, { collide: false });
      this.box(mid - 0.03, y1 - 0.05, a, mid + 0.03, y1, b, fr, { collide: false });
      if (b - a > 1.7) this.box(mid - 0.03, y0, (a + b) / 2 - 0.025, mid + 0.03, y1, (a + b) / 2 + 0.025, fr, { collide: false });
    }
  }

  openingTrim(axis, a, b, c0, c1, h) {
    const k = 'paint_white';
    if (axis === 'x') { this.box(a, h - 0.05, c0 - 0.012, b, h, c1 + 0.012, k, { collide: false }); }
    else { this.box(c0 - 0.012, h - 0.05, a, c1 + 0.012, h, b, k, { collide: false }); }
  }

  doorway(axis, a, b, c0, c1, mid, type, extra, dh) {
    const trim = type === 'metal' ? 'metal_dark' : type === 'door2' ? 'metal_dark' : 'wood_dark';
    const tw = 0.06, po = 0.018;
    if (axis === 'x') {
      this.box(a - tw, 0, c0 - po, a, dh + tw, c1 + po, trim, { collide: false });
      this.box(b, 0, c0 - po, b + tw, dh + tw, c1 + po, trim, { collide: false });
      this.box(a, dh, c0 - po, b, dh + tw, c1 + po, trim, { collide: false });
    } else {
      this.box(c0 - po, 0, a - tw, c1 + po, dh + tw, a, trim, { collide: false });
      this.box(c0 - po, 0, b, c1 + po, dh + tw, b + tw, trim, { collide: false });
      this.box(c0 - po, dh, a, c1 + po, dh + tw, b, trim, { collide: false });
    }
    const baseAng = axis === 'x' ? 0 : Math.PI / 2;
    const hinge = (p) => axis === 'x' ? [p, mid] : [mid, p];
    const name = (roomAt(...(axis === 'x' ? [(a + b) / 2, mid + 0.5] : [mid + 0.5, (a + b) / 2])) || {}).name;
    if (type === 'door2') {
      const w = (b - a) / 2;
      const [h1x, h1z] = hinge(a), [h2x, h2z] = hinge(b);
      this.addDoor(new Door(this.world, { hx: h1x, hz: h1z, angle: baseAng, width: w - 0.01, kind: 'glass', mat: 'glass', height: dh, name }));
      this.addDoor(new Door(this.world, { hx: h2x, hz: h2z, angle: baseAng + Math.PI, width: w - 0.01, kind: 'glass', mat: 'glass', height: dh, name }));
    } else {
      const [hx, hz] = hinge(a + 0.005);
      const d = new Door(this.world, {
        hx, hz, angle: baseAng, width: (b - a) - 0.01, kind: type === 'metal' ? 'metal' : 'wood',
        mat: type === 'metal' ? 'metal' : 'wood', locked: type === 'locked', height: dh, name,
      });
      d.window = !!extra.window;
      this.addDoor(d);
    }
  }

  addDoor(d) { this.doors.push(d); this.world.doors.push(d); }

  // ---------- Boeden / Decken / Licht ----------
  buildFloorsCeilings() {
    for (const r of ROOMS) {
      const hint = [r.cx, r.cz];
      // Boden: leicht ueber y=0 als duenne Flaeche
      this.face(r.floor, [r.x0, 0, r.z0], [0, 0, r.z1 - r.z0], [r.x1 - r.x0, 0, 0], [0, 1, 0], 'Y+', hint, 0.5);
      // Decke
      this.face('ceiling', [r.x0, CEIL, r.z0], [r.x1 - r.x0, 0, 0], [0, 0, r.z1 - r.z0], [0, -1, 0], 'Y-', hint, 0.6);
      this.roomLights(r);
    }
  }

  roomLights(r) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const pts = [];
    const corridor = w < 3 || d < 3;
    if (corridor) {
      const along = w > d;
      const L = along ? w : d;
      const n = Math.max(1, Math.round(L / 3.2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        pts.push(along ? [r.x0 + t * w, r.cz, along] : [r.cx, r.z0 + t * d, along]);
      }
    } else {
      const nx = Math.max(1, Math.round(w / 2.8)), nz = Math.max(1, Math.round(d / 2.8));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) pts.push([r.x0 + (i + 0.5) * w / nx, r.z0 + (j + 0.5) * d / nz, true]);
    }
    const warm = [1.0, 0.95, 0.86];
    pts.forEach((p, idx) => {
      let on = false, kind = 'on';
      switch (r.light) {
        case 'on': on = true; break;
        case 'off': on = false; break;
        case 'half': on = (idx % 3) !== 1; break;
        case 'corridor': on = (idx % 2) === 0; break;
        case 'dim': on = idx === 0; break;
        case 'emergency': on = false; kind = 'emergency'; break;
        case 'server': on = idx === 1; break;
        case 'flicker': on = idx === 2; kind = idx === 2 ? 'flicker' : 'on'; if (idx !== 2) on = false; break;
      }
      const [x, z, along] = p;
      const sx = along ? 1.2 : 0.6, sz = along ? 0.6 : 1.2;
      const key = on ? (kind === 'flicker' ? 'lamp_on' : 'lamp_on') : 'lamp_off';
      this.renderBox(x - sx / 2, CEIL - 0.02, z - sz / 2, x + sx / 2, CEIL, z + sz / 2, kind === 'flicker' ? 'lamp_flicker' : key, { py: null });
      if (on && kind !== 'flicker') this.lights.push({ x, y: CEIL - 0.05, z, sx, sz, color: warm, I: 2.0, range: 9, room: r.id, ceiling: true });
      if (kind === 'flicker') this.dynLights.push({ x, y: CEIL - 0.25, z, color: 0xffeccc, I: 3, range: 9, flicker: true, room: r.id });
    });
    if (r.light === 'emergency') {
      this.renderBox(r.cx - 0.15, CEIL - 0.12, r.z1 - 0.18, r.cx + 0.15, CEIL - 0.02, r.z1 - 0.1, 'lamp_emergency', {});
      this.lights.push({ x: r.cx, y: CEIL - 0.2, z: r.z1 - 0.4, sx: 0.2, sz: 0.2, color: [1.0, 0.18, 0.12], I: 1.4, range: 10, room: r.id });
    }
    if (r.light === 'server') {
      this.lights.push({ x: r.cx, y: 2.4, z: r.cz, sx: 3, sz: 3, color: [0.25, 0.45, 1.0], I: 0.9, range: 8, room: r.id });
    }
  }

  exitSign(x, z, axis) {
    const a = axis === 'x';
    this.renderBox(x - (a ? 0.2 : 0.03), 2.25, z - (a ? 0.03 : 0.2), x + (a ? 0.2 : 0.03), 2.4, z + (a ? 0.03 : 0.2), 'exit_sign', {});
    this.lights.push({ x, y: 2.3, z, sx: 0.2, sz: 0.2, color: [0.2, 1.0, 0.4], I: 0.25, range: 3.5 });
  }

  // ---------- Moebel ----------
  furniture() {
    const P = this.place.bind(this);
    const desk = (x, z, rot, opts = {}) => P(x, z, rot, [
      [-0.8, 0.72, -0.4, 0.8, 0.76, 0.4, opts.top || 'laminate'],
      [-0.8, 0, -0.4, -0.76, 0.72, 0.4, 'laminate'],
      [0.76, 0, -0.4, 0.8, 0.72, 0.4, 'laminate'],
      [-0.76, 0.3, -0.4, 0.76, 0.72, -0.37, 'laminate'],
      ...(opts.noPc ? [] : [
        [-0.26, 0.86, -0.3, 0.26, 1.16, -0.27, 'plastic_black', { faces: { pz: 'screen' } }],
        [-0.03, 0.76, -0.33, 0.03, 0.86, -0.29, 'plastic_black'],
        [-0.12, 0.76, -0.36, 0.12, 0.775, -0.24, 'plastic_black'],
        [-0.22, 0.76, -0.08, 0.22, 0.78, 0.08, 'plastic_black', { collide: false }],
        [0.6, 0, -0.3, 0.78, 0.45, 0.2, 'plastic_black'],
      ]),
    ]);
    const chair = (x, z, rot) => P(x, z, rot, [
      [-0.24, 0.42, -0.24, 0.24, 0.5, 0.24, 'fabric_grey'],
      [-0.22, 0.52, 0.2, 0.22, 1.02, 0.26, 'fabric_grey'],
      [-0.03, 0.06, -0.03, 0.03, 0.42, 0.03, 'metal_dark', { collide: false }],
      [-0.28, 0.0, -0.04, 0.28, 0.06, 0.04, 'metal_dark', { collide: false }],
      [-0.04, 0.0, -0.28, 0.04, 0.06, 0.28, 'metal_dark', { collide: false }],
    ]);
    const cabinet = (x, z, rot, h = 1.32) => P(x, z, rot, [
      [-0.24, 0, -0.3, 0.24, h, 0.3, 'metal_paint'],
      ...[0.2, 0.55, 0.9].filter((y) => y < h - 0.2).map((y) => [-0.06, y + 0.15, 0.3, 0.06, y + 0.18, 0.32, 'metal', { collide: false }]),
    ]);
    const shelf = (x, z, rot, len = 2.0) => {
      const parts = [];
      const L = len / 2;
      for (const sx of [-L, L - 0.04]) for (const sz of [-0.2, 0.16]) parts.push([sx, 0, sz, sx + 0.04, 2.1, sz + 0.04, 'metal']);
      for (const y of [0.1, 0.6, 1.1, 1.6, 2.05]) parts.push([-L + 0.006, y, -0.195, L - 0.006, y + 0.03, 0.195, 'metal']);
      let s = Math.abs(Math.floor(x * 7 + z * 13));
      for (const y of [0.13, 0.63, 1.13, 1.63]) {
        let cx = -L + 0.05;
        while (cx < L - 0.4) {
          s = (s * 9301 + 49297) % 233280;
          const w = 0.28 + (s / 233280) * 0.25, hh = 0.25 + ((s * 7) % 100) / 100 * 0.18;
          if ((s % 5) !== 0) parts.push([cx, y, -0.17, cx + w, y + hh, 0.15, 'cardboard', { collide: false }]);
          cx += w + 0.04;
        }
      }
      P(x, z, rot, parts);
    };
    const table = (x, z, rot, w, d, key = 'wood_dark', h = 0.75) => P(x, z, rot, [
      [-w / 2, h - 0.04, -d / 2, w / 2, h, d / 2, key],
      [-w / 2 + 0.05, 0, -d / 2 + 0.05, -w / 2 + 0.11, h - 0.04, -d / 2 + 0.11, 'metal_dark'],
      [w / 2 - 0.11, 0, -d / 2 + 0.05, w / 2 - 0.05, h - 0.04, -d / 2 + 0.11, 'metal_dark'],
      [-w / 2 + 0.05, 0, d / 2 - 0.11, -w / 2 + 0.11, h - 0.04, d / 2 - 0.05, 'metal_dark'],
      [w / 2 - 0.11, 0, d / 2 - 0.11, w / 2 - 0.05, h - 0.04, d / 2 - 0.05, 'metal_dark'],
    ]);
    const rack = (x, z, rot) => P(x, z, rot, [
      [-0.3, 0, -0.5, 0.3, 2.0, 0.5, 'metal_dark', { faces: { pz: 'server' } }],
    ]);
    const crate = (x, z, rot, w, d, h) => P(x, z, rot, [[-w / 2, 0, -d / 2, w / 2, h, d / 2, 'cardboard']]);
    const pallet = (x, z, rot, stack) => P(x, z, rot, [
      [-0.6, 0, -0.4, 0.6, 0.14, 0.4, 'wood'],
      ...(stack ? [[-0.55, 0.14, -0.38, 0.55, 0.14 + stack, 0.38, 'cardboard']] : []),
    ]);
    const sofa = (x, z, rot, w = 2.0) => P(x, z, rot, [
      [-w / 2, 0, -0.45, w / 2, 0.42, 0.45, 'leather'],
      [-w / 2, 0.42, 0.25, w / 2, 0.85, 0.45, 'leather'],
      [-w / 2, 0.42, -0.45, -w / 2 + 0.18, 0.62, 0.25, 'leather'],
      [w / 2 - 0.18, 0.42, -0.45, w / 2, 0.62, 0.25, 'leather'],
    ]);
    const plant = (x, z) => this.decor.push({ type: 'plant', x, z });
    const cubicles = (x0, z0, nx, nz, opening) => {
      // Raster aus 2x2 m Kabinen, Trennwaende 1.35 m
      const s = 2.1, h = 1.35, t = 0.03;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * s;
        for (let j = 0; j < nz; j++) {
          const z = z0 + j * s;
          this.box(x - t, 0, z, x + t, h, z + s, 'fabric_blue', { phys: 'fabric' });
        }
      }
      for (let j = 0; j <= nz; j++) {
        const z = z0 + j * s;
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * s;
          const isOuter = j === 0 || j === nz;
          if (isOuter) {
            // Eingangsoeffnung zur Gangseite
            this.box(x, 0, z - t, x + 0.55, h, z + t, 'fabric_blue', { phys: 'fabric' });
            this.box(x + s - 0.55, 0, z - t, x + s, h, z + t, 'fabric_blue', { phys: 'fabric' });
          } else this.box(x, 0, z - t, x + s, h, z + t, 'fabric_blue', { phys: 'fabric' });
        }
      }
      // Kappen
      this.box(x0 - 0.04, h, z0 - 0.04, x0 + nx * s + 0.04, h + 0.03, z0 + 0.04, 'plastic_black', { collide: false });
      this.box(x0 - 0.04, h, z0 + nz * s - 0.04, x0 + nx * s + 0.04, h + 0.03, z0 + nz * s + 0.04, 'plastic_black', { collide: false });
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const cx = x0 + i * s + s / 2, cz = z0 + j * s + s / 2;
        // Schreibtisch an der inneren Trennwand, Eingang zur Gangseite
        if (j === 0) { desk(cx, cz + 0.55, 2); if ((i + j) % 3 !== 2) chair(cx + 0.2, cz - 0.2, 2); }
        else { desk(cx, cz - 0.55, 0); if ((i + j) % 3 !== 2) chair(cx + 0.2, cz + 0.2, 0); }
      }
    };

    // --- Pausenraum ---
    P(0, 0, 0, [[0.05, 0, 1, 0.65, 0.92, 9.2, 'wood'], [0.05, 0.92, 1, 0.68, 0.96, 9.2, 'laminate']]);
    P(0, 0, 0, [[0.05, 1.5, 1, 0.4, 2.2, 9.2, 'wood']]);
    P(0, 0, 0, [[0.05, 0, 0.25, 0.8, 1.85, 0.95, 'metal_paint']]); // Kuehlschrank
    P(11.95, 0, 0, [[-0.8, 0, 8.6, 0, 1.85, 9.6, 'plastic_black', { faces: { nx: 'screen' } }]]); // Automat
    table(5, 3.5, 0, 1.6, 0.9, 'laminate'); chair(5, 2.7, 2); chair(5, 4.3, 0);
    table(8.5, 3.5, 0, 1.6, 0.9, 'laminate'); chair(8.5, 2.7, 2); chair(8.2, 4.4, 0);
    table(5, 7, 0, 1.6, 0.9, 'laminate'); chair(5.2, 7.8, 0);
    plant(11.4, 0.6);
    // --- Sicherheitsbuero ---
    P(15, 0.5, 0, [[-2.6, 0, -0.1, 2.6, 0.75, 0.6, 'laminate'],
      [-2.4, 0.95, 0.05, -1.3, 1.6, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
      [-1.2, 0.95, 0.05, -0.1, 1.6, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
      [0.0, 0.95, 0.05, 1.1, 1.6, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
      [1.2, 0.95, 0.05, 2.3, 1.6, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
      [-2.4, 1.65, 0.05, -1.3, 2.3, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
      [1.2, 1.65, 0.05, 2.3, 2.3, 0.12, 'plastic_black', { faces: { pz: 'camscreen' } }],
    ]);
    chair(14.6, 1.8, 0); chair(16.3, 2.0, 0);
    for (let i = 0; i < 4; i++) P(12.4 + i * 0.5, 9.3, 0, [[-0.24, 0, -0.5, 0.24, 1.9, 0.5, 'metal_paint']]);
    cabinet(17.5, 7.6, 1);
    // --- Lobby ---
    P(24, 6.5, 0, [[-2.6, 0, -0.5, 2.6, 1.08, 0.2, 'wood_dark'], [-2.7, 1.08, -0.6, 2.7, 1.13, 0.3, 'laminate'],
      [-2.6, 0, 0.2, -2.0, 1.08, 2.0, 'wood_dark'], [2.0, 0, 0.2, 2.6, 1.08, 2.0, 'wood_dark']]);
    P(24, 9.9, 0, [[-1.5, 2.5, -0.06, 1.5, 2.95, 0, 'plastic_black', { faces: { nz: 'logo' }, collide: false }]]);
    desk(24.5, 7.8, 2, { noPc: false });
    sofa(19.4, 2.6, 1, 2.2); sofa(28.6, 2.6, 3, 2.2);
    table(24, 2.6, 0, 1.2, 0.6, 'laminate', 0.42);
    plant(18.6, 0.6); plant(29.4, 0.6); plant(18.6, 9.4);
    // --- Konferenzraum ---
    table(35, 5, 0, 5, 1.5, 'wood_dark');
    for (let i = 0; i < 4; i++) { chair(33 + i * 1.3, 3.8, 2); chair(33 + i * 1.3, 6.2, 0); }
    P(39.9, 5, 0, [[-0.08, 1.0, -1.1, 0, 2.2, 1.1, 'plastic_black', { faces: { nx: 'screen' } }]]);
    cabinet(30.6, 9.4, 0, 0.8); cabinet(31.2, 9.4, 0, 0.8);
    plant(39.4, 0.6);
    // --- Lager ---
    shelf(41.2, 2.5, 1, 3.6); shelf(41.2, 7.2, 1, 2.6);
    pallet(44, 1.2, 0, 1.0); pallet(45.6, 1.2, 0, 1.4); pallet(44.2, 5.8, 1, 0.8);
    crate(46.8, 8.6, 0, 1.0, 1.0, 1.0); crate(46.8, 8.6, 0, 0.7, 0.7, 1.6); crate(45.4, 9.1, 0, 0.8, 0.8, 0.7);
    P(43.5, 3.6, 0, [[-0.5, 0, -0.4, 0.5, 0.9, 0.4, 'metal_dark']]);
    // --- Buero West 1/2 ---
    desk(4, 14.2, 0); chair(4, 15.0, 0); desk(8.5, 14.2, 0); chair(8.4, 15.1, 0);
    cabinet(11.5, 16.4, 1); cabinet(0.4, 16.4, 3); plant(0.6, 13.0);
    desk(5, 19.0, 0); chair(5, 19.9, 0); cabinet(11.5, 21.4, 1); shelf(9, 21.6, 0, 2.6);
    sofa(1.0, 20.0, 1, 1.6);
    // --- Grossraumbuero ---
    cubicles(15.5, 13.8, 3, 2);
    cubicles(23.5, 13.8, 3, 2);
    table(33.5, 18, 0, 1.8, 1.0, 'laminate'); chair(33.5, 17.2, 2); chair(33.5, 18.8, 0);
    P(35.3, 14.2, 0, [[-0.4, 0, -0.35, 0.4, 1.05, 0.35, 'plastic_white']]); // Kopierer
    cabinet(35.6, 21.4, 1); cabinet(35.6, 20.8, 1); plant(14.6, 21.4); plant(35.4, 12.9);
    // --- Serverraum ---
    for (let i = 0; i < 4; i++) { rack(42 + i * 0.62 - 0.0, 15.6, 2); }
    for (let i = 0; i < 4; i++) { rack(42 + i * 0.62, 19.8, 0); }
    for (let i = 0; i < 3; i++) rack(47.4, 14.5 + i * 1.02, 1);
    table(40.4, 14.3, 1, 1.4, 0.7, 'metal', 0.76);
    chair(41.1, 14.4, 1);
    P(43.5, 17.7, 0, [[-2.2, 2.75, -0.15, 2.2, 2.8, 0.15, 'metal_dark', { collide: false }]]);
    // --- Nordbueros ---
    desk(4, 27.0, 0); chair(4, 27.9, 0); cabinet(0.4, 31.4, 3); cabinet(7.5, 31.4, 1); plant(7.4, 25.1);
    desk(12, 27.2, 0); chair(12.2, 28.1, 0); shelf(12, 31.6, 0, 3); cabinet(8.5, 25.2, 3);
    // Geschaeftsfuehrung
    desk(22, 27.4, 0, { top: 'wood_dark' }); chair(22, 28.3, 0);
    P(22, 31.75, 0, [[-2.5, 0, -0.2, 2.5, 2.2, 0.2, 'wood_dark']]); // Buecherwand
    sofa(16.6, 30, 1, 2.2); table(18.2, 30, 0, 0.6, 1.2, 'wood_dark', 0.42);
    table(26.3, 27, 1, 1.4, 1.4, 'wood_dark'); chair(26.3, 26.2, 2); chair(26.3, 27.8, 0);
    plant(27.4, 31.4); plant(16.6, 25.0);
    // Archiv
    for (let i = 0; i < 3; i++) { shelf(30 + i * 2.2, 27.2, 1, 3.2); }
    shelf(32, 31.6, 0, 6);
    // Buero C
    desk(45, 26.2, 0); chair(45, 27.1, 0); cabinet(47.6, 31.4, 1); crate(43, 31, 0, 0.6, 0.6, 0.5);
    // Flure
    P(1, 11.25, 0, [[-0.18, 0, -0.18, 0.18, 1.2, 0.18, 'plastic_white']]); // Wasserspender
    P(47.6, 23.25, 0, [[-0.3, 0, -0.5, 0.3, 0.45, 0.5, 'leather']]);
    P(0.2, 23.25, 0, [[0, 0, -0.5, 0.35, 1.9, 0.5, 'metal_paint']]);
    this.exitSign(24, 0.18, 'x');
    this.exitSign(47.8, 5, 'z');
    this.exitSign(24, 12.3, 'x');
  }

  // ---------- Aussenbereich ----------
  exterior() {
    const ground = (x0, z0, x1, z1, key) => this.face(key, [x0, 0, z0], [0, 0, z1 - z0], [x1 - x0, 0, 0], [0, 1, 0], 'Y+', null, 2.0);
    ground(-0.3, -3.2, 48.3, -0.3, 'sidewalk');
    ground(-15, -24, 63, -3.2, 'asphalt');
    ground(-15, -3.2, -0.3, 44, 'asphalt');
    ground(48.3, -3.2, 63, 44, 'asphalt');
    ground(-0.3, 32.3, 48.3, 44, 'asphalt');
    // Bordstein
    this.box(-0.3, 0, -3.3, 48.3, 0.12, -3.15, 'sidewalk', { collide: false });
    // Begrenzung
    this.box(-15.5, 0, -24.5, 63.5, 2.6, -24, 'concrete');
    this.box(-15.5, 0, 44, 63.5, 2.6, 44.5, 'concrete');
    this.box(-15.5, 0, -24, -15, 2.6, 44, 'concrete');
    this.box(63, 0, -24, 63.5, 2.6, 44, 'concrete');
    // Vordach Eingang
    this.box(21.5, 2.9, -2.4, 26.5, 3.05, 0, 'metal_dark', { collide: false });
    this.lights.push({ x: 24, y: 2.85, z: -1.2, sx: 1, sz: 1, color: [0.9, 0.93, 1.0], I: 2.4, range: 9 });
    this.renderBox(23.6, 2.88, -1.4, 24.4, 2.9, -1.0, 'lamp_on', {});
    // Strassenlaternen
    for (const lx of [4, 24, 44]) {
      this.box(lx - 0.08, 0, -18.08, lx + 0.08, 6, -17.92, 'metal_dark');
      this.box(lx - 0.08, 5.9, -18.08, lx + 0.08, 6.0, -16.8, 'metal_dark', { collide: false });
      this.renderBox(lx - 0.2, 5.82, -17.2, lx + 0.2, 5.9, -16.7, 'lamp_sodium', {});
      this.lights.push({ x: lx, y: 5.75, z: -16.95, sx: 0.4, sz: 0.4, color: [1.0, 0.62, 0.32], I: 12, range: 26 });
    }
    // Wandleuchten an der Fassade
    for (const wx of [5, 13, 35, 43]) {
      this.box(wx - 0.18, 3.05, -0.42, wx + 0.18, 3.2, -0.3, 'metal_dark', { collide: false });
      this.renderBox(wx - 0.14, 3.03, -0.4, wx + 0.14, 3.05, -0.32, 'lamp_sodium', {});
      this.lights.push({ x: wx, y: 2.98, z: -0.55, sx: 0.3, sz: 0.3, color: [1.0, 0.72, 0.45], I: 2.6, range: 10 });
    }
    for (const wz of [12, 20, 28]) {
      this.renderBox(-0.42, 3.03, wz - 0.14, -0.32, 3.05, wz + 0.14, 'lamp_sodium', {});
      this.lights.push({ x: -0.55, y: 2.98, z: wz, sx: 0.3, sz: 0.3, color: [1.0, 0.72, 0.45], I: 2.2, range: 9 });
      this.renderBox(48.32, 3.03, wz - 0.14, 48.42, 3.05, wz + 0.14, 'lamp_sodium', {});
      this.lights.push({ x: 48.55, y: 2.98, z: wz, sx: 0.3, sz: 0.3, color: [1.0, 0.72, 0.45], I: 2.2, range: 9 });
    }
    // Strahler an der Ostseite
    this.renderBox(48.3, 3.0, 4.6, 48.5, 3.15, 5.4, 'lamp_on', {});
    this.lights.push({ x: 48.8, y: 2.9, z: 5, sx: 0.5, sz: 0.5, color: [0.85, 0.9, 1.0], I: 3, range: 11 });
    // Fahrzeuge
    this.van(20.5, -10.5, 0);
    this.policeCar(27.5, -12.5, 0.0);
    this.policeCar(52, -6, 1);
    this.car(6, -8, 0, 'car_white'); this.car(9, -8, 0, 'car_paint'); this.car(38, -8.2, 0, 'car_white');
    // Absperrung
    for (let i = 0; i < 5; i++) this.box(14 + i * 1.3, 0, -15, 14.9 + i * 1.3, 1.0, -14.8, 'metal_paint', { phys: 'metal' });
    // Parkplatzmarkierung
    for (let i = 0; i < 12; i++) this.renderBox(2 + i * 3.6, 0.012, -11, 2.1 + i * 3.6, 0.014, -6, 'plastic_white', {});
  }

  car(x, z, rot, paint) {
    this.place(x, z, rot, [
      [-0.9, 0.3, -2.2, 0.9, 0.95, 2.2, paint],
      [-0.82, 0.95, -1.1, 0.82, 1.42, 1.0, 'plastic_black'],
    ]);
    for (const [wx, wz] of [[-0.9, -1.4], [0.9, -1.4], [-0.9, 1.4], [0.9, 1.4]]) this.decor.push({ type: 'wheel', x: x + (rot ? wz : wx), z: z + (rot ? -wx : wz), rot });
  }
  policeCar(x, z, rot) {
    this.car(x, z, rot, 'car_white');
    this.place(x, z, rot, [[-0.6, 1.42, -0.15, 0.6, 1.55, 0.15, 'plastic_black', { collide: false }]]);
    this.decor.push({ type: 'lightbar', x, z, rot });
  }
  van(x, z, rot) {
    this.place(x, z, rot, [
      [-1.1, 0.35, -2.9, 1.1, 2.45, 2.6, 'car_paint', { faces: { px: 'police', nx: 'police' } }],
      [-1.0, 0.35, 2.6, 1.0, 1.25, 3.3, 'car_paint'],
      [-0.95, 1.25, 2.6, 0.95, 2.0, 2.9, 'plastic_black'],
    ]);
    for (const [wx, wz] of [[-1.1, -1.8], [1.1, -1.8], [-1.1, 2.2], [1.1, 2.2]]) this.decor.push({ type: 'wheel', x: x + wx, z: z + wz, rot: 0 });
    this.decor.push({ type: 'lightbar', x, z: z + 2.4, rot: 0, y: 2.45 });
  }

  build() {
    this.buildWalls();
    this.buildFloorsCeilings();
    this.furniture();
    this.exterior();
    this.world.finalize();
    return this;
  }
}
