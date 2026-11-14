/**
 * Regula liveness on the phone: which liveness check the server runs, how
 * the Regula Face SDK is driven, and what its result may be turned into.
 *
 * Regula decides only whether the person is live, and the server decides it,
 * reading the transaction from Regula itself: the phone sends back nothing but
 * the SDK's transactionId. The SDK's own `liveness` status (PASSED / UNKNOWN)
 * and its image are never used — the face image is the app's own capture,
 * taken before Regula runs.
 *
 * No imports (the SDK module is passed in), so it runs under `node --test`
 * (__tests__/regulaLiveness.test.mjs).
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

/**
 * Whether a refused Regula session request leads to the ML Kit challenge.
 * Only when the server runs it (serverUsesChallenge) *and* this build turned
 * the fallback on (EXPO_PUBLIC_LIVENESS_CHALLENGE_FALLBACK=true). Otherwise
 * the check fails where the person can see it: the challenge never stands in
 * for Regula unannounced.
 */
export function fallsBackToChallenge(
  error: { status: number | null; serverCode?: string },
  challengeFallback: boolean,
): boolean {
  return challengeFallback && serverUsesChallenge(error);
}

/**
 * Whether the server's answer to `complete` passed this session. The request
 * succeeding is not enough: the answer must say passed, for this session.
 */
export function regulaVerdictPassed(
  verdict: { success?: unknown; status?: unknown; session_id?: unknown } | null | undefined,
  sessionId: string,
): boolean {
  return verdict?.success === true && verdict.status === 'passed' && verdict.session_id === sessionId;
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
  error?: {
    code?: number | null;
    message?: string | null;
    /** Regula's service's own reason (LivenessBackendErrorCode). */
    underlyingError?: { code?: number | null } | null;
  } | null;
}

/** LivenessBackendErrorCode values the app words itself (Face SDK 8.4). */
export const LIVENESS_BACKEND_ERROR = {
  /** Regula judged the face too young for liveness; it documents no age. */
  SMALL_AGE: 235,
} as const;

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
  notOnServer: "The liveness check isn't switched on for this server yet. Please try again later.",
  notVerified: "We couldn't verify the liveness check. Please try again.",
  smallAge:
    "The liveness check couldn't verify this young face. Keep the whole face in the oval, in good light, and try again. If it keeps happening, contact TruePas support.",
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
  if (response?.error?.underlyingError?.code === LIVENESS_BACKEND_ERROR.SMALL_AGE) return regulaFailure('smallAge');
  return regulaFailure((code != null && REASONS[code]) || 'failed');
}

/** How a failed check ended, for the result screen's heading. */
export type LivenessFailure = 'cancelled' | 'timeout' | 'not_verified' | 'unavailable' | 'error';

/** A Regula run that produced no transaction, as a failure kind. */
export function outcomeFailure(outcome: Exclude<RegulaOutcome, { kind: 'transaction' }>): LivenessFailure {
  if (outcome.kind === 'cancelled') return 'cancelled';
  if (outcome.reason === 'timeout') return 'timeout';
  if (outcome.reason === 'smallAge') return 'not_verified';
  if (outcome.reason === 'unavailable' || outcome.reason === 'notConfigured' || outcome.reason === 'notOnServer') return 'unavailable';
  return 'error';
}

/**
 * A server refusal, as a failure kind: 422 is Regula's verdict read by the
 * server (not live, wrong tag, not found), 409 a reused or already finished
 * check; 503 means liveness can't run right now. Anything else is an error.
 */
export function serverFailure(error: { status: number | null; serverCode?: string }): LivenessFailure {
  if (error.status === 422 || (error.status === 409 && error.serverCode === 'REGULA_TRANSACTION_REUSED')) return 'not_verified';
  if (error.status === 503) return 'unavailable';
  return 'error';
}

/** The parts of @regulaforensics/face-sdk the runner uses (a fake in tests). */
export interface FaceSdkModule {
  FaceSDK: {
    instance: {
      serviceUrl?: string;
      isInitialized(): Promise<boolean>;
      initialize(): Promise<[boolean, { code?: number; message?: string } | null]>;
      startLiveness(options: { config: unknown }): Promise<RegulaSdkResponse | null>;
      stopLiveness(): void;
      /** Its setters push each value to the native SDK (regulaAppearance). */
      customization?: { colors: object };
      localizationDictionary?: Record<string, string>;
    };
  };
  LivenessConfig: new (options: Record<string, unknown>) => unknown;
  LivenessType: { ACTIVE: unknown };
  LivenessSkipStep: { ONBOARDING_STEP: unknown; SUCCESS_STEP: unknown };
  RecordingProcess: { NOT_UPLOAD: unknown };
}

/** How long initialization may take (as for the Document Reader). */
export const REGULA_INIT_TIMEOUT_MS = 20_000;
/**
 * How long Regula's screen may stay open. Regula times out its own steps
 * (PROCESSING_TIMEOUT); this covers a run that never answers at all. It is
 * well inside the server session's five minutes.
 */
export const REGULA_RUN_TIMEOUT_MS = 180_000;

const TIMED_OUT = Symbol('timed out');

function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** What a run applies to Regula's screens first (regulaAppearance.regulaAppearance). */
export interface RunAppearance {
  colors: Record<string, number | undefined>;
  strings: Record<string, string>;
  cameraSwitch: boolean;
}

/**
 * Colors and text for Regula's screens, through the SDK's own setters. A
 * failure here leaves Regula's defaults: it never stops the check.
 */
function applyAppearance(
  sdk: FaceSdkModule['FaceSDK']['instance'],
  { colors, strings }: RunAppearance,
  log: (...args: unknown[]) => void,
): void {
  try {
    const target = sdk.customization?.colors as Record<string, number> | undefined;
    if (target) {
      for (const [name, value] of Object.entries(colors)) {
        if (typeof value === 'number') target[name] = value;
      }
    }
    sdk.localizationDictionary = strings;
  } catch (err) {
    log('[RegulaLiveness] appearance not applied', (err as Error)?.message);
  }
}

/**
 * A Regula liveness runner over the SDK `load` returns (null when the native
 * module is not in this build). The SDK is initialized once (Core Basic needs
 * no license on the phone); a failed initialization is tried again on the
 * next run. A run resolves, never rejects: a transaction for the server to
 * verify, a cancellation, or a failure with a message to show.
 */
export function createRegulaRunner(
  load: () => FaceSdkModule | null,
  timing: { initTimeoutMs?: number; runTimeoutMs?: number } = {},
  log: (...args: unknown[]) => void = () => {},
): (config: RegulaRunConfig, appearance?: RunAppearance) => Promise<RegulaOutcome> {
  const initTimeoutMs = timing.initTimeoutMs ?? REGULA_INIT_TIMEOUT_MS;
  const runTimeoutMs = timing.runTimeoutMs ?? REGULA_RUN_TIMEOUT_MS;
  let initPromise: Promise<boolean> | null = null;

  function ensureInitialized(sdk: FaceSdkModule['FaceSDK']['instance']): Promise<boolean> {
    if (!initPromise) {
      const attempt = (async () => {
        if (await sdk.isInitialized()) return true;
        const [success, error] = await sdk.initialize();
        if (!success) log('[RegulaLiveness] initialize failed', error?.code, error?.message);
        return Boolean(success);
      })().catch((err: unknown) => {
        log('[RegulaLiveness] initialize threw', (err as Error)?.message);
        return false;
      });
      initPromise = within(attempt, initTimeoutMs).then((result) => {
        if (result === TIMED_OUT) log('[RegulaLiveness] initialize timed out');
        const ok = result === true;
        if (!ok) initPromise = null;
        return ok;
      });
    }
    return initPromise;
  }

  return async function runRegulaLiveness({ serviceUrl, tag }: RegulaRunConfig, appearance?: RunAppearance): Promise<RegulaOutcome> {
    const faceSdk = load();
    if (!faceSdk) return regulaFailure('unavailable');
    const sdk = faceSdk.FaceSDK.instance;
    if (!(await ensureInitialized(sdk))) return regulaFailure('unavailable');
    const { LivenessConfig, LivenessType, LivenessSkipStep, RecordingProcess } = faceSdk;
    if (appearance) applyAppearance(sdk, appearance, log);
    try {
      sdk.serviceUrl = serviceUrl;
      const response = await within(
        sdk.startLiveness({
          config: new LivenessConfig({
            // The server's per-session nonce: it accepts only a transaction carrying it.
            tag,
            // The mode the server accepts by default (REGULA_ALLOWED_LIVENESS_TYPES=0).
            livenessType: LivenessType.ACTIVE,
            // The app has its own instructions and its own result screen, shown
            // only after the server has verified the transaction.
            skipStep: [LivenessSkipStep.ONBOARDING_STEP, LivenessSkipStep.SUCCESS_STEP],
            closeButtonEnabled: true,
            // The "Powered by Regula" logo at the bottom of Regula's screens:
            // hidden through the Face SDK's own documented option (default true).
            copyright: false,
            // A guardian filming a child may turn to the rear camera, as on the TruePas screen.
            cameraSwitchEnabled: appearance?.cameraSwitch === true,
            // No device location, and no session video: only liveness is needed.
            locationTrackingEnabled: false,
            recordingProcess: RecordingProcess.NOT_UPLOAD,
          }),
        }),
        runTimeoutMs,
      );
      if (response === TIMED_OUT) {
        log('[RegulaLiveness] no answer in time; closing its screen');
        try {
          sdk.stopLiveness();
        } catch {
          // Already closed.
        }
        return regulaFailure('timeout');
      }
      const outcome = regulaOutcome(response);
      log('[RegulaLiveness] outcome', outcome.kind, outcome.kind === 'failed' ? outcome.reason : '');
      return outcome;
    } catch (err) {
      log('[RegulaLiveness] startLiveness threw', (err as Error)?.message);
      return regulaFailure('failed');
    }
  };
}
