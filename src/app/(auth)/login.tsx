/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight, Mail, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { DEFAULT_COUNTRY_CODE } from '@/constants/countries';
import { toLoginIdentifier } from '@/features/auth/phone';
import { loginSchema } from '@/features/auth/schemas';
import { sessionStarted } from '@/features/auth/slice';
import { formatWait, lockSecondsFrom, useLockCountdown } from '@/features/auth/useLockCountdown';
import { AuthScreen, CountryCodePicker, LinkRow, PasswordField, Segmented } from '@/premium/flows/auth';
import { Banner } from '@/premium/kit';
import { Button, Field, Heading, Row, TextLink, TopBar } from '@/premium/ui';
import { useAppDispatch } from '@/store';
import { isTwoFactorChallenge } from '@/types/domain';

type IdentifierMode = 'email' | 'phone';

/**
 * Login — POST /auth/login { identifier, password } → AuthResponse, or 202
 * with a 2-step challenge → /(auth)/two-factor.
 * sessionStarted stores tokens + user; the (auth) layout then redirects to
 * consent automatically when faceEnrolled is false.
 *
 * Errors (backend Oct 2026 §4.2): 401 INVALID_CREDENTIALS always shows the
 * same generic text (never "account not found"). 429 ACCOUNT_LOCKED comes
 * back for every attempt while locked, even with the right password, so the
 * Sign in button stays disabled with a live countdown from retry_after.
 */
export default function LoginScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  // Set by the session-expired handler in _layout — explains why the user
  // landed here instead of silently dropping them on a bare login form.
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const [mode, setMode] = useState<IdentifierMode>('email');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [identifierError, setIdentifierError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lock = useLockCountdown();

  const submit = async () => {
    if (loading || lock.locked) return;
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setIdentifierError(fields.identifier?.[0]);
      setPasswordError(fields.password?.[0]);
      return;
    }
    setLoading(true);
    setFormError(null);
    try {
      let value = identifier.trim();
      if (mode === 'phone') {
        // Shared with register (features/auth/phone): the trunk 0 is dropped,
        // the picked code added unless already typed, +E.164 kept — so
        // "09876543210" signs in as +919876543210, not +9109876543210.
        const phone = toLoginIdentifier(value, countryCode);
        if (!phone) {
          setIdentifierError('Enter a valid mobile number');
          return;
        }
        value = phone;
      }

      const result = await api.login({
        identifier: value,
        password,
      });

      // 2-step sign-in is on: the backend answered 202 with a challenge.
      if (isTwoFactorChallenge(result)) {
        router.push({
          pathname: '/(auth)/two-factor',
          params: { challengeId: result.challengeId, method: result.method },
        } as never);
        return;
      }
      const { user, accessToken, refreshToken } = result;

      if (!accessToken || !refreshToken) {
        setFormError('Login incomplete — tokens missing. Please finish registration or contact support.');
        return;
      }

      dispatch(sessionStarted({ user, accessToken, refreshToken }));
    } catch (error) {
      const apiErr = toApiError(error);
      const lockSecs = apiErr.status === 429 || apiErr.serverCode === 'ACCOUNT_LOCKED' ? lockSecondsFrom(apiErr) : null;
      if (lockSecs != null) {
        // Locked: the banner counts down live and the button stays off.
        setFormError(null);
        lock.lockFor(lockSecs);
      } else if (apiErr.serverCode === 'INVALID_CREDENTIALS' || apiErr.status === 401 || apiErr.status === 404) {
        // Same text for a wrong password and an unknown account.
        setFormError('Email/phone or password is incorrect.');
      } else {
        setFormError(apiErr.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const onIdentifierChange = (v: string) => {
    setIdentifier(v);
    setIdentifierError(undefined);
    setFormError(null);
  };

  return (
    <AuthScreen
      header={<TopBar />}
      footer={<LinkRow prompt="New to TruePas?" label="Create an account" onPress={() => router.push('/(auth)/register')} />}>
      <Heading title="Welcome" accent="back." sub="Sign in to your digital identity with your email or mobile number." />

      {reason === 'session-expired' ? (
        <Banner
          tone="warning"
          title="Session expired"
          body="For your security, you were signed out. Please sign in again to continue."
        />
      ) : null}

      <Segmented<IdentifierMode>
        label="Sign in method"
        options={[
          { value: 'email', label: 'Email' },
          { value: 'phone', label: 'Mobile' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setIdentifier('');
          setIdentifierError(undefined);
          setFormError(null);
        }}
      />

      <View style={{ gap: 18 }}>
        {mode === 'email' ? (
          <Field
            key="email"
            label="Email"
            icon={Mail}
            placeholder="you@example.com"
            keyboardType="email-address"
            value={identifier}
            onChangeText={onIdentifierChange}
            error={identifierError}
            inputProps={{ autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', textContentType: 'username' }}
          />
        ) : (
          <Field
            key="phone"
            label="Mobile number"
            icon={Phone}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            value={identifier}
            onChangeText={onIdentifierChange}
            error={identifierError}
            inputProps={{ autoCapitalize: 'none', autoCorrect: false, autoComplete: 'tel' }}
            right={<CountryCodePicker value={countryCode} onChange={setCountryCode} />}
          />
        )}
        <PasswordField
          label="Password"
          placeholder="Your password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setPasswordError(undefined);
            setFormError(null);
          }}
          error={passwordError}
          autoComplete="current-password"
        />

        {lock.locked ? (
          <Banner
            tone="error"
            title="Too many attempts"
            body={`Sign-in is paused for your security. Try again in ${formatWait(lock.secondsLeft)}.`}
          />
        ) : formError ? (
          <Banner tone="error" body={formError} />
        ) : null}

        <Row style={{ justifyContent: 'flex-end' }}>
          <TextLink label="Forgot password?" onPress={() => router.push('/(auth)/forgot-password')} />
        </Row>
      </View>

      <View style={{ gap: 14 }}>
        <Button
          label="Sign in"
          iconRight={ArrowRight}
          loading={loading}
          disabled={!identifier.trim() || !password || lock.locked}
          onPress={() => void submit()}
        />
        {/* Face sign-in (§4.5) waits on a security review — not shown until
            it ships (api.faceLogin is ready). */}
      </View>
    </AuthScreen>
  );
}
