import { realApi } from '@/api/endpoints';
import { isBackendDown } from '@/api/errors';
import { withMockFallback } from '@/api/fallbackPolicy';
import { mockApi } from '@/api/mock';

/**
 * Single source of truth used by every hook/screen in the app.
 *
 * - The REAL backend (`endpoints.ts`) is the default — the backend is live
 *   and every build (preview/production) must talk to it. The base URL is
 *   baked in via `EXPO_PUBLIC_API_URL` (client.ts has a hardcoded fallback).
 * - Mock mode is strictly opt-in: set `EXPO_PUBLIC_USE_MOCK_API=true` to
 *   serve data from JSON fixtures in `src/api/data/` (no backend needed).
 *
 * Fallback mode (`EXPO_PUBLIC_FALLBACK_TO_MOCK=true`):
 *   If the real API returns 503 or a network error, the call is retried
 *   against `mockApi` so UI development can continue even when the
 *   backend is down. Default is strict real-only mode.
 */
const useMockApi = process.env.EXPO_PUBLIC_USE_MOCK_API === 'true';
const fallbackToMock = process.env.EXPO_PUBLIC_FALLBACK_TO_MOCK === 'true';

/**
 * Wraps a real API call so that on 503 / network error it falls back
 * to the equivalent mock function (when fallback is enabled).
 */
function withFallback<K extends keyof typeof realApi>(key: K) {
  const realFn = realApi[key] as (...args: any[]) => Promise<any>;
  const mockFn = (mockApi as Partial<Record<string, (...args: any[]) => Promise<any>>>)[key];
  // Face enrolment and its status reads never fall back (api/fallbackPolicy).
  return withMockFallback(key, realFn, mockFn, { enabled: fallbackToMock, isBackendDown });
}

/**
 * Dev screen-browser override (src/app/dev.tsx): the presets forge a fake
 * 'dev-token' session the real BFF rejects — the 401 → session-expired
 * handler would bounce every authenticated screen to login. While enabled,
 * calls resolve against the mock fixtures; "Resume Normal Flow" resets it.
 */
let devMockOverride = false;

export function setDevMockApi(enabled: boolean): void {
  devMockOverride = enabled;
}

/** True while API calls resolve against mock fixtures (env or dev override). */
export function isMockApi(): boolean {
  return useMockApi || devMockOverride;
}

const realFns = new Map<string, unknown>();

/** The API object used by every hook/screen. */
export const api: typeof realApi = new Proxy({} as typeof realApi, {
  get(_, key: keyof typeof realApi) {
    if (useMockApi || devMockOverride) {
      const mockFn = (mockApi as Partial<typeof realApi>)[key];
      if (mockFn) return mockFn;
    }
    // Memoized — callers may place api.<fn> in effect dep arrays.
    let fn = realFns.get(key);
    if (!fn) {
      fn = withFallback(key);
      realFns.set(key, fn);
    }
    return fn;
  },
});
