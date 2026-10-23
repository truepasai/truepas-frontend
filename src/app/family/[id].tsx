/** @jsxImportSource react */
/**
 * FamilyDetailScreen — a single family member. Hero, setup checklist derived
 * from verification state, the member's documents, permissions and the
 * remove flow. Setup is FACE FIRST (backend §1.2/§7.1: photo documents are
 * checked against the enrolled face): "Continue setup" opens the face
 * capture (then the document step) until the face is enrolled, then the
 * document step. A twin then sets their own check-in PIN (the kiosk asks for
 * it to tell twins apart). Once set up, "Update face" re-runs the member's
 * capture (PIN first, PUT /face), "Change check-in PIN" replaces a twin's
 * PIN (your PIN first) and "Add a document" adds extra documents without
 * repeating the face step. Premium skin over the original (0483c76) behaviour.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BadgeCheck,
  BellRing,
  CalendarDays,
  Camera,
  FilePlus,
  FileText,
  History,
  Image as ImageIcon,
  KeyRound,
  ScanFace,
  Trash2,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { documentKeys, useDocuments } from '@/features/documents/hooks';
import {
  familyKeys,
  isTwin,
  memberCaptureMode,
  type MemberSetup,
  useFamilyMember,
  useMemberPhoto,
  useMemberSetup,
  useRemoveFamilyMember,
  useSetMemberPhoto,
  useUpdateFamilyPermissions,
} from '@/features/family/hooks';
import { Glow, Guilloche } from '@/premium/blocks';
import { ChecklistCard, DocRow, formatDate, type ChecklistStep } from '@/premium/flows/family';
import { Async, Bone, ComingSoon, ConfirmSheet, EmptyView, SkeletonList } from '@/premium/kit';
import { useHeroStatusBar } from '@/premium/statusBar';
import { C, DESCENDERS, F, SH } from '@/premium/theme';
import { Badge, Button, Group, IconCircle, initials, ListRow, Screen, Toggle, TopBar, Txt, VerifiedTick } from '@/premium/ui';
import type { FamilyMember } from '@/types/domain';

/** Face → Document (→ PIN for twins) → Done: the document is checked against the face. */
function stepsFor(m: FamilyMember, { faceDone, docDone, pinNeeded, setupDone }: MemberSetup): ChecklistStep[] {
  const isPhoto = memberCaptureMode(m) === 'photo';
  const pinStep: ChecklistStep[] = isTwin(m)
    ? [{ icon: KeyRound, label: 'Check-in PIN', sub: 'Tells twins apart at venues', done: !pinNeeded }]
    : [];
  return [
    {
      icon: isPhoto ? Camera : ScanFace,
      label: 'Face',
      sub: isPhoto ? 'One clear photo — no liveness under 5' : 'A short liveness check',
      done: faceDone,
    },
    {
      icon: FileText,
      label: 'Document',
      sub: 'Checked against their face',
      done: docDone,
    },
    ...pinStep,
    {
      icon: BadgeCheck,
      label: 'Done',
      sub: 'Ready for venue check-in',
      done: setupDone,
    },
  ];
}

export default function FamilyMemberScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { id, photo } = useLocalSearchParams<{ id: string; photo?: string }>();

  const member = useFamilyMember(id);
  const memberDocs = useDocuments(id);
  const removeMember = useRemoveFamilyMember();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const m = member.data;
  // Server photo (profileImageUrl) first, then the one kept on this phone.
  const photoUri = useMemberPhoto(id, m?.profileImageUrl);
  // Dark hero top (photo with a dark fade, or the navy monogram hero): light
  // status bar icons until the canvas scrolls under them.
  const heroStatusBar = useHeroStatusBar(photoUri ? 140 : 230, !!m);

  // Coming back from a capture/document flow (which pops back to this
  // screen): refresh the member and their documents. Skips the first focus —
  // the queries already load on mount.
  const queryClient = useQueryClient();
  const seenFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seenFocus.current) {
        seenFocus.current = true;
        return;
      }
      void queryClient.invalidateQueries({ queryKey: familyKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: documentKeys.member(id) });
    }, [queryClient, id]),
  );
  const setPhoto = useSetMemberPhoto(id);
  // Opened from the Family "Add photos" nudge: start on the source sheet.
  const [photoSheet, setPhotoSheet] = useState(photo === '1');
  const choosePhoto = async (source: 'camera' | 'library') => {
    setPhotoSheet(false);
    const r = await setPhoto.pick(source);
    if (r === 'saved') toast({ variant: 'success', title: 'Photo added' });
    else if (r === 'saved-local')
      toast({ variant: 'warning', title: 'Photo saved on this phone', description: "We couldn't upload it. Try again later." });
    else if (r === 'denied')
      // Only the camera asks for permission. Once refused, iOS never asks
      // again, so the way forward is the app's page in Settings.
      toast({
        variant: 'error',
        title: 'Camera access is needed',
        description: 'Turn on Camera for TruePas in Settings, or choose a photo from your library.',
        action: { label: 'Open Settings', onPress: () => void Linking.openSettings() },
      });
    else if (r === 'failed') toast({ variant: 'error', title: "Couldn't add the photo" });
  };

  // Permissions (§7.2). notifyOnCheckIn is live; while a change saves, the
  // toggle shows the new value and is disabled — a failure reverts it.
  const permissions = useUpdateFamilyPermissions(id);
  const savedNotify = m?.permissions?.notifyOnCheckIn ?? true;
  const notifyOn =
    permissions.isPending && permissions.variables?.notifyOnCheckIn != null
      ? permissions.variables.notifyOnCheckIn
      : savedNotify;
  const setNotify = (value: boolean) =>
    permissions.mutate(
      { notifyOnCheckIn: value },
      { onError: () => toast({ variant: 'error', title: "Couldn't save the setting", description: 'Please try again.' }) },
    );

  const first = m?.name.split(' ')[0] ?? '';
  const isPhoto = memberCaptureMode(m) === 'photo';
  // Face / document / done and the status badge: the same rule as the family
  // card, over the documents memberDocs loads (one cache entry).
  const setup = useMemberSetup(m);
  const { faceDone, docDone, pinNeeded, setupDone } = setup;
  const twin = isTwin(m);

  const openDocumentStep = () =>
    m &&
    router.push({
      pathname: '/family/add/document',
      params: { personId: id, name: first, age: String(m.age), band: m.ageBand },
    } as never);
  // Face first; the document step follows when it's still missing.
  const openFaceStep = () =>
    m &&
    router.push({
      pathname: isPhoto ? '/family/add/photo-capture' : '/family/add/face-capture',
      params: { personId: id, name: first, age: String(m.age), ...(docDone ? {} : { next: 'document' }) },
    } as never);
  // Twins: their own check-in PIN — the last setup step, or a change later
  // (your PIN first).
  const openPinStep = (change?: boolean) =>
    router.push({
      pathname: '/family/add/set-pin',
      params: { personId: id, name: first, ...(change ? { mode: 'change' } : {}) },
    } as never);
  const continueSetup = !faceDone ? openFaceStep : !docDone ? openDocumentStep : () => openPinStep();
  const continueLabel = !faceDone
    ? isPhoto
      ? `Take ${first}'s face photo`
      : `Scan ${first}'s face`
    : !docDone
      ? `Add ${first}'s document`
      : `Set ${first}'s check-in PIN`;
  const continueIcon = !faceDone ? (isPhoto ? Camera : ScanFace) : !docDone ? FileText : KeyRound;

  // Extra documents any time — processing sees personId and returns here
  // without re-running face capture.
  const addDocument = () =>
    m &&
    router.push({
      pathname: '/document/select-type',
      params: { family: '1', personId: id, memberName: m.name, band: m.ageBand },
    } as never);

  // Redo an enrolled member's face: PIN first (as for your own face, §5),
  // then their own capture — liveness 5+ or one photo under 5, both PUT
  // /face with personId and the PIN token — which pops back here.
  const updateFace = () =>
    m &&
    router.push({
      pathname: '/face-update/pin',
      params: { personId: id, name: first, age: String(m.age), capture: isPhoto ? 'photo' : 'liveness' },
    } as never);

  // "Go to Family" — reset to Tabs → Family so leftover add-flow screens
  // don't sit under the list. Header/hardware back stay plain router.back().
  const goToFamily = () => {
    if (router.canDismiss()) router.dismissAll();
    router.push('/family' as never);
  };

  const cameras =
    m && m.allowedCameras?.length
      ? `${m.allowedCameras.map((c) => c[0].toUpperCase() + c.slice(1)).join(' + ')} camera`
      : '';

  const doRemove = async () => {
    try {
      await removeMember.mutateAsync(id);
      setConfirmRemove(false);
      toast({ variant: 'success', title: 'Member removed' });
      router.back();
    } catch (e) {
      setConfirmRemove(false);
      toast({
        variant: 'error',
        title: "Couldn't remove member",
        description: toApiError(e).message,
      });
    }
  };

  const refreshing = member.isRefetching || memberDocs.isRefetching;
  const onRefresh = () => {
    void member.refetch();
    void memberDocs.refetch();
  };

  if (!m) {
    // 404 = removed (e.g. opened from a "member removed" notification): a
    // friendly not-found with a way back, not "Couldn't load".
    // useFamilyMember doesn't retry it.
    const notFound = (
      <EmptyView
        icon={UserX}
        title="No longer in your family"
        body="This member was removed from your family, so their profile is no longer available."
        action={<Button label="Go to Family" icon={Users} full={false} onPress={goToFamily} />}
      />
    );
    return (
      <Screen header={<TopBar title="Member" />} contentStyle={{ paddingTop: 4 }} refreshing={refreshing} onRefresh={onRefresh}>
        {member.isError && toApiError(member.error).status === 404 ? (
          notFound
        ) : (
          <Async
            q={member}
            emptyView={notFound}
            skeleton={
              <View style={{ gap: 16, alignItems: 'center', paddingTop: 12 }}>
                <Bone w={120} h={120} r={60} />
                <Bone w="60%" h={28} />
                <Bone w="40%" />
                <SkeletonList rows={3} thumb={40} />
              </View>
            }>
            {() => null}
          </Async>
        )}
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        {...heroStatusBar}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sky} />}>
        {photoUri ? (
          /* ---------- hero: full-bleed portrait, as in the approved design ---------- */
          <View style={{ height: 420 }}>
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            <LinearGradient
              colors={['rgba(1,27,39,0.35)', 'rgba(1,27,39,0)', 'rgba(246,248,250,0.6)', C.canvas]}
              locations={[0, 0.3, 0.82, 1]}
              style={StyleSheet.absoluteFill}
            />
            <SafeAreaView edges={['top']}>
              <TopBar
                tone="glass"
                right={
                  <IconCircle
                    icon={Camera}
                    tone="glass"
                    label={`Change ${first}'s photo`}
                    onPress={() => !setPhoto.busy && setPhotoSheet(true)}
                  />
                }
              />
            </SafeAreaView>
          </View>
        ) : (
          /* ---------- hero: no photo yet — monogram on the identity gradient ---------- */
          <View style={{ height: 340, overflow: 'hidden' }}>
            <LinearGradient colors={[C.navyNight, C.navy, '#0A86B8']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
            <Glow size={380} opacity={0.45} style={{ top: -150, right: -140 }} />
            <Guilloche size={520} style={{ alignSelf: 'center', top: -60 }} />
            <LinearGradient
              colors={['rgba(246,248,250,0)', 'rgba(246,248,250,0.7)', C.canvas]}
              locations={[0.5, 0.82, 1]}
              style={StyleSheet.absoluteFill}
            />
            <SafeAreaView edges={['top']}>
              <TopBar tone="glass" />
            </SafeAreaView>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 70 }}>
              <View
                style={{
                  width: 128,
                  height: 128,
                  borderRadius: 64,
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.3)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text style={{ fontFamily: F.bold, fontSize: 44, letterSpacing: 1, color: C.white }}>{initials(m.name)}</Text>
              </View>
              <Pressable
                onPress={() => setPhotoSheet(true)}
                disabled={setPhoto.busy}
                accessibilityRole="button"
                accessibilityLabel={`Add ${first}'s photo`}
                style={{ marginTop: -22, marginLeft: 92 }}>
                <View
                  style={[
                    {
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: C.sky,
                      borderWidth: 3,
                      borderColor: C.white,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    SH.sky,
                  ]}>
                  <Camera size={17} color={C.white} strokeWidth={2.4} />
                </View>
              </Pressable>
            </View>
          </View>
        )}

        <View style={{ paddingHorizontal: 20, marginTop: photoUri ? -64 : -44, gap: 26 }}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text
                numberOfLines={2}
                style={{ flexShrink: 1, fontFamily: F.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -1.1, color: C.ink, ...DESCENDERS }}>
                {m.name}
              </Text>
              {setupDone && <VerifiedTick size={24} />}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Badge label={`${m.relationship} · ${m.age} yrs`} tone="neutral" />
              <Badge label={setup.label} tone={setup.tone} dot />
              <Badge label={isPhoto ? 'Photo' : 'Liveness'} tone="sky" icon={isPhoto ? Camera : ScanFace} />
              {cameras ? <Badge label={cameras} tone="neutral" /> : null}
            </View>
          </View>

          {!setupDone && (
            <Button label={continueLabel} icon={continueIcon} onPress={continueSetup} />
          )}
          {setupDone && <Button label="Go to Family" icon={Users} onPress={goToFamily} />}

          {/* ---------- setup checklist ---------- */}
          <ChecklistCard title="Setup checklist" steps={stepsFor(m, setup)} />

          {/* ---------- profile ---------- */}
          <Group title="Profile">
            {m.dateOfBirth ? (
              <ListRow icon={CalendarDays} title="Date of birth" value={formatDate(m.dateOfBirth)} chevron={false} />
            ) : null}
            <ListRow
              icon={History}
              tone="sky"
              title="Activity"
              sub="Check-ins and verification events"
              onPress={() =>
                router.push({ pathname: '/family/[id]/activity', params: { id, name: m.name } } as never)
              }
            />
          </Group>

          {/* ---------- documents ---------- */}
          <View style={{ gap: 10 }}>
            <Txt v="micro" style={{ marginLeft: 4 }}>
              Documents
            </Txt>
            <Async
              q={memberDocs}
              compact
              skeleton={<SkeletonList rows={2} thumb={40} />}
              empty={(docs) => docs.length === 0}
              emptyView={
                <EmptyView
                  compact
                  icon={FileText}
                  title="No documents yet"
                  body={faceDone ? `Add a document to verify ${first}.` : `Set up ${first}'s face first, then add a document.`}
                  action={
                    faceDone ? <Button label="Add a document" tone="soft" size="md" icon={FilePlus} onPress={addDocument} /> : undefined
                  }
                />
              }>
              {(docs) => (
                <Group>
                  {[
                    ...docs.map((d) => (
                      <DocRow key={d.id} doc={d} onPress={() => router.push(`/document/${d.id}` as never)} />
                    )),
                    <ListRow
                      key="add"
                      icon={FilePlus}
                      tone="sky"
                      title="Add a document"
                      sub="Passport, ID card or birth certificate"
                      onPress={addDocument}
                    />,
                  ]}
                </Group>
              )}
            </Async>
          </View>

          {/* ---------- manage (enrolled members) ---------- */}
          {faceDone && (
            <Group title="Manage">
              <ListRow
                icon={isPhoto ? Camera : ScanFace}
                tone="sky"
                title={isPhoto ? 'Retake face photo' : 'Update face'}
                sub={isPhoto ? `Replace ${first}'s enrolled photo` : `New liveness check for ${first}`}
                onPress={updateFace}
              />
              {twin && !pinNeeded ? (
                <ListRow
                  icon={KeyRound}
                  tone="sky"
                  title="Change check-in PIN"
                  sub={`The PIN ${first} enters at venues`}
                  onPress={() => openPinStep(true)}
                />
              ) : null}
            </Group>
          )}

          {/* ---------- permissions (§7.2) ---------- */}
          <Group title="Permissions">
            <ListRow
              icon={BellRing}
              tone="sky"
              title={`Notify me when ${first} checks in`}
              sub="An alert on your phone"
              chevron={false}
              trailing={
                <Toggle
                  on={notifyOn}
                  disabled={permissions.isPending}
                  onChange={setNotify}
                  label={`Notify me when ${first} checks in`}
                />
              }
            />
            {/* Stored by the backend but not enforced yet (consent review). */}
            <View style={{ opacity: 0.55 }} accessibilityState={{ disabled: true }} accessibilityHint="Coming soon">
              <ListRow
                icon={UserCheck}
                title="Check in independently"
                sub="Without you present"
                chevron={false}
                trailing={<ComingSoon />}
              />
            </View>
          </Group>

          <Button
            label="Remove from family"
            tone="ghost"
            icon={Trash2}
            loading={removeMember.isPending}
            onPress={() => setConfirmRemove(true)}
            style={{ marginTop: -8 }}
          />
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={photoSheet}
        icon={Camera}
        title={photoUri ? `Change ${first}'s photo` : `Add ${first}'s photo`}
        body="Use a clear photo of their face. It's saved to their profile and shown on their family card."
        confirmLabel="Take photo"
        onConfirm={() => void choosePhoto('camera')}
        onCancel={() => setPhotoSheet(false)}>
        <Button label="Choose from gallery" tone="soft" icon={ImageIcon} onPress={() => void choosePhoto('library')} />
      </ConfirmSheet>
      <ConfirmSheet
        visible={confirmRemove}
        danger
        icon={Trash2}
        title={`Remove ${m.name}?`}
        body={`${first} will be removed from your family.`}
        confirmLabel="Remove member"
        loading={removeMember.isPending}
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  );
}
