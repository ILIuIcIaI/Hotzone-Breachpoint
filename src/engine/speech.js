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

  // Rollen: radio = Einsatzleitung (Frau), team = Teamkollegen, player = Spieler, suspect, hostage/civilian
  voiceFor(who, type) {
    if (!this.voices.length) return null;
    const male = this.voices.filter((v) => /stefan|conrad|killian|florian|male|markus/i.test(v.name));
    const female = this.voices.filter((v) => /katja|hedda|amala|female|seraphina|elke|louisa/i.test(v.name));
    const commander = this.pickBy(['seraphina', 'amala', 'katja', 'hedda']) || female[0] || this.voices[0];
    if (type === 'radio') return commander;
    if (type === 'team') return this.pickBy(['conrad', 'florian', 'stefan']) || male[0] || this.voices[0];
    if (type === 'player') return this.pickBy(['killian', 'florian', 'stefan']) || male[0] || this.voices[0];
    let pool = this.voices;
    if (type === 'suspect') pool = male.length ? male : this.voices;
    else if (type === 'hostage' || type === 'civilian') pool = female.length ? female : this.voices;
    // Einsatzleitung und Team bekommen ihre Stimme exklusiv, wenn Alternativen da sind
    const reserved = [commander, this.voiceFor(0, 'team')];
    const alt = pool.filter((v) => !reserved.includes(v));
    if (alt.length) pool = alt;
    return pool[Math.abs(who | 0) % pool.length];
  }

  // Tonlage/Tempo je Rolle (unterscheidet Rollen auch dann, wenn nur eine Maennerstimme installiert ist)
  roleSound(type) {
    switch (type) {
      case 'radio': return { pitch: 1.02, rate: 1.0 };
      case 'team': return { pitch: 1.22, rate: 1.18 };
      case 'player': return { pitch: 0.95, rate: 1.22 };
      case 'suspect': return { pitch: 0.72, rate: 1.12 };
      case 'hostage': case 'civilian': return { pitch: 1.12, rate: 1.15 };
      default: return { pitch: 1, rate: 1.1 };
    }
  }

  say(text, o = {}) {
    if (!this.enabled || !this.synth) { if (this.onSubtitle) this.onSubtitle(text, o.type, o.name); return; }
    const prio = o.prio ?? 1;
    if (this.synth.speaking) {
      // Funk/Team-Meldungen warten in einer kleinen Warteschlange statt sich zu unterbrechen
      if ((o.type === 'radio' || o.type === 'team') && this.current && this.current.prio >= prio) {
        this.queue = this.queue || [];
        if (this.queue.length < 3) this.queue.push([text, o]);
        return;
      }
      if (this.current && this.current.prio > prio) return;
      this.synth.cancel();
    }
    if (this.onSubtitle) this.onSubtitle(text, o.type, o.name);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const v = this.voiceFor(o.who ?? 0, o.type);
    if (v) u.voice = v;
    const rs = this.roleSound(o.type);
    u.pitch = Math.max(0.1, Math.min(2, rs.pitch * (o.type === 'suspect' ? (o.pitch ?? 1) : 1)));
    u.rate = rs.rate;
    const isRadio = o.type === 'radio' || o.type === 'team';
    if (isRadio && this.onRadio) this.onRadio();
    const endRadio = isRadio && this.onRadio;
    let vol = 1;
    if (o.pos) {
      const d = Math.hypot(o.pos.x - this.listener.x, o.pos.y - this.listener.y, o.pos.z - this.listener.z);
      vol = Math.max(0.12, Math.min(1, 3.5 / (d + 0.5)));
      if (o.occluded) vol *= 0.5;
    }
    u.volume = vol * (o.vol ?? 1);
    this.current = { prio, who: o.who };
    u.onend = () => {
      if (this.current && this.current.who === o.who) this.current = null;
      if (endRadio) this.onRadio();
      if (this.queue && this.queue.length) { const [t, oo] = this.queue.shift(); setTimeout(() => this.say(t, { ...oo, _queued: true }), 250); }
    };
    this.synth.speak(u);
  }

  cancelWho(who) {
    if (this.synth && this.current && this.current.who === who) { this.synth.cancel(); this.current = null; }
  }
  stop() { if (this.synth) this.synth.cancel(); this.current = null; }
}
