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
  createRegulaRunner,
  type FaceSdkModule,
  type RegulaOutcome,
  type RegulaRunConfig,
  type RunAppearance,
} from '@/features/liveness/regulaLiveness';

let faceSdkModule: FaceSdkModule | null = null;
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

/**
 * Run Regula liveness once (regulaLiveness.createRegulaRunner), in the
 * TruePas colors and words when given an appearance (regulaAppearance). Resolves,
 * never rejects: a transaction for the server to verify, a cancellation, or
 * a failure with a message to show — a timeout or a missing SDK included.
 */
export const runRegulaLiveness: (config: RegulaRunConfig, appearance?: RunAppearance) => Promise<RegulaOutcome> = createRegulaRunner(
  () => (loadFaceSdk() ? faceSdkModule : null),
  {},
  (...args) => console.log(...args),
);
