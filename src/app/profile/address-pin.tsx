/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { isMockApi } from '@/api';
import { MOCK_PIN } from '@/api/mock';
import { PIN_LENGTH, usePinVerification } from '@/features/auth/usePinVerification';
import { formatCountdown } from '@/hooks/useCountdown';
import { Keypad } from '@/premium/blocks';
import { Banner, CodeInput } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Heading, Screen, TextLink, TopBar, Txt } from '@/premium/ui';

/** Change address — PIN step. POST /auth/verify-pin with scope
 *  address_update returns the 5-minute token PUT /user/me/address needs
 *  (api.verifyPin keeps it). The edit screen comes back here with
 *  `reason=expired` when the token ran out or was refused (403). */
export default function AddressPinScreen() {
  const router = useRouter();
  const { reason } = useLocalSearchParams<{ reason?: 'expired' }>();
  const gate = usePinVerification('address_update');
  const busy = gate.locked || gate.isPending;

  const handleComplete = async (value?: string) => {
    const code = await gate.submit(value);
    if (!code) return;
    router.replace({ pathname: '/profile/address-edit', params: { mode: 'update' } });
  };

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
      header={<TopBar title="Change address" />}
      contentStyle={{ flexGrow: 1, gap: 22, paddingHorizontal: 24 }}
      footer={
        <Button
          label="Verify"
          loading={gate.isPending}
          disabled={gate.pin.length !== PIN_LENGTH || gate.locked}
          onPress={() => void handleComplete()}
        />
      }>
      <Heading title="Enter your" accent="PIN." center sub="For your security, confirm it's you before changing your address." />

      <CodeInput
        length={PIN_LENGTH}
        value={gate.pin}
        onChange={gate.setPin}
        onComplete={(v) => void handleComplete(v)}
        error={gate.error != null}
        disabled={gate.locked}
        dots
        autoFocus={false}
        label="Current PIN"
      />

      {gate.locked ? (
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
        <Banner tone="warning" title="Enter your PIN again" body="Your PIN check expired before the address was saved." />
      ) : null}

      {__DEV__ && isMockApi() && (
        <Txt v="small" color={C.ink4} center>
          Demo PIN: {MOCK_PIN}
        </Txt>
      )}

      <View style={{ alignItems: 'center' }}>
        <TextLink label="Forgot PIN?" onPress={() => router.push('/security/forgot-pin' as never)} />
      </View>

      <View style={{ flex: 1 }} />
      <Keypad onKey={onKey} disabled={busy} />
    </Screen>
  );
}
