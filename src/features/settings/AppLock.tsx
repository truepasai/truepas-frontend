/** @jsxImportSource react */
/**
 * Settings → App lock. While signed in and enabled, the app asks for the
 * phone's fingerprint / face unlock (device PIN as fallback) on a cold start
 * and when it comes back after LOCK_AFTER_MS in the background. Short trips
 * out (the camera or photo picker) don't lock. Native only.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { Lock } from 'lucide-react-native';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Glow } from '@/premium/blocks';
import { C, G } from '@/premium/theme';
import { Button, Txt } from '@/premium/ui';
import { usePref, usePrefsLoaded } from '@/services/prefs';
import { useAppSelector } from '@/store';

const LOCK_AFTER_MS = 60_000;

/** Fingerprint / face unlock prompt. Resolves true when the user passes. */
export async function confirmWithBiometrics(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel' });
    return result.success;
  } catch {
    return false;
  }
}

/** Whether the phone has fingerprint / face unlock set up. */
export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Name of the phone's unlock, as people know it: "Face ID" / "Touch ID" on
 *  iPhone; Android mixes fingerprint and face, so it says both. */
export type BiometricName = 'Face ID' | 'Touch ID' | 'fingerprint or face unlock';

let biometricNameCache: BiometricName | null = null;

export async function biometricName(): Promise<BiometricName> {
  if (biometricNameCache) return biometricNameCache;
  let name: BiometricName = 'fingerprint or face unlock';
  if (Platform.OS === 'ios') {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      name = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? 'Face ID' : 'Touch ID';
    } catch {
      name = 'Face ID';
    }
  }
  biometricNameCache = name;
  return name;
}

/** biometricName() for render; Android's wording until it resolves. */
export function useBiometricName(): BiometricName {
  const [name, setName] = useState<BiometricName>(biometricNameCache ?? (Platform.OS === 'ios' ? 'Face ID' : 'fingerprint or face unlock'));
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let alive = true;
    void biometricName().then((n) => {
      if (alive) setName(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return name;
}

/* Unlock state lives outside React: Settings marks the session unlocked right
   after the user confirms, and AppState events relock it. */
let sessionUnlocked = false;
const lockListeners = new Set<() => void>();

function setSessionUnlocked(v: boolean) {
  sessionUnlocked = v;
  lockListeners.forEach((l) => l());
}

/** Call after a successful biometric prompt outside the lock screen. */
export function markUnlocked() {
  setSessionUnlocked(true);
}

function useSessionUnlocked() {
  return useSyncExternalStore(
    (l) => {
      lockListeners.add(l);
      return () => {
        lockListeners.delete(l);
      };
    },
    () => sessionUnlocked,
    () => sessionUnlocked,
  );
}

let prompting = false;
async function unlock() {
  if (prompting) return;
  prompting = true;
  const ok = await confirmWithBiometrics('Unlock TruePas');
  prompting = false;
  if (ok) setSessionUnlocked(true);
}

export function AppLock() {
  const signedIn = useAppSelector((s) => s.auth.status === 'authenticated');
  const enabled = usePref('appLock');
  const loaded = usePrefsLoaded();
  const unlocked = useSessionUnlocked();
  const active = Platform.OS !== 'web' && signedIn && enabled;
  const locked = active && loaded && !unlocked;
  const backgroundAt = useRef<number | null>(null);
  const name = useBiometricName();

  // Relock after a while in the background; short trips (camera, photo
  // picker) don't count.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current != null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away > LOCK_AFTER_MS) {
          setSessionUnlocked(false);
          void unlock();
        }
      }
    });
    return () => sub.remove();
  }, [active]);

  // Cold start: ask as soon as the lock shows.
  useEffect(() => {
    if (locked) void unlock();
  }, [locked]);

  if (!locked) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000, alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
      <LinearGradient colors={G.night} style={StyleSheet.absoluteFill} />
      <Glow size={420} opacity={0.35} style={{ top: 80, alignSelf: 'center' }} />
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 22,
        }}
      >
        <Lock size={32} color={C.white} />
      </View>
      <Txt v="h2" color={C.white} center>
        TruePas is locked
      </Txt>
      <Txt v="body" color="rgba(255,255,255,0.7)" center style={{ marginTop: 8, marginBottom: 28 }}>
        {name === 'fingerprint or face unlock' ? 'Use your fingerprint or face to continue.' : `Use ${name} to continue.`}
      </Txt>
      <Button label="Unlock" icon={Lock} onPress={() => void unlock()} />
    </View>
  );
}
