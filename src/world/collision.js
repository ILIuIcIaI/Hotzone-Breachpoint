// Kollisionswelt: achsenparallele Boxen in einem XZ-Gitter + bewegliche Tueren (OBB).
// Schnelle Raycasts (2D-DDA), Sichtlinien, Kreis-gegen-Welt-Aufloesung.

export class World {
  constructor(minX = -40, minZ = -50, maxX = 90, maxZ = 80, cell = 2) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.nx = Math.ceil((maxX - minX) / cell); this.nz = Math.ceil((maxZ - minZ) / cell);
    this.boxes = [];
    this.cells = null;
    this.doors = [];
    this.stamp = 1;
  }

  addBox(x0, y0, z0, x1, y1, z1, mat = 'concrete', opts = {}) {
    const b = {
      id: this.boxes.length,
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      mat, stamp: 0,
      solid: opts.solid !== false,        // blockiert Bewegung
      blocksLight: opts.blocksLight !== false,
      blocksSight: opts.blocksSight !== false,
      visual: opts.visual,                  // Materialschluessel fuer Render
      tag: opts.tag,
    };
    this.boxes.push(b);
    return b;
  }

  finalize() {
    const n = this.nx * this.nz;
    const lists = new Array(n);
    for (let i = 0; i < n; i++) lists[i] = [];
    for (const b of this.boxes) {
      const cx0 = this.cx(b.min[0]), cx1 = this.cx(b.max[0]);
      const cz0 = this.cz(b.min[2]), cz1 = this.cz(b.max[2]);
      for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) lists[z * this.nx + x].push(b);
    }
    this.cells = lists;
  }

  cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
  cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell))); }

  // Boxen in einem XZ-Bereich
  query(x0, z0, x1, z1, out = []) {
    const s = ++this.stamp;
    const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) {
      const l = this.cells[z * this.nx + x];
      for (let i = 0; i < l.length; i++) { const b = l[i]; if (b.stamp !== s) { b.stamp = s; out.push(b); } }
    }
    return out;
  }

  pointInSolid(x, y, z, pad = 0) {
    const l = this.cells[this.cz(z) * this.nx + this.cx(x)];
    for (const b of l) {
      if (x > b.min[0] - pad && x < b.max[0] + pad && y > b.min[1] - pad && y < b.max[1] + pad && z > b.min[2] - pad && z < b.max[2] + pad) return b;
    }
    return null;
  }

  // Raycast. filter(box) -> true = ignorieren. Liefert {t, nx,ny,nz, box|door, mat}
  raycast(ox, oy, oz, dx, dy, dz, maxT, filter = null, withDoors = true, out = {}) {
    let best = maxT, hit = null, hnx = 0, hny = 0, hnz = 0;
    const s = ++this.stamp;
    const cell = this.cell;
    let gx = Math.floor((ox - this.minX) / cell), gz = Math.floor((oz - this.minZ) / cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const invDx = dx !== 0 ? 1 / dx : 1e30, invDz = dz !== 0 ? 1 / dz : 1e30;
    let tMaxX = dx !== 0 ? ((this.minX + (gx + (dx > 0 ? 1 : 0)) * cell) - ox) * invDx : 1e30;
    let tMaxZ = dz !== 0 ? ((this.minZ + (gz + (dz > 0 ? 1 : 0)) * cell) - oz) * invDz : 1e30;
    const tDX = Math.abs(cell * invDx), tDZ = Math.abs(cell * invDz);
    let tEnter = 0;
    const invDy = dy !== 0 ? 1 / dy : 1e30;
    while (tEnter <= best) {
      if (gx >= 0 && gz >= 0 && gx < this.nx && gz < this.nz) {
        const l = this.cells[gz * this.nx + gx];
        for (let i = 0; i < l.length; i++) {
          const b = l[i];
          if (b.stamp === s) continue;
          b.stamp = s;
          if (filter && filter(b)) continue;
          // Slab-Test
          let t0 = 0, t1 = best, n = 0;
          let a = (b.min[0] - ox) * invDx, c = (b.max[0] - ox) * invDx;
          if (a > c) { const tt = a; a = c; c = tt; }
          if (a > t0) { t0 = a; n = 0; } if (c < t1) t1 = c; if (t0 > t1) continue;
          a = (b.min[1] - oy) * invDy; c = (b.max[1] - oy) * invDy;
          if (a > c) { const tt = a; a = c; c = tt; }
          if (a > t0) { t0 = a; n = 1; } if (c < t1) t1 = c; if (t0 > t1) continue;
          a = (b.min[2] - oz) * invDz; c = (b.max[2] - oz) * invDz;
          if (a > c) { const tt = a; a = c; c = tt; }
          if (a > t0) { t0 = a; n = 2; } if (c < t1) t1 = c; if (t0 > t1) continue;
          if (t0 <= 0) {
            // Start innerhalb der Box: ignorieren (sonst haengen Strahlen fest)
            continue;
          }
          if (t0 < best) {
            best = t0; hit = b;
            hnx = n === 0 ? -Math.sign(dx) : 0; hny = n === 1 ? -Math.sign(dy) : 0; hnz = n === 2 ? -Math.sign(dz) : 0;
          }
        }
      } else if ((gx < 0 && stepX < 0) || (gz < 0 && stepZ < 0) || (gx >= this.nx && stepX > 0) || (gz >= this.nz && stepZ > 0)) break;
      if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tDX; gx += stepX; }
      else { tEnter = tMaxZ; tMaxZ += tDZ; gz += stepZ; }
    }
    let door = null;
    if (withDoors) {
      for (const d of this.doors) {
        if (filter && filter(d)) continue;
        const r = d.raycast(ox, oy, oz, dx, dy, dz, best);
        if (r) { best = r.t; door = d; hit = null; hnx = r.nx; hny = 0; hnz = r.nz; }
      }
    }
    if (!hit && !door) return null;
    out.t = best; out.nx = hnx; out.ny = hny; out.nz = hnz; out.box = hit; out.door = door;
    out.mat = door ? door.mat : hit.mat;
    return out;
  }

  // Sichtlinie (Glas laesst Sicht durch)
  los(ax, ay, az, bx, by, bz, ignoreGlass = true) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    const f = ignoreGlass ? losFilter : sightFilter;
    return !this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.02, f, true, tmpHit);
  }

  // Schneller "irgendein Treffer"-Test fuer Licht (Glas/Tueren/Deko ignoriert)
  occluded(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return false;
    dx /= L; dy /= L; dz /= L;
    const maxT = L - 0.02;
    const s = ++this.stamp;
    const cell = this.cell;
    let gx = Math.floor((ax - this.minX) / cell), gz = Math.floor((az - this.minZ) / cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const invDx = dx !== 0 ? 1 / dx : 1e30, invDy = dy !== 0 ? 1 / dy : 1e30, invDz = dz !== 0 ? 1 / dz : 1e30;
    let tMaxX = dx !== 0 ? ((this.minX + (gx + (dx > 0 ? 1 : 0)) * cell) - ax) * invDx : 1e30;
    let tMaxZ = dz !== 0 ? ((this.minZ + (gz + (dz > 0 ? 1 : 0)) * cell) - az) * invDz : 1e30;
    const tDX = Math.abs(cell * invDx), tDZ = Math.abs(cell * invDz);
    let tEnter = 0;
    while (tEnter <= maxT) {
      if (gx < 0 || gz < 0 || gx >= this.nx || gz >= this.nz) break;
      const l = this.cells[gz * this.nx + gx];
      for (let i = 0; i < l.length; i++) {
        const b = l[i];
        if (b.stamp === s) continue;
        b.stamp = s;
        if (b.mat === 'glass' || b.blocksLight === false) continue;
        let t0 = 0, t1 = maxT;
        let a = (b.min[0] - ax) * invDx, c = (b.max[0] - ax) * invDx;
        if (a > c) { const tt = a; a = c; c = tt; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
        a = (b.min[1] - ay) * invDy; c = (b.max[1] - ay) * invDy;
        if (a > c) { const tt = a; a = c; c = tt; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
        a = (b.min[2] - az) * invDz; c = (b.max[2] - az) * invDz;
        if (a > c) { const tt = a; a = c; c = tt; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
        if (t0 > 0.0005) return true;
      }
      if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tDX; gx += stepX; }
      else { tEnter = tMaxZ; tMaxZ += tDZ; gz += stepZ; }
    }
    return false;
  }

  lightBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return false;
    return !!this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.02, lightFilter, false, tmpHit);
  }

  // Kreis (Zylinder) gegen Welt aufloesen. pos {x,z}, y0..y1 Hoehenbereich
  resolveCircle(pos, r, y0, y1, ignoreDoor = null) {
    const list = this.query(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1, qbuf);
    let pushed = false;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.solid || b.max[1] <= y0 || b.min[1] >= y1) continue;
        const px = Math.max(b.min[0], Math.min(pos.x, b.max[0]));
        const pz = Math.max(b.min[2], Math.min(pos.z, b.max[2]));
        let dx = pos.x - px, dz = pos.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          pos.x += dx * k; pos.z += dz * k;
        } else {
          // Mittelpunkt in Box: kuerzeste Achse heraus
          const l = pos.x - b.min[0], rr = b.max[0] - pos.x, u = pos.z - b.min[2], o = b.max[2] - pos.z;
          const m = Math.min(l, rr, u, o);
          if (m === l) pos.x = b.min[0] - r; else if (m === rr) pos.x = b.max[0] + r;
          else if (m === u) pos.z = b.min[2] - r; else pos.z = b.max[2] + r;
        }
        pushed = true;
      }
      for (const d of this.doors) {
        if (d === ignoreDoor) continue;
        if (d.pushCircle(pos, r, y0, y1)) pushed = true;
      }
    }
    qbuf.length = 0;
    return pushed;
  }
}

const qbuf = [];
const tmpHit = {};
const losFilter = (b) => b.mat === 'glass' || b.blocksSight === false;
const sightFilter = (b) => b.blocksSight === false;
const lightFilter = (b) => b.mat === 'glass' || b.blocksLight === false || b.isDoor;

// Strahl gegen Kapsel (Segment a-b, Radius r). Liefert t oder -1
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
  }
  // Kappen
  for (let k = 0; k < 2; k++) {
    const cx = k ? bx : ax, cy = k ? by : ay, cz = k ? bz : az;
    const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
    b = dx * ocx + dy * ocy + dz * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) { const t = -b - Math.sqrt(h); if (t > 0) return t; }
  }
  return -1;
}
