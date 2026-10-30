/**
 * The implicit mock fallback (EXPO_PUBLIC_FALLBACK_TO_MOCK): when the real API
 * is down (503 or no response) a call is answered from mock data so UI work
 * can go on. Never for the calls below — a mock answer there could report a
 * face enrolment that never happened, or a member's face status the server
 * never sent — so their real failure always reaches the screen. Explicit mock
 * mode (EXPO_PUBLIC_USE_MOCK_API) is a deliberate test setup and unaffected.
 *
 * No imports, so it runs under `node --test` (__tests__/fallbackPolicy.test.mjs).
 */
export const NO_MOCK_FALLBACK: ReadonlySet<string> = new Set([
  'enrollFace',
  'updateFace',
  'finalizeLiveness',
  'getFamilyMemberFaceStatus',
]);

export function withMockFallback<A extends unknown[], R>(
  key: string,
  realFn: (...args: A) => Promise<R>,
  mockFn: ((...args: A) => Promise<R>) | undefined,
  { enabled, isBackendDown }: { enabled: boolean; isBackendDown: (error: unknown) => boolean },
): (...args: A) => Promise<R> {
  if (!enabled || !mockFn || NO_MOCK_FALLBACK.has(key)) return realFn;
  return async (...args: A) => {
    try {
      return await realFn(...args);
    } catch (error) {
      if (isBackendDown(error)) return mockFn(...args);
      throw error;
    }
  };
}
