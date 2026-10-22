/** @jsxImportSource react */
/**
 * Add family — photo enrollment for under-5 members (POST /cb/face/enroll),
 * premium skin. Behaviour is a 1:1 port of features/liveness/PhotoCapture:
 * under-5 members can't run liveness — one clear photo is sent as
 * { selfieBase64, personId } instead of liveness session credentials; either
 * camera may be used (a parent holds the phone for the rear camera).
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Baby, Camera as CameraIcon, KeyRound, SwitchCamera } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from 'react-native-vision-camera';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { useEnrollFace, useUpdateFace } from '@/features/auth/mutations';
import {
  type ReauthReason,
  useDiscardNewMemberOnBack,
  useRefreshAfterFaceChange,
  useRememberMemberPhoto,
} from '@/features/family/hooks';
import { uprightFrame } from '@/features/liveness/frame';
import { hasReauthToken } from '@/services/reauth';

import { FaceRing } from '../blocks';
import { Banner } from '../kit';
import { C } from '../theme';
import { Button, IconCircle, Row } from '../ui';
import { GlassPill, NightStage } from './family';

export function FamilyPhotoCapture() {
  const router = useRouter();
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
  // Just created by Add member: backing out removes them again.
  useDiscardNewMemberOnBack(personId, inSetup && fresh === '1');
  const { toast } = useToast();

  const { hasPermission, requestPermission } = useCameraPermission();
  // Under-5 photo enrollment allows either camera — a parent can hold the
  // phone and capture the child with the rear camera.
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraPosition);
  const photoOutput = usePhotoOutput();
  const cameraRef = useRef<CameraRef>(null);
  const enrollFace = useEnrollFace();
  const updateFace = useUpdateFace();
  const rememberMemberPhoto = useRememberMemberPhoto();
  const refreshAfterFaceChange = useRefreshAfterFaceChange();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const goToMemberDetail = () => {
    if (inSetup && personId) {
      // Face first, document next (step 3 of 3).
      router.replace({
        pathname: '/family/add/document',
        params: { personId, ...(name ? { name } : {}), ...(age ? { age } : {}) },
      });
    } else if (personId) {
      // The member page sits under every entry to this screen — pop back to it.
      toast({ variant: 'success', title: isUpdate ? 'Face photo updated' : 'Face photo enrolled' });
      router.dismissTo({ pathname: '/family/[id]', params: { id: personId } });
    } else {
      router.dismissTo('/(tabs)');
    }
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

  const capture = async () => {
    if (capturing) return;
    if (!personId) {
      setError('Missing family member reference. Please go back and try again.');
      return;
    }
    // The 5-minute PIN token can run out while the camera is open.
    if (isUpdate && !hasReauthToken()) {
      backToPin(pinSpent ? 'retry' : 'expired');
      return;
    }
    setCapturing(true);
    setError(null);
    let sentUpdate = false;
    try {
      const photoFile = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
      if (!photoFile) throw new Error('Failed to capture photo');
      const { File } = await import('expo-file-system');
      const rawPath = photoFile.filePath.startsWith('file://') ? photoFile.filePath : `file://${photoFile.filePath}`;
      // This photo becomes the child's enrolled face, which their documents
      // are matched against. CameraX (Android) stores it on its side with an
      // EXIF rotation tag, so send it upright, as liveness does (frame.ts).
      const frame = await uprightFrame(rawPath);
      console.log(
        '[FaceCapture] photo',
        frame.before,
        frame.after ? `→ ${frame.after}` : '',
        `(${frame.note})`,
        `camera=${cameraPosition} mode=${isUpdate ? 'update' : 'enroll'} member`,
      );
      const filePath = frame.uri;
      const selfieBase64 = await new File(filePath).base64();
      if (isUpdate) {
        // PUT /face with the PIN token — not a second POST /face/enroll.
        sentUpdate = true;
        await updateFace.mutateAsync({ personId, selfieBase64 });
      } else {
        await enrollFace.mutateAsync({ selfieBase64, personId });
      }
      await rememberMemberPhoto(personId, filePath);
      refreshAfterFaceChange();
      await settleCameraThen(goToMemberDetail);
    } catch (err) {
      const apiErr = toApiError(err);
      if (isUpdate && apiErr.code === 'REAUTH_REQUIRED') {
        backToPin('expired');
        return;
      }
      // A sent PUT /face used the single-use token up, whatever the outcome.
      if (sentUpdate) setPinSpent(true);
      setError(apiErr.message || 'Could not save the photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const stage = {
    topTitle: isUpdate ? 'Update face' : 'Face enrollment',
    subtitle: age ? `Age ${age} · photo enrollment` : 'Photo enrollment',
    onBack: () => void settleCameraThen(router.back),
    step: inSetup ? 2 : undefined,
    total: inSetup ? 3 : undefined,
    right: (
      <IconCircle
        icon={SwitchCamera}
        tone="glass"
        label={cameraPosition === 'front' ? 'Switch to back camera' : 'Switch to front camera'}
        onPress={() => setCameraPosition((p) => (p === 'front' ? 'back' : 'front'))}
      />
    ),
  };

  if (!hasPermission) {
    return (
      <NightStage
        {...stage}
        title="Camera"
        accent="access"
        instruction="Camera permission is required to take the enrollment photo."
        footer={<Button label="Grant permission" onPress={requestPermission} />}
      />
    );
  }

  if (!device) {
    return (
      <NightStage {...stage} title="Loading" accent="camera…">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 200 }} accessibilityRole="progressbar" accessibilityLabel="Loading camera">
          <ActivityIndicator size="large" color={C.sky} />
        </View>
      </NightStage>
    );
  }

  return (
    <NightStage
      {...stage}
      title={name ? `${name}'s` : 'Face'}
      accent={isUpdate ? 'new photo.' : 'photo.'}
      instruction={
        isUpdate
          ? 'Take one clear photo. It replaces the current face photo.'
          : inSetup
            ? 'One clear photo — no liveness check under 5. Their document comes next.'
            : 'Members under 5 enroll with one clear photo — no liveness check needed.'
      }
      footer={
        isUpdate && pinSpent ? (
          <Button label="Enter PIN again" icon={KeyRound} onPress={() => backToPin('retry')} />
        ) : (
          <Button
            label="Capture photo"
            icon={CameraIcon}
            loading={capturing}
            disabled={capturing}
            onPress={() => void capture()}
          />
        )
      }>
      <View style={{ alignItems: 'center' }}>
        <FaceRing dark size={250} mode={capturing ? 'scan' : 'idle'} progress={0.5}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={cameraActive}
            outputs={[photoOutput]}
            mirrorMode="auto"
            resizeMode="cover"
            implementationMode="compatible"
          />
        </FaceRing>
      </View>
      <Row gap={8} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <GlassPill icon={Baby} label="Under 5 · photo" />
        <GlassPill label={cameraPosition === 'front' ? 'Front camera' : 'Back camera'} active />
      </Row>
      {error ? <Banner tone="error" title={isUpdate ? 'Photo update failed' : 'Photo enrollment failed'} body={error} /> : null}
    </NightStage>
  );
}
