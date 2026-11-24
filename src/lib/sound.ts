/**
 * Syntetiserade ljudeffekter för storskärmen (Web Audio API – inga ljudfiler).
 *
 *  - unlock() måste anropas från en användargest (klick/tangent) innan något hörs.
 *  - Allt är tyst no-op när ljudet är avstängt eller Web Audio saknas, och inget kastar fel.
 *  - Allt går via en master-gain + kompressor och en gemensam rumsklang så att ljuden
 *    smälter ihop och aldrig blir skarpa.
 *
 * Utöver specen: stopAll() tystar pågående trumvirvlar/applåder (t.ex. när admin bläddrar vidare)
 * och subscribeMuted() låter React-komponenter följa mute-läget.
 */

const MUTED_KEY = 'bonjour-babes:muted';
const MASTER_LEVEL = 0.9;

type LongKind = 'drumroll' | 'applause';

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  /** Torr buss (allt passerar kompressorn). */
  bus: AudioNode;
  /** Ingång till rumsklangen. */
  reverb: AudioNode;
  noise: AudioBuffer;
}

interface LongVoice {
  kind: LongKind;
  stop: (fadeSec?: number) => void;
}

let engine: Engine | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();
const longVoices = new Set<LongVoice>();

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Ljud får aldrig krascha appen – men i utvecklingsläge vill vi se felen. */
function report(err: unknown) {
  if (import.meta.env.DEV) console.warn('[sound]', err);
}

function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      report(err);
    }
  };
}

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Brusbuffert (vitt brus) som återanvänds av alla brusbaserade ljud. */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Enkel syntetisk rumsklang: avklingande stereobrus. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}

function createEngine(): Engine | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_LEVEL;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  // Mjuk topp – tar udden av brus och höga partialtoner.
  const tone = ctx.createBiquadFilter();
  tone.type = 'highshelf';
  tone.frequency.value = 7000;
  tone.gain.value = -4;
  comp.connect(tone);
  tone.connect(master);
  master.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.4, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  convolver.connect(wet);
  wet.connect(comp);

  return { ctx, master, bus: comp, reverb: convolver, noise: makeNoise(ctx, 2) };
}

/** Motorn om ljudet är upplåst, påslaget och igång – annars null. */
function live(): Engine | null {
  if (muted || !engine) return null;
  if (engine.ctx.state !== 'running') return null;
  return engine;
}

/** Kopplar en nod till utgången med valfri andel rumsklang. */
function out(e: Engine, node: AudioNode, wet = 0.2, pan = 0): void {
  let src: AudioNode = node;
  if (pan !== 0 && typeof e.ctx.createStereoPanner === 'function') {
    const p = e.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    src = p;
  }
  src.connect(e.bus);
  if (wet > 0) {
    const g = e.ctx.createGain();
    g.gain.value = wet;
    src.connect(g);
    g.connect(e.reverb);
  }
}

/** Gain med attack och exponentiell avklingning. */
function envelope(e: Engine, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

const A4 = 440;
const hz = (semitonesFromA4: number) => A4 * Math.pow(2, semitonesFromA4 / 12);
/** Durpentatonisk skala (halvtonssteg från grundtonen). */
const PENTA = [0, 2, 4, 7, 9];

function pentaSemitone(degree: number): number {
  const octave = Math.floor(degree / PENTA.length);
  const idx = ((degree % PENTA.length) + PENTA.length) % PENTA.length;
  return PENTA[idx] + octave * 12;
}

/** Klockliknande ton (celesta/glockenspiel). */
function bell(e: Engine, t: number, freq: number, gain: number, decay = 1.4, pan = 0, wet = 0.32) {
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.0, 0.32, 0.55],
    [3.01, 0.12, 0.35],
    [4.17, 0.05, 0.22],
  ];
  const sum = e.ctx.createGain();
  sum.gain.value = 1;
  out(e, sum, wet, pan);
  for (const [ratio, amp, decayScale] of partials) {
    const f = freq * ratio;
    if (f > 16000) continue;
    const osc = e.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = envelope(e, t, gain * amp, 0.004, decay * decayScale);
    osc.connect(g);
    g.connect(sum);
    osc.start(t);
    osc.stop(t + decay * decayScale + 0.1);
  }
}

function noiseSource(e: Engine, t: number, duration: number, offset = Math.random()): AudioBufferSourceNode {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  src.loop = true;
  src.start(t, offset * (e.noise.duration - 0.1));
  src.stop(t + duration);
  return src;
}

/** Spelar en buffert som ett "långt" ljud som kan avbrytas med stopAll(). */
function playLong(e: Engine, kind: LongKind, buffer: AudioBuffer, chain: (src: AudioNode) => AudioNode, wet: number): LongVoice {
  const t = e.ctx.currentTime + 0.02;
  const src = e.ctx.createBufferSource();
  src.buffer = buffer;
  const fader = e.ctx.createGain();
  fader.gain.value = 1;
  src.connect(fader);
  out(e, chain(fader), wet);
  const voice: LongVoice = {
    kind,
    stop: (fadeSec = 0.25) => {
      try {
        const now = e.ctx.currentTime;
        fader.gain.cancelScheduledValues(now);
        fader.gain.setValueAtTime(fader.gain.value, now);
        fader.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
        src.stop(now + fadeSec + 0.05);
      } catch {
        /* redan stoppad */
      }
      longVoices.delete(voice);
    },
  };
  src.onended = () => longVoices.delete(voice);
  src.start(t);
  longVoices.add(voice);
  return voice;
}

/* ------------------------------------------------------------------ */
/*  Publikt API                                                         */
/* ------------------------------------------------------------------ */

/** Finns Web Audio i den här webbläsaren? */
export function isSupported(): boolean {
  return audioCtor() !== null;
}

/** true när ljudet är upplåst (en användargest har startat AudioContext). */
export function isUnlocked(): boolean {
  return !!engine && engine.ctx.state === 'running';
}

/**
 * Låser upp ljudet. Anropa från en klick-/tangenthanterare.
 * Returnerar true om ljudet är igång efteråt.
 */
export async function unlock(): Promise<boolean> {
  try {
    if (!engine) engine = createEngine();
    if (!engine) return false;
    if (engine.ctx.state !== 'running') await engine.ctx.resume();
    // En tyst buffert "väcker" iOS Safari.
    const silent = engine.ctx.createBufferSource();
    silent.buffer = engine.ctx.createBuffer(1, 1, engine.ctx.sampleRate);
    silent.connect(engine.ctx.destination);
    silent.start();
    return engine.ctx.state === 'running';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  try {
    muted = value;
    try {
      localStorage.setItem(MUTED_KEY, value ? '1' : '0');
    } catch {
      /* privat läge */
    }
    if (engine) {
      const now = engine.ctx.currentTime;
      engine.master.gain.cancelScheduledValues(now);
      engine.master.gain.setTargetAtTime(value ? 0 : MASTER_LEVEL, now, 0.04);
    }
    listeners.forEach((cb) => {
      try {
        cb(value);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

/** Prenumerera på mute-läget. Returnerar en avregistreringsfunktion. */
export function subscribeMuted(cb: (muted: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tystar pågående långa ljud (trumvirvel/applåder), eller bara en sort. */
export function stopAll(kind?: LongKind): void {
  try {
    for (const v of [...longVoices]) if (!kind || v.kind === kind) v.stop();
  } catch {
    /* ignore */
  }
}

/**
 * Ett klockpling. degree = steg i en durpentatonisk skala (0 = A5),
 * så att t.ex. röster som trillar in kan klättra uppåt.
 */
export const ding = safe((degree: number = 0) => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.01;
  const f = hz(12 + pentaSemitone(degree));
  bell(e, t, f, 0.2, 1.3, ((degree % 5) - 2) * 0.12);
});

/** Glittrande arpeggio – "klart!" / "alla har röstat". */
export const chime = safe(() => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.01;
  // C-dur maj7: C5 E5 G5 H5 E6
  const notes = [3, 7, 10, 14, 19];
  notes.forEach((n, i) => bell(e, t + i * 0.075, hz(n), 0.13, 1.9, -0.4 + i * 0.2, 0.4));
});

/** Kort träigt klick (lottning, rader som avslöjas). */
export const tick = safe(() => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.005;
  const osc = e.ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1500, t);
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.03);
  const g = envelope(e, t, 0.16, 0.002, 0.05);
  osc.connect(g);
  out(e, g, 0.08);
  osc.start(t);
  osc.stop(t + 0.08);
  const n = noiseSource(e, t, 0.03);
  const hp = e.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3500;
  const ng = envelope(e, t, 0.05, 0.001, 0.02);
  n.connect(hp);
  hp.connect(ng);
  out(e, ng, 0.05);
});

/** Luftigt svep (kort som flyger, nästa drink på väg). */
export const whoosh = safe(() => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.01;
  const dur = 0.8;
  const src = noiseSource(e, t, dur + 0.05);
  const bp = e.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(700, t + dur);
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.32, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  if (typeof e.ctx.createStereoPanner === 'function') {
    const p = e.ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.6, t);
    p.pan.linearRampToValueAtTime(0.6, t + dur);
    g.connect(p);
    out(e, p, 0.25);
  } else {
    out(e, g, 0.25);
  }
});

/**
 * Trumvirvel med crescendo. Löser sig efter ms millisekunder – även när ljudet är
 * avstängt, så att den kan användas för att tajma en avslöjande.
 */
export function drumroll(ms: number): Promise<void> {
  const duration = Math.max(200, Number(ms) || 0);
  try {
    const e = live();
    if (e) {
      stopAll('drumroll');
      const sr = e.ctx.sampleRate;
      const seconds = duration / 1000;
      const len = Math.floor(sr * (seconds + 0.25));
      const buf = e.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let t = 0;
      let k = 0;
      while (t < seconds) {
        const p = t / seconds;
        // Crescendo: från viskning till fullt.
        const vel = (0.1 + 0.9 * Math.pow(p, 1.8)) * (0.78 + Math.random() * 0.22) * (k % 2 ? 0.88 : 1);
        const start = Math.floor(t * sr);
        const snareLen = Math.floor(sr * 0.09);
        for (let i = 0; i < snareLen && start + i < len; i++) {
          const x = i / sr;
          const noise = (Math.random() * 2 - 1) * Math.exp(-x / 0.028);
          const body = Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x / 0.03) * 0.45;
          const tom = Math.sin(2 * Math.PI * 78 * x) * Math.exp(-x / 0.06) * 0.35 * p;
          d[start + i] += (noise * 0.7 + body + tom) * vel * 0.5;
        }
        // Lite ojämn takt för att låta mänsklig; aningen snabbare mot slutet.
        const rate = 17 + 6 * p;
        t += (1 / rate) * (0.9 + Math.random() * 0.2);
        k++;
      }
      playLong(
        e,
        'drumroll',
        buf,
        (src) => {
          const hp = e.ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 60;
          const peak = e.ctx.createBiquadFilter();
          peak.type = 'peaking';
          peak.frequency.value = 2400;
          peak.Q.value = 0.8;
          peak.gain.value = 3;
          const g = e.ctx.createGain();
          g.gain.value = 0.75;
          src.connect(hp);
          hp.connect(peak);
          peak.connect(g);
          return g;
        },
        0.2,
      );
    }
  } catch (err) {
    report(err);
  }
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/** Cymbalkrasch med pukslag – avslöjandet. */
export const cymbal = safe(() => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.01;

  // Brus-krasch
  const n = noiseSource(e, t, 3);
  const hp = e.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  const ng = envelope(e, t, 0.3, 0.003, 2.6);
  n.connect(hp);
  hp.connect(ng);
  out(e, ng, 0.45, -0.15);

  // Metalliska partialtoner (à la 808-cymbal)
  const metal = e.ctx.createGain();
  metal.gain.value = 1;
  const bp = e.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 8500;
  bp.Q.value = 0.8;
  const mg = envelope(e, t, 0.11, 0.002, 1.9);
  metal.connect(bp);
  bp.connect(mg);
  out(e, mg, 0.4, 0.15);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = e.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f * 2;
    const og = e.ctx.createGain();
    og.gain.value = 0.18;
    o.connect(og);
    og.connect(metal);
    o.start(t);
    o.stop(t + 2.1);
  }

  // Puka för tyngd
  const boom = e.ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(120, t);
  boom.frequency.exponentialRampToValueAtTime(46, t + 0.5);
  const bg = envelope(e, t, 0.55, 0.005, 1.0);
  boom.connect(bg);
  out(e, bg, 0.15);
  boom.start(t);
  boom.stop(t + 1.2);
});

/** En mässingston med filterattack och lätt vibrato. */
function brass(e: Engine, t: number, freq: number, dur: number, gain: number, pan = 0) {
  const voice = e.ctx.createGain();
  voice.gain.setValueAtTime(0.0001, t);
  voice.gain.linearRampToValueAtTime(gain, t + 0.035);
  voice.gain.setTargetAtTime(gain * 0.72, t + 0.06, 0.12);
  voice.gain.setValueAtTime(gain * 0.72, t + dur);
  voice.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.28);

  const lp = e.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(Math.min(500, freq * 1.5), t);
  lp.frequency.linearRampToValueAtTime(Math.min(3200, freq * 7), t + 0.05);
  lp.frequency.setTargetAtTime(Math.min(2200, freq * 4.5), t + 0.07, 0.15);
  lp.connect(voice);
  out(e, voice, 0.32, pan);

  const vib = e.ctx.createOscillator();
  vib.frequency.value = 5.4;
  const vibDepth = e.ctx.createGain();
  vibDepth.gain.setValueAtTime(0, t);
  vibDepth.gain.linearRampToValueAtTime(dur > 0.4 ? freq * 0.004 : 0, t + Math.min(0.35, dur));
  vib.connect(vibDepth);
  vib.start(t);
  vib.stop(t + dur + 0.35);

  for (const [type, detune, amp] of [
    ['sawtooth', -7, 0.5],
    ['sawtooth', 7, 0.5],
    ['square', 0, 0.18],
  ] as const) {
    const o = e.ctx.createOscillator();
    o.type = type;
    o.frequency.value = type === 'square' ? freq / 2 : freq;
    o.detune.value = detune;
    vibDepth.connect(o.frequency);
    const g = e.ctx.createGain();
    g.gain.value = amp;
    o.connect(g);
    g.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.35);
  }
}

/** Mässingsfanfar: ta-ta-ta-TAAA … ta-ta-TAAAA med ackord. */
export const fanfare = safe(() => {
  const e = live();
  if (!e) return;
  const t = e.ctx.currentTime + 0.03;
  const G4 = hz(-2);
  const C5 = hz(3);
  const E5 = hz(7);
  const G5 = hz(10);
  const motif: [number, number, number][] = [
    [0, G4, 0.1],
    [0.13, G4, 0.1],
    [0.26, G4, 0.1],
    [0.4, C5, 0.5],
    [0.98, G4, 0.16],
    [1.18, C5, 0.16],
    [1.38, E5, 0.2],
    [1.62, G5, 1.35],
  ];
  for (const [at, f, dur] of motif) brass(e, t + at, f, dur, 0.17, 0.1);
  // Ackord under sista tonen (C-dur), lite bredare i stereo.
  brass(e, t + 1.62, hz(-9), 1.35, 0.09, -0.45); // C4
  brass(e, t + 1.62, hz(-5), 1.35, 0.08, 0.45); // E4
  brass(e, t + 1.62, hz(-2), 1.35, 0.08, -0.2); // G4
  // Glitter ovanpå
  bell(e, t + 1.62, hz(22), 0.05, 1.6, 0.3, 0.5);
  bell(e, t + 1.7, hz(27), 0.04, 1.4, -0.3, 0.5);
});

/** Applåder. intensity 0–1 styr täthet och styrka. */
export function applause(ms: number, intensity = 1): void {
  try {
    const e = live();
    if (!e) return;
    const level = Math.max(0.15, Math.min(1, intensity));
    const sr = e.ctx.sampleRate;
    const seconds = Math.max(0.5, (Number(ms) || 0) / 1000);
    const len = Math.floor(sr * (seconds + 0.2));
    const buf = e.ctx.createBuffer(2, len, sr);
    const attack = Math.min(0.5, seconds * 0.2);
    const fadeStart = seconds * 0.55;
    const env = (time: number) =>
      time < attack ? time / attack : time > fadeStart ? Math.max(0, 1 - (time - fadeStart) / (seconds - fadeStart)) : 1;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const density = 26 + 30 * level; // klapp per sekund och kanal
      let time = Math.random() * 0.03;
      while (time < seconds) {
        const amp = env(time) * (0.35 + Math.random() * 0.65);
        const start = Math.floor(time * sr);
        const tau = 0.006 + Math.random() * 0.01;
        const clapLen = Math.floor(sr * tau * 6);
        // Två snabba transienter per klapp ger en mer naturlig "smäll".
        for (let i = 0; i < clapLen && start + i < len; i++) {
          const x = i / sr;
          const e1 = Math.exp(-x / tau);
          const e2 = x > 0.004 ? Math.exp(-(x - 0.004) / tau) * 0.6 : 0;
          d[start + i] += (Math.random() * 2 - 1) * (e1 + e2) * amp * 0.5;
        }
        time += (-Math.log(1 - Math.random()) / density) * (env(time) > 0.05 ? 1 : 3);
      }
      // Svag publikmatta
      for (let i = 0; i < len; i++) d[i] += (Math.random() * 2 - 1) * 0.025 * env(i / sr);
    }
    playLong(
      e,
      'applause',
      buf,
      (src) => {
        const bp = e.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 0.55;
        const g = e.ctx.createGain();
        g.gain.value = 0.85 * level;
        src.connect(bp);
        bp.connect(g);
        return g;
      },
      0.3,
    );
  } catch (err) {
    report(err);
  }
}
