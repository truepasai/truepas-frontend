import { type QueryClient, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { accountKeys } from '@/features/account/hooks';
import { documentKeys } from '@/features/documents/hooks';
import { notificationKeys } from '@/features/notifications/hooks';
import { clearDocumentImages } from '@/services/documentImageStore';
import { flowGuards } from '@/services/flowGuards';
import {
  deleteMemberProfileImage,
  getMemberProfileImage,
  isMemberPhotoPicked,
  markMemberPhotoPicked,
  markMemberPhotoSynced,
  saveMemberFacePhoto,
} from '@/services/profileImageStore';
import { hasReauthToken } from '@/services/reauth';
import { ageFromDob } from '@/utils/age';
import type { AddFamilyMemberRequest, FamilyAgeBand, FamilyMember, IdentityDocument } from '@/types/domain';

export { ADULT_AGE, ageFromDob } from '@/utils/age';

export const familyKeys = {
  all: ['family'] as const,
  detail: (id: string) => ['family', id] as const,
  activity: (id: string) => ['family', id, 'activity'] as const,
};

export function useFamily() {
  return useQuery({ queryKey: familyKeys.all, queryFn: api.getFamily });
}

/** GET /family/{id}. A 4xx is final — 404 = removed from the family — so it
 *  isn't retried and the screen shows "no longer in your family" at once. */
export function useFamilyMember(id?: string) {
  return useQuery({
    queryKey: familyKeys.detail(id ?? ''),
    queryFn: () => api.getFamilyMember(id!),
    enabled: !!id,
    retry: (failureCount, error) => {
      const status = toApiError(error).status;
      // An expired session maps to 401 too. Anything else: the app default, 2 retries.
      return !(status != null && status >= 400 && status < 500) && failureCount < 2;
    },
  });
}

export function useFamilyActivity(id?: string) {
  return useQuery({
    queryKey: familyKeys.activity(id ?? ''),
    queryFn: () => api.getFamilyActivity(id!),
    enabled: !!id,
  });
}

export function useAddFamilyMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddFamilyMemberRequest) => api.addFamilyMember(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyKeys.all });
    },
  });
}

/** PATCH /family/{id}/permissions — notifyOnCheckIn works; independentCheckIn
 *  is stored but not enforced yet (show it as coming soon). */
export function useUpdateFamilyPermissions(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NonNullable<FamilyMember['permissions']>>) => api.updateFamilyPermissions(personId, patch),
    onSuccess: (member) => {
      queryClient.setQueryData(familyKeys.detail(personId), member);
      void queryClient.invalidateQueries({ queryKey: familyKeys.all });
    },
  });
}

/** Relationship tag for a twin — twin children, adult twins or your own twin. */
export const TWIN_RELATIONSHIP = 'Twin';

/** Twins look alike, so the kiosk asks them for their own check-in PIN. */
export function isTwin(m: Pick<FamilyMember, 'relationship' | 'isTwin'> | null | undefined): boolean {
  if (m?.isTwin) return true;
  return m?.relationship?.trim().replace(/\s+/g, ' ').toLowerCase() === TWIN_RELATIONSHIP.toLowerCase();
}

/** PUT /family/{id}/check-in-pin. `replace` sends the holder's PIN token. */
export function useSetFamilyMemberPin(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pin, replace }: { pin: string; replace?: boolean }) => api.setFamilyMemberPin(personId, pin, replace),
    onSuccess: (member) => {
      queryClient.setQueryData(familyKeys.detail(personId), member);
      void queryClient.invalidateQueries({ queryKey: familyKeys.all });
    },
  });
}

/** Ids of a member's documents, read BEFORE the member is removed (their
 *  documents go with them): the cached list the member page loads
 *  (useDocuments(personId)), else GET /documents?personId. Best effort —
 *  [] when neither is available. */
async function memberDocumentIds(queryClient: QueryClient, personId: string): Promise<string[]> {
  try {
    const docs =
      queryClient.getQueryData<IdentityDocument[]>(documentKeys.member(personId)) ?? (await api.getDocuments(personId));
    return Array.isArray(docs) ? docs.map((d) => d.id) : [];
  } catch {
    return [];
  }
}

export function useRemoveFamilyMember() {
  const queryClient = useQueryClient();
  return useMutation({
    // Before the delete: their documents, whose scans may be on this phone.
    onMutate: async (id: string) => ({ documentIds: await memberDocumentIds(queryClient, id) }),
    mutationFn: (id: string) => api.removeFamilyMember(id),
    onSuccess: (_data, id, before) => {
      deleteMemberProfileImage(id).catch(() => {});
      // Their document scans kept on this phone (unencrypted,
      // documentImageStore) go with them. Best effort — never fails the removal.
      for (const docId of before.documentIds) clearDocumentImages(docId).catch(() => {});
      queryClient.removeQueries({ queryKey: memberPhotoKey(id) });
      queryClient.invalidateQueries({ queryKey: familyKeys.all });
    },
  });
}

/**
 * Add member creates the member before their face (POST /family on
 * Continue) and replaces itself with the capture screen. If that screen goes
 * away before the face is enrolled — back button, Android back, swipe or
 * anything else — the member is removed again, so a cancelled add leaves no
 * half-made member. Unmount, not a navigation event, is the trigger: it
 * fires however the screen is left. Call `markDone()` before navigating on
 * after a successful capture. Best effort: a failed delete leaves the member
 * with "Continue setup".
 */
export function useDiscardNewMemberOnLeave(personId: string | undefined, enabled: boolean) {
  const { mutateAsync: removeMember } = useRemoveFamilyMember();
  const done = useRef(false);
  const latest = useRef({ personId, enabled, removeMember });
  useEffect(() => {
    latest.current = { personId, enabled, removeMember };
  });

  useEffect(
    () => () => {
      const { personId: id, enabled: on, removeMember: remove } = latest.current;
      if (!on || !id || done.current) return;
      remove(id).catch((err) => console.warn('[AddMember] could not remove the unfinished member', id, err));
    },
    [],
  );

  return {
    markDone: () => {
      done.current = true;
    },
  };
}

const memberPhotoKey = (personId: string) => ['member-photo', personId] as const;

/**
 * The face photo saved on this phone (enrolment capture or a picked photo).
 * Null on web, on another device, or before one was taken.
 */
const memberPhotoQuery = (personId: string) => ({
  queryKey: memberPhotoKey(personId),
  queryFn: async () => {
    const uri = await getMemberProfileImage(personId);
    // Same file path on re-enrolment: bust the image cache per read.
    return uri ? `${uri}?t=${Date.now()}` : null;
  },
  staleTime: Infinity,
});

/** The member's server photo URL (persons API) from whichever family query is
 *  already cached — read-only observers, so no extra request per avatar. */
function useCachedServerPhoto(personId?: string): string | null {
  const id = personId ?? '';
  const fromDetail = useQuery({
    queryKey: familyKeys.detail(id),
    queryFn: () => api.getFamilyMember(id),
    enabled: false,
    select: (m: FamilyMember | null) => m?.profileImageUrl ?? null,
  });
  const fromList = useQuery({
    queryKey: familyKeys.all,
    queryFn: api.getFamily,
    enabled: false,
    select: (list: FamilyMember[]) => list?.find((m) => m.id === id)?.profileImageUrl ?? null,
  });
  return fromDetail.data ?? fromList.data ?? null;
}

/**
 * A member's avatar: the server photo (FamilyMember.profileImageUrl) first,
 * then the photo kept on this phone, else null (callers show initials).
 * Pass `serverUrl` when the caller already has the member record.
 */
export function useMemberPhoto(personId?: string, serverUrl?: string | null): string | null {
  const cached = useCachedServerPhoto(personId);
  const local = useQuery({ ...memberPhotoQuery(personId ?? ''), enabled: !!personId });
  return serverUrl || cached || local.data || null;
}

/** Members with no photo yet — none on their profile and none on this phone
 *  (resolved checks only). */
export function useMembersWithoutPhoto(members: FamilyMember[]): FamilyMember[] {
  const results = useQueries({ queries: members.map((m) => memberPhotoQuery(m.id)) });
  return members.filter((m, i) => !m.profileImageUrl && results[i]?.isSuccess && !results[i]?.data);
}

/** Upload a member photo to their profile (persons API), then refresh the
 *  family reads so profileImageUrl comes back. Throws on failure. */
async function uploadMemberPhoto(queryClient: QueryClient, personId: string, uri: string): Promise<void> {
  await api.uploadProfilePicture(uri, personId);
  await markMemberPhotoSynced(personId).catch(() => {});
  await queryClient.invalidateQueries({ queryKey: familyKeys.all });
}

/** 'saved-local': kept on this phone, but the upload to their profile failed. */
export type PickPhotoResult = 'saved' | 'saved-local' | 'cancelled' | 'denied' | 'failed';

/**
 * Set a member's avatar from the camera or the gallery. Square crop, shrunk
 * to 480px and kept on this phone, then uploaded to their profile (best
 * effort — the phone copy stays when the upload fails).
 */
export function useSetMemberPhoto(personId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const pick = async (source: 'camera' | 'library'): Promise<PickPhotoResult> => {
    if (busy) return 'cancelled';
    setBusy(true);
    try {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return 'denied';
      } else if (Platform.OS === 'ios') {
        // Android uses the system photo picker — no storage permission needed.
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return 'denied';
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
      const result =
        source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (!uri) return 'cancelled';
      const small = await saveMemberFacePhoto(personId, uri);
      await markMemberPhotoPicked(personId).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: memberPhotoKey(personId) });
      try {
        await uploadMemberPhoto(queryClient, personId, small);
        return 'saved';
      } catch {
        return 'saved-local';
      }
    } catch {
      return 'failed';
    } finally {
      setBusy(false);
    }
  };
  return { pick, busy };
}

/** Save the enrolment capture as the member's avatar (480px, on this phone)
 *  and upload it to their profile in the background. Best effort: a failure
 *  here must never fail or delay the enrolment itself. A photo the user chose
 *  themselves (camera or gallery) is kept: a face scan never replaces it. */
export function useRememberMemberPhoto() {
  const queryClient = useQueryClient();
  return async (personId: string, captureUri: string) => {
    if (await isMemberPhotoPicked(personId).catch(() => false)) return;
    let small: string;
    try {
      small = await saveMemberFacePhoto(personId, captureUri);
      await queryClient.invalidateQueries({ queryKey: memberPhotoKey(personId) });
    } catch {
      return; // keep initials
    }
    void uploadMemberPhoto(queryClient, personId, small).catch(() => {
      // The phone copy still shows; useSyncMemberPhotos retries the upload.
    });
  };
}

/** Members whose phone-only photo was already retried this app session. */
const photoSyncTried = new Set<string>();

/** Signing out ends the "session": the next sign-in retries kept photos. */
export function resetMemberPhotoSync(): void {
  photoSyncTried.clear();
}

/**
 * Uploads member photos that exist only on this phone — their upload failed
 * earlier (offline, or the S3 403 before the upload fix) — so they survive
 * a reinstall and show on other devices. One try per member per session.
 */
export function useSyncMemberPhotos(members: FamilyMember[] | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const pending = (members ?? []).filter((m) => !m.profileImageUrl && !photoSyncTried.has(m.id));
    if (pending.length === 0) return;
    pending.forEach((m) => photoSyncTried.add(m.id));
    void (async () => {
      let uploaded = 0;
      for (const m of pending) {
        const local = await getMemberProfileImage(m.id).catch(() => null);
        if (!local) continue;
        try {
          await api.uploadProfilePicture(local, m.id);
          await markMemberPhotoSynced(m.id).catch(() => {});
          uploaded += 1;
          console.log('[MemberPhoto] uploaded phone-only photo', m.id.slice(0, 8));
        } catch (e) {
          console.warn('[MemberPhoto] upload failed, retrying next launch', m.id.slice(0, 8), e instanceof Error ? e.message : e);
        }
      }
      if (uploaded > 0) await queryClient.invalidateQueries({ queryKey: familyKeys.all });
    })();
  }, [members, queryClient]);
}

/** After a face was enrolled or updated (member or self): refresh the
 *  family reads (list, member, member activity), the account activity feed
 *  and the notification inbox (the backend posts an "identity" notification).
 *  useEnrollFace / useUpdateFace already refresh user + identity. */
export function useRefreshAfterFaceChange() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: familyKeys.all });
    // GET /user/me (useMe mirrors it into the session user: faceEnrolledAt…).
    void queryClient.invalidateQueries({ queryKey: accountKeys.me });
    void queryClient.invalidateQueries({ queryKey: accountKeys.activity });
    void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  };
}

/** Backend age rules: 0-4 photo enrollment · 5-9 liveness (front or back camera) · 10+ liveness (front only). */
export function ageBandFromAge(age: number): FamilyAgeBand {
  if (age >= 10) return '10+';
  if (age >= 5) return '5-9';
  return '0-4';
}

/** Member already on the account with the same name + DOB (age when the
 *  backend omits dateOfBirth) — the backend rejects re-adding them. */
export function findMatchingMember(
  list: FamilyMember[] | undefined,
  name: string,
  dob: string,
): FamilyMember | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const day = dob.split('T')[0];
  const age = ageFromDob(dob);
  return (
    (list ?? []).find(
      (m) =>
        norm(m.name) === norm(name) &&
        (m.dateOfBirth ? m.dateOfBirth.split('T')[0] === day : m.age === age),
    ) ?? null
  );
}

/** Backend "already exists" rejection on POST /family. */
export function isDuplicateMemberError(err: any): boolean {
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.message ?? '');
  return status === 409 || /already exists/i.test(msg);
}

/** One-shot flag the PIN screen grants before a member face update. */
export const MEMBER_FACE_UPDATE_GUARD = 'family:face-update';

/**
 * PIN gate for a member's face update (PRD FR-04, backend §5: PUT /face needs
 * a fresh verify-pin token). /face-update/pin grants the flag and opens the
 * member capture screen with update=1; the screen consumes it on mount, so a
 * deep link or a replay can't skip the PIN — and the single-use token from
 * that PIN check must still be held (5 minutes). First-time enrolment
 * (isUpdate false) is never gated. Returns false when the screen must bounce
 * to the PIN step.
 */
export function useMemberFaceUpdateGate(isUpdate: boolean): boolean {
  const [granted] = useState(() => !isUpdate || (flowGuards.has(MEMBER_FACE_UPDATE_GUARD) && hasReauthToken()));
  useEffect(() => {
    if (isUpdate && granted) flowGuards.consume(MEMBER_FACE_UPDATE_GUARD);
  }, [isUpdate, granted]);
  return granted;
}

/** Why the PIN screen is shown again during a face change: the PIN check
 *  expired / was refused (403 REAUTH_REQUIRED), or a failed update used it up. */
export type ReauthReason = 'expired' | 'retry';

/** Capture screen for a member: one photo under 5, liveness otherwise. */
export function memberCaptureMode(m: Pick<FamilyMember, 'faceCaptureMode' | 'age'> | null | undefined, fallbackAge?: number): 'photo' | 'liveness' {
  if (m?.faceCaptureMode) return m.faceCaptureMode;
  const age = m?.age ?? fallbackAge;
  return age != null && Number.isFinite(age) && age < 5 ? 'photo' : 'liveness';
}

/** The backend never moves a member's `verification` to 'verified' after
 *  face enrollment — it only flips `faceEnrolled`. Gating on 'verified'
 *  alone left "Continue setup" showing forever after a successful scan. */
export function isMemberFaceDone(m: Pick<FamilyMember, 'faceEnrolled' | 'verification'>): boolean {
  return m.faceEnrolled || m.verification === 'verified';
}

export interface MemberSetup {
  /** Face enrolled (or a legacy member already marked 'verified'). */
  faceDone: boolean;
  /** A verified document for them (or a legacy doc-first member past it). */
  docDone: boolean;
  /** A twin whose check-in PIN isn't set yet — the last setup step. */
  pinNeeded: boolean;
  /** Face + document (+ PIN for twins): the only state that reads "Verified". */
  setupDone: boolean;
  /** Face done, but their documents haven't loaded yet — no verdict. */
  checking: boolean;
  /** Member status badge — identical wherever a member's status shows. */
  label: string;
  tone: 'green' | 'amber' | 'neutral';
}

/**
 * A family member's setup status: the one rule behind the family card, the
 * member page and any other member status badge. Setup is face first, then
 * a document checked against it (backend §1.2/§7.1), then — twins only —
 * their own check-in PIN:
 *
 *   no face                    → "Face pending"    amber
 *   face, documents loading    → "Checking"        neutral (never an early "Verified")
 *   face, no verified document → "Document needed" amber
 *   twin without a PIN         → "PIN needed"      amber
 *   all done                   → "Verified"        green
 *
 * "Document needed" / "Verified" are statusBadge's pending_document /
 * verified rows (premium/flows/family). Reads the member's documents from
 * the same cache entry as useDocuments(personId), so screens agree.
 */
export function useMemberSetup(member: FamilyMember | null | undefined): MemberSetup {
  const personId = member?.id ?? '';
  // useDocuments(personId) without the self fallback: idle until there is a
  // member, never the account owner's own documents.
  const docs = useQuery({
    queryKey: documentKeys.member(personId),
    queryFn: () => api.getDocuments(personId),
    enabled: !!personId,
    refetchOnMount: true,
  });
  const faceDone = !!member && isMemberFaceDone(member);
  // Results are approved or rejected only — a document counts once verified.
  // 'pending_liveness' / 'verified' cover members whose document was done
  // before this order (doc first) changed.
  const docDone =
    !!member &&
    (!!docs.data?.some((d) => d.status === 'verified') ||
      member.verification === 'pending_liveness' ||
      member.verification === 'verified');
  const pinNeeded = isTwin(member) && !member?.checkInPinSet;
  const setupDone = faceDone && docDone && !pinNeeded;
  const checking = faceDone && !docDone && docs.isPending;
  const badge: Pick<MemberSetup, 'label' | 'tone'> = setupDone
    ? { label: 'Verified', tone: 'green' }
    : !faceDone
      ? { label: 'Face pending', tone: 'amber' }
      : checking
        ? { label: 'Checking', tone: 'neutral' }
        : !docDone
          ? { label: 'Document needed', tone: 'amber' }
          : { label: 'PIN needed', tone: 'amber' };
  return { faceDone, docDone, pinNeeded, setupDone, checking, ...badge };
}
