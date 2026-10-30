// The implicit mock fallback can never turn a failed enrolment, or an
// unreadable face status, into a successful one.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NO_MOCK_FALLBACK, withMockFallback } from '../fallbackPolicy.ts';

const backendDown = Object.assign(new Error('503'), { kind: 'down' });
const isBackendDown = (error) => error?.kind === 'down';
const failing = async () => {
  throw backendDown;
};
const mockSuccess = async () => ({ ok: true, faceEnrolled: true, faceEnrollmentRef: 'enr_mockmockmockmockmock' });

describe('the enrolment calls never fall back to mock data', () => {
  for (const key of ['enrollFace', 'updateFace', 'finalizeLiveness', 'getFamilyMemberFaceStatus']) {
    it(`${key}: the real failure reaches the screen`, async () => {
      assert.ok(NO_MOCK_FALLBACK.has(key));
      const call = withMockFallback(key, failing, mockSuccess, { enabled: true, isBackendDown });
      await assert.rejects(call(), (error) => error === backendDown);
    });
  }
});

describe('other calls keep the opt-in fallback', () => {
  it('falls back only when enabled and only when the backend is down', async () => {
    const enabled = withMockFallback('getFamily', failing, async () => ['mock'], { enabled: true, isBackendDown });
    assert.deepEqual(await enabled(), ['mock']);
    const disabled = withMockFallback('getFamily', failing, async () => ['mock'], { enabled: false, isBackendDown });
    await assert.rejects(disabled());
    const otherError = withMockFallback('getFamily', async () => { throw new Error('400'); }, async () => ['mock'], { enabled: true, isBackendDown });
    await assert.rejects(otherError(), /400/);
  });

  it('with no mock to fall back to, the real call is used as is', async () => {
    const call = withMockFallback('getFamily', failing, undefined, { enabled: true, isBackendDown });
    await assert.rejects(call(), (error) => error === backendDown);
  });

  it('passes a successful real answer straight through', async () => {
    const call = withMockFallback('enrollFace', async (x) => ({ real: x }), mockSuccess, { enabled: true, isBackendDown });
    assert.deepEqual(await call(1), { real: 1 });
  });
});
