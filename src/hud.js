// HUD-Steuerung (DOM)
import { GUNS } from './player/viewmodel.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.feed = $('feed');
    this.prompt = $('prompt');
    this.progress = $('progress');
    this.objectives = $('objectives');
    this.weapon = $('weapon');
    this.health = $('health');
    this.center = $('center-msg');
    this.compass = $('compass');
    this.dot = $('dot');
    this.flashEl = $('flashwhite');
    this.weaponT = 0;
    this.lastPrompt = '';
    this.sub = document.createElement('div');
    Object.assign(this.sub.style, { position: 'absolute', left: '50%', bottom: '14%', transform: 'translateX(-50%)', fontSize: '16px', textShadow: '0 1px 3px #000', textAlign: 'center', maxWidth: '70%', transition: 'opacity .3s' });
    this.el.appendChild(this.sub);
    this.subT = 0;
    this.hm = document.createElement('div');
    this.hm.innerHTML = '<i></i><i></i><i></i><i></i>';
    Object.assign(this.hm.style, { position: 'absolute', left: '50%', top: '50%', width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px', opacity: '0', transition: 'opacity .08s' });
    [...this.hm.children].forEach((e, i) => Object.assign(e.style, { position: 'absolute', width: '8px', height: '2px', background: '#fff', boxShadow: '0 0 2px #000',
      left: i % 2 ? '17px' : '1px', top: i < 2 ? '5px' : '19px', transform: 'rotate(' + ((i === 0 || i === 3) ? 45 : -45) + 'deg)' }));
    this.el.appendChild(this.hm);
    this.hmT = 0;
  }
  hitMarker(kill, head) {
    this.hmT = kill ? 0.35 : 0.16;
    const c = kill ? '#ff4a3a' : '#ffffff';
    [...this.hm.children].forEach((e) => { e.style.background = c; e.style.width = kill ? '10px' : '8px'; });
    this.hm.style.transform = 'scale(' + (kill ? 1.35 : 1) + ')';
    this.hm.style.opacity = '1';
  }
  show(v) { this.el.classList.toggle('hidden', !v); }

  toast(msg, type = '') {
    const d = document.createElement('div');
    d.textContent = msg;
    if (type) d.className = type;
    this.feed.appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; }, 4200);
    setTimeout(() => d.remove(), 4900);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
  }

  subtitle(text, who) {
    const col = who === 'player' ? '#9fd0ff' : who === 'suspect' ? '#ffb38a' : who === 'hostage' || who === 'civilian' ? '#e9e3c8' : '#ddd';
    const name = who === 'player' ? 'Du' : who === 'suspect' ? 'Verdächtiger' : who === 'hostage' ? 'Geisel' : who === 'civilian' ? 'Zivilist' : 'Funk';
    this.sub.innerHTML = `<span style="color:${col};font-weight:600">${name}:</span> ${text}`;
    this.sub.style.opacity = '1';
    this.subT = 2.8;
  }

  weaponFlash() { this.weaponT = 3.5; }

  setPrompt(text, prog = -1) {
    if (text !== this.lastPrompt) { this.prompt.innerHTML = text || ''; this.lastPrompt = text; }
    this.progress.classList.toggle('hidden', prog < 0);
    if (prog >= 0) this.progress.firstChild.style.width = Math.round(prog * 100) + '%';
  }

  centerMsg(big, small, t = 4) {
    this.center.classList.remove('hidden');
    this.center.querySelector('.big').textContent = big;
    this.center.querySelector('.small').textContent = small || '';
    clearTimeout(this._ct);
    if (t > 0) this._ct = setTimeout(() => this.center.classList.add('hidden'), t * 1000);
  }

  renderObjectives(o) {
    const row = (label, val, done) => `<div class="o ${done ? 'done' : ''}"><span>${label}</span><span>${val}</span></div>`;
    this.objectives.innerHTML = `<h3>EINSATZZIELE · OPERATION KALTE BILANZ</h3>` +
      row('Geiseln befreien', `${o.hostages}/${o.hostagesTotal}`, o.hostages >= o.hostagesTotal) +
      row('Beweismittel sichern', o.evidence ? 'gesichert' : 'offen', o.evidence) +
      row('Verdächtige festnehmen/neutralisieren', `${o.suspects}/${o.suspectsTotal}`, o.suspects >= o.suspectsTotal) +
      row('Zivilisten sichern', `${o.civs}/${o.civsTotal}`, o.civs >= o.civsTotal) +
      `<div class="hint">Festnahmen: ${o.arrests} · Getötet: ${o.kills}${o.penalties ? ` · <span style="color:#e2554a">Regelverstöße: ${o.penalties}</span>` : ''}<br>
      Verdächtige, die sich ergeben, mit <b>F</b> (halten) festnehmen. Zivilisten erst anrufen, dann sichern.</div>`;
  }

  update(dt, P, game) {
    // Waffe
    const D = GUNS[P.gun], A = P.state;
    this.weaponT = Math.max(0, this.weaponT - dt);
    const vis = this.weaponT > 0 || game.vm.reload;
    this.weapon.style.opacity = vis ? '1' : '0.28';
    const r = P.rounds;
    // Magazin-Schaetzung statt exakter Zahl (wie beim Fuehlen am Magazin)
    const frac = A.mag / D.mag;
    const segs = 6;
    let html = '';
    for (let i = 0; i < segs; i++) { const f = frac * segs - i; html += `<span class="${f >= 0.75 ? 'f' : f >= 0.25 ? 'h' : ''}"></span>`; }
    const est = frac > 0.85 ? 'VOLL' : frac > 0.55 ? 'GUT' : frac > 0.3 ? 'HALB' : frac > 0.05 ? 'WENIG' : 'LEER';
    const q = this.weapon;
    q.querySelector('.name').textContent = `${D.name} · ${D.cal}`;
    q.querySelector('.mode').textContent = `${D.modes[A.mode]} · ${est}${A.chamber ? '' : ' · KAMMER LEER'}`;
    q.querySelector('.mag').innerHTML = html;
    q.querySelector('.spare').textContent = `Ersatzmagazine: ${A.mags.length}` + (A.mags.length ? ` (${A.mags.map((m) => m >= D.mag ? 'V' : m > D.mag / 2 ? 'G' : 'H').join(' ')})` : '');
    q.querySelector('.nade').textContent = `Blendgranaten: ${P.nades}  ·  Lampe ${P.flashlight ? 'AN' : 'AUS'}`;
    // Gesundheit
    this.health.querySelector('i').style.width = Math.max(0, P.health) + '%';
    this.health.querySelector('i').style.background = P.health < 35 ? '#e2554a' : P.health < 65 ? '#e8b04a' : '#d6dde6';
    this.health.querySelector('.room').textContent = game.roomName || '';
    // Kompass
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const deg = ((Math.atan2(-fx, fz) * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    this.compass.textContent = `${dirs[Math.round(deg / 45) % 8]}  ${Math.round(deg)}°`;
    this.dot.style.opacity = game.settings.dot && game.vm.ads < 0.3 && !P.sprinting ? '0.8' : '0';
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) this.hm.style.opacity = '0'; }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.sub.style.opacity = '0'; }
  }
}
