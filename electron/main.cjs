// Hotzone Breachpoint – Desktop-Huelle (Electron)
// Startet einen kleinen lokalen Dateiserver (nur 127.0.0.1) fuer den gebauten Spielordner
// und oeffnet das Spiel in einem eigenen Fenster.
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function create() {
  const win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#05070a', autoHideMenuBar: true,
    title: 'Hotzone Breachpoint', show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  const devUrl = process.env.HB_DEV_URL;
  if (devUrl) { win.loadURL(devUrl); return; }
  const root = path.join(__dirname, '..', 'dist');
  const port = await serve(root);
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  // Selbsttest (nur wenn ausdruecklich per Umgebungsvariable angefordert): Fensterinhalt speichern und beenden
  const selftest = process.env.HB_SELFTEST;
  if (selftest) {
    win.show();
    setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(selftest, img.toJPEG(85)); } catch (e) { fs.writeFileSync(selftest + '.err', String(e)); }
      app.quit();
    }, 12000);
  }
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
