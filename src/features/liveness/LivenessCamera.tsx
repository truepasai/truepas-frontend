import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Linking,
    StyleSheet,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    usePhotoOutput,
    type CameraRef,
} from 'react-native-vision-camera';
import {
    createFaceDetectorOutput,
    type Face,
} from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-worklets';

import { toApiError } from '@/api/errors';
import { Alert, ScreenHeader } from '@/components/composite';
import {
    CoreButton,
    Spinner,
    Typography
} from '@/components/ui';
import { useEnrollFace, useUpdateFace } from '@/features/auth/mutations';
import { type ReauthReason, useRefreshAfterFaceChange, useRememberMemberPhoto } from '@/features/family/hooks';
// Premium (TruePas 3.0) stage UIs — same props as LivenessStages; camera stays mounted per AGENTS.md.
import {
  PremiumChallengeStage as ChallengeStage,
  PremiumFinishingStage as FinishingStage,
  PremiumLivenessResultStage as LivenessResultStage,
} from '@/premium/flows/face';
import { uprightFrame } from '@/features/liveness/frame';
import { useLivenessSession } from '@/features/liveness/useLivenessSession';
import { clearCooldown, cooldownKey, setCooldown } from '@/services/cooldowns';
import { flowGuards } from '@/services/flowGuards';
import { hasReauthToken } from '@/services/reauth';
import { useAppSelector } from '@/store';
import { useThemeTokens } from '@/theme';
import { errorHaptic, successHaptic, tapHaptic } from '@/services/haptics';

interface LivenessCameraProps {
  /** "enroll" for first-time enrollment, "update" for face update flow. */
  mode: 'enroll' | 'update';
  /** Family member personId (for family face enrollment). */
  personId?: string;
  /** Called after successful face enrollment/update. */
  onSuccess: () => void;
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

/**
 * Full liveness challenge camera using react-native-vision-camera v5
 * + ML Kit face detector.
 *
 * Flow (per REACT_NATIVE_KYC_INTEGRATION_GUIDE.md §4):
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
  onError,
  allowBackCamera,
  onReauthRequired,
  nextLabel,
}: LivenessCameraProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const theme = useThemeTokens();
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

  // Under-10 members may flip to the rear camera (parent holds the phone);
  // everyone else stays front-only per the age-band spec.
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraPosition);
  const photoOutput = usePhotoOutput();

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
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transient UX hints (too-fast action, multiple faces) shown under the dial
  const [hint, setHint] = useState<string | null>(null);
  const [multiFace, setMultiFace] = useState(false);
  // True once requestPermission() comes back denied - shows a Settings button
  const [permDenied, setPermDenied] = useState(false);
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
    failSession(apiErr.message || fallback);
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
    if (hasPermission && liveness.phase === 'idle') {
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
    const yaw = face.yawAngle ?? 0;
    console.log(`[Liveness] Sample: leftEye=${leftEye.toFixed(2)} rightEye=${rightEye.toFixed(2)} yaw=${yaw.toFixed(1)}°`);

    const steady = steadyRef.current;
    const good =
      Math.abs(yaw) <= FRONTAL_YAW &&
      leftEye >= BLINK_OPEN_THRESHOLD &&
      rightEye >= BLINK_OPEN_THRESHOLD &&
      (steady.lastYaw === null || Math.abs(yaw - steady.lastYaw) <= STILL_YAW_DELTA);
    steadyRef.current = { count: good ? steady.count + 1 : 0, lastYaw: yaw };

    onFaceSampleJS(leftEye, rightEye, yaw);
  }, [onFaceSampleJS]);

  /* eslint-disable react-hooks/refs -- the output is created once for the
     Camera's outputs prop; its callbacks run on native face events and read
     the throttle/sample refs only then, never during render. */
  const faceDetectorOutput = useMemo(
    () =>
      createFaceDetectorOutput({
        performanceMode: 'fast',
        runClassifications: true,
        runLandmarks: false,
        onFacesDetected: handleFaces,
        onError: (error) => {
          console.warn('Face detection error:', error.message);
        },
      }),
    [handleFaces],
  );
  /* eslint-enable react-hooks/refs */

  // Capture high-res photo for finalize
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
    onReauthRequired,
    reauthGated,
    settleCameraThen,
    failWithCooldown,
    faceLimitKey,
  ]);

  // Finalizing starts right after the last step — often a head turn — so the
  // steadiness count starts over from here.
  useEffect(() => {
    if (liveness.phase !== 'finalizing') return;
    steadyRef.current = { count: 0, lastYaw: null };
    finalizeStartedAt.current = Date.now();
    finalizeTriggered.current = false;
  }, [liveness.phase]);

  // Auto-finalize once the face is frontal and still (STEADY_SAMPLES): a
  // frame taken while the head swings back from the turn makes a blurred,
  // angled enrolled face, and documents score low against it.
  useEffect(() => {
    if (liveness.phase !== 'finalizing' || capturing) return;
    const timer = setInterval(() => {
      if (finalizeTriggered.current) return;
      const waited = Date.now() - finalizeStartedAt.current;
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

  // ── UI animation hooks (MUST be before any early return) ──────────────
  // Session countdown — expires_in_seconds is a snapshot at challenge
  // creation; tick it down locally so the expiring-session warning is real.
  const [sessionLeft, setSessionLeft] = useState<number | null>(null);
  const sessionId = liveness.challenge?.session_id;
  useEffect(() => {
    const total = liveness.challenge?.expires_in_seconds;
    if (total == null) return;
    // Seed on a microtask — synchronous setState inside an effect body is not
    // allowed (react-hooks/set-state-in-effect).
    queueMicrotask(() => setSessionLeft(total));
    const t = setInterval(() => setSessionLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [sessionId, liveness.challenge?.expires_in_seconds]);

  // Proactively fail an expired session — otherwise the user keeps doing
  // steps and the next evidence submit dies with a cryptic server error.
  useEffect(() => {
    if (sessionLeft === 0 && liveness.phase === 'challenging') {
      // queueMicrotask: a synchronous setState inside the effect body trips
      // react-hooks/set-state-in-effect (same pattern as the seed above).
      queueMicrotask(() => failSession('Your session expired — please try again.'));
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

  // Permission not granted
  if (!hasPermission) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
          paddingHorizontal: theme.spacing[8],
        }}
        edges={['top', 'bottom']}>
        <Typography variant="body" center style={{ marginBottom: theme.spacing[4] }}>
          Camera permission is required for face verification.
        </Typography>
        <CoreButton
          onPress={async () => {
            const granted = await requestPermission();
            // Permanently denied -> the dialog won't show again; send the
            // user to system settings instead of a dead button.
            if (!granted) setPermDenied(true);
          }}
          accessibilityLabel="Grant camera permission">
          Grant Permission
        </CoreButton>
        {permDenied ? (
          <CoreButton
            variant="outline"
            style={{ marginTop: theme.spacing[3] }}
            onPress={() => void Linking.openSettings()}
            accessibilityLabel="Open app settings">
            Open Settings
          </CoreButton>
        ) : null}
      </SafeAreaView>
    );
  }

  // No camera device
  if (!device) {
    if (deviceTimedOut) {
      return (
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <ScreenHeader title="Face verification" onBack={() => router.back()} />
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: theme.spacing[4],
              gap: theme.spacing[4],
            }}>
            <Alert variant="error" title="Camera unavailable">
              No usable camera was found — it may be busy in another app or unavailable on this device.
            </Alert>
            <CoreButton
              fullWidth
              size="lg"
              accessibilityLabel="Go back"
              onPress={() => router.back()}>
              Go Back
            </CoreButton>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        }}
        edges={['top', 'bottom']}>
        <Spinner size="lg" label="Loading camera" />
        <Typography variant="body-sm" color="secondary" style={{ marginTop: theme.spacing[4] }}>
          Loading camera...
        </Typography>
      </SafeAreaView>
    );
  }

  // Shared camera element — mounted inside the ScanFrame square while
  // challenging (the user sees their own face in the frame) and kept off-screen
  // during finalizing/passed so capturePhotoToFile still has a live camera.
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
        primaryLabel={
          deadEnd ? 'Done' : needsPin ? 'Enter PIN again' : cooldownLeft > 0 ? `Try again in ${cooldownLeft}s` : 'Try again'
        }
        primaryDisabled={!deadEnd && !needsPin && cooldownLeft > 0}
        onPrimary={() => (deadEnd ? router.back() : needsPin ? onReauthRequired?.('retry') : liveness.reset())}
        onBack={() => router.back()}
      />
    );
  }

  const isFinalizing = liveness.phase === 'finalizing';
  const sessionExpiring = sessionLeft != null && sessionLeft > 0 && sessionLeft <= 60;

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
      expiresIn={sessionLeft ?? liveness.challenge?.expires_in_seconds}
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

