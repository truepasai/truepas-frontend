/** @jsxImportSource react */
/**
 * Your identity — GET /cb/identity/summary. Status is computed server-side:
 * face + document verified → "verified", anything missing/pending/failed →
 * "incomplete". Shows the verified / almost-there card with the next-step
 * hint, the Face / Document / Selfie checks, linked documents, recent
 * activity and the next-step CTA. The header pass shows the user's face in
 * the scan ring: at TruePas venues the face is the pass, so there is no QR.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { BadgeCheck, FileText, Hourglass, ScanFace, ShieldCheck, UserRoundCheck } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMe, withPinChange } from '@/features/account/hooks';
import { useDocuments } from '@/features/documents/hooks';
import { useIdentitySummary } from '@/features/identity/hooks';
import { useProfilePicture } from '@/features/profile/hooks';
import { FaceRing, Glow, IdentityCard } from '@/premium/blocks';
import { fmtMonthYear, StatusBadge, statusLabel, statusTileTone } from '@/premium/flows/home';
import { EmptyView, ErrorView, LoadingView } from '@/premium/kit';
import { useHeroStatusBar } from '@/premium/statusBar';
import { C, F, G, R, SH } from '@/premium/theme';
import { Button, Card, Divider, Footer, Group, initials, ListRow, Row, Screen, Tile, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { ActivityItem } from '@/types/domain';

export default function IdentityScreen() {
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const { url: avatarUri } = useProfilePicture();
  const { data: summary, isPending, isError, refetch, isRefetching } = useIdentitySummary();
  const documents = useDocuments();
  // The summary's feed has no PIN entry yet (BUG037) — same fill as Home.
  const pinChangedAt = useMe().data?.pinChangedAt ?? null;
  const insets = useSafeAreaInsets();
  // Navy pass header: light status bar until the white pass card (below the
  // 60pt TopBar + 12pt gap) scrolls up under it.
  const heroStatusBar = useHeroStatusBar(insets.top + 72, !isPending && !isError && !!summary);

  if (isPending) {
    return (
      <Screen header={<TopBar title="Your identity" />} scroll={false}>
        <LoadingView label="Loading identity…" full />
      </Screen>
    );
  }

  if (isError || !summary) {
    return (
      <Screen header={<TopBar title="Your identity" />}>
        <ErrorView
          title="Couldn't load identity status"
          body="Please check your connection and try again."
          onRetry={() => void refetch()}
        />
      </Screen>
    );
  }

  const verified = summary.status === 'verified';

  const incompleteHint =
    summary.face !== 'verified' ? 'Complete face verification to finish.'
    : summary.document === 'missing' ? 'Add a document to finish verification.'
    : summary.document === 'pending' ? 'Verify your document to finish.'
    : summary.document === 'failed' ? 'Document verification failed — try again.'
    : summary.selfieMatch !== 'verified' ? 'Your document photo still needs to match your face.'
    : 'Finish verification to unlock check-ins.';

  const cta = summary.document === 'pending'
    ? { label: 'View document status', route: '/(tabs)/documents' }
    : summary.document !== 'verified'
      ? { label: 'Add a document', route: '/document/select-type' }
      : summary.face !== 'verified'
        ? { label: 'Verify your face', route: '/face-update/pin' }
        : null;

  const docs = documents.data ?? [];
  const verifiedDocs = docs.filter((d) => d.status === 'verified').length;
  const activity = withPinChange(summary.activity, pinChangedAt) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        {...heroStatusBar}
        contentContainerStyle={{ paddingBottom: cta ? 16 : 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || documents.isRefetching}
            onRefresh={() => {
              void refetch();
              void documents.refetch();
            }}
            tintColor={C.white}
          />
        }
      >
        {/* ---------- identity pass: your face is the pass ---------- */}
        <View style={{ paddingBottom: 30 }}>
          <LinearGradient colors={G.night} style={StyleSheet.absoluteFill} />
          <Glow size={420} opacity={0.35} style={{ top: -120, left: -40 }} />
          <SafeAreaView edges={['top']}>
            <TopBar tone="glass" title="Your identity" />
          </SafeAreaView>
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <View style={[{ backgroundColor: C.white, borderRadius: R.xxl, padding: 22, alignItems: 'center', gap: 6 }, SH.lg]}>
              <Row gap={8}>
                {verified ? <BadgeCheck size={18} color={C.sky} /> : <Hourglass size={17} color={C.amberInk} />}
                <Txt v="smallStrong">{verified ? 'Verified by TruePas' : 'Verification in progress'}</Txt>
              </Row>
              <FaceRing size={176} mode={verified ? 'success' : 'idle'} uri={avatarUri} photo={!!avatarUri}>
                {avatarUri ? undefined : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.skyWash }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 40, color: C.navy }}>{initials(user?.fullName)}</Text>
                  </View>
                )}
              </FaceRing>
              <Txt v="h3" center lines={1} style={{ marginTop: -18 }}>
                {user?.fullName ?? ''}
              </Txt>
              <Txt v="small" center>
                At TruePas venues, your face is your pass.
              </Txt>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 26, marginTop: 4 }}>
          <IdentityCard
            name={user?.fullName ?? ''}
            idLine={user?.email ?? ''}
            photoUri={avatarUri ?? null}
            verified={verified}
            statusLabel={verified ? 'Verified' : 'Incomplete'}
            meta={[
              { k: 'Face', v: statusLabel(summary.face) },
              { k: 'Documents', v: documents.data ? `${verifiedDocs} verified` : '—' },
              // selfieMatch = the document photo checked against the enrolled
              // face (there is no separate selfie step any more).
              { k: 'Face match', v: statusLabel(summary.selfieMatch) },
            ]}
          />

          {/* ---------- status ---------- */}
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Tile icon={ShieldCheck} tone={verified ? 'green' : 'amber'} size={46} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="h3">{verified ? "You're verified" : 'Almost there'}</Txt>
              <Txt v="small">{verified ? 'Your face and document are verified.' : incompleteHint}</Txt>
            </View>
            <StatusBadge status={summary.status} />
          </Card>

          {/* ---------- checks ---------- */}
          <Group title="Verification checks">
            <ListRow
              icon={ScanFace}
              tone={statusTileTone(summary.face)}
              title="Face enrollment"
              trailing={<StatusBadge status={summary.face} />}
              chevron={false}
            />
            <ListRow
              icon={FileText}
              tone={statusTileTone(summary.document)}
              title="Identity document"
              trailing={<StatusBadge status={summary.document} />}
              chevron={false}
            />
            <ListRow
              icon={UserRoundCheck}
              tone={statusTileTone(summary.selfieMatch)}
              title="Face match"
              sub="Your document photo vs your face"
              trailing={<StatusBadge status={summary.selfieMatch} />}
              chevron={false}
            />
          </Group>

          {/* ---------- linked documents ---------- */}
          {docs.length > 0 && (
            <Group title="Linked documents">
              {docs.map((d) => (
                <ListRow
                  key={d.id}
                  icon={FileText}
                  tone="sky"
                  title={d.label}
                  sub={[statusLabel(d.status), d.expiresAt ? `Exp. ${fmtMonthYear(d.expiresAt)}` : d.number].filter(Boolean).join(' · ')}
                  onPress={() => router.push(`/document/${d.id}` as never)}
                />
              ))}
            </Group>
          )}

          {/* ---------- recent activity ---------- */}
          <View style={{ gap: 10 }}>
            <Txt v="micro" style={{ marginLeft: 4 }}>
              Recent activity
            </Txt>
            <Card pad={0} style={{ paddingHorizontal: 16 }}>
              {activity.length > 0 ? (
                activity.map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <Divider inset={22} />}
                    <ActivityRow item={item} />
                  </View>
                ))
              ) : (
                <EmptyView compact title="No activity yet" body="Verification events will appear here." />
              )}
            </Card>
          </View>
        </View>
      </ScrollView>

      {cta && (
        <Footer>
          <Button label={cta.label} onPress={() => router.push(cta.route as never)} />
        </Footer>
      )}
    </View>
  );
}

/** Normalized feed item: `title` as-is, `timestamp` already formatted locally. */
function ActivityRow({ item }: { item: ActivityItem }) {
  const dot = item.tone === 'success' ? C.green : item.tone === 'error' ? C.red : item.tone === 'warning' ? C.amber : C.ink4;
  return (
    <Row gap={12} style={{ paddingVertical: 14 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="bodyStrong" lines={1}>
          {item.title}
        </Txt>
        {!!item.timestamp && <Txt v="small">{item.timestamp}</Txt>}
      </View>
    </Row>
  );
}
