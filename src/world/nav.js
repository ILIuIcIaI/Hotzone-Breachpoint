// Navigationsgitter (0.5 m), A*-Pfadsuche mit Glaettung, Deckungspunkte fuer die KI.

export class NavGrid {
  constructor(world, x0 = -14, z0 = -23, x1 = 62, z1 = 43, cs = 0.5) {
    this.world = world; this.x0 = x0; this.z0 = z0; this.cs = cs;
    this.w = Math.ceil((x1 - x0) / cs); this.h = Math.ceil((z1 - z0) / cs);
    this.walk = new Uint8Array(this.w * this.h);
    this.cost = new Float32Array(this.w * this.h);
    this.doorAt = new Int16Array(this.w * this.h).fill(-1);
    this.covers = [];
    this.build();
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((z - this.z0) / this.cs);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  cx(i) { return this.x0 + (i + 0.5) * this.cs; }
  cz(j) { return this.z0 + (j + 0.5) * this.cs; }

  build() {
    const W = this.world, r = 0.3;
    const list = [];
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.cx(i), z = this.cz(j);
      list.length = 0;
      W.query(x - r, z - r, x + r, z + r, list);
      let ok = true, near = false;
      for (const b of list) {
        if (!b.solid || b.max[1] < 0.25 || b.min[1] > 1.75) continue;
        const px = Math.max(b.min[0], Math.min(x, b.max[0])), pz = Math.max(b.min[2], Math.min(z, b.max[2]));
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < r * r) { ok = false; break; }
        if (d2 < 0.55 * 0.55) near = true;
      }
      const k = j * this.w + i;
      this.walk[k] = ok ? 1 : 0;
      this.cost[k] = near ? 1.6 : 1.0;   // Abstand zu Waenden bevorzugen
    }
    // Tueren: Zellen im Tuerbereich markieren
    W.doors.forEach((d, di) => {
      const c = d.closedCenter();
      for (let t = -0.5; t <= 0.5; t += 0.25) {
        for (let s = -0.4; s <= 0.4; s += 0.2) {
          const x = c.x + Math.cos(d.base) * t * d.width + -Math.sin(d.base) * s;
          const z = c.z + Math.sin(d.base) * t * d.width + Math.cos(d.base) * s;
          const k = this.idx(x, z);
          if (k >= 0) {
            this.doorAt[k] = di;
            if (d.locked) this.walk[k] = 0;
            else if (Math.abs(t) <= 0.3) { this.walk[k] = 1; this.cost[k] = 1.0; }
          }
        }
      }
    });
    this.buildCovers();
  }

  isWalk(x, z) { const k = this.idx(x, z); return k >= 0 && this.walk[k] === 1; }

  // naechste begehbare Zelle
  nearestWalk(x, z, maxR = 3) {
    if (this.isWalk(x, z)) return { x, z };
    for (let r = 1; r <= maxR / this.cs; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const px = x + Math.cos(ang) * r * this.cs, pz = z + Math.sin(ang) * r * this.cs;
        if (this.isWalk(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // A*
  findPath(sx, sz, tx, tz, maxNodes = 6000) {
    const s = this.nearestWalk(sx, sz, 2), t = this.nearestWalk(tx, tz, 3);
    if (!s || !t) return null;
    const si = this.idx(s.x, s.z), ti = this.idx(t.x, t.z);
    if (si === ti) return [{ x: tx, z: tz }];
    const W = this.w;
    const g = this._g || (this._g = new Float32Array(this.w * this.h));
    const came = this._c || (this._c = new Int32Array(this.w * this.h));
    const seen = this._s || (this._s = new Uint32Array(this.w * this.h));
    this._gen = (this._gen || 0) + 1;
    const gen = this._gen;
    const heap = new Heap();
    const tiX = ti % W, tiZ = (ti / W) | 0;
    const hfn = (k) => { const dx = Math.abs((k % W) - tiX), dz = Math.abs(((k / W) | 0) - tiZ); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)); };
    seen[si] = gen; g[si] = 0; came[si] = -1;
    heap.push(si, hfn(si));
    let n = 0, found = false;
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size && n++ < maxNodes) {
      const cur = heap.pop();
      if (cur === ti) { found = true; break; }
      const ci = cur % W, cj = (cur / W) | 0;
      for (const [dx, dz, c] of NB) {
        const ni = ci + dx, nj = cj + dz;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (!this.walk[nk]) continue;
        if (dx && dz && (!this.walk[cj * W + ni] || !this.walk[nj * W + ci])) continue;
        const ng = g[cur] + c * this.cost[nk];
        if (seen[nk] !== gen || ng < g[nk]) {
          seen[nk] = gen; g[nk] = ng; came[nk] = cur;
          heap.push(nk, ng + hfn(nk));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = ti; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    // Glaetten (String-Pulling)
    const pts = cells.map((k) => ({ x: this.cx(k % W), z: this.cz((k / W) | 0), door: this.doorAt[k] }));
    const out = [];
    let anchor = { x: sx, z: sz };
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this.lineWalk(anchor.x, anchor.z, pts[j].x, pts[j].z)) break;
      out.push(pts[j]);
      anchor = pts[j];
      i = j;
    }
    if (out.length === 0) out.push(pts[pts.length - 1]);
    out[out.length - 1] = { x: tx, z: tz, door: -1 };
    if (!this.isWalk(tx, tz)) out[out.length - 1] = { x: t.x, z: t.z, door: -1 };
    // Tuerdurchgaenge als Zwischenpunkte einfuegen (fuer Tueroeffnen)
    return this.insertDoors(sx, sz, out);
  }

  insertDoors(sx, sz, path) {
    const res = [];
    let px = sx, pz = sz;
    for (const p of path) {
      const L = Math.hypot(p.x - px, p.z - pz);
      const n = Math.ceil(L / 0.25);
      let lastDoor = -1;
      for (let k = 1; k < n; k++) {
        const x = px + (p.x - px) * k / n, z = pz + (p.z - pz) * k / n;
        const ki = this.idx(x, z);
        const d = ki >= 0 ? this.doorAt[ki] : -1;
        if (d >= 0 && d !== lastDoor) { res.push({ x, z, door: d }); lastDoor = d; }
      }
      res.push(p);
      px = p.x; pz = p.z;
    }
    return res;
  }

  lineWalk(ax, az, bx, bz) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(L / (this.cs * 0.5));
    for (let k = 1; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      const ki = this.idx(x, z);
      if (ki < 0 || !this.walk[ki] || this.cost[ki] > 1.2) return false;
    }
    return true;
  }

  // Deckungspunkte: begehbare Zellen direkt neben Hindernissen >= 1.0 m
  buildCovers() {
    const W = this.world;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let j = 1; j < this.h - 1; j += 1) for (let i = 1; i < this.w - 1; i += 1) {
      const k = j * this.w + i;
      if (!this.walk[k] || this.doorAt[k] >= 0) continue;
      const x = this.cx(i), z = this.cz(j);
      for (const [dx, dz] of dirs) {
        const tx = x + dx * 0.55, tz = z + dz * 0.55;
        const b = W.pointInSolid(tx, 0.9, tz, 0.0);
        if (b && b.solid) {
          const high = !!W.pointInSolid(tx, 1.6, tz, 0.0);
          // nur jede zweite Zelle (Duennung)
          if (((i + j) & 1) === 0) this.covers.push({ x, z, nx: dx, nz: dz, high, used: null });
          break;
        }
      }
    }
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p;
    let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= p) break; K[i] = K[pa]; P[i] = P[pa]; i = pa; }
    K[i] = k; P[i] = p;
  }
  pop() {
    const K = this.k, P = this.p;
    const top = K[0];
    const lk = K.pop(), lp = P.pop();
    if (K.length) {
      let i = 0; const n = K.length;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= lp) break;
        K[i] = K[c]; P[i] = P[c]; i = c;
      }
      K[i] = lk; P[i] = lp;
    }
    return top;
  }
}
