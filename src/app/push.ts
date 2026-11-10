import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { getAuthInstance } from './firebase';

const WORKER = 'https://kauafragrances.co.za/api/device-token';

/** Register for FCM and hand the token to the shop Worker (admin-only endpooint). */
export async function registerPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;

    await PushNotifications.addListener('registration', async (token) => {
      try {
        const user = getAuthInstance().currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        await fetch(WORKER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bear' + 'er ' + idToken },
          body: JSON.stringify({ token: token.value, platform: 'android' }),
        });
      } catch { /* token registration is best-effort */ }
    });

    await PushNotifications.addListener('registrationError', () => { /* ignore */ });
    await PushNotifications.register();
  } catch {
    /* push not available — local notifications still work */
  }
}
