/**
 * SoundManager — one central audio/haptic engine for the whole back office.
 *
 * Sounds are pre-rendered WAV files (see scripts/gen-sounds.mjs) decoded once
 * into AudioBuffers, so playback is immediate and never touches the network
 * after first load. Nothing here depends on being online or on a plugin.
 */
export type Cue =
  | 'scanSuccess'
  | 'scanError'
  | 'duplicate'
  | 'stockReceived'
  | 'orderCompleted'
  | 'orderDispatched'
  | 'lowStock'
  | 'button';

const FILES: Record<Cue, string> = {
  scanSuccess: 'sounds/scanner_success.wav',
  scanError: 'sounds/scanner_error.wav',
  duplicate: 'sounds/scanner_duplicate.wav',
  stockReceived: 'sounds/stock_received.wav',
  orderCompleted: 'sounds/order_completed.wav',
  orderDispatched: 'sounds/order_dispatched.wav',
  lowStock: 'sounds/low_stock.wav',
  button: 'sounds/button_tap.wav',
};

const VIBRATION: Record<Cue, number | number[]> = {
  scanSuccess: 40,
  scanError: [35, 60, 35],
  duplicate: 20,
  stockReceived: 90,
  orderCompleted: [35, 50, 35],
  orderDispatched: 60,
  lowStock: 120,
  button: 10,
};

const KEY = 'kf.sound.v1';

export interface SoundPrefs {
  master: boolean;
  volume: number;
  cues: Record<Cue, boolean>;
  vibration: boolean;
  vibrateScanner: boolean;
  vibrateNotifications: boolean;
  buttonSound: boolean;
  continuousScan: boolean;
}

function defaults(): SoundPrefs {
  return {
    master: true,
    volume: 0.85,
    cues: {
      scanSuccess: true,
      scanError: true,
      duplicate: true,
      stockReceived: true,
      orderCompleted: true,
      orderDispatched: true,
      lowStock: true,
      button: false,
    },
    vibration: true,
    vibrateScanner: true,
    vibrateNotifications: true,
    buttonSound: false,
    continuousScan: true,
  };
}

class SoundManagerImpl {
  private ctx: AudioContext | null = null;
  private buffers = new Map<Cue, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private lastAt = new Map<Cue, number>();
  private prefs: SoundPrefs = defaults();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SoundPrefs>;
        this.prefs = {
          ...defaults(),
          ...saved,
          cues: { ...defaults().cues, ...(saved.cues ?? {}) },
        };
      }
    } catch {
      /* corrupted prefs fall back to defaults */
    }
  }

  get settings(): SoundPrefs {
    return this.prefs;
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }

  set<K extends keyof SoundPrefs>(key: K, value: SoundPrefs[K]): void {
    this.prefs[key] = value;
    this.save();
  }

  setCue(cue: Cue, on: boolean): void {
    this.prefs.cues[cue] = on;
    this.save();
  }

  /** Must be called from a user gesture once (mobile audio unlock). */
  async unlock(): Promise<void> {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    void this.preload();
  }

  /** Decode every sound once, in the background. */
  async preload(): Promise<void> {
    if (this.buffers.size >= Object.keys(FILES).length) return;
    if (this.loading) return this.loading;
    const ctx = this.context();
    if (!ctx) return;
    this.loading = (async () => {
      await Promise.all(
        (Object.keys(FILES) as Cue[]).map(async (cue) => {
          if (this.buffers.has(cue)) return;
          try {
            const res = await fetch(FILES[cue]);
            if (!res.ok) return;
            const data = await res.arrayBuffer();
            this.buffers.set(cue, await ctx.decodeAudioData(data.slice(0)));
          } catch {
            /* a missing file must never break the app */
          }
        }),
      );
    })();
    return this.loading;
  }

  private context(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Play one cue. Silently no-ops when disabled or unloaded. */
  play(cue: Cue): void {
    if (!this.prefs.master) return;
    if (cue === 'button' && !this.prefs.buttonSound) return;
    if (!this.prefs.cues[cue]) return;

    // Guard against the same cue retriggering within one animation frame burst.
    const now = performance.now();
    if ((this.lastAt.get(cue) ?? 0) + 90 > now) return;
    this.lastAt.set(cue, now);

    const ctx = this.context();
    const buffer = this.buffers.get(cue);
    if (!ctx || !buffer) {
      void this.preload();
      return;
    }
    try {
      if (ctx.state === 'suspended') void ctx.resume();
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buffer;
      // Scanner cues stay loud; notifications sit slightly back so a scan beep
      // is never buried by a chime.
      const base = cue === 'scanSuccess' || cue === 'scanError' ? 1 : 0.85;
      gain.gain.value = Math.max(0, Math.min(1, this.prefs.volume)) * base;
      src.connect(gain).connect(ctx.destination);
      src.start();
    } catch {
      /* never let audio break a workflow */
    }
  }

  /** Haptics: native patterns where supported, silently ignored otherwise. */
  vibrate(cue: Cue): void {
    if (!this.prefs.vibration) return;
    const isScan = cue === 'scanSuccess' || cue === 'scanError' || cue === 'duplicate';
    if (isScan && !this.prefs.vibrateScanner) return;
    if (!isScan && !this.prefs.vibrateNotifications) return;
    const pattern = VIBRATION[cue];
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern as number | number[]);
      }
    } catch {
      /* ignore */
    }
  }

  /** Convenience: cue + haptic in one call. */
  feedback(cue: Cue): void {
    this.play(cue);
    this.vibrate(cue);
  }
}

export const SoundManager = new SoundManagerImpl();
