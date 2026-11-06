// Erzeugt build/icon.ico (256x256, 32 Bit) prozedural: dunkles Abzeichen mit orangefarbenem Visier.
const fs = require('fs');
const path = require('path');
const S = 256;
const px = new Uint8Array(S * S * 4);
const set = (x, y, r, g, b, a) => { const i = (y * S + x) * 4; px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a; };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const cx = x - 127.5, cy = y - 127.5;
  // abgerundetes Quadrat
  const q = Math.max(Math.abs(cx), Math.abs(cy));
  const rr = 116, rad = 34;
  const dx = Math.max(0, Math.abs(cx) - (rr - rad)), dy = Math.max(0, Math.abs(cy) - (rr - rad));
  const inside = Math.hypot(dx, dy) <= rad;
  if (!inside) { set(x, y, 0, 0, 0, 0); continue; }
  const d = Math.hypot(cx, cy);
  let r = 14 + (1 - y / S) * 14, g = 19 + (1 - y / S) * 16, b = 26 + (1 - y / S) * 20;
  // Visierring
  const ring = Math.abs(d - 70);
  if (ring < 7) { r = 232; g = 176; b = 74; }
  // Fadenkreuz-Striche mit Luecke
  if ((Math.abs(cx) < 5 && Math.abs(cy) > 26 && Math.abs(cy) < 100) || (Math.abs(cy) < 5 && Math.abs(cx) > 26 && Math.abs(cx) < 100)) { r = 232; g = 176; b = 74; }
  // Mittelpunkt
  if (d < 9) { r = 255; g = 90; b = 60; }
  // Rand
  if (Math.hypot(dx, dy) > rad - 3 || q > rr - 3) { r = Math.min(255, r + 25); g = Math.min(255, g + 25); b = Math.min(255, b + 25); }
  set(x, y, r | 0, g | 0, b | 0, 255);
}
// BMP/DIB fuer ICO (bottom-up) + AND-Maske
const header = Buffer.alloc(40);
header.writeUInt32LE(40, 0); header.writeInt32LE(S, 4); header.writeInt32LE(S * 2, 8);
header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
header.writeUInt32LE(S * S * 4, 20);
const pix = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) Buffer.from(px.buffer, (S - 1 - y) * S * 4, S * 4).copy(pix, y * S * 4);
const mask = Buffer.alloc((S / 8) * S);
const img = Buffer.concat([header, pix, mask]);
const dir = Buffer.alloc(6 + 16);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
dir.writeUInt8(0, 6); dir.writeUInt8(0, 7); dir.writeUInt8(0, 8); dir.writeUInt8(0, 9);
dir.writeUInt16LE(1, 10); dir.writeUInt16LE(32, 12); dir.writeUInt32LE(img.length, 14); dir.writeUInt32LE(22, 18);
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([dir, img]));
console.log('icon.ico geschrieben');
