/** @jsxImportSource react */
/**
 * Security hub — security score, sign-in credentials, 2-step sign-in,
 * signed-in devices, biometric consent, danger zone.
 *
 * The score and its suggestions come from GET /user/me/security-score
 * (backend Oct 2026 §10.2) so every device shows the same number — nothing is
 * calculated on the phone. Each suggestion opens the screen that fixes it.
 * Sensitive flows (password/PIN change) route through the confirm-pin gate
 * first; face update has its own PIN step (/face-update/pin). Biometric
 * withdrawal deletes face templates server-side and sets faceEnrolled=false,
 * forcing re-enrollment. "Changed 3 days ago" lines and the 2-step status
 * come from GET /user/me.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  FileCheck2,
  FilePlus2,
  FileClock,
  Fingerprint,
  KeyRound,
  Lock,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { isMockApi } from '@/api';
import { toApiError } from '@/api/errors';
import { MOCK_PIN } from '@/api/mock';
import { useMe, useSecurityScore, useSessions } from '@/features/account/hooks';
import { useBiometricConsent } from '@/features/auth/mutations';
import { biometricConsentGiven, biometricConsentRevoked } from '@/features/auth/slice';
import { useToast } from '@/hooks/useToast';
import { Guilloche } from '@/premium/blocks';
import { timeAgo } from '@/premium/flows/account';
import { ConfirmSheet } from '@/premium/kit';
import { C, F, G, R, SH } from '@/premium/theme';
import { Group, ListRow, Row, Screen, TextLink, Toggle, TopBar, Txt } from '@/premium/ui';
import { useAppDispatch, useAppSelector } from '@/store';
import type { SecurityScore } from '@/types/domain';

type Suggestion = SecurityScore['suggestions'][number];

const SUGGESTION_ICON: Record<string, LucideIcon> = {
  enroll_face: ScanFace,
  add_document: FilePlus2,
  verify_document: FileCheck2,
  enable_2fa: ShieldCheck,
  renew_document: FileClock,
  change_password: Lock,
};

/** Where each server suggestion is fixed (§10.2). null → shown without a link. */
function suggestionHref(s: Suggestion): unknown {
  switch (s.id) {
    case 'enroll_face':
      return '/face-update/pin';
    case 'add_document':
      return '/document/select-type';
    case 'verify_document':
      return '/(tabs)/documents';
    case 'enable_2fa':
      return '/security/two-step';
    case 'renew_document':
      return s.documentId ? { pathname: '/document/[id]', params: { id: s.documentId } } : '/(tabs)/documents';
    case 'change_password':
      // Same PIN gate as the "Change password" row.
      return { pathname: '/security/confirm-pin', params: { next: '/security/change-password' } };
    default:
      return null;
  }
}

export default function SecurityScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const toast = useToast();
  const consent = useBiometricConsent();
  const me = useMe();
  const score = useSecurityScore();
  const sessions = useSessions();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Server truth — reflects the stored user record, not local optimism.
  const consentOn = !!user?.biometricConsentAt;
  const account = me.data ?? user;
  const twoStepOn = !!account?.twoFactorEnabled;
  const changed = (iso?: string | null) => (iso && timeAgo(iso) ? `Changed ${timeAgo(iso)}` : undefined);
  const deviceCount = sessions.data?.length;

  const applyConsent = async (accepted: boolean) => {
    if (consent.isPending) return;
    try {
      await consent.mutateAsync({ accepted });
      dispatch(accepted ? biometricConsentGiven() : biometricConsentRevoked());
      // Withdrawing drops faceEnrolled locally too — the tabs layout routes
      // the user back through consent + re-enrollment on next entry.
      toast.show(
        'success',
        accepted ? 'Biometric consent on' : 'Biometric consent off — your enrolled face was removed.',
      );
    } catch (err) {
      toast.show('error', toApiError(err).message || 'Could not update consent. Please try again.');
    }
  };

  const onConsentToggle = (next: boolean) => {
    if (next) void applyConsent(true);
    else setConfirmRevoke(true);
  };

  const gate = (next: string) => () =>
    router.push({ pathname: '/security/confirm-pin', params: { next } } as never);

  const refresh = () => {
    void score.refetch();
    void me.refetch();
    void sessions.refetch();
  };

  // review_sessions earns no points and duplicates the "Signed-in devices"
  // row below, so it doesn't belong under "Improve your score".
  const suggestions = (score.data?.suggestions ?? []).filter((s) => s.id !== 'review_sessions');

  return (
    <Screen
      header={<TopBar title="Security" />}
      contentStyle={{ paddingTop: 4 }}
      refreshing={score.isRefetching}
      onRefresh={refresh}>
      <ScoreHero data={score.data} loading={score.isPending} failed={score.isError} onRetry={() => void score.refetch()} />

      {suggestions.length > 0 && (
        <Group title="Improve your score">
          {suggestions.map((s) => {
            const href = suggestionHref(s);
            return (
              <ListRow
                key={`${s.id}-${s.documentId ?? ''}`}
                icon={SUGGESTION_ICON[s.id] ?? Sparkles}
                tone="amber"
                title={s.title}
                value={s.points > 0 ? `+${s.points}` : undefined}
                chevron={href != null}
                onPress={href != null ? () => router.push(href as never) : undefined}
              />
            );
          })}
        </Group>
      )}

      <Group title="Sign-in">
        <ListRow
          icon={Lock}
          tone="sky"
          title="Change password"
          sub={changed(account?.passwordChangedAt) ?? 'Update your account password'}
          onPress={gate('/security/change-password')}
        />
        <ListRow
          icon={KeyRound}
          tone="sky"
          title="Change PIN"
          sub={changed(account?.pinChangedAt) ?? '4-digit code for sensitive actions'}
          onPress={gate('/security/change-pin')}
        />
        <ListRow icon={ScanFace} tone="sky" title="Update face" sub="Re-enroll your face template" onPress={() => router.push('/face-update/pin')} />
        <ListRow
          icon={ShieldCheck}
          tone="sky"
          title="2-step sign-in"
          sub={
            twoStepOn
              ? account?.twoFactorMethod === 'totp'
                ? 'On · authenticator app'
                : 'On · email code'
              : 'Ask for a code when you sign in'
          }
          value={account ? (twoStepOn ? 'On' : 'Off') : undefined}
          onPress={() => router.push('/security/two-step' as never)}
        />
        <ListRow
          icon={Smartphone}
          tone="sky"
          title="Signed-in devices"
          sub={
            deviceCount != null
              ? `${deviceCount} device${deviceCount === 1 ? '' : 's'} signed in`
              : 'See and sign out other devices'
          }
          onPress={() => router.push('/security/devices' as never)}
        />
      </Group>

      <Group title="Face & consent">
        <ListRow
          icon={Fingerprint}
          tone="sky"
          title="Biometric consent"
          sub={consentOn ? 'On — your face template is stored' : 'Off — no face template stored'}
          chevron={false}
          trailing={
            <Toggle on={consentOn} onChange={onConsentToggle} disabled={consent.isPending} label="Biometric consent" />
          }
        />
      </Group>

      <Group title="Danger zone">
        <ListRow icon={Trash2} danger title="Delete account" sub="Erase your data permanently" onPress={() => router.push('/account/delete')} />
      </Group>

      {__DEV__ && isMockApi() && (
        <Txt v="small" color={C.ink4} center>
          Demo PIN: {MOCK_PIN}
        </Txt>
      )}

      <ConfirmSheet
        visible={confirmRevoke}
        danger
        icon={Fingerprint}
        title="Turn off biometric consent?"
        body="Turning this off removes your enrolled face. You'll need to re-enroll before using face check-in again."
        confirmLabel="Turn off"
        loading={consent.isPending}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          setConfirmRevoke(false);
          void applyConsent(false);
        }}
      />
    </Screen>
  );
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Good';
  return 'Needs attention';
}

/** Navy hero with the server score as a ring (0–100). */
function ScoreHero({
  data,
  loading,
  failed,
  onRetry,
}: {
  data?: SecurityScore;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const size = 96;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const pct = data ? Math.max(0, Math.min(100, data.score)) / 100 : 0;
  return (
    <View style={[{ borderRadius: R.xl, overflow: 'hidden', padding: 22 }, SH.navy]}>
      <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Guilloche size={360} style={{ right: -180, bottom: -200 }} />
      <Row gap={20}>
        <View
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="progressbar"
          accessibilityLabel="Security score"
          accessibilityValue={data ? { min: 0, max: 100, now: data.score } : undefined}>
          {/* Rotated so the arc starts at 12 o'clock. */}
          <Svg width={size} height={size} style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.14)" strokeWidth={8} fill="none" />
            {data != null && pct > 0 && (
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={C.skyLight}
                strokeWidth={8}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${circ * pct} ${circ}`}
              />
            )}
          </Svg>
          {data ? (
            <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -1, color: C.white }}>{data.score}</Text>
          ) : (
            <ShieldCheck size={30} color={C.skyLight} />
          )}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 19, letterSpacing: -0.4, color: C.white }}>Security score</Text>
          {data ? (
            <>
              <Text style={{ fontFamily: F.semibold, fontSize: 14, color: C.skyLight }}>{scoreLabel(data.score)}</Text>
              <Text style={{ fontFamily: F.medium, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                Identity strength {Math.round(data.identityStrength)}%
              </Text>
            </>
          ) : failed && !loading ? (
            <>
              <Text style={{ fontFamily: F.medium, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                Couldn&apos;t load your score.
              </Text>
              <View style={{ alignSelf: 'flex-start' }}>
                <TextLink label="Try again" color={C.skyLight} onPress={onRetry} />
              </View>
            </>
          ) : (
            <Text style={{ fontFamily: F.medium, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
              Checking your account…
            </Text>
          )}
        </View>
      </Row>
    </View>
  );
}
