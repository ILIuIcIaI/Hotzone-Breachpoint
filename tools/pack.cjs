// Baut die Windows-Version (Ordner mit HotzoneBreachpoint.exe) nach release/.
const { packager } = require('@electron/packager');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const out = await packager({
    dir: root,
    name: 'Hotzone Breachpoint',
    executableName: 'HotzoneBreachpoint',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'release'),
    overwrite: true,
    asar: true,
    prune: false,
    icon: path.join(root, 'build', 'icon.ico'),
    appVersion: require('../package.json').version,
    win32metadata: { ProductName: 'Hotzone Breachpoint', FileDescription: 'Hotzone Breachpoint', CompanyName: 'Hotzone Breachpoint', InternalName: 'HotzoneBreachpoint', OriginalFilename: 'HotzoneBreachpoint.exe' },
    ignore: [
      /^\/src($|\/)/, /^\/release($|\/)/, /^\/tools($|\/)/, /^\/build($|\/)/, /^\/docs($|\/)/, /^\/\.claude($|\/)/, /^\/\.git($|\/)/,
      /^\/node_modules($|\/)/, /^\/index\.html$/, /^\/vite\.config\.js$/, /^\/README\.md$/, /^\/\.gitignore$/, /\.jsonl$/, /\.env/,
    ],
  });
  console.log('Fertig:', out.join(', '));
})().catch((e) => { console.error(e); process.exit(1); });

