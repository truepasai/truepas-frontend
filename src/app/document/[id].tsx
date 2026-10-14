/** @jsxImportSource react */
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
    Camera,
    Eye,
    EyeOff,
    FileText,
    ScanLine,
    Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { toApiError } from '@/api/errors';
import { useDocument, useDocumentImages, useRemoveDocument } from '@/features/documents/hooks';
import { displayDocNumber } from '@/features/documents/format';
import { ageBandFromAge, useFamily } from '@/features/family/hooks';
import { useToast } from '@/hooks/useToast';
import {
    DocumentCard,
    FlipCard,
    MatchRing,
    docMeta,
    localDay,
    matchPct,
    prettyDate,
    statusBadge,
} from '@/premium/flows/documents';
import { Async, Bone, ConfirmSheet, EmptyView, SkeletonList } from '@/premium/kit';
import { C, R } from '@/premium/theme';
import { Badge, Button, Card, Group, ListRow, Row, Screen, TopBar, Txt } from '@/premium/ui';
import { getDocumentImageUri } from '@/services/documentImageStore';
import type { IdentityDocument } from '@/types/domain';

const CARD_H = 212;

function DetailSkeleton() {
  return (
    <View style={{ gap: 20 }}>
      <Bone h={CARD_H} r={R.xl} />
      <Row gap={10}>
        <Bone w="48%" h={48} r={24} />
        <Bone w="48%" h={48} r={24} />
      </Row>
      <SkeletonList rows={3} thumb={40} />
    </View>
  );
}

/** Document detail — a single identity document. Premium credential card
 *  (flips to the scan), verify card when a match score exists, the stored
 *  images (GET /documents/{id}/images), detail rows with selective
 *  disclosure, Verify now / Remove actions. */
export default function DocumentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const toast = useToast();

  const docQuery = useDocument(id);
  // Signed, expiring URLs — refetched with the screen, never cached to disk.
  const imagesQuery = useDocumentImages(id);
  const family = useFamily();
  const removeDocument = useRemoveDocument();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [scanImageUri, setScanImageUri] = useState<string | null>(null);
  const [localChecked, setLocalChecked] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  // Date of birth stays masked until asked for.
  const [showDob, setShowDob] = useState(false);

  // Local copy of the capture (keyed by docId, saved at scan time): Regula's
  // cropped document, shown first. The server's front is the full camera
  // frame sent for verification (desk and all), only the fallback.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    getDocumentImageUri(id, 'front')
      .then((uri) => {
        if (alive) setScanImageUri(uri);
      })
      .catch(() => {
        if (alive) setScanImageUri(null);
      })
      .finally(() => {
        if (alive) setLocalChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const status = docQuery.data?.status;
  const canVerify = status === 'pending' || status === 'failed';
  const removing = removeDocument.isPending;
  const doc = docQuery.data;
  const serverFront = imagesQuery.data?.front?.url ?? null;
  // Every document carries a personId — a member's id, or the holder's own
  // person id (not the /user/me id) — so whose it is comes from the family
  // list. Until that loads, Verify now / Rescan wait instead of guessing.
  const ownerKnown = !doc?.personId || family.data != null;

  // Re-verify re-captures via the scan flow (design pushes `docVerify`). A
  // member's document goes through their family flow (family/add/processing:
  // their personId and enrolled face), never the holder's self flow.
  const reverify = (d: IdentityDocument) => {
    if (!ownerKnown) return;
    const member = family.data?.find((m) => m.id === d.personId);
    if (member) {
      // Same params as the member's document step (family/add/document).
      router.push({
        pathname: '/document/scan',
        params: {
          type: d.type,
          family: '1',
          personId: member.id,
          name: member.name.trim().split(' ')[0],
          band: member.ageBand ?? ageBandFromAge(member.age),
        },
      } as never);
      return;
    }
    router.push({
      pathname: '/document/scan',
      params: {
        type: d.type,
        label: d.label,
        expiresAt: d.expiresAt ?? undefined,
      },
    } as never);
  };

  // Opened from a link with nothing underneath (a cold deep link), there is no
  // screen to go back to — the wallet instead.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/documents' as never));

  // Gone from the account — removed, or replaced by a newer verified copy.
  const notFound = (
    <EmptyView
      icon={FileText}
      title="Document not found"
      body="It may have been removed from your account."
      action={
        <Button
          label="Go to wallet"
          full={false}
          onPress={leave}
        />
      }
    />
  );

  const doRemove = () => {
    if (!id) return;
    removeDocument.mutate(id, {
      onSuccess: () => {
        setConfirmRemove(false);
        toast.show('success', 'Document removed');
        leave();
      },
      onError: (e) => {
        setConfirmRemove(false);
        toast.show('error', `Couldn't remove document: ${toApiError(e).message}`);
      },
    });
  };

  return (
    <>
      <Screen
        header={<TopBar title={doc?.label ?? 'Document'} onBack={leave} />}
        contentStyle={{ paddingTop: 8 }}
        onRefresh={
          id
            ? () => {
                void docQuery.refetch();
                void imagesQuery.refetch();
                if (!ownerKnown) void family.refetch();
              }
            : undefined
        }
        refreshing={docQuery.isRefetching}
        footer={
          doc != null && canVerify ? (
            <Button label="Verify now" icon={ScanLine} disabled={!ownerKnown} onPress={() => reverify(doc)} />
          ) : undefined
        }>
        {/* 404 = removed — e.g. after a rescan was approved, the server
            dropped this older copy; back from the result lands here. */}
        {docQuery.isError && toApiError(docQuery.error).status === 404 ? (
          notFound
        ) : (
        <Async
          q={docQuery}
          skeleton={<DetailSkeleton />}
          emptyView={notFound}>
          {(d) => {
            const meta = docMeta(d.type);
            const pct = matchPct(d.matchScore);
            const expires = d.expiresAt ? d.expiresAt.split('T')[0] : null;
            const isLicense = d.type === 'drivingLicense';
            // A licence names its issuing state, other documents a nationality;
            // fall back to the other when only that one was read.
            const issuer = (isLicense ? d.issuingState || d.nationality : d.nationality || d.issuingState) || null;
            const issuerLabel = isLicense && d.issuingState ? 'Issuing state' : d.nationality ? 'Nationality' : 'Issuing state';
            const badge = statusBadge(d.status);
            return (
              <>
                {/* Flip card — front: credential card / back: captured scan */}
                <View style={{ gap: 14 }}>
                  <FlipCard
                    flipped={isFlipped}
                    height={CARD_H}
                    scanUri={scanImageUri ?? serverFront}
                    noScan={
                      !localChecked || imagesQuery.isPending ? (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <ActivityIndicator color={C.ink3} accessibilityLabel="Loading scan" />
                        </View>
                      ) : (
                        // Neither on this phone (lost on reinstall) nor on the
                        // server (older documents were never stored there). The Rescan
                        // button sits right below the card.
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 }}>
                          <FileText size={30} color={C.ink4} strokeWidth={1.6} />
                          <Txt v="small" color={C.ink3} center>
                            This scan isn&apos;t saved on this phone. Tap Rescan to scan the document again.
                          </Txt>
                        </View>
                      )
                    }
                    front={(h) => (
                      <DocumentCard
                        type={d.type}
                        label={d.label}
                        number={displayDocNumber(d.number)}
                        status={d.status}
                        holder={d.extractedName}
                        expiresAt={expires}
                        issuer={(isLicense ? d.issuingState : d.nationality) || null}
                        height={h}
                      />
                    )}
                  />
                  <Row gap={10}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label={isFlipped ? 'View info' : 'View scan'}
                        icon={isFlipped ? FileText : Camera}
                        tone="white"
                        size="md"
                        onPress={() => setIsFlipped((f) => !f)}
                      />
                    </View>
                    {/* Sharing is deferred by the backend (§13 #15) — the second
                        action rescans the document instead (renewed card, a
                        better photo, or a failed check). */}
                    <View style={{ flex: 1 }}>
                      <Button label="Rescan" icon={ScanLine} size="md" disabled={!ownerKnown} onPress={() => reverify(d)} />
                    </View>
                  </Row>
                </View>

                {/* Verify card — match score + re-verify (only when a score exists) */}
                {pct != null && (
                  <MatchRing
                    value={pct}
                    label="Document match"
                    sub={d.verifiedAt ? `${meta.label} · verified ${localDay(d.verifiedAt)}` : `${meta.label} · added ${prettyDate(d.addedAt)}`}
                    right={<Badge label={badge.label} tone={badge.tone} icon={badge.icon} dot={badge.dot} />}
                  />
                )}

                {/* One card, only rows with a value. Status sits on the card
                    above, the match score in its ring, and the source is
                    internal, so none of them repeat here. */}
                <Group title="Details">
                  {d.extractedName ? <ListRow title="Holder" value={d.extractedName} chevron={false} /> : null}
                  {displayDocNumber(d.number) ? <ListRow title="Number" value={displayDocNumber(d.number)} chevron={false} /> : null}
                  {d.extractedDob ? (
                    <ListRow
                      title="Date of birth"
                      value={showDob ? prettyDate(d.extractedDob) : `•• ••• ${d.extractedDob.slice(0, 4)}`}
                      onPress={() => setShowDob((v) => !v)}
                      trailing={showDob ? <EyeOff size={18} color={C.ink4} /> : <Eye size={18} color={C.ink4} />}
                    />
                  ) : null}
                  {issuer ? <ListRow title={issuerLabel} value={issuer} chevron={false} /> : null}
                  {expires ? <ListRow title="Expires" value={prettyDate(expires)} chevron={false} /> : null}
                  {d.verifiedAt ? (
                    <ListRow title="Verified on" value={localDay(d.verifiedAt)} chevron={false} />
                  ) : (
                    <ListRow title="Added" value={prettyDate(d.addedAt)} chevron={false} />
                  )}
                </Group>

                <Card pad={0} style={{ paddingHorizontal: 16 }}>
                  <ListRow
                    icon={Trash2}
                    danger
                    title="Remove from wallet"
                    chevron={false}
                    onPress={removing ? undefined : () => setConfirmRemove(true)}
                    trailing={removing ? <ActivityIndicator size="small" color={C.red} accessibilityLabel="Removing" /> : undefined}
                  />
                </Card>
              </>
            );
          }}
        </Async>
        )}
      </Screen>

      <ConfirmSheet
        visible={confirmRemove}
        icon={Trash2}
        danger
        title="Remove this document?"
        body="It will be deleted from your account. You can add it again later."
        confirmLabel="Remove document"
        loading={removing}
        onConfirm={doRemove}
        onCancel={() => {
          if (!removing) setConfirmRemove(false);
        }}
      />
    </>
  );
}
