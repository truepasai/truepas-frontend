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
 *
 * Under 5 (photo members) the document comes FIRST instead: the backend
 * refuses their photo until a document is verified, and never compares this
 * document's portrait with a face, so any type works. The add flow starts
 * here for them, and the photo follows from the member page.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ScanFace, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { allowedDocumentTypes, useSupportedDocumentTypes } from '@/features/documents/hooks';
import { ageBandFromAge, isTwin, memberCaptureMode, useFamilyMember } from '@/features/family/hooks';
import { DOC_META, docMeta } from '@/premium/flows/documents';
import { Banner, SkeletonList } from '@/premium/kit';
import { C, F, R, SH } from '@/premium/theme';
import { Badge, Button, Heading, Screen, Steps, TopBar, Txt } from '@/premium/ui';
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
  const photoMember = memberCaptureMode(member, age) === 'photo';
  // No face yet (5 and over): start on the one document that doesn't need it.
  // Under 5 every document works before the photo.
  const preferBirthCertificate = params.prefer === 'birthCertificate' || (!!member && !faceDone && !photoMember);
  const fallback = (preferBirthCertificate ? options?.find((o) => o.id === 'birthCertificate') : undefined) ?? options?.[0];
  const selected = options?.find((o) => o.id === selectedId) ?? fallback ?? null;

  if (!personId) return <Redirect href="/family/add" />;

  const scan = () => {
    if (!selected) return;
    router.push({
      pathname: '/document/scan',
      params: { type: selected.id, family: '1', personId, name: first, band: band ?? '' },
    });
  };

  // Under 5 the photo is the last step (the document is already verified), so
  // it goes back to the member page rather than to another document.
  const setUpFace = () =>
    router.replace({
      pathname: photoMember ? '/family/add/photo-capture' : '/family/add/face-capture',
      params: { personId, name: first, ...(age != null ? { age: String(age) } : {}), ...(photoMember ? {} : { next: 'document' }) },
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

      {member && !faceDone && photoMember ? (
        // Under 5 the document comes first (the backend refuses the photo
        // before it) and its portrait is never compared with a face.
        <Banner
          tone="info"
          title={`${first}'s document comes first`}
          body={`Any of these documents works. ${first}'s photo is taken once the document is verified.`}
          action={
            member.verification === 'pending_face' ? (
              <Button label="Take photo" tone="soft" size="sm" full={false} icon={ScanFace} onPress={setUpFace} />
            ) : undefined
          }
        />
      ) : member && !faceDone ? (
        <Banner
          tone="warning"
          title={`Set up ${first}'s face first`}
          body="Photo documents are checked against their face. A birth certificate works without it."
          action={<Button label="Set up face" tone="soft" size="sm" full={false} icon={ScanFace} onPress={setUpFace} />}
        />
      ) : photoMember ? (
        <Banner tone="info" body={`${first}'s document is checked without comparing faces.`} />
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
          <View style={{ gap: 12 }}>
            {options.map((o) => {
              const isSelected = o.id === selected?.id;
              // Same cards as the Add document picker; known types keep the app's label.
              const d = docMeta(o.id);
              const title = DOC_META[o.id] ? d.label : o.label;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityLabel={title}
                  accessibilityState={{ selected: isSelected, checked: isSelected }}
                  onPress={() => setSelectedId(o.id)}
                  style={[{ borderRadius: R.lg }, SH.sm]}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 16,
                      backgroundColor: C.surface,
                      borderRadius: R.lg,
                      padding: 14,
                      borderWidth: 1.5,
                      borderColor: isSelected ? C.sky : C.lineSoft,
                    }}>
                    <View style={{ width: 62, height: 44, borderRadius: 9, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                      <LinearGradient colors={d.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                      <View>
                        <d.icon size={20} color={C.white} />
                      </View>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: F.bold, fontSize: 15.5, color: C.ink }}>{title}</Text>
                      {!!d.sub && <Txt v="small">{d.sub}</Txt>}
                    </View>
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
          </View>
        )}
      </View>
    </Screen>
  );
}
