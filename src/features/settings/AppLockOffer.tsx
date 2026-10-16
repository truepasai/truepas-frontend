/** @jsxImportSource react */
/**
 * One-time offer on Home: "Unlock TruePas with Face ID?". Shown once per
 * phone, only when the phone has Face ID / fingerprint set up and App lock is
 * off. Turn on runs the biometric prompt first (it also triggers iOS's Face ID
 * permission), then enables App lock. Not now (or dismissing) never asks
 * again; Settings → App lock stays the way to turn it on later.
 */
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useToast } from '@/hooks/useToast';
import { ConfirmSheet } from '@/premium/kit';
import { setPref, usePref, usePrefsLoaded } from '@/services/prefs';

import { biometricsAvailable, confirmWithBiometrics, markUnlocked, useBiometricName } from './AppLock';

/** Lets Home settle (and its own sheets) before offering. */
const OFFER_DELAY_MS = 1200;

export function AppLockOffer() {
  const toast = useToast();
  const loaded = usePrefsLoaded();
  const appLock = usePref('appLock');
  const asked = usePref('appLockAsked');
  const name = useBiometricName();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const eligible = Platform.OS !== 'web' && loaded && !appLock && !asked;

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    const timer = setTimeout(() => {
      void biometricsAvailable().then((ok) => {
        if (alive && ok) setVisible(true);
      });
    }, OFFER_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [eligible]);

  const close = () => {
    setVisible(false);
    void setPref('appLockAsked', true);
  };

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await confirmWithBiometrics('Turn on app lock')) {
        markUnlocked();
        await setPref('appLock', true);
        toast.show('success', 'App lock is on');
      }
    } finally {
      setBusy(false);
      close();
    }
  };

  const faceId = name === 'Face ID';
  const label = name === 'fingerprint or face unlock' ? 'your fingerprint or face' : name;

  return (
    <ConfirmSheet
      visible={visible}
      icon={faceId ? ScanFace : Fingerprint}
      title={`Unlock TruePas with ${label}?`}
      body={`Your IDs and your family's live here. TruePas will ask for ${label} when you open it and after a minute away. You can change this in Settings.`}
      confirmLabel="Turn on"
      cancelLabel="Not now"
      loading={busy}
      onConfirm={() => void turnOn()}
      onCancel={() => {
        if (!busy) close();
      }}
    />
  );
}
