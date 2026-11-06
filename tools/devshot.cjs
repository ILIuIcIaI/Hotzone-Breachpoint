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
  setTimeout(() => { console.error('devshot timeout'); app.exit(2); }, 110000);
  const win = new BrowserWindow({ width: scen.w || 1280, height: scen.h || 720, show: true, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.setMenuBarVisibility(false); win.setAlwaysOnTop(true, 'screen-saver');
  const logs = [];
  win.webContents.on('console-message', (e, level, msg) => { logs.push(`[${level}] ${msg}`); });
  await win.loadURL(scen.url || 'http://localhost:5180/?test');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = {};
  for (const s of scen.steps) {
    try {
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


