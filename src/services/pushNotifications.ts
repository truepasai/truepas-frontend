/**
 * Phone push (§9.2) — Expo push token ↔ POST/DELETE /cb/user/me/devices.
 *
 * Registered after every sign-in and app start while signed in (the backend
 * upserts the same token, so repeats are safe) and again when the OS rotates
 * the token. Removed on a normal logout. Everything here is best effort: a
 * denied permission, a simulator, a missing FCM/APNs setup or a failed call
 * must never block sign-in or logout.
 *
 * Push payloads carry the same `data` as the inbox item, so a tap reuses
 * `notificationHref` (see usePushNotifications).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

// Shown as a banner while the app is open too — a check-in confirmation
// usually lands while the user is looking at the phone.
if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** The backend id of this phone's device row — needed for DELETE on logout.
 *  In memory only: every app start re-registers and gets it back. */
let deviceId: string | null = null;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'TruePas alerts',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Asks only while the choice is still open — never re-prompts after "Don't allow". */
async function hasPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function sendToken(token: string): Promise<void> {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const device = await api.registerPushDevice(token, platform);
  deviceId = device.id;
}

/** Ask for permission (first time only), fetch the Expo token, register it. */
export async function registerForPush(): Promise<void> {
  if (!isNative || !Device.isDevice) return;
  try {
    // Android 13+: the channel must exist before the permission prompt shows.
    await ensureAndroidChannel();
    if (!(await hasPermission())) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await sendToken(data);
  } catch (e) {
    // e.g. no FCM credentials in this build — push stays off, nothing else breaks.
    console.warn('[Push] registration failed', e);
  }
}

/** Re-register when the OS hands out a new token. Returns the unsubscribe. */
export function watchPushToken(): () => void {
  if (!isNative) return () => {};
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush();
  });
  return () => sub.remove();
}

/**
 * Stop push to this phone. Must run while the session is still valid (before
 * POST /auth/logout). Capped at 3 s so a slow network can't hold up logout.
 */
export async function unregisterFromPush(): Promise<void> {
  const id = deviceId;
  deviceId = null;
  if (!id) return;
  try {
    await Promise.race([
      api.deletePushDevice(id),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // Best effort — logout continues.
  }
}

/** Forget the device id without a server call (session already gone). */
export function forgetPushDevice(): void {
  deviceId = null;
}
