/**
 * A family member's setup state from their record alone — the rules behind
 * the family card, the member page and the add flow. customer-account-service
 * already keeps the states apart, so no new field is needed:
 *
 *   saved profile, nothing yet      verification 'pending_document', faceEnrolled false
 *   document verified, face pending verification 'pending_face',     faceEnrolled false
 *                                   (check-in stays frozen until the face is enrolled)
 *   face enrolled                   faceEnrolled true; 'verified' once the document is too
 *
 * A failed or unconfirmed photo enrolment is not stored anywhere: it is the
 * photo step's own state (photoEnrollment), and the profile stays "Face pending".
 *
 * Pure, so it runs under `node --test` (__tests__/memberSetupState.test.mjs).
 */
import type { FamilyMember } from '@/types/domain';

/** Capture screen for a member: one photo under 5, liveness otherwise. */
export function memberCaptureMode(m: Pick<FamilyMember, 'faceCaptureMode' | 'age'> | null | undefined, fallbackAge?: number): 'photo' | 'liveness' {
  if (m?.faceCaptureMode) return m.faceCaptureMode;
  const age = m?.age ?? fallbackAge;
  return age != null && Number.isFinite(age) && age < 5 ? 'photo' : 'liveness';
}

/** The backend never moves a member's `verification` to 'verified' after
 *  face enrollment — it only flips `faceEnrolled`. Gating on 'verified'
 *  alone left "Continue setup" showing forever after a successful scan.
 *  A dependant only reaches 'verified' (account status active) with a face,
 *  so a document alone never counts here ('pending_face'). */
export function isMemberFaceDone(m: Pick<FamilyMember, 'faceEnrolled' | 'verification'>): boolean {
  return m.faceEnrolled || m.verification === 'verified';
}

export interface SetupFlags {
  faceDone: boolean;
  docDone: boolean;
  pinNeeded: boolean;
  /** Face done, but their documents haven't loaded yet — no verdict. */
  checking: boolean;
}

/** Member status badge — identical wherever a member's status shows. */
export function memberSetupBadge({ faceDone, docDone, pinNeeded, checking }: SetupFlags): {
  label: string;
  tone: 'green' | 'amber' | 'neutral';
} {
  if (faceDone && docDone && !pinNeeded) return { label: 'Verified', tone: 'green' };
  if (!faceDone) return { label: 'Face pending', tone: 'amber' };
  if (checking) return { label: 'Checking', tone: 'neutral' };
  if (!docDone) return { label: 'Document needed', tone: 'amber' };
  return { label: 'PIN needed', tone: 'amber' };
}

/**
 * A member under 5 whose photo isn't enrolled can add a birth certificate
 * now (it needs no face) and the photo later. Photo IDs still wait for the
 * face: they are checked against it.
 */
export function offersBirthCertificateInstead(
  m: Pick<FamilyMember, 'faceCaptureMode' | 'age' | 'faceEnrolled' | 'verification'>,
  { docDone }: Pick<SetupFlags, 'docDone'>,
): boolean {
  return memberCaptureMode(m) === 'photo' && !isMemberFaceDone(m) && !docDone;
}
