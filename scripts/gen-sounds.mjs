/**
 * Generates every UI sound as a small 16-bit WAV.
 *
 * Style: enterprise handheld scanner. Short, bright piezo-like beeps that cut
 * through warehouse noise, a single clean "good read", a low buzz for errors.
 * All tones are synthesised here from scratch (no sampled audio).
 *
 *   node scripts/gen-sounds.mjs
 *
 * Writes to public/sounds (web + APK assets) and android res/raw (native
 * notification sounds).
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const dirs = ['public/sounds', 'android/app/src/main/res/raw'];
for (const d of dirs) fs.mkdirSync(path.resolve(d), { recursive: true });

/** Band-limited waveforms: additive harmonics, so no aliasing fizz. */
const WAVES = {
  // piezo beeper: odd harmonics, rolled off faster than a true square
  piezo: [[1, 1], [3, 0.28], [5, 0.11], [7, 0.05]],
  // softer, rounder chime
  bell: [[1, 1], [2, 0.18], [3, 0.06]],
  // buzzy error tone
  buzz: [[1, 1], [2, 0.35], [3, 0.3], [4, 0.15], [5, 0.12]],
  sine: [[1, 1]],
};

/**
 * Add one tone into buf.
 * attack/release in seconds; decay>0 gives an exponential bell-like tail.
 */
function tone(buf, { at, dur, f, f1 = f, gain = 0.5, wave = 'piezo', attack = 0.002, release = 0.012, decay = 0 }) {
  const a = Math.floor(at * RATE);
  const n = Math.floor(dur * RATE);
  const partials = WAVES[wave];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = f + (f1 - f) * (i / n);
    phase += (2 * Math.PI * freq) / RATE;
    let s = 0;
    for (const [h, amp] of partials) if (freq * h < RATE / 2.2) s += Math.sin(phase * h) * amp;
    let e = 1;
    if (t < attack) e = t / attack;
    else if (dur - t < release) e = Math.max(0, (dur - t) / release);
    if (decay > 0) e *= Math.exp(-t / decay);
    const j = a + i;
    if (j < buf.length) buf[j] += s * gain * e;
  }
}

function render(durSec, tones, peak = 0.89) {
  const buf = new Float32Array(Math.ceil(durSec * RATE));
  for (const t of tones) tone(buf, t);
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * k * 1.1) / Math.tanh(1.1);
  return buf;
}

function wav(file, buf) {
  const bytes = Buffer.alloc(44 + buf.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + buf.length * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  }
  for (const d of dirs) fs.writeFileSync(path.resolve(d, file), bytes);
  console.log('wrote', file.padEnd(28), (bytes.length / 1024).toFixed(1).padStart(5), 'KB', Math.round(buf.length / RATE * 1000) + ' ms');
}

// ---------------------------------------------------------------- scanner

// GOOD READ: the classic rugged-handheld decode beep. One very short,
// loud, square-ish piezo tone with an instant attack and no tail.
const decode = (f, dur = 0.07) => render(dur + 0.01, [{ at: 0, dur, f, gain: 0.8, wave: 'piezo', attack: 0.001, release: 0.006 }], 0.95);
wav('scanner_success.wav', decode(2730));          // default ('classic')
wav('scanner_success_high.wav', decode(3500, 0.06));
wav('scanner_success_low.wav', decode(1950, 0.08));
wav('scanner_success_chirp.wav', render(0.1, [
  { at: 0, dur: 0.04, f: 2300, gain: 0.75, wave: 'piezo', attack: 0.001, release: 0.004 },
  { at: 0.045, dur: 0.05, f: 3070, gain: 0.75, wave: 'piezo', attack: 0.001, release: 0.006 },
], 0.95));

// ERROR / NO MATCH: long low buzz, then a short one. The 'reject' sound.
wav('scanner_error.wav', render(0.42, [
  { at: 0.0, dur: 0.2, f: 410, gain: 0.7, wave: 'buzz', attack: 0.002 },
  { at: 0.26, dur: 0.14, f: 410, gain: 0.7, wave: 'buzz', attack: 0.002 },
], 0.95));

// DUPLICATE: two quick decode-pitch blips, quieter.
wav('scanner_duplicate.wav', render(0.18, [
  { at: 0.0, dur: 0.045, f: 2730, gain: 0.55, attack: 0.001, release: 0.005 },
  { at: 0.09, dur: 0.045, f: 2730, gain: 0.55, attack: 0.001, release: 0.005 },
], 0.7));

// -------------------------------------------------------------- workflow

// STOCK RECEIVED: rising three-step confirm.
wav('stock_received.wav', render(0.34, [
  { at: 0.0, dur: 0.07, f: 1568, gain: 0.5 },
  { at: 0.09, dur: 0.07, f: 2093, gain: 0.5 },
  { at: 0.18, dur: 0.14, f: 2637, gain: 0.5, decay: 0.12 },
]));

// ORDER COMPLETED: bright major arpeggio with a ringing tail.
wav('order_completed.wav', render(0.6, [
  { at: 0.0, dur: 0.12, f: 1319, gain: 0.45, wave: 'bell', decay: 0.1 },
  { at: 0.1, dur: 0.12, f: 1661, gain: 0.45, wave: 'bell', decay: 0.1 },
  { at: 0.2, dur: 0.38, f: 1976, gain: 0.5, wave: 'bell', decay: 0.18 },
]));

// ORDER DISPATCHED: quick up-chirp pair, "sent".
wav('order_dispatched.wav', render(0.24, [
  { at: 0.0, dur: 0.07, f: 1800, f1: 2300, gain: 0.5 },
  { at: 0.1, dur: 0.11, f: 2300, f1: 2900, gain: 0.5, decay: 0.09 },
]));

// LOW STOCK: two descending mid tones, attention without alarm.
wav('low_stock.wav', render(0.34, [
  { at: 0.0, dur: 0.12, f: 1175, gain: 0.5, wave: 'bell', decay: 0.1 },
  { at: 0.15, dur: 0.17, f: 880, gain: 0.5, wave: 'bell', decay: 0.12 },
]));

// BUTTON: a tiny keypad click.
wav('button_tap.wav', render(0.03, [
  { at: 0, dur: 0.018, f: 3200, gain: 0.35, attack: 0.0005, release: 0.008, decay: 0.006 },
], 0.5));

// ---------------------------------------------------------- notifications

// General: soft two-note chime.
wav('notification_general.wav', render(0.5, [
  { at: 0.0, dur: 0.18, f: 1568, gain: 0.45, wave: 'bell', decay: 0.14 },
  { at: 0.14, dur: 0.34, f: 2093, gain: 0.45, wave: 'bell', decay: 0.2 },
]));

// New order: three rising notes, the "cha-ching" of the back office.
wav('notification_order.wav', render(0.62, [
  { at: 0.0, dur: 0.12, f: 1319, gain: 0.45, wave: 'bell', decay: 0.1 },
  { at: 0.11, dur: 0.12, f: 1760, gain: 0.45, wave: 'bell', decay: 0.1 },
  { at: 0.22, dur: 0.4, f: 2637, gain: 0.5, wave: 'bell', decay: 0.2 },
]));

// Inventory: two low-mid steps down.
wav('notification_inventory.wav', render(0.5, [
  { at: 0.0, dur: 0.16, f: 1175, gain: 0.5, wave: 'bell', decay: 0.12 },
  { at: 0.17, dur: 0.3, f: 784, gain: 0.5, wave: 'bell', decay: 0.18 },
]));

// Important: insistent triple beep, repeated pitch.
wav('notification_important.wav', render(0.56, [
  { at: 0.0, dur: 0.1, f: 2200, gain: 0.55 },
  { at: 0.16, dur: 0.1, f: 2200, gain: 0.55 },
  { at: 0.32, dur: 0.2, f: 2200, gain: 0.55, decay: 0.15 },
]));

// ------------------------------------------------------------- general UI

// CONFIRM (saved / updated): short two-step up, quieter than a scan.
wav('ui_confirm.wav', render(0.16, [
  { at: 0.0, dur: 0.05, f: 2093, gain: 0.45 },
  { at: 0.06, dur: 0.09, f: 2637, gain: 0.45, decay: 0.07 },
], 0.6));
