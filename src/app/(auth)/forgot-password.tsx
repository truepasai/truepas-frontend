/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyRound, Mail, MailCheck, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { toApiError } from '@/api/errors';
import { useForgotPassword, useResetPassword } from '@/features/auth/mutations';
import { newPasswordSchema } from '@/features/auth/schemas';
import { useToast } from '@/hooks/useToast';
import { AuthScreen, OtpScreen, PasswordField } from '@/premium/flows/auth';
import { Banner } from '@/premium/kit';
import { Button, Field, Heading, Tile, TopBar } from '@/premium/ui';

type Step = 'email' | 'otp' | 'reset';

/** Forgot password — contract §7 three-step recovery, kept as steps inside
 *  this one screen:
 *  1. POST /auth/forgot-password {email} → OTP emailed (always 202)
 *  2. POST /auth/verify-otp {email, otp, purpose:'password_reset'} → OTP validated
 *     before the user types a new password (attempts counted here)
 *  3. POST /auth/reset-password {email, otp, newPassword} → resets, revokes sessions */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  // `?step=reset` lets the dev screen jump straight to the password form.
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>();
  const [step, setStep] = useState<Step>(stepParam === 'reset' ? 'reset' : 'email');
  const [email, setEmail] = useState('');
  const [verifiedOtp, setVerifiedOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmError, setConfirmError] = useState<string>();

  const forgotPassword = useForgotPassword();
  const resetPassword = useResetPassword();
  const toast = useToast();

  // The OTP step needs the email for both verify and resend — a direct
  // navigation without one falls back to the email step.
  const effectiveStep: Step = step === 'otp' && !email ? 'email' : step;

  const handleSendOtp = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address');
      return;
    }
    setEmailError(undefined);
    setEmail(trimmed);
    try {
      await forgotPassword.mutateAsync({ email: trimmed });
      toast.show('info', 'Check your inbox — if the account exists, a reset code is on its way.');
      setStep('otp');
    } catch (err: unknown) {
      toast.show('error', toApiError(err).message || 'Could not send code. Please try again.');
    }
  };

  const handleReset = async () => {
    // The OTP is verified on the previous step — landing here without it
    // (dev `?step=reset` jump) means the session is incomplete.
    if (!email || !verifiedOtp) {
      toast.show('error', 'Your reset session is incomplete — request a new code.');
      return;
    }
    const passwordCheck = newPasswordSchema.safeParse(newPassword);
    setPasswordError(
      !newPassword
        ? 'Enter a new password'
        : !passwordCheck.success
          ? passwordCheck.error.issues[0].message
          : undefined,
    );
    setConfirmError(confirmPassword !== newPassword ? "Passwords don't match" : undefined);
    if (!newPassword || !passwordCheck.success || confirmPassword !== newPassword) return;
    try {
      await resetPassword.mutateAsync({ email, otp: verifiedOtp, newPassword });
      toast.show('success', 'Your password has been reset successfully.');
      router.replace('/(auth)/login');
    } catch (err: unknown) {
      toast.show('error', toApiError(err).message || 'Could not reset password. Please try again.');
    }
  };

  // Step 2 — the OTP step is a full screen with its own header/footer.
  if (effectiveStep === 'otp') {
    return (
      <OtpScreen
        topTitle="Reset password"
        icon={MailCheck}
        title="Check your"
        accent="inbox."
        sub="Enter the 6-digit reset code we emailed you."
        address={email}
        tip="Can't find it? Check your spam or promotions folder."
        purpose="password_reset"
        identifier={{ email }}
        onBack={() => setStep('email')}
        onResend={async () => {
          await forgotPassword.mutateAsync({ email });
        }}
        onVerified={(_response, code) => {
          setVerifiedOtp(code);
          setStep('reset');
        }}
      />
    );
  }

  // Step 1 — find the account.
  if (effectiveStep === 'email') {
    return (
      <AuthScreen
        header={<TopBar title="Reset password" onBack={router.back} />}
        footer={
          <Button
            label="Send reset code"
            loading={forgotPassword.isPending}
            disabled={!email.trim()}
            onPress={() => void handleSendOtp()}
          />
        }>
        <Tile icon={KeyRound} tone="sky" size={60} />
        <Heading
          title="Reset your"
          accent="password."
          sub="Enter your account email. If it exists, we'll send you a reset code."
        />
        <Field
          label="Email"
          icon={Mail}
          placeholder="you@example.com"
          keyboardType="email-address"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setEmailError(undefined);
          }}
          error={emailError}
          inputProps={{ autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', textContentType: 'emailAddress' }}
        />
      </AuthScreen>
    );
  }

  // Step 3 — choose a new password.
  return (
    <AuthScreen
      header={<TopBar title="Choose a new password" onBack={router.back} />}
      footer={
        <Button
          label="Reset password"
          loading={resetPassword.isPending}
          disabled={!newPassword || !confirmPassword}
          onPress={() => void handleReset()}
        />
      }>
      <Tile icon={ShieldCheck} tone="sky" size={60} />
      <Heading title="Almost" accent="done." sub={`Set a new password for ${email || 'your account'}.`} />
      <View style={{ gap: 18 }}>
        <PasswordField
          label="New password"
          placeholder="New password"
          value={newPassword}
          onChangeText={(v) => {
            setNewPassword(v);
            setPasswordError(undefined);
          }}
          error={passwordError}
          hint="8+ characters with upper & lower case, a number and a symbol."
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirm new password"
          placeholder="Repeat password"
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            setConfirmError(undefined);
          }}
          error={confirmError}
        />
      </View>
      <Banner tone="warning" title="Sessions revoked" body="You'll be signed out of every device after the reset." />
    </AuthScreen>
  );
}
