/** @jsxImportSource react */
import { Redirect, useRouter } from 'expo-router';
import { ScanFace } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { loadLivenessCamera } from '@/features/liveness/cameraModule';
import { FaceRing } from '@/premium/blocks';
import { CameraUnavailableView, FaceStudio, INTRO_TIPS, PrivacyNote, StudioTips } from '@/premium/flows/face';
import { CameraPermissionGate } from '@/premium/flows/faceCamera';
import { Button, Heading } from '@/premium/ui';
import { useAppSelector } from '@/store';

/** Face scan — mandatory liveness + face enrollment gate (no skip, PRD v2.0).
 *  Shows the "Prove it's really you" prep screen first; "Start verification"
 *  opens the LivenessCamera (server-issued challenges), lazy-required so
 *  builds without NitroModules show a fallback. The premium permission gate
 *  sits in front of it so the camera-permission step matches the studio. */
const LivenessCamera = loadLivenessCamera();

export default function FaceScanScreen() {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  // Liveness only runs after explicit biometric consent — a deep link to this
  // screen must go through the consent step first.
  const biometricConsent = useAppSelector((state) => state.auth.biometricConsent);

  if (!biometricConsent) return <Redirect href="/(onboarding)/consent" />;

  if (!started) {
    return (
      <FaceStudio
        step={2}
        total={3}
        footer={
          <>
            <Button label="Start verification" icon={ScanFace} onPress={() => setStarted(true)} />
            <PrivacyNote dark />
          </>
        }>
        <Heading
          light
          center
          title="Prove it's"
          accent="really you"
          sub="First a quick face photo, then a short liveness check."
        />
        <View style={{ alignItems: 'center' }}>
          <FaceRing dark size={200} mode="idle" photo={false} />
        </View>
        <StudioTips items={INTRO_TIPS} />
      </FaceStudio>
    );
  }

  // Only checked after "Start verification" — without the native camera
  // module (Expo Go) the intro must still render.
  if (!LivenessCamera) return <CameraUnavailableView />;

  return (
    <CameraPermissionGate>
      <LivenessCamera mode="enroll" onSuccess={() => router.replace('/(onboarding)/face-enrolled')} />
    </CameraPermissionGate>
  );
}
