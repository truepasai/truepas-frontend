/** @jsxImportSource react */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { ArrowRight, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Text } from 'react-native';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { DEFAULT_COUNTRY_CODE } from '@/constants/countries';
import { useRegister } from '@/features/auth/mutations';
import { mobileNumberError, normalizePhone } from '@/features/auth/phone';
import { PhoneForm, phoneSchema } from '@/features/auth/schemas';
import { AuthScreen, CountryCodePicker, FlowBar, LinkRow, SIGNUP_STEPS } from '@/premium/flows/auth';
import { Banner } from '@/premium/kit';
import { C, F } from '@/premium/theme';
import { Button, Field, Heading, Steps, TextLink, Txt } from '@/premium/ui';

/** Register — step 1 (contract v1.1.0): POST /cb/auth/register { phone, countryCode }
 *  → registrationId → verify-phone with params. Phone only — name, DOB, PIN,
 *  email and password are collected on account-details after the SMS OTP.
 *  409 ACCOUNT_EXISTS (phone already registered) → inline "sign in instead". */
export default function RegisterScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [accountExists, setAccountExists] = useState(false);
  const register = useRegister();
  const { control, handleSubmit, setError } = useForm<PhoneForm>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '' },
  });
  const phone = useWatch({ control, name: 'phone' }) ?? '';

  const onSubmit = handleSubmit(async (values) => {
    if (register.isPending) return;
    // Same reading as sign-in (features/auth/phone): the backend stores
    // countryCode + phone as E.164, so a typed trunk 0 or country code must
    // not end up in `phone` — "09876543210" registers as +91 9876543210.
    const parsed = normalizePhone(values.phone, countryCode);
    if (!parsed?.national) {
      setError('phone', {
        message: parsed ? 'This number has a different country code — choose it from the list.' : 'Enter a valid phone number',
      });
      return;
    }
    const numberError = mobileNumberError(parsed.national, countryCode);
    if (numberError) {
      setError('phone', { message: numberError });
      return;
    }
    const cleanPhone = parsed.national;
    setAccountExists(false);
    try {
      const response = await register.mutateAsync({ phone: cleanPhone, countryCode });
      if (!response?.registrationId) {
        toast({
          variant: 'error',
          title: "Couldn't send code",
          description: 'Registration failed: server did not return a registration ID. Please try again.',
        });
        return;
      }
      router.push({
        pathname: '/(auth)/verify-phone',
        params: { phone: cleanPhone, countryCode, registrationId: response.registrationId },
      });
    } catch (err: unknown) {
      const apiErr = toApiError(err);
      if (apiErr.serverCode === 'ACCOUNT_EXISTS' || apiErr.status === 409) {
        setAccountExists(true);
        return;
      }
      toast({
        variant: 'error',
        title: "Couldn't send code",
        description: apiErr.message || 'Check the number and try again.',
      });
    }
  });

  return (
    <AuthScreen
      header={
        <FlowBar
          title="Create account"
          step={1}
          total={SIGNUP_STEPS}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
        />
      }
      footer={
        <>
          <Button
            label="Send code"
            iconRight={ArrowRight}
            loading={register.isPending}
            disabled={!phone.trim()}
            onPress={() => void onSubmit()}
          />
          <LinkRow prompt="Already have an account?" label="Sign in" onPress={() => router.push('/(auth)/login')} />
        </>
      }>
      <Steps total={SIGNUP_STEPS} current={0} />
      <Heading
        title="Create your"
        accent="TruePas."
        sub="One verified identity for every check-in. We'll text a verification code to your phone."
      />

      <Controller
        control={control}
        name="phone"
        render={({ field: { onChange, onBlur, value }, fieldState }) => (
          <Field
            label="Mobile number"
            icon={Phone}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            value={value}
            onChangeText={(v) => {
              onChange(v);
              setAccountExists(false);
            }}
            onBlur={onBlur}
            error={fieldState.error?.message}
            hint="Enter your number without the country code."
            inputProps={{ autoComplete: 'tel', textContentType: 'telephoneNumber' }}
            right={<CountryCodePicker value={countryCode} onChange={setCountryCode} />}
          />
        )}
      />

      {accountExists && (
        <Banner
          tone="warning"
          title="An account already exists"
          body="This mobile number is already registered. Sign in instead."
          action={<TextLink label="Sign in" color={C.amberInk} onPress={() => router.replace('/(auth)/login')} />}
        />
      )}

      <Txt v="small" style={{ lineHeight: 19 }}>
        By continuing you agree to the{' '}
        <Text style={{ color: C.ink, fontFamily: F.bold }} accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
          Terms of Service
        </Text>{' '}
        and acknowledge the{' '}
        <Text
          style={{ color: C.ink, fontFamily: F.bold }}
          accessibilityRole="link"
          onPress={() => router.push('/legal/privacy-policy')}>
          Privacy Policy
        </Text>
        .
      </Txt>
    </AuthScreen>
  );
}
