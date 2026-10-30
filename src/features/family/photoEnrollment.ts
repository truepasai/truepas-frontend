/**
 * One family-member photo enrolment (POST /face/enroll), and what to do when
 * its answer never arrives. Every attempt carries its own enrollment
 * reference (enrollmentRef), made on the phone before sending; the authority
 * is the member's record (GET /family/{id} → faceEnrolled, faceEnrollmentRef),
 * whose reference customer-account-service sets in the same write that
 * activates a face.
 *
 *  - Before sending, the member must have no face: the only state a first
 *    enrolment can win. A face already active is a conflict, never a success.
 *  - A clear refusal (no face found, unusable photo, too large, nothing saved)
 *    is shown as is; a new attempt is safe.
 *  - After an unclear failure (timeout, no response, 5xx,
 *    ENROLLMENT_RESULT_UNKNOWN) nothing is sent again. The record is read
 *    until one bounded deadline (RECOVERY_DEADLINE_MS from sending):
 *    · its reference is this attempt's → enrolled: this photo is the face;
 *    · a face with any other reference, or none → enrolled elsewhere: a face
 *      is set up, but not from this photo (another phone won, say);
 *    · still no face once the attempt can no longer be activated
 *      (ATTEMPT_OVER_AFTER_MS) → not completed: a new attempt is safe;
 *    · not settled by the deadline → unknown: "Check again", never a resend.
 *  - A 409 is a conflict unless the record proves this very attempt's face
 *    is the active one.
 *
 * Pure, so it runs under `node --test` (__tests__/photoEnrollment.test.mjs).
 */
import type { MemberFaceStatus } from '@/types/domain';

/** The parts of an ApiError (api/errors toApiError) this needs. */
export interface EnrollError {
  status: number | null;
  /** Client category: TIMEOUT, NETWORK, VALIDATION… */
  code?: string;
  /** The BFF's machine code: FACE_NOT_DETECTED, ENROLLMENT_RESULT_UNKNOWN… */
  serverCode?: string;
  message: string;
}

export type EnrollResult =
  /** This attempt's face is the active one: answered directly, or its
   *  reference confirmed on the member's record (`recovered`). */
  | { state: 'enrolled'; recovered: boolean }
  /** A face is active, but not this attempt's (another phone, an older face). */
  | { state: 'enrolled_elsewhere' }
  /** A clear refusal. `retake`: the photo itself was the problem. */
  | { state: 'failed'; error: EnrollError; retake: boolean }
  /** This attempt can no longer be activated and wasn't: a new one is safe. */
  | { state: 'not_completed' }
  /** Not settled within the deadline: check again; no new attempt yet. */
  | { state: 'unknown' }
  /** A face was already active before this photo was sent. */
  | { state: 'conflict' }
  | { state: 'member_gone' };

export interface EnrollDeps {
  /** GET /family/{id} → the member's face; null when they are no longer in
   *  the family (404). Throws when the record can't be read. */
  readStatus(): Promise<MemberFaceStatus | null>;
  /** POST /face/enroll with the prepared photo and this attempt's reference. */
  submit(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Milliseconds, for the recovery deadline. */
  now(): number;
  toError(err: unknown): EnrollError;
}

/** customer-app-bff ENROLLMENT_ACTIVATION_DEADLINE_SECONDS: customer-account-
 *  service never activates an attempt later than this after it arrived. */
export const SERVER_ACTIVATION_DEADLINE_MS = 45_000;
/** api/client's request timeout: the longest an attempt can take to arrive. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** From sending: an attempt not active by now never will be (server deadline,
 *  the longest arrival, and 5 s for clocks and the activation write). */
export const ATTEMPT_OVER_AFTER_MS = SERVER_ACTIVATION_DEADLINE_MS + REQUEST_TIMEOUT_MS + 5_000;
/** The one recovery window, from sending: past ATTEMPT_OVER_AFTER_MS so the
 *  reads after it can settle "not completed". */
export const RECOVERY_DEADLINE_MS = 75_000;
/** Time between reads of the member's record. */
export const STATUS_POLL_MS = 5_000;

const PHOTO_PROBLEMS = new Set(['FACE_NOT_DETECTED', 'IMAGE_UNDECODABLE', 'IMAGE_NOT_USABLE', 'IMAGE_TOO_LARGE']);
/** Failures the BFF reports only when the attempt certainly wasn't activated. */
const NOTHING_SAVED = new Set(['FACE_SERVICE_UNAVAILABLE', 'ENROLLMENT_NOT_SAVED']);

/** Might the attempt have been stored, or activated, even though this call failed? */
export function isUnclearFailure(error: EnrollError): boolean {
  if (NOTHING_SAVED.has(error.serverCode ?? '')) return false;
  if (error.serverCode === 'ENROLLMENT_RESULT_UNKNOWN') return true;
  if (error.code === 'TIMEOUT' || error.code === 'NETWORK' || error.status == null) return true;
  return error.status >= 500;
}

/** What the member's record says about the attempt `ref`. Only an exact,
 *  present reference counts: a missing or different one is never this attempt's. */
export function attemptOnRecord(status: MemberFaceStatus | null, ref: string): 'mine' | 'other' | 'none' | 'gone' {
  if (status === null) return 'gone';
  if (!status.faceEnrolled) return 'none';
  return typeof status.faceEnrollmentRef === 'string' && status.faceEnrollmentRef === ref ? 'mine' : 'other';
}

/**
 * Read the member's record until the attempt `ref` (sent at `sentAt`) is
 * settled or `sentAt + deadlineMs` passes. Never sends anything.
 */
export async function confirmEnrollment(
  deps: Pick<EnrollDeps, 'readStatus' | 'sleep' | 'now'>,
  { ref, sentAt, deadlineMs = RECOVERY_DEADLINE_MS, pollMs = STATUS_POLL_MS }: { ref: string; sentAt: number; deadlineMs?: number; pollMs?: number },
): Promise<EnrollResult> {
  for (;;) {
    try {
      const status = await deps.readStatus();
      const readAt = deps.now();
      const found = attemptOnRecord(status, ref);
      if (found === 'gone') return { state: 'member_gone' };
      if (found === 'mine') return { state: 'enrolled', recovered: true };
      if (found === 'other') return { state: 'enrolled_elsewhere' };
      if (readAt - sentAt >= ATTEMPT_OVER_AFTER_MS) return { state: 'not_completed' };
    } catch {
      // Unreachable for now; the next read may work.
    }
    const left = sentAt + deadlineMs - deps.now();
    if (left <= 0) return { state: 'unknown' };
    await deps.sleep(Math.min(pollMs, left));
  }
}

/** Send the photo once as attempt `ref`, then settle what happened. */
export async function enrollOnce(deps: EnrollDeps, { ref }: { ref: string }): Promise<EnrollResult> {
  let before: MemberFaceStatus | null;
  try {
    before = await deps.readStatus();
  } catch (err) {
    // Nothing sent yet, so trying again is safe.
    return { state: 'failed', error: deps.toError(err), retake: false };
  }
  if (before === null) return { state: 'member_gone' };
  if (before.faceEnrolled) return { state: 'conflict' };

  const sentAt = deps.now();
  try {
    await deps.submit();
    return { state: 'enrolled', recovered: false };
  } catch (err) {
    const error = deps.toError(err);
    if (error.serverCode === 'FAMILY_MEMBER_NOT_FOUND' || error.status === 404) return { state: 'member_gone' };
    if (error.serverCode === 'FACE_ALREADY_ENROLLED' || error.status === 409) {
      // A conflict — unless the record proves this very attempt's face is active.
      try {
        if (attemptOnRecord(await deps.readStatus(), ref) === 'mine') return { state: 'enrolled', recovered: true };
      } catch {
        // Unproven: a conflict.
      }
      return { state: 'conflict' };
    }
    if (!isUnclearFailure(error)) {
      return {
        state: 'failed',
        error,
        retake: PHOTO_PROBLEMS.has(error.serverCode ?? '') || error.status === 413 || error.status === 422,
      };
    }
    return confirmEnrollment(deps, { ref, sentAt });
  }
}

/** Where the photo step is. Sending/confirming/unknown: a photo may be on its way to the server. */
export type PhotoStepPhase = 'camera' | 'preparing' | 'review' | 'sending' | 'confirming' | 'unknown' | 'done';

/**
 * Deliberately cancelling Add member removes the new profile — but never
 * while a photo may still be stored by the server (sending, confirming, or
 * unknown), and never once it is saved. Leaving the screen any other way
 * keeps the profile, face pending.
 */
export function canCancelNewMember(phase: PhotoStepPhase): boolean {
  return phase === 'camera' || phase === 'preparing' || phase === 'review';
}

/** Going on to the birth certificate is fine whenever nothing is in flight. */
export const canContinueWithoutPhoto = canCancelNewMember;
