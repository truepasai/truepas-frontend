import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Server-imposed waits the app only learns about from a 429 — the address
 * change cooldown (15 days) and the face update limit (3 failures / 24 h).
 * Neither has a "when can I retry" endpoint, so the deadline from
 * `retry_after` is kept here (memory + device storage) to keep the button
 * disabled until it passes, across app restarts too.
 *
 * Keys include the account id (see cooldownKey) so one account's wait never
 * blocks another account signed in on the same phone.
 */
const STORAGE_KEY = 'truepas.cooldowns';
const isWeb = Platform.OS === 'web';

let deadlines: Record<string, number> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

async function readStore(): Promise<string | null> {
  if (isWeb) return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeStore(): Promise<void> {
  // Drop deadlines that have passed so the stored map stays small.
  const now = Date.now();
  deadlines = Object.fromEntries(Object.entries(deadlines).filter(([, until]) => until > now));
  const value = JSON.stringify(deadlines);
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

function load(): Promise<void> {
  loaded ??= readStore()
    .then((raw) => {
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      // Anything set in memory before the read finished wins.
      deadlines = { ...parsed, ...deadlines };
      notify();
    })
    .catch(() => {});
  return loaded;
}

export function cooldownKey(kind: 'address-update' | 'face-update', accountId: string, personId?: string): string {
  return [kind, accountId, personId].filter(Boolean).join(':');
}

/** Start a wait of `seconds` for `key`. */
export function setCooldown(key: string, seconds: number): void {
  deadlines[key] = Date.now() + Math.max(0, seconds) * 1000;
  notify();
  void load().then(writeStore).catch(() => {});
}

export function clearCooldown(key: string): void {
  if (!(key in deadlines)) return;
  delete deadlines[key];
  notify();
  void load().then(writeStore).catch(() => {});
}

/** Seconds left for `key` (0 = free to try). */
export function cooldownSecondsLeft(key: string): number {
  const until = deadlines[key];
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

/** Live seconds-left for `key`; re-renders as it counts down. Pass null to skip. */
export function useCooldown(key: string | null): number {
  const [left, setLeft] = useState(() => (key ? cooldownSecondsLeft(key) : 0));
  useEffect(() => {
    if (!key) return;
    const update = () => setLeft(cooldownSecondsLeft(key));
    listeners.add(update);
    void load().then(update);
    const t = setInterval(update, 1000);
    return () => {
      listeners.delete(update);
      clearInterval(t);
    };
  }, [key]);
  return key ? left : 0;
}
