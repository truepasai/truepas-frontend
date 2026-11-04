// Regula liveness on the phone: the server decides which check runs and
// whether it passed; the phone hands on only a transactionId.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Inputs are synthetic SDK results and server errors — no images.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIVENESS_ERROR,
  REGULA_MESSAGES,
  regulaOutcome,
  regulaRunConfig,
  serverUsesChallenge,
} from '../regulaLiveness.ts';

const TXN = '3f2b8c1e-5a7d-4e2b-9c6a-1d2e3f4a5b6c';

describe('which liveness check the server runs', () => {
  it("the liveness service's own 'not on Regula' answer means the challenge", () => {
    assert.equal(serverUsesChallenge({ status: 503, serverCode: 'REGULA_LIVENESS_DISABLED' }), true);
  });

  it('a BFF without the Regula routes (404, no code) means the challenge', () => {
    assert.equal(serverUsesChallenge({ status: 404 }), true);
  });

  for (const [label, error] of [
    ['Regula unavailable', { status: 503, serverCode: 'REGULA_UNAVAILABLE' }],
    ['a generic 503', { status: 503 }],
    ['no response (offline)', { status: null }],
    ['rate limited', { status: 429, serverCode: 'LIVENESS_RATE_LIMITED' }],
    ['a refused family member', { status: 404, serverCode: 'FAMILY_MEMBER_NOT_FOUND' }],
    ['a photo-enrolled child', { status: 422 }],
    ['face sign-in for someone else', { status: 403 }],
    ['the disabled code on another status', { status: 409, serverCode: 'REGULA_LIVENESS_DISABLED' }],
  ]) {
    it(`${label}: a failure, never a fallback to the challenge`, () => {
      assert.equal(serverUsesChallenge(error), false);
    });
  }
});

describe("the SDK runs only on the server's Regula, with its tag", () => {
  it('uses the URL and tag the server sent', () => {
    assert.deepEqual(
      regulaRunConfig({ service_url: 'https://faceapi.dev.truepas.com', tag: 'abc_DEF-123' }),
      { serviceUrl: 'https://faceapi.dev.truepas.com', tag: 'abc_DEF-123' },
    );
  });

  for (const [label, session] of [
    ['no URL (the SDK would use its own default service)', { service_url: null, tag: 'abc' }],
    ['an empty URL', { service_url: '', tag: 'abc' }],
    ['a cleartext URL', { service_url: 'http://faceapi.dev.truepas.com', tag: 'abc' }],
    ["Regula's public service", { service_url: 'https://faceapi.regulaforensics.com', tag: 'abc' }],
    ["Regula's public service, any case or port", { service_url: 'https://FaceAPI.RegulaForensics.com:443/', tag: 'abc' }],
    ['credentials in the URL', { service_url: 'https://user:pass@faceapi.dev.truepas.com', tag: 'abc' }],
    ['no tag', { service_url: 'https://faceapi.dev.truepas.com' }],
    ['a tag outside Regula\'s alphabet', { service_url: 'https://faceapi.dev.truepas.com', tag: 'a b' }],
    ['a tag over 127 characters', { service_url: 'https://faceapi.dev.truepas.com', tag: 'a'.repeat(128) }],
  ]) {
    it(`${label}: not run`, () => {
      assert.equal(regulaRunConfig(session), null);
    });
  }
});

describe('what an SDK result becomes', () => {
  it('a transaction goes to the server, whatever the SDK says about it', () => {
    // The SDK's PASSED (0) or UNKNOWN (1) is never the verdict.
    for (const liveness of [0, 1, undefined]) {
      assert.deepEqual(regulaOutcome({ transactionId: TXN, liveness }), { kind: 'transaction', transactionId: TXN });
    }
  });

  it('a transaction the SDK reports as failed still goes to the server, which records the refusal', () => {
    const outcome = regulaOutcome({ transactionId: TXN, error: { code: LIVENESS_ERROR.PROCESSING_FAILED } });
    assert.deepEqual(outcome, { kind: 'transaction', transactionId: TXN });
  });

  it('a cancellation sends nothing, even with a transaction', () => {
    assert.deepEqual(regulaOutcome({ error: { code: LIVENESS_ERROR.CANCELLED } }), { kind: 'cancelled' });
    assert.deepEqual(regulaOutcome({ transactionId: TXN, error: { code: LIVENESS_ERROR.CANCELLED } }), { kind: 'cancelled' });
  });

  for (const [code, reason] of [
    [LIVENESS_ERROR.API_CALL_FAILED, 'network'],
    [LIVENESS_ERROR.SESSION_START_FAILED, 'network'],
    [LIVENESS_ERROR.CAMERA_NO_PERMISSION, 'camera'],
    [LIVENESS_ERROR.CAMERA_NOT_AVAILABLE, 'camera'],
    [LIVENESS_ERROR.PROCESSING_TIMEOUT, 'timeout'],
    [LIVENESS_ERROR.APPLICATION_INACTIVE, 'interrupted'],
    [LIVENESS_ERROR.NO_LICENSE, 'unavailable'],
    [LIVENESS_ERROR.NOT_INITIALIZED, 'unavailable'],
    [LIVENESS_ERROR.BAD_FACE_QUALITY, 'failed'],
    [99, 'failed'],
  ]) {
    it(`no transaction, error ${code}: fails with the ${reason} message`, () => {
      const outcome = regulaOutcome({ transactionId: null, error: { code } });
      assert.deepEqual(outcome, { kind: 'failed', reason, message: REGULA_MESSAGES[reason] });
    });
  }

  for (const response of [null, undefined, {}, { transactionId: '' }, { transactionId: '   ' }, { transactionId: 7 }]) {
    it(`no usable transaction (${JSON.stringify(response)}): fails`, () => {
      assert.equal(regulaOutcome(response).kind, 'failed');
    });
  }
});
