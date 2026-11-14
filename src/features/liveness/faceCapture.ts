/**
 * The face photo taken before Regula liveness: when the live camera may take
 * it, and what to tell the person meanwhile.
 *
 * ML Kit's face detector reports the faces in each preview frame. A face
 * must first be suitable — exactly one, fully in view, centered, near enough
 * but not too near, facing the camera, eyes open — and then stay suitable and
 * still for a full HOLD_MS before the photo is taken. An unsuitable frame, a
 * gap between frames or movement away from where the hold began cancels the
 * countdown; it starts again from zero once the face is suitable again. A hold
 * ends in one capture: the machine then stays `captured` until it is resumed
 * or reset, so a photo is never taken twice.
 *
 * Children (members under CHILD_UNDER_AGE) get wider limits and guardian
 * wording: an adult holds the phone and a young child's face is smaller and
 * moves more. Members under 5 never get here — they enroll with one photo and
 * no liveness (family/memberSetupState.memberCaptureMode).
 *
 * Pure, so it runs under `node --test` (__tests__/faceCapture.test.mjs).
 */

/** Whose face is in front of the camera, and so which limits and wording apply. */
export type CaptureSubject = 'self' | 'member' | 'child';

/** Members younger than this are children here: a guardian holds the phone
 *  (the same age band that may use the rear camera). */
export const CHILD_UNDER_AGE = 10;

export function captureSubject(personId: string | undefined, age: number | undefined): CaptureSubject {
  if (!personId) return 'self';
  return age != null && Number.isFinite(age) && age < CHILD_UNDER_AGE ? 'child' : 'member';
}

/** One face as the detector reports it (bounds in the frame's own pixels). */
export interface FaceSample {
  bounds: { x: number; y: number; width: number; height: number };
  frameWidth?: number;
  frameHeight?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  leftEyeOpen?: number;
  rightEyeOpen?: number;
}

export type FaceProblem =
  | 'no_face'
  | 'several_faces'
  | 'cut_off'
  | 'too_far'
  | 'too_close'
  | 'not_centered'
  | 'turned'
  | 'eyes_closed';

export interface CaptureRules {
  /** The face's width as a share of the frame's width. */
  minWidthShare: number;
  maxWidthShare: number;
  /** How far the face's center may be from the frame's, as a share of its width / height. */
  maxCenterOffsetX: number;
  maxCenterOffsetY: number;
  /** Head angles, in degrees either way. */
  maxYaw: number;
  maxPitch: number;
  maxRoll: number;
  /** Eye-open probability both eyes need, when the detector reports one. */
  minEyeOpen: number;
  /** Movement allowed during the hold, from where it began: the center (share
   *  of the face's width), the size (share) and the yaw (degrees). */
  maxShift: number;
  maxSizeChange: number;
  maxYawChange: number;
  /** A longer pause between frames restarts the hold: stillness wasn't seen. */
  maxGapMs: number;
}

/** How long a suitable face must stay still before the photo is taken. */
export const HOLD_MS = 1000;

const ADULT_RULES: CaptureRules = {
  // The still photo is checked again at 20% (family/photoQuality); a little
  // more here keeps a passing preview from making a failing photo.
  minWidthShare: 0.25,
  maxWidthShare: 0.85,
  maxCenterOffsetX: 0.15,
  maxCenterOffsetY: 0.18,
  maxYaw: 12,
  maxPitch: 15,
  maxRoll: 15,
  minEyeOpen: 0.5,
  maxShift: 0.12,
  maxSizeChange: 0.15,
  maxYawChange: 6,
  maxGapMs: 500,
};

export const CAPTURE_RULES: Record<CaptureSubject, CaptureRules> = {
  self: ADULT_RULES,
  member: ADULT_RULES,
  child: {
    minWidthShare: 0.22,
    maxWidthShare: 0.9,
    maxCenterOffsetX: 0.2,
    maxCenterOffsetY: 0.22,
    maxYaw: 18,
    maxPitch: 20,
    maxRoll: 20,
    minEyeOpen: 0.3,
    maxShift: 0.18,
    maxSizeChange: 0.2,
    maxYawChange: 10,
    maxGapMs: 500,
  },
};

const within = (value: number | undefined, limit: number) => value == null || !Number.isFinite(value) || Math.abs(value) <= limit;

/** Whether the face looks at the camera: head angles within the limits. */
export function facingCamera(face: Pick<FaceSample, 'yaw' | 'pitch' | 'roll'>, rules: CaptureRules): boolean {
  return within(face.yaw, rules.maxYaw) && within(face.pitch, rules.maxPitch) && within(face.roll, rules.maxRoll);
}

/** Why the faces in one frame aren't ready for the photo, or null when they are. */
export function faceProblem(faces: readonly FaceSample[], rules: CaptureRules): FaceProblem | null {
  if (faces.length === 0) return 'no_face';
  if (faces.length > 1) return 'several_faces';
  const face = faces[0];
  const { x, y, width: w, height: h } = face.bounds;
  const fw = face.frameWidth ?? 0;
  const fh = face.frameHeight ?? 0;
  // Without the frame's size nothing about position or size can be judged.
  if (fw > 0 && fh > 0) {
    if (x < 0 || y < 0 || x + w > fw || y + h > fh) return 'cut_off';
    if (w < rules.minWidthShare * fw) return 'too_far';
    if (w > rules.maxWidthShare * fw) return 'too_close';
    const dx = Math.abs(x + w / 2 - fw / 2) / fw;
    const dy = Math.abs(y + h / 2 - fh / 2) / fh;
    if (dx > rules.maxCenterOffsetX || dy > rules.maxCenterOffsetY) return 'not_centered';
  }
  if (!facingCamera(face, rules)) return 'turned';
  const eyes = [face.leftEyeOpen, face.rightEyeOpen].filter((p): p is number => typeof p === 'number');
  if (eyes.some((p) => p < rules.minEyeOpen)) return 'eyes_closed';
  return null;
}

/** Whether `face` moved too far from where the hold began. */
export function movedSince(anchor: FaceSample, face: FaceSample, rules: CaptureRules): boolean {
  const a = anchor.bounds;
  const b = face.bounds;
  const shift = Math.hypot(b.x + b.width / 2 - (a.x + a.width / 2), b.y + b.height / 2 - (a.y + a.height / 2));
  if (a.width > 0 && shift / a.width > rules.maxShift) return true;
  if (a.width > 0 && Math.abs(b.width - a.width) / a.width > rules.maxSizeChange) return true;
  if (anchor.yaw != null && face.yaw != null && Math.abs(face.yaw - anchor.yaw) > rules.maxYawChange) return true;
  return false;
}

export type CaptureState =
  /** No face in view. */
  | { status: 'searching' }
  /** A face, not yet suitable. */
  | { status: 'adjusting'; problem: Exclude<FaceProblem, 'no_face'> }
  /** Suitable and still: `progress` runs 0→1 over HOLD_MS. */
  | { status: 'holding'; progress: number }
  /** Take the photo now. Reported once per hold. */
  | { status: 'capture' }
  /** The photo was asked for; nothing more until resume() or reset(). */
  | { status: 'captured' }
  /** No photo within the time allowed. */
  | { status: 'timed_out' };

export interface StableFaceCapture {
  /** One frame's faces, at `now` (ms). */
  update(faces: readonly FaceSample[], now: number): CaptureState;
  /** No frame needed: whether the time allowed has run out. */
  tick(now: number): CaptureState | null;
  /** Look for a suitable face again (the photo was refused), keeping the time already spent. */
  resume(): void;
  /** Start over, the time allowed included. */
  reset(now: number): void;
}

export function createStableFaceCapture(
  rules: CaptureRules,
  { holdMs = HOLD_MS, timeoutMs, startedAt = 0 }: { holdMs?: number; timeoutMs?: number; startedAt?: number } = {},
): StableFaceCapture {
  let start = startedAt;
  let hold: { since: number; last: number; anchor: FaceSample } | null = null;
  let captured = false;
  let timedOut = false;

  const expired = (now: number) => timeoutMs != null && now - start >= timeoutMs;

  return {
    update(faces, now) {
      if (timedOut) return { status: 'timed_out' };
      if (captured) return { status: 'captured' };
      if (expired(now)) {
        timedOut = true;
        hold = null;
        return { status: 'timed_out' };
      }
      const problem = faceProblem(faces, rules);
      if (problem) {
        hold = null;
        return problem === 'no_face' ? { status: 'searching' } : { status: 'adjusting', problem };
      }
      const face = faces[0];
      if (hold && (now - hold.last > rules.maxGapMs || movedSince(hold.anchor, face, rules))) hold = null;
      if (!hold) {
        hold = { since: now, last: now, anchor: face };
        return { status: 'holding', progress: 0 };
      }
      hold.last = now;
      const elapsed = now - hold.since;
      if (elapsed >= holdMs) {
        captured = true;
        hold = null;
        return { status: 'capture' };
      }
      return { status: 'holding', progress: elapsed / holdMs };
    },
    tick(now) {
      if (timedOut) return { status: 'timed_out' };
      if (captured || !expired(now)) return null;
      timedOut = true;
      hold = null;
      return { status: 'timed_out' };
    },
    resume() {
      captured = false;
      hold = null;
    },
    reset(now) {
      start = now;
      captured = false;
      timedOut = false;
      hold = null;
    },
  };
}

/** How long the photo may take before the check stops with advice. */
export const CAPTURE_TIMEOUT_MS = 60_000;
/** After this long without a photo, the screen adds a tip. */
export const CAPTURE_TIP_AFTER_MS = 15_000;
/** Photos refused on the phone (no usable face) before the check stops. */
export const MAX_REFUSED_PHOTOS = 3;

export const CAPTURE_COPY = {
  instruction: 'Look straight at the camera.',
  holding: 'Face detected. Please stay still.',
  checking: 'Checking the photo…',
  timeout: "We couldn't get a clear view of the face. Find even light, hold the phone at eye level and try again.",
  refused: "We couldn't get a clear photo of the face. Find even light, keep the face inside the circle and try again.",
  captureFailed: "The photo couldn't be taken. Hold still and we'll try again.",
  cameraFailed: "The camera couldn't start. Close other apps that use the camera, then try again.",
} as const;

const PROBLEM_COPY: Record<CaptureSubject, Record<FaceProblem, string>> = {
  self: {
    no_face: CAPTURE_COPY.instruction,
    several_faces: 'Only one person in the frame.',
    cut_off: 'Keep your whole face inside the circle.',
    too_far: 'Move a little closer.',
    too_close: 'Move a little further away.',
    not_centered: 'Center your face in the circle.',
    turned: CAPTURE_COPY.instruction,
    eyes_closed: 'Keep your eyes open.',
  },
  member: {
    no_face: CAPTURE_COPY.instruction,
    several_faces: 'Only one person in the frame.',
    cut_off: 'Keep the whole face inside the circle.',
    too_far: 'Move a little closer.',
    too_close: 'Move a little further away.',
    not_centered: 'Center the face in the circle.',
    turned: CAPTURE_COPY.instruction,
    eyes_closed: 'Keep both eyes open.',
  },
  child: {
    no_face: 'Point the camera at their face.',
    several_faces: 'Only the child in the frame.',
    cut_off: 'Keep their whole face inside the circle.',
    too_far: 'Move the phone a little closer.',
    too_close: 'Move the phone a little further away.',
    not_centered: 'Center their face in the circle.',
    turned: 'Ask them to look at the camera.',
    eyes_closed: 'Wait until their eyes are open.',
  },
};

/** What to tell the person about one problem (a refused still photo too). */
export function problemMessage(problem: FaceProblem, subject: CaptureSubject): string {
  return PROBLEM_COPY[subject][problem];
}

/** The line under the circle for a state. */
export function captureMessage(state: CaptureState, subject: CaptureSubject): string {
  switch (state.status) {
    case 'searching':
      return PROBLEM_COPY[subject].no_face;
    case 'adjusting':
      return PROBLEM_COPY[subject][state.problem];
    case 'holding':
      return CAPTURE_COPY.holding;
    case 'capture':
    case 'captured':
      return CAPTURE_COPY.checking;
    case 'timed_out':
      return CAPTURE_COPY.timeout;
  }
}

/** The standing advice for whoever holds the phone, and a tip once it takes long. */
export function captureGuidance(subject: CaptureSubject, elapsedMs: number): string {
  if (elapsedMs >= CAPTURE_TIP_AFTER_MS) {
    return subject === 'child'
      ? 'Try a brighter spot, and hold the phone at their eye level, about an arm’s length away.'
      : 'Try a brighter spot, with no strong light behind, and hold the phone at eye level.';
  }
  return subject === 'child'
    ? 'Hold the phone at their eye level and keep their face in the circle. The photo is taken automatically.'
    : 'Hold the phone at eye level. The photo is taken automatically.';
}
