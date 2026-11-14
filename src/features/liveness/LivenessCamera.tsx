import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    StyleSheet,
} from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    usePhotoOutput,
    type CameraRef,
} from 'react-native-vision-camera';
import {
    createFaceDetectorOutput,
    createImageFaceDetector,
    type Face,
    type ImageFaceDetector,
} from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-worklets';

import { toApiError } from '@/api/errors';
import { useEnrollFace, useUpdateFace } from '@/features/auth/mutations';
import { type ReauthReason, useRefreshAfterFaceChange, useRememberMemberPhoto } from '@/features/family/hooks';
import { memberCaptureMode } from '@/features/family/memberSetupState';
import { DETECTOR_MIN_FACE, checkPhotoFaces, errorDetail, isDetectorDefect, type PhotoIssue } from '@/features/family/photoQuality';
// Premium (TruePas 3.0) stage UIs — same props as LivenessStages; camera stays mounted per AGENTS.md.
import {
  PremiumCameraStateStage as CameraStateStage,
  PremiumCaptureStage as CaptureStage,
  PremiumChallengeStage as ChallengeStage,
  PremiumFinishingStage as FinishingStage,
  PremiumLivenessHandoffStage as HandoffStage,
  PremiumLivenessResultStage as LivenessResultStage,
  PremiumNoticeStage as NoticeStage,
} from '@/premium/flows/face';
import { CameraPermissionGate } from '@/premium/flows/faceCamera';
import { C } from '@/premium/theme';
import {
  CAPTURE_COPY,
  CAPTURE_RULES,
  CAPTURE_TIMEOUT_MS,
  MAX_REFUSED_PHOTOS,
  captureGuidance,
  captureMessage,
  captureSubject,
  problemMessage,
  createStableFaceCapture,
  facingCamera,
  type CaptureRules,
  type CaptureState,
  type FaceProblem,
  type FaceSample,
  type StableFaceCapture,
} from '@/features/liveness/faceCapture';
import { uprightFrame } from '@/features/liveness/frame';
import { regulaAppearance } from '@/features/liveness/regulaAppearance';
import { runRegulaLiveness } from '@/features/liveness/regulaFaceSdk';
import { serverFailure, type LivenessFailure, type RegulaRunConfig } from '@/features/liveness/regulaLiveness';
import { useLivenessSession } from '@/features/liveness/useLivenessSession';
import { clearCooldown, cooldownKey, setCooldown } from '@/services/cooldowns';
import { flowGuards } from '@/services/flowGuards';
import { hasReauthToken } from '@/services/reauth';
import { useAppSelector } from '@/store';
import { errorHaptic, successHaptic, tapHaptic } from '@/services/haptics';

/** A passed liveness capture, for a server-side 1:1 match (verify mode). */
export interface LivenessCapture {
  livenessSessionId: string;
  sessionToken: string;
}

interface LivenessCameraProps {
  /** "enroll" for first-time enrollment, "update" for face update flow,
   *  "verify" to prove who is in front of the camera without changing any
   *  face: the passed capture goes to `onVerified`, and the caller's request
   *  has the BFF match it against `personId`'s enrolled face. */
  mode: 'enroll' | 'update' | 'verify';
  /** Family member personId (for family face enrollment, or the person verified). */
  personId?: string;
  /** Called after successful face enrollment/update. */
  onSuccess: () => void;
  /** Verify mode: the single-use capture (the screen submits it). */
  onVerified?: (capture: LivenessCapture) => void;
  /** Called on unrecoverable error. Recoverable failures (step rejected,
   *  429 rate limit, network) are handled in-place by the built-in failed
   *  UI with a retry cooldown, so this rarely fires. */
  onError?: (message: string) => void;
  /** Members under 10 may use the rear camera too (a parent holds the phone
   *  while the child faces it). When true, a front/back toggle shows in the
   *  challenge header. Default: front camera only (ages 10+). */
  allowBackCamera?: boolean;
  /** Update mode: PUT /face needs the single-use PIN token (backend §5).
   *  Called — instead of a generic failure — when the token is missing or
   *  expired, or the server answers 403 REAUTH_REQUIRED ('expired'), and when
   *  the user retries after a failed update that used the token up
   *  ('retry'). The screen sends the user back to the PIN step. */
  onReauthRequired?: (reason: ReauthReason) => void;
  /** Passed-stage button label (default: Done for members, else Continue). */
  nextLabel?: string;
  /** The family member's age, when known: under 10 gets the child capture
   *  limits and guardian wording; under 5 never runs liveness (photo instead). */
  subjectAge?: number;
}

// Calibration thresholds (per guide §4.5 — tune on real devices)
const BLINK_CLOSED_THRESHOLD = 0.35;
const BLINK_OPEN_THRESHOLD = 0.6;
const YAW_THRESHOLD = 12; // degrees
// Client-side grace on top of the server's step_time_limits.max_ms — the
// backend keeps sending 10s; we allow 2s more before failing the step.
const STEP_GRACE_MS = 2000;
// The finalize frame becomes the enrolled face, so it waits for a frontal,
// still face: |yaw| within FRONTAL_YAW, eyes open, yaw moving less than
// STILL_YAW_DELTA between samples, STEADY_SAMPLES in a row (~0.4 s at 10/s).
// After STEADY_MAX_WAIT_MS it captures anyway.
const FRONTAL_YAW = 8; // degrees
const STILL_YAW_DELTA = 2.5; // degrees between samples
const STEADY_SAMPLES = 4;
const STEADY_MAX_WAIT_MS = 4000;

/** One detector face as a plain sample (Nitro objects don't cross runOnJS). */
function toSample(face: Face): FaceSample {
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

/** The still photo's own checks (photoQuality) as capture problems. */
const STILL_PROBLEMS: Partial<Record<PhotoIssue, FaceProblem>> = {
  no_face: 'no_face',
  several_faces: 'several_faces',
  off_frame: 'cut_off',
  too_small: 'too_far',
};

/**
 * Why the photo just taken can't be the enrolled face, or null when it can:
 * exactly one face, fully in view and large enough (the same check as a
 * child's enrollment photo), facing the camera. Without a working still-image
 * detector on this phone the preview's checks stand, logged by category:
 * `detector_defect` is the detector library's own still-photo defect (fixed
 * by patches/, so seen only on an older build), never a face verdict.
 */
function stillPhotoProblem(detector: ImageFaceDetector | null, uri: string, rules: CaptureRules): FaceProblem | null {
  if (!detector) return null;
  let faces: Face[];
  try {
    faces = detector.detectFaces(uri);
  } catch (err) {
    const detail = errorDetail(err);
    console.warn(
      `[FaceCapture] still-photo face check skipped, preview checks stand: category=${isDetectorDefect(detail) ? 'detector_defect' : 'detector_failed'} error="${detail.replace(/"/g, "'")}"`,
    );
    return null;
  }
  const plain = faces.map((f) => ({ bounds: f.bounds, frameWidth: f.frameWidth, frameHeight: f.frameHeight }));
  const size = plain[0] ? { width: plain[0].frameWidth, height: plain[0].frameHeight } : { width: 1, height: 1 };
  const check = checkPhotoFaces(plain, size);
  if (!check.ok) return STILL_PROBLEMS[check.issue] ?? 'no_face';
  const face = faces.reduce((a, b) => (b.bounds.width > a.bounds.width ? b : a));
  return facingCamera({ yaw: face.yawAngle, pitch: face.pitchAngle, roll: face.rollAngle }, rules) ? null : 'turned';
}

/**
 * Face capture + liveness camera using react-native-vision-camera v5
 * + ML Kit face detector, with the liveness check the server runs.
 *
 * Regula (the server's liveness service on LIVENESS_PROVIDER=regula):
 *  1. Request camera permissions; create a Regula session
 *  2. Capture the face image (faceCapture): once one face is centered, near
 *     enough, facing the camera and has stayed still for a full second, a
 *     high-res photo is taken, checked again on the phone (one face, fully in
 *     view, large enough, facing the camera) and only then uploaded
 *  3. Regula liveness on its own screen, in TruePas colors and words
 *     (regulaAppearance); the server verifies the transaction
 *  4. Call face enroll/update with session credentials — the image enrolled
 *     is the one captured in step 2
 *
 * ML Kit challenge (only when the server is not on Regula and the build sets
 * EXPO_PUBLIC_LIVENESS_CHALLENGE_FALLBACK=true — useLivenessSession; per
 * REACT_NATIVE_KYC_INTEGRATION_GUIDE.md §4):
 *  1. Request camera permissions
 *  2. Create liveness challenge (server-provided sequence)
 *  3. Frame processor auto-detects blink/turn via ML Kit face landmarks
 *  4. When action detected → automatically submit evidence (metadata only, NO image)
 *  5. After all steps: capture high-res photo → finalize
 *  6. Call face enroll/update with session credentials
 *
 * NO manual button press — detection is fully automatic.
 */
export function LivenessCamera({
  mode,
  personId,
  onSuccess,
  onVerified,
  onError,
  allowBackCamera,
  onReauthRequired,
  nextLabel,
  subjectAge,
}: LivenessCameraProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [capturing, setCapturing] = useState(false);
  // Challenge is created on mount; the guided dial renders as soon as the
  // challenge arrives and detection begins immediately (no intro gate).
  const [enrolling, setEnrolling] = useState(false);
  // Camera preview is stopped briefly before navigating away — unmounting an
  // ACTIVE Camera on the new architecture (Fabric) can dispatch a
  // topCameraReady event after the JS view is gone, which crashes the app.
  const [cameraActive, setCameraActive] = useState(true);
  const router = useRouter();

  const liveness = useLivenessSession();
  const enrollFace = useEnrollFace();
  const rememberMemberPhoto = useRememberMemberPhoto();
  const refreshAfterFaceChange = useRefreshAfterFaceChange();
  /** Finalize frame, kept so a family member's enrolment can become their avatar. */
  const capturedUri = useRef<string | null>(null);
  const updateFace = useUpdateFace();
  // Update mode: the PIN token goes with the first PUT /face attempt and is
  // single use — after a failed update, a retry needs the PIN again.
  const [pinSpent, setPinSpent] = useState(false);
  const reauthGated = mode === 'update' && !!onReauthRequired;
  // Failures a new attempt can't fix: 429 FACE_UPDATE_LIMIT_REACHED (3
  // failed updates in 24 h) or 409 FACE_ALREADY_ENROLLED on enroll. The
  // failed screen then offers Done instead of Try again / PIN again.
  const [deadEnd, setDeadEnd] = useState(false);
  const accountId = useAppSelector((state) => state.auth.user?.id);
  const faceLimitKey = accountId ? cooldownKey('face-update', accountId, personId ?? 'self') : null;
  // Members under 5 enroll with a photo and never run liveness (the backend
  // refuses them a liveness session): this screen says so and starts nothing.
  const photoOnly = !!personId && memberCaptureMode(null, subjectAge) === 'photo';
  const subject = captureSubject(personId, subjectAge);
  const rules = CAPTURE_RULES[subject];
  const appearance = useMemo(
    () => regulaAppearance({ background: C.navyNight, accent: C.sky, accentLight: C.skyLight, text: C.white }, subject),
    [subject],
  );

  // Under-10 members may flip to the rear camera (parent holds the phone);
  // everyone else stays front-only per the age-band spec.
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraPosition);
  // ML Kit's still-image detector checks the photo itself before it is sent.
  // Created here, not during render: a phone that can't create it then still
  // runs the live checks (logged).
  const stillDetector = useMemo<ImageFaceDetector | null>(() => {
    try {
      return createImageFaceDetector({ performanceMode: 'accurate', minFaceSize: DETECTOR_MIN_FACE });
    } catch (err) {
      console.warn(`[FaceCapture] still-photo face check unavailable, preview checks stand: category=detector_unavailable error="${errorDetail(err).replace(/"/g, "'")}"`);
      return null;
    }
  }, []);
  // JPEG, not the 'native' default: that is HEIC on iOS, which the backend
  // can't decode ("Unsupported frame type" / "no face detected").
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg' });

  const cameraRef = useRef<CameraRef>(null);

  // Per-step tracking refs
  const stepStartedAt = useRef<number>(0);
  const lastClientTs = useRef<number>(0);
  const eyesWereClosed = useRef(false);
  const submittingRef = useRef(false);
  const lastSampleTs = useRef(0);
  // Consecutive frontal, still samples (see STEADY_SAMPLES), and when
  // finalizing started — read by the auto-finalize effect.
  const steadyRef = useRef<{ count: number; lastYaw: number | null }>({ count: 0, lastYaw: null });
  const finalizeStartedAt = useRef(0);
  const finalizeTriggered = useRef(false);
  // Regula's face photo: the stable-face machine (one per capture phase), what
  // it last saw, photos refused on the phone so far, and a one-shot guard on
  // taking the photo.
  const captureRef = useRef<StableFaceCapture | null>(null);
  const [captureView, setCaptureView] = useState<CaptureState>({ status: 'searching' });
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [captureElapsed, setCaptureElapsed] = useState(0);
  const captureStartedAt = useRef(0);
  const refusedPhotos = useRef(0);
  const takingPhoto = useRef(false);
  const phaseRef = useRef(liveness.phase);
  // Regula liveness is started once per captured image; `regulaDone` once its
  // screen has closed and the server is reading the verdict.
  const regulaStarted = useRef(false);
  const [regulaDone, setRegulaDone] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transient UX hints (too-fast action, multiple faces) shown under the dial
  const [hint, setHint] = useState<string | null>(null);
  const [multiFace, setMultiFace] = useState(false);
  // No camera after a few seconds = device has none / it's busy — don't leave
  // the user staring at "Loading camera..." forever.
  const [deviceTimedOut, setDeviceTimedOut] = useState(false);

  useEffect(() => {
    if (device || deviceTimedOut) return;
    const t = setTimeout(() => setDeviceTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [device, deviceTimedOut]);

  // Request camera permission on mount
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // Clear any pending hint timer on unmount
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // ── In-place failure handling (fixes the 429 retry loop) ─────────────
  // Failures fail the session LOCALLY instead of navigating away:
  //  1. phase leaves 'challenging' immediately → the frame processor's
  //     onFaceSample guard stops re-submitting evidence (previously a 429
  //     on evidence kept the phase 'challenging' and resubmitted every
  //     ~100ms during the 400ms navigation settle window).
  //  2. The built-in failed UI shows toApiError's friendly copy with a
  //     retry cooldown — 10s after a 429 (retrying sooner only burns more
  //     rate-limit quota), 3s for other failures.
  const { failSession } = liveness;
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const failWithCooldown = useCallback((err: unknown, fallback: string) => {
    const apiErr = toApiError(err);
    setCooldownLeft(apiErr.status === 429 ? 10 : 3);
    const failure = (err as { failure?: LivenessFailure } | null)?.failure ?? serverFailure(apiErr);
    failSession(apiErr.message || fallback, failure);
  }, [failSession]);

  // 1s countdown while the failed UI is visible; Try Again stays disabled
  // until it reaches 0. setState runs inside the interval callback (not
  // synchronously in the effect body) to avoid cascading renders.
  useEffect(() => {
    if (liveness.phase !== 'failed' || cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [liveness.phase, cooldownLeft]);

  // Stop the preview, let the native camera settle, then navigate. Prevents
  // the Fabric "Unsupported top level event type topCameraReady" crash that
  // happens when an active Camera unmounts mid-event-dispatch.
  const settleCameraThen = useCallback(async (navigate: () => void) => {
    setCameraActive(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    navigate();
  }, []);

  // Start liveness challenge when permission is granted, and restart after
  // reset (Try Again) — depends on phase so idle→start works every time.
  // Update mode first checks the PIN token is still held (5 min, single
  // use): without it PUT /face would fail after the whole challenge.
  useEffect(() => {
    if (hasPermission && liveness.phase === 'idle' && !photoOnly) {
      if (reauthGated && !hasReauthToken()) {
        // Microtask: settleCameraThen sets state (react-hooks/set-state-in-effect).
        queueMicrotask(() => void settleCameraThen(() => onReauthRequired?.('expired')));
        return;
      }
      liveness.startSession(personId).catch((err) => {
        failWithCooldown(err, 'Failed to start liveness challenge');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, personId, liveness.phase]);

  const beginStep = useCallback(() => {
    stepStartedAt.current = Date.now();
    eyesWereClosed.current = false;
    submittingRef.current = false;
  }, []);

  // Begin step when challenge phase starts or step advances
  useEffect(() => {
    if (liveness.phase === 'challenging') {
      beginStep();
    }
  }, [liveness.phase, liveness.currentStepIndex, beginStep]);

  // Handle face sample — auto-detect actions (called from JS thread via Worklets)
  const onFaceSample = useCallback(async (leftEyeOpen: number, rightEyeOpen: number, yaw: number) => {
    if (liveness.phase !== 'challenging' || !liveness.challenge || submittingRef.current) return;
    const action = liveness.currentChallenge;
    if (!action) return;

    // Detect the action
    if (action === 'blink') {
      // blink = eyes closed, then open again
      if (leftEyeOpen < BLINK_CLOSED_THRESHOLD && rightEyeOpen < BLINK_CLOSED_THRESHOLD) {
        if (!eyesWereClosed.current) {
          console.log('[Liveness] Blink: eyes CLOSED detected, waiting for reopen...');
        }
        eyesWereClosed.current = true;
      }
      if (!eyesWereClosed.current || leftEyeOpen < BLINK_OPEN_THRESHOLD || rightEyeOpen < BLINK_OPEN_THRESHOLD) {
        return; // eyes not yet fully open after closing
      }
      console.log('[Liveness] Blink: eyes REOPENED — blink complete!');
    } else if (action === 'turn_left' || action === 'turn_right') {
      // ML Kit yaw: positive = subject turns to their LEFT, negative = to their RIGHT
      if (action === 'turn_right' && yaw > -YAW_THRESHOLD) return;
      if (action === 'turn_left' && yaw < YAW_THRESHOLD) return;
      console.log(`[Liveness] Turn detected: yaw=${yaw.toFixed(1)}° crossed threshold ${YAW_THRESHOLD}°`);
    } else {
      // Unknown challenge type from the server - never submit evidence for an
      // action we didn't actually detect (any turn would otherwise "pass" it).
      console.error('[Liveness] Unknown challenge action:', action);
      liveness.failSession('Unsupported verification step. Please update the app.');
      return;
    }

    // Action detected — check timing
    const durationMs = Date.now() - stepStartedAt.current;
    const { min_ms, max_ms } = liveness.challenge.step_time_limits;
    const stepMaxMs = max_ms + STEP_GRACE_MS;
    console.log(`[Liveness] Action detected: duration=${durationMs}ms (limits: ${min_ms}-${stepMaxMs}ms)`);
    if (durationMs < min_ms) {
      // Too fast - not a failure, just ask them to hold the pose. The hint
      // auto-clears so the next (slower) attempt isn't blocked.
      setHint('Hold that pose a moment...');
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), 1500);
      return;
    }
    if (durationMs > stepMaxMs) {
      // too slow — fail the session locally so the retry UI shows and
      // sample processing stops (phase leaves 'challenging').
      console.error('[Liveness] Step timed out:', durationMs, '>', stepMaxMs);
      liveness.failSession('Time limit exceeded. Please try again.');
      return;
    }

    // Ensure strictly increasing client_ts_ms
    const clientTsMs = Math.max(Date.now(), lastClientTs.current + 1);
    lastClientTs.current = clientTsMs;

    // Submit evidence — metadata only, NO image (per guide §4.2).
    // submittingRef stays held until the NEXT step's beginStep() releases it.
    // Releasing it in `finally` opens a window where samples still hit the
    // pre-advance closure (old step index, detector refs still "hot") and
    // resubmit evidence for the completed step → SEQUENCE_VIOLATION.
    submittingRef.current = true;
    try {
      console.log(`[Liveness] Submitting evidence for step ${liveness.currentStepIndex}: ${action}`);
      await liveness.submitEvidence(durationMs, clientTsMs);
      console.log('[Liveness] Evidence accepted');
    } catch (err: any) {
      console.error('[Liveness] Evidence submit failed:', err?.message, JSON.stringify(err?.response?.data));
      console.error('[Liveness] Sent request was:', JSON.stringify({
        url: err?.config?.url,
        method: err?.config?.method,
        data: err?.config?.data,
        contentType: err?.config?.headers?.['Content-Type'] ?? err?.config?.headers?.get?.('Content-Type'),
      }));
      // Fail in place — leaves 'challenging' so the frame processor stops
      // resubmitting evidence (the old navigation path left the phase
      // unchanged and caused a 429 resubmission storm).
      failWithCooldown(err, 'Liveness step rejected');
    }
  }, [liveness, failWithCooldown]);

  // Create a runOnJS wrapper for the face sample handler.
  // IMPORTANT: runOnJS(fn) binds fn at creation time — passing onFaceSample directly
  // would forever call the FIRST-render closure with stale liveness state
  // (phase 'idle'), so no action would ever be detected. Route through a ref
  // so the wrapper always invokes the latest callback.
  const onFaceSampleRef = useRef(onFaceSample);
  useEffect(() => {
    onFaceSampleRef.current = onFaceSample;
  });
  /* eslint-disable react-hooks/refs -- created once via lazy state init; the
     runOnJS wrapper reads the latest handler through the ref when samples
     arrive (it only runs on face events, never during render). */
  const [onFaceSampleJS] = useState(() =>
    runOnJS((leftEyeOpen: number, rightEyeOpen: number, yaw: number) => {
      onFaceSampleRef.current(leftEyeOpen, rightEyeOpen, yaw);
    }),
  );
  // Regula's photo frames go the same way (onCaptureFrames, below).
  const onCaptureFramesRef = useRef<(samples: FaceSample[]) => void>(() => {});
  const [onCaptureFramesJS] = useState(() =>
    runOnJS((samples: FaceSample[]) => {
      onCaptureFramesRef.current(samples);
    }),
  );
  /* eslint-enable react-hooks/refs */

  // Face detection via a dedicated CameraOutput (NOT a frame processor).
  // The library manages its own YUV output stream so ML Kit always gets a
  // supported frame format — the useFrameOutput + detectFaces(frame) path
  // crashes on Android with "Only JPEG and YUV_420_888 are supported now"
  // because frame output buffers are RGBA.
  // The handler only touches refs + the stable runOnJS wrapper, so a plain
  // useCallback stays current — the memoized output can call it directly.
  const handleFaces = useCallback((faces: Face[]) => {
    setMultiFace(faces.length > 1);
    // Regula's photo: every frame counts, one without a face too (it cancels
    // the hold). ~10 frames a second.
    if (phaseRef.current === 'capturing') {
      const now = Date.now();
      if (now - lastSampleTs.current < 100) return;
      lastSampleTs.current = now;
      onCaptureFramesJS(faces.map(toSample));
      return;
    }
    const face = faces[0];
    // Ambiguous frame - don't let a second person satisfy the challenge.
    if (!face || faces.length > 1) {
      steadyRef.current = { count: 0, lastYaw: null };
      return;
    }

    // Throttle: ~10 samples/sec
    const now = Date.now();
    if (now - lastSampleTs.current < 100) return;
    lastSampleTs.current = now;

    const leftEye = face.leftEyeOpenProbability ?? 1;
    const rightEye = face.rightEyeOpenProbability ?? 1;
    // Android hands ML Kit the unmirrored sensor image; on iOS the library
    // tells ML Kit the front-camera frame is mirrored (`.leftMirrored`), which
    // flips the yaw sign — a "turn left" there only passed when turning right.
    // Normalize to the Android convention: positive = the subject's left.
    const rawYaw = face.yawAngle ?? 0;
    const yaw = Platform.OS === 'ios' && cameraPosition === 'front' ? -rawYaw : rawYaw;
    console.log(
      `[Liveness] Sample: leftEye=${leftEye.toFixed(2)} rightEye=${rightEye.toFixed(2)} yaw=${yaw.toFixed(1)}°` +
        (yaw !== rawYaw ? ` (raw ${rawYaw.toFixed(1)}°, ${Platform.OS} ${cameraPosition})` : ''),
    );

    const steady = steadyRef.current;
    const good =
      Math.abs(yaw) <= FRONTAL_YAW &&
      leftEye >= BLINK_OPEN_THRESHOLD &&
      rightEye >= BLINK_OPEN_THRESHOLD &&
      (steady.lastYaw === null || Math.abs(yaw - steady.lastYaw) <= STILL_YAW_DELTA);
    steadyRef.current = { count: good ? steady.count + 1 : 0, lastYaw: yaw };

    onFaceSampleJS(leftEye, rightEye, yaw);
  }, [onFaceSampleJS, onCaptureFramesJS, cameraPosition]);

  /* eslint-disable react-hooks/refs -- the output is created once for the
     Camera's outputs prop; its callbacks run on native face events and read
     the throttle/sample refs only then, never during render. */
  const faceDetectorOutput = useMemo(
    () =>
      createFaceDetectorOutput({
        // Which camera is live: on iOS it picks the frame orientation (front
        // = mirrored) ML Kit reads angles from. It defaulted to front even
        // when an under-10 member switched to the back camera.
        cameraFacing: cameraPosition,
        performanceMode: 'fast',
        runClassifications: true,
        runLandmarks: false,
        onFacesDetected: handleFaces,
        onError: (error) => {
          console.warn('Face detection error:', error.message);
        },
      }),
    [handleFaces, cameraPosition],
  );
  /* eslint-enable react-hooks/refs */

  // Capture the challenge's finalize frame (the ML Kit fallback only;
  // Regula's photo is takeCapturePhoto).
  const captureAndFinalize = useCallback(async () => {
    if (capturing || liveness.phase !== 'finalizing') return;
    setCapturing(true);
    console.log('[Liveness] captureAndFinalize: starting photo capture...');

    try {
      // Use capturePhotoToFile to get a file path, then read as base64
      const photoFile = await photoOutput.capturePhotoToFile(
        { flashMode: 'off' },
        {},
      );

      if (!photoFile) {
        console.error('[Liveness] capturePhotoToFile returned null');
        failWithCooldown(new Error('Failed to capture photo'), 'Failed to capture photo');
        return;
      }
      console.log('[Liveness] Photo captured:', photoFile.filePath);

      // Send the captured file straight into multipart FormData - no base64
      // round-trip (a high-res frame as a base64 string spikes memory).
      const rawUri = photoFile.filePath.startsWith('file://')
        ? photoFile.filePath
        : `file://${photoFile.filePath}`;
      // This frame becomes the enrolled face that documents are matched
      // against: send it upright, and log exactly what goes up (frame.ts).
      const frame = await uprightFrame(rawUri);
      console.log(
        '[FaceCapture] frame',
        frame.before,
        frame.after ? `→ ${frame.after}` : '',
        `(${frame.note})`,
        `camera=${cameraPosition} mode=${mode}${personId ? ' member' : ''}`,
      );
      const fileUri = frame.uri;
      capturedUri.current = fileUri;

      console.log('[Liveness] Calling finalize API...');
      const result = await liveness.finalize(fileUri);
      console.log('[Liveness] Finalize result:', JSON.stringify(result));

      if (result.status !== 'passed') {
        console.error('[Liveness] Finalize not passed:', result.status, result.message);
        // finalize() already flipped the phase to 'failed' — just set the
        // retry cooldown and stay in place (no navigation).
        setCooldownLeft(3);
        return;
      }

      // Passed — the dedicated "Liveness verified" screen offers the enroll
      // button; enrollment runs on tap via enrollFaceNow (result is a
      // one-time credential consumed by face enrollment).
    } catch (err: any) {
      console.error('[Liveness] captureAndFinalize ERROR:', err?.message, err?.response?.data ? JSON.stringify(err.response.data) : '', err?.stack);
      failWithCooldown(err, 'Face enrollment failed');
    } finally {
      setCapturing(false);
    }
  }, [capturing, liveness, failWithCooldown, photoOutput, cameraPosition, mode, personId]);

  // Enroll/update the face with the liveness session credentials.
  // Per guide §5.2: send only livenessSessionId + sessionToken + personId.
  // If enrollment fails the liveness result is already consumed — start a
  // NEW challenge (reset → idle → auto-creates a fresh session).
  const enrollFaceNow = useCallback(async () => {
    if (enrolling || liveness.phase !== 'passed' || !liveness.result) return;
    if (mode === 'verify') {
      // Nothing is enrolled: the screen sends the capture with its request.
      const capture = { livenessSessionId: liveness.result.session_id, sessionToken: liveness.sessionToken ?? '' };
      await settleCameraThen(() => onVerified?.(capture));
      return;
    }
    setEnrolling(true);
    console.log('[Liveness] Enrolling face, mode:', mode, 'personId:', personId);
    try {
      const facePayload = {
        livenessSessionId: liveness.result.session_id,
        sessionToken: liveness.sessionToken ?? '',
        personId,
      };
      if (mode === 'enroll') {
        await enrollFace.mutateAsync(facePayload);
        if (!personId) {
          // Don't flip faceEnrolled yet — face-enrolled must actually render
          // (the onboarding layout redirects the moment it goes true) and the
          // flag proves the success screen followed a real enrollment.
          flowGuards.grant('onboarding:face-enrolled');
        } else if (capturedUri.current) {
          await rememberMemberPhoto(personId, capturedUri.current);
        }
      } else {
        // PIN token expired while the challenge ran or the result sat on
        // screen: ask for the PIN again rather than send a doomed PUT /face.
        if (reauthGated && !hasReauthToken()) {
          await settleCameraThen(() => onReauthRequired?.('expired'));
          return;
        }
        await updateFace.mutateAsync(facePayload);
        // A successful update resets the server's failed-attempt count.
        if (faceLimitKey) clearCooldown(faceLimitKey);
        // Family member face update: the new frame replaces their avatar too.
        if (personId && capturedUri.current) {
          await rememberMemberPhoto(personId, capturedUri.current);
        }
      }
      refreshAfterFaceChange();
      console.log('[Liveness] Face enrollment SUCCESS');
      await settleCameraThen(onSuccess);
    } catch (err: any) {
      console.error('[Liveness] Face enrollment failed:', err?.message);
      const apiErr = toApiError(err);
      if (mode === 'update') {
        // 403 REAUTH_REQUIRED (no, expired or used PIN token): straight back
        // to the PIN step with a short explanation, not a generic failure.
        if (reauthGated && apiErr.code === 'REAUTH_REQUIRED') {
          await settleCameraThen(() => onReauthRequired?.('expired'));
          return;
        }
        // 403 FACE_MISMATCH / 422 FACE_NOT_DETECTED (and any other failure)
        // used up both the PIN token and the liveness session: a retry needs
        // the PIN again and a new capture.
        setPinSpent(true);
        if (apiErr.serverCode === 'FACE_UPDATE_LIMIT_REACHED') {
          // Remembered so the PIN step stays closed until the wait is over.
          if (faceLimitKey) setCooldown(faceLimitKey, apiErr.retryAfterSeconds ?? 24 * 3600);
          setDeadEnd(true);
        }
      } else if (apiErr.serverCode === 'FACE_ALREADY_ENROLLED') {
        // Someone (another device, an earlier try) already enrolled this
        // face — refresh so the app shows Update face from now on.
        refreshAfterFaceChange();
        setDeadEnd(true);
      }
      // The liveness session is single-use — consumed whether enroll
      // succeeded or not — so the failed screen's Try Again starts a NEW
      // challenge rather than retrying a dead credential.
      failWithCooldown(err, 'Face enrollment failed');
    } finally {
      setEnrolling(false);
    }
  }, [
    enrolling,
    liveness,
    mode,
    personId,
    enrollFace,
    updateFace,
    rememberMemberPhoto,
    refreshAfterFaceChange,
    onSuccess,
    onVerified,
    onReauthRequired,
    reauthGated,
    settleCameraThen,
    failWithCooldown,
    faceLimitKey,
  ]);

  // Verify mode saves nothing here, so there is nothing to confirm: a passed
  // capture goes straight back to the screen (once).
  const verifiedSent = useRef(false);
  useEffect(() => {
    if (mode !== 'verify' || liveness.phase !== 'passed' || !liveness.result || verifiedSent.current) return;
    verifiedSent.current = true;
    void enrollFaceNow();
  }, [mode, liveness.phase, liveness.result, enrollFaceNow]);

  // Finalizing starts right after the last step — often a head turn — so the
  // steadiness count starts over from here. Regula's photo starts a fresh
  // stable-face machine, with the time allowed counted from now.
  useEffect(() => {
    phaseRef.current = liveness.phase;
    if (liveness.phase === 'finalizing') {
      steadyRef.current = { count: 0, lastYaw: null };
      finalizeStartedAt.current = Date.now();
      finalizeTriggered.current = false;
    }
    if (liveness.phase === 'capturing') {
      const now = Date.now();
      captureRef.current = createStableFaceCapture(rules, { timeoutMs: CAPTURE_TIMEOUT_MS, startedAt: now });
      captureStartedAt.current = now;
      refusedPhotos.current = 0;
      takingPhoto.current = false;
      regulaStarted.current = false;
      queueMicrotask(() => {
        setCaptureView({ status: 'searching' });
        setCaptureNotice(null);
        setCaptureElapsed(0);
        setRegulaDone(false);
        // A retry after Regula ran: its screen had this camera released.
        setCameraActive(true);
      });
    }
  }, [liveness.phase, rules]);

  // Auto-finalize the challenge once the face is frontal and still
  // (STEADY_SAMPLES): a frame taken while the head swings back from the turn
  // makes a blurred, angled enrolled face, and documents score low against it.
  useEffect(() => {
    if (liveness.phase !== 'finalizing' || capturing) return;
    const timer = setInterval(() => {
      if (finalizeTriggered.current) return;
      const since = finalizeStartedAt.current;
      if (!since) return;
      const waited = Date.now() - since;
      const steady = steadyRef.current.count >= STEADY_SAMPLES;
      if (!steady && waited < STEADY_MAX_WAIT_MS) return;
      finalizeTriggered.current = true;
      clearInterval(timer);
      console.log(
        '[FaceCapture]',
        steady ? `face steady after ${waited}ms` : `face not steady after ${waited}ms, capturing anyway`,
      );
      captureAndFinalize();
    }, 100);
    return () => clearInterval(timer);
  }, [liveness.phase, capturing, captureAndFinalize]);

  // ── Regula's face photo ──────────────────────────────────────────────
  // A photo the phone refused (no usable face, or the camera failed to take
  // it): say why and look again, up to MAX_REFUSED_PHOTOS. Nothing is sent.
  const refusePhoto = useCallback((message: string) => {
    refusedPhotos.current += 1;
    if (refusedPhotos.current >= MAX_REFUSED_PHOTOS) {
      failSession(CAPTURE_COPY.refused, 'error');
      return;
    }
    setCaptureNotice(message);
    setCaptureView({ status: 'searching' });
    captureRef.current?.resume();
  }, [failSession]);

  // Take the photo once the face has held still, check it on the phone, and
  // only then upload it; Regula runs next (phase checking). takingPhoto keeps
  // it to one photo at a time.
  const { submitCapture } = liveness;
  const takeCapturePhoto = useCallback(async () => {
    if (takingPhoto.current || phaseRef.current !== 'capturing') return;
    takingPhoto.current = true;
    setCapturing(true);
    try {
      let fileUri: string;
      try {
        const photoFile = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
        if (!photoFile) throw new Error('The camera returned no photo');
        const rawUri = photoFile.filePath.startsWith('file://') ? photoFile.filePath : `file://${photoFile.filePath}`;
        // This frame becomes the enrolled face that documents are matched
        // against: send it upright, and log exactly what goes up (frame.ts).
        const frame = await uprightFrame(rawUri);
        console.log(
          '[FaceCapture] frame',
          frame.before,
          frame.after ? `→ ${frame.after}` : '',
          `(${frame.note})`,
          `camera=${cameraPosition} mode=${mode} subject=${subject}`,
        );
        const problem = stillPhotoProblem(stillDetector, frame.uri, rules);
        if (problem) {
          console.warn('[FaceCapture] photo refused on the phone:', problem);
          refusePhoto(problemMessage(problem, subject));
          return;
        }
        fileUri = frame.uri;
      } catch (err) {
        console.warn('[FaceCapture] photo not taken:', errorDetail(err));
        refusePhoto(CAPTURE_COPY.captureFailed);
        return;
      }
      capturedUri.current = fileUri;
      // Regula decides only liveness: this captured image is what a passed
      // session hands on to enrollment.
      console.log('[Liveness] Uploading the face image before Regula liveness...');
      await submitCapture(fileUri);
    } catch (err) {
      console.error('[Liveness] Face image upload failed:', toApiError(err).status);
      failWithCooldown(err, 'The face photo could not be sent');
    } finally {
      takingPhoto.current = false;
      setCapturing(false);
    }
  }, [photoOutput, cameraPosition, mode, subject, stillDetector, rules, refusePhoto, submitCapture, failWithCooldown]);

  // One preview frame's faces: the hold counts on, or starts over.
  const onCaptureFrames = useCallback((samples: FaceSample[]) => {
    const machine = captureRef.current;
    if (!machine || phaseRef.current !== 'capturing') return;
    const state = machine.update(samples, Date.now());
    if (state.status === 'timed_out') {
      failSession(CAPTURE_COPY.timeout, 'timeout');
      return;
    }
    if (state.status === 'captured') return;
    setCaptureView(state);
    if (state.status === 'holding' || state.status === 'capture') setCaptureNotice(null);
    if (state.status === 'capture') void takeCapturePhoto();
  }, [failSession, takeCapturePhoto]);
  useEffect(() => {
    onCaptureFramesRef.current = onCaptureFrames;
  });

  // Once a second: the time spent (for the tip), and the time allowed even
  // when the detector reports nothing at all.
  useEffect(() => {
    if (liveness.phase !== 'capturing') return;
    const t = setInterval(() => {
      const now = Date.now();
      setCaptureElapsed(now - captureStartedAt.current);
      if (!takingPhoto.current && captureRef.current?.tick(now)?.status === 'timed_out') {
        failSession(CAPTURE_COPY.timeout, 'timeout');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [liveness.phase, failSession]);

  // A refused photo's reason shows for a moment, then the live hints again.
  useEffect(() => {
    if (!captureNotice) return;
    const t = setTimeout(() => setCaptureNotice(null), 3000);
    return () => clearTimeout(t);
  }, [captureNotice]);

  // Regula liveness, once the face image is up: Regula opens its own camera
  // screen, so this camera is released first. Only the transactionId goes to
  // the server, which decides; a cancel or failure shows the retry UI.
  const { checkLiveness } = liveness;
  useEffect(() => {
    if (liveness.phase !== 'checking' || regulaStarted.current) return;
    regulaStarted.current = true;
    const run = async (config: RegulaRunConfig) => {
      const outcome = await runRegulaLiveness(config, appearance);
      // Regula's screen is closed: the server reads the verdict now.
      setRegulaDone(true);
      return outcome;
    };
    void (async () => {
      await Promise.resolve();
      setCameraActive(false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await checkLiveness(run);
      } catch (err: any) {
        console.error('[Liveness] Regula liveness not verified:', err?.response?.status, err?.response?.data?.code);
        failWithCooldown(err, 'Liveness could not be verified');
      }
    })();
  }, [liveness.phase, checkLiveness, failWithCooldown, appearance]);

  // ── UI animation hooks (MUST be before any early return) ──────────────
  // Session countdown — expires_in_seconds is a snapshot at challenge
  // creation; tick it down locally so the expiring-session warning is real.
  const [sessionLeft, setSessionLeft] = useState<number | null>(null);
  const { sessionId, expiresInSeconds } = liveness;
  useEffect(() => {
    const total = expiresInSeconds;
    if (total == null) return;
    // Seed on a microtask — synchronous setState inside an effect body is not
    // allowed (react-hooks/set-state-in-effect).
    queueMicrotask(() => setSessionLeft(total));
    const t = setInterval(() => setSessionLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [sessionId, expiresInSeconds]);

  // Proactively fail an expired session — otherwise the user keeps doing
  // steps and the next evidence submit dies with a cryptic server error.
  useEffect(() => {
    if (sessionLeft === 0 && (liveness.phase === 'challenging' || liveness.phase === 'capturing')) {
      // queueMicrotask: a synchronous setState inside the effect body trips
      // react-hooks/set-state-in-effect (same pattern as the seed above).
      queueMicrotask(() => failSession('Your session expired — please try again.', 'timeout'));
    }
  }, [sessionLeft, liveness.phase, failSession]);

  // Per-step progress drain (design-repo `capture` anim): the track fill
  // sweeps from step→step+1 over the server's max step time. Lazy useState
  // init — a ref read during render trips react-hooks/refs.
  const [capture] = useState(() => new Animated.Value(0));
  const stepMs = (liveness.challenge?.step_time_limits.max_ms ?? 6000) + STEP_GRACE_MS;
  useEffect(() => {
    if (liveness.phase !== 'challenging') return;
    capture.setValue(0);
    Animated.timing(capture, {
      toValue: 1,
      duration: stepMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false, // width isn't a native-driver property
    }).start();
    tapHaptic();
  }, [liveness.phase, liveness.currentStepIndex, capture, stepMs]);

  // Tactile payoff — the verification moment deserves a felt confirmation
  // (design-repo VerifyResultScreen).
  useEffect(() => {
    if (liveness.phase === 'passed') successHaptic();
    else if (liveness.phase === 'failed') errorHaptic();
  }, [liveness.phase]);

  // A member under 5: photo enrollment, never liveness — nothing was started.
  if (photoOnly) {
    return (
      <NoticeStage
        title="Photo"
        accent="enrollment"
        sub="Children under 5 enroll with one clear photo instead of a liveness check. Go back and choose Take photo."
        onBack={() => router.back()}
      />
    );
  }

  // Permission not granted (revoked after the route's own gate): the same
  // premium permission step, with its Open Settings once denied.
  if (!hasPermission) {
    return <CameraPermissionGate>{null}</CameraPermissionGate>;
  }

  // No camera device yet, or none after a few seconds.
  if (!device) {
    return <CameraStateStage state={deviceTimedOut ? 'unavailable' : 'loading'} onBack={() => router.back()} />;
  }

  // Shared camera element — mounted inside the ScanFrame square while
  // challenging (the user sees their own face in the frame) and kept off-screen
  // during finalizing/passed so capturePhotoToFile still has a live camera.
  // A camera that stops with an error while it's needed fails the session
  // with advice rather than freezing on a black preview.
  const cameraView = (
    <Camera
      ref={cameraRef}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={cameraActive}
      outputs={[photoOutput, faceDetectorOutput]}
      mirrorMode="auto"
      resizeMode="cover"
      implementationMode="compatible"
      onError={(error: Error) => {
        console.warn('[FaceCapture] camera error:', errorDetail(error));
        if (phaseRef.current === 'capturing' || phaseRef.current === 'challenging') {
          failSession(CAPTURE_COPY.cameraFailed, 'error');
        }
      }}
    />
  );

  // Error state — friendly message (from toApiError) + retry cooldown so a
  // 429 isn't hammered (each immediate retry burns more rate-limit quota).
  // Update mode after a failed PUT /face: the PIN token is used up, so the
  // retry goes through the PIN step (no camera is mounted on this stage).
  if (liveness.phase === 'failed') {
    const needsPin = reauthGated && pinSpent;
    return (
      <LivenessResultStage
        outcome="failed"
        error={liveness.error}
        failure={liveness.failure}
        primaryLabel={
          deadEnd ? 'Done' : needsPin ? 'Enter PIN again' : cooldownLeft > 0 ? `Try again in ${cooldownLeft}s` : 'Try again'
        }
        primaryDisabled={!deadEnd && !needsPin && cooldownLeft > 0}
        onPrimary={() => (deadEnd ? router.back() : needsPin ? onReauthRequired?.('retry') : liveness.reset())}
        onBack={() => router.back()}
      />
    );
  }

  const sessionExpiring = sessionLeft != null && sessionLeft > 0 && sessionLeft <= 60;

  // Regula's `checking`: step 2 of the same studio — Regula's own screen
  // opens over it, then the server reads the verdict. The camera stays
  // mounted off-screen (released while Regula has the camera).
  if (liveness.phase === 'checking') {
    return <HandoffStage phase={regulaDone ? 'verifying' : 'opening'} child={subject === 'child'} cameraSlot={cameraView} />;
  }

  // Regula's photo (step 1): the live camera in the ring until one face has
  // held still for a second, then the photo is taken and checked.
  if (liveness.phase === 'capturing') {
    const holding = captureView.status === 'holding';
    const checking = capturing || captureView.status === 'capture' || captureView.status === 'captured';
    return (
      <CaptureStage
        instruction={CAPTURE_COPY.instruction}
        message={checking ? CAPTURE_COPY.checking : captureNotice ?? captureMessage(captureView, subject)}
        guidance={captureGuidance(subject, captureElapsed)}
        holding={holding}
        progress={holding ? captureView.progress : 0}
        checking={checking}
        expiresIn={sessionLeft ?? expiresInSeconds ?? undefined}
        sessionExpiring={sessionExpiring}
        camera={cameraView}
        allowBackCamera={allowBackCamera}
        cameraPosition={cameraPosition}
        onSwitchCamera={() => setCameraPosition((p) => (p === 'front' ? 'back' : 'front'))}
      />
    );
  }

  const isFinalizing = liveness.phase === 'finalizing' || (mode === 'verify' && liveness.phase === 'passed');

  // Finalize — high-res frame upload + anti-spoof checks. The Camera stays
  // mounted off-screen: photoOutput.capturePhotoToFile still needs it.
  // Design-repo LivenessScreen "finishing" phase.
  if (isFinalizing) {
    return <FinishingStage cameraSlot={cameraView} />;
  }

  // Passed — one-time liveness result; user confirms face enrollment.
  // Camera stays mounted off-screen so settleCameraThen can stop it cleanly.
  // Design-repo VerifyResultScreen "passed" outcome.
  if (liveness.phase === 'passed' && liveness.result) {
    return (
      <LivenessResultStage
        outcome="passed"
        personId={personId}
        score={liveness.result.antispoof_score}
        primaryLabel={nextLabel ?? (personId ? 'Done' : 'Continue')}
        primaryLoading={enrolling}
        onPrimary={enrollFaceNow}
        onBack={() => router.back()}
        cameraSlot={cameraView}
      />
    );
  }

  // Challenge stage (design-repo LivenessScreen "challenge" phase): instruction
  // pill, ScanFrame brackets around the LIVE camera square, step label,
  // progress track, numbered step rail, session countdown.
  const steps = liveness.challenge?.challenge_sequence ?? [];
  const labels: Record<string, string> = liveness.challenge?.ui_copy ?? {};
  const currentAction =
    liveness.currentStepIndex < steps.length ? steps[liveness.currentStepIndex] : undefined;
  const instruction =
    liveness.instruction ||
    (currentAction ? labels[currentAction] ?? currentAction.replace(/_/g, ' ') : null) ||
    'Preparing camera…';

  return (
    <ChallengeStage
      instruction={instruction}
      steps={steps}
      stepIndex={liveness.currentStepIndex}
      labels={labels}
      stepProgress={capture}
      expiresIn={sessionLeft ?? expiresInSeconds ?? undefined}
      sessionExpiring={sessionExpiring}
      multiFace={multiFace}
      hint={hint}
      camera={cameraView}
      allowBackCamera={allowBackCamera}
      cameraPosition={cameraPosition}
      onSwitchCamera={() => setCameraPosition((p) => (p === 'front' ? 'back' : 'front'))}
      onRestart={() => liveness.reset()}
    />
  );
}

