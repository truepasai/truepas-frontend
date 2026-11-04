/**
 * Regula liveness on the phone: which liveness check the server runs, and
 * what a Regula Face SDK result may be turned into.
 *
 * Regula decides only whether the person is live, and the server decides it,
 * reading the transaction from Regula itself: the phone sends back nothing but
 * the SDK's transactionId. The SDK's own `liveness` status (PASSED / UNKNOWN)
 * and its image are never used — the face image is the app's own capture,
 * taken before Regula runs.
 *
 * No imports, so it runs under `node --test` (__tests__/regulaLiveness.test.mjs).
 */

/** The liveness check this server runs: Regula, or the older ML Kit challenge. */
export type LivenessMethod = 'regula' | 'challenge';

/** Codes the server answers a Regula session request with when it does not run Regula. */
export const REGULA_DISABLED_CODE = 'REGULA_LIVENESS_DISABLED';

/**
 * Whether a refused Regula session request means "this server runs the ML
 * Kit challenge" — never a reason to skip liveness. Only two answers say so:
 * the liveness service's 503 REGULA_LIVENESS_DISABLED (its LIVENESS_PROVIDER
 * is mlkit_v2), and a 404 without a code from a BFF older than the Regula
 * routes. Anything else — Regula unavailable, rate limits, network errors,
 * a refused family member — is a failure, so nothing falls back to ML Kit
 * while the server runs Regula (it then refuses ML Kit sessions anyway).
 */
export function serverUsesChallenge(error: { status: number | null; serverCode?: string }): boolean {
  if (error.serverCode === REGULA_DISABLED_CODE) return error.status === 503;
  return error.status === 404 && error.serverCode === undefined;
}

/** What the SDK needs from the server's session: Regula's URL and this session's tag. */
export interface RegulaRunConfig {
  serviceUrl: string;
  tag: string;
}

/** Regula's tag alphabet and length (letters, digits, '-' and '_', at most 127). */
const TAG_PATTERN = /^[A-Za-z0-9_-]{1,127}$/;

/** The host of an https URL without credentials, lower-cased; else null. */
function httpsHost(url: string): string | null {
  const match = /^https:\/\/([^\s/?#@]+)(?:[/?#]|$)/i.exec(url);
  return match ? match[1].replace(/:\d+$/, '').toLowerCase() : null;
}

/**
 * The SDK configuration for a server session, or null when the server sent
 * no usable URL or tag. Without the server's URL the SDK would use its own
 * default service, whose transactions this server can never read — so the
 * check is refused rather than run there, as it is on Regula's own public
 * services (the server refuses to hand those out too).
 */
export function regulaRunConfig(session: { service_url?: unknown; tag?: unknown }): RegulaRunConfig | null {
  const { service_url: serviceUrl, tag } = session;
  if (typeof serviceUrl !== 'string') return null;
  const host = httpsHost(serviceUrl);
  if (!host || host === 'regulaforensics.com' || host.endsWith('.regulaforensics.com')) return null;
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) return null;
  return { serviceUrl, tag };
}

/** The SDK's LivenessErrorCode values (Face SDK 8.4, www/react-native/liveness/liveness_exception.js). */
export const LIVENESS_ERROR = {
  NOT_INITIALIZED: 0,
  NO_LICENSE: 1,
  API_CALL_FAILED: 2,
  SESSION_START_FAILED: 3,
  CANCELLED: 4,
  PROCESSING_TIMEOUT: 5,
  PROCESSING_FAILED: 6,
  PROCESSING_FRAME_FAILED: 7,
  APPLICATION_INACTIVE: 8,
  BAD_FACE_QUALITY: 9,
  CAMERA_NOT_AVAILABLE: 10,
  CAMERA_NO_PERMISSION: 11,
  BAD_FRAME_SIZE: 12,
  CONTEXT_IS_NULL: 13,
  IN_PROGRESS_ALREADY: 14,
  ZOOM_NOT_SUPPORTED: 15,
} as const;

/** The parts of the SDK's LivenessResponse this app reads. */
export interface RegulaSdkResponse {
  transactionId?: string | null;
  error?: { code?: number | null; message?: string | null } | null;
}

/** What one Regula run on the phone produced. */
export type RegulaOutcome =
  /** A transaction for the server to verify: whether it passed is the server's to say. */
  | { kind: 'transaction'; transactionId: string }
  /** The person closed Regula's screen: nothing is sent. */
  | { kind: 'cancelled' }
  /** No transaction to verify (no camera, no connection, SDK missing, ...). */
  | { kind: 'failed'; message: string; reason: string };

export const REGULA_MESSAGES = {
  cancelled: 'Liveness check cancelled. Try again when you are ready.',
  unavailable: "The liveness check isn't available on this device. Please update the app.",
  network: "The liveness check couldn't reach the server. Check your connection and try again.",
  camera: 'The liveness check needs the camera. Allow camera access and try again.',
  timeout: 'The liveness check took too long. Please try again.',
  interrupted: 'The liveness check was interrupted. Keep the app open and try again.',
  failed: "We couldn't complete the liveness check. Please try again.",
  notConfigured: "The liveness check isn't set up correctly. Please try again later.",
} as const;

const REASONS: Record<number, keyof typeof REGULA_MESSAGES> = {
  [LIVENESS_ERROR.NOT_INITIALIZED]: 'unavailable',
  [LIVENESS_ERROR.NO_LICENSE]: 'unavailable',
  [LIVENESS_ERROR.CONTEXT_IS_NULL]: 'unavailable',
  [LIVENESS_ERROR.API_CALL_FAILED]: 'network',
  [LIVENESS_ERROR.SESSION_START_FAILED]: 'network',
  [LIVENESS_ERROR.CAMERA_NOT_AVAILABLE]: 'camera',
  [LIVENESS_ERROR.CAMERA_NO_PERMISSION]: 'camera',
  [LIVENESS_ERROR.PROCESSING_TIMEOUT]: 'timeout',
  [LIVENESS_ERROR.APPLICATION_INACTIVE]: 'interrupted',
};

export function regulaFailure(reason: keyof typeof REGULA_MESSAGES): RegulaOutcome {
  return { kind: 'failed', reason, message: REGULA_MESSAGES[reason] };
}

/**
 * One SDK result as the app may act on it. A transactionId always goes to
 * the server, even when the SDK itself reports a failure: the server reads
 * the verdict from Regula and records the refusal. Only a cancellation (the
 * person's own choice) or the absence of any transaction ends here.
 */
export function regulaOutcome(response: RegulaSdkResponse | null | undefined): RegulaOutcome {
  const code = typeof response?.error?.code === 'number' ? response.error.code : null;
  if (code === LIVENESS_ERROR.CANCELLED) return { kind: 'cancelled' };
  const transactionId = response?.transactionId;
  if (typeof transactionId === 'string' && transactionId.trim()) {
    return { kind: 'transaction', transactionId: transactionId.trim() };
  }
  return regulaFailure((code != null && REASONS[code]) || 'failed');
}
