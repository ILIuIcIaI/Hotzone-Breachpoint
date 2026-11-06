// Baut das Windows-Release: schlanker Launcher (WebView2, ohne Chromium-Binaries) + Spieldateien + ZIP.
// Voraussetzung: Windows mit .NET Framework 4 (enthaelt csc.exe). Aufruf: npm run pack
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'release', 'HotzoneBreachpoint');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync(csc, [
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
  '/win32icon:' + path.join(root, 'build', 'icon.ico'),
  '/out:' + path.join(out, 'HotzoneBreachpoint.exe'),
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  path.join(root, 'launcher', 'Launcher.cs'),
], { stdio: 'inherit' });
fs.cpSync(path.join(root, 'dist'), path.join(out, 'game'), { recursive: true });
fs.writeFileSync(path.join(out, 'LIESMICH.txt'), [
  'Hotzone Breachpoint',
  '',
  'Start: HotzoneBreachpoint.exe doppelklicken.',
  'Der Ordner "game" muss neben der .exe liegen.',
  '',
  'Benoetigt die Microsoft-Edge-WebView2-Laufzeit (bei Windows 11 bereits enthalten).',
  'Steuerung: siehe Hauptmenue. F11 = Vollbild, Esc = Pause.',
  '',
].join('\r\n'));
const zip = path.join(root, 'release', 'HotzoneBreachpoint-win64.zip');
fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' });
console.log('Fertig:', zip, (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB');
