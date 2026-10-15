/**
 * Local device storage for the user's profile picture.
 *
 * The backend profile-picture endpoint (S3-backed) is not available yet, so
 * the picked image is persisted locally and shown instantly. When the backend
 * ships, the upload call takes precedence and this file acts as an offline
 * fallback.
 *
 * Uses the SDK 57 expo-file-system API (Directory / File classes).
 * Stored at: <documentDirectory>/profile-image.jpg
 */
import { Directory, EncodingType, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

const FILE_NAME = 'profile-image.jpg';

// expo-file-system has no web implementation — File/Directory constructors
// throw on web, so every entry point no-ops there.
const NO_FS = Platform.OS === 'web';

function profileFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** Save a picked image locally (accepts a file URI). Returns the local URI. */
export async function saveLocalProfileImage(imageUri: string): Promise<string> {
  if (NO_FS) return imageUri;
  const dir = Paths.document;
  if (!(dir instanceof Directory ? dir.exists : true)) {
    new Directory(dir).create({ idempotent: true });
  }
  const dest = profileFile();
  const src = new File(imageUri);
  if (dest.exists) dest.delete();
  // Copy via base64 round-trip (keeps it simple and consistent with docImageStore).
  const base64 = await src.base64();
  dest.write(base64, { encoding: EncodingType.Base64 });
  return dest.uri;
}

/** Get the locally stored profile image URI, or null. */
export async function getLocalProfileImage(): Promise<string | null> {
  if (NO_FS) return null;
  const file = profileFile();
  return file.exists ? file.uri : null;
}

/** Remove the locally stored profile image. */
export async function clearLocalProfileImage(): Promise<void> {
  if (NO_FS) return;
  const file = profileFile();
  if (file.exists) file.delete();
}

// ── Family member profile pictures ──────────────────────────────────────
// Stored per member: <documentDirectory>/member-<personId>-image.jpg

function memberFile(personId: string): File {
  return new File(Paths.document, `member-${personId}-image.jpg`);
}

/** Save a family member's profile picture locally. Returns the local URI. */
export async function saveMemberProfileImage(personId: string, imageUri: string): Promise<string> {
  if (NO_FS) return imageUri;
  const dir = Paths.document;
  if (!(dir instanceof Directory ? dir.exists : true)) {
    new Directory(dir).create({ idempotent: true });
  }
  const dest = memberFile(personId);
  const src = new File(imageUri);
  if (dest.exists) dest.delete();
  const base64 = await src.base64();
  dest.write(base64, { encoding: EncodingType.Base64 });
  return dest.uri;
}

/**
 * Keep the photo taken at a member's face enrolment as their avatar. The
 * camera frame is full resolution, so it is shrunk to avatar size first
 * (also keeps the base64 copy small). Used until the backend returns a
 * member photo URL.
 */
export async function saveMemberFacePhoto(personId: string, captureUri: string): Promise<string> {
  if (NO_FS) return captureUri;
  const small = await ImageManipulator.manipulateAsync(captureUri, [{ resize: { width: 480 } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return saveMemberProfileImage(personId, small.uri);
}

// A member photo the user chose (camera or gallery) is marked so a later
// face scan doesn't replace it. Holds no image, only the fact; it's kept on
// logout so the choice survives signing back in on this phone.
function pickedMarker(personId: string): File {
  return new File(Paths.document, `member-${personId}-picked`);
}

/** Remember that the user chose this member's photo themselves. */
export async function markMemberPhotoPicked(personId: string): Promise<void> {
  if (NO_FS) return;
  const marker = pickedMarker(personId);
  if (marker.exists) return;
  marker.create();
  marker.write('1');
}

/** True when the member's photo was chosen by the user on this phone. */
export async function isMemberPhotoPicked(personId: string): Promise<boolean> {
  if (NO_FS) return false;
  return pickedMarker(personId).exists;
}

/** Remove a family member's locally stored picture (member removed). */
export async function deleteMemberProfileImage(personId: string): Promise<void> {
  if (NO_FS) return;
  const file = memberFile(personId);
  if (file.exists) file.delete();
  const marker = pickedMarker(personId);
  if (marker.exists) marker.delete();
}

/** Get a family member's locally stored profile picture URI, or null. */
export async function getMemberProfileImage(personId: string): Promise<string | null> {
  if (NO_FS) return null;
  const file = memberFile(personId);
  return file.exists ? file.uri : null;
}

/**
 * Wipe every locally stored profile picture — the account avatar plus all
 * member-<personId>-image.jpg files — on logout/session teardown. Without
 * this the next account on a shared device would see the previous user's
 * photos (the avatar filename is fixed, not user-scoped).
 */
export async function clearAllProfileImages(): Promise<void> {
  if (NO_FS) return;
  await clearLocalProfileImage();
  const entries = new Directory(Paths.document).list();
  for (const entry of entries) {
    if (
      entry instanceof File &&
      entry.name.startsWith('member-') &&
      entry.name.endsWith('-image.jpg')
    ) {
      entry.delete();
    }
  }
}
