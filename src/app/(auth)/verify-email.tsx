/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { api } from '@/api';
import { clearRegistrationToken } from '@/api/client';
import { sessionStarted } from '@/features/auth/slice';
import { OtpScreen, SIGNUP_STEPS } from '@/premium/flows/auth';
import { accountDetailsStore } from '@/services/accountDetailsStore';
import { useAppDispatch } from '@/store';

/** Verify email OTP — registration flow step 4 (contract v1.1.0).
 *  Email verification returns AuthResponse; dispatch sessionStarted and
 *  route to biometric consent (faceEnrolled is false at this point). */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { email } = useLocalSearchParams<{ email?: string }>();

  useEffect(() => {
    console.log('[VerifyEmail] Params received:', { email });
    if (!email) {
      // Direct navigation (dev-screen jump / reload on this route) — the OTP
      // screen is useless without the email. Send the user back to register
      // instead of rendering a broken OTP form.
      console.warn('[VerifyEmail] Missing email param — redirecting to register.');
      router.replace('/(auth)/register');
    }
  }, [email, router]);

  if (!email) {
    return null;
  }

  return (
    <OtpScreen
      topTitle="Verify email"
      step={{ current: 4, total: SIGNUP_STEPS }}
      over="Almost there"
      title="Check your"
      accent="inbox."
      sub="Enter the 6-digit code we emailed you to confirm your address."
      address={email}
      tip="Can't find it? Check your spam or promotions folder."
      purpose="email"
      identifier={{ email: email ?? '' }}
      onResend={async () => {
        // The backend has no dedicated resend endpoint — the email OTP is sent
        // by POST /auth/account-details. Re-submit the stashed payload (the
        // registration token is still in api/client memory) to trigger a
        // fresh email.
        const payload = accountDetailsStore.get();
        if (!payload) {
          throw new Error('Registration session expired. Please sign up again.');
        }
        await api.completeAccountDetails(payload);
      }}
      onVerified={(response) => {
        console.log(
          '[VerifyEmail] Verification response:',
          JSON.stringify({
            ok: response.ok,
            nextStep: response.nextStep,
            hasUser: !!response.user,
            hasAccessToken: !!response.accessToken,
          }),
        );
        // Registration session fully consumed — release the in-memory token
        // and the stashed account-details payload.
        clearRegistrationToken();
        accountDetailsStore.clear();
        // Email verification during registration returns AuthResponse fields
        // (user, accessToken, refreshToken) embedded in VerifyOtpResponse.
        if (response.user && response.accessToken) {
          dispatch(
            sessionStarted({
              user: response.user,
              accessToken: response.accessToken,
              refreshToken: response.refreshToken,
            }),
          );
          // Home address first (verified, as in FacePe), then face consent.
          router.replace('/(onboarding)/address');
          return;
        }
        // Verified but no session tokens — without sessionStarted the
        // onboarding layout would bounce the user to /welcome silently.
        // The account almost certainly exists (email is verified), so send
        // them to login where they can recover with their new password.
        console.error(
          '[VerifyEmail] Missing user/accessToken in verify response:',
          JSON.stringify({
            ...response,
            registrationToken: response.registrationToken ? '***' : undefined,
            accessToken: response.accessToken ? '***' : undefined,
            refreshToken: response.refreshToken ? '***' : undefined,
          }),
        );
        Alert.alert(
          'Almost there',
          'Your email is verified, but we could not sign you in automatically. Please log in with your new password.',
          [{ text: 'Go to sign in', onPress: () => router.replace('/(auth)/login') }],
          { cancelable: false },
        );
      }}
      change={{ prompt: 'Wrong address?', label: 'Go back' }}
    />
  );
}
