// Entwickler-Werkzeug (nur mit ?autoplay): menschenaehnlicher Testspieler fuer Gameplay-Aufnahmen.
// Bedient das Spiel ausschliesslich ueber simulierte Tasten/Maus (echter Rueckstoss, Schwanken, Streuung).
// Kein Zielhilfe-Einrasten: Reaktionszeit, gedaempfte Mausbewegung mit Ueberschwingen, Zielstreuung.
import * as THREE from 'three';

const V = THREE.Vector3;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);

const ROUTE = [
  [24, -3.5], [24, 0.6], [24, 3.2], [21.2, 8.9], [22.5, 11.2], [14, 11.2], [13, 16.5], [13, 23.2], [18.6, 23.3], [19.5, 25.6], [21.5, 28.4],
  [24.5, 26], [25.5, 23.3], [26, 20.8], [30, 20.3], [33.5, 13.2], [37, 11.3], [43, 11.3], [43, 13.6], [42.6, 17.8],
];

export class AutoPlayer {
  constructor(game) {
    this.g = game;
    this.wp = 0;
    this.path = null; this.pi = 0;
    this.av = { y: 0, p: 0 };       // Winkelgeschwindigkeit der "Hand"
    this.target = null; this.react = 0; this.aimOff = new V();
    this.fireT = 0; this.yellT = 0; this.holdF = 0; this.pause = 1.5;
    this.lookAround = 0; this.adsHold = 0;
    this.tapQueue = [];
    this.lastPos = { x: 0, z: 0 }; this.stuck = 0;
    this.semiSet = false;
  }

  key(code, down) { const I = this.g.input; if (down) { if (!I.keys.has(code)) I.pressed.add(code); I.keys.add(code); } else if (I.keys.has(code)) { I.keys.delete(code); I.released.add(code); } }
  tap(code) { this.key(code, true); this.tapQueue.push(code); }

  // Maus so bewegen, dass die Blickrichtung auf (yaw,pitch) zulaeuft: gedaempfte Feder mit begrenzter Geschwindigkeit
  aimTowards(ty, tp, dt, stiff = 38, maxV = 5.5) {
    const P = this.g.player;
    const ey = wrap(ty - P.yaw), ep = tp - P.pitch;
    const damp = 2 * Math.sqrt(stiff) * 0.72; // leicht unterdaempft -> kleines Ueberschwingen
    this.av.y += (ey * stiff - this.av.y * damp) * dt;
    this.av.p += (ep * stiff - this.av.p * damp) * dt;
    this.av.y = Math.max(-maxV, Math.min(maxV, this.av.y)); this.av.p = Math.max(-maxV, Math.min(maxV, this.av.p));
    // Mikrozittern der Hand
    const jy = (Math.random() - 0.5) * 0.004, jp = (Math.random() - 0.5) * 0.003;
    const sens = 0.0021 * this.g.settings.sens * (this.g.vm.ads > 0.5 ? 0.62 : 1);
    this.g.input.mdx += -(this.av.y * dt + jy) / sens;
    this.g.input.mdy += -(this.av.p * dt + jp) / sens;
    return Math.hypot(ey, ep);
  }

  visibleThreat() {
    const P = this.g.player, W = this.g.world;
    let best = null, bd = 1e9;
    for (const n of this.g.npcs) {
      if (!n.isThreat) continue;
      const c = n.chestPos(new V());
      const to = c.clone().sub(P.eyePos); const d = to.length();
      if (d > 28) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, to.clone().normalize().dot(P.viewDir))));
      if (ang > 1.15 && d > 4) continue;               // nur was im Blickfeld ist
      if (!W.los(P.eyePos.x, P.eyePos.y, P.eyePos.z, c.x, c.y, c.z)) continue;
      const score = d + ang * 6;
      if (score < bd) { bd = score; best = n; }
    }
    return best;
  }

  tick(dt) {
    const G = this.g, P = G.player;
    for (const c of this.tapQueue.splice(0)) this.key(c, false);
    if (G.state !== 'playing' || !P.alive) { this.key('KeyW', false); G.input.buttons = 0; return; }
    if (!this.semiSet) { this.semiSet = true; this.tap('KeyB'); }
    this.pause -= dt; this.yellT -= dt; this.fireT -= dt;
    // ---------- Kampf ----------
    const th = this.visibleThreat();
    if (th !== this.target) {
      this.target = th;
      this.react = rnd(0.25, 0.45);
      this.aimOff.set(rnd(-0.08, 0.08), rnd(-0.06, 0.1), rnd(-0.08, 0.08));
      this.yelled = false;
    }
    if (this.target) {
      const n = this.target;
      this.key('KeyW', false);
      this.key('ControlLeft', n.distTo(G.player.pos.x, G.player.pos.z) > 6);
      this.react -= dt;
      if (this.react > 0) return;
      // Ergeben? -> nicht schiessen, hingehen und festnehmen
      if (n.state === 'surrender' && !n.fake) { this.target = null; this.arrestTarget = n; G.input.buttons &= ~5; return; }
      const c = n.chestPos(new V()).add(this.aimOff);
      const e = P.eyePos;
      const ty = Math.atan2(-(c.x - e.x), -(c.z - e.z));
      const tp = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
      const err = this.aimTowards(ty, tp, dt);
      // Anrufen, wenn er (noch) nicht auf uns zielt
      if (!this.yelled && n.state !== 'combat' && this.yellT <= 0) { this.yelled = true; this.yellT = 1.8; this.tap('KeyF'); this.react = 0.9; return; }
      G.input.buttons |= 4; // zielen
      if (G.vm.ads > 0.75 && err < 0.03 && this.fireT <= 0) {
        G.input.buttons |= 1; this.fireT = rnd(0.2, 0.34);
        setTimeout(() => { G.input.buttons &= ~1; }, 45);
        // Ziel minimal neu waehlen (Mensch korrigiert nach)
        this.aimOff.multiplyScalar(0.6).add(new V(rnd(-0.03, 0.03), rnd(-0.03, 0.03), rnd(-0.03, 0.03)));
      }
      if (P.rounds === 0) this.tap('KeyR');
      return;
    }
    G.input.buttons &= ~5;
    this.key('ControlLeft', false);
    // ---------- Festnahme / Geisel ----------
    const targets = [];
    if (this.arrestTarget && this.arrestTarget.canArrest) targets.push(this.arrestTarget);
    for (const n of G.npcs) if (n.alive && !(this.skip && this.skip.has(n)) && ((n.type === 'hostage' && !n.rescued) || n.canArrest) && n.distTo(P.pos.x, P.pos.z) < (n.canArrest ? 14 : 6)) targets.push(n);
    if (!targets.length) this.targetT = 0;
    if (targets.length) {
      const n = targets[0];
      const d = n.distTo(P.pos.x, P.pos.z);
      if (d > 1.6) { this.goTo(n.pos.x, n.pos.z, dt, true); this.key('KeyF', false); }
      else {
        const c = n.chestPos(new V()); c.y = Math.min(c.y, 0.9);
        const e = P.eyePos;
        const err = this.aimTowards(Math.atan2(-(c.x - e.x), -(c.z - e.z)), Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)), dt, 22, 3.5);
        this.key('KeyW', false); this.key('KeyF', err < 0.4);
      }
      // Ziel unerreichbar? nach einer Weile aufgeben
      this.targetT = (this.targetT || 0) + dt;
      if (this.targetT > 12) { this.skip = this.skip || new Set(); this.skip.add(n); this.targetT = 0; }
      return;
    }
    this.key('KeyF', false);
    if (this.arrestTarget && !this.arrestTarget.canArrest) this.arrestTarget = null;
    // ---------- Nachladen in Ruhe ----------
    if (P.state.mag < 12 && !G.vm.reload && P.state.mags.length) this.tap('KeyR');
    // ---------- Route ----------
    if (this.pause > 0) { this.key('KeyW', false); this.idleLook(dt); return; }
    if (this.wp >= ROUTE.length) { this.key('KeyW', false); this.idleLook(dt); return; }
    const [tx, tz] = ROUTE[this.wp];
    const nxt = ROUTE[this.wp + 1];
    if (Math.hypot(tx - P.pos.x, tz - P.pos.z) < 0.7 || (nxt && Math.hypot(nxt[0] - P.pos.x, nxt[1] - P.pos.z) < Math.hypot(nxt[0] - tx, nxt[1] - tz) - 0.5)) { this.wp++; this.path = null; this.pause = rnd(0.2, 0.7); return; }
    this.goTo(tx, tz, dt, false);
  }

  idleLook(dt) {
    const P = this.g.player;
    this.lookAround -= dt;
    if (this.lookAround <= 0) { this.lookAround = rnd(0.8, 1.6); this.lookYaw = P.yaw + rnd(-0.7, 0.7); }
    this.aimTowards(this.lookYaw, rnd(-0.08, 0.02), dt, 14, 2);
  }

  goTo(tx, tz, dt, careful) {
    const G = this.g, P = G.player;
    if (!this.path || this.pathGoal !== tx + ',' + tz || this.pi >= this.path.length) {
      this.path = G.nav.findPath(P.pos.x, P.pos.z, tx, tz) || [{ x: tx, z: tz }]; this.pi = 0; this.pathGoal = tx + ',' + tz;
    }
    let wp = this.path[this.pi];
    while (wp && Math.hypot(wp.x - P.pos.x, wp.z - P.pos.z) < 0.45 && this.pi < this.path.length - 1) { this.pi++; wp = this.path[this.pi]; }
    // Geschlossene Tuer auf dem Weg? Hinschauen und oeffnen (wie ein Spieler)
    let blocking = null, bd = 1.8;
    for (const d of G.world.doors) {
      if (d.locked || d.broken || Math.abs(d.open) > 0.5 || Math.abs(d.target) > 0.2) continue;
      const c = d.closedCenter();
      const dist = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      // liegt die Tuer zwischen mir und dem naechsten Wegpunkt?
      const ax = wp.x - P.pos.x, az = wp.z - P.pos.z, L = Math.hypot(ax, az) || 1;
      const along = ((c.x - P.pos.x) * ax + (c.z - P.pos.z) * az) / L;
      const perp = Math.abs((c.x - P.pos.x) * az - (c.z - P.pos.z) * ax) / L;
      if (dist < bd && along > -0.2 && perp < 0.9) { bd = dist; blocking = d; }
    }
    if (blocking) {
      const c = blocking.closedCenter();
      const e = P.eyePos;
      const err = this.aimTowards(Math.atan2(-(c.x - e.x), -(c.z - e.z)), Math.atan2(1.1 - e.y, Math.hypot(c.x - e.x, c.z - e.z)), dt, 20, 3);
      if (bd > 1.1) { this.key('KeyW', err < 0.5); return; }
      this.key('KeyW', false);
      if (err < 0.35 && !this.doorWait) {
        // wie F auf genau diesen Fluegel
        if (G.nearDoor === blocking) this.tap('KeyF');
        else { blocking.openAwayFrom(P.pos.x, P.pos.z); G.audio.play('door', { pos: new V(blocking.cx, 1, blocking.cz), vol: 0.8 }); G.emitNoise(blocking.cx, blocking.cz, 6, 'door', null); }
        this.doorWait = 0.7;
      }
      if (this.doorWait) { this.doorWait -= dt; if (this.doorWait <= 0) this.doorWait = 0; }
      return;
    }
    // Wegpunkt schon passiert? (naechster ist naeher als der aktuelle Pfadpunkt)
    if (this.pi < this.path.length - 1) {
      const n2 = this.path[this.pi + 1];
      if (Math.hypot(n2.x - P.pos.x, n2.z - P.pos.z) < Math.hypot(n2.x - wp.x, n2.z - wp.z)) { this.pi++; wp = n2; }
    }
    const ty = Math.atan2(-(wp.x - P.pos.x), -(wp.z - P.pos.z));
    const err = this.aimTowards(ty, -0.03, dt, 16, 2.6);
    this.key('KeyW', err < 0.7);
    this.key('AltLeft', careful);
    // festgefahren?
    const mv = Math.hypot(P.pos.x - this.lastPos.x, P.pos.z - this.lastPos.z);
    this.lastPos.x = P.pos.x; this.lastPos.z = P.pos.z;
    if (mv < 0.002 && err < 0.7) { this.stuck += dt; if (this.stuck > 1.2) { this.stuck = 0; this.path = null; this.key('KeyD', true); setTimeout(() => this.key('KeyD', false), 300); } } else this.stuck = 0;
  }
}
