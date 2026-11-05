/** @jsxImportSource react */
import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';

import { Wordmark } from '@/premium/blocks';
import { C, F } from '@/premium/theme';
import { Group, go, ListRow, Screen, TopBar, Txt } from '@/premium/ui';

/** Presenter's index of every screen (long-press the logo on Welcome). */
export const SCREENS: { group: string; items: [string, string][] }[] = [
  { group: 'Onboarding', items: [['Welcome', '/(auth)/welcome'], ['Sign in', '/(auth)/login'], ['Create account', '/(auth)/register'], ['Verify mobile', '/(auth)/verify-phone'], ['Verify email', '/(auth)/verify-email'], ['About you', '/(auth)/account-details'], ['Forgot password', '/(auth)/forgot-password']] },
  { group: 'Face setup', items: [['Your address', '/(onboarding)/address'], ['Biometric consent', '/(onboarding)/consent'], ['Face scan', '/(onboarding)/face-scan'], ["You're verified", '/(onboarding)/face-enrolled']] },
  { group: 'Main', items: [['Home', '/(tabs)'], ['Check-ins', '/(tabs)/history'], ['Wallet', '/(tabs)/documents'], ['Hotel stay & digital key', '/booking/t1'], ['Theme park visit', '/booking/t2'], ['My TruePas pass', '/identity'], ['Notifications', '/notification']] },
  { group: 'Face check-in', items: [['Live face check-in', '/face-update/camera'], ['Checked in', '/face-update/success'], ["Couldn't match", '/face-update/error'], ['Confirm with PIN', '/face-update/pin']] },
  { group: 'Documents', items: [['Choose document', '/document/select-type'], ['Scan document', '/document/scan'], ['Verifying', '/document/processing'], ['Verified', '/document/verified'], ['Details mismatch', '/document/mismatch'], ['Document detail', '/document/d1']] },
  { group: 'Family', items: [['Family', '/family'], ['Member', '/family/m1'], ['Member · face pending', '/family/m3'], ['Member activity', '/family/m1/activity'], ['Add member', '/family/add'], ['Member document', '/family/add/document'], ['Capture document', '/family/add/photo-capture'], ['Member face scan', '/family/add/face-capture'], ['Verifying member', '/family/add/processing'], ['Turns 18', '/notification/age-18']] },
  { group: 'Account', items: [['Profile', '/profile'], ['Edit profile', '/profile/edit'], ['Settings', '/settings'], ['Security', '/security'], ['Change password', '/security/change-password'], ['New PIN', '/security/change-pin'], ['Confirm PIN', '/security/confirm-pin'], ['Help', '/help'], ['About', '/about'], ['Terms', '/legal/terms'], ['Privacy policy', '/legal/privacy-policy'], ['Biometric data', '/legal/data-privacy'], ['Delete account', '/account/delete'], ['Deleting', '/account/delete/processing'], ['Deleted', '/account/delete/success']] },
];

export default function Showcase() {
  // Design demo full of mock links — dev builds only. In release the
  // truepasapp://showcase deep link falls through to the entry gate.
  if (!__DEV__) return <Redirect href="/" />;

  const total = SCREENS.reduce((n, g) => n + g.items.length, 0);
  return (
    <Screen header={<TopBar title="Screen index" />} contentStyle={{ paddingTop: 4 }}>
      <View style={{ gap: 8 }}>
        <Wordmark size={24} />
        <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -1, color: C.ink }}>TruePas 3.0 — UI preview</Text>
        <Txt v="body">{total} screens · tap any to open</Txt>
      </View>
      {SCREENS.map((g) => (
        <Group key={g.group} title={g.group}>
          {g.items.map(([label, href]) => (
            <ListRow key={href} title={label} sub={href} onPress={go(href)} />
          ))}
        </Group>
      ))}
    </Screen>
  );
}
