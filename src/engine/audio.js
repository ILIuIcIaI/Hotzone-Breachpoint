// Prozedurale Audio-Engine: alle Sounds werden synthetisiert. 3D-Positionierung, Hall, Verdeckung.
const SR = 44100;

function buf(ctx, sec, fn, ch = 1) {
  const n = Math.floor(sec * SR);
  const b = ctx.createBuffer(ch, n, SR);
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    fn(d, n, c);
  }
  return b;
}
const noise = () => Math.random() * 2 - 1;
function lp(d, f) { // One-Pole Tiefpass in-place
  const a = Math.exp(-2 * Math.PI * f / SR); let y = 0;
  for (let i = 0; i < d.length; i++) { y = d[i] * (1 - a) + y * a; d[i] = y; }
}
function hp(d, f) { const a = Math.exp(-2 * Math.PI * f / SR); let y = 0, x0 = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; y = a * (y + x - x0); x0 = x; d[i] = y; } }
function norm(d, peak = 0.95) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; }
function soft(d, k = 1.5) { for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k); }

// Schuss komplett aus gefiltertem Rauschen (keine Sinustoene -> kein "Klingeln"):
// Knall (Ueberschall/Muendung), Druckwelle, tiefer Wumms, fruehe Wandechos, diffuser Nachhall, Verschlussklack.
function gunshot(ctx, o) {
  return buf(ctx, o.len, (d, n) => {
    const crack = new Float32Array(n), blast = new Float32Array(n), body = new Float32Array(n), low = new Float32Array(n), tail = new Float32Array(n), mech = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      crack[i] = t < o.crack ? noise() * Math.pow(1 - t / o.crack, 2) : 0;
      blast[i] = noise() * Math.exp(-t / o.blast) * Math.min(1, t / 0.0004);
      body[i] = noise() * Math.exp(-t / (o.blast * 2.6));
      low[i] = noise() * Math.exp(-t / o.lowT) * Math.min(1, t / 0.002);
      tail[i] = noise() * Math.exp(-t / o.tail) * Math.min(1, t / 0.012);
      const tm = t - o.mechT;
      mech[i] = tm > 0 ? noise() * Math.exp(-tm / 0.0035) : 0;
    }
    hp(crack, 3000);
    lp(blast, o.blastF); hp(blast, 250);
    lp(body, 1100); lp(body, 1100);
    lp(low, 160); lp(low, 160); lp(low, 160);
    lp(tail, o.tailF); lp(tail, o.tailF);
    hp(mech, 1800); lp(mech, 6000);
    // Lautheit der tiefen Komponente angleichen (Tiefpass frisst Energie)
    let ml = 0; for (let i = 0; i < n; i++) ml = Math.max(ml, Math.abs(low[i]));
    const lk = ml > 0 ? o.low / ml : 0;
    for (let i = 0; i < n; i++) d[i] = crack[i] * 0.8 + blast[i] * 1.4 + body[i] * 1.1 + low[i] * lk + tail[i] * o.tailA + mech[i] * o.mech;
    // fruehe Reflexionen (Wand, Boden, Decke)
    const src = Float32Array.from(d);
    for (const [ms, g] of o.echo) {
      const off = Math.floor(ms / 1000 * SR);
      for (let i = 0; i + off < n; i++) d[i + off] += src[i] * g;
    }
    soft(d, 2.2); norm(d, 0.95);
  });
}

function click(ctx, o) {
  return buf(ctx, o.len, (d, n) => {
    for (const ev of o.events) {
      const s = Math.floor(ev.t * SR);
      for (let i = 0; i < n - s; i++) {
        const t = i / SR;
        let v = noise() * Math.exp(-t / ev.nt) * ev.na;
        for (const [f, a, tau] of ev.tones) v += Math.sin(2 * Math.PI * f * t) * a * Math.exp(-t / tau);
        d[s + i] += v;
      }
    }
    hp(d, 300); norm(d, o.peak ?? 0.8);
  });
}

function step(ctx, kind) {
  // Ferse + Abrollen, nur gefiltertes Rauschen (kein Ton)
  return buf(ctx, 0.25, (d, n) => {
    const heel = new Float32Array(n), roll = new Float32Array(n), grit = new Float32Array(n);
    const rollT = 0.045 + Math.random() * 0.02;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      heel[i] = noise() * Math.exp(-t / 0.014) * Math.min(1, t / 0.002);
      const tr = t - rollT;
      roll[i] = tr > 0 ? noise() * Math.exp(-tr / 0.03) * Math.min(1, tr / 0.01) * 0.5 : 0;
      grit[i] = noise() * Math.exp(-((t - 0.04) ** 2) / 0.0006);
    }
    lp(heel, kind === 'carpet' ? 420 : kind === 'tile' ? 1800 : 1100); lp(heel, kind === 'carpet' ? 420 : 1800);
    lp(roll, kind === 'carpet' ? 600 : 1400);
    hp(grit, 2500); lp(grit, 6000);
    const g = kind === 'concrete' || kind === 'asphalt' ? 0.18 : kind === 'tile' ? 0.05 : 0;
    for (let i = 0; i < n; i++) d[i] = heel[i] + roll[i] + grit[i] * g;
    norm(d, kind === 'carpet' ? 0.45 : 0.6);
  });
}

function impact(ctx, kind) {
  const len = kind === 'glass' ? 0.6 : 0.3;
  return buf(ctx, len, (d, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let v = 0;
      switch (kind) {
        case 'metal':
          v = noise() * Math.exp(-t / 0.006) + (Math.sin(2 * Math.PI * 1850 * t) * 0.3 + Math.sin(2 * Math.PI * 3130 * t) * 0.2) * Math.exp(-t / 0.025) + noise() * Math.exp(-t / 0.05) * 0.2;
          break;
        case 'glass': {
          v = noise() * Math.exp(-t / 0.01) * 1.2;
          for (let k = 0; k < 5; k++) { const tk = 0.02 + k * 0.045; if (t > tk) v += Math.sin(2 * Math.PI * (3000 + k * 900) * (t - tk)) * Math.exp(-(t - tk) / 0.03) * 0.4 + noise() * Math.exp(-(t - tk) / 0.01) * 0.4; }
          break;
        }
        case 'wood': v = noise() * Math.exp(-t / 0.012) + noise() * Math.exp(-t / 0.05) * 0.35; break;
        case 'flesh': v = noise() * Math.exp(-t / 0.035) * Math.min(1, t / 0.002); break;
        case 'drywall': v = noise() * Math.exp(-t / 0.02) + noise() * Math.exp(-t / 0.09) * 0.25; break;
        case 'soft': v = noise() * Math.exp(-t / 0.02) * 0.6; break;
        case 'plastic': v = noise() * Math.exp(-t / 0.008) + noise() * Math.exp(-t / 0.03) * 0.3; break;
        default: v = noise() * Math.exp(-t / 0.014) + noise() * Math.exp(-t / 0.12) * 0.22;
      }
      d[i] = v;
    }
    if (kind === 'flesh' || kind === 'soft') lp(d, 1400);
    if (kind === 'concrete' || kind === 'drywall') lp(d, 3500);
    norm(d, 0.8);
  });
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.8;
    this.occlusion = null; // fn(pos) -> bool
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.voices = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: SR });
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.knee.value = 8; this.comp.ratio.value = 4; this.comp.attack.value = 0.002; this.comp.release.value = 0.15;
    this.master.connect(this.comp).connect(ctx.destination);
    this.duck = ctx.createGain(); this.duck.connect(this.master);    // fuer Blendgranate/Tinnitus
    this.dry = ctx.createGain(); this.dry.connect(this.duck);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeIR(1.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain).connect(this.duck);
    this.duckFilter = null;
    this.generate();
  }

  makeIR(sec) {
    const ctx = this.ctx;
    return buf(ctx, sec, (d, n, c) => {
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        d[i] = noise() * Math.pow(1 - t / sec, 2.2) * Math.exp(-t / 0.35);
      }
      // fruehe Reflexionen (Flur)
      for (let k = 0; k < 8; k++) { const p = Math.floor((0.008 + k * 0.011 + c * 0.003) * SR); if (p < n) d[p] += (0.6 - k * 0.06) * (k % 2 ? -1 : 1); }
      lp(d, 3800);
    }, 2);
  }

  generate() {
    const ctx = this.ctx, B = this.buffers;
    const ECHO = [[6.5, 0.38], [12, 0.26], [19, 0.2], [31, 0.13], [47, 0.08]];
    B.rifle = [0, 1, 2].map((k) => gunshot(ctx, { len: 1.0, crack: 0.0025, blast: 0.009 + k * 0.001, blastF: 5200 - k * 400, lowT: 0.065, low: 0.95, tail: 0.32, tailF: 850, tailA: 0.4, mechT: 0.028, mech: 0.14, echo: ECHO }));
    B.pistol = [0, 1].map((k) => gunshot(ctx, { len: 0.8, crack: 0.002, blast: 0.007 + k * 0.001, blastF: 6500, lowT: 0.045, low: 0.6, tail: 0.24, tailF: 1100, tailA: 0.33, mechT: 0.022, mech: 0.2, echo: ECHO }));
    B.smg = [0, 1].map((k) => gunshot(ctx, { len: 0.8, crack: 0.002, blast: 0.008, blastF: 5800, lowT: 0.05, low: 0.7, tail: 0.26, tailF: 950, tailA: 0.35, mechT: 0.024, mech: 0.16, echo: ECHO }));
    B.dryfire = click(ctx, { len: 0.1, events: [{ t: 0, nt: 0.002, na: 1, tones: [[3200, 0.4, 0.01]] }] });
    B.magout = click(ctx, { len: 0.25, events: [{ t: 0, nt: 0.004, na: 1, tones: [[1800, 0.5, 0.02], [950, 0.4, 0.03]] }, { t: 0.06, nt: 0.01, na: 0.4, tones: [[600, 0.3, 0.04]] }] });
    B.magin = click(ctx, { len: 0.25, events: [{ t: 0, nt: 0.006, na: 0.6, tones: [[700, 0.4, 0.03]] }, { t: 0.05, nt: 0.003, na: 1.2, tones: [[2500, 0.6, 0.015], [1400, 0.5, 0.02]] }] });
    B.bolt = click(ctx, { len: 0.35, events: [{ t: 0, nt: 0.004, na: 1, tones: [[1500, 0.5, 0.02]] }, { t: 0.12, nt: 0.003, na: 1.4, tones: [[2900, 0.6, 0.02], [1200, 0.6, 0.04], [520, 0.4, 0.06]] }] });
    B.select = click(ctx, { len: 0.1, events: [{ t: 0, nt: 0.002, na: 0.8, tones: [[4200, 0.5, 0.008]] }], peak: 0.5 });
    B.light = click(ctx, { len: 0.1, events: [{ t: 0, nt: 0.002, na: 0.6, tones: [[5000, 0.4, 0.006]] }], peak: 0.4 });
    B.raise = click(ctx, { len: 0.3, events: [{ t: 0, nt: 0.05, na: 0.3, tones: [] }, { t: 0.1, nt: 0.004, na: 0.5, tones: [[1700, 0.3, 0.02]] }], peak: 0.4 });
    B.pin = click(ctx, { len: 0.3, events: [{ t: 0, nt: 0.003, na: 1, tones: [[3500, 0.5, 0.03], [5200, 0.3, 0.04]] }, { t: 0.08, nt: 0.002, na: 0.6, tones: [[6200, 0.4, 0.05]] }], peak: 0.6 });
    B.cuff = click(ctx, { len: 0.6, events: Array.from({ length: 9 }, (_, i) => ({ t: i * 0.045, nt: 0.002, na: 0.8, tones: [[2800 + i * 60, 0.3, 0.006]] })), peak: 0.6 });
    for (const k of ['carpet', 'tile', 'concrete', 'asphalt']) B['step_' + k] = [0, 1, 2].map(() => step(ctx, k));
    for (const k of ['concrete', 'drywall', 'wood', 'metal', 'glass', 'flesh', 'soft', 'plastic']) B['imp_' + k] = [0, 1].map(() => impact(ctx, k));
    B.casing = [0, 1, 2].map((v) => buf(ctx, 0.5, (d, n) => {
      for (const [tt, a] of [[0, 1], [0.07 + v * 0.02, 0.5], [0.15 + v * 0.03, 0.25]]) {
        const s = Math.floor(tt * SR);
        for (let i = 0; i < n - s; i++) { const t = i / SR; d[s + i] += (noise() * 0.8 + Math.sin(2 * Math.PI * (5200 + v * 400) * t) * 0.25) * Math.exp(-t / 0.006) * a; }
      }
      hp(d, 2500);
      norm(d, 0.22);
    }));
    B.door = [buf(ctx, 0.9, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 260 + Math.sin(t * 9) * 60 + t * 120;
        ph += 2 * Math.PI * f / SR;
        const saw = ((ph / (2 * Math.PI)) % 1) * 2 - 1;
        d[i] = saw * 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.7)) * (0.5 + 0.5 * Math.sin(t * 37)) + (t < 0.02 ? noise() * (1 - t / 0.02) * 0.8 : 0);
      }
      lp(d, 1800); norm(d, 0.5);
    })];
    B.doorclose = [click(ctx, { len: 0.4, events: [{ t: 0, nt: 0.03, na: 1, tones: [[120, 0.8, 0.06], [240, 0.3, 0.04]] }, { t: 0.04, nt: 0.003, na: 0.8, tones: [[2200, 0.4, 0.02]] }], peak: 0.7 })];
    B.doorkick = [buf(ctx, 1.0, (d, n) => {
      for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * Math.exp(-t / 0.05) * 1.2 + Math.sin(2 * Math.PI * (90 - t * 30) * t) * Math.exp(-t / 0.12) * 1.3 + noise() * Math.exp(-((t - 0.25) ** 2) / 0.001) * 0.5; }
      lp(d, 2500); soft(d, 1.5); norm(d, 0.95);
    })];
    B.doorlocked = [click(ctx, { len: 0.4, events: [0, 0.08, 0.16].map((t) => ({ t, nt: 0.01, na: 0.7, tones: [[800, 0.4, 0.02], [1900, 0.2, 0.015]] })), peak: 0.6 })];
    B.bang = [buf(ctx, 2.6, (d, n) => {
      for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * Math.exp(-t / 0.08) * 1.5 + Math.sin(2 * Math.PI * (60 - t * 10) * t) * Math.exp(-t / 0.3) * 1.2 + noise() * Math.exp(-t / 0.7) * 0.25; }
      lp(d, 3000); soft(d, 2.5); norm(d, 1);
    })];
    B.tinnitus = [buf(ctx, 6, (d, n) => { for (let i = 0; i < n; i++) { const t = i / SR; d[i] = Math.sin(2 * Math.PI * 3650 * t) * Math.min(1, t * 8) * Math.exp(-t / 2.2) * 0.25; } })];
    B.whiz = [0, 1].map(() => buf(ctx, 0.25, (d, n) => {
      for (let i = 0; i < n; i++) { const t = i / SR; d[i] = (t < 0.003 ? noise() * 1.5 : 0) + noise() * Math.exp(-((t - 0.04) ** 2) / 0.0006) * 0.6; }
      hp(d, 1500); norm(d, 0.8);
    }));
    B.hurt = [buf(ctx, 0.4, (d, n) => { for (let i = 0; i < n; i++) { const t = i / SR; d[i] = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.08) + noise() * Math.exp(-t / 0.02) * 0.5; } lp(d, 800); norm(d, 0.95); })];
    B.heart = [buf(ctx, 0.8, (d, n) => { for (const s0 of [0, 0.22]) { const s = Math.floor(s0 * SR); for (let i = 0; i < n - s; i++) { const t = i / SR; d[s + i] += Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t / 0.06) * (s0 ? 0.7 : 1); } } norm(d, 0.8); })];
    B.bodyfall = [0, 1].map(() => buf(ctx, 0.5, (d, n) => { const a = new Float32Array(n), b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; a[i] = noise() * Math.exp(-t / 0.05) * Math.min(1, t / 0.003); b[i] = noise() * Math.exp(-t / 0.012); } lp(a, 220); lp(a, 220); lp(a, 220); lp(b, 1500); let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i])); for (let i = 0; i < n; i++) d[i] = a[i] / (m || 1) + b[i] * 0.35; soft(d, 1.6); norm(d, 0.95); }));
    B.gundrop = [click(ctx, { len: 0.6, events: [{ t: 0, nt: 0.01, na: 1, tones: [[900, 0.5, 0.05], [2100, 0.4, 0.04]] }, { t: 0.14, nt: 0.008, na: 0.5, tones: [[1300, 0.3, 0.04]] }, { t: 0.25, nt: 0.005, na: 0.3, tones: [[1700, 0.2, 0.03]] }], peak: 0.7 })];
    B.glassbreak = [0, 1].map(() => buf(ctx, 1.3, (d, n) => {
      for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * Math.exp(-t / 0.03) * 1.2; }
      for (let k = 0; k < 26; k++) { const s0 = Math.floor((0.03 + Math.random() * 0.9) * SR); const a = 0.25 + Math.random() * 0.5; for (let i = 0; i < 2500 && s0 + i < n; i++) d[s0 + i] += noise() * Math.exp(-i / SR / 0.004) * a * (1 - s0 / n); }
      hp(d, 1800); norm(d, 0.9);
    }));
    B.hitmark = [buf(ctx, 0.12, (d, n) => { for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * Math.exp(-t / 0.012) * Math.min(1, t / 0.0005); } lp(d, 2600); hp(d, 400); norm(d, 0.7); })];
    B.killconfirm = [buf(ctx, 0.35, (d, n) => { for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * Math.exp(-t / 0.03) * Math.min(1, t / 0.001); } lp(d, 900); lp(d, 900); norm(d, 0.9); })];
    B.nadebounce = [click(ctx, { len: 0.2, events: [{ t: 0, nt: 0.005, na: 1, tones: [[1500, 0.6, 0.03], [3300, 0.3, 0.02]] }], peak: 0.6 })];
    B.npcreload = [click(ctx, { len: 0.8, events: [{ t: 0, nt: 0.004, na: 1, tones: [[1800, 0.5, 0.02]] }, { t: 0.55, nt: 0.003, na: 1.2, tones: [[2500, 0.6, 0.015]] }], peak: 0.6 })];
    B.radio = [buf(ctx, 0.25, (d, n) => { for (let i = 0; i < n; i++) { const t = i / SR; d[i] = noise() * (t < 0.12 ? 0.6 : 0) * (0.6 + 0.4 * Math.sin(t * 900)); } hp(d, 1200); lp(d, 3500); norm(d, 0.35); })];
    B.hum = [buf(ctx, 4, (d, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) { const t = i / SR; b = b * 0.995 + noise() * 0.05; d[i] = b * 0.6 + Math.sin(2 * Math.PI * 50 * t) * 0.05 + Math.sin(2 * Math.PI * 100 * t) * 0.03; }
      // nahtlos
      const f = Math.floor(0.2 * SR); for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
      lp(d, 400); norm(d, 0.5);
    })];
  }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.listenerPos = pos;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  // opts: pos (Vector3), vol, rate, delay, ref (Bezugsdistanz), verb (Hallanteil), occlude (bool)
  play(name, opts = {}) {
    if (!this.ctx) return null;
    const list = this.buffers[name];
    if (!list) return null;
    if (this.voices > 48 && !opts.important) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = (opts.rate ?? 1) * (opts.jitter === false ? 1 : 0.96 + Math.random() * 0.08);
    let node = src;
    const g = ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    let occluded = false;
    if (opts.pos && this.occlusion) occluded = this.occlusion(opts.pos);
    if (occluded || opts.lowpass) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lowpass ?? 750; f.Q.value = 0.5;
      node.connect(f); node = f;
      if (occluded) g.gain.value *= 0.55;
    }
    node.connect(g);
    let out = g;
    if (opts.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 2; p.rolloffFactor = opts.rolloff ?? 1.1; p.maxDistance = 200;
      if (p.positionX) { p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z; }
      else p.setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      g.connect(p); out = p;
    }
    out.connect(opts.direct ? this.master : this.dry);
    const vs = opts.verb ?? 0.35;
    if (vs > 0) { const s = ctx.createGain(); s.gain.value = vs * (occluded ? 1.4 : 1); out.connect(s).connect(this.verb); }
    const when = ctx.currentTime + (opts.delay ?? 0);
    src.start(when);
    this.voices++;
    src.onended = () => { this.voices--; try { g.disconnect(); } catch (e) { /* */ } };
    return { src, gain: g };
  }

  loop(name, vol) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name][0]; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.dry); src.start();
    return { src, gain: g };
  }

  // Blendgranate: alles dumpf + Tinnitus
  deafen(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(Math.max(0.05, 1 - strength * 0.95), t);
    this.duck.gain.linearRampToValueAtTime(1, t + 2 + strength * 4);
    this.play('tinnitus', { vol: strength * 0.9, verb: 0, jitter: false, important: true, direct: true });
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
}
