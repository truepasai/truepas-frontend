/** @jsxImportSource react */
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, FileText, Info } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { useDocumentTypeOptions } from '@/features/documents/hooks';
import { ageFromDob, useFamilyMember } from '@/features/family/hooks';
import { DOC_META, docMeta } from '@/premium/flows/documents';
import { Bone, EmptyView } from '@/premium/kit';
import { C, F, R, SH } from '@/premium/theme';
import { Heading, Press, Row, Screen, Steps, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { DocumentType } from '@/types/domain';

/** A finite, non-negative age, or undefined. */
function validAge(n: number | null | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function TypeSkeleton() {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading document types">
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            backgroundColor: C.surface,
            borderRadius: R.lg,
            padding: 14,
            borderWidth: 1,
            borderColor: C.lineSoft,
          }}>
          <Bone w={62} h={44} r={9} />
          <View style={{ flex: 1, gap: 8 }}>
            <Bone w="46%" />
            <Bone w="70%" h={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Add document — step 1 of 2: pick the type, then scan.
 *  The list comes from GET /documents/types/supported, filtered by the
 *  person's age (§6.1); the hard-coded list is the fallback when it fails.
 *  Number/label/expiry are NOT collected — server-side OCR extracts them
 *  during /verify.
 *  Family mode (`family=1`): the scan flow is scoped to a family member
 *  (personId); their age comes from the `age` param or the member record. */
export default function AddDocumentScreen() {
  const router = useRouter();
  const { family, personId, memberName, band, age } = useLocalSearchParams<{
    family?: string;
    personId?: string;
    memberName?: string;
    band?: string;
    age?: string;
  }>();
  const isFamilyMode = family === '1';
  const firstName = memberName?.trim().split(/\s+/)[0];

  // Account holder: age from the profile DOB (adult when unknown).
  const ownDob = useAppSelector((state) => state.auth.user?.dateOfBirth);
  const ownAge = ownDob ? validAge(ageFromDob(ownDob)) : undefined;

  // Family member: `age` param, else the member record, else the age band
  // (under-10 bands are clearly minors). Still unknown → no age filter.
  const ageParam = age ? validAge(Number(age)) : undefined;
  const member = useFamilyMember(isFamilyMode && ageParam === undefined ? personId : undefined);
  const memberAge = ageParam ?? validAge(member.data?.age);
  const bandAge = band === '0-4' ? 4 : band === '5-9' ? 9 : undefined;
  const waitingForMember = isFamilyMode && memberAge === undefined && !!personId && member.isPending;
  const personAge: number | null | undefined = isFamilyMode ? (memberAge ?? bandAge ?? null) : ownAge;

  const { options } = useDocumentTypeOptions(personAge);

  const continueToUpload = (type: DocumentType) => {
    const params: Record<string, string> = { type };
    if (isFamilyMode) {
      params.family = '1';
      params.personId = personId ?? '';
      params.name = memberName ?? '';
      params.band = band ?? '';
    }
    router.push({ pathname: '/document/scan', params });
  };

  return (
    <Screen header={<TopBar title="Add document" onBack={() => router.back()} />} contentStyle={{ paddingTop: 4 }}>
      <View style={{ gap: 18 }}>
        <Steps total={2} current={0} />
        {isFamilyMode ? (
          firstName ? (
            <Heading over="Step 1 of 2 — choose type" title="Which ID does" accent={firstName} after="have?" sub="Pick the document you'll scan next." />
          ) : (
            <Heading over="Step 1 of 2 — choose type" title="Which ID do they" accent="have?" sub="Pick the document you'll scan next." />
          )
        ) : (
          <Heading over="Step 1 of 2 — choose type" title="Which ID do you" accent="have?" sub="Pick the document you'll scan next." />
        )}
      </View>

      {!options || waitingForMember ? (
        <TypeSkeleton />
      ) : options.length === 0 ? (
        <EmptyView compact icon={FileText} title="No documents to add" body="None of the supported documents fit this age." />
      ) : (
        <View style={{ gap: 12 }} accessibilityRole="list" accessibilityLabel="Document type">
          {options.map(({ type: t, label }) => {
            const d = docMeta(t);
            // Known types keep the app's label; a type the app doesn't know
            // yet shows the server label on the generic card.
            const title = DOC_META[t] ? d.label : (label ?? d.label);
            return (
              <Press key={t} onPress={() => continueToUpload(t)} label={title} role="button" style={[{ borderRadius: R.lg }, SH.sm]}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 16,
                    backgroundColor: C.surface,
                    borderRadius: R.lg,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: C.lineSoft,
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
                  <ChevronRight size={18} color={C.ink4} />
                </View>
              </Press>
            );
          })}
        </View>
      )}

      <Row gap={10} align="flex-start" style={{ paddingHorizontal: 4 }}>
        <Info size={16} color={C.ink3} style={{ marginTop: 1 }} />
        <Txt v="small" style={{ flex: 1 }}>
          The document number and expiry are read from the scan automatically.
        </Txt>
      </Row>
    </Screen>
  );
}
