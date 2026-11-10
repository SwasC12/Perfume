import { Capacitor } from '@capacitor/core';
import { Importance, LocalNotifications } from '@capacitor/local-notifications';

/**
 * Native Android notification channels. Each channel owns its sound and
 * vibration behaviour — Android decides how to play it when the app is in the
 * background or closed, so these work without any JavaScript running.
 *
 * Sound names map to android/app/src/main/res/raw/<name>.wav
 */
export type ChannelId = 'general' | 'inventory' | 'orders' | 'important';

const CHANNELS: { id: ChannelId; name: string; description: string; sound: string; importance: 3 | 4 | 5 }[] = [
  { id: 'general', name: 'General notifications', description: 'App updates and messages', sound: 'notification_general', importance: 3 },
  { id: 'inventory', name: 'Inventory alerts', description: 'Low stock and stock movements', sound: 'notification_inventory', importance: 4 },
  { id: 'orders', name: 'Order notifications', description: 'New orders, dispatch and completion', sound: 'notification_order', importance: 4 },
  { id: 'important', name: 'Important alerts', description: 'Critical operational warnings', sound: 'notification_important', importance: 5 },
];

let ready = false;
let nextId = 1;

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Create channels + ask for permission. Safe to call more than once. */
export async function initNotifications(): Promise<void> {
  if (!isNative() || ready) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') await LocalNotifications.requestPermissions();

    for (const ch of CHANNELS) {
      try {
        await LocalNotifications.createChannel({
          id: ch.id,
          name: ch.name,
          description: ch.description,
          importance: ch.importance as Importance,
          sound: ch.sound,
          vibration: true,
          lights: false,
          visibility: 1,
        });
      } catch {
        /* a channel that already exists is fine */
      }
    }
    ready = true;
  } catch {
    /* notifications unavailable — in-app feedback still works */
  }
}

/** Post a native notification on a channel. No-op on the web build. */
export async function notify(channel: ChannelId, title: string, body: string): Promise<void> {
  if (!isNative()) return;
  try {
    await initNotifications();
    await LocalNotifications.schedule({
      notifications: [{ id: nextId++, title, body, channelId: channel, smallIcon: 'ic_stat_icon_config_sample' }],
    });
  } catch {
    /* never break a workflow because a notification failed */
  }
}
