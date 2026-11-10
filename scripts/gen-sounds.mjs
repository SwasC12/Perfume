import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const dirs = ['android/app/src/main/res/raw', 'src/assets/sounds'];
for (const d of dirs) fs.mkdirSync(path.resolve(d), { recursive: true });

function env(t, dur, attack = 0.004, release = 0.06) {
  if (t < attack) return t / attack;
  const left = dur - t;
  if (left < release) return Math.max(0, left / release);
  return 1;
}

/** One tone with harmonics + optional pitch sweep. */
function tone(buf, start, dur, f0, f1, gain = 0.5, type = 'square') {
  const a = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = i / n;
    const f = f0 + (f1 - f0) * p;
    const phase = 2 * Math.PI * f * t;
    let s;
    if (type === 'square') s = Math.sign(Math.sin(phase)) * 0.65 + Math.sin(phase) * 0.35;
    else if (type === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else s = Math.sin(phase);
    // second harmonic adds the "scanner" edge
    s += 0.18 * Math.sin(2 * phase);
    const i2 = a + i;
    if (i2 < buf.length) buf[i2] += s * gain * env(t, dur);
  }
}

function render(durSec, fn) {
  const buf = new Float32Array(Math.floor(durSec * RATE));
  fn(buf);
  // soft clip + normalise to -1..1 headroom
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.82 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

function wav(buf, file) {
  const bytes = Buffer.alloc(44 + buf.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + buf.length * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    bytes.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  for (const d of dirs) fs.writeFileSync(path.resolve(d, file), bytes);
  console.log('wrote', file, (bytes.length / 1024).toFixed(1) + ' KB');
}

// A. SUCCESS — crisp double beep, 2 tones, ~130 ms
wav(render(0.16, (b) => {
  tone(b, 0.000, 0.055, 2350, 2350, 0.6, 'square');
  tone(b, 0.070, 0.050, 2900, 2900, 0.5, 'square');
}), 'scanner_success.wav');

// B. ERROR — descending two-tone, ~250 ms
wav(render(0.30, (b) => {
  tone(b, 0.000, 0.11, 520, 460, 0.55, 'tri');
  tone(b, 0.130, 0.13, 330, 250, 0.5, 'tri');
}), 'scanner_error.wav');

// C. DUPLICATE — single soft low blip, ~110 ms
wav(render(0.14, (b) => {
  tone(b, 0.000, 0.085, 640, 600, 0.35, 'tri');
}), 'scanner_duplicate.wav');

// D. STOCK RECEIVED — three ascending, ~520 ms
wav(render(0.60, (b) => {
  tone(b, 0.000, 0.14, 660, 660, 0.4, 'sine');
  tone(b, 0.150, 0.14, 880, 880, 0.42, 'sine');
  tone(b, 0.300, 0.22, 1170, 1170, 0.45, 'sine');
}), 'stock_received.wav');

// E. ORDER COMPLETED — richer triad, ~600 ms
wav(render(0.68, (b) => {
  tone(b, 0.000, 0.16, 784, 790, 0.4, 'sine');
  tone(b, 0.170, 0.16, 988, 995, 0.4, 'sine');
  tone(b, 0.340, 0.26, 1319, 1325, 0.42, 'sine');
}), 'order_completed.wav');

// F. ORDER DISPATCHED — two quick confirm tones, ~240 ms
wav(render(0.28, (b) => {
  tone(b, 0.000, 0.09, 900, 980, 0.45, 'square');
  tone(b, 0.110, 0.10, 1240, 1300, 0.42, 'square');
}), 'order_dispatched.wav');

// G. LOW STOCK — gentle descending warning, ~300 ms
wav(render(0.34, (b) => {
  tone(b, 0.000, 0.12, 620, 600, 0.35, 'sine');
  tone(b, 0.140, 0.14, 500, 480, 0.35, 'sine');
}), 'low_stock.wav');

// H. BUTTON — very short tick, ~40 ms
wav(render(0.05, (b) => {
  tone(b, 0.000, 0.028, 1400, 1200, 0.18, 'square');
}), 'button_tap.wav');

// Notifications
wav(render(0.45, (b) => {
  tone(b, 0.000, 0.12, 880, 880, 0.35, 'sine');
  tone(b, 0.130, 0.18, 1100, 1100, 0.33, 'sine');
}), 'notification_general.wav');

wav(render(0.50, (b) => {
  tone(b, 0.000, 0.14, 600, 560, 0.4, 'tri');
  tone(b, 0.150, 0.18, 450, 420, 0.4, 'tri');
}), 'notification_inventory.wav');

wav(render(0.50, (b) => {
  tone(b, 0.000, 0.13, 880, 900, 0.35, 'sine');
  tone(b, 0.140, 0.18, 1320, 1320, 0.35, 'sine');
}), 'notification_order.wav');

wav(render(0.62, (b) => {
  tone(b, 0.000, 0.14, 520, 520, 0.5, 'square');
  tone(b, 0.160, 0.14, 390, 390, 0.5, 'square');
  tone(b, 0.320, 0.18, 520, 520, 0.5, 'square');
}), 'notification_important.wav');
