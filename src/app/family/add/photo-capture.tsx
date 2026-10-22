/** @jsxImportSource react */
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useDiscardNewMemberOnLeave, useMemberFaceUpdateGate } from '@/features/family/hooks';
import { CameraUnavailableView, loadFamilyPhotoCapture } from '@/premium/flows/family';

/** Family member face — photo enrollment for under-5 members (step 2 of 3
 *  when adding a member, `next=document`). The premium camera screen
 *  (src/premium/flows/familyPhotoCapture) is lazy-required: it statically
 *  imports react-native-vision-camera, which throws on builds without
 *  NitroModules. `update=1` (member page → PIN screen) retakes an enrolled
 *  member's photo with PUT /face; without the PIN flag/token it bounces to
 *  /face-update/pin. A member fresh from Add member (`fresh=1`) is removed
 *  again if this screen goes before their photo enrolls — the hook sits
 *  here, not in the camera, so it holds when the camera can't load too. */
const Photo = loadFamilyPhotoCapture();

export default function FamilyPhotoCaptureScreen() {
  const { personId, name, age, update, next, fresh } = useLocalSearchParams<{
    personId?: string;
    name?: string;
    age?: string;
    update?: string;
    next?: string;
    fresh?: string;
  }>();
  const isUpdate = update === '1' && !!personId;
  const pinVerified = useMemberFaceUpdateGate(isUpdate);
  const discard = useDiscardNewMemberOnLeave(personId, !isUpdate && next === 'document' && fresh === '1');

  if (isUpdate && !pinVerified) {
    return (
      <Redirect
        href={{
          pathname: '/face-update/pin',
          params: { personId: personId!, capture: 'photo', ...(name ? { name } : {}), ...(age ? { age } : {}) },
        }}
      />
    );
  }
  return Photo ? <Photo onEnrolled={discard.markDone} /> : <CameraUnavailableView />;
}
