/**
 * Regula Face SDK liveness on the phone (@regulaforensics/face-sdk with
 * @regulaforensics/face-core-basic).
 *
 * Runs Regula's own liveness screen against the Regula service the server
 * named, with the server's tag, and returns only what the server needs to
 * verify it: the transactionId (regulaLiveness.ts). No license file and no
 * credentials are used on the phone: liveness runs on the server's licensed
 * Regula service.
 *
 * The native module is lazy-required, like the Document Reader's
 * (documents/regulaScanner.ts), so the JS bundle still loads where it is
 * missing (Expo Go, web, an old dev client); the check then fails — there is
 * no other liveness to fall back to.
 */
import {
  regulaFailure,
  regulaOutcome,
  type RegulaOutcome,
  type RegulaRunConfig,
} from '@/features/liveness/regulaLiveness';

let faceSdkModule: any = null;
let loadAttempted = false;

function loadFaceSdk(): boolean {
  if (loadAttempted) return faceSdkModule != null;
  loadAttempted = true;
  try {
    // The SDK's JS reaches native code only through NativeModules.RNFaceSDK
    // (its FaceSDK.instance exists either way), and on iOS loading it without
    // the native module throws: check first. Present only in a build made
    // with the dependency (a Metro restart is not enough).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native');
    if (!NativeModules?.RNFaceSDK) {
      console.warn('[RegulaLiveness] Face SDK native module missing — rebuild the dev client');
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    faceSdkModule = require('@regulaforensics/face-sdk');
  } catch {
    // Native module unavailable (Expo Go, web)
  }
  return faceSdkModule != null;
}

/** True when the Regula Face SDK native module is in this build. */
export function isRegulaFaceSdkAvailable(): boolean {
  return loadFaceSdk();
}

let initPromise: Promise<boolean> | null = null;

/** Initialize once (Core Basic needs no license on the phone); a failure retries next time. */
function ensureInitialized(): Promise<boolean> {
  if (!initPromise) {
    const sdk = faceSdkModule.FaceSDK.instance;
    initPromise = (async () => {
      if (await sdk.isInitialized()) return true;
      const [success, error] = await sdk.initialize();
      if (!success) console.warn('[RegulaLiveness] initialize failed', error?.code, error?.message);
      return Boolean(success);
    })().catch((err: unknown) => {
      console.warn('[RegulaLiveness] initialize threw', (err as Error)?.message);
      return false;
    });
    initPromise.then((ok) => {
      if (!ok) initPromise = null;
    });
  }
  return initPromise;
}

/**
 * Run Regula liveness once. Resolves, never rejects: a transaction for the
 * server to verify, a cancellation, or a failure with a message to show.
 */
export async function runRegulaLiveness({ serviceUrl, tag }: RegulaRunConfig): Promise<RegulaOutcome> {
  if (!loadFaceSdk()) return regulaFailure('unavailable');
  if (!(await ensureInitialized())) return regulaFailure('unavailable');
  const { FaceSDK, LivenessConfig, LivenessType, LivenessSkipStep, RecordingProcess } = faceSdkModule;
  const sdk = FaceSDK.instance;
  try {
    sdk.serviceUrl = serviceUrl;
    const response = await sdk.startLiveness({
      config: new LivenessConfig({
        // The server's per-session nonce: it accepts only a transaction carrying it.
        tag,
        // The mode the server accepts by default (REGULA_ALLOWED_LIVENESS_TYPES=0).
        livenessType: LivenessType.ACTIVE,
        // The app has its own instructions and its own result screen, shown
        // only after the server has verified the transaction.
        skipStep: [LivenessSkipStep.ONBOARDING_STEP, LivenessSkipStep.SUCCESS_STEP],
        closeButtonEnabled: true,
        // No device location, and no session video: only liveness is needed.
        locationTrackingEnabled: false,
        recordingProcess: RecordingProcess.NOT_UPLOAD,
      }),
    });
    const outcome = regulaOutcome(response);
    console.log('[RegulaLiveness] outcome', outcome.kind, outcome.kind === 'failed' ? outcome.reason : '');
    return outcome;
  } catch (err) {
    console.warn('[RegulaLiveness] startLiveness threw', (err as Error)?.message);
    return regulaFailure('failed');
  }
}
