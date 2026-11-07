// Hauptspiel: Aufbau, Schleife, Ballistik, Interaktion, Einsatzziele.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildTextures } from './engine/textures.js';
import { buildWorldMaterials, PHYS, probeify, makeProbe, BAKE } from './engine/materials.js';
import { AudioEngine } from './engine/audio.js';
import { Speech } from './engine/speech.js';
import { Input } from './engine/input.js';
import { World } from './world/collision.js';
import { LevelBuilder, SPAWNS, roomAt } from './world/level.js';
import { LightBaker } from './world/lighting.js';
import { NavGrid } from './world/nav.js';
import { buildDoorMesh } from './world/doors.js';
import { NPC } from './actors/npc.js';
import { Officer } from './actors/officer.js';
import { Player } from './player/player.js';
import { ViewModel, GUNS } from './player/viewmodel.js';
import { Effects } from './fx/effects.js';
import { Post } from './fx/post.js';
import { HUD } from './hud.js';

const V = THREE.Vector3;
const _v = new V(), _w = new V();
const PLAYER_LINES = ['Polizei! Hände hoch!', 'Polizei! Waffe weg!', 'Auf den Boden! Sofort!', 'Polizei! Keine Bewegung!', 'Hände hoch! Zeig mir deine Hände!'];

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.state = 'menu';
    this.time = 0;
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.audio.volume = settings.vol;
    this.speech = new Speech();
    this.speech.enabled = settings.voice;
    this.hud = new HUD();
    this.speech.onSubtitle = (t, who, name) => this.hud.subtitle(t, who, name);
    this.speech.onRadio = () => this.audio.play('radio', { vol: 0.5, verb: 0, jitter: false });
    this.npcs = [];
    this.nades = [];
    this.stats = null;
  }

  // ---------------- Laden ----------------
  async load(onProgress) {
    const q = this.settings.quality;
    const R = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const pr = q === 'low' ? 0.75 : q === 'high' ? Math.min(devicePixelRatio, 1.5) : 1;
    R.setPixelRatio(pr);
    R.setSize(innerWidth, innerHeight, false);
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 0.95;
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.shadowMap.enabled = true;
    R.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080e);
    this.scene.fog = new THREE.FogExp2(0x040609, 0.009);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 180);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    onProgress(0.03, 'Texturen');
    await tick();
    const pm = new THREE.PMREMGenerator(R);
    this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.T = buildTextures(q);
    this.M = buildWorldMaterials(this.T, this.envMap);
    onProgress(0.08, 'Gebäude');
    await tick();
    this.world = new World();
    const B = this.builder = new LevelBuilder(this.world, this.M).build();
    onProgress(0.12, 'Navigation');
    await tick();
    this.nav = new NavGrid(this.world);
    this.baker = new LightBaker(this.world, B.lights);
    onProgress(0.15, 'Beleuchtung berechnen');
    const tb = performance.now();
    const meshes = await this.baker.bakeBuckets(B, this.M, (p) => onProgress(0.15 + p * 0.75, 'Beleuchtung berechnen'), q);
    this.bakeTime = (performance.now() - tb) / 1000;
    console.log('Bake', this.bakeTime.toFixed(2), 's');
    for (const m of meshes) { m.updateMatrix(); this.scene.add(m); if (m.userData.key === 'lamp_flicker') this.flickerMesh = m; }
    this.buildGlass();
    this.buildDoors();
    this.buildDecor();
    this.buildDynamicLights();
    onProgress(0.94, 'Ausrüstung');
    await tick();
    this.vm = new ViewModel(q, this.envMap);
    this.vm.setFlashTexture(this.T.muzzle);
    this.vm.setSleeveTexture(this.T.fabric.map, this.T.fabric.normal);
    this.vm.setGunTextures(this.T);
    this.vm.onSound = (s) => this.audio.play(s, { vol: 0.8, verb: 0.05 });
    this.vm.onDropMag = () => { const cam = this.camera; const p = cam.localToWorld(new V(-0.05, -0.35, -0.35)); const v = new V(0, -0.5, 0).add(new V(this.player.vel.x, 0, this.player.vel.z)); this.fx.dropMag(p, v, this.player.gun === 'pistol'); };
    this.fx = new Effects(this, this.T, this.envMap);
    this.post = new Post(R, this.scene, this.camera, this.vm.scene, this.vm.camera, q);
    if (q === 'high') { this.post.composer.renderTarget1.samples = 4; this.post.composer.renderTarget2.samples = 4; }
    this.audio.occlusion = (p) => {
      const L = this.camera.position;
      return !this.world.los(L.x, L.y, L.z, p.x, p.y, p.z, true);
    };
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setupMission();
    // Shader vorkompilieren (vermeidet Ruckler beim ersten Schuss)
    this.fx.npcLight.intensity = 0.0001;
    R.compile(this.scene, this.camera);
    R.compile(this.vm.scene, this.vm.camera);
    onProgress(1, 'Bereit');
  }

  buildGlass() {
    this.glassPanes = [];
    for (const [x0, y0, z0, x1, y1, z1, box] of this.builder.glassBoxes) {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const m = new THREE.Mesh(g, this.M.glass.mat);
      m.renderOrder = 3;
      this.scene.add(m);
      box.glassMesh = m; box.orig = { min: [...box.min], max: [...box.max] };
      this.glassPanes.push(box);
    }
  }

  buildDoors() {
    const T = this.T;
    const mkDoorMats = (probe) => ({
      woodDoor: probeify(new THREE.MeshStandardMaterial({ map: T.wood.map, normalMap: T.wood.normal, color: 0xa88560, roughness: 0.55 }), probe),
      metalDoor: probeify(new THREE.MeshStandardMaterial({ map: T.metal.map, color: 0x6f757b, roughness: 0.45, metalness: 0.6, envMap: this.envMap, envMapIntensity: 0.4 }), probe),
      glassDoor: new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.14, envMap: this.envMap, envMapIntensity: 0.3, depthWrite: false }),
      alu: probeify(new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.35, metalness: 0.8, envMap: this.envMap, envMapIntensity: 0.5 }), probe),
      handle: probeify(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9, envMap: this.envMap, envMapIntensity: 0.9 }), probe),
    });
    for (const d of this.world.doors) {
      const probe = makeProbe();
      const c = d.closedCenter();
      // Mittelwert beider Seiten
      const a = new THREE.Color(), b = new THREE.Color();
      const nx = -Math.sin(d.base), nz = Math.cos(d.base);
      this.baker.probe(c.x + nx * 0.6, 1.2, c.z + nz * 0.6, a);
      this.baker.probe(c.x - nx * 0.6, 1.2, c.z - nz * 0.6, b);
      probe.value.copy(a).add(b).multiplyScalar(0.5);
      const mesh = buildDoorMesh(d, mkDoorMats(probe));
      mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(mesh);
    }
  }

  buildDecor() {
    const plantMat = probeify(new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.75 }), makeProbe());
    const potMat = probeify(new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 0.8 }), makeProbe());
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    this.policeBars = [];
    for (const d of this.builder.decor) {
      if (d.type === 'plant') {
        const probe = makeProbe();
        this.baker.probe(d.x, 0.8, d.z, probe.value);
        const pm = plantMat.clone(); probeify(pm, probe);
        const po = potMat.clone(); probeify(po, probe);
        const g = new THREE.Group();
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.42, 12), po); pot.position.y = 0.21; g.add(pot);
        for (let i = 0; i < 6; i++) {
          const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + Math.random() * 0.1, 0), pm);
          leaf.position.set((Math.random() - 0.5) * 0.3, 0.6 + i * 0.13, (Math.random() - 0.5) * 0.3);
          leaf.rotation.set(Math.random() * 3, Math.random() * 3, 0);
          leaf.scale.set(1, 0.7, 1);
          g.add(leaf);
        }
        g.position.set(d.x, 0, d.z);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
        this.world.addBox(d.x - 0.2, 0, d.z - 0.2, d.x + 0.2, 0.42, d.z + 0.2, 'plastic');
      } else if (d.type === 'wheel') {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16), tireMat);
        w.rotation.z = Math.PI / 2; if (d.rot) w.rotation.y = Math.PI / 2;
        w.position.set(d.x, 0.33, d.z);
        this.scene.add(w);
      } else if (d.type === 'lightbar') {
        const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2) });
        const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.5, 3.5) });
        const y = d.y ?? 1.55;
        const g = new THREE.Group();
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.25), red); r.position.set(-0.3, 0, 0);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.25), blue); b.position.set(0.3, 0, 0);
        g.add(r, b); g.position.set(d.x, y + 0.05, d.z); if (d.rot) g.rotation.y = Math.PI / 2;
        this.scene.add(g);
        this.policeBars.push({ r, b, red, blue });
      }
    }
    // Platzhalter fuer Pflanzen-Kollision im Gitter nachtragen
    this.world.finalize();
  }

  buildDynamicLights() {
    const q = this.settings.quality;
    // Waffenlampe
    const fl = this.flashlightLight = new THREE.SpotLight(0xfff1e0, 15, 28, 0.42, 0.78, 1.35);
    fl.castShadow = true;
    const sm = q === 'low' ? 512 : q === 'high' ? 2048 : 1024;
    fl.shadow.mapSize.set(sm, sm);
    fl.shadow.camera.near = 0.15; fl.shadow.camera.far = 32;
    fl.shadow.bias = -0.0012; fl.shadow.normalBias = 0.06; fl.shadow.radius = 3;
    this.scene.add(fl); this.scene.add(fl.target);
    // Muendungsfeuer (Welt)
    this.muzzleLight = new THREE.PointLight(0xffaa55, 0, 12, 1.8);
    this.scene.add(this.muzzleLight);
    this.muzzleT = 0;
    // Blendgranate
    this.bangLight = new THREE.PointLight(0xffffff, 0, 25, 1.5);
    this.scene.add(this.bangLight);
    this.bangT = 0;
    // Polizeilicht + Flackerlicht (nicht bei Niedrig)
    if (q !== 'low') {
      this.policeR = new THREE.PointLight(0xff2020, 0, 22, 1.6); this.policeR.position.set(21.5, 2.6, -8.2);
      this.policeB = new THREE.PointLight(0x2050ff, 0, 22, 1.6); this.policeB.position.set(27.5, 1.8, -12.5);
      this.scene.add(this.policeR, this.policeB);
    }
    this.flicker = null;
    for (const L of this.builder.dynLights) {
      if (q === 'low') continue;
      const p = new THREE.PointLight(L.color, L.I, L.range, 1.8);
      p.position.set(L.x, L.y, L.z);
      this.scene.add(p);
      this.flicker = { light: p, base: L.I, t: 0, on: true };
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vm.camera.aspect = w / h; this.vm.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  // ---------------- Mission ----------------
  setupMission() {
    for (const n of this.npcs) n.dispose();
    this.npcs = [];
    SPAWNS.suspects.forEach((s, i) => this.npcs.push(new NPC(this, s, 'suspect', i)));
    SPAWNS.hostages.forEach((s, i) => this.npcs.push(new NPC(this, s, 'hostage', i)));
    SPAWNS.civilians.forEach((s, i) => this.npcs.push(new NPC(this, s, 'civilian', i)));
    this.officers = [new Officer(this, { x: 22.9, z: -9.6, yaw: 0 }, 0), new Officer(this, { x: 25.1, z: -9.6, yaw: 0 }, 1)];
    this.npcs.push(...this.officers);
    this.teamHold = null;
    for (const c of this.nav.covers) c.used = null;
    for (const d of this.world.doors) { d.open = 0; d.target = 0; d.broken = false; if (d.glassMesh) d.glassMesh.visible = true; d._upd(); if (d.mesh) d.mesh.rotation.y = -d.angle; }
    for (const b of this.glassPanes || []) { if (b.broken) { b.broken = false; b.min = [...b.orig.min]; b.max = [...b.orig.max]; b.glassMesh.visible = true; } }
    this.respawnT = 0;
    // Haupteingang leicht offen? Nein – geschlossen, Spieler entscheidet.
    this.player = new Player(this, SPAWNS.player);
    this.vm.onSwitched = (to) => this.player.onSwitched(to);
    this.vm.setWeapon('carbine');
    this.vm.reload = null; this.vm.switchTo = null;
    this.fx.holes.n = 0; this.fx.holes.mesh.count = 0; this.fx.bloodDecals.n = 0; this.fx.bloodDecals.mesh.count = 0; this.fx.pools = [];
    for (const n of this.nades) this.scene.remove(n.mesh);
    this.nades = [];
    this.evidence = { ...SPAWNS.evidence, taken: false };
    if (!this.laptop) {
      const g = new THREE.Group();
      const probe = makeProbe(); this.baker.probe(this.evidence.x, 1, this.evidence.z, probe.value);
      const body = probeify(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.5 }), probe);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), body); base.position.y = 0.01; g.add(base);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), body); lid.position.set(0, 0.12, -0.115); lid.rotation.x = -0.25; g.add(lid);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: this.T.screen, color: new THREE.Color(1.4, 1.4, 1.4) }));
      scr.position.set(0, 0.12, -0.108); scr.rotation.x = -0.25; g.add(scr);
      g.position.set(this.evidence.x, this.evidence.y, this.evidence.z);
      g.rotation.y = Math.PI / 2;
      this.scene.add(g);
      this.laptop = g;
    }
    this.laptop.visible = true;
    this.stats = { kills: 0, arrests: 0, hostages: 0, evidence: false, civs: 0, civKilled: 0, hostageKilled: 0, penalties: 0, shots: 0, hits: 0, start: this.time, complete: false };
    this.hud.renderObjectives(this.objectiveState());
    this.yellCD = 0;
    this.endT = -1;
  }

  objectiveState() {
    const S = this.stats;
    const sus = this.npcs.filter((n) => n.type === 'suspect');
    const civs = this.npcs.filter((n) => n.type === 'civilian');
    return {
      hostages: S.hostages, hostagesTotal: SPAWNS.hostages.length,
      evidence: S.evidence,
      suspects: sus.filter((n) => !n.alive || n.arrested).length, suspectsTotal: sus.length,
      civs: civs.filter((n) => n.arrested || !n.alive).length, civsTotal: civs.length,
      arrests: S.arrests, kills: S.kills, penalties: S.penalties,
    };
  }

  checkComplete() {
    const o = this.objectiveState();
    this.hud.renderObjectives(o);
    const hostOk = o.hostages + this.stats.hostageKilled >= o.hostagesTotal;
    if (!this.stats.complete && hostOk && o.evidence && o.suspects >= o.suspectsTotal && o.civs >= o.civsTotal) {
      this.stats.complete = true;
      this.audio.play('radio', { vol: 0.7, verb: 0 });
      this.hud.centerMsg('GEBÄUDE GESICHERT', 'Alle Ziele erfüllt. [Enter] Einsatz beenden', 8);
      this.speech.say('Zentrale an Team: Gebäude gesichert. Gute Arbeit.', { prio: 5, type: 'radio', rate: 1.05 });
    }
  }

  roomAt(x, z) { return roomAt(x, z); }

  // ---------------- Ereignisse von NPCs ----------------
  onDeath(npc, src) {
    const S = this.stats;
    if (npc.type === 'officer') {
      S.officersDown = (S.officersDown || 0) + 1;
      this.hud.toast(npc.name + ' ausgefallen!', 'bad');
      const other = (this.officers || []).find((o) => o !== npc && o.alive);
      if (other) other.game.speech.say(npc.name + ' ist getroffen! Mann am Boden!', { type: 'team', prio: 5, who: 900 + other.slot, name: other.name });
      else this.speech.say('Einsatzleitung an Alpha: Team ausgefallen, Sie sind auf sich allein gestellt.', { type: 'radio', prio: 5 });
      return;
    }
    if (npc.type === 'suspect' && npc.lastAttacker && npc.lastAttacker.type === 'officer' && npc.lastAttacker.alive) npc.lastAttacker.callout('kill', null, 3);
    if (npc.type === 'suspect') {
      S.kills++;
      if (npc.state === 'dead' && npc.surrendered && !npc.fake && npc.t - (npc.surrenderT ?? -99) > 1.2) { S.penalties++; this.hud.toast('Unerlaubte Gewalt: Verdächtiger hatte sich ergeben', 'bad'); }
      else this.hud.toast('Verdächtiger neutralisiert');
    } else if (npc.type === 'hostage') { S.hostageKilled++; this.hud.toast('Geisel getötet!', 'bad'); }
    else { S.civKilled++; this.hud.toast('Zivilist getötet!', 'bad'); }
    this.checkComplete();
  }
  onSurrender(npc) { this.hud.toast('Verdächtiger ergibt sich', 'info'); }
  onFakeSurrender(npc) { this.hud.toast('Achtung! Verdächtiger zieht eine Waffe!', 'bad'); }

  alertNearby(src, x, z) {
    for (const n of this.npcs) {
      if (n === src || n.type !== 'suspect' || !n.alive || n.arrested || n.state === 'surrender') continue;
      const d = n.distTo(src.pos.x, src.pos.z);
      const sameRoom = roomAt(n.pos.x, n.pos.z) === roomAt(src.pos.x, src.pos.z);
      if (d < 7 || (sameRoom && d < 16) || (d < 14 && this.world.los(n.pos.x, 1.5, n.pos.z, src.pos.x, 1.5, src.pos.z))) {
        if (n.state !== 'combat') {
          n.threat.x = x; n.threat.z = z; n.threat.y = 1.4; n.threat.known = true; n.threat.seenT = n.t - 2;
          n.enterCombat(); n.awareness = Math.max(n.awareness, 0.75); n.reactT = 0.4;
        }
      }
    }
  }

  emitNoise(x, z, radius, type, src) {
    for (const n of this.npcs) {
      if (n === src || !n.alive) continue;
      const d = n.distTo(x, z);
      if (d > radius) continue;
      if (type === 'shot' && d > radius * 0.55 && !this.world.los(x, 1.4, z, n.pos.x, 1.4, n.pos.z)) continue; // Waende daempfen
      if (type === 'step' || type === 'door' || type === 'yell') {
        // durch Waende gedaempft
        if (d > radius * 0.5 && !this.world.los(x, 1.2, z, n.pos.x, 1.2, n.pos.z)) continue;
      }
      n.hear({ x, z, type });
    }
  }

  // ---------------- Ballistik ----------------
  playerShoot(o, dir, D) {
    const S = this.stats;
    S.shots++;
    const P = this.player;
    const room = roomAt(P.pos.x, P.pos.z);
    this.audio.play(D.snd, { vol: 1, verb: room ? 0.55 : 0.2, important: true, rate: 1 });
    this.emitNoise(P.pos.x, P.pos.z, 30, 'shot', null);
    let power = 1, remaining = 150;
    const hitNpcs = new Set();
    const origin = o.clone();
    let firstPoint = null;
    for (let pen = 0; pen < 5 && power > 0.08 && remaining > 0; pen++) {
      const wh = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, remaining, null, true, {});
      const tw = wh ? wh.t : remaining;
      // Figuren
      let best = null;
      for (const n of this.npcs) {
        if (hitNpcs.has(n)) continue;
        const h = n.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, tw);
        if (h && (!best || h.t < best.h.t)) best = { n, h };
      }
      if (best) {
        const pt = o.clone().addScaledVector(dir, best.h.t);
        hitNpcs.add(best.n);
        const wasAlive = best.n.alive;
        best.n.damage(D.dmg * power, best.h.zone, dir.clone(), pt, best.h.joint, P.chestPos.clone());
        this.audio.play('imp_flesh', { pos: pt, vol: 0.9, ref: 3 });
        if (wasAlive) { const kill = !best.n.alive; this.hud.hitMarker(kill, best.h.zone === 'head'); this.audio.play(kill ? 'killconfirm' : 'hitmark', { vol: kill ? 0.55 : 0.4, verb: 0, jitter: false }); }
        S.hits++;
        if (!firstPoint) firstPoint = pt;
        power -= 0.55; remaining -= best.h.t + 0.3;
        o = pt.addScaledVector(dir, 0.3);
        continue;
      }
      if (!wh) break;
      const pt = o.clone().addScaledVector(dir, wh.t);
      if (!firstPoint) firstPoint = pt;
      const phys = PHYS[wh.mat] || PHYS.concrete;
      const nrm = new V(wh.nx, wh.ny, wh.nz);
      if (wh.mat === 'glass') { this.breakGlass(wh, pt, dir); remaining -= wh.t + 0.02; o = pt.addScaledVector(dir, 0.03); continue; }
      this.fx.impact(phys.fx, pt, nrm, dir);
      this.audio.play('imp_' + phys.snd, { pos: pt, vol: 0.75, ref: 2.5 });
      // Dicke bestimmen
      let thick = 0.05;
      if (wh.box) thick = exitDist(wh.box, pt, dir);
      else if (wh.door) { thick = 0.045 / Math.max(0.2, Math.abs(dir.x * wh.nx + dir.z * wh.nz)); wh.door.noise = 1; }
      power -= phys.resist * thick / D.pen;
      remaining -= wh.t + thick;
      if (power <= 0.08) break;
      const ex = pt.clone().addScaledVector(dir, thick + 0.005);
      // Austrittseffekt
      this.fx.impact(phys.fx, ex, dir.clone(), dir);
      o = ex.addScaledVector(dir, 0.005);
    }
    // Unterdrueckung: Kugeln nahe an Verdaechtigen
    const end = firstPoint || origin.clone().addScaledVector(dir, 60);
    for (const n of this.npcs) {
      if (n.type !== 'suspect' || !n.alive) continue;
      const d = segDist(origin, end, n.chestPos(_v));
      if (d < 1.5) { n.suppress = Math.min(2, n.suppress + (1.5 - d) * 0.8); if (n.state !== 'combat' && n.state !== 'surrender') { n.threat.x = P.chestPos.x; n.threat.z = P.chestPos.z; n.threat.known = true; n.enterCombat(); } }
    }
  }

  npcShoot(npc, muzzle, dir, W) {
    const P = this.player;
    this.audio.play(W.snd, { pos: muzzle, vol: 1, ref: 7, rolloff: 0.9, important: true, verb: 0.5 });
    this.fx.npcFlash(muzzle, dir);
    this.emitNoise(npc.pos.x, npc.pos.z, 22, 'shot', npc);
    const wh = this.world.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, 120, null, true, {});
    let tw = wh ? wh.t : 120;
    // Spieler
    const ph = P.hitTest(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, tw);
    let target = null;
    if (ph) target = { t: ph.t, player: true, zone: ph.zone };
    for (const n of this.npcs) {
      if (n === npc) continue;
      const h = n.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, target ? target.t : tw);
      if (h && (!target || h.t < target.t)) target = { t: h.t, npc: n, h };
    }
    let endT = target ? target.t : tw;
    const end = muzzle.clone().addScaledVector(dir, endT);
    if (Math.random() < 0.55) this.fx.tracer(muzzle, end);
    if (target && target.player) {
      P.damage(W.dmg, target.zone, dir);
    } else if (target && target.npc) {
      target.npc.lastAttacker = npc;
      target.npc.damage(W.dmg * (npc.type === 'officer' ? 1 : 0.8), target.h.zone, dir.clone(), end, target.h.joint, muzzle);
    } else if (wh && wh.mat === 'glass') {
      this.breakGlass(wh, end, dir);
    } else if (wh) {
      const phys = PHYS[wh.mat] || PHYS.concrete;
      this.fx.impact(phys.fx, end, new V(wh.nx, wh.ny, wh.nz), dir);
      this.audio.play('imp_' + phys.snd, { pos: end, vol: 0.7, ref: 2.5 });
    }
    // Vorbeifliegen
    if (!(target && target.player)) {
      const d = segDist(muzzle, end, P.eyePos);
      if (d < 1.4) {
        const cp = closestOnSeg(muzzle, end, P.eyePos);
        this.audio.play('whiz', { pos: cp, vol: 1.2 - d * 0.5, ref: 1, verb: 0.1 });
        P.suppress = Math.min(1, P.suppress + (1.4 - d) * 0.5);
        P.shake = Math.min(1, P.shake + 0.3);
      }
    }
  }

  muzzleWorld(p) { this.muzzleLight.position.copy(p); this.muzzleLight.intensity = 9 + Math.random() * 5; this.muzzleT = 0.045; }

  // ---------------- Blendgranate ----------------
  spawnNade(p, v) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.6, metalness: 0.3 }));
    m.castShadow = true;
    this.scene.add(m);
    this.nades.push({ p: p.clone(), v: v.clone(), mesh: m, fuse: 1.6, spin: new V(Math.random() * 10, Math.random() * 10, 0) });
  }

  updateNades(dt) {
    const W = this.world;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const h = dt / steps;
        n.v.y -= 9.81 * h;
        const step = n.v.clone().multiplyScalar(h);
        const L = step.length();
        if (L > 1e-5) {
          const d = step.clone().divideScalar(L);
          const hit = W.raycast(n.p.x, n.p.y, n.p.z, d.x, d.y, d.z, L + 0.03, null, true, {});
          if (hit) {
            const nn = new V(hit.nx, hit.ny, hit.nz);
            n.p.addScaledVector(d, Math.max(0, hit.t - 0.03));
            n.v.addScaledVector(nn, -1.55 * n.v.dot(nn)).multiplyScalar(0.55);
            if (n.v.length() > 1) this.audio.play('nadebounce', { pos: n.p, vol: 0.6 });
          } else n.p.add(step);
        }
        if (n.p.y < 0.03) { n.p.y = 0.03; if (n.v.y < -1) this.audio.play('nadebounce', { pos: n.p, vol: 0.5 }); n.v.y *= -0.35; n.v.x *= 0.7; n.v.z *= 0.7; }
      }
      n.mesh.position.copy(n.p);
      n.mesh.rotation.x += n.spin.x * dt * Math.min(1, n.v.length()); n.mesh.rotation.z += n.spin.y * dt * Math.min(1, n.v.length());
      if (n.fuse <= 0) { this.flashbang(n.p.clone()); this.scene.remove(n.mesh); this.nades.splice(i, 1); }
    }
  }

  flashbang(p) {
    const P = this.player;
    this.audio.play('bang', { pos: p, vol: 1.6, ref: 8, important: true, verb: 0.8 });
    this.bangLight.position.copy(p).y += 0.2; this.bangLight.intensity = 400; this.bangT = 0.12;
    for (let i = 0; i < 40; i++) this.fx.dust.spawn(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3, 0.6, 0.6, 0.6, 0.35, 0.25, 2.5, 0.6, -0.05, 1.5);
    for (let i = 0; i < 30; i++) this.fx.glow.spawn(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9, 3, 2.8, 2.4, 1, 0.03, 0.3, 0, 9.8, 1);
    this.emitNoise(p.x, p.z, 40, 'bang', null);
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const h = n.headPos(_v);
      const d = h.distanceTo(p);
      if (d < 9 && this.world.los(p.x, p.y + 0.15, p.z, h.x, h.y, h.z)) n.stun(Math.max(2, 7 - d * 0.55));
      else if (d < 3) n.stun(2);
    }
    const e = P.eyePos;
    const d = e.distanceTo(p);
    if (d < 14 && this.world.los(p.x, p.y + 0.15, p.z, e.x, e.y, e.z)) {
      const toB = _w.subVectors(p, e).normalize();
      const facing = Math.max(0, toB.dot(P.viewDir));
      const s = Math.min(1, (1 - d / 14) * (0.35 + facing * 0.9));
      this.flashAmt = Math.max(this.flashAmt || 0, s);
      this.audio.deafen(Math.min(1, s * 1.2));
    } else if (d < 8) this.audio.deafen(0.4);
  }

  // ---------------- Interaktion ----------------
  updateInteraction(dt) {
    const P = this.player, I = this.input;
    let target = null;
    const eye = P.eyePos, vd = P.viewDir;
    let bestScore = 0.25;
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const d = n.distTo(P.pos.x, P.pos.z);
      if (d > 2.0) continue;
      const c = n.chestPos(_v);
      c.y = Math.min(c.y, 1.0);
      const to = _w.subVectors(c, eye); const L = to.length(); to.divideScalar(L);
      const dot = to.dot(vd);
      if (dot < 0.6) continue;
      let kind = null, label = null, hold = 1.2;
      if (n.canArrest) { kind = 'arrest'; label = n.type === 'suspect' ? 'Festnehmen' : 'Zivilisten sichern'; }
      else if (n.type === 'hostage' && !n.rescued) { kind = 'rescue'; label = 'Geisel befreien'; hold = 1.5; }
      if (kind && dot > bestScore) { bestScore = dot; target = { kind, label, npc: n, hold }; }
    }
    if (!target && !this.stats.evidence) {
      const ev = this.evidence;
      _v.set(ev.x, ev.y, ev.z);
      const d = _v.distanceTo(eye);
      if (d < 1.6 && _w.subVectors(_v, eye).normalize().dot(vd) > 0.75) target = { kind: 'evidence', label: 'Beweismittel sichern (Laptop)', hold: 1.0 };
    }
    // Tuer
    let door = null, dd = 1.7;
    for (const d of this.world.doors) {
      const c = d.closedCenter();
      const dist = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      if (dist < dd) {
        const to = _w.set(c.x - eye.x, 1.1 - eye.y, c.z - eye.z).normalize();
        if (to.dot(vd) > 0.45 || dist < 0.9) { dd = dist; door = d; }
      }
    }
    this.nearDoor = door;
    // F-Taste
    if (target) {
      if (I.down('KeyF')) {
        P.holdT += dt;
        if (P.holdT >= target.hold) { this.doInteract(target); P.holdT = 0; this.fHandled = true; }
      } else P.holdT = 0;
      this.hud.setPrompt(`<b>F</b> halten: ${target.label}`, P.holdT > 0 ? P.holdT / target.hold : -1);
    } else {
      P.holdT = 0;
      if (door) {
        const txt = door.locked ? 'Verschlossen' : (Math.abs(door.target) > 0.1 ? 'Tür schließen' : 'Tür öffnen');
        this.hud.setPrompt(`<b>F</b> ${txt} · <b>Rad</b> langsam öffnen · <b>V</b> eintreten`);
      } else this.hud.setPrompt('');
    }
    if (I.down('KeyF')) this.fTime = (this.fTime || 0) + dt;
    if (I.up('KeyF')) {
      const tap = (this.fTime || 0) < 0.3;
      if (!this.fHandled && tap) {
        if (door && !target) {
          if (door.locked) this.audio.play('doorlocked', { pos: new V(door.cx, 1, door.cz) });
          else {
            const r = door.toggle(P.pos.x, P.pos.z);
            this.audio.play(r === 'open' ? 'door' : 'doorclose', { pos: new V(door.cx, 1, door.cz), vol: 0.8 });
            this.emitNoise(door.cx, door.cz, 6, 'door', null);
          }
        } else this.yell();
      }
      this.fHandled = false;
      this.fTime = 0;
    }
    if (door && I.wheel !== 0 && !door.locked) door.nudge(P.pos.x, P.pos.z, -I.wheel * 0.14);
    if (door && I.hit('KeyV')) this.kickDoor(door);
  }

  kickDoor(door) {
    const P = this.player;
    P.shake = 0.6;
    if (door.locked) { this.audio.play('doorkick', { pos: new V(door.cx, 1, door.cz), vol: 0.9 }); this.hud.toast('Tür ist verstärkt – lässt sich nicht eintreten', 'info'); this.emitNoise(door.cx, door.cz, 18, 'kick', null); return; }
    door.openAwayFrom(P.pos.x, P.pos.z, 1.9);
    door.kicked = true;
    this.audio.play('doorkick', { pos: new V(door.cx, 1, door.cz), vol: 1, important: true });
    this.emitNoise(door.cx, door.cz, 22, 'kick', null);
    // Personen direkt hinter der Tuer werden umgestossen/betaeubt
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const c = door.closedCenter();
      if (n.distTo(c.x, c.z) < 1.3 && door.sideOf(n.pos.x, n.pos.z) !== door.sideOf(P.pos.x, P.pos.z)) n.stun(2.5);
    }
  }

  doInteract(t) {
    const S = this.stats;
    if (t.kind === 'arrest') {
      t.npc.arrest();
      this.audio.play('cuff', { pos: t.npc.chestPos(new V()), vol: 0.8 });
      if (t.npc.type === 'suspect') { S.arrests++; this.hud.toast('Verdächtiger festgenommen'); }
      else { S.civs++; this.hud.toast('Zivilist gesichert'); }
    } else if (t.kind === 'rescue') {
      t.npc.rescued = true;
      S.hostages++;
      this.audio.play('cuff', { pos: t.npc.chestPos(new V()), vol: 0.6, rate: 0.8 });
      t.npc.say('hostageFree', 3, true);
      this.hud.toast('Geisel befreit');
      this.speech.say(S.hostages >= SPAWNS.hostages.length ? 'Einsatzleitung: Alle Geiseln in Sicherheit. Sehr gute Arbeit.' : 'Einsatzleitung: Verstanden, Geisel in Sicherheit.', { type: 'radio', prio: 4 });
    } else if (t.kind === 'evidence') {
      S.evidence = true;
      this.laptop.visible = false;
      this.audio.play('radio', { vol: 0.7, verb: 0 });
      this.hud.toast('Beweismittel gesichert', 'info');
      this.speech.say('Einsatzleitung: Beweismittel bestätigt. Danke, Alpha.', { type: 'radio', prio: 4 });
    }
    this.checkComplete();
  }

  yell() {
    if (this.yellCD > 0) return;
    this.yellCD = 1.3;
    const P = this.player;
    this.speech.say(PLAYER_LINES[(Math.random() * PLAYER_LINES.length) | 0], { prio: 4, type: 'player', who: 999, pitch: 0.85, rate: 1.25 });
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const c = n.chestPos(_v);
      const to = _w.subVectors(c, P.eyePos);
      const L = to.length();
      const aimed = to.divideScalar(L).dot(P.viewDir) > Math.cos(0.12 + 0.3 / Math.max(1, L));
      n.onYell(P, aimed);
    }
    this.emitNoise(P.pos.x, P.pos.z, 16, 'yell', null);
  }

  // Glasscheibe oder Glastuer zerbricht: danach durchlaessig und durchgehbar
  breakGlass(hit, pt, dir) {
    const b = hit.box, d = hit.door;
    if (d) { if (d.broken) return; d.broken = true; if (d.glassMesh) d.glassMesh.visible = false; }
    else if (b) {
      if (b.broken) return;
      b.broken = true;
      if (b.glassMesh) b.glassMesh.visible = false;
      b.min[1] = b.max[1] = -100; // aus Kollision/Raycasts nehmen
    } else return;
    this.audio.play('glassbreak', { pos: pt, vol: 1, ref: 4, important: true });
    this.emitNoise(pt.x, pt.z, 18, 'kick', null);
    const L = this.fx.light(pt); const lum = Math.min(1.3, 0.3 + (L.r + L.g + L.b) * 0.5);
    for (let i = 0; i < 70; i++) {
      const s = Math.random() < 0.65 ? 1 : -1;
      this.fx.dust.spawn(pt.x + (Math.random() - 0.5) * 0.8, pt.y + (Math.random() - 0.6) * 0.9, pt.z + (Math.random() - 0.5) * 0.8,
        dir.x * s * (1 + Math.random() * 2.5) + (Math.random() - 0.5), Math.random() * 1.2, dir.z * s * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        0.6 * lum + 0.15, 0.72 * lum + 0.15, 0.78 * lum + 0.15, 0.9, 0.012 + Math.random() * 0.02, 1.6, 0, 9.8, 0.1);
    }
  }

  onPlayerDeath() {
    this.stats.downs = (this.stats.downs || 0) + 1;
    this.hud.centerMsg('BEAMTER VERLETZT', 'Verstärkung rückt in 4 Sekunden am Eingang nach', 0);
    this.respawnT = 4;
    this.speech.say('Beamter verletzt! Verstärkung rückt nach.', { prio: 9, type: 'radio' });
  }

  respawnPlayer() {
    const P = this.player;
    const sp = SPAWNS.player;
    P.pos.x = sp.x; P.pos.z = sp.z; P.yaw = Math.PI + sp.yaw; P.pitch = 0;
    P.vel.set(0, 0, 0); P.health = 100; P.alive = true; P.damageFx = 0; P.suppress = 0;
    P.ammo.carbine = { mag: 30, chamber: 1, mags: [30, 30, 30, 30], mode: 0 };
    P.ammo.pistol = { mag: 15, chamber: 1, mags: [15, 15], mode: 0 };
    P.nades = 3; P.gun = 'carbine'; this.vm.setWeapon('carbine'); this.vm.reload = null; P.reloadState = null;
    for (const n of this.npcs) if (n.type === 'suspect' && n.state === 'combat') { n.threat.visible = false; n.threat.seenT = n.t - 20; n.awareness = 0.4; }
    this.hud.center.classList.add('hidden');
    this.hud.toast('Verstärkung im Einsatz – Beamter ersetzt', 'info');
  }

  // ---------------- Schleife ----------------
  update(dt) {
    this.time += dt;
    const I = this.input;
    const P = this.player;
    this.yellCD -= dt;
    if (this.state !== 'playing') {
      // Menue-Hintergrund: langsame Kamerafahrt vor dem Gebaeude
      const t = this.time * 0.05;
      const cam = this.camera;
      cam.position.set(25 + Math.sin(t * 1.3) * 6, 1.75 + Math.sin(t * 0.7) * 0.15, 13.2);
      cam.lookAt(25 + Math.sin(t * 1.3 + 0.6) * 4, 1.2, 21);
      cam.fov = 60; cam.updateProjectionMatrix();
      this.flashlightLight.visible = false;
      this.vm.root.visible = false;
      if (this.policeR) {
        const ph = Math.floor(this.time * 8.8) % 8;
        this.policeR.intensity = (ph < 3 && ph % 2 === 0) ? 14 : 0; this.policeB.intensity = (ph >= 4 && ph < 7 && ph % 2 === 0) ? 14 : 0;
      }
      I.endFrame();
      return;
    }
    this.vm.root.visible = !this.hideVM;
    if (this.state === 'playing') {
      P.update(dt, I, this.settings);
      if (P.alive) this.updateInteraction(dt);
      if (I.hit('Tab')) this.hud.objectives.classList.remove('hidden');
      if (I.up('Tab')) this.hud.objectives.classList.add('hidden');
      if (this.stats.complete && I.hit('Enter')) this.finish(true);
      if (I.hit('KeyH') && this.officers) {
        const alive = this.officers.filter((o) => o.alive);
        if (this.teamHold) { this.teamHold = null; alive[0] && alive[0].callout('follow', null, 3); this.hud.toast('Team: folgen', 'info'); }
        else { this.teamHold = { x: P.pos.x, z: P.pos.z }; alive[0] && alive[0].callout('hold', null, 3); this.hud.toast('Team: Position halten', 'info'); }
      }
    }
    for (const n of this.npcs) { n.update(dt); if (n.droppedGun) n.updateDroppedGun(dt); }
    for (const d of this.world.doors) d.update(dt, this.time);
    this.updateNades(dt);
    this.fx.update(dt, this.camera, this.renderer.domElement.height);
    // Lichter
    const fl = this.flashlightLight;
    fl.visible = P.flashlight && P.alive;
    if (fl.visible) {
      const cam = this.camera;
      // Position und Richtung aus der tatsaechlichen Lage der Waffe (Lampe am Handschutz)
      const g = this.vm.guns[this.vm.cur].group;
      _v.set(0.038, 0.098, -0.45).applyMatrix4(g.matrix);           // Lampe im Kamera-Raum
      _w.set(0, 0, -1).transformDirection(g.matrix);                  // Laufrichtung im Kamera-Raum
      _v.z = Math.max(_v.z, -0.35);
      fl.position.copy(_v).applyQuaternion(cam.quaternion).add(cam.position);
      _w.applyQuaternion(cam.quaternion);
      fl.target.position.copy(fl.position).addScaledVector(_w, 10);
      fl.target.updateMatrixWorld();
    }
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0; }
    if (this.bangT > 0) { this.bangT -= dt; this.bangLight.intensity = Math.max(0, this.bangT / 0.12) * 400; }
    if (this.policeR) {
      const t = this.time * 2.2;
      const ph = Math.floor(t * 4) % 8;
      const r = (ph < 3 && ph % 2 === 0) ? 1 : 0, b = (ph >= 4 && ph < 7 && ph % 2 === 0) ? 1 : 0;
      this.policeR.intensity = r * 14; this.policeB.intensity = b * 14;
      for (const pb of this.policeBars) { pb.red.color.setRGB(r ? 4 : 0.2, 0.1, 0.1); pb.blue.color.setRGB(0.1, 0.2, b ? 5 : 0.3); }
    }
    if (this.flicker) {
      const f = this.flicker;
      f.t -= dt;
      if (f.t <= 0) { f.on = !f.on; f.t = f.on ? Math.random() * 1.6 + 0.05 : Math.random() * 0.25 + 0.03; }
      f.light.intensity = f.on ? f.base : 0.05;
      if (this.M.lamp_flicker) this.M.lamp_flicker.mat.color.setRGB(f.on ? 2.4 : 0.15, f.on ? 2.3 : 0.15, f.on ? 2.1 : 0.15);
    }
    // Viewmodel-Licht aus Probe
    this.baker.probe(P.eyePos.x, P.eyePos.y, P.eyePos.z, this.vm.probe.value);
    const lum = (this.vm.probe.value.r + this.vm.probe.value.g + this.vm.probe.value.b) / 3;
    this.vm.hemi.intensity = 0.12 + lum * 0.55;
    this.vm.key.intensity = 0.2 + lum * 0.9;
    // Audio-Hoerer
    const cam = this.camera;
    _w.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, P.viewDir, _w);
    this.speech.listener = cam.position;
    // Postprocessing-Parameter
    const u = this.post.u;
    this.flashAmt = Math.max(0, (this.flashAmt || 0) - dt * 0.22);
    u.uFlash.value = Math.min(1, this.flashAmt * 1.4);
    u.uDamage.value = P.damageFx;
    u.uSuppress.value = P.suppress;
    u.uLowHp.value = P.alive ? Math.max(0, (45 - P.health) / 45) : 1;
    // Raumname
    const r = roomAt(P.pos.x, P.pos.z);
    this.roomName = r ? r.name : 'Parkplatz';
    this.hud.update(dt, P, this);
    if (this.endT > 0) { this.endT -= dt; if (this.endT <= 0) this.finish(false); }
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) this.respawnPlayer(); }
    I.endFrame();
  }

  render(dt) { this.post.render(dt); }

  // Testhilfe: Spieler auf Figur ausrichten
  dbgAim(i, zone = 'chest') {
    const n = this.npcs[i], P = this.player;
    const c = zone === 'head' ? n.headPos(new V()) : n.chestPos(new V());
    const e = P.eyePos;
    P.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z));
    P.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
    P.recoilP = 0; P.recoilY = 0; P.bloom = 0;
  }

  finish(success) {
    this.state = 'debrief';
    this.input.unlock();
    this.onFinish && this.onFinish(success, this.debrief(success));
  }

  debrief(success) {
    const S = this.stats, o = this.objectiveState();
    let score = 0;
    score += o.hostages * 15;
    score += S.evidence ? 10 : 0;
    score += S.arrests * 6 + (S.kills - S.penalties) * 3;
    score += o.civs * 5;
    score -= S.penalties * 15 + S.civKilled * 20 + S.hostageKilled * 25 + (S.downs || 0) * 10;
    if (!success) score -= 20;
    if (this.player.alive) score += 10;
    const max = 3 * 15 + 10 + 13 * 6 + 2 * 5 + 10;
    const pct = Math.max(0, score / max);
    const grade = pct > 0.9 ? 'S' : pct > 0.78 ? 'A' : pct > 0.62 ? 'B' : pct > 0.45 ? 'C' : pct > 0.3 ? 'D' : 'F';
    const time = this.time - S.start;
    return {
      grade, score, rows: [
        ['Geiseln befreit', `${o.hostages}/${o.hostagesTotal}`], ['Beweismittel', S.evidence ? 'gesichert' : 'nicht gesichert'],
        ['Verdächtige festgenommen', S.arrests], ['Verdächtige getötet', S.kills], ['Zivilisten gesichert', `${o.civs}/${o.civsTotal}`],
        ['Unerlaubte Gewalt', S.penalties], ['Beamte verletzt (Verstärkung)', S.downs || 0], ['Unbeteiligte getötet', S.civKilled + S.hostageKilled],
        ['Trefferquote', S.shots ? Math.round(S.hits / S.shots * 100) + '%' : '–'], ['Einsatzdauer', `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`],
        ['Punkte', score],
      ],
    };
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }

function exitDist(b, p, d) {
  let tmax = 1e9;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? p.x : a === 1 ? p.y : p.z, dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
    if (Math.abs(dd) < 1e-8) continue;
    const t = ((dd > 0 ? b.max[a] : b.min[a]) - o) / dd;
    if (t < tmax) tmax = t;
  }
  return Math.max(0.005, Math.min(tmax, 3));
}
function closestOnSeg(a, b, p) {
  const ab = new V().subVectors(b, a); const t = Math.max(0, Math.min(1, new V().subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t);
}
function segDist(a, b, p) { return closestOnSeg(a, b, p).distanceTo(p); }
