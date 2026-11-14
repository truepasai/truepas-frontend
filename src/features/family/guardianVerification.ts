/**
 * Guardian verification on a child's page: the parent submits evidence of
 * legal authority (for example a birth certificate) and a TruePas reviewer
 * decides. customer-account-service owns the status; nothing here, and
 * nothing the app sends, can mark a guardianship verified. This module only
 * words the screen and reads the answers.
 *
 * No imports, so it runs under `node --test` (__tests__/guardianVerification.test.mjs).
 */

export type GuardianVerificationStatus =
  | 'not_submitted'
  | 'pending_review'
  | 'verified'
  | 'rejected'
  | 'information_required'
  | 'revoked';

/** GET /cb/family/{id}/guardian-verification (no storage key or URL, ever). */
export type GuardianVerification = {
  status: GuardianVerificationStatus;
  evidenceType: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  informationRequest: string | null;
  revokedAt: string | null;
  canSubmit: boolean;
  submissionEnabled: boolean;
  evidenceTypes: string[];
  fileTypes: string[];
  maxBytes: number;
};

export type GuardianEvidenceUpload = { evidenceType: string; contentType: string; data: string };

type Tone = 'green' | 'amber' | 'sky' | 'red' | 'neutral';

const STATUS_COPY: Record<GuardianVerificationStatus, { label: string; tone: Tone; body: (first: string) => string }> = {
  not_submitted: {
    label: 'Not submitted',
    tone: 'neutral',
    body: (first) => `Upload a document that shows you are ${first}'s parent or legal guardian.`,
  },
  pending_review: {
    label: 'Pending review',
    tone: 'amber',
    body: () => 'A TruePas reviewer will check your document. Nothing changes until they do.',
  },
  verified: {
    label: 'Verified',
    tone: 'green',
    body: (first) => `A reviewer confirmed you are ${first}'s parent or legal guardian.`,
  },
  rejected: {
    label: 'Rejected',
    tone: 'red',
    body: () => 'A reviewer could not accept this document. You can submit another one.',
  },
  information_required: {
    label: 'Additional information required',
    tone: 'amber',
    body: () => 'A reviewer needs more from you. Read their message, then submit again.',
  },
  revoked: {
    label: 'Revoked',
    tone: 'red',
    body: () => 'This verification was withdrawn by TruePas. Contact support, or submit new evidence.',
  },
};

export const GUARDIAN_STATUSES = Object.keys(STATUS_COPY) as GuardianVerificationStatus[];

/** Any answer the app doesn't know is shown as not submitted, never as verified. */
export function guardianStatusOf(view: Partial<GuardianVerification> | null | undefined): GuardianVerificationStatus {
  const status = view?.status;
  return status && status in STATUS_COPY ? status : 'not_submitted';
}

export const guardianStatusLabel = (status: GuardianVerificationStatus) => STATUS_COPY[status].label;
export const guardianStatusTone = (status: GuardianVerificationStatus) => STATUS_COPY[status].tone;
export const guardianStatusBody = (status: GuardianVerificationStatus, first: string) => STATUS_COPY[status].body(first);

const EVIDENCE_LABELS: Record<string, string> = {
  birth_certificate: 'Birth certificate',
  court_guardianship_order: 'Court guardianship order',
  adoption_documents: 'Adoption documents',
  other_official_evidence: 'Other official document',
};

export const evidenceTypeLabel = (type: string | null | undefined) =>
  (type && EVIDENCE_LABELS[type]) || (type ? type.replace(/_/g, ' ') : '—');

/** The kinds of document the server accepts for submission, in its order. */
export function evidenceTypeOptions(view: Partial<GuardianVerification> | null | undefined) {
  return (view?.evidenceTypes ?? []).map((value) => ({ value, label: evidenceTypeLabel(value) }));
}

/** Whether the upload form is shown: the server must say both that the
 *  feature is on and that this parent may submit now. */
export const canSubmitEvidence = (view: Partial<GuardianVerification> | null | undefined) =>
  view?.submissionEnabled === true && view?.canSubmit === true;

/** Decoded size of a base64 file, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export const evidenceTooLarge = (data: string, maxBytes: number) => maxBytes > 0 && base64Bytes(data) > maxBytes;

/** The section exists for children only (under 18). */
export const needsGuardianVerification = (age: number | null | undefined) => typeof age === 'number' && age < 18;

export const GUARDIAN_EVIDENCE_PRIVACY =
  'Your document is stored privately and encrypted. Only TruePas reviewers can open it; it is never shared ' +
  'with venues or kiosks. Verification confirms your authority only: it is not consent, and it shares no ' +
  "documents of your child's.";
