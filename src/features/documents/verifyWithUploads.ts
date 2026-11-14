/**
 * Document verification over presigned uploads (BACKEND_UPDATE_2026-10 §6.2/§6.4).
 *
 *   1. POST /documents/{id}/upload-urls      { parts: front[, back] }
 *   2. PUT each image to its uploadUrl
 *   3. POST /documents/{id}/verification-sessions { frontObjectKey, backObjectKey, livenessSessionId?, requestId }
 *   4. POST /document-verification-sessions/{sessionId}/verify { sessionToken? }  — no base64
 *
 * Shared by the account-holder flow (document/processing) and the family flow
 * (family/add/processing). The caller creates the document first (without a
 * number — the server reads it from the scan).
 */
import { AxiosError } from 'axios';
import { EncodingType, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { api } from '@/api';
import { errorFields, imageLabel, startDocLog, type DocLog } from '@/features/documents/verifyLog';
import type { DocumentImagePart, DocumentReasonCode, VerifyDocumentResponse } from '@/types/domain';

export type VerifyUploadStep = 'uploading' | 'creating_session' | 'verifying';

export interface VerifyDocumentWithUploadsInput {
  documentId: string;
  /** Front image as a local file URI (file://…). Give this or `frontBase64`. */
  frontUri?: string;
  /** Front image as raw JPEG base64 (no data: prefix) — written to a temp file first. */
  frontBase64?: string;
  /** Optional back image (file URI or base64). */
  backUri?: string;
  backBase64?: string;
  /** Family member without an enrolled face: that member's passed liveness
   *  session (§6.4). Each liveness session can be used once. */
  livenessSessionId?: string;
  /** The liveness session's token — sent on /verify with livenessSessionId. */
  sessionToken?: string;
  /** Idempotency id for the verification session (a fresh one per call by default). */
  requestId?: string;
  /** Progress callback for the step UI. */
  onStep?: (step: VerifyUploadStep) => void;
  /** /verify timeout — server-side Regula can take a while. Default 90 s. */
  timeoutMs?: number;
  /** The caller's attempt log, so these steps share its id (verifyLog.ts). */
  log?: DocLog;
}

const CONTENT_TYPE = 'image/jpeg';

/** expo-file-system has no web implementation — use data URIs there. */
const NO_FS = Platform.OS === 'web';

function stripDataUri(data: string): string {
  return data.startsWith('data:') && data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
}

/** A local URI for an image given as a file URI or base64. Temp files are
 *  collected in `temps` so the caller can delete them afterwards. */
function toUploadUri(uri: string | undefined, base64: string | undefined, name: string, temps: File[]): string | null {
  if (uri) return uri;
  if (!base64) return null;
  const raw = stripDataUri(base64);
  if (NO_FS) return `data:${CONTENT_TYPE};base64,${raw}`;
  const file = new File(Paths.cache, `${name}-${Date.now()}.jpg`);
  if (!file.exists) file.create({ intermediates: true });
  file.write(raw, { encoding: EncodingType.Base64 });
  temps.push(file);
  return file.uri;
}

/**
 * Whether a failed presigned upload should fall back to inline base64.
 * - Asking for the upload URLs: only when the server can't do it (5xx, or
 *   the route missing) — a network error there means the device is offline.
 * - The PUT itself: any failure. The storage host differs from the API host,
 *   so it can be unreachable or reject the signature while the API is fine.
 */
function presignUnavailable(err: unknown, phase: 'urls' | 'put'): boolean {
  if (phase === 'put') return true;
  const status = err instanceof AxiosError ? err.response?.status : undefined;
  return status != null && (status >= 500 || status === 404 || status === 405);
}

/**
 * Upload the captured images and verify the document. Resolves with the
 * synchronous verify result (approved | rejected — see isApproved /
 * rejectionAction); throws on network/API errors so the caller can offer Retry.
 *
 * If the presigned upload isn't available (see presignUnavailable) and the
 * images were given as base64, it verifies with the images inline instead —
 * the pre-Oct-2026 path, which the backend still accepts.
 */
export async function verifyDocumentWithUploads(input: VerifyDocumentWithUploadsInput): Promise<VerifyDocumentResponse> {
  const { documentId, livenessSessionId, sessionToken, onStep } = input;
  const log = input.log ?? startDocLog({ document: documentId });
  log.info('images', {
    front: imageLabel(input.frontBase64) ?? (input.frontUri ? 'file' : 'none'),
    back: imageLabel(input.backBase64) ?? (input.backUri ? 'file' : undefined),
  });
  const temps: File[] = [];
  let frontObjectKey: string | undefined;
  let backObjectKey: string | undefined;
  let inline = false;
  let phase: 'urls' | 'put' = 'urls';
  try {
    const frontUri = toUploadUri(input.frontUri, input.frontBase64, `doc-${documentId}-front`, temps);
    if (!frontUri) throw new Error('No document image captured. Please scan again.');
    const backUri = toUploadUri(input.backUri, input.backBase64, `doc-${documentId}-back`, temps);

    onStep?.('uploading');
    const files: [DocumentImagePart, string][] = [['front', frontUri]];
    if (backUri) files.push(['back', backUri]);
    const { uploads } = await log.step(
      'upload-urls',
      () => api.getDocumentUploadUrls(documentId, files.map(([part]) => part), CONTENT_TYPE),
      (r) => ({ parts: Object.keys(r.uploads ?? {}).join('+') }),
    );
    phase = 'put';
    await Promise.all(
      files.map(([part, uri]) => {
        const target = uploads[part];
        if (!target) throw new Error("Couldn't start the upload. Please try again.");
        return log.step(`put ${part}`, () => api.uploadFileToUrl(target.uploadUrl, uri, CONTENT_TYPE));
      }),
    );
    frontObjectKey = uploads.front!.objectKey;
    backObjectKey = backUri ? uploads.back?.objectKey : undefined;
  } catch (err) {
    if (!input.frontBase64 || !presignUnavailable(err, phase)) throw err;
    log.warn('presigned upload unavailable, sending images inline', { phase, ...errorFields(err) });
    inline = true;
  } finally {
    for (const f of temps) {
      try {
        if (f.exists) f.delete();
      } catch {
        // Temp files live in the cache dir — the OS clears them eventually.
      }
    }
  }

  onStep?.('creating_session');
  const session = await log.step(
    'session',
    () =>
      api.createVerificationSession(documentId, {
        ...(frontObjectKey ? { frontObjectKey } : {}),
        ...(backObjectKey ? { backObjectKey } : {}),
        ...(livenessSessionId ? { livenessSessionId } : {}),
        requestId: input.requestId ?? `req-${documentId}-${Date.now()}`,
      }),
    (r) => ({
      session: r.id,
      mode: inline ? 'inline' : 'presigned',
      liveness: livenessSessionId ? 'yes' : undefined,
    }),
  );

  onStep?.('verifying');
  const images =
    inline && input.frontBase64
      ? {
          frontImageBase64: stripDataUri(input.frontBase64),
          ...(input.backBase64 ? { backImageBase64: stripDataUri(input.backBase64) } : {}),
        }
      : {};
  return log.step(
    'verify',
    () =>
      api.startVerificationWithImages(session.id, { ...images, ...(sessionToken ? { sessionToken } : {}) }, {
        timeout: input.timeoutMs ?? 90_000,
      }),
    (r) => ({
      outcome: r.outcome,
      reason: r.reasonCode,
      match: r.matchScore,
      portrait: r.portraitImageUrl ? 'yes' : 'no',
      expiry: r.dateOfExpiry ? 'yes' : 'no',
      session: session.id,
      decision: (r as { decisionId?: string }).decisionId,
    }),
  );
}

/* ───────────────────────── outcomes (§6.3) ───────────────────────── */

/** Results are approved or rejected only — anything but 'approved' is a rejection. */
export function isApproved(result: { outcome?: string | null }): boolean {
  return result.outcome === 'approved';
}

/** Shown when a rejection arrives without a reasonMessage. */
export const DEFAULT_REJECTION_MESSAGE = "We couldn't verify this document. Retake the photos in good light.";

export type RejectionAction = 'retake' | 'anotherDocument' | 'changeType' | 'editProfile' | 'setupFace';

const ACTION_BY_CODE: Record<DocumentReasonCode, RejectionAction> = {
  DOCUMENT_PROCESSING_ERROR: 'retake',
  DOCUMENT_UNREADABLE: 'retake',
  DOCUMENT_CHECKS_INCONCLUSIVE: 'retake',
  AUTHENTICITY_FAILED: 'anotherDocument',
  NO_PORTRAIT_IN_DOCUMENT: 'anotherDocument',
  DOCUMENT_FACE_MISMATCH: 'anotherDocument',
  DOCUMENT_TYPE_MISMATCH: 'changeType',
  PROFILE_MISMATCH: 'editProfile',
  // A name the server could not confirm automatically (accents, initials,
  // word order): nothing to retake, and the document freezes no one.
  NAME_REVIEW_REQUIRED: 'anotherDocument',
  DOCUMENT_EXPIRED: 'anotherDocument',
  FACE_NOT_ENROLLED: 'setupFace',
};

/** The action button for a rejection — use reasonCode only for this, and
 *  reasonMessage as the text. Unknown codes fall back to Retake. */
export function rejectionAction(reasonCode?: string | null): RejectionAction {
  return (reasonCode && ACTION_BY_CODE[reasonCode as DocumentReasonCode]) || 'retake';
}

export const REJECTION_ACTION_LABEL: Record<RejectionAction, string> = {
  retake: 'Retake photos',
  anotherDocument: 'Use another document',
  changeType: 'Change type',
  editProfile: 'Edit profile',
  setupFace: 'Set up face',
};
