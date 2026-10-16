/**
 * Device preferences from Settings (haptics, app lock). Kept on this device in
 * SecureStore (localStorage on web), cached in memory and readable from React
 * via usePref. Not tied to the account: there is no preferences API yet.
 */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type Prefs = {
  /** Vibration feedback on taps, codes and scans. */
  haptics: boolean;
  /** Ask for fingerprint / face unlock when opening the app. */
  appLock: boolean;
  /** The one-time "Unlock TruePas with Face ID?" offer was answered. */
  appLockAsked: boolean;
};

const DEFAULTS: Prefs = { haptics: true, appLock: false, appLockAsked: false };
const KEY = 'truepas.prefs.v1';

let current: Prefs = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(KEY, value);
    } catch {
      // private mode — keep the in-memory value
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

function emit() {
  listeners.forEach((l) => l());
}

/** Load saved prefs once at startup; safe to call repeatedly. */
export async function loadPrefs(): Promise<Prefs> {
  if (loaded) return current;
  try {
    const raw = await read();
    if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    current = DEFAULTS;
  }
  loaded = true;
  emit();
  return current;
}

export function getPrefs(): Prefs {
  return current;
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  current = { ...current, [key]: value };
  emit();
  try {
    await write(JSON.stringify(current));
  } catch {
    // keep the in-memory value for this session
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(
    subscribe,
    () => current[key],
    () => current[key],
  );
}

/** True once saved prefs have been read (the app lock waits for this). */
export function usePrefsLoaded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => loaded,
    () => loaded,
  );
}
