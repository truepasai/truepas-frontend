/** @jsxImportSource react */
/**
 * Add family — step 1 of 3: member basics. Continue creates the member
 * (POST /cb/family) and goes FACE FIRST: step 2 is the face (liveness 5+,
 * one photo under 5 — POST /face/enroll), step 3 the document, which the
 * backend then checks against that enrolled face (backend §1.2/§7.1:
 * verifying a photo document for a member without a face is rejected with
 * FACE_NOT_ENROLLED). The member page goes under the capture screen, so
 * backing out of a later step lands on it with "Continue setup" — but
 * backing out of the face step itself removes the new member again
 * (useDiscardNewMemberOnBack).
 * A duplicate (same name + DOB) is caught here, before anything is created,
 * and so is an age that doesn't fit the relationship (relationshipAge.ts).
 * A Twin whose date of birth is more than a day from everyone's in the
 * family (holder included) is confirmed first: "Check the date" or Continue
 * (the first of twin children has no twin added yet). Once a twin is in
 * the family, a new twin off their birthday is blocked.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowRight, CalendarDays, User, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { useMe } from '@/features/account/hooks';
import {
  ageFromDob,
  familyKeys,
  findMatchingMember,
  isDuplicateMemberError,
  isTwin,
  memberCaptureMode,
  TWIN_RELATIONSHIP,
  useAddFamilyMember,
} from '@/features/family/hooks';
import { MAX_MEMBER_AGE, relationshipAgeError, sharesTwinBirthday } from '@/features/family/relationshipAge';
import { DateField, formatDate } from '@/premium/flows/family';
import { Banner, ConfirmSheet } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Chip, Field, Heading, Row, Screen, Steps, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { FamilyMember } from '@/types/domain';

const RELATIONSHIPS = ['Child', 'Spouse', 'Parent', 'Guardian', 'Sibling', TWIN_RELATIONSHIP, 'Other'];

function isoYearsAgo(years: number): string {
  const d = new Date();
  return `${d.getFullYear() - years}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AddFamilyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const addMember = useAddFamilyMember();
  // The account holder's age, for the Child / Parent rules. useMe keeps the
  // session user (and its DOB) fresh.
  useMe();
  const ownDob = useAppSelector((state) => state.auth.user?.dateOfBirth);
  const ownAge = ownDob ? ageFromDob(ownDob) : undefined;

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [relationship, setRelationship] = useState('Child');
  const [errors, setErrors] = useState<{ name?: string; dob?: string; relationship?: string }>({});
  const [checking, setChecking] = useState(false);
  const [existing, setExisting] = useState<FamilyMember | null>(null);
  // Twin whose birthday matches nobody in the family: confirm before adding.
  const [twinDobCheck, setTwinDobCheck] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Member page underneath, the face capture on top (step 2 of 3). */
  const openFaceStep = (member: FamilyMember, name: string) => {
    const age = Number.isFinite(member.age) ? member.age : ageFromDob(dob);
    const mode = memberCaptureMode(member, ageFromDob(dob));
    router.replace({ pathname: '/family/[id]', params: { id: member.id } });
    router.push({
      pathname: mode === 'photo' ? '/family/add/photo-capture' : '/family/add/face-capture',
      // `fresh`: backing out of this first capture removes the member again.
      params: { personId: member.id, name: name.split(' ')[0], age: String(age), next: 'document', fresh: '1' },
    });
  };

  const submit = async (twinDobConfirmed = false) => {
    const trimmed = fullName.trim();
    const next: typeof errors = {};
    if (trimmed.length < 2) next.name = 'Name is required';
    else if (trimmed.length > 100) next.name = 'Name is too long';
    if (!dob) next.dob = 'Pick a date of birth';
    else {
      const age = ageFromDob(dob);
      if (!Number.isFinite(age)) next.dob = 'Enter a valid date';
      else if (age < 0) next.dob = 'Date of birth must be in the past';
      else {
        const fit = relationshipAgeError(relationship, age, ownAge);
        if (fit) next.dob = fit;
      }
    }
    if (!relationship) next.relationship = 'Choose a relationship';
    setErrors(next);
    setSubmitError(null);
    if (Object.keys(next).length > 0) return;

    setChecking(true);
    try {
      // Catch a duplicate before creating anything — the backend rejects the
      // same name + DOB anyway.
      try {
        const list = await queryClient.fetchQuery({
          queryKey: familyKeys.all,
          queryFn: api.getFamily,
          staleTime: 30_000,
        });
        const match = findMatchingMember(list, trimmed, dob);
        if (match) {
          setExisting(match);
          return;
        }
        // A twin shares a birthday (±1 day) with their twin: the holder or
        // someone already in the family. Once a twin is in the family, the
        // next one must match a twin (or the holder) — that's a hard block.
        // The first of twin children has no twin here yet, so that asks.
        if (relationship === TWIN_RELATIONSHIP) {
          const twins = list.filter(isTwin).map((m) => m.dateOfBirth);
          if (twins.some(Boolean) && !sharesTwinBirthday(dob, [ownDob, ...twins])) {
            setErrors({ dob: "Twins share a birthday — this doesn't match the twin in your family" });
            return;
          }
          if (!twinDobConfirmed && !sharesTwinBirthday(dob, [ownDob, ...list.map((m) => m.dateOfBirth)])) {
            setTwinDobCheck(true);
            return;
          }
        }
      } catch {
        // List unavailable — the create call below still rejects duplicates.
      }

      const member = await addMember.mutateAsync({ name: trimmed, dateOfBirth: dob, relationship });
      openFaceStep(member, trimmed);
    } catch (err) {
      if (isDuplicateMemberError(err)) {
        // The backend knows this member but our list missed them — offer theirs.
        const match = findMatchingMember(await api.getFamily().catch(() => undefined), trimmed, dob);
        if (match) setExisting(match);
        else setSubmitError(`${trimmed} was added to your account before. Check your Family list, or contact support if they were removed.`);
        return;
      }
      setSubmitError(toApiError(err).message || "Couldn't add this member. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen
      keyboard
      header={
        <TopBar
          title="Add member"
          right={
            <Txt v="smallStrong" color={C.ink3}>
              1/3
            </Txt>
          }
        />
      }
      contentStyle={{ paddingTop: 8 }}
      footer={
        <Button
          label="Continue"
          iconRight={ArrowRight}
          loading={checking}
          disabled={checking}
          onPress={() => void submit()}
        />
      }>
      {/* Twins add a 4th step: their own check-in PIN. */}
      <Steps total={relationship === TWIN_RELATIONSHIP ? 4 : 3} current={0} />
      <Heading title="Who's joining" accent="you?" sub="They'll get their own profile, linked to your family." />

      <View style={{ gap: 10 }}>
        <Txt v="smallStrong" color={C.ink2}>
          Relationship
        </Txt>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {RELATIONSHIPS.map((r) => (
            <Chip
              key={r}
              label={r}
              active={relationship === r}
              onPress={() => {
                setRelationship(r);
                // An age error may no longer apply; submit checks again.
                setErrors((e) => ({ ...e, dob: undefined, relationship: undefined }));
              }}
            />
          ))}
        </Row>
        {errors.relationship ? (
          <Txt v="small" color={C.redInk}>
            {errors.relationship}
          </Txt>
        ) : null}
        {relationship === TWIN_RELATIONSHIP ? (
          <Banner
            tone="info"
            body="Twins look alike, so they also get their own check-in PIN. You'll set it after their face and document."
          />
        ) : null}
      </View>

      <View style={{ gap: 18 }}>
        <Field
          label="Full name"
          icon={User}
          placeholder="Maya Example"
          value={fullName}
          onChangeText={setFullName}
          hint="As on their document."
          error={errors.name}
          inputProps={{ autoCapitalize: 'words', maxLength: 100, autoComplete: 'off' }}
        />
        <DateField
          label="Date of birth"
          value={dob || undefined}
          onChange={(v) => {
            setDob(v);
            setErrors((e) => ({ ...e, dob: undefined }));
          }}
          placeholder="Select date of birth"
          minDate={isoYearsAgo(MAX_MEMBER_AGE)}
          maxDate={isoYearsAgo(0)}
          error={errors.dob}
        />
      </View>

      {submitError ? (
        <Banner tone="error" title="Couldn't add member" body={submitError} />
      ) : (
        <Banner
          tone="info"
          title="Face first, then a document"
          body="Under 5: one photo. Ages 5–9: liveness, any camera. 10+: liveness, front camera. Their document is then checked against that face."
        />
      )}

      <ConfirmSheet
        visible={!!existing}
        icon={UserRound}
        title={existing ? `${existing.name} is already in your family` : 'Already in your family'}
        body="Open their profile to continue their setup, or change the details you entered."
        confirmLabel={existing ? `Open ${existing.name.split(' ')[0]}` : 'Open'}
        cancelLabel="Change details"
        onConfirm={() => {
          if (existing) router.replace({ pathname: '/family/[id]', params: { id: existing.id } });
        }}
        onCancel={() => setExisting(null)}
      />

      <ConfirmSheet
        visible={twinDobCheck}
        icon={CalendarDays}
        title="No one shares this birthday"
        body={`Twins are born on the same day, or a day apart. Nobody in your family has a date of birth near ${formatDate(dob)}. If their twin isn't added yet, continue and add them next with the same date.`}
        confirmLabel="Continue"
        cancelLabel="Check the date"
        loading={checking}
        onConfirm={() => {
          setTwinDobCheck(false);
          void submit(true);
        }}
        onCancel={() => {
          setTwinDobCheck(false);
          setErrors((e) => ({ ...e, dob: 'Twins share a birthday — check this date' }));
        }}
      />
    </Screen>
  );
}
