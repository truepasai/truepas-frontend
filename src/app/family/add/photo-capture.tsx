/** @jsxImportSource react */
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useMemberFaceUpdateGate } from '@/features/family/hooks';
import { CameraUnavailableView, loadFamilyPhotoCapture } from '@/premium/flows/family';

/** Family member face — photo enrollment for under-5 members (step 2 of 3
 *  when adding a member, `next=document`). The premium camera screen
 *  (src/premium/flows/familyPhotoCapture) is lazy-required: it statically
 *  imports react-native-vision-camera, which throws on builds without
 *  NitroModules. `update=1` (member page → PIN screen) retakes an enrolled
 *  member's photo with PUT /face; without the PIN flag/token it bounces to
 *  /face-update/pin. Leaving this screen never removes a member fresh from
 *  Add member (`fresh=1`): their profile stays, face pending, and a birth
 *  certificate is still possible. The camera's own "Cancel adding" is the
 *  only way that removes them. */
const Photo = loadFamilyPhotoCapture();

export default function FamilyPhotoCaptureScreen() {
  const { personId, name, age, update } = useLocalSearchParams<{
    personId?: string;
    name?: string;
    age?: string;
    update?: string;
  }>();
  const isUpdate = update === '1' && !!personId;
  const pinVerified = useMemberFaceUpdateGate(isUpdate);

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
  return Photo ? <Photo /> : <CameraUnavailableView />;
}
