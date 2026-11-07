// Entwickler-Werkzeug: nimmt das Spielbild direkt vom Canvas auf und zeichnet das HUD mit hinein.
// (Fensteraufnahmen sind unzuverlaessig, wenn das Fenster nicht im Vordergrund ist.)
export function startRecording(game, opts = {}) {
  const src = game.renderer.domElement;
  const W = opts.width || 1280, H = opts.height || 720;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const hud = () => {
    const sx = W / innerWidth, sy = H / innerHeight;
    x.save(); x.scale(sx, sy);
    x.textBaseline = 'top'; x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 4;
    // Meldungen oben links
    let y = 30;
    for (const d of $('feed').children) {
      const o = parseFloat(getComputedStyle(d).opacity); if (o < 0.05) continue;
      x.globalAlpha = o; x.fillStyle = 'rgba(0,0,0,.45)'; x.font = '14px Segoe UI, sans-serif';
      const w = x.measureText(d.textContent).width + 20; x.fillRect(34, y, w, 26);
      x.fillStyle = d.className === 'bad' ? '#e2554a' : d.className === 'info' ? '#4fb3ff' : '#e8b04a'; x.fillRect(34, y, 2, 26);
      x.fillStyle = '#d9dde3'; x.fillText(d.textContent, 44, y + 5); y += 32;
    }
    x.globalAlpha = 1;
    // Untertitel
    const sub = game.hud.sub;
    if (parseFloat(sub.style.opacity || '0') > 0.05 && sub.textContent) {
      x.font = '16px Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#e8e8e8';
      x.fillText(sub.textContent, innerWidth / 2, innerHeight * 0.86 - 10); x.textAlign = 'left';
    }
    // Zentrale Meldung
    const cm = $('center-msg');
    if (!cm.classList.contains('hidden')) {
      x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.font = '300 34px Segoe UI, sans-serif';
      x.fillText(cm.querySelector('.big').textContent, innerWidth / 2, innerHeight * 0.32);
      x.font = '15px Segoe UI, sans-serif'; x.fillStyle = '#b0b8c2'; x.fillText(cm.querySelector('.small').textContent, innerWidth / 2, innerHeight * 0.32 + 46); x.textAlign = 'left';
    }
    // Hitmarker
    const hm = game.hud.hm; const ho = parseFloat(hm.style.opacity || '0');
    if (ho > 0.05) {
      const red = hm.children[0].style.background.includes('255, 74') || hm.children[0].style.background.includes('#ff4a3a');
      x.strokeStyle = red ? '#ff4a3a' : '#ffffff'; x.lineWidth = 2; const cx = innerWidth / 2, cy = innerHeight / 2, a = red ? 12 : 9, b = 4;
      x.beginPath(); for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.moveTo(cx + dx * b, cy + dy * b); x.lineTo(cx + dx * a, cy + dy * a); } x.stroke();
    }
    // Leben + Raum
    const P = game.player;
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(34, innerHeight - 52, 190, 4);
    x.fillStyle = P.health < 35 ? '#e2554a' : P.health < 65 ? '#e8b04a' : '#d6dde6'; x.fillRect(34, innerHeight - 52, 190 * Math.max(0, P.health) / 100, 4);
    x.fillStyle = '#d9dde3'; x.font = '13px Segoe UI, sans-serif'; x.fillText(game.roomName || '', 34, innerHeight - 40);
    // Waffe
    const wq = $('weapon'); x.textAlign = 'right'; x.globalAlpha = parseFloat(wq.style.opacity || '1');
    x.font = '12px Segoe UI, sans-serif'; x.fillStyle = '#8a929c'; x.fillText(wq.querySelector('.name').textContent, innerWidth - 34, innerHeight - 100);
    x.fillStyle = '#e8b04a'; x.fillText(wq.querySelector('.mode').textContent, innerWidth - 34, innerHeight - 84);
    x.globalAlpha = 1; x.textAlign = 'left';
    x.restore();
  };
  window.__afterRender = () => { x.drawImage(src, 0, 0, W, H); hud(); };
  const tracks = [...cv.captureStream(30).getVideoTracks()];
  try { const dest = game.audio.ctx.createMediaStreamDestination(); game.audio.comp.connect(dest); tracks.push(...dest.stream.getAudioTracks()); } catch (e) { /* ohne Ton */ }
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: opts.bitrate || 3000000, audioBitsPerSecond: 128000 });
  const state = { chunks: [], mime, rec };
  rec.ondataavailable = (e) => state.chunks.push(e.data);
  rec.start(1000);
  return state;
}
