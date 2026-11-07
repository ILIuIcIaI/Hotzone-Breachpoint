// Sprachausgabe ueber die System-Stimmen (Windows: z.B. Microsoft Katja/Stefan/Hedda).
// Lautstaerke nach Entfernung, Prioritaeten, damit nicht alles durcheinander redet.
export class Speech {
  constructor() {
    this.enabled = true;
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    this.current = null;
    this.listener = { x: 0, y: 0, z: 0 };
    this.lastText = '';
    this.onSubtitle = null;
    if (this.synth) {
      const load = () => {
        const all = this.synth.getVoices();
        const de = all.filter((v) => /^de/i.test(v.lang));
        this.voices = de.length ? de : all;
      };
      load();
      this.synth.onvoiceschanged = load;
    }
  }

  // Bevorzugte Stimmen je Rolle (natuerliche Microsoft-Stimmen zuerst, sonst Desktop-Stimmen)
  pickBy(names) {
    for (const n of names) {
      const natural = this.voices.find((v) => v.name.toLowerCase().includes(n) && /natural|online/i.test(v.name));
      if (natural) return natural;
    }
    for (const n of names) { const v = this.voices.find((x) => x.name.toLowerCase().includes(n)); if (v) return v; }
    return null;
  }

  voiceFor(who, type) {
    if (!this.voices.length) return null;
    const male = this.voices.filter((v) => /stefan|conrad|killian|florian|male|markus/i.test(v.name));
    const female = this.voices.filter((v) => /katja|hedda|amala|female|seraphina|elke|louisa/i.test(v.name));
    if (type === 'radio') return this.pickBy(['conrad', 'florian', 'killian', 'stefan']) || male[0] || this.voices[0];
    if (type === 'player') return this.pickBy(['killian', 'florian', 'stefan', 'conrad']) || male[0] || this.voices[0];
    let pool = this.voices;
    if (type === 'suspect') pool = male.length ? male : this.voices;
    else if (type === 'hostage' || type === 'civilian') pool = female.length ? female : this.voices;
    // die Funkstimme nicht fuer andere Rollen verwenden, wenn es Alternativen gibt
    const radio = this.voiceFor(0, 'radio');
    const alt = pool.filter((v) => v !== radio);
    if (alt.length) pool = alt;
    return pool[Math.abs(who | 0) % pool.length];
  }

  say(text, o = {}) {
    if (this.onSubtitle) this.onSubtitle(text, o.type);
    if (!this.enabled || !this.synth) return;
    const prio = o.prio ?? 1;
    if (this.synth.speaking) {
      if (this.current && this.current.prio > prio) return;
      this.synth.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const v = this.voiceFor(o.who ?? 0, o.type);
    if (v) u.voice = v;
    // Rollenklang: Verdaechtige tiefer/rauer, Zivilisten heller, Funk ruhig und deutlich
    const rolePitch = o.type === 'suspect' ? 0.78 : o.type === 'radio' ? 0.95 : o.type === 'player' ? 0.9 : o.type ? 1.12 : 1;
    u.pitch = (o.pitch ?? 1) * rolePitch;
    u.rate = o.type === 'radio' ? 1.02 : (o.rate ?? 1.15);
    if (o.type === 'radio' && this.onRadio) { this.onRadio(); u.onstart = null; }
    const endRadio = o.type === 'radio' && this.onRadio;
    let vol = 1;
    if (o.pos) {
      const d = Math.hypot(o.pos.x - this.listener.x, o.pos.y - this.listener.y, o.pos.z - this.listener.z);
      vol = Math.max(0.12, Math.min(1, 3.5 / (d + 0.5)));
      if (o.occluded) vol *= 0.5;
    }
    u.volume = vol * (o.vol ?? 1);
    this.current = { prio, who: o.who };
    u.onend = () => { if (this.current && this.current.who === o.who) this.current = null; if (endRadio) this.onRadio(); };
    this.synth.speak(u);
  }

  cancelWho(who) {
    if (this.synth && this.current && this.current.who === who) { this.synth.cancel(); this.current = null; }
  }
  stop() { if (this.synth) this.synth.cancel(); this.current = null; }
}
