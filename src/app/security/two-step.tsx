/** @jsxImportSource react */
import { useRouter } from 'expo-router';
import { Check, ExternalLink, KeyRound, Mail, ShieldCheck, ShieldOff, Smartphone, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Animated, Linking, Pressable, Text, View } from 'react-native';

import { isMockApi } from '@/api';
import { toApiError } from '@/api/errors';
import { MOCK_PIN } from '@/api/mock';
import { useConfirmTwoFactor, useDisableTwoFactor, useEnableTwoFactor, useMe } from '@/features/account/hooks';
import { PIN_LENGTH } from '@/features/auth/usePinVerification';
import { QrCode } from '@/features/settings/QrCode';
import { useToast } from '@/hooks/useToast';
import { Keypad } from '@/premium/blocks';
import { applyPinKey } from '@/premium/flows/account';
import { Banner, CodeInput, LoadingView } from '@/premium/kit';
import { C, F, R } from '@/premium/theme';
import { back, Badge, Button, Card, Group, Heading, ListRow, Row, Screen, Steps, TextLink, Tile, TopBar, Txt } from '@/premium/ui';
import { errorHaptic, successHaptic } from '@/services/haptics';
import { useAppSelector } from '@/store';
import type { TwoFactorEnableResponse, TwoFactorMethod } from '@/types/domain';

const CODE_LENGTH = 6;

const METHODS: Record<TwoFactorMethod, { label: string; sub: string; icon: LucideIcon }> = {
  email: { label: 'Email code', sub: 'We email you a code each time you sign in.', icon: Mail },
  totp: { label: 'Authenticator app', sub: 'Google Authenticator, 1Password, Authy and others.', icon: Smartphone },
};

type Stage = 'status' | 'choose' | 'totp' | 'code' | 'disable';

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP" for manual entry. */
const groupKey = (secret: string) => (secret.replace(/\s/g, '').match(/.{1,4}/g) ?? []).join(' ');

/**
 * 2-step sign-in (backend Oct 2026 §4.4). Status comes from GET /user/me
 * (twoFactorEnabled / twoFactorMethod).
 * - Turn on: pick Email code or Authenticator app → POST /auth/2fa/enable.
 *   Email: a code is emailed. App: show the otpauth:// URI as a QR code (and
 *   an "Open authenticator app" link for this phone) plus the secret for
 *   manual entry. Then POST /auth/2fa/confirm { challengeId, code }.
 * - Turn off: PIN → POST /auth/2fa/disable { pin }.
 * Starting a new set-up and abandoning it leaves a working method intact,
 * so "Use a different method" is safe while 2-step is on.
 */
export default function TwoStepScreen() {
  const router = useRouter();
  const toast = useToast();
  const me = useMe();
  const user = useAppSelector((state) => state.auth.user);
  const enable = useEnableTwoFactor();
  const confirm = useConfirmTwoFactor();
  const disable = useDisableTwoFactor();

  const [stage, setStage] = useState<Stage>('status');
  const [choice, setChoice] = useState<TwoFactorMethod>('email');
  const [setup, setSetup] = useState<TwoFactorEnableResponse | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLocked, setCodeLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [shakeX] = useState(() => new Animated.Value(0));

  const source = me.data ?? user;
  const enabled = !!source?.twoFactorEnabled;
  const method: TwoFactorMethod | null = source?.twoFactorMethod ?? null;

  const shake = () =>
    Animated.sequence(
      [-10, 10, -6, 6, 0].map((toValue) => Animated.timing(shakeX, { toValue, duration: 50, useNativeDriver: true })),
    ).start();

  const reset = () => {
    setStage('status');
    setSetup(null);
    setCode('');
    setCodeError(null);
    setCodeLocked(false);
    setPin('');
    setPinError(null);
  };

  const onBack = () => {
    if (stage === 'code' && setup?.method === 'totp') setStage('totp');
    else if (stage !== 'status') reset();
    else back();
  };

  /* ── turn on ── */

  const start = async (m: TwoFactorMethod) => {
    if (enable.isPending) return;
    try {
      const res = await enable.mutateAsync(m);
      setSetup(res);
      setCode('');
      setCodeError(null);
      setCodeLocked(false);
      setStage(res.method === 'totp' ? 'totp' : 'code');
    } catch (err) {
      toast.show('error', toApiError(err).message || "Couldn't start set-up. Please try again.");
    }
  };

  const resendEmail = async () => {
    if (enable.isPending) return;
    try {
      const res = await enable.mutateAsync('email');
      setSetup(res);
      setCode('');
      setCodeError(null);
      setCodeLocked(false);
      toast.show('success', 'New code sent');
    } catch (err) {
      toast.show('error', toApiError(err).message || "Couldn't send a new code.");
    }
  };

  const confirmCode = async (value?: string) => {
    const v = value ?? code;
    if (!setup || v.length !== CODE_LENGTH || confirm.isPending || codeLocked) return;
    setCodeError(null);
    try {
      await confirm.mutateAsync({ challengeId: setup.challengeId, code: v });
      successHaptic();
      toast.show('success', '2-step sign-in is on');
      reset();
    } catch (err) {
      const apiErr = toApiError(err);
      errorHaptic();
      shake();
      setCode('');
      if (apiErr.serverCode === 'TWO_FACTOR_LOCKED' || apiErr.status === 429) setCodeLocked(true);
      else
        setCodeError(
          apiErr.serverCode === 'TWO_FACTOR_INVALID' || apiErr.status === 400
            ? 'That code is wrong or has expired. Try again.'
            : apiErr.message,
        );
    }
  };

  /* ── turn off ── */

  const turnOff = async (value?: string) => {
    const v = value ?? pin;
    if (v.length !== PIN_LENGTH || disable.isPending) return;
    setPinError(null);
    try {
      await disable.mutateAsync(v);
      successHaptic();
      toast.show('success', '2-step sign-in is off');
      reset();
    } catch (err) {
      // PIN_INVALID carries the tries left; PIN_LOCKED the wait time.
      errorHaptic();
      setPin('');
      setPinError(toApiError(err).message || "Couldn't turn it off. Please try again.");
    }
  };

  const onPinKey = (k: string) => {
    if (disable.isPending) return;
    const v = applyPinKey(pin, k, PIN_LENGTH);
    if (v === pin) return;
    setPin(v);
    if (pinError) setPinError(null);
    if (v.length === PIN_LENGTH) void turnOff(v);
  };

  /* ── stages ── */

  if (stage === 'disable') {
    return (
      <Screen
        header={<TopBar title="2-step sign-in" onBack={onBack} />}
        contentStyle={{ paddingTop: 8, gap: 22 }}
        footer={
          <>
            <Keypad onKey={onPinKey} disabled={disable.isPending} />
            <Button
              label="Turn off"
              tone="danger"
              loading={disable.isPending}
              disabled={pin.length !== PIN_LENGTH}
              onPress={() => void turnOff()}
            />
          </>
        }>
        <Heading title="Turn off" accent="2-step?" sub="Enter your PIN to confirm. You'll sign in with just your password." center />
        <CodeInput
          length={PIN_LENGTH}
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={(v) => void turnOff(v)}
          error={pinError != null}
          dots
          autoFocus={false}
          label="Account PIN"
        />
        {pinError != null && <Banner tone="error" body={pinError} />}
        <View style={{ alignItems: 'center' }}>
          <TextLink label="Forgot PIN?" onPress={() => router.push('/security/forgot-pin' as never)} />
        </View>
        {__DEV__ && isMockApi() && (
          <Txt v="small" color={C.ink4} center>
            Demo PIN: {MOCK_PIN}
          </Txt>
        )}
      </Screen>
    );
  }

  if (stage === 'totp' && setup) {
    const uri = setup.otpauthUri ?? '';
    return (
      <Screen
        header={<TopBar title="Authenticator app" onBack={onBack} />}
        contentStyle={{ paddingTop: 8, gap: 22 }}
        footer={<Button label="Next: enter the code" onPress={() => setStage('code')} />}>
        <Steps total={2} current={0} />
        <Heading
          title="Add TruePas to your"
          accent="app."
          sub="Scan this QR code with your authenticator app. On this phone, open the app directly instead."
        />
        {!!uri && (
          <Card style={{ alignItems: 'center', gap: 16 }}>
            <View style={{ padding: 8, borderRadius: R.md, backgroundColor: C.white }}>
              <QrCode value={uri} size={208} color={C.ink} />
            </View>
            <Button
              label="Open authenticator app"
              tone="white"
              size="md"
              icon={ExternalLink}
              onPress={() =>
                void Linking.openURL(uri).catch(() =>
                  toast.show('error', 'No authenticator app found. Install one, or enter the key below by hand.'),
                )
              }
            />
          </Card>
        )}
        {!!setup.secret && (
          <View style={{ gap: 10 }}>
            <Txt v="micro" style={{ marginLeft: 4 }}>
              Or enter this key
            </Txt>
            <Card style={{ gap: 8 }}>
              <Row gap={14}>
                <Tile icon={KeyRound} tone="sky" size={40} />
                <Text
                  selectable
                  accessibilityLabel="Set-up key"
                  style={{ flex: 1, fontFamily: F.mono, fontSize: 17, letterSpacing: 1.2, lineHeight: 26, color: C.ink }}>
                  {groupKey(setup.secret)}
                </Text>
              </Row>
              <Txt v="small">Press and hold the key to copy it. Choose a time-based key if the app asks.</Txt>
            </Card>
          </View>
        )}
      </Screen>
    );
  }

  if (stage === 'code' && setup) {
    const isTotp = setup.method === 'totp';
    return (
      <Screen
        keyboard
        header={<TopBar title={isTotp ? 'Authenticator app' : 'Email code'} onBack={onBack} />}
        contentStyle={{ paddingTop: 8, gap: 22 }}
        footer={
          codeLocked ? (
            <Button label="Start again" onPress={reset} />
          ) : (
            <Button
              label="Turn on 2-step sign-in"
              loading={confirm.isPending}
              disabled={code.length !== CODE_LENGTH}
              onPress={() => void confirmCode()}
            />
          )
        }>
        {isTotp && <Steps total={2} current={1} />}
        {isTotp ? (
          <Heading title="Enter the" accent="code." sub="Type the 6-digit code your authenticator app shows for TruePas." />
        ) : (
          <Heading
            title="Check your"
            accent="email."
            sub={`We emailed a 6-digit code to ${user?.email || 'your email'}.`}
          />
        )}
        <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
          <CodeInput
            length={CODE_LENGTH}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (codeError) setCodeError(null);
            }}
            onComplete={(v) => void confirmCode(v)}
            error={codeError != null}
            disabled={confirm.isPending || codeLocked}
            label="Set-up code"
          />
        </Animated.View>
        {codeLocked ? (
          <Banner tone="error" title="Too many wrong codes" body="Start the set-up again to get a new code." />
        ) : codeError ? (
          <Banner tone="error" body={codeError} />
        ) : null}
        {!isTotp && !codeLocked && (
          <Row gap={6} style={{ justifyContent: 'center' }}>
            <Txt v="small">Didn&apos;t get it?</Txt>
            <TextLink
              label={enable.isPending ? 'Sending…' : 'Send a new code'}
              color={enable.isPending ? C.ink4 : C.skyPressed}
              onPress={() => void resendEmail()}
            />
          </Row>
        )}
      </Screen>
    );
  }

  const choosing = stage === 'choose' || !enabled;
  const current = method ? METHODS[method] : null;

  return (
    <Screen
      header={<TopBar title="2-step sign-in" onBack={onBack} />}
      contentStyle={{ paddingTop: 4 }}
      refreshing={me.isRefetching}
      onRefresh={() => void me.refetch()}
      footer={
        me.isPending && !source ? undefined : choosing ? (
          <Button
            key="start"
            label={enabled ? 'Continue' : 'Turn on'}
            loading={enable.isPending}
            onPress={() => void start(choice)}
          />
        ) : (
          <Button key="off" label="Turn off" tone="white" icon={ShieldOff} onPress={() => setStage('disable')} />
        )
      }>
      <Row between align="flex-start">
        <Tile icon={ShieldCheck} tone="sky" size={60} />
        {source != null && (enabled ? <Badge label="On" tone="green" dot /> : <Badge label="Off" tone="neutral" />)}
      </Row>
      <Heading
        title="2-step"
        accent="sign-in."
        sub="When you sign in, we ask for a 6-digit code as well as your password."
      />

      {me.isPending && !source ? (
        <LoadingView />
      ) : choosing ? (
        <View style={{ gap: 10 }}>
          <Txt v="micro" style={{ marginLeft: 4 }}>
            {enabled ? 'Use a different method' : 'How should we send codes?'}
          </Txt>
          {(Object.keys(METHODS) as TwoFactorMethod[]).map((m) => (
            <MethodOption key={m} method={m} selected={choice === m} onPress={() => setChoice(m)} />
          ))}
          {enabled && (
            <Txt v="small" color={C.ink3} style={{ marginLeft: 4 }}>
              Your current method keeps working until the new one is confirmed.
            </Txt>
          )}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Group title="Your method">
            <ListRow
              icon={current?.icon ?? ShieldCheck}
              tone="sky"
              title={current?.label ?? '2-step sign-in'}
              sub={current?.sub}
              chevron={false}
            />
          </Group>
          <View style={{ alignItems: 'center' }}>
            <TextLink
              label="Use a different method"
              onPress={() => {
                setChoice(method === 'email' ? 'totp' : 'email');
                setStage('choose');
              }}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

function MethodOption({ method, selected, onPress }: { method: TwoFactorMethod; selected: boolean; onPress: () => void }) {
  const m = METHODS[method];
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={m.label}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 16,
          borderRadius: R.xl,
          backgroundColor: selected ? C.skyMist : C.surface,
          borderWidth: 1.5,
          borderColor: selected ? C.sky : C.lineSoft,
        }}>
        <Tile icon={m.icon} tone={selected ? 'sky' : 'neutral'} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="bodyStrong">{m.label}</Txt>
          <Txt v="small">{m.sub}</Txt>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: selected ? 0 : 1.5,
            borderColor: C.line,
            backgroundColor: selected ? C.sky : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {selected && <Check size={14} color={C.white} strokeWidth={3} />}
        </View>
      </View>
    </Pressable>
  );
}
