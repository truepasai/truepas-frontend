/** @jsxImportSource react */
/**
 * Settings — real device settings first:
 * - Security: App lock (fingerprint / face unlock on open, expo-local-
 *   authentication) and a shortcut to Security & sign-in.
 * - Feedback: Haptics on/off (all vibration goes through services/haptics).
 * - Check-in: "Face check-in at venues" is the account preference
 *   faceCheckInEnabled (GET/PUT /user/me/preferences). Off is enforced at the
 *   kiosk — it refuses face check-in for the account holder.
 * - Notifications: which alerts you get (/notification/preferences).
 * - Phone permissions: camera and photos open the system settings page for
 *   TruePas. The app never asks for notification permission (no push yet).
 *   Phone notifications and Language aren't listed until they ship.
 * Then account, support and legal links.
 */
import {
  BellRing,
  Camera,
  CircleHelp,
  Database,
  FileText,
  Fingerprint,
  Info,
  Lock,
  Pencil,
  ScanFace,
  ShieldCheck,
  Trash2,
  Vibrate,
} from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { toApiError } from '@/api/errors';
import { usePreferences, useUpdatePreferences } from '@/features/account/hooks';
import { biometricsAvailable, confirmWithBiometrics, markUnlocked } from '@/features/settings/AppLock';
import { useToast } from '@/hooks/useToast';
import { APP_VERSION } from '@/premium/flows/account';
import { ConfirmSheet } from '@/premium/kit';
import { C } from '@/premium/theme';
import { go, Group, Heading, ListRow, Screen, Toggle, TopBar, Txt } from '@/premium/ui';
import { selectHaptic } from '@/services/haptics';
import { setPref, usePref } from '@/services/prefs';

export default function SettingsScreen() {
  const toast = useToast();
  const appLock = usePref('appLock');
  const haptics = usePref('haptics');
  const [busy, setBusy] = useState(false);
  const [confirmFaceOff, setConfirmFaceOff] = useState(false);
  const native = Platform.OS !== 'web';
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const faceCheckIn = prefs.data?.faceCheckInEnabled;

  const setFaceCheckIn = async (next: boolean) => {
    try {
      await updatePrefs.mutateAsync({ faceCheckInEnabled: next });
      toast.show('success', next ? 'Face check-in is on' : 'Face check-in is off');
    } catch (err) {
      toast.show('error', toApiError(err).message || "Couldn't save. Please try again.");
    } finally {
      setConfirmFaceOff(false);
    }
  };

  const toggleAppLock = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!next) {
        await setPref('appLock', false);
        return;
      }
      if (!(await biometricsAvailable())) {
        toast.show('error', 'Set up fingerprint or face unlock on your phone first.');
        return;
      }
      if (await confirmWithBiometrics('Turn on app lock')) {
        markUnlocked();
        await setPref('appLock', true);
        toast.show('success', 'App lock is on');
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleHaptics = async (next: boolean) => {
    await setPref('haptics', next);
    if (next) selectHaptic();
  };

  const openPhoneSettings = () => {
    Linking.openSettings().catch(() => toast.show('error', "Couldn't open your phone settings."));
  };

  return (
    <Screen header={<TopBar title="Settings" />} contentStyle={{ paddingTop: 4 }}>
      <Heading title="Make it" accent="yours." />

      <Group title="Security">
        <ListRow
          icon={Fingerprint}
          tone="sky"
          title="App lock"
          sub={native ? 'Unlock TruePas with your fingerprint or face' : 'Available in the mobile app'}
          trailing={<Toggle on={appLock} disabled={!native || busy} onChange={(v) => void toggleAppLock(v)} label="App lock" />}
          chevron={false}
        />
        <ListRow icon={ShieldCheck} tone="sky" title="Security & sign-in" sub="Face, PIN, password & consent" onPress={go('/security')} />
      </Group>

      <Group title="Feedback">
        <ListRow
          icon={Vibrate}
          tone="sky"
          title="Haptics"
          sub="Gentle vibration on taps, codes and scans"
          trailing={<Toggle on={haptics} onChange={(v) => void toggleHaptics(v)} label="Haptics" />}
          chevron={false}
        />
      </Group>

      <Group title="Check-in">
        <ListRow
          icon={ScanFace}
          tone="sky"
          title="Face check-in at venues"
          sub={
            prefs.isError && faceCheckIn == null
              ? "Couldn't load — tap to try again"
              : faceCheckIn === false
                ? "Off — venue kiosks won't check you in with your face"
                : 'Venue kiosks can check you in with your face'
          }
          chevron={false}
          onPress={prefs.isError && faceCheckIn == null ? () => void prefs.refetch() : undefined}
          trailing={
            <Toggle
              on={!!faceCheckIn}
              disabled={faceCheckIn == null || updatePrefs.isPending}
              onChange={(v) => (v ? void setFaceCheckIn(true) : setConfirmFaceOff(true))}
              label="Face check-in at venues"
            />
          }
        />
      </Group>

      <Group title="Notifications">
        <ListRow
          icon={BellRing}
          tone="sky"
          title="Notification preferences"
          sub="Choose which alerts you get"
          onPress={go('/notification/preferences')}
        />
      </Group>

      <Group title="Phone permissions">
        <ListRow icon={Camera} tone="sky" title="Camera & photos" sub="Face scans, documents and family photos" onPress={openPhoneSettings} />
      </Group>

      <Group title="Account">
        <ListRow icon={Pencil} title="Edit profile" onPress={go('/profile/edit')} />
        <ListRow icon={Database} title="Biometric data & privacy" sub="Retention, consent and deletion" onPress={go('/legal/data-privacy')} />
        <ListRow icon={Trash2} danger title="Delete account" onPress={go('/account/delete')} />
      </Group>

      <Group title="Support & legal">
        <ListRow icon={CircleHelp} title="Help & FAQ" sub="Answers and contact support" onPress={go('/help')} />
        <ListRow icon={Info} title="About TruePas" onPress={go('/about')} />
        <ListRow icon={Lock} title="Privacy Policy" onPress={go('/legal/privacy-policy')} />
        <ListRow icon={FileText} title="Terms of Service" onPress={go('/legal/terms')} />
      </Group>

      <Txt v="small" color={C.ink4} center>
        TruePas {APP_VERSION}
      </Txt>

      <ConfirmSheet
        visible={confirmFaceOff}
        icon={ScanFace}
        title="Turn off face check-in?"
        body="Venue kiosks will refuse to check you in with your face until you turn this back on. Your enrolled face isn't deleted."
        confirmLabel="Turn off"
        loading={updatePrefs.isPending}
        onCancel={() => setConfirmFaceOff(false)}
        onConfirm={() => void setFaceCheckIn(false)}
      />
    </Screen>
  );
}
