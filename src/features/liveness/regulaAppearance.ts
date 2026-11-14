/**
 * How Regula's own liveness screens look and read, so that they continue the
 * TruePas face screens rather than look like another app.
 *
 * Only the Face SDK's supported customization is used (Face SDK 8.4):
 * - colors: FaceSDK.instance.customization.colors, one setter per screen part
 *   (camera oval and sectors, hint label, toolbar, processing, retry, success);
 * - text: FaceSDK.instance.localizationDictionary, keyed by the SDK's own
 *   string names (checked in the Android build's resources).
 *
 * What it cannot change: the camera screen's overlay around the oval (white
 * in Regula's screen-light mode, which lights the face), its layout and
 * animation, and its fonts (Android resolves only system font names). There
 * is no camera-screen background color in the SDK, JS or native.
 *
 * Pure (the palette is passed in), so it runs under `node --test`
 * (__tests__/regulaAppearance.test.mjs).
 */
import type { CaptureSubject } from './faceCapture';

/** The TruePas colors Regula's screens take (#RRGGBB). */
export interface RegulaPalette {
  /** The face screens' background (navy night). */
  background: string;
  /** Rings, progress and buttons (sky). */
  accent: string;
  accentLight: string;
  text: string;
}

/** `#RRGGBB` and an opacity as the SDK's color: an AARRGGBB integer. */
export function argb(hex: string, alpha = 1): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB color: ${hex}`);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return (a * 0x1000000 + parseInt(match[1], 16)) >>> 0;
}

/** The CustomizationColors setters this app uses, by their SDK names. */
export type RegulaColorName =
  | 'onboardingScreenBackground'
  | 'onboardingScreenStartButtonBackground'
  | 'onboardingScreenStartButtonTitle'
  | 'onboardingScreenTitleLabelText'
  | 'onboardingScreenSubtitleLabelText'
  | 'onboardingScreenMessageLabelsText'
  | 'cameraScreenStrokeNormal'
  | 'cameraScreenStrokeActive'
  | 'cameraScreenSectorTarget'
  | 'cameraScreenSectorActive'
  | 'cameraScreenFrontHintLabelBackground'
  | 'cameraScreenFrontHintLabelText'
  | 'cameraScreenBackHintLabelBackground'
  | 'cameraScreenBackHintLabelText'
  | 'cameraScreenLightToolbarTint'
  | 'cameraScreenDarkToolbarTint'
  | 'retryScreenBackground'
  | 'retryScreenRetryButtonBackground'
  | 'retryScreenRetryButtonTitle'
  | 'retryScreenTitleLabelText'
  | 'retryScreenSubtitleLabelText'
  | 'retryScreenHintLabelsText'
  | 'processingScreenBackground'
  | 'processingScreenProgress'
  | 'processingScreenTitleLabel'
  | 'successScreenBackground';

export function regulaColors({ background, accent, accentLight, text }: RegulaPalette): Record<RegulaColorName, number> {
  const bg = argb(background);
  const fg = argb(text);
  const soft = argb(text, 0.82);
  return {
    // Skipped (LivenessSkipStep), colored anyway should they ever show.
    onboardingScreenBackground: bg,
    onboardingScreenStartButtonBackground: argb(accent),
    onboardingScreenStartButtonTitle: fg,
    onboardingScreenTitleLabelText: fg,
    onboardingScreenSubtitleLabelText: soft,
    onboardingScreenMessageLabelsText: soft,
    // The camera screen: the oval and its progress sectors, as the TruePas ring.
    cameraScreenStrokeNormal: argb(accentLight),
    cameraScreenStrokeActive: argb(accent),
    cameraScreenSectorTarget: argb(text, 0.25),
    cameraScreenSectorActive: argb(accent),
    // The instruction pill, as the TruePas studio's dark glass.
    cameraScreenFrontHintLabelBackground: argb(background, 0.88),
    cameraScreenFrontHintLabelText: fg,
    cameraScreenBackHintLabelBackground: argb(background, 0.88),
    cameraScreenBackHintLabelText: fg,
    // Toolbar icons on the light overlay, and on the dark one.
    cameraScreenLightToolbarTint: bg,
    cameraScreenDarkToolbarTint: fg,
    retryScreenBackground: bg,
    retryScreenRetryButtonBackground: argb(accent),
    retryScreenRetryButtonTitle: fg,
    retryScreenTitleLabelText: fg,
    retryScreenSubtitleLabelText: soft,
    retryScreenHintLabelsText: soft,
    processingScreenBackground: bg,
    processingScreenProgress: argb(accent),
    processingScreenTitleLabel: fg,
    successScreenBackground: bg,
  };
}

/** Regula's own text, in TruePas words. Keys are the SDK's string names. */
const STRINGS: Record<string, string> = {
  faceLivenessCameraLayoutPreparingService: 'Starting the liveness check…',
  faceLivenessShowOnlyOneFace: 'Only one person in the frame.',
  'hint.fit2': 'Center your face in the oval',
  'hint.lookStraight': 'Look straight at the camera',
  'hint.moveCloser': 'Move a little closer',
  'hint.moveAway': 'Move a little further away',
  'hint.stayStill': 'Face detected. Please stay still',
  'hint.turnHead': 'Slowly turn your head a little',
  'hint.MakeFaceFullyVisible': 'Keep your whole face in view',
  'hint.AddMoreLight': 'Find a brighter spot',
  'livenessProcessing.title.processing': 'Checking liveness…',
  'livenessRetry.title.tryAgain': 'Let’s try that again',
  'livenessRetry.action.retry': 'Try again',
};

/** For a child, the words go to the adult holding the phone. */
const CHILD_STRINGS: Record<string, string> = {
  faceLivenessShowOnlyOneFace: 'Only the child in the frame.',
  'hint.fit2': 'Keep their face in the oval',
  'hint.lookStraight': 'Ask them to look at the camera',
  'hint.moveCloser': 'Move the phone a little closer',
  'hint.moveAway': 'Move the phone a little further away',
  'hint.stayStill': 'Face detected. Hold still',
  'hint.turnHead': 'Ask them to slowly turn their head',
  'hint.MakeFaceFullyVisible': 'Keep their whole face in view',
};

/** The localizationDictionary for whoever is in front of the camera. */
export function regulaStrings(subject: CaptureSubject): Record<string, string> {
  return subject === 'child' ? { ...STRINGS, ...CHILD_STRINGS } : { ...STRINGS };
}

/** Everything the runner applies before Regula's screen opens. */
export interface RegulaAppearance {
  colors: Partial<Record<RegulaColorName, number>>;
  strings: Record<string, string>;
  /** Show Regula's own camera switch (children: a guardian may use the rear camera). */
  cameraSwitch: boolean;
}

export function regulaAppearance(palette: RegulaPalette, subject: CaptureSubject): RegulaAppearance {
  return { colors: regulaColors(palette), strings: regulaStrings(subject), cameraSwitch: subject === 'child' };
}
