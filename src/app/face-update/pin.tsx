/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { isMockApi } from '@/api';
import { waitText } from '@/api/errors';
import { MOCK_PIN } from '@/api/mock';
import { PIN_LENGTH, usePinVerification } from '@/features/auth/usePinVerification';
import { MEMBER_FACE_UPDATE_GUARD, type ReauthReason } from '@/features/family/hooks';
import { formatCountdown } from '@/hooks/useCountdown';
import { Keypad } from '@/premium/blocks';
import { Banner, CodeInput } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Heading, Screen, TextLink, TopBar, Txt } from '@/premium/ui';
import { cooldownKey, useCooldown } from '@/services/cooldowns';
import { flowGuards } from '@/services/flowGuards';
import { useAppSelector } from '@/store';

/** Update face — PIN verification (PRD FR-04; backend §5: PUT /face needs
 *  the single-use, 5-minute reauthToken that POST /auth/verify-pin returns —
 *  api.verifyPin keeps it for the API layer). Runs right before the capture,
 *  so the order is PIN → liveness/photo → PUT /face inside the 5 minutes.
 *  Forwards `personId` (when present) so the face update targets the family
 *  member instead of the authenticated main user. With `capture` (from the
 *  member page) it opens the member's own capture screen in update mode —
 *  liveness (5+) or one photo (under 5), both PUT /face — which lands back
 *  on the member page. Capture screens come back here with `reason` when the
 *  PIN check expired, was refused (403 REAUTH_REQUIRED) or was used up by a
 *  failed update. Shares attempts/lockout logic with confirm-pin via
 *  usePinVerification. */
export default function FaceUpdatePinScreen() {
  const router = useRouter();
  const { personId, age, name, capture, reason } = useLocalSearchParams<{
    personId?: string;
    age?: string;
    name?: string;
    capture?: 'liveness' | 'photo';
    reason?: ReauthReason;
  }>();
  const gate = usePinVerification();
  // 3 failed updates in 24 h → 429 FACE_UPDATE_LIMIT_REACHED. Every Update
  // face entry point lands here, so this is where the wait is enforced.
  const accountId = useAppSelector((state) => state.auth.user?.id);
  const limitLeft = useCooldown(accountId ? cooldownKey('face-update', accountId, personId ?? 'self') : null);
  const limited = limitLeft > 0;
  const busy = gate.locked || gate.isPending || limited;

  const handleComplete = async (value?: string) => {
    if (limited) return;
    const code = await gate.submit(value);
    if (!code) return;
    // Replace on both paths: back from the capture screen returns to where
    // the PIN step was opened from, and a "PIN again" round trip doesn't
    // stack PIN screens.
    if (personId && (capture === 'liveness' || capture === 'photo')) {
      flowGuards.grant(MEMBER_FACE_UPDATE_GUARD);
      router.replace({
        pathname: capture === 'photo' ? '/family/add/photo-capture' : '/family/add/face-capture',
        params: { personId, update: '1', ...(name ? { name } : {}), ...(age ? { age } : {}) },
      });
      return;
    }
    flowGuards.grant('face-update:camera');
    router.replace({
      pathname: '/face-update/camera',
      params: personId ? { personId, ...(age ? { age } : {}) } : {},
    });
  };

  // On-screen keypad drives the same PIN state as the (hidden) code input,
  // which still accepts the system keyboard / paste / screen readers.
  const onKey = (k: string) => {
    if (busy) return;
    if (k === 'del') {
      gate.setPin(gate.pin.slice(0, -1));
      return;
    }
    if (gate.pin.length >= PIN_LENGTH) return;
    const next = gate.pin + k;
    gate.setPin(next);
    if (next.length === PIN_LENGTH) void handleComplete(next);
  };

  return (
    <Screen
      keyboard
      header={<TopBar title="Update face" />}
      contentStyle={{ flexGrow: 1, gap: 22, paddingHorizontal: 24 }}
      footer={
        <Button
          label="Verify"
          loading={gate.isPending}
          disabled={gate.pin.length !== PIN_LENGTH || gate.locked || limited}
          onPress={() => void handleComplete()}
        />
      }>
      <Heading
        title="Enter your"
        accent="PIN."
        center
        sub={
          personId
            ? "For your security, confirm it's you before updating their face."
            : "For your security, confirm it's you before updating your face."
        }
      />

      <CodeInput
        length={PIN_LENGTH}
        value={gate.pin}
        onChange={gate.setPin}
        onComplete={(v) => void handleComplete(v)}
        error={gate.error != null}
        disabled={gate.locked || limited}
        dots
        autoFocus={false}
        label="Current PIN"
      />

      {limited ? (
        <Banner
          tone="error"
          title="Face update paused"
          body={`Too many failed face updates. Try again in ${waitText(limitLeft)}.`}
        />
      ) : gate.locked ? (
        <Banner
          tone="error"
          title="PIN locked"
          body={`Too many incorrect attempts. Try again in ${formatCountdown(gate.lockSecondsLeft)}.`}
        />
      ) : gate.error ? (
        <Banner
          tone="error"
          title={
            gate.attemptsLeft < gate.maxAttempts
              ? `${gate.attemptsLeft} attempt${gate.attemptsLeft === 1 ? '' : 's'} remaining`
              : 'Verification failed'
          }
          body={gate.error}
        />
      ) : reason === 'expired' ? (
        <Banner tone="warning" title="Enter your PIN again" body="Your PIN check expired before the face was saved." />
      ) : reason === 'retry' ? (
        <Banner tone="warning" title="Enter your PIN again" body="Each try at changing a face needs a new PIN check." />
      ) : null}

      {__DEV__ && isMockApi() && (
        <Txt v="small" color={C.ink4} center>
          Demo PIN: {MOCK_PIN}
        </Txt>
      )}

      {/* Resets the PIN by email code and comes back here. */}
      <View style={{ alignItems: 'center' }}>
        <TextLink label="Forgot PIN?" onPress={() => router.push('/security/forgot-pin' as never)} />
      </View>

      <View style={{ flex: 1 }} />
      <Keypad onKey={onKey} disabled={busy} />
    </Screen>
  );
}
