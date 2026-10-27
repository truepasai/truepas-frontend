/** @jsxImportSource react */
import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Check, FileText, ScanFace } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDocumentImages } from '@/features/documents/hooks';
import { DocumentCard, FlipCard } from '@/premium/flows/documents';
import { C } from '@/premium/theme';
import { Button, Group, ListRow, Txt } from '@/premium/ui';
import { ResultView } from '@/premium/views';
import { getDocumentImageUri } from '@/services/documentImageStore';
import { flowGuards } from '@/services/flowGuards';

function formatUSDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

/** Document verified (approved only — rejections go to document/rejected or
 *  document/mismatch). Flip card (ref: facepe-user-frontend verify.tsx):
 *  front = premium credential card, back = the scan (server image, local
 *  capture as fallback). */
export default function DocumentVerifiedScreen() {
  const router = useRouter();
  const {
    docId,
    docLabel,
    docType,
    docNumber,
    extractedName,
    extractedDob,
    issuingState,
    nationality,
    dateOfExpiry,
    portraitImageUrl,
  } = useLocalSearchParams<{
    docId?: string;
    docLabel?: string;
    docType?: string;
    docNumber?: string;
    extractedName?: string;
    extractedDob?: string;
    matchScore?: string;
    issuingState?: string;
    nationality?: string;
    dateOfExpiry?: string;
    portraitImageUrl?: string;
  }>();

  const [frontImageUri, setFrontImageUri] = useState<string | null>(null);
  // Server images (signed, expiring): the portrait, and the scan when this
  // phone has no local copy.
  const images = useDocumentImages(docId || undefined);
  const [isFlipped, setIsFlipped] = useState(false);
  // Result screen — a deep link with no real verification behind it must not
  // render a fake "verified" card (ADV-001).
  const [allowed] = useState(() => flowGuards.has('document:verified'));

  useEffect(() => {
    if (allowed) flowGuards.consume('document:verified');
  }, [allowed]);

  useEffect(() => {
    // The captured document was persisted locally (keyed by docId) before verification
    if (docId) {
      getDocumentImageUri(docId, 'front').then(setFrontImageUri).catch(() => setFrontImageUri(null));
    }
  }, [docId]);

  const title = docLabel ?? 'Document';
  // Prefer the real doc type (passed from processing); fall back to the label
  // heuristic for direct navigation without the param.
  const isLicense = (docType ?? docLabel ?? '').toLowerCase().includes('license');

  if (!allowed) return <Redirect href="/document/select-type" />;

  // The fetched signed URL first: the one passed as a route param comes back
  // decoded (%2B/%2F/%3D in its token), so S3 rejects it and the box stays blank.
  const portraitUri = images.data?.portrait?.url || portraitImageUrl;
  // The phone's cropped scan first: the server's front is the full camera
  // frame sent for verification (hand and background included).
  const scanUri = frontImageUri ?? images.data?.front?.url ?? null;

  return (
    <ResultView
      close
      icon={Check}
      tone="green"
      over="Verification complete"
      title={title}
      accent="verified."
      sub="Your document has been verified successfully."
      primary={
        <Button label="Go to identity dashboard" onPress={() => router.dismissTo('/identity' as never)} />
      }
      secondary={
        <Button label="Add another document" tone="ghost" onPress={() => router.dismissTo('/document/select-type' as never)} />
      }>
      {/* Flip card — front: credential card / back: captured scan */}
      <View style={{ gap: 14, alignItems: 'center' }}>
        <FlipCard
          flipped={isFlipped}
          height={200}
          scanUri={scanUri}
          style={{ alignSelf: 'stretch' }}
          front={(h) => (
            <DocumentCard
              type={docType || (isLicense ? 'drivingLicense' : 'passport')}
              label={title}
              number={docNumber || '—'}
              status="verified"
              holder={extractedName || null}
              expiresAt={dateOfExpiry ? dateOfExpiry.split('T')[0] : null}
              issuer={(isLicense ? issuingState : nationality) || null}
              height={h}
            />
          )}
        />
        <Button
          size="sm"
          tone="white"
          full={false}
          icon={isFlipped ? FileText : Camera}
          label={isFlipped ? 'View info' : 'View scan'}
          onPress={() => setIsFlipped((f) => !f)}
        />
      </View>

      {/* Extracted fields — portrait + captured data */}
      <Group title="Read from your document">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
          {/* Portrait — from backend (GET /documents/{id}/images, else the
           *  verify response's portraitImageUrl; extracted by server-side
           *  Regula) → icon placeholder */}
          <View
            style={{
              width: 56,
              height: 68,
              borderRadius: 14,
              overflow: 'hidden',
              backgroundColor: C.sunken,
              borderWidth: 1,
              borderColor: C.lineSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {portraitUri ? (
              <Image source={{ uri: portraitUri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Document portrait" />
            ) : (
              <ScanFace size={24} color={C.ink4} />
            )}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt v="micro">Full name</Txt>
            <Txt v="bodyStrong" lines={2}>
              {extractedName || '—'}
            </Txt>
          </View>
        </View>
        <ListRow title="Document no." value={docNumber || '—'} chevron={false} />
        <ListRow title="Date of birth" value={formatUSDate(extractedDob)} chevron={false} />
        {isLicense && !dateOfExpiry ? null : (
          <ListRow title="Expires" value={formatUSDate(dateOfExpiry)} chevron={false} />
        )}
        <ListRow
          title={isLicense ? 'State' : 'Nationality'}
          value={isLicense ? issuingState || '—' : nationality || '—'}
          chevron={false}
        />
      </Group>
    </ResultView>
  );
}
