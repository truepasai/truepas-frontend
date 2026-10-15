/**
 * Account data added by the October 2026 backend update
 * (BACKEND_UPDATE_2026-10.md): signed-in devices, 2-step sign-in, activity
 * feed, security score, stats, app preferences, support channels and the
 * "Download my data" export. Screens use these hooks; nothing here renders.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/api';
import { normalizeActivity } from '@/api/endpoints';
import { profileUpdated } from '@/features/auth/slice';
import { useAppDispatch } from '@/store';
import type { ActivityItem, AppPreferences, TwoFactorMethod } from '@/types/domain';

export const accountKeys = {
  me: ['account', 'me'] as const,
  sessions: ['account', 'sessions'] as const,
  activity: ['account', 'activity'] as const,
  securityScore: ['account', 'security-score'] as const,
  stats: (year: number) => ['account', 'stats', year] as const,
  preferences: ['account', 'preferences'] as const,
  support: ['account', 'support-channels'] as const,
  dataExport: (id: string) => ['account', 'export', id] as const,
};

/** GET /user/me, mirrored into the Redux session user (2FA flags, photo URL,
 *  passwordChangedAt, …). Call refetch() after account-security changes. */
export function useMe() {
  const dispatch = useAppDispatch();
  return useQuery({
    queryKey: accountKeys.me,
    queryFn: async () => {
      const me = await api.getUser();
      dispatch(profileUpdated(me));
      return me;
    },
  });
}

// ── Signed-in devices ─────────────────────────────────────────────────

export function useSessions() {
  return useQuery({ queryKey: accountKeys.sessions, queryFn: () => api.getSessions() });
}

/** Revoking the current session must also sign out locally (the caller does
 *  that — see useLogoutFlow); other devices drop on their next refresh. */
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; current?: boolean }) => api.revokeSession(id),
    onSuccess: (_data, { current }) => {
      // This phone's own session: the caller signs out next. Refetching with
      // the just-revoked token would 401 and show "Session expired".
      if (current) return;
      void qc.invalidateQueries({ queryKey: accountKeys.sessions });
      void qc.invalidateQueries({ queryKey: accountKeys.securityScore });
    },
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountKeys.sessions });
      void qc.invalidateQueries({ queryKey: accountKeys.securityScore });
    },
  });
}

// ── 2-step sign-in ────────────────────────────────────────────────────

function useInvalidateSecurity() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: accountKeys.me });
    void qc.invalidateQueries({ queryKey: accountKeys.securityScore });
  };
}

/** Step 1 of turning 2-step on: emails a code (email) or returns the TOTP
 *  secret + otpauth URI (authenticator app). */
export function useEnableTwoFactor() {
  return useMutation({ mutationFn: (method: TwoFactorMethod) => api.enableTwoFactor(method) });
}

/** Step 2: confirm with the 6-digit code. */
export function useConfirmTwoFactor() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (payload: { challengeId: string; code: string }) => api.confirmTwoFactor(payload),
    onSuccess: invalidate,
  });
}

export function useDisableTwoFactor() {
  const invalidate = useInvalidateSecurity();
  return useMutation({ mutationFn: (pin: string) => api.disableTwoFactor(pin), onSuccess: invalidate });
}

// ── Home / security data ──────────────────────────────────────────────

/** GET /user/me/activity — newest first, max 20. The feed has no PIN entry
 *  yet (BUG037: it derives "Password changed" but not "PIN changed"), so one
 *  is added from /user/me pinChangedAt until the server sends `pin_changed`. */
export function useAccountActivity() {
  const feed = useQuery({ queryKey: accountKeys.activity, queryFn: () => api.getAccountActivity() });
  const pinChangedAt = useMe().data?.pinChangedAt ?? null;
  const data = useMemo(() => withPinChange(feed.data, pinChangedAt), [feed.data, pinChangedAt]);
  return { ...feed, data };
}

/** Adds "PIN changed" (from /user/me) to an activity list that lacks it. */
export function withPinChange(items: ActivityItem[] | undefined, pinChangedAt: string | null): ActivityItem[] | undefined {
  if (!items || !pinChangedAt || items.some((a) => a.type === 'pin_changed')) return items;
  const entry = normalizeActivity({
    id: 'pin-changed',
    type: 'pin_changed',
    title: 'PIN changed',
    tone: 'neutral',
    occurredAt: pinChangedAt,
  });
  // Newest first: before the first entry that is older.
  const at = items.findIndex((a) => a.occurredAt != null && a.occurredAt < pinChangedAt);
  const merged = at === -1 ? [...items, entry] : [...items.slice(0, at), entry, ...items.slice(at)];
  return merged.slice(0, 20);
}

/** Server score — use instead of computing one on the phone. */
export function useSecurityScore() {
  return useQuery({ queryKey: accountKeys.securityScore, queryFn: () => api.getSecurityScore() });
}

/** Zeros on dev until kiosk check-in events flow. */
export function useUserStats(year = new Date().getFullYear()) {
  return useQuery({ queryKey: accountKeys.stats(year), queryFn: () => api.getUserStats(year) });
}

export function useSupportChannels() {
  return useQuery({ queryKey: accountKeys.support, queryFn: () => api.getSupportChannels(), staleTime: 60 * 60_000 });
}

// ── App preferences ───────────────────────────────────────────────────

export function usePreferences() {
  return useQuery({ queryKey: accountKeys.preferences, queryFn: () => api.getPreferences() });
}

/** Optimistic PUT of only what changed; rolls back on error. */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppPreferences>) => api.updatePreferences(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: accountKeys.preferences });
      const previous = qc.getQueryData<AppPreferences>(accountKeys.preferences);
      if (previous) qc.setQueryData(accountKeys.preferences, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(accountKeys.preferences, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(accountKeys.preferences, data),
  });
}

// ── Download my data ──────────────────────────────────────────────────

export function useRequestDataExport() {
  return useMutation({ mutationFn: () => api.requestDataExport() });
}

/** Polls every 15 s while pending (stays pending on dev until the worker ships). */
export function useDataExport(exportId?: string | null) {
  return useQuery({
    queryKey: accountKeys.dataExport(exportId ?? ''),
    queryFn: () => api.getDataExport(exportId as string),
    enabled: !!exportId,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 15_000 : false),
  });
}
