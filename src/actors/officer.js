// SWAT-Teamkollegen: folgen dem Spieler in Formation, bekaempfen bewaffnete Verdaechtige nach Einsatzregeln,
// nehmen Ergebene fest und melden alles ueber Funk.
import * as THREE from 'three';
import { NPC } from './npc.js';
import { J, getJ } from './skeleton.js';

const V = THREE.Vector3;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

const CALL = {
  contact: ['Kontakt, {r}!', 'Verdächtiger gesichtet, {r}!', 'Bewaffneter, {r}!'],
  kill: ['Verdächtiger ausgeschaltet.', 'Ziel liegt.', 'Bedrohung neutralisiert.'],
  surrender: ['Verdächtiger ergibt sich, ich übernehme.', 'Er gibt auf, ich sichere ihn.'],
  arrested: ['Verdächtiger festgenommen.', 'Festnahme erfolgt.'],
  civArrested: ['Zivilist gesichert.'],
  hostage: ['Geisel gefunden, {r}!', 'Hier ist eine Geisel, {r}!'],
  civilian: ['Zivilist entdeckt, {r}.'],
  clear: ['Raum sauber.', 'Sauber.', '{r} sauber.'],
  hit: ['Ich bin getroffen!', 'Treffer, bin noch einsatzfähig!'],
  hold: ['Verstanden, halte Position.', 'Halte hier.'],
  follow: ['Verstanden, folge.', 'Bin hinter dir.'],
  yell: ['Polizei! Waffe weg!', 'Polizei! Hände hoch!', 'Runter auf den Boden!'],
  reload: ['Lade nach!'],
};

export class Officer extends NPC {
  constructor(game, spec, slot) {
    super(game, spec, 'officer', slot);
    this.slot = slot;
    this.name = slot === 0 ? 'Alpha 2' : 'Alpha 3';
    this.target = null;
    this.reported = new Set();
    this.yelled = new Map();
    this.calloutCD = 0; this.clearCD = 6;
    this.repathT = 0;
    this.lastRoom = null; this.quietT = 0;
    const self = this;
    // Sicht fuer die Verdaechtigen-KI (gleiche Felder wie beim Spieler)
    this.agent = {
      officer: this, get alive() { return self.alive; }, pos: this.pos,
      headPos: new V(), chestPos: new V(), eyePos: new V(), viewDir: new V(0, 0, 1),
      flashlight: true, lightLevel: 0.6, crouched: false, speed: 0,
    };
    this.syncAgent();
  }

  syncAgent() {
    const a = this.agent;
    getJ(this.joints, J.H, a.headPos); getJ(this.joints, J.C, a.chestPos);
    a.eyePos.copy(a.headPos);
    a.viewDir.set(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    a.speed = this.speed; a.crouched = this.crouch > 0.5;
  }

  callout(cat, roomName, prio = 3) {
    if (!this.alive) return;
    const r = roomName || 'hier';
    this.game.speech.say(pick(CALL[cat]).replace('{r}', r), { type: 'team', prio, who: 900 + this.slot, name: this.name });
  }

  update(dt) {
    this.calloutCD -= dt; this.clearCD -= dt;
    super.update(dt);
    if (this.alive) this.syncAgent();
  }

  // ---------- Wahrnehmung ----------
  perceive() {
    const G = this.game, W = G.world, e = this.eye;
    let best = null, bd = 1e9;
    for (const n of G.npcs) {
      if (!n.isThreat) continue;
      const c = n.chestPos(new V());
      const d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d > 30) continue;
      const ang = Math.abs(wrap(Math.atan2(c.x - e.x, c.z - e.z) - this.aimYaw));
      if (ang > 1.4 && d > 5) continue;
      const h = n.headPos(new V());
      if (!W.los(e.x, e.y, e.z, c.x, c.y, c.z) && !W.los(e.x, e.y, e.z, h.x, h.y, h.z)) continue;
      const sc = d + ang * 3;
      if (sc < bd) { bd = sc; best = n; }
    }
    if (best !== this.target) {
      this.target = best;
      this.reactT = rnd(0.35, 0.6); this.aimT = 0;
      if (best && !this.reported.has(best)) { this.reported.add(best); this.callout('contact', G.roomAt(best.pos.x, best.pos.z)?.name, 4); }
    }
    const th = this.threat;
    if (best) {
      const c = best.chestPos(new V());
      th.x = c.x; th.y = c.y; th.z = c.z; th.visible = true; th.known = true; th.seenT = this.t;
      this.quietT = 0;
    } else { th.visible = false; this.quietT += 0.1; }
    // Geiseln / Zivilisten entdecken
    for (const n of G.npcs) {
      if (!n.alive || this.reported.has(n) || (n.type !== 'hostage' && n.type !== 'civilian') || n.rescued || n.arrested) continue;
      const d = n.distTo(this.pos.x, this.pos.z);
      if (d > 9) continue;
      const c = n.chestPos(new V());
      if (!W.los(e.x, e.y, e.z, c.x, c.y, c.z)) continue;
      this.reported.add(n);
      this.callout(n.type === 'hostage' ? 'hostage' : 'civilian', G.roomAt(n.pos.x, n.pos.z)?.name, 3);
    }
  }

  hear() { /* Team reagiert auf Sicht und Funk */ }

  // ---------- Entscheidungen ----------
  think(dt) {
    const G = this.game, P = G.player;
    this.repathT -= dt;
    if (this.target) { this.arrestTarget = null; return; } // im Gefecht: stehen bleiben und kaempfen
    // Festnahmen
    if (!this.arrestTarget || !this.arrestTarget.canArrest) {
      this.arrestTarget = null;
      for (const n of G.npcs) {
        if (!n.canArrest || n.claimedBy && n.claimedBy !== this) continue;
        if (n.distTo(this.pos.x, this.pos.z) < 9 && n.distTo(P.pos.x, P.pos.z) > 1.8) {
          this.arrestTarget = n; n.claimedBy = this; this.arrestT = 0;
          if (n.type === 'suspect') this.callout('surrender', null, 3);
          break;
        }
      }
    }
    if (this.arrestTarget) {
      const n = this.arrestTarget;
      const d = n.distTo(this.pos.x, this.pos.z);
      if (d > 1.2) { if (this.repathT <= 0) { this.repathT = 0.8; this.setGoal(n.pos.x, n.pos.z, d > 4); } }
      else {
        this.path = null;
        this.arrestT += dt;
        if (this.arrestT > 1.6 && n.canArrest) {
          n.arrest();
          G.audio.play('cuff', { pos: n.chestPos(new V()), vol: 0.7 });
          if (n.type === 'suspect') { G.stats.arrests++; this.callout('arrested'); G.hud.toast(this.name + ': Verdächtiger festgenommen'); }
          else { G.stats.civs++; this.callout('civArrested'); G.hud.toast(this.name + ': Zivilist gesichert'); }
          G.checkComplete();
          this.arrestTarget = null;
        }
      }
      return;
    }
    // Halten oder folgen
    let tx, tz;
    if (G.teamHold) { tx = G.teamHold.x + (this.slot ? 0.8 : -0.8); tz = G.teamHold.z; }
    else {
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      const side = this.slot ? 0.75 : -0.75;
      tx = P.pos.x - fx * 1.6 + rx * side; tz = P.pos.z - fz * 1.6 + rz * side;
      if (!G.nav.isWalk(tx, tz)) { tx = P.pos.x - fx * 1.4; tz = P.pos.z - fz * 1.4; }
    }
    const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (d > 1.8 && this.repathT <= 0) { this.repathT = 0.7; this.setGoal(tx, tz, d > 4); }
    else if (d < 0.8) this.path = null;
    // "Raum sauber"
    const room = G.roomAt(this.pos.x, this.pos.z);
    if (room && room !== this.lastRoom) { this.lastRoom = room; this.roomT = 0; }
    this.roomT = (this.roomT || 0) + dt;
    if (room && this.roomT > 2.5 && this.roomT < 2.7 && this.quietT > 2 && this.clearCD <= 0 && !(G.officers || []).some((o) => o !== this && o.clearCD > 4)) {
      this.clearCD = 12; this.callout('clear', room.name, 1);
    }
  }

  // ---------- Handeln ----------
  act(dt) {
    const G = this.game, P = G.player;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = this.weapon.mag; }
    const th = this.threat;
    this.aiming = !!this.target;
    if (this.target) {
      const e = this.eye;
      this.turnAim(Math.atan2(th.x - e.x, th.z - e.z), dt, 4.5);
      this.aimPitch += (Math.atan2(th.y - e.y, Math.hypot(th.x - e.x, th.z - e.z)) - this.aimPitch) * Math.min(1, dt * 6);
      this.crouchT = 0;
    } else if (this.path && this.pathI < this.path.length) {
      const wp = this.path[this.pathI];
      this.turnAim(Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z), dt, 3.5);
      this.aimPitch *= 0.9;
    } else {
      // Sicherungsrichtung: in Blickrichtung des Spielers, Partner jeweils leicht versetzt
      this.turnAim(P.yaw + Math.PI + (this.slot ? -0.45 : 0.45), dt, 2.5);
      this.aimPitch *= 0.95;
    }
    this.aimT += dt; this.fireCD -= dt;
    if (!this.target || this.reloadT > 0) { this.burstLeft = 0; return; }
    if (this.reactT > 0) { this.reactT -= dt; return; }
    const e = this.eye;
    const off = Math.abs(wrap(Math.atan2(th.x - e.x, th.z - e.z) - this.aimYaw));
    if (off > 0.1 || this.fireCD > 0) return;
    const n = this.target;
    // Einsatzregeln: wer (noch) nicht auf uns anlegt, wird zuerst angerufen
    if (n.state !== 'combat' && !this.yelled.has(n)) {
      this.yelled.set(n, this.t);
      this.game.speech.say(pick(CALL.yell), { type: 'team', prio: 3, who: 900 + this.slot, name: this.name, pos: this.eye.clone() });
      n.onYell(this.agent, true);
      this.fireCD = 1.4;
      return;
    }
    if (n.state !== 'combat' && this.t - this.yelled.get(n) < 2.5) return;
    if (this.lineBlocked(th)) {
      if (!this.path) { const a = this.aimYaw + (Math.random() < 0.5 ? 1.57 : -1.57); this.setGoal(this.pos.x + Math.sin(a) * 1.2, this.pos.z + Math.cos(a) * 1.2, true); }
      this.fireCD = 0.5; return;
    }
    if (this.burstLeft <= 0) this.burstLeft = Math.round(rnd(2, 3));
    this.fire();
    this.burstLeft--;
    this.fireCD = this.burstLeft > 0 ? 0.13 : rnd(0.3, 0.55);
    if (this.ammo <= 0) { this.reloadT = 2.4; this.burstLeft = 0; this.callout('reload', null, 1); }
  }

  // Schusslinie frei? (Spieler und alle anderen Figuren ausser dem Ziel)
  lineBlocked(th) {
    const e = this.eye, P = this.game.player;
    const dx = th.x - e.x, dz = th.z - e.z, L = Math.hypot(dx, dz) || 1;
    const check = (x, z) => {
      const ox = x - e.x, oz = z - e.z, along = (ox * dx + oz * dz) / L;
      if (along < 0.3 || along > L - 0.4) return false;
      return Math.abs(ox * dz - oz * dx) / L < 0.5;
    };
    if (P.alive && check(P.pos.x, P.pos.z)) return true;
    for (const o of this.game.npcs) if (o !== this && o !== this.target && o.alive && check(o.pos.x, o.pos.z)) return true;
    return false;
  }

  fire() {
    this.ammo--;
    const muzzle = new V().copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrix);
    const th = this.threat;
    const dist = Math.hypot(th.x - muzzle.x, th.z - muzzle.z);
    const settle = Math.max(0, 1 - this.aimT / 0.9);
    const err = (this.weapon.spread + settle * 2.5) * (1 + dist / 35) * Math.PI / 180;
    const d = new V(th.x - muzzle.x, th.y - muzzle.y, th.z - muzzle.z).normalize();
    const x = new V().crossVectors(d, Math.abs(d.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(), z = new V().crossVectors(x, d);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * err;
    d.addScaledVector(x, Math.cos(a) * Math.tan(r)).addScaledVector(z, Math.sin(a) * Math.tan(r)).normalize();
    this.recoil = Math.min(0.05, this.recoil + 0.02);
    this.game.npcShoot(this, muzzle, d, this.weapon);
  }

  damage(dmg, zone, dir, point, joint, src) {
    const wasAlive = this.alive;
    super.damage(dmg, zone, dir, point, joint, src);
    if (wasAlive && this.alive && this.calloutCD <= 0) { this.calloutCD = 5; this.callout('hit', null, 4); }
  }
}
