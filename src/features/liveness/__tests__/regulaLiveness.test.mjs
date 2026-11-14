// Regula liveness on the phone: the server decides which check runs and
// whether it passed; the phone hands on only a transactionId.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Inputs are synthetic SDK results and server errors — no images.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIVENESS_BACKEND_ERROR,
  LIVENESS_ERROR,
  REGULA_MESSAGES,
  createRegulaRunner,
  fallsBackToChallenge,
  outcomeFailure,
  regulaOutcome,
  regulaRunConfig,
  regulaVerdictPassed,
  serverFailure,
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

describe('the ML Kit challenge never stands in for Regula unannounced', () => {
  const disabled = { status: 503, serverCode: 'REGULA_LIVENESS_DISABLED' };
  const oldBff = { status: 404 };

  it('a server not on Regula fails the check when the fallback is off (the default)', () => {
    assert.equal(fallsBackToChallenge(disabled, false), false);
    assert.equal(fallsBackToChallenge(oldBff, false), false);
  });

  it('only an explicitly enabled fallback runs the challenge, and only on that answer', () => {
    assert.equal(fallsBackToChallenge(disabled, true), true);
    assert.equal(fallsBackToChallenge(oldBff, true), true);
  });

  for (const [label, error] of [
    ['Regula unavailable', { status: 503, serverCode: 'REGULA_UNAVAILABLE' }],
    ['no response (network interrupted)', { status: null }],
    ['a server error', { status: 500 }],
    ['rate limited', { status: 429, serverCode: 'LIVENESS_RATE_LIMITED' }],
    ['signed out', { status: 401 }],
  ]) {
    it(`${label}: no challenge even with the fallback on`, () => {
      assert.equal(fallsBackToChallenge(error, true), false);
    });
  }
});

describe("only the server's answer passes a session", () => {
  const SESSION = 'sess_1';

  it('passed, for this session', () => {
    assert.equal(regulaVerdictPassed({ success: true, status: 'passed', session_id: SESSION }, SESSION), true);
  });

  for (const [label, verdict] of [
    ['a failed status', { success: true, status: 'failed', session_id: SESSION }],
    ['success false', { success: false, status: 'passed', session_id: SESSION }],
    ['another session', { success: true, status: 'passed', session_id: 'sess_2' }],
    ['no session', { success: true, status: 'passed' }],
    ['a truthy, non-boolean success', { success: 'true', status: 'passed', session_id: SESSION }],
    ['an empty answer', {}],
    ['no answer', null],
  ]) {
    it(`${label}: not passed`, () => {
      assert.equal(regulaVerdictPassed(verdict, SESSION), false);
    });
  }
});

const CONFIG = { serviceUrl: 'https://faceapi.dev.truepas.com', tag: 'tag_123' };

/** A stand-in for @regulaforensics/face-sdk that records what the runner did. */
function fakeSdk({ initialized = false, initialize, startLiveness } = {}) {
  const calls = { initialize: 0, start: [], stop: 0, serviceUrl: undefined };
  const instance = {
    set serviceUrl(url) { calls.serviceUrl = url; },
    get serviceUrl() { return calls.serviceUrl; },
    isInitialized: async () => initialized,
    initialize: async () => {
      calls.initialize += 1;
      return initialize ? initialize(calls.initialize) : [true, null];
    },
    startLiveness: async (options) => {
      calls.start.push(options.config);
      return startLiveness ? startLiveness(options) : { transactionId: TXN };
    },
    stopLiveness: () => { calls.stop += 1; },
  };
  return {
    calls,
    module: {
      FaceSDK: { instance },
      LivenessConfig: class { constructor(options) { Object.assign(this, options); } },
      LivenessType: { ACTIVE: 'ACTIVE' },
      LivenessSkipStep: { ONBOARDING_STEP: 'ONBOARDING', SUCCESS_STEP: 'SUCCESS' },
      RecordingProcess: { NOT_UPLOAD: 'NOT_UPLOAD' },
    },
  };
}

describe('running Regula on the phone', () => {
  it("initializes once, then starts liveness on the server's Regula with its tag", async () => {
    const sdk = fakeSdk();
    const run = createRegulaRunner(() => sdk.module);
    assert.deepEqual(await run(CONFIG), { kind: 'transaction', transactionId: TXN });
    assert.deepEqual(await run(CONFIG), { kind: 'transaction', transactionId: TXN });
    assert.equal(sdk.calls.initialize, 1);
    assert.equal(sdk.calls.serviceUrl, CONFIG.serviceUrl);
    const [config] = sdk.calls.start;
    assert.equal(config.tag, CONFIG.tag);
    assert.equal(config.livenessType, 'ACTIVE');
    assert.deepEqual(config.skipStep, ['ONBOARDING', 'SUCCESS']);
    assert.equal(config.locationTrackingEnabled, false);
    assert.equal(config.recordingProcess, 'NOT_UPLOAD');
    // No "Powered by Regula" logo on Regula's screens (LivenessConfig.copyright).
    assert.equal(config.copyright, false);
  });

  it('an already initialized SDK is not initialized again', async () => {
    const sdk = fakeSdk({ initialized: true });
    await createRegulaRunner(() => sdk.module)(CONFIG);
    assert.equal(sdk.calls.initialize, 0);
  });

  it('no native module in this build: unavailable, and nothing starts', async () => {
    const run = createRegulaRunner(() => null);
    assert.deepEqual(await run(CONFIG), { kind: 'failed', reason: 'unavailable', message: REGULA_MESSAGES.unavailable });
  });

  it('a failed initialization: unavailable, and the next run tries again', async () => {
    const sdk = fakeSdk({ initialize: (n) => (n === 1 ? [false, { code: 1, message: 'no license' }] : [true, null]) });
    const run = createRegulaRunner(() => sdk.module);
    assert.equal((await run(CONFIG)).reason, 'unavailable');
    assert.equal(sdk.calls.start.length, 0);
    assert.equal((await run(CONFIG)).kind, 'transaction');
    assert.equal(sdk.calls.initialize, 2);
  });

  it('an initialization that throws: unavailable', async () => {
    const sdk = fakeSdk({ initialize: () => { throw new Error('native crash'); } });
    assert.equal((await createRegulaRunner(() => sdk.module)(CONFIG)).reason, 'unavailable');
  });

  it('an initialization that never answers: unavailable after the timeout', async () => {
    const sdk = fakeSdk({ initialize: () => new Promise(() => {}) });
    const run = createRegulaRunner(() => sdk.module, { initTimeoutMs: 20 });
    assert.equal((await run(CONFIG)).reason, 'unavailable');
    assert.equal(sdk.calls.start.length, 0);
  });

  it('the person closes Regula: cancelled', async () => {
    const sdk = fakeSdk({ startLiveness: () => ({ error: { code: LIVENESS_ERROR.CANCELLED } }) });
    assert.deepEqual(await createRegulaRunner(() => sdk.module)(CONFIG), { kind: 'cancelled' });
  });

  it("Regula's own timeout: the timeout message", async () => {
    const sdk = fakeSdk({ startLiveness: () => ({ error: { code: LIVENESS_ERROR.PROCESSING_TIMEOUT } }) });
    assert.equal((await createRegulaRunner(() => sdk.module)(CONFIG)).reason, 'timeout');
  });

  it("a run that never answers: Regula's screen is closed and it times out", async () => {
    const sdk = fakeSdk({ startLiveness: () => new Promise(() => {}) });
    const outcome = await createRegulaRunner(() => sdk.module, { runTimeoutMs: 20 })(CONFIG);
    assert.deepEqual(outcome, { kind: 'failed', reason: 'timeout', message: REGULA_MESSAGES.timeout });
    assert.equal(sdk.calls.stop, 1);
  });

  it('camera permission denied inside Regula: the camera message', async () => {
    const sdk = fakeSdk({ startLiveness: () => ({ error: { code: LIVENESS_ERROR.CAMERA_NO_PERMISSION } }) });
    assert.equal((await createRegulaRunner(() => sdk.module)(CONFIG)).reason, 'camera');
  });

  it("Regula can't reach its service (network interrupted): the network message", async () => {
    const sdk = fakeSdk({ startLiveness: () => ({ error: { code: LIVENESS_ERROR.API_CALL_FAILED } }) });
    assert.equal((await createRegulaRunner(() => sdk.module)(CONFIG)).reason, 'network');
  });

  it('an SDK error with a transaction still goes to the server to decide', async () => {
    const sdk = fakeSdk({ startLiveness: () => ({ transactionId: TXN, error: { code: LIVENESS_ERROR.PROCESSING_FAILED } }) });
    assert.deepEqual(await createRegulaRunner(() => sdk.module)(CONFIG), { kind: 'transaction', transactionId: TXN });
  });

  it('startLiveness throws: failed, never a rejection', async () => {
    const sdk = fakeSdk({ startLiveness: () => { throw new Error('bridge error'); } });
    assert.deepEqual(await createRegulaRunner(() => sdk.module)(CONFIG), { kind: 'failed', reason: 'failed', message: REGULA_MESSAGES.failed });
  });

  it('the SDK answers nothing usable: failed', async () => {
    const sdk = fakeSdk({ startLiveness: () => null });
    assert.equal((await createRegulaRunner(() => sdk.module)(CONFIG)).kind, 'failed');
  });
});

describe("Regula's screens in TruePas colors and words", () => {
  const APPEARANCE = {
    colors: { processingScreenBackground: 0xff011b27, cameraScreenStrokeActive: 0xff08b6fc, unused: undefined },
    strings: { 'hint.lookStraight': 'Look straight at the camera' },
    cameraSwitch: true,
  };

  /** The fake SDK with a customization whose color setters record each value, like the SDK's. */
  function customizableSdk(options) {
    const sdk = fakeSdk(options);
    const set = {};
    const colors = {};
    for (const name of ['processingScreenBackground', 'cameraScreenStrokeActive']) {
      Object.defineProperty(colors, name, { set(v) { set[name] = v; }, enumerable: true });
    }
    sdk.module.FaceSDK.instance.customization = { colors };
    return { ...sdk, set };
  }

  it('sets the colors through the SDK setters and the text dictionary before Regula opens', async () => {
    const sdk = customizableSdk({
      startLiveness: () => {
        // Applied before the screen opens.
        assert.equal(sdk.set.processingScreenBackground, 0xff011b27);
        return { transactionId: TXN };
      },
    });
    const outcome = await createRegulaRunner(() => sdk.module)(CONFIG, APPEARANCE);
    assert.deepEqual(outcome, { kind: 'transaction', transactionId: TXN });
    assert.deepEqual(sdk.set, { processingScreenBackground: 0xff011b27, cameraScreenStrokeActive: 0xff08b6fc });
    assert.deepEqual(sdk.module.FaceSDK.instance.localizationDictionary, APPEARANCE.strings);
    assert.equal(sdk.calls.start[0].cameraSwitchEnabled, true);
  });

  it("without an appearance, Regula's camera switch stays off", async () => {
    const sdk = fakeSdk();
    await createRegulaRunner(() => sdk.module)(CONFIG);
    assert.equal(sdk.calls.start[0].cameraSwitchEnabled, false);
  });

  it("a customization failure leaves Regula's defaults and never stops the check", async () => {
    const sdk = fakeSdk();
    sdk.module.FaceSDK.instance.customization = {
      colors: Object.defineProperty({}, 'processingScreenBackground', { set() { throw new Error('bridge'); } }),
    };
    const outcome = await createRegulaRunner(() => sdk.module)(CONFIG, { ...APPEARANCE, colors: { processingScreenBackground: 1 } });
    assert.deepEqual(outcome, { kind: 'transaction', transactionId: TXN });
  });
});

describe('a face Regula judges too young', () => {
  it('no transaction and SMALL_AGE: its own message, never a pass', () => {
    const outcome = regulaOutcome({ error: { code: LIVENESS_ERROR.PROCESSING_FAILED, underlyingError: { code: LIVENESS_BACKEND_ERROR.SMALL_AGE } } });
    assert.deepEqual(outcome, { kind: 'failed', reason: 'smallAge', message: REGULA_MESSAGES.smallAge });
    assert.equal(outcomeFailure(outcome), 'not_verified');
  });

  it('a transaction still goes to the server, which decides', () => {
    const outcome = regulaOutcome({ transactionId: TXN, error: { underlyingError: { code: LIVENESS_BACKEND_ERROR.SMALL_AGE } } });
    assert.deepEqual(outcome, { kind: 'transaction', transactionId: TXN });
  });
});

describe('how a failed check is headed: success, refusal, cancellation and timeout stay apart', () => {
  it('a cancellation, a timeout and an unavailable SDK each have their own kind', () => {
    assert.equal(outcomeFailure({ kind: 'cancelled' }), 'cancelled');
    assert.equal(outcomeFailure(regulaOutcome({ error: { code: LIVENESS_ERROR.PROCESSING_TIMEOUT } })), 'timeout');
    assert.equal(outcomeFailure(regulaOutcome({ error: { code: LIVENESS_ERROR.NO_LICENSE } })), 'unavailable');
    assert.equal(outcomeFailure(regulaOutcome({ error: { code: LIVENESS_ERROR.CAMERA_NO_PERMISSION } })), 'error');
  });

  for (const [label, error, kind] of [
    ["Regula's refusal read by the server (not live)", { status: 422, serverCode: 'LIVENESS_FAILED' }, 'not_verified'],
    ['a transaction for another session', { status: 422, serverCode: 'REGULA_TRANSACTION_MISMATCH' }, 'not_verified'],
    ['a reused transaction', { status: 409, serverCode: 'REGULA_TRANSACTION_REUSED' }, 'not_verified'],
    ['Regula unreachable from the server', { status: 503, serverCode: 'REGULA_UNAVAILABLE' }, 'unavailable'],
    ['no response (network interrupted)', { status: null }, 'error'],
    ['an expired session', { status: 404 }, 'error'],
  ]) {
    it(`${label}: ${kind}`, () => {
      assert.equal(serverFailure(error), kind);
    });
  }
});
