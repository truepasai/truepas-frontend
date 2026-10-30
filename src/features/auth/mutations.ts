import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api';
import { profileUpdated } from '@/features/auth/slice';
import { useAppDispatch } from '@/store';
import type {
    AccountDetailsRequest,
    BiometricConsentRequest,
    ChangePasswordRequest,
    ChangePinRequest,
    DeleteAccountRequest,
    FaceEnrollRequest,
    FaceUpdateRequest,
    ForgotPasswordRequest,
    LivenessEvidenceRequest,
    LoginRequest,
    LogoutRequest,
    Notification,
    RegisterRequest,
    ResetPasswordRequest,
    ResetPinRequest,
    UpdateProfileRequest,
    VerificationSessionRequest,
    VerifyOtpRequest,
    PinScope,
} from '@/types/domain';

/** Auth + account write operations (login, register, password/PIN, profile). */

export function useLogin() {
  return useMutation({
    mutationFn: (payload: LoginRequest) => api.login(payload),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (payload: RegisterRequest) => api.register(payload),
  });
}

export function useVerifyOtp() {
  return useMutation({
    mutationFn: (payload: VerifyOtpRequest) => api.verifyOtp(payload),
  });
}

export function useCompleteAccountDetails() {
  return useMutation({
    mutationFn: (payload: AccountDetailsRequest) => api.completeAccountDetails(payload),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (payload: ForgotPasswordRequest) => api.forgotPassword(payload),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (payload: ResetPasswordRequest) => api.resetPassword(payload),
  });
}

/** Forgot PIN (backend §4.6): forgot-password → verify-otp (password_reset) → this. */
export function useResetPin() {
  return useMutation({
    mutationFn: (payload: ResetPinRequest) => api.resetPin(payload),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: ChangePasswordRequest) => api.changePassword(payload),
  });
}

export function useChangePin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChangePinRequest) => api.changePin(payload),
    // pinChangedAt (Security "Changed …" line, Home "PIN changed" activity).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['account', 'activity'] });
    },
  });
}

export function useVerifyPin(scope?: PinScope) {
  return useMutation({
    mutationFn: (pin: string) => api.verifyPin(pin, scope),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: (payload: LogoutRequest) => api.logout(payload),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (payload: DeleteAccountRequest) => api.deleteAccount(payload),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const dispatch = useAppDispatch();
  return useMutation({
    mutationFn: (payload: UpdateProfileRequest) => api.updateProfile(payload),
    onSuccess: (user) => {
      // Screens read state.auth.user (Redux), not React Query — push the
      // server-returned record into the store or the UI keeps showing the
      // pre-edit profile until the next cold start.
      dispatch(profileUpdated(user));
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useBiometricConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BiometricConsentRequest) => api.biometricConsent(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

// ── Liveness operations (via BFF /cb/liveness/*) ──────────────────────

export function useCreateLivenessChallenge() {
  return useMutation({
    mutationFn: (personId?: string) => api.createLivenessChallenge(personId),
  });
}

export function useSubmitLivenessEvidence() {
  return useMutation({
    mutationFn: (params: { sessionId: string; payload: LivenessEvidenceRequest; sessionToken: string }) =>
      api.submitLivenessEvidence(params.sessionId, params.payload, params.sessionToken),
  });
}

export function useFinalizeLiveness() {
  return useMutation({
    mutationFn: (params: { sessionId: string; frameBase64: string; sessionToken: string }) =>
      api.finalizeLiveness(params.sessionId, params.frameBase64, params.sessionToken),
  });
}

// ── Face enrollment / update (via BFF /cb/face/*) ─────────────────────

export function useEnrollFace() {
  const queryClient = useQueryClient();
  return useMutation({
    /** `requestId`: the X-Request-ID this attempt is logged under. */
    mutationFn: ({ requestId, ...payload }: FaceEnrollRequest & { requestId?: string }) =>
      api.enrollFace(payload, { requestId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['identity'] });
      queryClient.invalidateQueries({ queryKey: ['family'] });
    },
  });
}

export function useUpdateFace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FaceUpdateRequest) => api.updateFace(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['identity'] });
      // Family member face update (personId) — refresh their member record.
      if (variables.personId) queryClient.invalidateQueries({ queryKey: ['family'] });
    },
  });
}

// ── Document verification sessions ─────────────────────────────────────

export function useCreateVerificationSession() {
  return useMutation({
    mutationFn: (params: { documentId: string; payload: VerificationSessionRequest }) =>
      api.createVerificationSession(params.documentId, params.payload),
  });
}

export function useStartVerification() {
  return useMutation({
    mutationFn: (sessionId: string) => api.startVerification(sessionId),
  });
}

export function usePollVerification() {
  return useMutation({
    mutationFn: (sessionId: string) => api.pollVerification(sessionId),
  });
}

// ── Notifications query ────────────────────────────────────────────────

export function useNotifications(params?: { limit?: number; offset?: number; unreadOnly?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.getNotifications(params),
    onSuccess: (data: Notification[]) => {
      queryClient.setQueryData(['notifications', params], data);
    },
  });
}
