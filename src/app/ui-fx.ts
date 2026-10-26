// Tiny WebAudio cue system for the back office: no assets, no requests, instant.
export type Cue = 'click' | 'success' | 'error' | 'notify';

const MUTE_KEY = 'kf.ui.muted';
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function soundEnabled(): boolean {
  try { return localStorage.getItem(MUTE_KEY) !== '1'; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(MUTE_KEY, on ? '0' : '1'); } catch { /* ignore */ }
}

function tone(freq: number, start: number, dur: number, gain = 0.05, type: OscillatorType = 'sine'): void {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  vol.gain.setValueAtTime(0, t0);
  vol.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(vol).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function play(cue: Cue = 'click'): void {
  if (!soundEnabled()) return;
  try {
    if (cue === 'click') {
      tone(520, 0, 0.055, 0.028, 'triangle');
    } else if (cue === 'success') {
      tone(659, 0, 0.1, 0.045);
      tone(880, 0.085, 0.14, 0.04);
    } else if (cue === 'error') {
      tone(300, 0, 0.12, 0.045, 'sawtooth');
      tone(190, 0.1, 0.18, 0.035, 'sawtooth');
    } else {
      tone(740, 0, 0.09, 0.04);
      tone(988, 0.105, 0.12, 0.032);
    }
  } catch {
    /* never let audio break a flow */
  }
}

/** Pick a cue from a toast message, so existing calls get feedback for free. */
export function cueForMessage(msg: string): Cue {
  const m = (msg || '').toLowerCase();
  if (/(fail|could not|cannot|error|invalid|declin|reject)/.test(m)) return 'error';
  if (/(saved|updated|created|deleted|exported|synced|marked|sent|saved.)/.test(m)) return 'success';
  if (/(new order|received)/.test(m)) return 'notify';
  return 'click';
}
