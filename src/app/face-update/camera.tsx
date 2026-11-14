/** @jsxImportSource react */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import type { ReauthReason } from '@/features/family/hooks';
import { loadLivenessCamera } from '@/features/liveness/cameraModule';
import { CameraUnavailableView } from '@/premium/flows/face';
import { CameraPermissionGate } from '@/premium/flows/faceCamera';
import { flowGuards } from '@/services/flowGuards';
import { hasReauthToken } from '@/services/reauth';
import { useAppSelector } from '@/store';

/** Update face — liveness challenge + face update via BFF (PUT /face).
 *  Only reachable right after the PIN screen verified the account PIN — a
 *  deep link here, or one whose single-use PIN token is gone, is bounced back
 *  to the PIN gate. PUT /face carries that token (X-Reauth-Token, 5 min);
 *  when it expires or the server refuses it (403 REAUTH_REQUIRED), or a
 *  failed update used it up, LivenessCamera calls onReauthRequired and this
 *  screen goes back to the PIN step with the reason. `personId` (when
 *  present) targets a family member's face instead of the main user's.
 *  A signed-in user with no face yet ("Set up face ID") gets first-time
 *  enrolment instead (POST /face/enroll, backend §1.1 — no PIN needed). */
const LivenessCamera = loadLivenessCamera();

export default function FaceUpdateCameraScreen() {
  const router = useRouter();
  const { personId, age } = useLocalSearchParams<{ personId?: string; age?: string }>();
  const user = useAppSelector((state) => state.auth.user);
  const [pinVerified] = useState(() => flowGuards.has('face-update:camera') && hasReauthToken());
  const firstEnrolment = !personId && user?.faceEnrolled === false && !user.faceEnrolledAt;

  // Consume on mount — the PIN gate can't be replayed by re-entering.
  useEffect(() => {
    if (pinVerified) flowGuards.consume('face-update:camera');
  }, [pinVerified]);
  // Under-10 family members may use the rear camera here too.
  const ageNum = age != null ? Number(age) : NaN;
  const allowBackCamera = Number.isFinite(ageNum) && ageNum < 10;
  const pinParams = personId ? { personId, ...(age ? { age } : {}) } : {};

  if (!pinVerified) {
    return <Redirect href={{ pathname: '/face-update/pin', params: pinParams }} />;
  }
  if (!LivenessCamera) return <CameraUnavailableView />;

  return (
    <CameraPermissionGate topTitle={firstEnrolment ? 'Set up face' : 'Update face'}>
      <LivenessCamera
        mode={firstEnrolment ? 'enroll' : 'update'}
        personId={personId}
        allowBackCamera={allowBackCamera}
        subjectAge={Number.isFinite(ageNum) ? ageNum : undefined}
        onReauthRequired={(reason: ReauthReason) =>
          router.replace({ pathname: '/face-update/pin', params: { ...pinParams, reason } })
        }
        onSuccess={() => {
          // Self enrolment grants the onboarding success flag — not used here.
          if (firstEnrolment) flowGuards.consume('onboarding:face-enrolled');
          flowGuards.grant('face-update:done');
          router.replace({ pathname: '/face-update/success', params: firstEnrolment ? { enrolled: '1' } : {} });
        }}
      />
    </CameraPermissionGate>
  );
}
