/**
 * What the app does with identity-proofing-service's verify answer. The server
 * is the only judge of a document: an approval is shown as approved, a
 * rejection by its reasonCode. The app used to re-check names and expiry on
 * approved documents and delete the ones its own check disliked — documents
 * the server had already approved (and told customer-account-service about).
 */
import type { IdentityDocument, VerifyDocumentResponse } from '@/types/domain';

/** Rejections shown as a popup: expired, someone else's face, details that
 *  differ (name or date of birth), a name that needs a person to check it. */
export type RejectKind = 'expired' | 'face' | 'profile' | 'review';

export function rejectKind(reasonCode: string | null | undefined): RejectKind | null {
  switch (reasonCode) {
    case 'DOCUMENT_EXPIRED':
      return 'expired';
    case 'DOCUMENT_FACE_MISMATCH':
      return 'face';
    case 'PROFILE_MISMATCH':
      return 'profile';
    case 'NAME_REVIEW_REQUIRED':
      return 'review';
    default:
      return null;
  }
}

/** May the app remove a document its attempt created? Only one the server
 *  does not hold as verified — and not when the server's status is unknown
 *  (a lookup failed): a verified document is never deleted by mistake. */
export function mayDiscard(serverStatus: string | null | undefined): boolean {
  return typeof serverStatus === 'string' && serverStatus !== 'verified';
}

/** On Retry the attempt's document may already be verified: the server
 *  approved it but the answer was lost. Its stored state stands in for the
 *  answer, so the scan is not verified (or deleted) again. */
export function alreadyVerified(document: IdentityDocument | null | undefined): VerifyDocumentResponse | null {
  if (document?.status !== 'verified') return null;
  return {
    outcome: 'approved',
    reasonCode: null,
    document,
    documentId: document.id,
    matchScore: document.matchScore,
    extractedName: document.extractedName ?? null,
    extractedGivenNames: document.extractedGivenNames ?? null,
    extractedSurname: document.extractedSurname ?? null,
    extractedDob: document.extractedDob ?? null,
    nationality: document.nationality ?? null,
    issuingState: document.issuingState ?? null,
    dateOfExpiry: document.expiresAt,
    portraitImageUrl: document.portraitImageUrl ?? null,
  } as VerifyDocumentResponse;
}
