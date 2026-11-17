import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { installAxiosLogging, installFetchLogging } from '@/api/devNetworkLog';
import { deviceInfo } from '@/services/deviceInfo';
import { secureStorage } from '@/services/secureStorage';
import type { AuthResponse } from '@/types/domain';

/**
 * Shared Axios infrastructure for the TruePas REST API.
 *
 * The app calls only the BFF (customer-app-bff) at /cb/*.
 * Internal services (liveness, face, etc.) are reached through
 * the BFF — the app never calls them directly.
 *
 * Shared infrastructure:
 *  - In-memory access token (set by auth slice, cleared on logout)
 *  - In-memory registration token (set after phone OTP, cleared after account-details)
 *  - Bearer header injection
 *  - Single-flight 401 refresh with request replay (OWASP A02/A07)
 */

const BFF_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.dev.truepas.com/cb';

/** In-memory access token holder; set by the auth slice, cleared on logout. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// ── Registration token (in-memory only, not persisted) ─────────────────
// Set after phone OTP verification; used as Bearer for the account-details
// call only; cleared immediately after that call succeeds.
let registrationToken: string | null = null;

export function setRegistrationToken(token: string | null): void {
  registrationToken = token;
}

export function getRegistrationToken(): string | null {
  return registrationToken;
}

export function clearRegistrationToken(): void {
  registrationToken = null;
}

// ── Face sign-in preauth token (in-memory only) ───────────────────────
// POST /auth/face-login/start returns a short-lived preauth token that
// replaces the access token on the liveness routes only (backend §4.5).
let preauthToken: string | null = null;

export function setPreauthToken(token: string | null): void {
  preauthToken = token;
}

export function getPreauthToken(): string | null {
  return preauthToken;
}

// ── Session expiry ────────────────────────────────────────────────────
/** The stored session can never be refreshed — the user must log in again. */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

// Registered by the root layout — invoked when the session is dead so the
// app can drop Redux auth state and route to login instead of leaving the
// user half-authenticated while every request fails.
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: () => void): void {
  onSessionExpired = handler;
}

// ── Token refresh (shared, single-flight) ─────────────────────────────
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  let refreshToken: string | null;
  try {
    refreshToken = await secureStorage.getRefreshToken();
  } catch (e) {
    // Storage unreadable (corrupt keystore, unsupported platform) — the
    // session can't be recovered.
    if (__DEV__) console.warn('[API] refresh-token read failed:', e);
    throw new SessionExpiredError();
  }
  if (!refreshToken) {
    throw new SessionExpiredError('NO_REFRESH_TOKEN');
  }

  let response;
  try {
    response = await axios.post<AuthResponse>(
      `${BFF_BASE_URL}/auth/refresh`,
      { refreshToken, device: deviceInfo() },
      { timeout: 15_000 }
    );
  } catch (e) {
    const status = (e as AxiosError).response?.status;
    if (__DEV__) {
      const data = (e as AxiosError).response?.data;
      console.warn(
        `[API] /auth/refresh failed → ${status ?? 'no-response'}`,
        typeof data === 'object' ? JSON.stringify(data) : data,
      );
    }
    // 4xx → the backend rejected the token (expired/revoked/rotated):
    // the session is over. No response or 5xx → transient: keep the
    // stored refresh token so the next attempt can still succeed.
    if (status !== undefined && status < 500) {
      // Remove the dead token — the cold-start restore in app/index.tsx calls
      // this directly (bypassing the response interceptor), so without this
      // it would replay a rejected token on every launch, which can revoke
      // the whole token family per the backend contract.
      await secureStorage.clearRefreshToken().catch(() => {});
      throw new SessionExpiredError();
    }
    throw e;
  }

  // Handle both camelCase and snake_case token fields from backend
  const newRefreshToken = response.data.refreshToken ?? (response.data as any).refresh_token;
  const newAccessToken = response.data.accessToken ?? (response.data as any).access_token;
  if (__DEV__ && !newRefreshToken) {
    console.warn('[API] /auth/refresh returned no refresh token — response keys:', Object.keys(response.data));
  }
  if (newRefreshToken) {
    await secureStorage.setRefreshToken(newRefreshToken);
  }
  setAccessToken(newAccessToken);
  return newAccessToken;
}

/** Returns a fresh access token, deduplicating concurrent refresh calls. */
export function getOrRefreshAccessToken(): Promise<string> {
  refreshPromise = refreshPromise ?? refreshAccessToken();
  return refreshPromise.finally(() => { refreshPromise = null; });
}

// ── Factory: create an Axios instance with shared interceptors ────────
function createClient(baseURL: string): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Development builds only (devNetworkLog). Registered first: its request
  // log then runs after the Bearer header below is set, and its response log
  // sees each answer before a 401 refresh replays the request.
  installAxiosLogging(instance);

  // Public auth endpoints must never carry the user's access token — a stale
  // Bearer token here makes the backend reject the request before it even
  // checks credentials (login → 401 "invalid credentials", verify-otp → 400).
  const PUBLIC_AUTH_PATHS = [
    '/auth/login',
    '/auth/register',
    '/auth/verify-otp',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/reset-pin',
    '/auth/refresh',
    '/auth/2fa/verify',
    '/auth/face-login/start',
    '/auth/face-login',
  ];

  // Attach Bearer token to every request (unless overridden per-request)
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const isPublicAuth = PUBLIC_AUTH_PATHS.some((p) => config.url?.endsWith(p));
    // Don't override if a per-request Authorization header was already set
    // (e.g., registrationToken for account-details)
    if (accessToken && !config.headers.Authorization && !isPublicAuth) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  // 401 → refresh token (single-flight) → replay original request
  // Skip refresh for auth endpoints (login, register, verify-otp, forgot-password, reset-password)
  // because those failures should surface directly as auth errors.
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
      const isAuthEndpoint =
        original?.url &&
        [
          '/auth/login',
          '/auth/register',
          '/auth/verify-otp',
          '/auth/forgot-password',
          '/auth/reset-password',
          '/auth/reset-pin',
          '/auth/2fa/verify',
          '/auth/face-login/start',
          '/auth/face-login',
        ].some((p) => original.url!.endsWith(p));
      // Liveness calls made with a face sign-in preauth token have no user
      // session to refresh — let their 401 surface as-is.
      const sentAuth = (original?.headers as Record<string, unknown> | undefined)?.Authorization;
      if (preauthToken && sentAuth === `Bearer ${preauthToken}`) throw error;
      if (error.response?.status === 401 && original && !isAuthEndpoint && !original._retried) {
        original._retried = true;
        try {
          const token = await getOrRefreshAccessToken();
          original.headers.Authorization = `Bearer ${token}`;
          return instance(original);
        } catch (refreshError) {
          setAccessToken(null);
          if (refreshError instanceof SessionExpiredError) {
            // Session is unrecoverable — wipe the stored token and end the
            // session so the app routes to login. Transient failures keep
            // the stored refresh token for the next attempt.
            await secureStorage.clearRefreshToken().catch(() => {});
            onSessionExpired?.();
          }
          throw refreshError;
        }
      }
      throw error;
    }
  );

  return instance;
}

// Development builds only (devNetworkLog): the bare axios that refreshes the
// access token, and every direct fetch (presigned uploads, Google Places, the
// web export download, libraries). Each is hooked once, however often this
// module is evaluated.
installAxiosLogging(axios);
installFetchLogging();

// ── Exported client ────────────────────────────────────────────────────
export const apiClient = createClient(BFF_BASE_URL);

/** Base URL (used by health checks and error messages). */
export const BFF_URL = BFF_BASE_URL;
