/**
 * PIN re-auth for face and address changes (backend Oct 2026, §5): POST
 * /auth/verify-pin returns a `reauthToken` (5 minutes, single use, bound to
 * its scope) that PUT /face or PUT /user/me/address carries as `X-Reauth-Token`.
 *
 * The token is held in memory only. The API layer stores it on every
 * successful verify-pin and consumes it on PUT /face, so the PIN → liveness
 * → update screens don't pass it through route params. A missing or expired
 * token makes PUT /face fail with 403 REAUTH_REQUIRED → ask for the PIN again.
 */

let token: string | null = null;
let expiresAt = 0;

/** Remember the token from verify-pin. `expiresIn` is in seconds. */
export function setReauthToken(value: string | null | undefined, expiresIn = 300): void {
  token = value ?? null;
  // Small safety margin so a token about to expire isn't sent.
  expiresAt = value ? Date.now() + Math.max(0, expiresIn - 5) * 1000 : 0;
}

/** True while an unused, unexpired token is held. */
export function hasReauthToken(): boolean {
  return !!token && Date.now() < expiresAt;
}

/** Read the token without using it up. PUT /user/me/address only spends it
 *  when the address is saved, so a rejected address can retry with it. */
export function peekReauthToken(): string | null {
  return hasReauthToken() ? token : null;
}

/** Take the token for one PUT /face call (single use). */
export function takeReauthToken(): string | null {
  const t = hasReauthToken() ? token : null;
  token = null;
  expiresAt = 0;
  return t;
}

export function clearReauthToken(): void {
  token = null;
  expiresAt = 0;
}
