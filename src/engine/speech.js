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

  voiceFor(who, type) {
    if (!this.voices.length) return null;
    // maennliche Stimmen fuer Verdaechtige bevorzugen, falls erkennbar
    const male = this.voices.filter((v) => /stefan|conrad|killian|male|mann|markus|florian/i.test(v.name));
    const female = this.voices.filter((v) => /katja|hedda|amala|female|frau|seraphina|elke|louisa/i.test(v.name));
    let pool = this.voices;
    if (type === 'suspect' || type === 'player') pool = male.length ? male : this.voices;
    else if (type === 'hostage' || type === 'civilian') pool = (who % 2 && female.length) ? female : (male.length ? male : this.voices);
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
    u.pitch = o.pitch ?? 1;
    u.rate = o.rate ?? 1.15;
    let vol = 1;
    if (o.pos) {
      const d = Math.hypot(o.pos.x - this.listener.x, o.pos.y - this.listener.y, o.pos.z - this.listener.z);
      vol = Math.max(0.12, Math.min(1, 3.5 / (d + 0.5)));
      if (o.occluded) vol *= 0.5;
    }
    u.volume = vol * (o.vol ?? 1);
    this.current = { prio, who: o.who };
    u.onend = () => { if (this.current && this.current.who === o.who) this.current = null; };
    this.synth.speak(u);
  }

  cancelWho(who) {
    if (this.synth && this.current && this.current.who === who) { this.synth.cancel(); this.current = null; }
  }
  stop() { if (this.synth) this.synth.cancel(); this.current = null; }
}
