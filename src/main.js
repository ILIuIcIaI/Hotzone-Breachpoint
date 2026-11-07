// Einstieg: Menue, Einstellungen, Laden, Hauptschleife.
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('hb_settings') || '{}'); } catch (e) { s = {}; }
  return { quality: s.quality || 'medium', sens: s.sens ?? 1, fov: s.fov ?? 78, vol: s.vol ?? 0.8, voice: s.voice ?? true, dot: s.dot ?? true };
}
function saveSettings(s) { try { localStorage.setItem('hb_settings', JSON.stringify(s)); } catch (e) { /* */ } }

const settings = loadSettings();
if (params.get('q')) settings.quality = params.get('q');
$('opt-quality').value = settings.quality;
$('opt-sens').value = settings.sens; $('opt-fov').value = settings.fov; $('opt-vol').value = settings.vol;
$('opt-voice').value = settings.voice ? '1' : '0'; $('opt-dot').value = settings.dot ? '1' : '0';

const game = new Game($('game'), settings);
window.HB = game;
let loaded = false, started = false;

const startBtn = $('btn-start');
startBtn.disabled = true;
startBtn.textContent = 'Lade Einsatz… 0%';

game.load((p, txt) => {
  startBtn.textContent = p >= 1 ? 'Einsatz starten' : `Lade: ${txt}… ${Math.round(p * 100)}%`;
}).then(() => {
  loaded = true;
  startBtn.disabled = false;
  if (TEST) begin();
  if (params.has('autoplay')) import('./dev/autoplay.js').then((m) => { game.autoplay = new m.AutoPlayer(game); });
  if (params.has('selftest')) {
    // Launcher-Selbsttest: Spiel starten, einen Moment laufen lassen, Canvas-Bild an den lokalen Launcher senden
    begin();
    setTimeout(() => {
      game.render(0.016);
      const img = game.renderer.domElement.toDataURL('image/jpeg', 0.85);
      fetch('/__shot', { method: 'POST', body: img }).catch(() => {});
    }, 5000);
  }
}).catch((e) => { console.error(e); startBtn.textContent = 'Fehler beim Laden – siehe Konsole'; });

function begin() {
  if (!loaded) return;
  game.audio.init();
  game.audio.setVolume(settings.vol);
  if (!game.hum) game.hum = game.audio.loop('hum', 0.05);
  if (!started) {
    started = true;
    game.speech.say('Zentrale an Team: Zugriff freigegeben. Viel Glück.', { prio: 5, type: 'radio', rate: 1.05 });
  }
  game.state = 'playing';
  $('menu').classList.add('hidden');
  $('debrief').classList.add('hidden');
  game.hud.show(true);
  if (!TEST) game.input.lock();
}

startBtn.addEventListener('click', begin);
$('btn-resume').addEventListener('click', begin);
$('btn-restart').addEventListener('click', () => { game.setupMission(); started = false; begin(); });
$('db-restart').addEventListener('click', () => { game.setupMission(); started = false; begin(); });
$('db-menu').addEventListener('click', () => { game.setupMission(); started = false; showMenu(false); $('debrief').classList.add('hidden'); });

function showMenu(paused) {
  game.state = paused ? 'paused' : 'menu';
  $('menu').classList.remove('hidden');
  $('btn-resume').classList.toggle('hidden', !paused);
  $('btn-restart').classList.toggle('hidden', !paused);
  startBtn.classList.toggle('hidden', paused);
}

game.input.onLockChange = (locked) => {
  if (!locked && game.state === 'playing' && !TEST) showMenu(true);
};

game.onFinish = (success, db) => {
  game.hud.show(false);
  $('debrief').classList.remove('hidden');
  $('db-grade').textContent = db.grade;
  $('db-title').textContent = success ? 'EINSATZ ERFOLGREICH' : 'EINSATZ GESCHEITERT';
  $('db-sub').textContent = success ? 'Operation Kalte Bilanz abgeschlossen.' : 'Das Team musste sich zurückziehen.';
  $('db-table').innerHTML = db.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
};

// Einstellungen
const onSet = () => {
  const q = $('opt-quality').value;
  const qChanged = q !== settings.quality;
  settings.sens = +$('opt-sens').value; settings.fov = +$('opt-fov').value; settings.vol = +$('opt-vol').value;
  settings.voice = $('opt-voice').value === '1'; settings.dot = $('opt-dot').value === '1';
  game.speech.enabled = settings.voice;
  game.audio.setVolume(settings.vol);
  settings.quality = q;
  saveSettings(settings);
  if (qChanged) location.reload();
};
for (const id of ['opt-quality', 'opt-sens', 'opt-fov', 'opt-vol', 'opt-voice', 'opt-dot']) $(id).addEventListener('change', onSet);

// Hauptschleife
let last = performance.now(), fpsAcc = 0, fpsN = 0;
const fpsEl = $('fps');
fpsEl.style.display = TEST ? 'block' : 'none';
addEventListener('keydown', (e) => {
  if (e.code === 'F11') {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});
addEventListener('keydown', (e) => { if (e.code === 'F3') fpsEl.style.display = fpsEl.style.display === 'none' ? 'block' : 'none'; });
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (!loaded) return;
  if (game.autoplay && game.state === 'playing') game.autoplay.tick(dt);
  if (game.state === 'playing' || game.state === 'menu') game.update(dt);
  else game.input.endFrame();
  game.render(dt);
  if (window.__afterRender) window.__afterRender();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; }
}
requestAnimationFrame(frame);
