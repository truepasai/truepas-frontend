/** @jsxImportSource react */
/**
 * Family member document — step 3 of 3, AFTER the face (backend §1.2/§7.1:
 * passport, ID card, licence, green card and US visa are checked against
 * the member's enrolled face; a birth certificate needs no face). Also the
 * "Continue setup" document step on the member page. The picker comes from
 * GET /documents/types/supported filtered by the member's age (§6.1), with
 * a fixed list when that fails. Hands off to /document/scan in family mode
 * with the member's personId → family/add/processing verifies it.
 *
 * Without a face yet (an under-5 photo still pending, or `prefer=
 * birthCertificate` from the photo step's "Continue without photo") the birth
 * certificate is preselected: it is the one document that doesn't need the
 * face. The member stays "Face pending" — not verified, check-in frozen —
 * until the photo is enrolled.
 */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ScanFace, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { allowedDocumentTypes, useSupportedDocumentTypes } from '@/features/documents/hooks';
import { ageBandFromAge, isTwin, memberCaptureMode, useFamilyMember } from '@/features/family/hooks';
import { DOC_ICON } from '@/premium/flows/family';
import { Banner, SkeletonList } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Badge, Button, Card, Heading, Screen, Steps, Tile, TopBar, Txt } from '@/premium/ui';
import type { DocumentType, FamilyAgeBand } from '@/types/domain';

type DocOption = { id: DocumentType; label: string };

// Fallback when the supported-types call fails. Minors can't hold a
// driving license.
const OPTIONS_MINOR: DocOption[] = [
  { id: 'passport', label: 'Passport' },
  { id: 'idCard', label: 'ID Card' },
  { id: 'greenCard', label: 'US Green Card' },
  { id: 'birthCertificate', label: 'Birth Certificate' },
  { id: 'usVisa', label: 'US Visa' },
];
const OPTIONS_ADULT: DocOption[] = [
  { id: 'passport', label: 'Passport' },
  { id: 'drivingLicense', label: "Driver's License" },
  { id: 'idCard', label: 'ID Card' },
  { id: 'greenCard', label: 'US Green Card' },
  { id: 'usVisa', label: 'US Visa' },
];

export default function FamilyDocumentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ personId?: string; name?: string; age?: string; band?: FamilyAgeBand; prefer?: string }>();
  const personId = params.personId || undefined;
  const { data: member } = useFamilyMember(personId);
  const supported = useSupportedDocumentTypes();

  const ageParam = params.age != null && params.age !== '' ? Number(params.age) : NaN;
  const age = Number.isFinite(ageParam) ? ageParam : member?.age;
  const band: FamilyAgeBand | undefined =
    params.band || member?.ageBand || (age != null && Number.isFinite(age) ? ageBandFromAge(age) : undefined);
  const first = (params.name || member?.name || 'Member').trim().split(' ')[0];
  const faceDone = !!member && (member.faceEnrolled || member.verification === 'verified');

  const options: DocOption[] | null = supported.data
    ? allowedDocumentTypes(supported.data, age).map((t) => ({ id: t.type, label: t.label }))
    : supported.isError
      ? age != null && age >= 18
        ? OPTIONS_ADULT
        : OPTIONS_MINOR
      : null;
  const [selectedId, setSelectedId] = useState<DocumentType | null>(null);
  // No face yet: start on the one document that doesn't need it.
  const preferBirthCertificate = params.prefer === 'birthCertificate' || (!!member && !faceDone);
  const fallback = (preferBirthCertificate ? options?.find((o) => o.id === 'birthCertificate') : undefined) ?? options?.[0];
  const selected = options?.find((o) => o.id === selectedId) ?? fallback ?? null;
  const photoMember = memberCaptureMode(member, age) === 'photo';

  if (!personId) return <Redirect href="/family/add" />;

  const scan = () => {
    if (!selected) return;
    router.push({
      pathname: '/document/scan',
      params: { type: selected.id, family: '1', personId, name: first, band: band ?? '' },
    });
  };

  const setUpFace = () =>
    router.replace({
      pathname: memberCaptureMode(member, age) === 'photo' ? '/family/add/photo-capture' : '/family/add/face-capture',
      params: { personId, name: first, ...(age != null ? { age: String(age) } : {}), next: 'document' },
    });

  return (
    <Screen
      header={
        <TopBar
          title="Add member"
          right={
            <Txt v="smallStrong" color={C.ink3}>
              3/3
            </Txt>
          }
        />
      }
      contentStyle={{ paddingTop: 8 }}
      footer={<Button label="Scan document" icon={ScanLine} disabled={!selected} onPress={scan} />}>
      <View style={{ gap: 10 }}>
        {/* Twins: a check-in PIN follows (step 4). */}
        <Steps total={isTwin(member) ? 4 : 3} current={2} />
        <Txt v="small">{`Step 3 of ${isTwin(member) ? 4 : 3} · Document`}</Txt>
      </View>

      <View style={{ gap: 14 }}>
        <Heading
          title={`Scan ${first}'s`}
          accent="ID."
          sub="Choose a document. Make sure all corners are visible and text is readable."
        />
        {faceDone ? <Badge label="Face enrolled" tone="green" icon={ScanFace} /> : null}
      </View>

      {member && !faceDone ? (
        <Banner
          tone="warning"
          title={photoMember ? `${first}'s face photo is still pending` : `Set up ${first}'s face first`}
          body={
            photoMember
              ? 'A birth certificate works without it. Passports and other photo IDs are checked against the face, so they need the photo first.'
              : 'Photo documents are checked against their face. A birth certificate works without it.'
          }
          action={
            <Button label={photoMember ? 'Take photo' : 'Set up face'} tone="soft" size="sm" full={false} icon={ScanFace} onPress={setUpFace} />
          }
        />
      ) : (
        <Banner tone="info" body={`The photo on ${first}'s document is checked against their face.`} />
      )}

      <View style={{ gap: 10 }}>
        <Txt v="micro" style={{ marginLeft: 4 }}>
          Document type
        </Txt>
        {options == null ? (
          <SkeletonList rows={4} thumb={40} />
        ) : (
          <Card pad={0} style={{ paddingHorizontal: 16 }}>
            {options.map((o, i) => {
              const isSelected = o.id === selected?.id;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityLabel={o.label}
                  accessibilityState={{ selected: isSelected, checked: isSelected }}
                  onPress={() => setSelectedId(o.id)}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: C.lineSoft,
                    }}>
                    <Tile icon={DOC_ICON[o.id]} tone={isSelected ? 'sky' : 'neutral'} size={40} />
                    <Txt v="bodyStrong" color={isSelected ? C.ink : C.ink2} style={{ flex: 1 }}>
                      {o.label}
                    </Txt>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSelected ? C.sky : 'transparent',
                        borderWidth: isSelected ? 0 : 2,
                        borderColor: C.line,
                      }}>
                      {isSelected && <Check size={14} color={C.white} strokeWidth={3.2} />}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>
    </Screen>
  );
}
