// NPCs: Verdaechtige (Kampf-KI), Zivilisten, Geiseln.
import * as THREE from 'three';
import { LOOKS, computePose, NJ, J, HITBOXES, getJ } from './skeleton.js';
import { SkinnedBody } from './body.js';
import { buildNpcGun } from './guns.js';
import { Ragdoll } from './ragdoll.js';
import { rayCapsule } from '../world/collision.js';

const V = THREE.Vector3;
const _v = new V(), _w = new V(), _o = new V(), _d = new V(), _gm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _x = new V(), _y = new V(), _z = new V();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const pick = (a) => a[(Math.random() * a.length) | 0];
const rnd = (a, b) => a + Math.random() * (b - a);

export const LINES = {
  spotted: ['Da ist einer!', 'Bullen! Bullen!', 'Kontakt!', 'Die Polizei ist drin!', 'Da vorne!'],
  hurt: ['Ah! Ich bin getroffen!', 'Scheiße!', 'Argh!'],
  reload: ['Nachladen!', 'Deck mich!'],
  surrender: ['Okay, okay! Nicht schießen!', 'Ich ergebe mich!', 'Nicht schießen! Ich bin unbewaffnet!'],
  refuse: ['Verpiss dich!', 'Niemals!', 'Komm doch her!', 'Vergiss es!'],
  investigate: ['Was war das?', 'Hallo? Wer ist da?', 'Hast du das gehört?'],
  flee: ['Ich hau ab!', 'Rückzug!'],
  civPanic: ['Hilfe!', 'Bitte nicht schießen!', 'Oh Gott!'],
  civComply: ['Okay! Okay!', 'Ich tu ja, was Sie sagen!', 'Bitte nicht schießen!'],
  hostage: ['Bitte helfen Sie uns!', 'Hier drüben! Hilfe!'],
  hostageFree: ['Danke! Danke!', 'Gott sei Dank!'],
  arrested: ['Schon gut, schon gut...', 'Ich hab nichts gemacht!'],
  stunned: ['Ich seh nichts!', 'Meine Augen!'],
};

const WEAPONS = {
  rifle: { rpm: 620, burst: [3, 5], pause: [0.45, 1.0], mag: 30, dmg: 27, spread: 0.7, snd: 'rifle' },
  smg: { rpm: 820, burst: [4, 8], pause: [0.4, 0.8], mag: 30, dmg: 20, spread: 1.4, snd: 'smg' },
  pistol: { rpm: 330, burst: [1, 3], pause: [0.35, 0.8], mag: 15, dmg: 22, spread: 1.1, snd: 'pistol' },
};

let NPC_ID = 0;

export class NPC {
  constructor(game, spec, type, lookIdx) {
    this.game = game;
    this.id = NPC_ID++;
    this.type = type;
    this.spec = spec;
    this.pos = { x: spec.x, z: spec.z };
    this.home = { x: spec.x, z: spec.z, yaw: spec.yaw };
    this.yaw = spec.yaw; this.aimYaw = spec.yaw; this.aimPitch = 0;
    this.vel = new V();
    this.speed = 0; this.moveDir = this.yaw; this.phase = Math.random() * 6;
    this.crouch = 0; this.crouchT = 0; this.lean = 0; this.leanT = 0;
    this.health = 100;
    this.alive = true;
    this.t = Math.random() * 10;
    this.aiTimer = Math.random() * 0.1;
    this.flinch = new V();
    this.recoil = 0;
    this.armor = !!spec.armor;
    this.aggression = spec.aggression ?? 0.5;
    this.morale = spec.morale ?? 0.5;
    this.skill = 0.45 + Math.random() * 0.35 + (this.armor ? 0.15 : 0);
    this.pressure = 0;
    this.awareness = 0;
    this.threat = { x: 0, z: 0, y: 1.4, seenT: -99, visible: false, known: false };
    this.suppress = 0;
    this.path = null; this.pathI = 0; this.goal = null; this.repathT = 0;
    this.speechCD = 0;
    this.patrolI = 0; this.waitT = rnd(1, 3);
    this.cover = null; this.coverT = 0; this.peekT = 0;
    this.burstLeft = 0; this.fireCD = 0; this.reactT = 0; this.aimT = 0;
    this.reloadT = 0;
    this.ragdoll = null;
    this.rescued = false; this.arrested = false; this.surrendered = false; this.fake = false;
    this.stunT = 0;
    this.lastHitT = -99;
    this.reportedDown = false;
    this.voicePitch = rnd(0.75, 1.15);

    if (type === 'suspect') {
      this.weaponKind = spec.weapon || 'rifle';
      this.weapon = WEAPONS[this.weaponKind];
      this.ammo = this.weapon.mag;
      this.stance = this.weaponKind === 'pistol' ? 'pistol' : 'rifle';
      this.state = spec.patrol ? 'patrol' : 'idle';
      this.hasGun = true;
      this.hiddenPistol = Math.random() < 0.5;
    } else if (type === 'hostage') {
      this.stance = 'tied'; this.state = 'tied'; this.hasGun = false;
    } else {
      this.stance = 'cower'; this.state = 'hide'; this.hasGun = false; this.crouchT = 0.5;
    }
    const looks = LOOKS[type === 'suspect' ? 'suspect' : type === 'hostage' ? 'hostage' : 'civilian'];
    const look = { ...looks[lookIdx % looks.length] };
    if (this.armor) look.vest = true;
    this.body = new SkinnedBody(look, { armor: this.armor, textures: game.T });
    game.scene.add(this.body.group);
    this.joints = new Float32Array(NJ * 3);
    this.prevJoints = new Float32Array(NJ * 3);
    this.gunInfo = { pos: new V(), dir: new V(0, 0, 1), up: new V(0, 1, 0) };
    if (this.hasGun) {
      this.gun = buildNpcGun(this.weaponKind);
      this.gun.matrixAutoUpdate = false;
      game.scene.add(this.gun);
    }
    this.headFwd = new V();
    this.poseUpdate(0.016);
    this.prevJoints.set(this.joints);
    this.lastDt = 0.016;
  }

  get eye() { return _o.set(this.joints[J.H * 3], this.joints[J.H * 3 + 1] + 0.02, this.joints[J.H * 3 + 2]); }
  headPos(out) { return getJ(this.joints, J.H, out); }
  chestPos(out) { return getJ(this.joints, J.C, out); }
  distTo(x, z) { return Math.hypot(this.pos.x - x, this.pos.z - z); }
  get isThreat() { return this.type === 'suspect' && this.alive && !this.arrested && (!this.surrendered || this.fake) && this.state !== 'surrender'; }
  get canArrest() { return this.alive && !this.arrested && ((this.type === 'suspect' && this.state === 'surrender') || (this.type === 'civilian' && this.state === 'comply') || (this.type === 'civilian' && this.state === 'hide' && this.complied)); }

  say(cat, prio = 1, force = false) {
    if (!this.alive) return;
    if (this.speechCD > 0 && !force) return;
    this.speechCD = rnd(3, 6);
    this.game.speech.say(pick(LINES[cat]), { pos: this.eye.clone(), pitch: this.voicePitch, prio, who: this.id, type: this.type });
  }

  // ---------------- Update ----------------
  update(dt) {
    this.t += dt;
    this.lastDt = dt;
    this.speechCD -= dt;
    if (!this.alive) { this.updateDead(dt); return; }
    this.suppress = Math.max(0, this.suppress - dt * 0.5);
    this.flinch.multiplyScalar(Math.exp(-dt * 9));
    this.recoil = Math.max(0, this.recoil - dt * 1.2);
    this.aiTimer -= dt;
    if (this.game.aiFrozen) { this.prevJoints.set(this.joints); this.poseUpdate(dt); return; }
    if (this.aiTimer <= 0) {
      this.aiTimer = 0.1;
      this.perceive(0.1);
      this.think(0.1);
    }
    this.act(dt);
    this.move(dt);
    this.prevJoints.set(this.joints);
    this.poseUpdate(dt);
  }

  // ---------------- Wahrnehmung ----------------
  perceive(dt) {
    const P = this.game.player;
    if (!P.alive || this.type !== 'suspect' || this.state === 'surrender' && !this.fake || this.arrested) { this.threat.visible = false; return; }
    if (this.stunT > 0) { this.threat.visible = false; return; }
    const eye = this.eye;
    const ph = P.headPos, pc = P.chestPos;
    const dx = ph.x - eye.x, dz = ph.z - eye.z;
    const dist = Math.hypot(dx, dz);
    let vis = false;
    if (dist < 45) {
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - this.aimYaw));
      const fov = this.state === 'combat' ? 1.8 : 1.15;
      if (ang < fov || dist < 1.6) {
        const W = this.game.world;
        vis = W.los(eye.x, eye.y, eye.z, ph.x, ph.y, ph.z) || W.los(eye.x, eye.y, eye.z, pc.x, pc.y, pc.z);
        if (vis) {
          // Licht: im Dunkeln ohne Lampe schwer zu sehen
          const lit = P.lightLevel;
          let f = P.flashlight ? 1.0 : Math.min(1, 0.25 + lit * 1.6);
          if (dist < 4) f = 1;
          const centre = 1 - Math.min(1, ang / fov) * 0.6;
          const crouchF = P.crouched ? 0.7 : 1;
          const rate = (0.9 + 9 / (dist + 0.8)) * f * centre * crouchF * (this.state === 'combat' ? 3 : 1);
          this.awareness = Math.min(1.2, this.awareness + rate * dt);
          if (f < 0.35 && dist > 9) vis = this.awareness > 1.0 && this.state === 'combat';
        }
      }
      // Lampe angestrahlt
      if (!vis && P.flashlight && dist < 16) {
        const toMe = _v.set(eye.x - P.eyePos.x, eye.y - P.eyePos.y, eye.z - P.eyePos.z);
        const L = toMe.length();
        if (L > 0.1 && toMe.divideScalar(L).dot(P.viewDir) > 0.93 && this.game.world.los(eye.x, eye.y, eye.z, P.eyePos.x, P.eyePos.y, P.eyePos.z)) {
          this.awareness = Math.min(1.2, this.awareness + dt * 1.2);
          if (this.awareness > 0.5 && this.state !== 'combat') this.investigate(P.eyePos.x, P.eyePos.z, true);
        }
      }
    }
    if (!vis) this.awareness = Math.max(0, this.awareness - dt * (this.state === 'combat' ? 0.05 : 0.12));
    const wasVisible = this.threat.visible;
    this.threat.visible = vis && this.awareness >= 1;
    if (this.threat.visible) {
      // Zielpunkt: Kopf wenn nur der sichtbar (Lehnen!), sonst Brust
      const W = this.game.world;
      const chestVis = W.los(eye.x, eye.y, eye.z, pc.x, pc.y, pc.z);
      const tp = chestVis ? pc : ph;
      this.threat.x = tp.x; this.threat.y = tp.y; this.threat.z = tp.z;
      this.threat.seenT = this.t; this.threat.known = true;
      if (!wasVisible) {
        this.aimT = 0;
        if (this.state !== 'combat') {
          this.reactT = rnd(0.35, 0.75) * (1.5 - this.skill);
          this.enterCombat();
          this.say('spotted', 2, true);
          this.game.alertNearby(this, tp.x, tp.z);
        } else this.reactT = Math.max(this.reactT, rnd(0.15, 0.35) * (1.4 - this.skill));
        if (this.distTo(tp.x, tp.z) < 3) this.reactT = Math.min(this.reactT, 0.2);
      }
    } else if (this.awareness > 0.55 && this.state !== 'combat' && this.state !== 'investigate' && vis) {
      this.investigate(ph.x, ph.z, false);
    }
  }

  hear(n) {
    if (!this.alive) return;
    if (this.type === 'civilian') {
      if (n.type === 'shot' && this.state !== 'comply' && this.state !== 'arrested') { this.state = 'hide'; this.stance = 'cower'; if (Math.random() < 0.3) this.say('civPanic'); }
      return;
    }
    if (this.type !== 'suspect' || this.arrested || this.state === 'surrender') return;
    if (n.type === 'shot' || n.type === 'bang' || n.type === 'kick') {
      if (this.state !== 'combat') {
        this.threat.x = n.x; this.threat.z = n.z; this.threat.y = 1.4; this.threat.known = true; this.threat.seenT = this.t - 3;
        this.enterCombat();
        this.awareness = Math.max(this.awareness, 0.7);
      }
    } else if (this.state === 'idle' || this.state === 'patrol' || (this.state === 'investigate' && n.type !== 'step')) {
      this.investigate(n.x, n.z, n.type !== 'step');
    }
  }

  investigate(x, z, speak) {
    if (this.state === 'combat') return;
    this.state = 'investigate';
    this.invPos = { x, z };
    this.invT = 0;
    this.setGoal(x, z);
    if (speak) this.say('investigate');
  }

  enterCombat() {
    if (this.state === 'combat') return;
    this.state = 'combat';
    this.combatT = 0;
    this.nextReposT = rnd(1.5, 4);
    this.path = null;
    this.cover = null;
  }

  // ---------------- Entscheidungen ----------------
  think(dt) {
    if (this.type === 'hostage') return;
    if (this.type === 'civilian') { this.thinkCivilian(dt); return; }
    if (this.arrested) return;
    if (this.stunT > 0) return;
    if (this.state === 'surrender') { this.thinkSurrender(dt); return; }
    const P = this.game.player;
    switch (this.state) {
      case 'idle': {
        // gelegentlich umschauen
        if (Math.random() < 0.02) this.lookYaw = this.home.yaw + rnd(-0.9, 0.9);
        if (this.distTo(this.home.x, this.home.z) > 0.6 && !this.path) this.setGoal(this.home.x, this.home.z);
        break;
      }
      case 'patrol': {
        const pts = this.spec.patrol;
        if (!this.path) {
          this.waitT -= dt;
          if (this.waitT <= 0) {
            this.patrolI = (this.patrolI + 1) % pts.length;
            this.setGoal(pts[this.patrolI][0], pts[this.patrolI][1]);
            this.waitT = rnd(1.5, 4);
          } else if (Math.random() < 0.03) this.lookYaw = this.yaw + rnd(-1, 1);
        }
        break;
      }
      case 'investigate': {
        if (!this.path) {
          this.invT += dt;
          if (Math.random() < 0.06) this.lookYaw = this.yaw + rnd(-1.6, 1.6);
          if (this.invT > 6) { this.state = this.spec.patrol ? 'patrol' : 'idle'; this.awareness = 0; this.setGoal(this.home.x, this.home.z); }
        }
        break;
      }
      case 'flee': {
        if (!this.path) {
          this.fleeT = (this.fleeT || 0) + dt;
          this.crouchT = 0.6;
          if (this.threat.visible && this.distTo(P.pos.x, P.pos.z) < 6 && Math.random() < 0.3) { this.state = 'combat'; }
          if (this.fleeT > 12) { this.state = 'combat'; this.fleeT = 0; }
        }
        break;
      }
      case 'combat': this.thinkCombat(dt); break;
    }
  }

  thinkCombat(dt) {
    const P = this.game.player;
    this.combatT += dt;
    const th = this.threat;
    const dist = this.distTo(th.x, th.z);
    const since = this.t - th.seenT;
    // Moral bricht -> Flucht oder Aufgabe
    if (this.health < 45 && this.morale < 0.45 && Math.random() < 0.04) {
      if (Math.random() < 0.5) this.surrender(false); else this.flee();
      return;
    }
    if (this.reloadT > 0) {
      // beim Nachladen Deckung suchen
      if (!this.cover && !this.path) this.takeCover(th, 10);
      return;
    }
    if (th.visible) {
      // unter Beschuss -> Deckung
      if ((this.suppress > 0.8 || this.t - this.lastHitT < 1.5) && !this.cover && !this.path) {
        if (!this.takeCover(th, 9)) this.breakLOS(th);
        return;
      }
      this.nextReposT -= dt;
      if (this.nextReposT <= 0) {
        this.nextReposT = rnd(2.5, 5.5) * (1.2 - this.aggression * 0.5);
        const r = Math.random();
        if (r < 0.45 * (1 - this.aggression) + 0.15) this.takeCover(th, 8);
        else if (r < 0.7 && dist > 5 && this.aggression > 0.55 && this.game.npcs.filter((o) => o !== this && o.pushing && o.alive && o.t - o.pushT < 6).length < 2) {
          this.pushing = true; this.pushT = this.t;
          // vorruecken, aber nicht zu nah
          const k = Math.max(0, dist - rnd(3.5, 6)) / dist;
          this.setGoal(this.pos.x + (th.x - this.pos.x) * k * 0.5, this.pos.z + (th.z - this.pos.z) * k * 0.5, true);
        } else if (r < 0.85) {
          // seitlich versetzen
          const a = Math.atan2(th.x - this.pos.x, th.z - this.pos.z) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
          const s = rnd(1, 2.2);
          this.setGoal(this.pos.x + Math.sin(a) * s, this.pos.z + Math.cos(a) * s, true);
        }
      }
    } else {
      // Ziel verloren
      if (since > 1.5 && !this.path) {
        if (this.cover && since < 8) {
          // aus Deckung haltend warten (Hinterhalt)
        } else if (this.aggression > 0.6 && since > 3 && since < 25) {
          // suchen: zum letzten bekannten Ort vorsichtig
          const pushers = this.game.npcs.filter((o) => o !== this && o.pushing && o.alive && o.t - o.pushT < 8).length;
          if (pushers >= 2) { if (!this.cover) this.takeCover(th, 7); this.holdPos = true; }
          else if (this.distTo(th.x, th.z) > 1.5) { this.pushing = true; this.pushT = this.t; this.setGoal(th.x, th.z, true); }
          else { th.seenT = this.t - 30; }
        } else if (since > 4 && !this.holdPos) {
          // Winkel halten: Position mit Blick auf Zugang
          this.holdPos = true;
          if (!this.cover) this.takeCover(th, 7);
        } else if (since > 30) {
          this.state = 'investigate'; this.invPos = { x: th.x, z: th.z }; this.invT = 0; this.holdPos = false; this.cover = null;
        }
      }
    }
  }

  // Punkt in der Naehe suchen, von dem aus die Bedrohung keine Sicht hat (um die Ecke, hinter Moebel)
  breakLOS(th) {
    const W = this.game.world, nav = this.game.nav;
    let best = null, bd = 1e9;
    const away = Math.atan2(this.pos.x - th.x, this.pos.z - th.z);
    for (let i = 0; i < 12; i++) {
      const a = away + (i - 6) * 0.45, r = 1.5 + (i % 3) * 1.2;
      const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
      if (!nav.isWalk(x, z)) continue;
      if (W.los(x, 1.5, z, th.x, th.y, th.z)) continue;
      const d = r + Math.abs(i - 6) * 0.2;
      if (d < bd) { bd = d; best = [x, z]; }
    }
    if (best) { this.setGoal(best[0], best[1], true); this.crouchT = 0.5; return true; }
    this.crouchT = 1; // nichts gefunden: wenigstens klein machen
    return false;
  }

  // Kein Eigenbeschuss: steht jemand anderes in der Schusslinie?
  lineBlockedByFriend(th) {
    const e = this.eye;
    const dx = th.x - e.x, dz = th.z - e.z, L = Math.hypot(dx, dz) || 1;
    for (const o of this.game.npcs) {
      if (o === this || !o.alive) continue;
      const ox = o.pos.x - e.x, oz = o.pos.z - e.z;
      const along = (ox * dx + oz * dz) / L;
      if (along < 0.3 || along > L - 0.3) continue;
      const perp = Math.abs(ox * dz - oz * dx) / L;
      if (perp < 0.45) return true;
    }
    return false;
  }

  takeCover(th, maxR) {
    const nav = this.game.nav;
    const W = this.game.world;
    let best = null, bestS = -1e9;
    const tx = th.x, tz = th.z, ty = th.y;
    const inside = this.game.roomAt(this.pos.x, this.pos.z);
    const myToT = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    for (const c of nav.covers) {
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxR * maxR || (c.used && c.used !== this)) continue;
      // Deckung muss zwischen mir und Bedrohung liegen
      const toT = Math.hypot(tx - c.x, tz - c.z);
      if (toT < 3) continue;
      if (toT < myToT * 0.75 - 1) continue;                       // nicht auf die Bedrohung zulaufen
      if (inside && !this.game.roomAt(c.x, c.z)) continue;        // im Gebaeude bleiben
      // Weg dorthin darf nicht an der Bedrohung vorbeifuehren
      const along = ((tx - this.pos.x) * dx + (tz - this.pos.z) * dz) / Math.max(0.01, myToT);
      if (along > myToT * 0.5) continue;
      const nd = ((tx - c.x) * c.nx + (tz - c.z) * c.nz) / toT;
      if (nd < 0.3) continue;
      if (W.los(c.x, 0.85, c.z, tx, ty, tz)) continue;
      const peekVis = c.high ? W.los(c.x + c.nz * 0.55, 1.5, c.z - c.nx * 0.55, tx, ty, tz) || W.los(c.x - c.nz * 0.55, 1.5, c.z + c.nx * 0.55, tx, ty, tz) : W.los(c.x, 1.45, c.z, tx, ty, tz);
      let s = -Math.sqrt(d2) * 1.0 - Math.abs(toT - 8) * 0.25 + (peekVis ? 3 : 0) + (c.high ? 0.5 : 0) + Math.random() * 1.5;
      if (s > bestS) { bestS = s; best = c; }
    }
    if (best) {
      if (this.cover) this.cover.used = null;
      best.used = this;
      this.cover = best;
      this.coverT = 0;
      this.peekT = rnd(1, 2.5);
      this.setGoal(best.x, best.z, true);
      return true;
    }
    return false;
  }

  flee() {
    this.state = 'flee';
    this.fleeT = 0;
    this.say('flee');
    // weit weg vom Spieler: zufaelliger Raum
    const P = this.game.player;
    let best = null, bd = 0;
    for (let i = 0; i < 10; i++) {
      const rx = rnd(1, 47), rz = rnd(1, 31);
      if (!this.game.nav.isWalk(rx, rz)) continue;
      const d = Math.hypot(rx - P.pos.x, rz - P.pos.z) - Math.hypot(rx - this.pos.x, rz - this.pos.z) * 0.3;
      if (d > bd) { bd = d; best = [rx, rz]; }
    }
    if (best) this.setGoal(best[0], best[1], true, true);
  }

  // Spieler ruft
  onYell(P, aimedAt) {
    if (!this.alive || this.arrested) return;
    const dist = this.distTo(P.pos.x, P.pos.z);
    const W = this.game.world;
    const e = this.eye;
    const sees = W.los(e.x, e.y, e.z, P.eyePos.x, P.eyePos.y, P.eyePos.z);
    if (dist > 14 || (!sees && dist > 5)) return;
    if (this.type === 'civilian') {
      if (this.state === 'comply' || this.state === 'arrested') return;
      if (Math.random() < 0.65 + this.pressure) { this.state = 'comply'; this.stance = 'kneel_handsup'; this.complied = true; this.say('civComply', 2, true); this.path = null; }
      else { this.pressure += 0.25; this.say('civPanic', 1, true); }
      return;
    }
    if (this.type !== 'suspect' || this.state === 'surrender') return;
    let ch = 0.08 + (1 - this.morale) * 0.45 + this.pressure;
    if (aimedAt) ch += 0.25;
    if (this.stunT > 0) ch += 0.55;
    if (this.health < 70) ch += 0.2;
    if (dist < 5) ch += 0.12;
    if (this.state !== 'combat') ch += 0.15; // ueberrascht
    if (this.threat.visible && this.aimT > 0.5 && this.aggression > 0.6) ch *= 0.55;
    if (this.reloadT > 0) ch += 0.2;
    this.pressure += 0.12;
    if (Math.random() < ch) this.surrender(this.aggression > 0.45 && this.hiddenPistol && Math.random() < 0.3);
    else {
      this.say('refuse', 2, true);
      if (this.state !== 'combat') { this.threat.x = P.chestPos.x; this.threat.z = P.chestPos.z; this.threat.y = P.chestPos.y; this.threat.known = true; this.enterCombat(); this.awareness = 1.1; this.reactT = rnd(0.2, 0.5); }
    }
  }

  surrender(fake) {
    this.state = 'surrender';
    this.surrendered = true;
    this.fake = fake;
    this.fakeT = 0;
    this.path = null;
    if (this.cover) { this.cover.used = null; this.cover = null; }
    this.say('surrender', 3, true);
    this.dropWeapon();
    this.stance = 'handsup';
    this.kneelT = 1.2;
    this.game.onSurrender(this);
  }

  thinkSurrender(dt) {
    if (this.kneelT > 0) { this.kneelT -= dt; if (this.kneelT <= 0) this.stance = 'kneel_handsup'; }
    if (!this.fake) return;
    // Falsches Aufgeben: zieht Waffe, wenn Spieler wegsieht und Abstand hat
    const P = this.game.player;
    const dist = this.distTo(P.pos.x, P.pos.z);
    const to = _v.set(this.pos.x - P.eyePos.x, 1.0 - P.eyePos.y, this.pos.z - P.eyePos.z).normalize();
    const looking = to.dot(P.viewDir) > 0.82;
    if (dist > 2.6 && !looking && dist < 14) this.fakeT += dt; else this.fakeT = Math.max(0, this.fakeT - dt * 2);
    if (this.fakeT > 1.6) {
      this.fake = false; this.surrendered = false;
      this.weaponKind = 'pistol'; this.weapon = WEAPONS.pistol; this.ammo = 15;
      this.hasGun = true;
      if (!this.gun || this.gunDropped) { this.gun = buildNpcGun('pistol'); this.gun.matrixAutoUpdate = false; this.game.scene.add(this.gun); this.gunDropped = false; }
      this.stance = 'pistol';
      this.state = 'combat'; this.combatT = 0; this.nextReposT = 3;
      this.threat.x = P.chestPos.x; this.threat.y = P.chestPos.y; this.threat.z = P.chestPos.z; this.threat.known = true;
      this.awareness = 1.2; this.reactT = 0.25; this.aimT = 0.6;
      this.game.onFakeSurrender(this);
    }
  }

  thinkCivilian(dt) {
    if (this.state === 'comply' || this.state === 'arrested') return;
    if (this.state === 'hide') {
      this.stance = 'cower'; this.crouchT = 0.55;
      const P = this.game.player;
      const d = this.distTo(P.pos.x, P.pos.z);
      if (d < 8 && Math.random() < 0.02) this.say('civPanic');
    }
  }

  // Treffer durch Kugel
  damage(dmg, zone, dir, point, joint, src) {
    if (!this.alive) {
      if (this.ragdoll) this.ragdoll.shot(joint, dir, 4);
      this.game.fx.blood(point, dir, 0.6);
      return;
    }
    let mult = zone === 'head' ? 4 : zone === 'torso' ? 1 : 0.55;
    if (zone === 'torso' && this.armor) mult = 0.45;
    if (this.type !== 'suspect') mult *= 1.2;
    const d = dmg * mult;
    this.health -= d;
    this.lastHitT = this.t;
    this.game.fx.blood(point, dir, zone === 'head' ? 1.5 : 1);
    this.flinch.addScaledVector(dir, zone === 'head' ? 0.12 : 0.09);
    this.flinch.y -= 0.02;
    if (this.health <= 0) { this.die(zone, dir, point, joint, src); return; }
    // Reaktion
    if (zone === 'leg') this.limp = 1;
    this.morale -= 0.2;
    if (this.type === 'suspect') {
      this.say('hurt', 2, true);
      if (this.state !== 'combat' && this.state !== 'surrender') { this.enterCombat(); this.awareness = 1.2; }
      if (src) { this.threat.x = src.x; this.threat.y = src.y; this.threat.z = src.z; this.threat.known = true; this.threat.seenT = this.t; }
      this.suppress = Math.min(2, this.suppress + 1);
      this.reactT += 0.25;
      if (this.state === 'surrender') { /* wurde trotzdem beschossen */ }
      else if (Math.random() < 0.25 * (1 - this.morale)) this.surrender(false);
    } else if (this.type === 'civilian') { this.say('civPanic', 2, true); }
  }

  die(zone, dir, point, joint, src) {
    this.alive = false;
    this.state = 'dead';
    if (this.cover) { this.cover.used = null; this.cover = null; }
    this.ragdoll = new Ragdoll(this.game.world, this.joints, this.prevJoints, this.lastDt, {
      joint, dir: dir.clone(), power: zone === 'head' ? 2.4 : 2.0, zone, point: point.clone(),
    });
    // Waffe fallen lassen
    if (this.hasGun && this.gun && !this.gunDropped) {
      const a = this.gunInfo.pos.clone(), b = a.clone().addScaledVector(this.gunInfo.dir, this.gun.userData.length);
      this.ragdoll.dropGun(a, b, new V(dir.x * 1.5 + rnd(-0.5, 0.5), 1.2, dir.z * 1.5 + rnd(-0.5, 0.5)));
    }
    this.game.speech.cancelWho(this.id);
    this.game.onDeath(this, src);
  }

  dropWeapon() {
    if (!this.hasGun || !this.gun || this.gunDropped) return;
    this.hasGun = false;
    this.gunDropped = true;
    const a = this.gunInfo.pos.clone(), b = a.clone().addScaledVector(this.gunInfo.dir, this.gun.userData.length);
    this.droppedGun = { p: new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), o: new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), len: a.distanceTo(b), t: 0 };
    this.game.audio.play('gundrop', { pos: a, delay: 0.35 });
  }

  stun(t) {
    if (!this.alive || this.arrested) return;
    this.stunT = Math.max(this.stunT, t);
    if (this.type === 'suspect' && this.state !== 'surrender') {
      this.stance = 'stunned';
      this.burstLeft = 0;
      this.say('stunned', 2, true);
      this.awareness = 1;
    } else if (this.type === 'civilian' && this.state !== 'comply') { this.stance = 'cower'; }
  }

  arrest() {
    this.arrested = true;
    this.state = 'arrested';
    this.stance = 'cuffed';
    this.path = null;
    if (this.type === 'suspect') { this.say('arrested', 1, true); this.dropWeapon(); }
  }

  // ---------------- Handeln (jedes Frame) ----------------
  act(dt) {
    const P = this.game.player;
    if (this.stunT > 0) {
      this.stunT -= dt;
      if (this.stunT <= 0 && this.type === 'suspect' && this.state !== 'surrender' && !this.arrested) {
        this.stance = this.weaponKind === 'pistol' ? 'pistol' : 'rifle';
        if (!this.hasGun) this.stance = 'handsup';
      }
      this.aimYaw += Math.sin(this.t * 2.3) * dt * 1.2;
      return;
    }
    if (this.type !== 'suspect' || this.state === 'surrender' || this.arrested) {
      // Zivilisten/Geiseln: Spieler anschauen wenn nah
      if (this.type !== 'suspect' || this.state === 'surrender') {
        const d = this.distTo(P.pos.x, P.pos.z);
        if (d < 6 && this.state !== 'tied') this.turnAim(Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), dt, 2);
      }
      return;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = this.weapon.mag;
    }
    const th = this.threat;
    const aiming = this.state === 'combat';
    this.aiming = aiming && (th.visible || this.t - th.seenT < 6) && this.reloadT <= 0;
    // Blick-/Zielrichtung
    if (this.state === 'combat' && th.known) {
      const e = this.eye;
      const ty = Math.atan2(th.x - e.x, th.z - e.z);
      const tp = Math.atan2(th.y - e.y, Math.hypot(th.x - e.x, th.z - e.z));
      const rate = th.visible ? 3.0 + this.skill * 3 : 2.0;
      this.turnAim(ty, dt, rate);
      this.aimPitch += (tp - this.aimPitch) * Math.min(1, dt * 6);
    } else if (this.path && this.pathI < this.path.length) {
      const wp = this.path[this.pathI];
      this.turnAim(Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z), dt, 3);
      this.aimPitch *= 0.9;
    } else if (this.lookYaw !== undefined) {
      this.turnAim(this.lookYaw, dt, 1.5);
      this.aimPitch *= 0.95;
    }
    // Deckungsverhalten: ducken / spaehen
    if (this.cover && !this.path && this.state === 'combat') {
      this.coverT += dt;
      this.peekT -= dt;
      if (this.peekT <= 0) {
        this.peeking = !this.peeking;
        this.peekT = this.peeking ? rnd(1.2, 2.6) : rnd(0.8, 2.0) * (1.4 - this.aggression);
      }
      if (this.cover.high) { this.crouchT = 0; this.leanT = this.peeking ? this.peekSide() : 0; }
      else { this.crouchT = this.peeking ? 0 : 1; this.leanT = 0; }
      if (this.coverT > 14 && Math.random() < 0.01) { this.cover.used = null; this.cover = null; }
    } else {
      this.leanT = 0;
      if (this.state === 'combat' && !this.path) this.crouchT = this.suppress > 0.6 ? 1 : (this.aggression < 0.5 ? 0.6 : 0);
      else if (this.state !== 'flee') this.crouchT = 0;
    }
    // Schiessen
    this.aimT += dt;
    this.fireCD -= dt;
    if (th.visible && this.aiming) {
      if (this.reactT > 0) this.reactT -= dt;
      else {
        const e = this.eye;
        const want = Math.atan2(th.x - e.x, th.z - e.z);
        const off = Math.abs(wrap(want - this.aimYaw));
        if (off < 0.12 && this.fireCD <= 0 && this.lineBlockedByFriend(th)) {
          // seitlich versetzen statt durch Kollegen/Geiseln zu schiessen
          if (!this.path) { const a = this.aimYaw + (Math.random() < 0.5 ? 1.57 : -1.57); this.setGoal(this.pos.x + Math.sin(a) * 1.2, this.pos.z + Math.cos(a) * 1.2, true); }
          this.fireCD = 0.4;
        } else if (off < 0.12 && this.fireCD <= 0) {
          if (this.burstLeft <= 0) this.burstLeft = Math.round(rnd(this.weapon.burst[0], this.weapon.burst[1]));
          this.fire();
          this.burstLeft--;
          this.fireCD = this.burstLeft > 0 ? 60 / this.weapon.rpm * rnd(0.9, 1.15) : rnd(this.weapon.pause[0], this.weapon.pause[1]) * (1.3 - this.skill * 0.5);
          if (this.ammo <= 0) { this.reloadT = rnd(2.2, 3.0); this.say('reload', 1); this.burstLeft = 0; this.game.audio.play('npcreload', { pos: this.eye.clone() }); }
        }
      }
    } else this.burstLeft = 0;
  }

  peekSide() {
    // Seite mit Sicht auf Bedrohung
    if (this._peekSide === undefined || Math.random() < 0.02) {
      const c = this.cover, th = this.threat, W = this.game.world;
      const l = W.los(c.x + c.nz * 0.55, 1.5, c.z - c.nx * 0.55, th.x, th.y, th.z);
      this._peekSide = l ? 1 : -1;
    }
    return this._peekSide;
  }

  turnAim(target, dt, rate) {
    const d = wrap(target - this.aimYaw);
    const s = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    this.aimYaw = wrap(this.aimYaw + s);
  }

  fire() {
    this.ammo--;
    const G = this.gunInfo;
    const muzzle = _w.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrix);
    const th = this.threat;
    const P = this.game.player;
    // Streuung: abhaengig von Distanz, Zielzeit, Unterdrueckung, Verletzung, Bewegung des Spielers
    const dist = Math.hypot(th.x - muzzle.x, th.z - muzzle.z);
    const settle = Math.max(0, 1 - this.aimT / (1.6 - this.skill));
    let err = this.weapon.spread + settle * 7.0 + (1 - this.skill) * 2.4;
    err *= 1 + this.suppress * 0.5 + (this.health < 60 ? 0.4 : 0) + (P.speed > 2.5 ? 0.5 : 0) + (this.path ? 0.6 : 0);
    err *= 1 + dist / 30;
    if (P.crouched) err *= 1.1;
    const errR = err * Math.PI / 180;
    _d.set(th.x - muzzle.x, th.y - muzzle.y, th.z - muzzle.z).normalize();
    // zufaellige Abweichung im Kegel
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * errR;
    const ux = Math.abs(_d.y) < 0.9 ? _y.set(0, 1, 0) : _y.set(1, 0, 0);
    _x.crossVectors(_d, ux).normalize(); _z.crossVectors(_x, _d);
    _d.addScaledVector(_x, Math.cos(a) * Math.tan(r)).addScaledVector(_z, Math.sin(a) * Math.tan(r)).normalize();
    this.recoil = Math.min(0.06, this.recoil + 0.025);
    this.game.npcShoot(this, muzzle.clone(), _d.clone(), this.weapon);
  }

  // ---------------- Bewegung ----------------
  setGoal(x, z, run = false, sprint = false) {
    const path = this.game.nav.findPath(this.pos.x, this.pos.z, x, z);
    this.path = path; this.pathI = 0; this.run = run; this.sprint = sprint;
    this.stuckT = 0;
  }

  move(dt) {
    let tx = 0, tz = 0, want = 0;
    const kneel = this.stance === 'kneel_handsup' || this.stance === 'cuffed' || this.stance === 'tied' || (this.type === 'civilian' && this.state === 'hide');
    if (this.path && this.pathI < this.path.length && !kneel && this.stunT <= 0) {
      const wp = this.path[this.pathI];
      // Tuer?
      if (wp.door !== undefined && wp.door >= 0) {
        const door = this.game.world.doors[wp.door];
        const dd = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
        if (door && dd < 1.3 && Math.abs(door.open) < 1.2) {
          if (!door.locked) {
            if (Math.abs(door.target) < 1.2) { door.openAwayFrom(this.pos.x, this.pos.z); this.game.audio.play('door', { pos: new V(door.cx, 1, door.cz) }); this.game.emitNoise(door.cx, door.cz, 6, 'door', this); }
            if (Math.abs(door.open) < 1.0) { want = 0; this.waitDoor = true; }
          } else { this.path = null; }
        }
      }
      if (this.path) {
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) { this.pathI++; if (this.pathI >= this.path.length) { this.path = null; } }
        else if (!this.waitDoor) {
          tx = dx / d; tz = dz / d;
          want = this.sprint ? 3.6 : this.run ? 2.6 : 1.25;
          if (this.crouchT > 0.5) want = Math.min(want, 1.1);
          if (this.limp) want *= 0.6;
          if (this.state === 'combat' && this.aiming) want = Math.min(want, 1.8);
          if (this.state === 'flee') want = 3.4;
        }
        this.waitDoor = false;
      }
    }
    // Beschleunigung
    const ax = tx * want, az = tz * want;
    const k = Math.min(1, dt * 8);
    this.vel.x += (ax - this.vel.x) * k; this.vel.z += (az - this.vel.z) * k;
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const p = { x: nx, z: nz };
    this.game.world.resolveCircle(p, 0.28, 0.1, 1.7);
    // Abstand zu anderen
    for (const o of this.game.npcs) {
      if (o === this || !o.alive) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), s = (0.6 - d) / d * 0.5; p.x += dx * s; p.z += dz * s; }
    }
    const P = this.game.player;
    { const dx = p.x - P.pos.x, dz = p.z - P.pos.z, d2 = dx * dx + dz * dz; if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), s = (0.6 - d) / d; p.x += dx * s; p.z += dz * s; } }
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    // Festgefahren?
    if (this.path && want > 0 && moved < want * dt * 0.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) { const g = this.path[this.path.length - 1]; this.setGoal(g.x, g.z, this.run, this.sprint); if (this.stuckT > 3) this.path = null; }
    }
    this.pos.x = p.x; this.pos.z = p.z;
    this.speed = moved / Math.max(dt, 1e-4);
    if (this.speed > 0.05) this.moveDir = Math.atan2(this.vel.x, this.vel.z);
    this.phase += this.speed * dt * 4.4;
    // Koerperausrichtung: folgt Laufrichtung oder Ziel
    let bodyT = this.aimYaw;
    if (this.speed > 0.4 && !(this.state === 'combat' && this.aiming)) bodyT = this.moveDir;
    const diff = wrap(bodyT - this.yaw);
    const rate = this.speed > 0.4 ? 5 : (Math.abs(wrap(this.aimYaw - this.yaw)) > 0.9 ? 4 : 0.8);
    this.yaw = wrap(this.yaw + Math.sign(diff) * Math.min(Math.abs(diff), rate * dt));
    // Torso darf max. ~70 Grad verdreht sein
    const tw = wrap(this.aimYaw - this.yaw);
    if (Math.abs(tw) > 1.2) this.yaw = wrap(this.aimYaw - Math.sign(tw) * 1.2);
    // Ducken / Lehnen glaetten
    this.crouch += (this.crouchT - this.crouch) * Math.min(1, dt * 5);
    this.lean += (this.leanT - this.lean) * Math.min(1, dt * 6);
  }

  // ---------------- Pose / Darstellung ----------------
  poseUpdate(dt) {
    const s = this;
    const gun = computePose(this.joints, {
      x: s.pos.x, z: s.pos.z, yaw: s.yaw, aimYaw: s.aimYaw, aimPitch: s.aimPitch, speed: s.speed, moveDir: s.moveDir,
      phase: s.phase, crouch: s.crouch, stance: s.stance, t: s.t, aiming: !!s.aiming || this.stance === 'pistol' && this.state === 'combat',
      lean: s.lean, flinch: s.flinch, recoil: s.recoil,
    }, this.gunInfo);
    this.headFwd.set(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    this.body.update(this.joints, this.headFwd);
    if (this.gun && !this.gunDropped) {
      if (gun && this.hasGun) {
        this.gun.visible = true;
        const G = this.gunInfo;
        _z.copy(G.dir); _x.crossVectors(G.up, _z).normalize(); _y.crossVectors(_z, _x);
        _gm.makeBasis(_x, _y, _z).setPosition(G.pos);
        this.gun.matrix.copy(_gm);
        this.gun.matrixWorldNeedsUpdate = true;
      } else this.gun.visible = false;
    }
    this.updateProbe();
  }

  updateProbe() {
    this.probeT = (this.probeT || 0) - 1;
    if (this.probeT > 0) return;
    this.probeT = 8;
    const p = this.ragdoll ? this.ragdoll.centre(_v) : _v.set(this.pos.x, 1.0, this.pos.z);
    this.game.baker.probe(p.x, Math.max(0.5, p.y), p.z, this.body.probe.value);
    if (this.gun && this.gun.userData.probe) this.gun.userData.probe.value.copy(this.body.probe.value);
  }

  updateDead(dt) {
    const R = this.ragdoll;
    if (!R) return;
    R.step(dt);
    while (R.events.length) {
      const e = R.events.shift();
      if (e.step) { this.game.audio.play('step_concrete', { pos: new V(e.x, 0.1, e.z), vol: 0.35, ref: 2 }); continue; }
      const heavy = e.joint !== J.H;
      this.game.audio.play('bodyfall', { pos: new V(e.x, 0.2, e.z), vol: Math.min(1.2, (heavy ? 0.55 : 0.3) + e.speed * 0.12), rate: heavy ? 0.85 : 1.15, ref: 3 });
      if (heavy) this.game.fx.impact('dust', new V(e.x, 0.05, e.z), new V(0, 1, 0), new V(0, -1, 0), true);
    }
    if (!R.asleep || !this._finalPose) {
      this.joints.set(R.p);
      this.body.update(this.joints, null, true);
      if (R.asleep) {
        this._finalPose = true;
        // Blutlache
        if (!this.pool) { this.pool = true; this.game.fx.bloodPool(R.p[J.C * 3], R.p[J.C * 3 + 2]); }
      }
    }
    if (R.gun && this.gun) { R.stepGun(dt, this.game.world); this.placeDroppedGun(R.gun); }
    this.updateProbe();
  }

  placeDroppedGun(g) {
    _v.set(g.p[0], g.p[1], g.p[2]); _w.set(g.p[3], g.p[4], g.p[5]);
    _z.subVectors(_w, _v).normalize();
    _y.set(0, 1, 0); _x.crossVectors(_y, _z).normalize(); _y.crossVectors(_z, _x);
    _gm.makeBasis(_x, _y, _z).setPosition(_v);
    this.gun.matrix.copy(_gm); this.gun.matrixWorldNeedsUpdate = true; this.gun.visible = true;
  }

  updateDroppedGun(dt) {
    const g = this.droppedGun;
    if (!g || g.rest || !this.gun) return;
    // einfache Fallphysik
    const h = Math.min(dt, 1 / 30);
    g.t += h;
    for (let i = 0; i < 2; i++) {
      const ix = i * 3;
      const vx = (g.p[ix] - g.o[ix]) * 0.98, vy = (g.p[ix + 1] - g.o[ix + 1]), vz = (g.p[ix + 2] - g.o[ix + 2]) * 0.98;
      g.o[ix] = g.p[ix]; g.o[ix + 1] = g.p[ix + 1]; g.o[ix + 2] = g.p[ix + 2];
      g.p[ix] += vx; g.p[ix + 1] += vy - 9.81 * h * h; g.p[ix + 2] += vz;
      if (g.p[ix + 1] < 0.025) { g.p[ix + 1] = 0.025; g.o[ix + 1] = g.p[ix + 1]; g.o[ix] = g.p[ix] - vx * 0.4; g.o[ix + 2] = g.p[ix + 2] - vz * 0.4; }
    }
    const dx = g.p[3] - g.p[0], dy = g.p[4] - g.p[1], dz = g.p[5] - g.p[2];
    const d = Math.hypot(dx, dy, dz) || 1e-6, df = (d - g.len) / d * 0.5;
    g.p[0] += dx * df; g.p[1] += dy * df; g.p[2] += dz * df; g.p[3] -= dx * df; g.p[4] -= dy * df; g.p[5] -= dz * df;
    if (g.t > 2.5) g.rest = true;
    this.placeDroppedGun(g);
  }

  // Strahl gegen Hitboxen
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const Jt = this.joints;
    const cx = Jt[J.P * 3], cy = Jt[J.P * 3 + 1], cz = Jt[J.P * 3 + 2];
    // Grobtest Kugel
    const lx = cx - ox, ly = cy - oy, lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > 1.4 * 1.4 || tca < -1.4 || tca > maxT + 1.4) return null;
    let best = maxT, zone = null, joint = -1;
    for (const [a, b, r, z] of HITBOXES) {
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, Jt[a * 3], Jt[a * 3 + 1], Jt[a * 3 + 2], Jt[b * 3], Jt[b * 3 + 1], Jt[b * 3 + 2], r);
      if (t > 0 && t < best) { best = t; zone = z; joint = z === 'head' ? J.H : (z === 'torso' ? (t ? J.C : J.P) : b); }
    }
    if (!zone) return null;
    // Torso: hoeher Treffer -> Brust, tief -> Becken
    if (zone === 'torso') {
      const hy = oy + dy * best;
      joint = hy > (Jt[J.P * 3 + 1] + Jt[J.C * 3 + 1]) / 2 ? J.C : J.P;
    }
    return { t: best, zone, joint };
  }

  dispose() {
    this.game.scene.remove(this.body.group);
    if (this.gun) this.game.scene.remove(this.gun);
  }
}
