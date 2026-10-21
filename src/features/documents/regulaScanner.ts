/**
 * Regula Document Reader integration — mirrors facepe-user-frontend verify.tsx.
 *
 * The Regula SDK provides a NATIVE full-screen scanner UI that handles:
 *   - real-time document edge detection
 *   - auto-capture when aligned + in focus
 *   - cropping + perspective correction to the document bounds
 *
 * The app never does manual crop math. The backend gets the raw, uncropped
 * camera frame (its own Regula re-reads the document from it); the SDK's
 * cropped, perspective-corrected image is used for display only.
 *
 * Native modules are lazy-required inside try/catch so the JS bundle still
 * runs in Expo Go (where they're unavailable) — callers must check
 * isRegulaAvailable() and fall back to the manual expo-camera flow.
 */
import { imageLabel } from '@/features/documents/verifyLog';

// ── Lazy native module holders ─────────────────────────────────────────────
let DocumentReader: any = null;
let DocReaderConfig: any = null;
let ScannerConfig: any = null;
let DocReaderAction: any = null;
let DocumentReaderCompletion: any = null;
let ProcessParams: any = null;
let RNRegulaDocumentReader: any = null;
let Enum: any = null;
let ScenarioIdentifier: any = null;
let Functionality: any = null;
let DocReaderFrame: any = null;

let loadAttempted = false;

function loadNativeModules(): boolean {
  if (loadAttempted) return RNRegulaDocumentReader != null;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const docModule = require('@regulaforensics/react-native-document-reader-api');
    // RNRegulaDocumentReader is NativeModules.RNRegulaDocumentReader — it is
    // null unless the app was BUILT with the native dependency (a Metro-only
    // restart is not enough). All internal SDK calls go through
    // RNRegulaDocumentReader.exec(...), so it must be non-null.
    RNRegulaDocumentReader = docModule.RNRegulaDocumentReader;
    if (!RNRegulaDocumentReader) {
      console.warn('[Regula] JS package loaded but native module missing — rebuild the dev client (npx expo run:android)');
      return false;
    }
    DocumentReader = docModule.default;
    DocReaderConfig = docModule.DocReaderConfig;
    ScannerConfig = docModule.ScannerConfig;
    DocReaderAction = docModule.DocReaderAction;
    DocumentReaderCompletion = docModule.DocumentReaderCompletion;
    ProcessParams = docModule.ProcessParams;
    Enum = docModule.Enum;
    ScenarioIdentifier = docModule.ScenarioIdentifier;
    Functionality = docModule.Functionality;
    DocReaderFrame = docModule.DocReaderFrame;
  } catch {
    // Native modules unavailable (Expo Go) — caller must fall back
  }
  return RNRegulaDocumentReader != null;
}

/** True when the Regula native modules are present (dev build / standalone). */
export function isRegulaAvailable(): boolean {
  return loadNativeModules();
}

// ── State ──────────────────────────────────────────────────────────────────
let initialized = false;
/** The caller-facing init (native init raced against INIT_TIMEOUT_MS). */
let initPromise: Promise<void> | null = null;
/** The native initializeReader call itself — may outlive a timed-out caller. */
let nativeInit: Promise<void> | null = null;
let initError: string | null = null;

/** Give up waiting on the native init after this long; a later call retries. */
const INIT_TIMEOUT_MS = 20_000;

export class RegulaInitTimeout extends Error {
  constructor() {
    super('The document scanner took too long to start');
    this.name = 'RegulaInitTimeout';
  }
}

/** Resolve the license base64 from the embedded constant.
 *  (The license is a binary blob embedded as base64 in regulaLicense.ts —
 *  requiring the .license file as a Metro asset is unreliable with custom
 *  resolvers, so we embed it instead.) */
async function loadLicense(): Promise<string> {
  const { REGULA_LICENSE_BASE64 } = require('./regulaLicense') as { REGULA_LICENSE_BASE64: string };
  if (!REGULA_LICENSE_BASE64) {
    throw new Error('regula.license is empty — generate a license for com.truepas.truepasapp and regenerate regulaLicense.ts');
  }
  return REGULA_LICENSE_BASE64;
}

/** Start (or join) the native initializeReader call. Cleared when it fails,
 *  so the next attempt starts a fresh one. */
function startNativeInit(): Promise<void> {
  if (nativeInit) return nativeInit;
  nativeInit = (async () => {
    const licenseBase64 = await loadLicense();
    const config = new DocReaderConfig();
    config.license = licenseBase64;
    config.delayedNNLoad = true;

    await new Promise<void>((resolve, reject) => {
      DocumentReader.initializeReader(
        config,
        () => {
          // Request the raw uncropped camera image for backend processing
          if (ProcessParams) {
            const pp = new ProcessParams();
            pp.returnUncroppedImage = true;
            DocumentReader.setProcessParams(pp, () => {}, () => {});
          }
          initialized = true;
          initError = null;
          console.log('[Regula] Document Reader initialized');
          resolve();
        },
        (err: string) => {
          reject(new Error(`Regula init failed: ${err}`));
        },
      );
    });
  })();
  nativeInit.catch(() => {
    nativeInit = null;
  });
  return nativeInit;
}

/**
 * Initialize the Document Reader with the bundled license.
 * Concurrent callers share one promise. Rejects with RegulaInitTimeout after
 * 20 s; on timeout or failure the cached promise is cleared so a later call
 * (Retry, or the next visit) tries again — joining a native init that is
 * still running instead of starting a second one.
 */
export function initializeRegula(): Promise<void> {
  if (!loadNativeModules()) {
    return Promise.reject(new Error('Regula native modules not available'));
  }
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RegulaInitTimeout()), INIT_TIMEOUT_MS);
    startNativeInit().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
  initPromise = attempt;
  attempt.catch((e: any) => {
    initError = e?.message ?? 'Regula init exception';
    console.error('[Regula]', initError);
    if (initPromise === attempt) initPromise = null;
  });
  return attempt;
}

/** Last initialization error, if any. */
export function getRegulaInitError(): string | null {
  return initError;
}

// ── Scanning ───────────────────────────────────────────────────────────────

/** Extract a graphic field image from scan results as base64 (or null). */
function extractImage(results: any, fieldType: number): Promise<string | null> {
  return new Promise((resolve) => {
    results.graphicFieldImageByType(
      fieldType,
      (b64: string) => resolve(b64 || null),
      () => resolve(null),
    );
  });
}

/** eRPRM_ResultType.RPRM_RESULT_TYPE_RAW_UNCROPPED_IMAGE. This used to be 3,
 *  which is MRZ_OCR_EXTENDED (no image), so the raw frame never came back
 *  and the backend always got the cropped document image instead. */
const RAW_UNCROPPED_IMAGE = 16;
/** Above this (base64 chars, ~7.5 MB of JPEG) send the cropped image instead —
 *  the backend caps each base64 field at ~14 MB. */
const MAX_RAW_BASE64 = 10_000_000;

/** Extract the raw uncropped camera frame (needs processParams.returnUncroppedImage). */
function extractRawFrame(results: any): Promise<string | null> {
  const source = Enum?.eRPRM_ResultType?.RPRM_RESULT_TYPE_RAW_UNCROPPED_IMAGE ?? RAW_UNCROPPED_IMAGE;
  return new Promise((resolve) => {
    results.graphicFieldImageByTypeSource(
      207, // GF_DOCUMENT_IMAGE
      source,
      (b64: string) => resolve(b64 || null),
      () => resolve(null),
    );
  });
}

export class RegulaScanCancelled extends Error {
  constructor() {
    super('Scan cancelled by user');
    this.name = 'RegulaScanCancelled';
  }
}

export interface RegulaScanResult {
  /** Raw camera frame (source=3) — sent to the backend, whose server-side
   *  Regula re-processes it for OCR/portrait/authenticity (Facepe pattern). */
  imageBase64: string;
  /** Regula's own cropped + perspective-corrected document image (207,
   *  default processed source) — used for local preview/display so the
   *  UI shows the document only, not the whole camera frame. */
  previewBase64: string;
}

/** Seconds before the manual capture button shows on a full-page scan, so
 *  auto-capture gets a chance first. */
const FULL_PAGE_CAPTURE_BUTTON_DELAY_S = 4;

/**
 * Camera frame for this scan. Functionality is global in the SDK, so every
 * scan sets it: a card-shaped frame (Regula's default, "id1") for ID cards
 * and passports, the whole camera view for full-page paper documents (A4
 * birth certificates), which don't fit the card frame. Full page also shows a
 * capture button in case edge detection can't lock onto the sheet.
 * Fire-and-forget: Android's setFunctionality never calls back (awaiting it
 * left the scanner unopened, spinning), and native module calls run in
 * order, so it's applied before scan(). A failure leaves the previous frame.
 */
function applyFrame(fullPage: boolean): void {
  if (!Functionality || !DocumentReader?.setFunctionality) return;
  const f = new Functionality();
  f.cameraFrame = fullPage ? (DocReaderFrame?.MAX ?? 'max') : (DocReaderFrame?.SCENARIO_DEFAULT ?? 'id1');
  f.showCaptureButton = fullPage;
  if (fullPage) f.showCaptureButtonDelayFromStart = FULL_PAGE_CAPTURE_BUTTON_DELAY_S;
  try {
    DocumentReader.setFunctionality(
      f,
      () => {},
      (e: unknown) => console.warn('[DocScan] setFunctionality failed', e),
    );
  } catch (e) {
    console.warn('[DocScan] setFunctionality failed', e);
  }
}

export interface ScanOptions {
  /** A full-page paper document (A4 birth certificate): whole-view frame,
   *  edge detection without MRZ (Locate), manual capture button. */
  fullPage?: boolean;
}

/**
 * Open the native Regula scanner and resolve with the document image.
 * Rejects with RegulaScanCancelled if the user cancels.
 *
 * The app ONLY captures the document image — all OCR, portrait extraction,
 * authenticity checks, and face matching are done by the backend (same
 * architecture as Facepe, where the backend runs Regula server-side).
 */
export function scanDocument({ fullPage = false }: ScanOptions = {}): Promise<RegulaScanResult> {
  if (!loadNativeModules() || !initialized) {
    return Promise.reject(new Error('Regula scanner not initialized'));
  }
  applyFrame(fullPage);

  return new Promise<RegulaScanResult>((resolve, reject) => {
    let settled = false;

    // Results arrive via NativeEventEmitter 'completion' (not the scan callback)
    const eventManager = new (require('react-native').NativeEventEmitter)(RNRegulaDocumentReader);
    const subscription = eventManager.addListener('completion', async (event: any) => {
      if (settled) return;
      try {
        const rawMsg = event?.msg || event?.message || event;
        const parsed = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
        const completion = DocumentReaderCompletion.fromJson(parsed);

        const action = completion?.action;
        const COMPLETE = Enum?.DocReaderAction?.COMPLETE ?? 0;
        const CANCEL = Enum?.DocReaderAction?.CANCEL ?? 3;
        const ERROR = Enum?.DocReaderAction?.ERROR ?? 4;
        const TIMEOUT = Enum?.DocReaderAction?.TIMEOUT ?? 6;
        // The user closed the scanner, or it failed: settle so the caller's
        // busy state resets (otherwise the button keeps spinning).
        if (action === CANCEL || action === ERROR) {
          settled = true;
          subscription.remove();
          if (action === CANCEL) {
            reject(new RegulaScanCancelled());
          } else {
            const msg = completion?.error?.message;
            reject(new Error(typeof msg === 'string' && msg ? msg : 'The scanner stopped. Please try again.'));
          }
          return;
        }
        if (action !== COMPLETE && action !== TIMEOUT) return; // intermediate progress
        if (!completion?.results) return;

        settled = true;
        subscription.remove();

        // DISPLAY image: Regula's cropped + perspective-corrected document
        // image (207 = GF_DOCUMENT_IMAGE, processed source). This is the
        // "just the document" crop the scanner produces — used for local
        // preview and the document-card back face (Facepe shows the
        // backend-returned cropped image the same way).
        let previewBase64: string | null = await extractImage(completion.results, 207);
        if (!previewBase64) previewBase64 = await extractImage(completion.results, 102);

        // UPLOAD image: raw camera frame (source=3) — best input for
        // backend OCR per the KYC guide. Falls back to the cropped image
        // (and generic fields) when the raw frame isn't produced.
        let imageBase64: string | null = await extractRawFrame(completion.results);
        const rawFrame = !!imageBase64 && imageBase64.length <= MAX_RAW_BASE64;
        if (!rawFrame) imageBase64 = previewBase64;
        if (!imageBase64) imageBase64 = await extractImage(completion.results, 250);

        if (!imageBase64) {
          reject(new Error('Scanner did not return an image. Please try again and hold the document steady.'));
          return;
        }

        // Which image goes to the backend, and both sizes — the backend
        // reads the portrait from the upload, so its resolution matters.
        console.log(
          '[DocScan] complete',
          `upload=${rawFrame ? 'raw-frame' : 'cropped'} ${imageLabel(imageBase64)}`,
          `| preview ${imageLabel(previewBase64) ?? 'none'}`,
        );
        resolve({ imageBase64, previewBase64: previewBase64 ?? imageBase64 });
      } catch (e: any) {
        settled = true;
        subscription.remove();
        reject(e);
      }
    });

    const config = new ScannerConfig();
    // MrzAndLocate: captures a high-quality raw camera image on-device;
    // backend Regula does full OCR/classification server-side. A full-page
    // paper document has no MRZ, so it only locates the page edges.
    config.scenario = fullPage
      ? (ScenarioIdentifier?.SCENARIO_LOCATE ?? 'Locate')
      : (ScenarioIdentifier?.SCENARIO_MRZ_AND_LOCATE ?? 'MrzAndLocate');

    DocumentReader.scan(
      config,
      () => {},
      (error: any) => {
        if (settled) return;
        settled = true;
        subscription.remove();
        const errMsg = typeof error === 'string' ? error : JSON.stringify(error);
        if (errMsg && /cancel/i.test(errMsg)) {
          reject(new RegulaScanCancelled());
          return;
        }
        reject(new Error(errMsg || 'Scanner error'));
      },
    );
  });
}
