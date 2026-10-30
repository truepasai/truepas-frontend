/** @jsxImportSource react */
/**
 * Add family — photo enrollment for under-5 members (POST /cb/face/enroll),
 * premium skin. Under-5 members can't run liveness — one clear photo is sent
 * as { selfieBase64, personId } instead of liveness session credentials;
 * either camera may be used (a parent holds the phone for the rear camera).
 *
 * The photo, before anything is sent:
 *  1. prepared on the phone (photoNormalize): a real JPEG — an iPhone
 *     captures HEIC — upright, at most 1600 px, checked byte by byte;
 *  2. checked for one usable face on that same JPEG with ML Kit's still-image
 *     detector (photoQuality). "Save photo" stays disabled until it passes,
 *     with guidance when it doesn't.
 *
 * Sending (photoEnrollment): the member's record is read first (they must
 * have no face yet), then the photo goes up once with its own enrollment
 * reference (enrollmentRef, from the platform's secure UUID). When the answer
 * never comes (timeout, no response, 5xx) nothing is re-sent: the record is
 * read until it shows this attempt's reference (saved — the only case that
 * makes this photo the avatar), a face from any other enrollment (a neutral
 * "a face is now set up"), still no face after the attempt can no longer be
 * activated (send again), or the deadline passes ("Check again"). A 409 is a
 * conflict unless the record shows this attempt's reference.
 *
 * Leaving keeps a new member's profile, face pending: they can add the
 * photo later, or a birth certificate (which needs no face) — "Continue
 * without photo" goes straight there. Only "Cancel adding", confirmed, and
 * never while a photo may still be stored, removes the new member.
 *
 * Statically imports react-native-vision-camera — NEVER import this file from
 * a route. Load it through loadFamilyPhotoCapture() (./family), which falls
 * back to <CameraUnavailableView /> on builds without NitroModules.
 *
 * Setup (`next=document`): step 2 of 3 of adding a member — face first, then
 * the document step (backend §7.1). Without `next` it pops back to the
 * member page.
 *
 * `update=1` (member page → PIN): retakes an enrolled member's photo with
 * PUT /face { personId, selfieBase64 } — that carries the single-use PIN
 * token (X-Reauth-Token, backend §5). An expired/refused token (403
 * REAUTH_REQUIRED) goes straight back to the PIN step; after any other
 * failure the token is used up, so the retry asks for the PIN again. On
 * success it pops back to the member page.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Baby, Camera as CameraIcon, FileText, KeyRound, RefreshCw, RotateCcw, SwitchCamera, UserX } from 'lucide-react-native';
import { uuid } from 'expo-modules-core';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from 'react-native-vision-camera';
import { useImageFaceDetector } from 'react-native-vision-camera-face-detector';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { useEnrollFace, useUpdateFace } from '@/features/auth/mutations';
import {
  type ReauthReason,
  familyKeys,
  useRefreshAfterFaceChange,
  useRememberMemberPhoto,
  useRemoveFamilyMember,
} from '@/features/family/hooks';
import { newEnrollmentRef } from '@/features/family/enrollmentRef';
import {
  type EnrollResult,
  type PhotoStepPhase,
  canCancelNewMember,
  canContinueWithoutPhoto,
  confirmEnrollment,
  enrollOnce,
  isUnclearFailure,
} from '@/features/family/photoEnrollment';
import { PhotoNormalizeError, type NormalizedPhoto } from '@/features/family/photoNormalize';
import { normalizeEnrollmentPhoto } from '@/features/family/photoNormalizeNative';
import { DETECTOR_MIN_FACE, checkPhoto, type PhotoCheck } from '@/features/family/photoQuality';
import { hasReauthToken } from '@/services/reauth';
import type { MemberFaceStatus } from '@/types/domain';

import { FaceRing } from '../blocks';
import { Banner, ConfirmSheet } from '../kit';
import { C } from '../theme';
import { Button, IconCircle, Row } from '../ui';
import { GlassPill, NightStage } from './family';

/** Accurate mode with eye classification; faces under 10% of the width aren't reported. */
const DETECTOR_OPTIONS = { performanceMode: 'accurate', runClassifications: true, minFaceSize: DETECTOR_MIN_FACE } as const;

type Stage =
  | { phase: 'camera' }
  | { phase: 'preparing' }
  | { phase: 'review'; photo: NormalizedPhoto; check: PhotoCheck }
  | { phase: 'sending'; photo: NormalizedPhoto }
  | { phase: 'confirming'; photo: NormalizedPhoto }
  | { phase: 'unknown'; photo: NormalizedPhoto }
  | { phase: 'done' };

type Notice = { tone: 'error' | 'warning' | 'info'; title: string; body: string } | null;
/** A state that only offers one way on: a face already set up, or the member removed. */
type Blocked = { title: string; body: string; action: 'member' | 'family' } | null;

/** A trace id for logs only — the enrollment reference is separate and secure. */
const newRequestId = () => `enroll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The member's face as the server records it; null when they are no longer
 *  in the family. Never answered from mock data (api/fallbackPolicy). */
async function readFaceStatus(personId: string): Promise<MemberFaceStatus | null> {
  try {
    return await api.getFamilyMemberFaceStatus(personId);
  } catch (err) {
    if (toApiError(err).status === 404) return null;
    throw err;
  }
}

/** `onEnrolled`: the photo is saved (callers that track the add flow stand down). */
export function FamilyPhotoCapture({ onEnrolled }: { onEnrolled?: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { name, age, personId, update, next, fresh } = useLocalSearchParams<{
    name?: string;
    age?: string;
    personId?: string;
    update?: string;
    next?: string;
    fresh?: string;
  }>();
  const isUpdate = update === '1' && !!personId;
  const inSetup = !isUpdate && next === 'document' && !!personId;
  // Just created by Add member: their page goes under the document step.
  const fresh1 = inSetup && fresh === '1';
  const first = (name || 'Member').trim().split(' ')[0];
  const { toast } = useToast();

  const { hasPermission, requestPermission } = useCameraPermission();
  // Under-5 photo enrollment allows either camera — a parent can hold the
  // phone and capture the child with the rear camera.
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraPosition);
  // JPEG, not the 'native' default: that is HEIC on iOS, which the backend
  // can't decode ("no face detected").
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg' });
  const cameraRef = useRef<CameraRef>(null);
  const faceDetector = useImageFaceDetector(DETECTOR_OPTIONS);
  const enrollFace = useEnrollFace();
  const updateFace = useUpdateFace();
  const removeMember = useRemoveFamilyMember();
  const rememberMemberPhoto = useRememberMemberPhoto();
  const refreshAfterFaceChange = useRefreshAfterFaceChange();
  const [stage, setStage] = useState<Stage>({ phase: 'camera' });
  const [notice, setNotice] = useState<Notice>(null);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // The attempt sent and not yet settled: its enrollment reference and when it
  // was sent. Only that exact reference on the member's record proves this
  // photo became their face; no new attempt starts while it is unsettled.
  const attempt = useRef<{ ref: string; sentAt: number } | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  // Update: the PIN token went with the failed PUT /face — retry needs a new one.
  const [pinSpent, setPinSpent] = useState(false);
  // Stop the preview and let the native camera settle before leaving —
  // unmounting an ACTIVE Camera on Fabric crashes (see LivenessCamera
  // settleCameraThen).
  const [cameraActive, setCameraActive] = useState(true);
  const settleCameraThen = async (navigate: () => void) => {
    setCameraActive(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    navigate();
  };

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const phase: PhotoStepPhase = stage.phase;
  const show = (nextStage: Stage, nextNotice: Notice = null) => {
    if (!mounted.current) return;
    setStage(nextStage);
    setNotice(nextNotice);
  };

  const goToMemberDetail = () => {
    if (inSetup && personId) {
      const docParams = { personId, ...(name ? { name } : {}), ...(age ? { age } : {}) };
      // Face first, document next (step 3 of 3). A member fresh from Add
      // member gets their page underneath now.
      if (fresh1) {
        router.replace({ pathname: '/family/[id]', params: { id: personId } });
        router.push({ pathname: '/family/add/document', params: docParams });
      } else {
        router.replace({ pathname: '/family/add/document', params: docParams });
      }
    } else if (personId) {
      // The member page sits under every entry to this screen — pop back to it.
      toast({ variant: 'success', title: isUpdate ? 'Face photo updated' : 'Face photo enrolled' });
      router.dismissTo({ pathname: '/family/[id]', params: { id: personId } });
    } else {
      router.dismissTo('/(tabs)');
    }
  };

  /** Setup: on to the document step without the photo — a birth certificate needs no face. */
  const continueWithoutPhoto = () => {
    if (!personId || !canContinueWithoutPhoto(phase)) return;
    const docParams = { personId, ...(name ? { name } : {}), ...(age ? { age } : {}), prefer: 'birthCertificate' };
    void settleCameraThen(() => {
      if (fresh1) {
        router.replace({ pathname: '/family/[id]', params: { id: personId } });
        router.push({ pathname: '/family/add/document', params: docParams });
      } else {
        router.replace({ pathname: '/family/add/document', params: docParams });
      }
    });
  };

  const leave = () => {
    // A new member's profile stays, face pending — say so, since nothing on
    // screen did yet.
    if (fresh1 && phase !== 'done') {
      toast({ variant: 'info', title: `${first}'s profile is saved`, description: 'Add their photo or a birth certificate any time.' });
    }
    void settleCameraThen(router.back);
  };

  /** Deliberate "Cancel adding": remove the new member. A 404 means they are already gone. */
  const cancelAdding = async () => {
    if (!personId || !canCancelNewMember(phase)) return;
    try {
      await removeMember.mutateAsync(personId);
    } catch (err) {
      if (toApiError(err).status !== 404) {
        setConfirmCancel(false);
        toast({ variant: 'error', title: `Couldn't remove ${first}`, description: toApiError(err).message });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: familyKeys.all });
    }
    setConfirmCancel(false);
    void settleCameraThen(router.back);
  };

  /** Update: back to the PIN step (the token expired, was refused or is used up). */
  const backToPin = (reason: ReauthReason) =>
    void settleCameraThen(() =>
      router.replace({
        pathname: '/face-update/pin',
        params: {
          personId: personId ?? '',
          capture: 'photo',
          reason,
          ...(name ? { name } : {}),
          ...(age ? { age } : {}),
        },
      }),
    );

  /** Take the photo, prepare it and check it for one usable face. Nothing is sent. */
  const capture = async () => {
    if (phase !== 'camera') return;
    if (!personId) {
      setNotice({ tone: 'error', title: 'Photo enrollment failed', body: 'Missing family member reference. Please go back and try again.' });
      return;
    }
    // The 5-minute PIN token can run out while the camera is open.
    if (isUpdate && !hasReauthToken()) {
      backToPin(pinSpent ? 'retry' : 'expired');
      return;
    }
    show({ phase: 'preparing' });
    try {
      const photoFile = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
      if (!photoFile) throw new PhotoNormalizeError('unreadable', 'The camera returned no photo. Please take it again.');
      const rawUri = photoFile.filePath.startsWith('file://') ? photoFile.filePath : `file://${photoFile.filePath}`;
      const photo = await normalizeEnrollmentPhoto(rawUri);
      const check = checkPhoto(
        () =>
          faceDetector.detectFaces(photo.uri).map((f) => ({
            bounds: f.bounds,
            yawAngle: f.yawAngle,
            pitchAngle: f.pitchAngle,
            rollAngle: f.rollAngle,
            leftEyeOpenProbability: f.leftEyeOpenProbability,
            rightEyeOpenProbability: f.rightEyeOpenProbability,
            frameWidth: f.frameWidth,
            frameHeight: f.frameHeight,
          })),
        photo,
        name ? first : undefined,
      );
      // Sizes and the check's verdict only — never the image.
      console.log(
        '[FaceCapture] photo',
        photo.label,
        check.ok ? 'face ok' : `face ${check.issue}`,
        `camera=${cameraPosition} mode=${isUpdate ? 'update' : 'enroll'} member`,
      );
      show({ phase: 'review', photo, check });
    } catch (err) {
      const body = err instanceof PhotoNormalizeError ? err.message : 'The photo could not be taken. Please try again.';
      show({ phase: 'camera' }, { tone: 'error', title: 'Take the photo again', body });
    }
  };

  const retake = () => show({ phase: 'camera' });

  const enrolled = async (photo: NormalizedPhoto) => {
    onEnrolled?.();
    show({ phase: 'done' });
    await rememberMemberPhoto(personId!, photo.uri);
    refreshAfterFaceChange();
    // Left while it was saving: the profile updates, but no navigation from a closed screen.
    if (mounted.current) await settleCameraThen(goToMemberDetail);
  };

  /** What an enrolment ended in, as the screen's next state. */
  const settle = async (result: EnrollResult, photo: NormalizedPhoto, check: PhotoCheck) => {
    console.log('[FaceCapture] enrollment', result.state, result.state === 'enrolled' && result.recovered ? '(reference confirmed after no answer)' : '');
    // Every state but "unknown" settles the attempt.
    if (result.state !== 'unknown') attempt.current = null;
    switch (result.state) {
      case 'enrolled':
        // This attempt's own face: the only case that saves this photo as the avatar.
        if (result.recovered) void queryClient.invalidateQueries({ queryKey: ['identity'] });
        await enrolled(photo);
        return;
      case 'enrolled_elsewhere':
        // A face is set up, but not from this photo: say so neutrally, keep
        // this photo off their profile, and show the member as they now are.
        refreshAfterFaceChange();
        show({ phase: 'review', photo, check });
        setBlocked({
          title: `A face is now set up for ${first}`,
          body: "It came from another enrollment, so this phone's photo wasn't used.",
          action: 'member',
        });
        return;
      case 'failed':
        if (result.retake) {
          show({ phase: 'camera' }, { tone: 'error', title: 'Take the photo again', body: result.error.message });
        } else {
          show({ phase: 'review', photo, check }, { tone: 'error', title: 'Photo not saved', body: result.error.message });
        }
        return;
      case 'not_completed':
        show(
          { phase: 'review', photo, check },
          { tone: 'warning', title: 'Photo not saved', body: `${first}'s photo didn't reach their profile. You can send it again.` },
        );
        return;
      case 'unknown':
        show(
          { phase: 'unknown', photo },
          {
            tone: 'warning',
            title: `We couldn't confirm ${first}'s photo was saved`,
            body: `Check again before sending it again. You can also leave — ${first}'s profile stays saved.`,
          },
        );
        return;
      case 'conflict':
        show({ phase: 'review', photo, check });
        setBlocked({ title: `A face is already set up for ${first}`, body: 'To change it, use Update face on their page.', action: 'member' });
        return;
      case 'member_gone':
        show({ phase: 'review', photo, check });
        setBlocked({ title: `${first} is no longer on your account`, body: 'Nothing was saved.', action: 'family' });
        return;
    }
  };

  const save = async () => {
    if (stage.phase !== 'review' || !stage.check.ok || !personId) return;
    const { photo, check } = stage;
    if (isUpdate) {
      // PUT /face with the PIN token — not a second POST /face/enroll.
      if (!hasReauthToken()) {
        backToPin(pinSpent ? 'retry' : 'expired');
        return;
      }
      show({ phase: 'sending', photo });
      try {
        await updateFace.mutateAsync({ personId, selfieBase64: photo.base64 });
        await enrolled(photo);
      } catch (err) {
        const apiErr = toApiError(err);
        if (apiErr.code === 'REAUTH_REQUIRED') {
          backToPin('expired');
          return;
        }
        // A sent PUT /face used the single-use token up, whatever the outcome.
        setPinSpent(true);
        show({ phase: 'review', photo, check }, { tone: 'error', title: 'Photo update failed', body: apiErr.message || 'Could not save the photo. Please try again.' });
      }
      return;
    }

    // An earlier attempt not yet settled may still become the face: no second one.
    if (attempt.current) return;
    let ref: string;
    try {
      ref = newEnrollmentRef(uuid.v4);
    } catch {
      show(
        { phase: 'review', photo, check },
        { tone: 'error', title: 'Photo not sent', body: "This version of the app can't start a face enrollment safely. Update the app and try again." },
      );
      return;
    }
    show({ phase: 'sending', photo });
    const requestId = newRequestId();
    const result = await enrollOnce(
      {
        readStatus: () => readFaceStatus(personId),
        submit: async () => {
          attempt.current = { ref, sentAt: Date.now() };
          try {
            await enrollFace.mutateAsync({ selfieBase64: photo.base64, personId, enrollmentRef: ref, requestId });
          } catch (err) {
            // No answer: the record is read next, and nothing is sent again meanwhile.
            if (mounted.current && isUnclearFailure(toApiError(err))) setStage({ phase: 'confirming', photo });
            throw err;
          }
        },
        sleep,
        now: Date.now,
        toError: (err) => toApiError(err),
      },
      { ref },
    );
    console.log('[FaceCapture] enrollment trace', requestId);
    await settle(result, photo, check);
  };

  /** "Check again" after an unknown result: reads the record for this
   *  attempt's reference for a few more seconds; never sends anything. */
  const checkAgain = async () => {
    if (stage.phase !== 'unknown' || !personId || !attempt.current) return;
    const { photo } = stage;
    const { ref, sentAt } = attempt.current;
    show({ phase: 'confirming', photo });
    const result = await confirmEnrollment(
      { readStatus: () => readFaceStatus(personId), sleep, now: Date.now },
      { ref, sentAt, deadlineMs: Date.now() - sentAt + 10_000 },
    );
    await settle(result, photo, { ok: true });
  };

  const followBlocked = () => {
    if (!blocked) return;
    void settleCameraThen(() => {
      if (blocked.action === 'member' && personId) {
        router.replace({ pathname: '/family/[id]', params: { id: personId } });
      } else {
        router.replace('/family');
      }
    });
  };

  const stageProps = {
    topTitle: isUpdate ? 'Update face' : 'Face enrollment',
    subtitle: age ? `Age ${age} · photo enrollment` : 'Photo enrollment',
    onBack: leave,
    step: inSetup ? 2 : undefined,
    total: inSetup ? 3 : undefined,
    right:
      phase === 'camera' ? (
        <IconCircle
          icon={SwitchCamera}
          tone="glass"
          label={cameraPosition === 'front' ? 'Switch to back camera' : 'Switch to front camera'}
          onPress={() => setCameraPosition((p) => (p === 'front' ? 'back' : 'front'))}
        />
      ) : undefined,
  };

  if (!hasPermission) {
    return (
      <NightStage
        {...stageProps}
        title="Camera"
        accent="access"
        instruction="Camera permission is required to take the enrollment photo."
        footer={<Button label="Grant permission" onPress={requestPermission} />}
      />
    );
  }

  if (!device) {
    return (
      <NightStage {...stageProps} title="Loading" accent="camera…">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 200 }} accessibilityRole="progressbar" accessibilityLabel="Loading camera">
          <ActivityIndicator size="large" color={C.sky} />
        </View>
      </NightStage>
    );
  }

  const shown = stage.phase === 'review' || stage.phase === 'sending' || stage.phase === 'confirming' || stage.phase === 'unknown' ? stage.photo : null;
  const review = stage.phase === 'review' ? stage : null;
  const busy = phase === 'preparing' || phase === 'sending' || phase === 'confirming' || phase === 'done';

  const primary = blocked ? (
    <Button label={blocked.action === 'member' ? `Go to ${first}'s page` : 'Go to Family'} onPress={followBlocked} />
  ) : isUpdate && pinSpent && phase === 'review' ? (
    <Button label="Enter PIN again" icon={KeyRound} onPress={() => backToPin('retry')} />
  ) : phase === 'unknown' ? (
    <Button label="Check again" icon={RefreshCw} onPress={() => void checkAgain()} />
  ) : phase === 'camera' || phase === 'preparing' ? (
    <Button
      label={phase === 'preparing' ? 'Checking photo…' : 'Take photo'}
      icon={CameraIcon}
      loading={phase === 'preparing'}
      disabled={phase === 'preparing'}
      onPress={() => void capture()}
    />
  ) : (
    <Button
      label={phase === 'confirming' ? 'Checking it was saved…' : 'Save photo'}
      loading={phase === 'sending' || phase === 'confirming' || phase === 'done'}
      // Disabled until this very photo passed the face check.
      disabled={!review?.check.ok}
      onPress={() => void save()}
    />
  );

  return (
    <NightStage
      {...stageProps}
      title={name ? `${first}'s` : 'Face'}
      accent={isUpdate ? 'new photo.' : 'photo.'}
      instruction={
        review && !review.check.ok
          ? undefined
          : isUpdate
            ? 'Take one clear photo. It replaces the current face photo.'
            : inSetup
              ? 'One clear photo of their face — no liveness check under 5. Their document comes next.'
              : 'Members under 5 enroll with one clear photo — no liveness check needed.'
      }
      footer={
        <View style={{ gap: 10 }}>
          {primary}
          {!blocked && review ? <Button label="Retake photo" tone="glass" icon={RotateCcw} onPress={retake} /> : null}
          {!blocked && inSetup && canContinueWithoutPhoto(phase) ? (
            <Button label="Continue without photo" tone="glass" icon={FileText} size="md" onPress={continueWithoutPhoto} />
          ) : null}
          {!blocked && fresh1 && canCancelNewMember(phase) ? (
            <Button label={`Cancel adding ${first}`} tone="glass" icon={UserX} size="sm" onPress={() => setConfirmCancel(true)} />
          ) : null}
        </View>
      }>
      <View style={{ alignItems: 'center' }}>
        <FaceRing dark size={250} mode={busy ? 'scan' : 'idle'} progress={0.5}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={cameraActive && (phase === 'camera' || phase === 'preparing')}
            outputs={[photoOutput]}
            mirrorMode="auto"
            resizeMode="cover"
            implementationMode="compatible"
          />
          {shown ? <Image source={{ uri: shown.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`${first}'s photo`} /> : null}
        </FaceRing>
      </View>
      <Row gap={8} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <GlassPill icon={Baby} label="Under 5 · photo" />
        <GlassPill label={cameraPosition === 'front' ? 'Front camera' : 'Back camera'} active />
      </Row>
      {blocked ? <Banner tone="warning" title={blocked.title} body={blocked.body} /> : null}
      {!blocked && review && !review.check.ok ? <Banner tone="warning" title="Retake the photo" body={review.check.guidance} /> : null}
      {!blocked && review?.check.ok && !notice ? <Banner tone="success" title="Face found" body="Save this photo, or retake it." /> : null}
      {!blocked && phase === 'confirming' ? (
        <Banner tone="info" title={`Checking whether ${first}'s photo was saved`} body="The connection dropped before the answer arrived. Nothing is sent again while this runs." />
      ) : null}
      {!blocked && notice && phase !== 'confirming' ? <Banner tone={notice.tone} title={notice.title} body={notice.body} /> : null}
      <ConfirmSheet
        visible={confirmCancel}
        danger
        icon={UserX}
        title={`Cancel adding ${first}?`}
        body={`${first}'s new profile will be removed. You can add them again later.`}
        confirmLabel={`Remove ${first}`}
        cancelLabel="Keep profile"
        loading={removeMember.isPending}
        onConfirm={() => void cancelAdding()}
        onCancel={() => setConfirmCancel(false)}
      />
    </NightStage>
  );
}
