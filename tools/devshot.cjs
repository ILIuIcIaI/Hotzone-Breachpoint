// Entwickler-Werkzeug: startet das Spiel in Electron, fuehrt Szenarien aus, speichert Screenshots.
// Aufruf: npx electron tools/devshot.cjs <szenario.json> <ausgabeordner>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [scenFile, outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('devshot.cjs'));
const scen = JSON.parse(fs.readFileSync(scenFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
  setTimeout(() => { console.error('devshot timeout'); app.exit(2); }, scen.timeout || 110000);
  const off = scen.visible !== true; // Standard: unsichtbar (Offscreen), nichts erscheint auf dem Desktop
  const win = new BrowserWindow({ width: scen.w || 1280, height: scen.h || 720, show: !off, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: off } });
  if (off) win.webContents.setFrameRate(60);
  win.webContents.setAudioMuted(true); // Tests sind immer stumm
  win.setMenuBarVisibility(false); if (!off) win.setAlwaysOnTop(true, 'screen-saver');
  const logs = [];
  win.webContents.on('console-message', (e, level, msg) => { logs.push(`[${level}] ${msg}`); });
  await win.loadURL(scen.url || 'http://localhost:5180/?test');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = {};
  for (const s of scen.steps) {
    try {
      if (s.recordCanvas) {
        result.rec = await win.webContents.executeJavaScript(`(async()=>{ const m = await import('/src/dev/recorder.js'); window.REC = m.startRecording(HB); return { src: 'canvas', mime: REC.mime }; })()`);
      }
      if (s.recordStart) {
        const id = win.getMediaSourceId();
        result.rec = await win.webContents.executeJavaScript(`(async()=>{
          let v, src='window';
          try { v = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ mandatory:{ chromeMediaSource:'desktop', chromeMediaSourceId:'${id}', maxWidth:1280, maxHeight:720, maxFrameRate:30 } } }); }
          catch(e) { v = HB.renderer.domElement.captureStream(30); src='canvas:'+e.message; }
          const tracks = [...v.getVideoTracks()];
          try { const dest = HB.audio.ctx.createMediaStreamDestination(); HB.audio.comp.connect(dest); tracks.push(...dest.stream.getAudioTracks()); } catch(e) {}
          const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
          const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 2600000, audioBitsPerSecond: 128000 });
          window.REC = { chunks: [], mime, rec }; rec.ondataavailable = (e) => REC.chunks.push(e.data); rec.start(1000);
          return { src, mime };
        })()`);
      }
      if (s.recordStop) {
        const meta = await win.webContents.executeJavaScript(`(async()=>{
          await new Promise((r)=>{ REC.rec.onstop=r; REC.rec.stop(); });
          const blob = new Blob(REC.chunks, { type: REC.mime }); REC.buf = new Uint8Array(await blob.arrayBuffer());
          return { size: REC.buf.length, mime: REC.mime };
        })()`);
        const parts = [];
        for (let off = 0; off < meta.size; off += 4 * 1024 * 1024) {
          const b64 = await win.webContents.executeJavaScript(`(()=>{ const a = REC.buf.subarray(${off}, ${off} + 4194304); let s=''; for (let i=0;i<a.length;i+=32768) s += String.fromCharCode.apply(null, a.subarray(i,i+32768)); return btoa(s); })()`);
          parts.push(Buffer.from(b64, 'base64'));
        }
        const file = path.join(outDir, s.recordStop + (meta.mime.includes('mp4') ? '.mp4' : '.webm'));
        fs.writeFileSync(file, Buffer.concat(parts));
        result.video = { file, ...meta };
      }
      if (s.js) { const r = await win.webContents.executeJavaScript(`(async()=>{${s.js}})()`); if (s.key) result[s.key] = r; }
      if (s.wait) await sleep(s.wait);
      if (s.shot) {
        let ok = false;
        try { const img = await win.webContents.capturePage(); if (!img.isEmpty()) { fs.writeFileSync(path.join(outDir, s.shot), img.toJPEG(88)); ok = true; } } catch (e) { /* Fallback */ }
        if (!ok) {
          const data = await win.webContents.executeJavaScript(`(()=>{HB.render(0.016); return HB.renderer.domElement.toDataURL('image/jpeg',0.88);})()`);
          fs.writeFileSync(path.join(outDir, s.shot), Buffer.from(data.split(',')[1], 'base64'));
        }
      }
    } catch (e) { result['err_' + (s.key || s.shot || 'step')] = String(e); }
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ result, logs: logs.slice(-80) }, null, 2));
  app.quit();
});


