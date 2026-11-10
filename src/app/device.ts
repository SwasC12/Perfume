import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** Native helpers implemented in android/.../KfDevicePlugin.java. */
interface KfDevicePlugin {
  setTriggerEnabled(opts: { enabled: boolean }): Promise<void>;
  shareToWhatsApp(opts: { path: string; phone?: string; text?: string }): Promise<void>;
  addListener(event: 'trigger', fn: (e: { key: 'up' | 'down' }) => void): Promise<PluginListenerHandle>;
}

const KfDevice = registerPlugin<KfDevicePlugin>('KfDevice');
export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** Volume keys are only captured while at least one subscriber wants them. */
let subscribers = 0;

/** Volume keys → scan trigger. Returns an unsubscribe function. */
export async function onHardwareTrigger(fn: () => void): Promise<() => void> {
  if (!isAndroidApp()) return () => {};
  try {
    subscribers++;
    if (subscribers === 1) await KfDevice.setTriggerEnabled({ enabled: true });
    const handle = await KfDevice.addListener('trigger', () => fn());
    let done = false;
    return () => {
      if (done) return;
      done = true;
      void handle.remove();
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers === 0) void KfDevice.setTriggerEnabled({ enabled: false }).catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** South African numbers → international digits (0821234567 → 27821234567). */
export function waDigits(phone: string | null | undefined): string {
  let d = String(phone || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '27' + d.slice(1);
  if (d.length === 9 && /^[6-8]/.test(d)) d = '27' + d;
  return d;
}

/** Open the customer's WhatsApp chat with a file attached (APK only). */
export async function whatsappFile(path: string, phone: string, text: string): Promise<boolean> {
  if (!isAndroidApp()) return false;
  await KfDevice.shareToWhatsApp({ path, phone: waDigits(phone), text });
  return true;
}
