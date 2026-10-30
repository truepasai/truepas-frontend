/**
 * One photo-enrolment attempt's reference: "enr_" + a UUID v4 from the
 * platform's secure generator (expo-modules-core uuid.v4: SecureRandom on
 * Android, the system UUID on iOS). Made before the photo is sent and kept
 * until the attempt is settled; customer-account-service stores it with the
 * activation, so after an unanswered send only this exact value proves the
 * active face is this attempt's. Never built from member, face or document
 * ids, and never from Math.random.
 *
 * Pure, so it runs under `node --test` (__tests__/enrollmentRef.test.mjs).
 */
export const ENROLLMENT_REF_PATTERN = /^enr_[A-Za-z0-9_-]{16,60}$/;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Throws when the generator doesn't give a real v4 UUID: no attempt starts without one. */
export function newEnrollmentRef(uuidv4: () => string): string {
  const id = uuidv4();
  if (typeof id !== 'string' || !UUID_V4.test(id)) {
    throw new Error('No secure random generator is available for the enrollment reference.');
  }
  return `enr_${id.toLowerCase()}`;
}
