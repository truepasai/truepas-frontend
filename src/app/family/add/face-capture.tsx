/** @jsxImportSource react */
/**
 * Family member face — liveness + face enrollment for ages 5+.
 * Shows the checklist intro first, then mounts LivenessCamera with personId
 * (the camera owns its own stages — see AGENTS.md: don't re-mount or wrap
 * the Camera). Members under 10 get the front/back camera toggle (a parent
 * holds the phone while the child faces the rear camera); 10+ stays
 * front-only.
 *
 * Setup (`next=document`): step 2 of 3 of adding a member — the face is
 * enrolled FIRST (POST /face/enroll), then the document step, so photo
 * documents are checked against this face (backend §1.2/§7.1). Without
 * `next` it pops back to the member page.
 *
 * Update mode (`update=1`, from the member page via the PIN screen): same
 * intro with update copy, LivenessCamera runs mode 'update' (PUT /face with
 * personId and the PIN token) and the screen pops back to the member page.
 * Without the PIN flag/token it bounces to /face-update/pin, and comes back
 * there with a reason when the token expires, is refused or gets used up.
 */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, FileText, ListChecks, RefreshCcw, ScanFace, Sun, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/composite/Toast';
import { type ReauthReason, useDiscardNewMemberOnLeave, useMemberFaceUpdateGate } from '@/features/family/hooks';
import { loadLivenessCamera } from '@/features/liveness/cameraModule';
import { FaceRing } from '@/premium/blocks';
import { CameraUnavailableView, GlassPill, GlassRow, NightStage } from '@/premium/flows/family';
import { Button, Row, Txt } from '@/premium/ui';
import { hasReauthToken } from '@/services/reauth';

const LivenessCamera = loadLivenessCamera();

type Item = { icon: LucideIcon; title: string; body: string };

const BASICS: Item[] = [
  { icon: ListChecks, title: 'Follow the prompts', body: 'A few quick movements on camera.' },
  { icon: Sun, title: 'Good light', body: 'Hold still facing the camera.' },
];

const CHECKLIST: Item[] = [
  ...BASICS,
  { icon: CircleCheck, title: 'Automatic enrollment', body: 'The face enrolls as soon as liveness passes.' },
];

const SETUP_CHECKLIST: Item[] = [
  ...BASICS,
  { icon: FileText, title: 'Then a document', body: 'The photo on their ID is checked against this face.' },
];

const UPDATE_CHECKLIST: Item[] = [
  ...BASICS,
  { icon: RefreshCcw, title: 'Replaces the old face', body: 'The new face is saved as soon as liveness passes.' },
];

export default function FamilyFaceCaptureScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { personId, name, age, update, next, fresh } = useLocalSearchParams<{
    personId?: string;
    name?: string;
    age?: string;
    update?: string;
    next?: string;
    fresh?: string;
  }>();
  const isUpdate = update === '1' && !!personId;
  const inSetup = !isUpdate && next === 'document' && !!personId;
  // Just created by Add member: leaving before the face enrolls removes them.
  const fresh1 = inSetup && fresh === '1';
  const discard = useDiscardNewMemberOnLeave(personId, fresh1);
  const pinVerified = useMemberFaceUpdateGate(isUpdate);
  const ageNum = age != null ? Number(age) : NaN;
  const allowBackCamera = Number.isFinite(ageNum) && ageNum < 10;
  const [started, setStarted] = useState(false);

  const pinParams = {
    personId: personId ?? '',
    capture: 'liveness' as const,
    ...(name ? { name } : {}),
    ...(age ? { age } : {}),
  };
  const backToPin = (reason?: ReauthReason) =>
    router.replace({ pathname: '/face-update/pin', params: reason ? { ...pinParams, reason } : pinParams });

  // The member page sits under every entry to this screen — pop back to it.
  const backToMember = (title: string) => {
    if (!personId) {
      router.dismissTo('/(tabs)');
      return;
    }
    toast({ variant: 'success', title });
    router.dismissTo({ pathname: '/family/[id]', params: { id: personId } });
  };

  const onEnrolled = () => {
    if (inSetup) {
      discard.markDone();
      const docParams = { personId: personId!, ...(name ? { name } : {}), ...(age ? { age } : {}) };
      // Face first, document next (step 3 of 3). A member fresh from Add
      // member gets their page underneath now.
      if (fresh1) {
        router.replace({ pathname: '/family/[id]', params: { id: personId! } });
        router.push({ pathname: '/family/add/document', params: docParams });
      } else {
        router.replace({ pathname: '/family/add/document', params: docParams });
      }
      return;
    }
    backToMember('Face enrolled');
  };

  const start = () => {
    // The 5-minute PIN token can run out on this intro — ask again before
    // the challenge rather than after it.
    if (isUpdate && !hasReauthToken()) {
      backToPin('expired');
      return;
    }
    setStarted(true);
  };

  if (isUpdate && !pinVerified) {
    return <Redirect href={{ pathname: '/face-update/pin', params: pinParams }} />;
  }

  if (!started) {
    return (
      <NightStage
        topTitle={isUpdate ? 'Update face' : 'Face enrollment'}
        subtitle={Number.isFinite(ageNum) ? `Age ${ageNum} · liveness` : 'Liveness check'}
        right={
          inSetup ? (
            <Txt v="smallStrong" color="rgba(255,255,255,0.6)">
              2/3
            </Txt>
          ) : undefined
        }
        onBack={() => router.back()}
        step={inSetup ? 2 : undefined}
        total={inSetup ? 3 : undefined}
        title={isUpdate ? (name ? `Update ${name}'s` : 'Update') : name ? `Scan ${name}'s` : 'Liveness'}
        accent={isUpdate || name ? 'face.' : 'check'}
        instruction={
          isUpdate
            ? allowBackCamera
              ? 'A new liveness check replaces the current face. You can hold the phone and use the back camera.'
              : 'A new liveness check on the front camera replaces the current face.'
            : allowBackCamera
              ? 'A short liveness check. You can hold the phone and use the back camera.'
              : 'A short liveness check on the front camera.'
        }
        footer={
          <Button label={isUpdate ? 'Start face update' : 'Start face verification'} icon={ScanFace} onPress={start} />
        }>
        <View style={{ alignItems: 'center' }}>
          <FaceRing dark size={190} mode="idle" photo={false} />
        </View>
        <View
          style={{
            gap: 14,
            padding: 16,
            borderRadius: 22,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
          }}>
          {(isUpdate ? UPDATE_CHECKLIST : inSetup ? SETUP_CHECKLIST : CHECKLIST).map((c) => (
            <GlassRow key={c.title} icon={c.icon} title={c.title} body={c.body} />
          ))}
        </View>
        <Row gap={8} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <GlassPill label="Front camera" active />
          {allowBackCamera && <GlassPill label="Back camera" active />}
        </Row>
      </NightStage>
    );
  }

  if (!LivenessCamera) return <CameraUnavailableView />;

  return (
    <LivenessCamera
      mode={isUpdate ? 'update' : 'enroll'}
      personId={personId}
      allowBackCamera={allowBackCamera}
      nextLabel={inSetup ? 'Continue' : undefined}
      onReauthRequired={isUpdate ? backToPin : undefined}
      onSuccess={isUpdate ? () => backToMember('Face updated') : onEnrolled}
    />
  );
}
