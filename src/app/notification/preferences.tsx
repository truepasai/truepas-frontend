/** @jsxImportSource react */
/**
 * Notification preferences — GET/PUT /cb/user/me/notification-preferences.
 * Four push categories; each toggle sends only its own key (optimistic, rolls
 * back on error). Off stops push only: the inbox still records the item.
 * `security` covers both account and identity notifications.
 * The phone registers for push after sign-in (services/pushNotifications);
 * if the OS permission is off, the note below points to the phone's settings.
 */
import { CalendarClock, FileText, type LucideIcon, ShieldCheck, Users } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';

import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/features/notifications/hooks';
import { useToast } from '@/hooks/useToast';
import { Async, Bone } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Card, Divider, Group, Heading, ListRow, Screen, Toggle, TopBar, Txt } from '@/premium/ui';
import type { NotificationPreferences } from '@/types/domain';

const ROWS: { key: keyof NotificationPreferences; icon: LucideIcon; title: string; sub: string }[] = [
  { key: 'checkin', icon: CalendarClock, title: 'Check-ins', sub: 'Check-ins and reservations' },
  { key: 'family', icon: Users, title: 'Family', sub: 'Members added or removed' },
  { key: 'security', icon: ShieldCheck, title: 'Security', sub: 'Covers sign-in, PIN, password and face changes' },
  { key: 'document', icon: FileText, title: 'Documents', sub: 'Documents verified or rejected' },
];

/** Same shape as the loaded group: tile, two lines, toggle. */
function PrefsSkeleton() {
  return (
    <View style={{ gap: 10 }}>
      <Bone w={110} h={11} style={{ marginLeft: 4 }} />
      <Card pad={0} style={{ paddingHorizontal: 16 }}>
        {ROWS.map((r, i) => (
          <View key={r.key}>
            {i > 0 && <Divider inset={54} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
              <Bone w={40} h={40} r={13} />
              <View style={{ flex: 1, gap: 8 }}>
                <Bone w="40%" />
                <Bone w="70%" h={11} />
              </View>
              <Bone w={50} h={30} r={15} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

/** True when the OS blocks notifications for the app. Re-checked on return
 *  from the phone's settings. Always false on web (no push there). */
function usePushPermissionOff() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () =>
      void Notifications.getPermissionsAsync()
        .then((p) => setOff(!p.granted))
        .catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);
  return off;
}

export default function NotificationPreferencesScreen() {
  const toast = useToast();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const pushOff = usePushPermissionOff();

  const set = (key: keyof NotificationPreferences, on: boolean) =>
    update.mutate({ [key]: on }, { onError: () => toast.show('error', "Couldn't save that. Try again.") });

  return (
    <Screen header={<TopBar title="Notification preferences" />} contentStyle={{ paddingTop: 4 }}>
      <Heading
        title="Choose your"
        accent="alerts."
        sub="Choose which alerts we'll send to your phone. Your inbox still shows them all."
      />

      <Async q={prefs} skeleton={<PrefsSkeleton />}>
        {(p) => (
          <View style={{ gap: 14 }}>
            <Group title="Phone alerts">
              {ROWS.map((r) => (
                <ListRow
                  key={r.key}
                  icon={r.icon}
                  tone="sky"
                  title={r.title}
                  sub={r.sub}
                  chevron={false}
                  trailing={<Toggle on={p[r.key]} onChange={(v) => set(r.key, v)} label={r.title} />}
                />
              ))}
            </Group>
            {pushOff && (
              <View style={{ gap: 8, alignItems: 'center' }}>
                <Txt v="small" color={C.ink4} center>
                  Notifications are turned off for TruePas on this phone. Turn them on in your phone&apos;s settings to get these alerts.
                </Txt>
                <Button label="Open phone settings" tone="ghost" onPress={() => void Linking.openSettings()} />
              </View>
            )}
          </View>
        )}
      </Async>
    </Screen>
  );
}
