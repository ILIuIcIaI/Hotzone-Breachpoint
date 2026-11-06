// Prozedurale Texturen: alles wird zur Laufzeit erzeugt, keine externen Assets.
import * as THREE from 'three';

// ---------- Rauschen ----------
let seed = 1337;
export function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
export function setSeed(s) { seed = s; }

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// tileable value noise (period p)
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, period, oct = 4, s = 0) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, period * f, s + i * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Erzeugt Albedo + Normalmap aus einer Funktion (u,v) -> {r,g,b,h}
function generate(size, fn, normalStrength = 2.0) {
  const ca = canvas(size, size), cn = canvas(size, size);
  const xa = ca.getContext('2d'), xn = cn.getContext('2d');
  const ia = xa.createImageData(size, size), inn = xn.createImageData(size, size);
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x, y, size);
    const i = (y * size + x);
    ia.data[i * 4] = o[0]; ia.data[i * 4 + 1] = o[1]; ia.data[i * 4 + 2] = o[2]; ia.data[i * 4 + 3] = o[4] !== undefined ? o[4] : 255;
    H[i] = o[3];
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
    const u = H[((y - 1 + size) % size) * size + x], d = H[((y + 1) % size) * size + x];
    let nx = (l - r) * normalStrength, ny = (u - d) * normalStrength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    inn.data[i] = (nx * 0.5 + 0.5) * 255; inn.data[i + 1] = (ny * 0.5 + 0.5) * 255; inn.data[i + 2] = (nz * 0.5 + 0.5) * 255; inn.data[i + 3] = 255;
  }
  xa.putImageData(ia, 0, 0); xn.putImageData(inn, 0, 0);
  return { map: toTex(ca, true), normal: toTex(cn, false) };
}

function toTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

const clamp = (v) => Math.max(0, Math.min(255, v));
function grey(v, tint = [1, 1, 1]) { return [clamp(v * tint[0]), clamp(v * tint[1]), clamp(v * tint[2])]; }

// ---------- Texturdefinitionen ----------
export function buildTextures(quality) {
  const S = quality === 'low' ? 256 : 512;
  const s2 = S / 2;
  const T = {};

  // Teppich (neutral grau, wird per Materialfarbe getoent)
  T.carpet = generate(s2, (x, y, n) => {
    const fine = hash(x, y, 3);
    const blot = fbm(x / n * 4, y / n * 4, 4, 3, 5);
    const loop = (Math.sin(x * 1.7) * Math.sin(y * 1.7)) * 0.5 + 0.5;
    const v = 150 + (fine - 0.5) * 50 + (blot - 0.5) * 40 + loop * 10;
    return [...grey(v), fine * 0.6 + loop * 0.4];
  }, 1.4);

  // Bodenfliesen 2x2 (0.6 m) mit Fugen, Terrazzo-Sprenkel
  T.tile = generate(S, (x, y, n) => {
    const cell = n / 2;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const gx = x % cell, gy = y % cell;
    const grout = (gx < 2 || gy < 2) ? 1 : 0;
    const tint = 0.92 + hash(cx, cy, 9) * 0.12;
    const speck = hash(x, y, 11) > 0.985 ? -60 : 0;
    const cloud = fbm(x / n * 6, y / n * 6, 6, 3, 2);
    let v = (205 + (cloud - 0.5) * 30 + speck) * tint;
    if (grout) v = 95;
    return [...grey(v, [1, 0.99, 0.95]), grout ? 0 : 0.6 + cloud * 0.1];
  }, 3);

  // Beton
  T.concrete = generate(S, (x, y, n) => {
    const b = fbm(x / n * 5, y / n * 5, 5, 5, 21);
    const pit = hash(x, y, 4) > 0.993 ? -50 : 0;
    const v = 150 + (b - 0.5) * 70 + pit + (hash(x, y, 8) - 0.5) * 18;
    return [...grey(v), b + (pit ? -0.3 : 0)];
  }, 2.2);

  // Asphalt mit Koernung
  T.asphalt = generate(S, (x, y, n) => {
    const g = hash(x, y, 31);
    const b = fbm(x / n * 3, y / n * 3, 3, 4, 7);
    const v = 52 + (g - 0.5) * 38 + (b - 0.5) * 30 + (g > 0.97 ? 40 : 0);
    return [...grey(v), g * 0.5 + b * 0.5];
  }, 2.5);

  // Wandfarbe (leichte Struktur)
  T.paint = generate(s2, (x, y, n) => {
    const b = fbm(x / n * 8, y / n * 8, 8, 4, 41);
    const f = hash(x, y, 2);
    const v = 222 + (b - 0.5) * 14 + (f - 0.5) * 6;
    return [...grey(v), b * 0.6 + f * 0.15];
  }, 1.1);

  // Deckenplatten 2x2 (0.6 m) mit T-Schiene
  T.ceiling = generate(S, (x, y, n) => {
    const cell = n / 2;
    const gx = x % cell, gy = y % cell;
    const rail = (gx < 4 || gy < 4) ? 1 : 0;
    const hole = hash(x >> 1, y >> 1, 77) > 0.93 ? -25 : 0;
    const b = fbm(x / n * 7, y / n * 7, 7, 3, 12);
    let v = 215 + hole + (b - 0.5) * 12;
    if (rail) v = 236;
    return [...grey(v), rail ? 1 : 0.5 + hole / 100];
  }, 2.5);

  // Holz (Maserung)
  T.wood = generate(S, (x, y, n) => {
    const w = fbm(x / n * 2, y / n * 16, 2, 4, 51);
    const ring = Math.sin((x / n) * 60 + w * 14) * 0.5 + 0.5;
    const v = 120 + ring * 50 + (hash(x, y, 1) - 0.5) * 10;
    return [clamp(v * 1.15), clamp(v * 0.82), clamp(v * 0.55), ring * 0.4];
  }, 0.8);

  // Gebuersteter Stahl
  T.metal = generate(s2, (x, y, n) => {
    const streak = fbm(x / n * 64, y / n * 2, 64, 3, 61);
    const v = 160 + (streak - 0.5) * 50 + (hash(x, y, 6) - 0.5) * 10;
    return [...grey(v), streak * 0.3];
  }, 0.6);

  // Stoff (Trennwaende)
  T.fabric = generate(s2, (x, y, n) => {
    const weave = ((x % 4 < 2) ^ (y % 4 < 2)) ? 1 : 0;
    const b = fbm(x / n * 6, y / n * 6, 6, 3, 71);
    const v = 160 + weave * 18 + (b - 0.5) * 30 + (hash(x, y, 5) - 0.5) * 14;
    return [...grey(v), weave * 0.5 + b * 0.3];
  }, 1.8);

  // Fassade: Betonplatten mit Fugen (3 m Raster)
  T.facade = generate(S, (x, y, n) => {
    const joint = (x % (n / 2) < 3 || y % (n / 3) < 3) ? 1 : 0;
    const b = fbm(x / n * 5, y / n * 5, 5, 5, 81);
    const streak = fbm(x / n * 20, y / n * 1.5, 20, 2, 83);
    let v = 150 + (b - 0.5) * 40 - streak * 25;
    if (joint) v = 70;
    return [...grey(v, [1, 0.98, 0.94]), joint ? 0 : 0.5 + b * 0.3];
  }, 2.5);

  // Kunststoff / Lack (fast glatt)
  T.plastic = generate(64, (x, y) => {
    const f = hash(x, y, 91);
    return [...grey(200 + (f - 0.5) * 8), f * 0.1];
  }, 0.5);

  // Server-Front: Lueftungsraster + LEDs (Albedo); LEDs separat als Emissive
  const srv = canvas(128, 256), sx = srv.getContext('2d');
  sx.fillStyle = '#16191d'; sx.fillRect(0, 0, 128, 256);
  for (let u = 0; u < 12; u++) {
    const y0 = 8 + u * 20;
    sx.fillStyle = '#23272d'; sx.fillRect(6, y0, 116, 16);
    sx.fillStyle = '#0b0c0e';
    for (let k = 0; k < 18; k++) sx.fillRect(10 + k * 5, y0 + 4, 2, 9);
  }
  T.server = { map: toTex(srv, true) };
  const srvE = canvas(128, 256), se = srvE.getContext('2d');
  se.fillStyle = '#000'; se.fillRect(0, 0, 128, 256);
  for (let u = 0; u < 12; u++) {
    const y0 = 8 + u * 20;
    for (let k = 0; k < 4; k++) {
      se.fillStyle = hash(u, k, 3) > 0.3 ? (hash(u, k, 4) > 0.8 ? '#ffae3a' : '#3cff7a') : '#1f6dff';
      se.fillRect(104 + (k % 2) * 8, y0 + 3 + Math.floor(k / 2) * 6, 3, 3);
    }
  }
  T.serverEmissive = toTex(srvE, true);

  // Monitor-Bildschirm
  const scr = canvas(128, 80), sc = scr.getContext('2d');
  sc.fillStyle = '#0a1a2c'; sc.fillRect(0, 0, 128, 80);
  sc.fillStyle = '#1f4f80'; sc.fillRect(0, 0, 128, 8);
  for (let i = 0; i < 9; i++) { sc.fillStyle = `rgba(150,200,255,${0.25 + hash(i, 1, 1) * 0.4})`; sc.fillRect(8, 14 + i * 7, 30 + hash(i, 2, 2) * 80, 3); }
  T.screen = toTex(scr, true);

  // Ueberwachungsmonitor (Kamerabild, gruenlich)
  const cam = canvas(128, 80), cc = cam.getContext('2d');
  cc.fillStyle = '#071108'; cc.fillRect(0, 0, 128, 80);
  for (let i = 0; i < 400; i++) { cc.fillStyle = `rgba(120,255,140,${hash(i, 3, 9) * 0.25})`; cc.fillRect(hash(i, 1, 9) * 128, hash(i, 2, 9) * 80, 2, 1); }
  cc.strokeStyle = 'rgba(140,255,160,.5)'; cc.strokeRect(20, 20, 50, 40); cc.strokeRect(70, 30, 40, 30);
  cc.fillStyle = 'rgba(160,255,170,.8)'; cc.font = '9px monospace'; cc.fillText('CAM 04  REC', 4, 10);
  T.camscreen = toTex(cam, true);

  // Einschussloch (RGBA)
  const bh = canvas(64, 64), b = bh.getContext('2d');
  const g1 = b.createRadialGradient(32, 32, 0, 32, 32, 30);
  g1.addColorStop(0, 'rgba(5,5,5,1)'); g1.addColorStop(0.16, 'rgba(10,10,10,1)'); g1.addColorStop(0.22, 'rgba(40,38,35,.9)');
  g1.addColorStop(0.45, 'rgba(60,55,50,.35)'); g1.addColorStop(1, 'rgba(60,55,50,0)');
  b.fillStyle = g1; b.fillRect(0, 0, 64, 64);
  b.strokeStyle = 'rgba(20,20,20,.55)'; b.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, l = 10 + rand() * 16;
    b.beginPath(); b.moveTo(32, 32); b.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); b.stroke();
  }
  T.bullethole = toTex(bh, true);

  // Blutspritzer (RGBA)
  const bl = canvas(128, 128), bc = bl.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const r = 4 + rand() * 18, a = rand() * Math.PI * 2, d = rand() * 40;
    bc.fillStyle = `rgba(${70 + rand() * 30},4,6,${0.5 + rand() * 0.4})`;
    bc.beginPath(); bc.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r * (1 - d / 70), 0, Math.PI * 2); bc.fill();
  }
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, d = 30 + rand() * 30;
    bc.fillStyle = 'rgba(80,5,6,.8)';
    bc.beginPath(); bc.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + rand() * 2.5, 0, Math.PI * 2); bc.fill();
  }
  T.blood = toTex(bl, true);

  // Weicher Partikel
  const pd = canvas(64, 64), p = pd.getContext('2d');
  const g2 = p.createRadialGradient(32, 32, 0, 32, 32, 32);
  g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(0.4, 'rgba(255,255,255,.5)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
  p.fillStyle = g2; p.fillRect(0, 0, 64, 64);
  T.soft = toTex(pd, true);

  // Muendungsfeuer (Stern)
  const mf = canvas(128, 128), m = mf.getContext('2d');
  m.translate(64, 64);
  const g3 = m.createRadialGradient(0, 0, 0, 0, 0, 60);
  g3.addColorStop(0, 'rgba(255,250,230,1)'); g3.addColorStop(0.2, 'rgba(255,200,110,.9)'); g3.addColorStop(0.6, 'rgba(255,120,40,.25)'); g3.addColorStop(1, 'rgba(255,90,20,0)');
  for (let i = 0; i < 7; i++) {
    m.rotate((Math.PI * 2) / 7 + rand() * 0.3);
    m.fillStyle = g3; m.beginPath(); m.moveTo(-6, 0); m.lineTo(0, -60 * (0.6 + rand() * 0.4)); m.lineTo(6, 0); m.fill();
  }
  m.fillStyle = g3; m.beginPath(); m.arc(0, 0, 24, 0, Math.PI * 2); m.fill();
  T.muzzle = toTex(mf, true);

  // Exit-Schild
  const ex = canvas(128, 48), e = ex.getContext('2d');
  e.fillStyle = '#0f8f3a'; e.fillRect(0, 0, 128, 48);
  e.fillStyle = '#eaffef'; e.font = 'bold 26px sans-serif'; e.fillText('NOTAUSGANG', 4, 33);
  T.exit = toTex(ex, true);

  // Firmenlogo fuer Lobby
  const lg = canvas(256, 64), l = lg.getContext('2d');
  l.fillStyle = '#20252b'; l.fillRect(0, 0, 256, 64);
  l.fillStyle = '#c9a65a'; l.font = '300 34px sans-serif'; l.fillText('MERIDIAN', 18, 42);
  l.fillStyle = '#8b939c'; l.font = '14px sans-serif'; l.fillText('LOGISTIK', 192, 42);
  T.logo = toTex(lg, true);

  // Polizeischriftzug fuer Van
  const pv = canvas(256, 64), pc = pv.getContext('2d');
  pc.fillStyle = '#16191e'; pc.fillRect(0, 0, 256, 64);
  pc.fillStyle = '#e6e9ee'; pc.font = 'bold 40px sans-serif'; pc.fillText('POLIZEI', 40, 46);
  T.policeText = toTex(pv, true);

  return T;
}
