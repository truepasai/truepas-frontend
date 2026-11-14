/**
 * The live part of a member-under-5 photo: when the camera may take it, and
 * what to tell the adult holding the phone meanwhile. What happens to the
 * photo afterwards (the still check, the preview, Save) is the screen's
 * (premium/flows/familyPhotoCapture) and photoQuality's.
 *
 * The live face detector reports the faces in each preview frame (~10 a
 * second, an empty frame too). The photo is taken when exactly one face is
 * suitable and stays still for UNDER5_HOLD_MS — the 5+ camera's
 * stable-face hold (liveness/faceCapture createStableFaceCapture), with
 * limits for a young child — or when the adult taps Take photo while such a
 * face is in view. Both claim the one capture through begin(): one photo at a
 * time, and none again until reset() (retake, try again). Live detection only
 * frames the photo; it is not a check of who is in it.
 *
 * Pure: createStableFaceCapture is passed in, so this runs under `node --test`
 * (__tests__/photoCaptureMachine.test.mjs).
 */
import type { CaptureRules, CaptureState, FaceProblem, FaceSample, StableFaceCapture } from '../liveness/faceCapture';
import type { PhotoStepPhase } from './photoEnrollment';

/**
 * Limits for a member under 5, wider than the 5–9 ones (faceCapture
 * CAPTURE_RULES.child): a young child moves more and tilts their head. The
 * still photo is checked again at 20% of its width (photoQuality), so a
 * passing preview doesn't make a failing photo. Provisional (2026-11-06): to
 * be tuned on devices. The size change, yaw change and frame gap are the 5–9
 * values.
 */
export const UNDER5_RULES: CaptureRules = {
  minWidthShare: 0.22,
  maxWidthShare: 0.9,
  maxCenterOffsetX: 0.22,
  maxCenterOffsetY: 0.25,
  maxYaw: 20,
  maxPitch: 20,
  maxRoll: 25,
  minEyeOpen: 0.3,
  maxShift: 0.2,
  maxSizeChange: 0.2,
  maxYawChange: 10,
  maxGapMs: 500,
};

/** How long the one suitable face must stay still before the photo is taken. */
export const UNDER5_HOLD_MS = 700;

/** What the live camera shows. */
export type LiveView =
  /** Until the camera runs (its start, or its first frame). */
  | { status: 'initializing' }
  /** No face in view. */
  | { status: 'looking' }
  /** A face, or several, not yet suitable. */
  | { status: 'adjusting'; problem: Exclude<FaceProblem, 'no_face'> }
  /** Exactly one suitable face, holding still: `progress` runs 0→1. */
  | { status: 'holding'; progress: number };

export type CaptureTrigger = 'auto' | 'manual';

export interface PhotoCaptureMachine {
  view(): LiveView;
  /** The camera is running. */
  cameraStarted(): LiveView;
  /** One frame's faces at `now` (ms). `capture` is true once per completed
   *  hold: take the photo now (begin('auto')). */
  frames(faces: readonly FaceSample[], now: number): { view: LiveView; capture: boolean };
  /** No frame needed: a hold whose frames stopped coming is over. */
  tick(now: number): LiveView;
  /** Exactly one suitable face in view now, and no capture claimed: Take photo may be used. */
  canTakePhoto(now: number): boolean;
  /** Claim the one capture. False while one is claimed (taken, or its photo
   *  under review), for 'auto' unless a hold just completed, and for 'manual'
   *  unless canTakePhoto. */
  begin(trigger: CaptureTrigger, now: number): boolean;
  /** Retake or try again: the photo is dropped, the hold starts from zero. */
  reset(now: number): LiveView;
}

type CreateStable = (rules: CaptureRules, options: { holdMs?: number }) => StableFaceCapture;

export function createPhotoCaptureMachine(
  createStableFaceCapture: CreateStable,
  { rules = UNDER5_RULES, holdMs = UNDER5_HOLD_MS }: { rules?: CaptureRules; holdMs?: number } = {},
): PhotoCaptureMachine {
  const stable = createStableFaceCapture(rules, { holdMs });
  let view: LiveView = { status: 'initializing' };
  // When the last frame showed one suitable face (null: it didn't).
  let suitableAt: number | null = null;
  let holdDone = false;
  let claimed = false;

  const fromState = (state: CaptureState, now: number): LiveView => {
    switch (state.status) {
      case 'holding':
        suitableAt = now;
        return { status: 'holding', progress: state.progress };
      case 'capture':
        suitableAt = now;
        holdDone = true;
        return { status: 'holding', progress: 1 };
      case 'adjusting':
        suitableAt = null;
        return { status: 'adjusting', problem: state.problem };
      default:
        // searching; 'captured' and 'timed_out' don't occur while unclaimed
        // (no time limit here, and a completed hold is claimed or reset).
        suitableAt = null;
        return { status: 'looking' };
    }
  };

  const canTakePhoto = (now: number) =>
    !claimed && view.status === 'holding' && suitableAt != null && now - suitableAt <= rules.maxGapMs;

  return {
    view: () => view,
    cameraStarted() {
      if (view.status === 'initializing') view = { status: 'looking' };
      return view;
    },
    frames(faces, now) {
      // A claimed capture: frames change nothing until reset().
      if (claimed) return { view, capture: false };
      const state = stable.update(faces, now);
      view = fromState(state, now);
      return { view, capture: state.status === 'capture' };
    },
    tick(now) {
      if (!claimed && view.status === 'holding' && (suitableAt == null || now - suitableAt > rules.maxGapMs)) {
        suitableAt = null;
        view = { status: 'looking' };
      }
      return view;
    },
    canTakePhoto,
    begin(trigger, now) {
      if (claimed) return false;
      if (trigger === 'auto' ? !holdDone : !canTakePhoto(now)) return false;
      claimed = true;
      holdDone = false;
      return true;
    },
    reset(now) {
      stable.reset(now);
      claimed = false;
      holdDone = false;
      suitableAt = null;
      view = { status: 'initializing' };
      return view;
    },
  };
}

/** One face from the live detector as a plain sample (Nitro objects don't cross runOnJS). */
export function toFaceSample(face: {
  bounds: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  yawAngle: number;
  pitchAngle: number;
  rollAngle: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
}): FaceSample {
  return {
    bounds: { x: face.bounds.x, y: face.bounds.y, width: face.bounds.width, height: face.bounds.height },
    frameWidth: face.frameWidth,
    frameHeight: face.frameHeight,
    yaw: face.yawAngle,
    pitch: face.pitchAngle,
    roll: face.rollAngle,
    leftEyeOpen: face.leftEyeOpenProbability,
    rightEyeOpen: face.rightEyeOpenProbability,
  };
}

/** Everything the photo screen can show, from where the step is and what the camera sees. */
export type PhotoScreenState =
  | 'initializing'
  | 'looking'
  | 'adjusting'
  | 'holding'
  | 'capturing'
  | 'checking'
  | 'preview'
  | 'saving'
  | 'saved'
  | 'failed';

export function photoScreenState(phase: PhotoStepPhase, live: LiveView): PhotoScreenState {
  switch (phase) {
    case 'camera':
      return live.status;
    case 'capturing':
    case 'checking':
    case 'failed':
      return phase;
    case 'review':
      return 'preview';
    case 'sending':
    case 'confirming':
    case 'unknown':
      return 'saving';
    case 'done':
      return 'saved';
  }
}

/** The words on this screen: for the adult holding the phone, about the child. */
export const PHOTO_CAPTURE_COPY = {
  initializing: 'Starting the camera…',
  capturing: 'Taking the photo…',
  checking: 'Checking the photo…',
  standing: 'Hold the phone at their eye level and keep their face in the circle. The photo is taken when their face is steady, or tap Take photo.',
  tip: 'Try a brighter spot, and hold the phone at their eye level, about an arm’s length away.',
  captureFailed: "The photo couldn't be taken. Try again.",
  cameraFailed: "The camera stopped. Close other apps that use the camera, then try again.",
} as const;

const PROBLEM_COPY: Record<Exclude<FaceProblem, 'no_face'>, (who: string) => string> = {
  several_faces: (who) => `Only ${who} should be in the frame.`,
  cut_off: () => 'Keep their whole face inside the circle.',
  too_far: () => 'Move the phone a little closer.',
  too_close: () => 'Move the phone a little further away.',
  not_centered: () => 'Center their face in the circle.',
  turned: () => 'Wait until they look at the camera.',
  eyes_closed: () => 'Wait until their eyes are open.',
};

/** The line for what the camera sees. `name`: the child's first name, when known. */
export function liveMessage(view: LiveView, name?: string): string {
  const who = name || 'the child';
  switch (view.status) {
    case 'initializing':
      return PHOTO_CAPTURE_COPY.initializing;
    case 'looking':
      return `Point the camera at ${name ? `${name}'s` : 'their'} face.`;
    case 'adjusting':
      return PROBLEM_COPY[view.problem](who);
    case 'holding':
      return 'Face found. Hold still…';
  }
}

/** The standing advice, or a tip once it takes long (faceCapture CAPTURE_TIP_AFTER_MS). */
export function liveGuidance(takingLong: boolean): string {
  return takingLong ? PHOTO_CAPTURE_COPY.tip : PHOTO_CAPTURE_COPY.standing;
}
