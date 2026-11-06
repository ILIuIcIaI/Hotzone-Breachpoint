// Effekte: Decals (instanziert), Partikel (Points), Huelsen, Leuchtspuren, Muendungsfeuer.
import * as THREE from 'three';

const V = THREE.Vector3;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V(), _p = new V(), _n = new V(), _c = new THREE.Color();
const Z = new V(0, 0, 1);

class Particles {
  constructor(scene, tex, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('col', this.aCol); g.setAttribute('size', this.aSize);
    g.boundingSphere = new THREE.Sphere(new V(24, 0, 10), 200);
    this.uScale = { value: 500 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: this.uScale },
      vertexShader: `attribute float size; attribute vec4 col; varying vec4 vC; uniform float uScale;
        void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = size * uScale / max(0.05, -mv.z); }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vC.a; if (a < 0.003) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grow = 0, grav = 0, drag = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.alpha0[i] = a; this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = grow; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.01; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.5; this.vel[i * 3 + 2] *= 0.5; }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = this.alpha0[i] * (k < 0.7 ? k / 0.7 : 1);
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
}

class DecalSet {
  constructor(scene, tex, max, color = 0xffffff, opacity = 1) {
    this.max = max; this.n = 0; this.next = 0;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.items = [];
    scene.add(this.mesh);
  }
  add(pos, normal, size, color, rot = Math.random() * Math.PI * 2) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.n = Math.min(this.max, this.n + 1);
    _q.setFromUnitVectors(Z, normal);
    const qr = new THREE.Quaternion().setFromAxisAngle(Z, rot);
    _q.multiply(qr);
    _p.copy(pos).addScaledVector(normal, 0.003);
    _m.compose(_p, _q, _s.set(size, size, size));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, color);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.items[i] = { pos: _p.clone(), q: _q.clone(), size };
    return i;
  }
  resize(i, size) {
    const it = this.items[i]; if (!it) return;
    it.size = size;
    _m.compose(it.pos, it.q, _s.set(size, size, size));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(game, T, envMap) {
    this.game = game;
    const scene = game.scene;
    this.dust = new Particles(scene, T.soft, 1400, false);
    this.glow = new Particles(scene, T.soft, 700, true);
    this.holes = new DecalSet(scene, T.bullethole, 300);
    this.bloodDecals = new DecalSet(scene, T.blood, 80);
    this.pools = [];
    // Huelsen
    this.casingMax = 40;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.85, roughness: 0.3, envMap, envMapIntensity: 0.9 });
    this.casingMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0047, 0.0047, 0.024, 6), brass, this.casingMax);
    this.casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casingMesh.frustumCulled = false;
    this.casingMesh.castShadow = false;
    scene.add(this.casingMesh);
    this.casings = [];
    for (let i = 0; i < this.casingMax; i++) { this.casings.push({ p: new V(0, -10, 0), v: new V(), r: new V(), w: new V(), life: 0, bounces: 0 }); }
    this.casingNext = 0;
    // Leuchtspuren
    this.tracers = [];
    const tmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const tgeo = new THREE.BoxGeometry(0.012, 0.012, 1); tgeo.translate(0, 0, 0.5);
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(tgeo, tmat); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, life: 0 }); }
    // Muendungsfeuer der NPCs
    this.flashes = [];
    const fmat = new THREE.SpriteMaterial({ map: T.muzzle, color: new THREE.Color(2.5, 2.0, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(fmat); s.visible = false; s.scale.setScalar(0.35); scene.add(s); this.flashes.push({ s, life: 0 }); }
    this.npcLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.npcLight);
    this.npcLightT = 0;
  }

  light(pos) { const c = new THREE.Color(); this.game.baker.probe(pos.x, Math.max(0.3, pos.y), pos.z, c); return c; }

  impact(fx, pos, normal, dir) {
    const L = this.light(pos);
    const lum = Math.min(1.5, 0.15 + (L.r + L.g + L.b) * 0.6);
    const D = this.dust, G = this.glow;
    const rr = (a) => (Math.random() - 0.5) * a;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const base = (c, n, spd, size, life, grow, grav, a = 0.5, drag = 3) => {
      for (let i = 0; i < n; i++) D.spawn(pos.x + nx * 0.02, pos.y + ny * 0.02, pos.z + nz * 0.02,
        nx * spd * (0.4 + Math.random()) + rr(spd), ny * spd * (0.4 + Math.random()) + rr(spd) + 0.2, nz * spd * (0.4 + Math.random()) + rr(spd),
        c[0] * lum, c[1] * lum, c[2] * lum, a, size, life * (0.6 + Math.random() * 0.6), grow, grav, drag);
    };
    switch (fx) {
      case 'dust': base([0.55, 0.53, 0.5], 7, 1.2, 0.08, 1.2, 0.35, 0.3, 0.45); base([0.4, 0.38, 0.36], 6, 3.5, 0.02, 0.7, 0, 9.8, 0.9, 0.5); break;
      case 'plaster': base([0.8, 0.78, 0.74], 10, 1.4, 0.1, 1.5, 0.45, 0.2, 0.5); base([0.85, 0.85, 0.8], 6, 3, 0.02, 0.6, 0, 9.8, 0.9, 0.5); break;
      case 'wood': base([0.45, 0.32, 0.2], 5, 1.0, 0.06, 1.0, 0.25, 0.3, 0.4); base([0.55, 0.4, 0.25], 8, 3.5, 0.025, 0.8, 0, 9.8, 1, 0.5); break;
      case 'spark':
        for (let i = 0; i < 12; i++) G.spawn(pos.x, pos.y, pos.z, nx * 3 + rr(6), ny * 3 + rr(6) + 1, nz * 3 + rr(6), 2.5, 1.6, 0.6, 1, 0.025, 0.25 + Math.random() * 0.25, -0.05, 9.8, 1);
        G.spawn(pos.x + nx * 0.02, pos.y + ny * 0.02, pos.z + nz * 0.02, 0, 0, 0, 3, 2.4, 1.4, 1, 0.18, 0.05, 0, 0, 0);
        base([0.3, 0.3, 0.3], 3, 0.6, 0.05, 0.6, 0.2, 0.1, 0.3); break;
      case 'glass':
        for (let i = 0; i < 14; i++) D.spawn(pos.x, pos.y, pos.z, -dir.x * 2 + rr(3), rr(2) + 0.5, -dir.z * 2 + rr(3), 0.7 * lum + 0.2, 0.85 * lum + 0.2, 0.9 * lum + 0.2, 0.9, 0.018, 1.0, 0, 9.8, 0.2);
        for (let i = 0; i < 8; i++) D.spawn(pos.x, pos.y, pos.z, dir.x * 3 + rr(2), rr(2), dir.z * 3 + rr(2), 0.7 * lum + 0.2, 0.85 * lum + 0.2, 0.9 * lum + 0.2, 0.9, 0.015, 1.0, 0, 9.8, 0.2);
        break;
      case 'fabric': base([0.4, 0.42, 0.46], 5, 0.7, 0.05, 0.9, 0.15, 0.2, 0.35); break;
      case 'plastic': base([0.3, 0.3, 0.3], 4, 1.2, 0.04, 0.6, 0.1, 2, 0.4); for (let i = 0; i < 4; i++) G.spawn(pos.x, pos.y, pos.z, nx * 2 + rr(3), ny * 2 + rr(3), nz * 2 + rr(3), 1.5, 1.2, 0.8, 1, 0.015, 0.12, 0, 9.8, 1); break;
      default: base([0.5, 0.5, 0.5], 6, 1.2, 0.07, 1.0, 0.3, 0.3, 0.45);
    }
    if (fx !== 'glass' && fx !== 'fabric') {
      const k = Math.min(1, 0.35 + lum * 0.5);
      this.holes.add(pos, normal, 0.055 + Math.random() * 0.03, _c.setRGB(k, k, k));
    } else if (fx === 'glass') this.holes.add(pos, normal, 0.09, _c.setRGB(0.8, 0.85, 0.9));
  }

  blood(pos, dir, amount = 1) {
    const L = this.light(pos);
    const lum = Math.min(1.2, 0.25 + (L.r + L.g + L.b) * 0.5);
    const D = this.dust;
    const rr = (a) => (Math.random() - 0.5) * a;
    for (let i = 0; i < 10 * amount; i++) D.spawn(pos.x, pos.y, pos.z, dir.x * 1.5 + rr(1.2), rr(1.2) + 0.3, dir.z * 1.5 + rr(1.2), 0.32 * lum, 0.02 * lum, 0.02 * lum, 0.75, 0.06 + Math.random() * 0.05, 0.5, 0.25, 0.6, 2.5);
    for (let i = 0; i < 8 * amount; i++) D.spawn(pos.x, pos.y, pos.z, dir.x * 3 + rr(2), rr(2) + 0.5, dir.z * 3 + rr(2), 0.25 * lum, 0.01, 0.01, 1, 0.018, 0.6, 0, 9.8, 0.3);
    // Spritzer an Wand / Boden dahinter
    const W = this.game.world;
    const h = W.raycast(pos.x, pos.y, pos.z, dir.x, dir.y - 0.25, dir.z, 2.2, (b) => b.mat === 'glass');
    if (h) {
      _p.set(pos.x + dir.x * h.t, pos.y + (dir.y - 0.25) * h.t, pos.z + dir.z * h.t);
      _n.set(h.nx, h.ny, h.nz);
      const c = new THREE.Color().setRGB(0.55 * lum + 0.1, 0.06, 0.06);
      this.bloodDecals.add(_p, _n, 0.35 + Math.random() * 0.4 * amount, c);
    }
  }

  bloodPool(x, z) {
    const L = this.light(new V(x, 0.3, z));
    const lum = Math.min(1.2, 0.25 + (L.r + L.g + L.b) * 0.5);
    const c = new THREE.Color().setRGB(0.35 * lum + 0.06, 0.02, 0.02);
    const i = this.bloodDecals.add(new V(x, 0.005, z), new V(0, 1, 0), 0.1, c);
    this.pools.push({ i, size: 0.1, max: 0.9 + Math.random() * 0.5 });
  }

  casing(pos, vel) {
    const c = this.casings[this.casingNext]; this.casingNext = (this.casingNext + 1) % this.casingMax;
    c.p.copy(pos); c.v.copy(vel); c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.w.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    c.life = 6; c.bounces = 0; c.rest = false;
  }

  tracer(from, to, speed = 420) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    t.from = from.clone(); t.to = to.clone(); t.dist = from.distanceTo(to); t.d = 0; t.speed = speed;
    t.life = t.dist / speed + 0.02;
    t.m.visible = true;
  }

  npcFlash(pos, dir) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.s.position.copy(pos).addScaledVector(dir, 0.05);
    f.s.material.rotation = Math.random() * 6.28;
    f.s.scale.setScalar(0.3 + Math.random() * 0.2);
    f.s.visible = true; f.life = 0.045;
    this.npcLight.position.copy(pos).addScaledVector(dir, 0.3);
    this.npcLight.intensity = 6; this.npcLightT = 0.05;
    this.dust.spawn(pos.x, pos.y, pos.z, dir.x * 0.6, 0.15, dir.z * 0.6, 0.3, 0.3, 0.3, 0.25, 0.1, 0.8, 0.5, -0.05, 2);
  }

  update(dt, camera, viewportH) {
    const scale = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.dust.uScale.value = scale; this.glow.uScale.value = scale;
    this.dust.update(dt); this.glow.update(dt);
    // Huelsen
    const W = this.game.world;
    for (let i = 0; i < this.casingMax; i++) {
      const c = this.casings[i];
      if (c.life > 0 && !c.rest) {
        c.life -= dt;
        c.v.y -= 9.81 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.addScaledVector(c.w, dt);
        let floorY = 0.0047;
        const s = W.pointInSolid(c.p.x, c.p.y, c.p.z);
        if (s) { if (c.v.y < 0 && c.p.y - c.v.y * dt >= s.max[1]) floorY = s.max[1] + 0.005; else { c.v.x *= -0.4; c.v.z *= -0.4; c.p.addScaledVector(c.v, dt * 2); } }
        if (c.p.y < floorY) {
          c.p.y = floorY;
          if (c.v.y < -0.4 && c.bounces < 3) {
            c.bounces++;
            this.game.audio.play('casing', { pos: c.p, vol: 0.5 / c.bounces, ref: 1.2, verb: 0.15 });
          }
          c.v.y *= -0.35; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.2 && c.v.lengthSq() < 0.05) { c.rest = true; c.r.x = Math.PI / 2; c.r.z = 0; }
        }
      }
      _q.setFromEuler(new THREE.Euler(c.r.x, c.r.y, c.r.z));
      _m.compose(c.p, _q, _s.set(1, 1, 1));
      this.casingMesh.setMatrixAt(i, _m);
    }
    this.casingMesh.instanceMatrix.needsUpdate = true;
    // Leuchtspuren
    for (const t of this.tracers) {
      if (t.life <= 0) { t.m.visible = false; continue; }
      t.life -= dt;
      t.d += t.speed * dt;
      const len = Math.min(3.5, t.d, t.dist);
      const head = Math.min(t.d, t.dist);
      _p.copy(t.from).lerp(t.to, head / t.dist);
      t.m.position.copy(_p);
      t.m.lookAt(t.from);
      t.m.scale.set(1, 1, len);
      if (t.d - 3.5 > t.dist) t.life = 0;
    }
    for (const f of this.flashes) { if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.s.visible = false; } }
    if (this.npcLightT > 0) { this.npcLightT -= dt; if (this.npcLightT <= 0) this.npcLight.intensity = 0; }
    for (const p of this.pools) {
      if (p.size < p.max) { p.size += dt * 0.05; this.bloodDecals.resize(p.i, p.size); }
    }
  }
}
