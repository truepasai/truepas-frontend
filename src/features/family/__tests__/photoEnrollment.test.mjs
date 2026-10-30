// Sending the enrolment photo once, and settling an unanswered send by its
// exact enrollment reference.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SERVER_CODE_MESSAGES } from '../../../api/serverCodeMessages.ts';
import {
  ATTEMPT_OVER_AFTER_MS,
  RECOVERY_DEADLINE_MS,
  SERVER_ACTIVATION_DEADLINE_MS,
  attemptOnRecord,
  canCancelNewMember,
  canContinueWithoutPhoto,
  confirmEnrollment,
  enrollOnce,
  isUnclearFailure,
} from '../photoEnrollment.ts';

const MINE = 'enr_7d1e9c4a-1b2c-4d3e-8f90-123456789abc';
const OTHER_PHONE = 'enr_0a0b0c0d-1111-4222-9333-444455556666';

// Errors as api/errors toApiError shapes them.
const TIMEOUT = { status: null, code: 'TIMEOUT', message: 'Request timed out. Please try again.' };
const NETWORK = { status: null, code: 'NETWORK', message: 'Cannot reach the server.' };
const RESULT_UNKNOWN = { status: 503, code: 'SERVICE_UNAVAILABLE', serverCode: 'ENROLLMENT_RESULT_UNKNOWN', message: SERVER_CODE_MESSAGES.ENROLLMENT_RESULT_UNKNOWN };
const GATEWAY = { status: 502, code: 'SERVER', message: 'Server error.' };
const FACE_DOWN = { status: 503, code: 'SERVICE_UNAVAILABLE', serverCode: 'FACE_SERVICE_UNAVAILABLE', message: SERVER_CODE_MESSAGES.FACE_SERVICE_UNAVAILABLE };
const NOT_SAVED = { status: 503, code: 'SERVICE_UNAVAILABLE', serverCode: 'ENROLLMENT_NOT_SAVED', message: SERVER_CODE_MESSAGES.ENROLLMENT_NOT_SAVED };
const NO_FACE = { status: 422, code: 'VALIDATION', serverCode: 'FACE_NOT_DETECTED', message: SERVER_CODE_MESSAGES.FACE_NOT_DETECTED };
const UNREADABLE = { status: 422, code: 'VALIDATION', serverCode: 'IMAGE_UNDECODABLE', message: SERVER_CODE_MESSAGES.IMAGE_UNDECODABLE };
const NOT_USABLE = { status: 422, code: 'VALIDATION', serverCode: 'IMAGE_NOT_USABLE', message: SERVER_CODE_MESSAGES.IMAGE_NOT_USABLE };
const TOO_LARGE = { status: 413, code: 'PAYLOAD_TOO_LARGE', serverCode: 'IMAGE_TOO_LARGE', message: SERVER_CODE_MESSAGES.IMAGE_TOO_LARGE };
const ALREADY = { status: 409, code: 'CONFLICT', serverCode: 'FACE_ALREADY_ENROLLED', message: SERVER_CODE_MESSAGES.FACE_ALREADY_ENROLLED };
const GONE = { status: 404, code: 'NOT_FOUND', serverCode: 'FAMILY_MEMBER_NOT_FOUND', message: SERVER_CODE_MESSAGES.FAMILY_MEMBER_NOT_FOUND };

const none = { faceEnrolled: false, faceEnrollmentRef: null };
const face = (ref) => ({ faceEnrolled: true, faceEnrollmentRef: ref });
const down = () => new Error('unreachable');

/**
 * The server, scripted on a fake clock: `record(t)` answers a read of the
 * member's record at t ms after the photo was sent (an Error = unreachable,
 * null = removed); `send` is what the one POST does.
 */
function server({ record, before = none, send = 'ok', sendTakes = 15_000 }) {
  const log = { reads: [], sends: 0 };
  let clock = 1_000_000;
  let sentAt = null;
  const deps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    readStatus: async () => {
      if (sentAt === null) {
        log.reads.push('before');
        if (before instanceof Error) throw before;
        return before;
      }
      const t = clock - sentAt;
      log.reads.push(t);
      const value = record(t);
      if (value instanceof Error) throw value;
      return value;
    },
    submit: async () => {
      log.sends += 1;
      sentAt = clock;
      if (send === 'ok') return;
      clock += sendTakes; // the request ran until its timeout / error
      throw send;
    },
    toError: (err) => (err instanceof Error ? { status: null, code: 'NETWORK', message: err.message } : err),
  };
  return { deps, log };
}

describe('the recovery window', () => {
  it('outlasts the server activation deadline, the request timeout and a margin', () => {
    assert.equal(SERVER_ACTIVATION_DEADLINE_MS, 45_000);
    assert.equal(ATTEMPT_OVER_AFTER_MS, 65_000);
    assert.ok(RECOVERY_DEADLINE_MS > ATTEMPT_OVER_AFTER_MS);
    assert.equal(RECOVERY_DEADLINE_MS, 75_000);
  });
});

describe('the reference on the record', () => {
  it('only an exact, present reference is this attempt', () => {
    assert.equal(attemptOnRecord(face(MINE), MINE), 'mine');
    assert.equal(attemptOnRecord(face(OTHER_PHONE), MINE), 'other');
    assert.equal(attemptOnRecord(face(null), MINE), 'other'); // missing: never claimed
    assert.equal(attemptOnRecord(face(`${MINE}x`), MINE), 'other');
    assert.equal(attemptOnRecord(face(MINE.toUpperCase()), MINE), 'other');
    assert.equal(attemptOnRecord(none, MINE), 'none');
    assert.equal(attemptOnRecord({ faceEnrolled: false, faceEnrollmentRef: MINE }, MINE), 'none'); // stale: no active face
    assert.equal(attemptOnRecord(null, MINE), 'gone');
  });
});

describe('a send that is answered', () => {
  it('enrols when the member had no face', async () => {
    const { deps, log } = server({ record: () => assert.fail('no recovery needed') });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'enrolled', recovered: false });
    assert.equal(log.sends, 1);
  });

  it('never sends when the member already has a face — a conflict, not a success', async () => {
    const { deps, log } = server({ before: face(MINE), record: () => assert.fail() });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'conflict' });
    assert.equal(log.sends, 0);
  });

  it('a 409 is a conflict when the record shows another enrolment', async () => {
    const { deps } = server({ send: ALREADY, sendTakes: 100, record: () => face(OTHER_PHONE) });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'conflict' });
  });

  it('a 409 is a conflict when the record cannot be read', async () => {
    const { deps } = server({ send: ALREADY, sendTakes: 100, record: () => down() });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'conflict' });
  });

  it('a 409 is this attempt only when the record carries its exact reference', async () => {
    const { deps } = server({ send: ALREADY, sendTakes: 100, record: () => face(MINE) });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'enrolled', recovered: true });
  });

  it('reports the photo problems and asks for a retake', async () => {
    for (const error of [NO_FACE, UNREADABLE, NOT_USABLE, TOO_LARGE]) {
      const { deps, log } = server({ send: error, sendTakes: 100, record: () => assert.fail('a clear refusal needs no reads') });
      const result = await enrollOnce(deps, { ref: MINE });
      assert.equal(result.state, 'failed');
      assert.equal(result.retake, true, error.serverCode);
      assert.equal(result.error.message, error.message);
      assert.deepEqual(log.reads, ['before']);
    }
  });

  it('never tells the user there was no face when the photo just could not be read', () => {
    for (const code of ['IMAGE_UNDECODABLE', 'IMAGE_NOT_USABLE']) {
      assert.doesNotMatch(SERVER_CODE_MESSAGES[code], /couldn't find a face|no face was found/i);
    }
    assert.notEqual(SERVER_CODE_MESSAGES.IMAGE_NOT_USABLE, SERVER_CODE_MESSAGES.FACE_NOT_DETECTED);
  });

  it('"nothing saved" failures allow a new attempt straight away', async () => {
    for (const error of [FACE_DOWN, NOT_SAVED]) {
      const { deps, log } = server({ send: error, sendTakes: 100, record: () => assert.fail() });
      const result = await enrollOnce(deps, { ref: MINE });
      assert.deepEqual([result.state, result.retake], ['failed', false]);
      assert.deepEqual(log.reads, ['before']);
    }
  });

  it('a member removed meanwhile is reported, not retried', async () => {
    assert.deepEqual(await enrollOnce(server({ before: null, record: () => assert.fail() }).deps, { ref: MINE }), { state: 'member_gone' });
    assert.deepEqual(await enrollOnce(server({ send: GONE, sendTakes: 100, record: () => assert.fail() }).deps, { ref: MINE }), { state: 'member_gone' });
  });

  it('when the record cannot be read before sending, nothing is sent', async () => {
    const { deps, log } = server({ before: down(), record: () => assert.fail() });
    assert.equal((await enrollOnce(deps, { ref: MINE })).state, 'failed');
    assert.equal(log.sends, 0);
  });
});

describe('a send that is never answered', () => {
  for (const [name, error] of [['a timeout', TIMEOUT], ['no response', NETWORK], ['ENROLLMENT_RESULT_UNKNOWN', RESULT_UNKNOWN], ['a 502', GATEWAY]]) {
    it(`after ${name}, success is confirmed only by this attempt's reference — with no resend`, async () => {
      const { deps, log } = server({ send: error, record: (t) => (t < 25_000 ? none : face(MINE)) });
      assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'enrolled', recovered: true });
      assert.equal(log.sends, 1);
    });
  }

  it('another phone winning is never credited to this one', async () => {
    const { deps, log } = server({ send: TIMEOUT, record: (t) => (t < 20_000 ? none : face(OTHER_PHONE)) });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'enrolled_elsewhere' });
    assert.equal(log.sends, 1);
  });

  it('a face with no reference (enrolled before references, or by an older server) is not this attempt', async () => {
    const { deps } = server({ send: TIMEOUT, record: () => face(null) });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'enrolled_elsewhere' });
  });

  it('while the attempt could still be activated, "no face yet" never settles it', async () => {
    const { deps, log } = server({ send: TIMEOUT, record: () => none });
    const result = await enrollOnce(deps, { ref: MINE });
    assert.deepEqual(result, { state: 'not_completed' });
    const reads = log.reads.filter((t) => t !== 'before');
    // Only a read at or after the point the attempt can no longer activate settles it.
    assert.ok(reads.at(-1) >= ATTEMPT_OVER_AFTER_MS, String(reads));
    assert.ok(reads.slice(0, -1).every((t) => t < ATTEMPT_OVER_AFTER_MS));
    assert.equal(log.sends, 1);
  });

  it('once confirmed absent, a new attempt (with a new reference) is accepted', async () => {
    const first = server({ send: TIMEOUT, record: () => none });
    assert.deepEqual(await enrollOnce(first.deps, { ref: MINE }), { state: 'not_completed' });
    const second = server({ record: () => assert.fail() });
    assert.deepEqual(await enrollOnce(second.deps, { ref: OTHER_PHONE }), { state: 'enrolled', recovered: false });
  });

  it('an unreachable record within the deadline is unknown — never success, never failure, no resend', async () => {
    const { deps, log } = server({ send: TIMEOUT, record: () => down() });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'unknown' });
    assert.equal(log.sends, 1);
    assert.ok(log.reads.filter((t) => t !== 'before').every((t) => t <= RECOVERY_DEADLINE_MS));
  });

  it('a record readable only before the attempt is over stays unknown', async () => {
    const { deps } = server({ send: TIMEOUT, record: (t) => (t < 40_000 ? none : down()) });
    assert.deepEqual(await enrollOnce(deps, { ref: MINE }), { state: 'unknown' });
  });

  it('the recovery stops at one bounded deadline', async () => {
    const { deps, log } = server({ send: TIMEOUT, record: () => down() });
    await enrollOnce(deps, { ref: MINE });
    const reads = log.reads.filter((t) => t !== 'before');
    assert.ok(reads.length > 3 && reads.length < 20, String(reads));
    assert.ok(Math.max(...reads) <= RECOVERY_DEADLINE_MS);
  });

  it('"Check again" after unknown reads the record and never sends', async () => {
    let clock = 0;
    const deps = (record) => ({ now: () => clock, sleep: async (ms) => { clock += ms; }, readStatus: async () => record });
    clock = 90_000; // past the recovery deadline of an attempt sent at 0
    assert.deepEqual(await confirmEnrollment(deps(face(MINE)), { ref: MINE, sentAt: 0, deadlineMs: 100_000 }), { state: 'enrolled', recovered: true });
    assert.deepEqual(await confirmEnrollment(deps(none), { ref: MINE, sentAt: 0, deadlineMs: 100_000 }), { state: 'not_completed' });
    assert.deepEqual(await confirmEnrollment(deps(face(OTHER_PHONE)), { ref: MINE, sentAt: 0, deadlineMs: 100_000 }), { state: 'enrolled_elsewhere' });
  });
});

describe('isUnclearFailure', () => {
  it('only failures that may have stored or activated the face are unclear', () => {
    for (const error of [TIMEOUT, NETWORK, RESULT_UNKNOWN, GATEWAY]) assert.equal(isUnclearFailure(error), true, error.code);
    for (const error of [FACE_DOWN, NOT_SAVED, NO_FACE, NOT_USABLE, ALREADY]) assert.equal(isUnclearFailure(error), false, error.serverCode);
  });
});

describe('cancelling Add member from the photo step', () => {
  it('is allowed while nothing is on its way to the server', () => {
    for (const phase of ['camera', 'preparing', 'review']) assert.equal(canCancelNewMember(phase), true, phase);
  });

  it('is not allowed while a photo may still be stored, or once it is saved', () => {
    for (const phase of ['sending', 'confirming', 'unknown', 'done']) assert.equal(canCancelNewMember(phase), false, phase);
  });

  it('continuing to the birth certificate follows the same rule', () => {
    assert.equal(canContinueWithoutPhoto('review'), true);
    assert.equal(canContinueWithoutPhoto('confirming'), false);
  });
});

describe('the screen (source guard)', () => {
  // Screens can't be rendered under node --test: this pins the wiring that
  // decides when this phone's photo becomes the member's avatar.
  const screen = readFileSync(new URL('../../../premium/flows/familyPhotoCapture.tsx', import.meta.url), 'utf8');

  it('saves the photo as the avatar only in enrolled(), reached only for this attempt or a PIN-gated update', () => {
    assert.equal((screen.match(/rememberMemberPhoto\(/g) ?? []).length, 1);
    assert.match(screen, /const enrolled = async \(photo: NormalizedPhoto\) => \{[\s\S]*?await rememberMemberPhoto\(personId!, photo\.uri\);/);
    const calls = screen.match(/await enrolled\(photo\);/g) ?? [];
    assert.equal(calls.length, 2); // case 'enrolled' and the PUT update's success
    assert.match(screen, /case 'enrolled':[\s\S]*?await enrolled\(photo\);[\s\S]*?case 'enrolled_elsewhere':/);
    const elsewhere = screen.slice(screen.indexOf("case 'enrolled_elsewhere':"), screen.indexOf("case 'failed':"));
    assert.doesNotMatch(elsewhere, /enrolled\(|rememberMemberPhoto/);
  });

  it('sends the reference with the photo and starts no second attempt while one is unsettled', () => {
    assert.match(screen, /enrollmentRef: ref/);
    assert.match(screen, /if \(attempt\.current\) return;/);
    assert.match(screen, /newEnrollmentRef\(uuid\.v4\)/);
  });
});
