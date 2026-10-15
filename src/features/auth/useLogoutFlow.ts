import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLogout } from '@/features/auth/mutations';
import { sessionEnded } from '@/features/auth/slice';
import { resetMemberPhotoSync } from '@/features/family/hooks';
import { clearAllProfileImages } from '@/services/profileImageStore';
import { secureStorage } from '@/services/secureStorage';
import { useAppDispatch } from '@/store';

export interface LogoutOptions {
  /** The backend already revoked this session (e.g. password change) — skip
   *  POST /auth/logout. With the revoked token it would 401, fail the refresh
   *  and end via the session-expired handler ("Session expired" banner)
   *  instead of the caller's own message. Local teardown is unchanged. */
  serverRevoked?: boolean;
}

/**
 * Full logout — server revoke (best-effort) + guaranteed local teardown:
 * React Query cache, Redux session, tokens (in-memory + secure store),
 * session-scoped in-memory stashes (cleared inside sessionEnded), and the
 * profile/member picture cache.
 *
 * Captured document scans are deliberately KEPT: the backend never returns
 * them, so wiping here made every passport photo vanish after a re-login.
 * They're keyed by server document id (unreachable from another account)
 * and removed on document delete / account delete.
 *
 * The server call never blocks local cleanup — even if /auth/logout fails
 * or no refresh token is readable, the session ends locally.
 * Every logout entry point uses this so the wipe can't drift between screens
 * — including flows where the backend already ended the session (password
 * change): those pass `{ serverRevoked: true }`.
 *
 * `isPending` mirrors the /auth/logout call so buttons can show a spinner.
 */
export function useLogoutFlow() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const serverLogout = useLogout();

  const logout = useCallback(
    async ({ serverRevoked = false }: LogoutOptions = {}) => {
      if (!serverRevoked) {
        try {
          const refreshToken = await secureStorage.getRefreshToken();
          if (refreshToken) {
            await serverLogout.mutateAsync({ refreshToken });
          }
        } catch {
          // Best-effort — local teardown below runs regardless.
        }
      }
      await clearAllProfileImages().catch(() => {});
      resetMemberPhotoSync();
      dispatch(sessionEnded());
      // Reset the whole stack, as the session-expired handler does. Login is
      // never in the stack, so dismissTo only swapped the top screen: the
      // signed-in screens stayed underneath (Back reopened them signed out)
      // and refetched without a token — a 401 that showed "Session expired".
      if (router.canDismiss()) router.dismissAll();
      router.replace('/(auth)/login' as never);
      // Clear the cache only once those screens are gone: cleared while they
      // are still mounted, their queries rebuild and fetch with no token.
      setTimeout(() => queryClient.clear(), 0);
    },
    [serverLogout, dispatch, router, queryClient],
  );

  return { logout, isPending: serverLogout.isPending };
}
