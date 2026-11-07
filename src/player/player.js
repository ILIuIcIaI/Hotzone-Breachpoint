// Spieler: Bewegung mit Masse/Traegheit, Lehnen, Ducken, Kamera, Waffenlogik.
import * as THREE from 'three';
import { GUNS } from './viewmodel.js';
import { rayCapsule } from '../world/collision.js';
import { roomAt } from '../world/level.js';

const V = THREE.Vector3;
const _v = new V(), _w = new V(), _d = new V(), _r = new V(), _u = new V();

export class Player {
  constructor(game, spawn) {
    this.game = game;
    this.pos = { x: spawn.x, z: spawn.z };
    this.vel = new V();
    this.yaw = Math.PI + spawn.yaw; // Kamera schaut entlang -z -> +z drehen
    this.pitch = 0;
    this.crouch = 0; this.crouched = false;
    this.lean = 0; this.leanTarget = 0;
    this.health = 100; this.alive = true;
    this.flashlight = true;
    this.eyePos = new V(); this.headPos = new V(); this.chestPos = new V();
    this.viewDir = new V(0, 0, 1);
    this.speed = 0;
    this.stepPhase = 0; this.lastStep = 0;
    this.lightLevel = 0.2;
    this.recoilP = 0; this.recoilY = 0;
    this.shake = 0;
    this.suppress = 0;
    this.damageFx = 0;
    this.stamina = 1;
    this.gun = 'carbine';
    this.ammo = {
      carbine: { mag: 30, chamber: 1, mags: [30, 30, 30, 30], mode: 0 },
      pistol: { mag: 15, chamber: 1, mags: [15, 15], mode: 0 },
    };
    this.nades = 3;
    this.fireCD = 0;
    this.triggerHeld = false;
    this.bloom = 0;
    this.blockDist = 9;
    this.interact = null; this.holdT = 0;
    this.noiseT = 0;
    this.camRoll = 0;
    this.headBob = 0;
    this.fovKick = 0;
  }

  get state() { return this.ammo[this.gun]; }
  get rounds() { const s = this.state; return s.mag + s.chamber; }

  // ---------------- Update ----------------
  update(dt, input, settings) {
    const G = this.game;
    const vm = G.vm;
    if (!this.alive) return;
    // Maus
    const sens = 0.0021 * settings.sens * (vm.ads > 0.5 ? 0.62 : 1);
    this.yaw -= input.mdx * sens;
    this.pitch -= input.mdy * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    // Haltung
    if (input.hit('KeyC')) input.crouchToggle = !input.crouchToggle;
    const wantCrouch = input.down('ControlLeft') || input.crouchToggle;
    this.crouched = wantCrouch;
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);
    // Bewegungseingabe
    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1; if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1; if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    const sprint = input.down('ShiftLeft') && fz < 0 && !wantCrouch && this.stamina > 0.05 && !G.vm.reload;
    const slow = input.down('AltLeft');
    let speed = 2.75;
    if (sprint) speed = 4.7;
    if (slow) speed = 1.25;
    if (wantCrouch) speed = Math.min(speed, 1.45);
    const ads = input.mouse(2) && !sprint;
    if (ads) speed *= 0.72;
    if (this.health < 40) speed *= 0.85;
    // Rueckwaerts / seitlich langsamer
    if (fz > 0) speed *= 0.8;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let tx = 0, tz = 0;
    if (len > 0) {
      const ix = fx / len, iz = fz / len;
      // Kamera: vorwaerts = (-sin, -cos), rechts = (cos, -sin)
      tx = (ix * cy + iz * sy) * speed;
      tz = (-ix * sy + iz * cy) * speed;
    }
    const accel = len > 0 ? (sprint ? 7 : 10) : 13;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    this.stamina = Math.max(0, Math.min(1, this.stamina + (sprint && len > 0 ? -dt * 0.12 : dt * 0.2)));
    // Kollision
    const np = { x: this.pos.x + this.vel.x * dt, z: this.pos.z + this.vel.z * dt };
    const height = 1.75 - this.crouch * 0.6;
    G.world.resolveCircle(np, 0.3, 0.15, height);
    for (const n of G.npcs) {
      const dx = np.x - n.pos.x, dz = np.z - n.pos.z, d2 = dx * dx + dz * dz;
      const r = n.alive && n.type !== 'officer' ? 0.55 : 0;
      if (r && d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2), s = (r - d) / d; np.x += dx * s; np.z += dz * s; }
    }
    const moved = Math.hypot(np.x - this.pos.x, np.z - this.pos.z);
    this.speed = moved / Math.max(dt, 1e-4);
    // Geschwindigkeit an tatsaechliche Bewegung anpassen (an Wand gleiten)
    if (dt > 0) { this.vel.x = (np.x - this.pos.x) / dt; this.vel.z = (np.z - this.pos.z) / dt; }
    this.pos.x = np.x; this.pos.z = np.z;

    // Schritte
    const stepLen = sprint ? 0.95 : wantCrouch ? 0.6 : 0.78;
    this.stepPhase += moved / stepLen;
    if (this.stepPhase >= 1) {
      this.stepPhase -= 1;
      if (this.speed > 0.4) this.footstep(sprint, slow || wantCrouch);
    }

    // Lehnen
    this.leanTarget = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
    if (sprint) this.leanTarget = 0;
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 7);
    // Kopfposition
    const eyeH = 1.64 - this.crouch * 0.58;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); // rechts
    let leanDist = 0.38 * this.lean;
    // Platz zum Lehnen pruefen
    if (Math.abs(leanDist) > 0.01) {
      const s = Math.sign(leanDist);
      const h = G.world.raycast(this.pos.x, eyeH, this.pos.z, rx * s, 0, rz * s, Math.abs(leanDist) + 0.18, (b) => b.mat === 'glass' ? false : !b.solid);
      if (h) leanDist = s * Math.max(0, Math.min(Math.abs(leanDist), h.t - 0.18));
    }
    this.leanDist = leanDist;
    // Kopfwippen
    const bobA = Math.min(1, this.speed / 3) * (sprint ? 1.6 : 1) * (wantCrouch ? 0.6 : 1);
    const bobY = Math.sin(this.stepPhase * Math.PI * 2) * 0.018 * bobA;
    const bobX = Math.cos(this.stepPhase * Math.PI) * 0.012 * bobA;
    this.eyePos.set(this.pos.x + rx * (leanDist + bobX), eyeH - Math.abs(this.lean) * 0.06 + bobY, this.pos.z + rz * (leanDist + bobX));
    this.headPos.copy(this.eyePos).y += 0.05;
    this.chestPos.set(this.pos.x + rx * leanDist * 0.4, eyeH - 0.42, this.pos.z + rz * leanDist * 0.4);
    // Rueckstoss-Erholung
    const rec = Math.min(1, dt * 7);
    const dp = this.recoilP * rec, dyw = this.recoilY * rec;
    this.pitch -= dp * 0.55; this.yaw -= dyw * 0.4;
    this.recoilP -= dp; this.recoilY -= dyw;
    this.shake = Math.max(0, this.shake - dt * 4);
    this.suppress = Math.max(0, this.suppress - dt * 0.6);
    this.damageFx = Math.max(0, this.damageFx - dt * 1.3);
    this.fovKick *= Math.exp(-dt * 12);

    // Kamera
    const cam = G.camera;
    cam.position.copy(this.eyePos);
    const shk = this.shake * 0.01;
    const rl = G.vm.reload ? Math.sin(Math.min(1, G.vm.reload.t / G.vm.reload.dur) * Math.PI) : 0;
    this.camRoll += (-this.lean * 0.21 + rl * 0.035 - this.camRoll) * Math.min(1, dt * 10);
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * shk, this.yaw + (Math.random() - 0.5) * shk, this.camRoll + Math.sin(this.stepPhase * Math.PI * 2) * 0.004 * bobA, 'YXZ');
    cam.updateMatrixWorld();
    cam.getWorldDirection(this.viewDir);
    const baseFov = settings.fov;
    const adsF = GUNS[this.gun].adsFov;
    cam.fov = baseFov * (1 + (adsF - 1) * vm.ads) * (sprint ? 1.04 : 1) + this.fovKick;
    cam.updateProjectionMatrix();

    // Licht am Spieler (fuer KI-Sicht)
    this.lightT = (this.lightT || 0) - dt;
    if (this.lightT <= 0) { this.lightT = 0.3; const c = new THREE.Color(); G.baker.probe(this.pos.x, 1.2, this.pos.z, c); this.lightLevel = (c.r + c.g + c.b) / 3; }

    // Waffe nah an Wand?
    const bh = G.world.raycast(this.eyePos.x, this.eyePos.y - 0.08, this.eyePos.z, this.viewDir.x, this.viewDir.y, this.viewDir.z, 1.2, (b) => !b.solid);
    this.blockDist = bh ? bh.t : 9;
    const block = this.blockDist < 0.62 ? Math.min(1, (0.62 - this.blockDist) / 0.25) : 0;

    // Waffen
    this.weaponLogic(dt, input, { sprint, ads, block });
    vm.update(dt, {
      ads: ads && !vm.reload && block < 0.5 && !vm.switchTo, sprint: sprint && len > 0, block, moveSpeed: this.speed, mdx: input.mdx, mdy: input.mdy,
      lean: this.lean, crouch: this.crouch, lowered: this.holdT > 0 || this.game.pauseWeapon, slideLocked: this.gun === 'pistol' && this.rounds === 0,
    });
    this.sprinting = sprint && len > 0;
  }

  footstep(sprint, quiet) {
    const G = this.game;
    const r = roomAt(this.pos.x, this.pos.z);
    const f = r ? r.floor : 'asphalt';
    const kind = f.startsWith('carpet') ? 'carpet' : f.startsWith('tile') ? 'tile' : f === 'asphalt' ? 'asphalt' : 'concrete';
    G.audio.play('step_' + kind, { vol: (sprint ? 0.3 : quiet ? 0.07 : 0.14) * (0.85 + Math.random() * 0.3), verb: 0.06, lowpass: kind === 'carpet' ? 900 : 2600 });
    const rad = sprint ? 11 : quiet ? 1.5 : kind === 'carpet' ? 3 : 5;
    G.emitNoise(this.pos.x, this.pos.z, rad, 'step', null);
  }

  // ---------------- Waffenlogik ----------------
  weaponLogic(dt, input, s) {
    const G = this.game, vm = G.vm;
    const D = GUNS[this.gun], A = this.state;
    this.fireCD -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 3.5);
    const busy = vm.reload || vm.switchTo || vm.throwT > 0;
    // Waffenwechsel
    if (!busy) {
      if (input.hit('Digit1') && this.gun !== 'carbine') this.switchGun('carbine');
      if (input.hit('Digit2') && this.gun !== 'pistol') this.switchGun('pistol');
      if (input.wheel !== 0 && !this.game.nearDoor) this.switchGun(this.gun === 'carbine' ? 'pistol' : 'carbine');
    }
    if (input.hit('KeyB') && D.modes.length > 1) { A.mode = (A.mode + 1) % D.modes.length; G.audio.play('select', { vol: 0.6, verb: 0 }); G.hud.weaponFlash(); }
    if (input.hit('KeyT')) { this.flashlight = !this.flashlight; G.audio.play('light', { vol: 0.6, verb: 0 }); }
    // Nachladen
    if (input.hit('KeyR') && !busy) this.startReload();
    // Granate
    if (input.hit('KeyG') && !busy && this.nades > 0) this.throwNade();
    // Schiessen
    const trig = input.mouse(0);
    this.updateReload(dt);
    const canFire = !busy && !s.sprint && s.block < 0.5 && vm.sprint < 0.3 && this.holdT <= 0;
    if (trig && canFire && this.fireCD <= 0) {
      const auto = D.modes[A.mode] === 'AUTO';
      if (!this.triggerHeld || auto) {
        if (A.chamber > 0) this.fire(s.ads);
        else if (!this.triggerHeld) { G.audio.play('dryfire', { vol: 0.6, verb: 0 }); this.fireCD = 0.25; }
      }
    }
    this.triggerHeld = trig;
  }

  switchGun(to) {
    this.game.vm.startSwitch(to);
    this.game.audio.play('raise', { vol: 0.6, verb: 0 });
    this.pendingGun = to;
  }

  onSwitched(to) { this.gun = to; this.game.hud.weaponFlash(); }

  startReload() {
    const A = this.state, D = GUNS[this.gun];
    if (A.mags.length === 0) { this.game.hud.toast('Keine Magazine mehr', 'bad'); return; }
    if (A.mag >= D.mag) return;
    const empty = A.chamber === 0;
    const dur = empty ? D.reloadEmpty : D.reload;
    this.game.vm.startReload(empty, dur);
    this.reloadState = { t: 0, dur, empty, swapped: false };
  }

  updateReload(dt) {
    const R = this.reloadState;
    if (!R) return;
    R.t += dt;
    const swapAt = this.gun === 'pistol' ? 1.18 : 1.68;
    if (!R.swapped && R.t >= swapAt) {
      R.swapped = true;
      const A = this.state;
      // vollstes Magazin nehmen, altes zurueck in die Tasche (Restmunition bleibt erhalten)
      let best = 0;
      for (let i = 1; i < A.mags.length; i++) if (A.mags[i] > A.mags[best]) best = i;
      const newMag = A.mags.splice(best, 1)[0];
      if (A.mag > 0) A.mags.push(A.mag);
      A.mag = newMag;
      this.game.hud.weaponFlash();
    }
    if (R.t >= R.dur) {
      const A = this.state;
      if (A.chamber === 0 && A.mag > 0) { A.chamber = 1; A.mag--; }
      this.reloadState = null;
    }
  }

  throwNade() {
    const G = this.game;
    this.nades--;
    G.vm.throwT = 0.9;
    G.audio.play('pin', { vol: 0.7, verb: 0 });
    setTimeout(() => {
      const d = this.viewDir.clone();
      const p = this.eyePos.clone().addScaledVector(d, 0.3);
      p.y -= 0.1;
      const v = d.clone().multiplyScalar(11).add(new V(0, 2.2, 0)).add(new V(this.vel.x, 0, this.vel.z));
      G.spawnNade(p, v);
    }, 380);
  }

  fire(adsHeld) {
    const G = this.game, vm = G.vm, D = GUNS[this.gun], A = this.state;
    A.chamber = 0;
    if (A.mag > 0) { A.mag--; A.chamber = 1; }
    this.fireCD = 60 / D.rpm;
    const adsK = vm.ads;
    // Streuung
    const moveK = Math.min(1, this.speed / 3);
    let spread = D.hip * (1 - adsK) + D.ads * adsK;
    spread += moveK * (adsK > 0.5 ? 0.5 : 1.6) + this.bloom * (adsK > 0.5 ? 0.35 : 1.0);
    if (this.crouched) spread *= 0.8;
    if (this.health < 40) spread *= 1.25;
    const sr = spread * Math.PI / 180;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.tan(sr / 2);
    const cam = G.camera;
    _d.copy(this.viewDir);
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _d.addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
    G.playerShoot(cam.position.clone(), _d.clone(), D);
    // Rueckstoss
    const vk = D.recoilV * (0.85 + Math.random() * 0.3) * (1 - adsK * 0.25) * (this.crouched ? 0.8 : 1) * Math.PI / 180;
    const hk = D.recoilH * (Math.random() * 2 - 1 + 0.25) * Math.PI / 180;
    this.pitch += vk; this.yaw -= hk;
    this.recoilP += vk; this.recoilY -= hk;
    this.bloom = Math.min(3, this.bloom + 0.45);
    this.shake = Math.min(1, this.shake + 0.25);
    this.fovKick += 0.35;
    vm.fireKick(this.gun, adsK);
    // Huelse auswerfen
    const ep = vm.ejectPoint(_v);
    const wp = cam.localToWorld(ep.clone());
    const ev = _w.set(1.6 + Math.random(), 1.2 + Math.random() * 0.8, 0.4).applyQuaternion(cam.quaternion).add(new V(this.vel.x, 0, this.vel.z));
    G.fx.casing(wp, ev.clone());
    // Licht in der Welt
    G.muzzleWorld(cam.localToWorld(vm.muzzlePoint(_v).clone()));
  }

  // ---------------- Treffer ----------------
  hitTest(ox, oy, oz, dx, dy, dz, maxT) {
    if (!this.alive) return null;
    const top = this.eyePos.y + 0.12;
    const bx = this.pos.x + (this.eyePos.x - this.pos.x) * 0.5, bz = this.pos.z + (this.eyePos.z - this.pos.z) * 0.5;
    let t = rayCapsule(ox, oy, oz, dx, dy, dz, this.pos.x, 0.25, this.pos.z, bx, top - 0.45, bz, 0.24);
    let zone = 'torso';
    const th = rayCapsule(ox, oy, oz, dx, dy, dz, this.eyePos.x, top - 0.25, this.eyePos.z, this.eyePos.x, top - 0.08, this.eyePos.z, 0.13);
    if (th > 0 && (t < 0 || th < t)) { t = th; zone = 'head'; }
    if (t < 0 || t > maxT) return null;
    return { t, zone };
  }

  damage(dmg, zone, dir) {
    this.hitsTaken = (this.hitsTaken || 0) + 1;
    if (!this.alive || this.game.god) return;
    let d = dmg;
    if (zone === 'torso') d *= 0.55;   // Schutzweste
    if (zone === 'head') d *= 1.8;     // Helm hilft etwas
    this.health -= d;
    this.damageFx = Math.min(1, this.damageFx + 0.5 + d / 60);
    this.shake = 1;
    this.pitch += (Math.random() - 0.3) * 0.03; this.yaw += (Math.random() - 0.5) * 0.04;
    this.game.audio.play('hurt', { vol: 1, verb: 0.1 });
    if (this.health <= 0) { this.health = 0; this.alive = false; this.game.onPlayerDeath(); }
  }
}
