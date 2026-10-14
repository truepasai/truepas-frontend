/** @jsxImportSource react */
/**
 * Wallet (Documents tab) — identity-strength card (approved design), the
 * user's documents as a fanned wallet deck you can swipe through like playing
 * cards, and venue-issued credentials.
 *
 * Data: useSecurityScore (identity strength, §10.2) + useIdentitySummary
 * (local fallback) + useDocuments + supported types (§6.1). Issued
 * credentials (GET /documents/issued) is always [] for now (§13 #14), so that
 * section renders its empty state.
 */
import { useRouter } from 'expo-router';
import { FileText, MoveHorizontal, Plus, ShieldCheck, Ticket } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSecurityScore } from '@/features/account/hooks';
import { useDocumentTypeOptions, useDocuments } from '@/features/documents/hooks';
import { ageFromDob } from '@/features/family/hooks';
import { useIdentitySummary } from '@/features/identity/hooks';
import { TAB_BAR_SPACE } from '@/premium/blocks';
import {
  DOC_STYLE,
  TabTitle,
  WALLET_CARD_H,
  WALLET_PEEK,
  WalletCard,
} from '@/premium/flows/home';
import { Async, Bone, EmptyView } from '@/premium/kit';
import { C, F, R } from '@/premium/theme';
import { Button, Card, Chip, IconCircle, Row, SectionHead, Tile, Txt } from '@/premium/ui';
import { selectHaptic } from '@/services/haptics';
import { useAppSelector } from '@/store';
import type { DocumentType, IdentityDocument, IdentitySummary, SecurityScore, VerificationStatus } from '@/types/domain';

type Cat = 'all' | 'identity' | 'travel' | 'driving';

const CATS: { key: Exclude<Cat, 'all'>; label: string; types: DocumentType[] }[] = [
  { key: 'identity', label: 'Identity', types: ['passport', 'idCard', 'greenCard', 'birthCertificate'] },
  { key: 'travel', label: 'Travel', types: ['passport', 'usVisa'] },
  { key: 'driving', label: 'Driving', types: ['drivingLicense'] },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const summary = useIdentitySummary();
  const score = useSecurityScore();
  const documents = useDocuments();
  const [cat, setCat] = useState<Cat>('all');

  // "Add more": the types this user can add (supported types by age).
  const dob = useAppSelector((state) => state.auth.user?.dateOfBirth);
  const age = dob ? ageFromDob(dob) : NaN;
  const { options: typeOptions } = useDocumentTypeOptions(Number.isFinite(age) && age >= 0 ? age : undefined);

  const refreshing = summary.isRefetching || documents.isRefetching || score.isRefetching;
  const onRefresh = () => {
    void summary.refetch();
    void score.refetch();
    void documents.refetch();
  };

  const addDocument = () => router.push('/document/select-type' as never);
  const missingTypes: DocumentType[] =
    documents.data && typeOptions
      ? typeOptions
          .map((o) => o.type)
          .filter((t) => !documents.data.some((d) => d.type === t))
          .slice(0, 2)
      : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sky} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: TAB_BAR_SPACE + 20, gap: 26 }}
        >
          <TabTitle right={<IconCircle icon={Plus} tone="sky" label="Add document" onPress={addDocument} />}>Wallet</TabTitle>

          {/* ---------- identity strength ---------- */}
          {score.data ? (
            <IdentityStrengthCard server={score.data} docs={documents.data} onPress={() => router.push('/identity' as never)} />
          ) : (
            // Server score loading or failed: the local estimate meanwhile.
            <Async q={summary} compact skeleton={<Bone h={78} r={R.xl} />}>
              {(s) => <IdentityStrengthCard s={s} docs={documents.data} onPress={() => router.push('/identity' as never)} />}
            </Async>
          )}

          {/* ---------- your documents ---------- */}
          <View style={{ gap: 16 }}>
            <SectionHead title="Your documents" />
            <Async
              q={documents}
              compact
              empty={(docs) => docs.length === 0}
              emptyView={
                <Card>
                  <EmptyView
                    compact
                    icon={FileText}
                    title="No documents yet"
                    body="Add a passport, ID card, or license to verify your identity."
                    action={<Button label="Add a document" icon={Plus} size="sm" full={false} onPress={addDocument} />}
                  />
                </Card>
              }
              skeleton={<Bone h={WALLET_CARD_H} r={R.xl} />}
            >
              {(docs) => <DocumentStack docs={docs} cat={cat} setCat={setCat} onOpen={(d) => router.push(`/document/${d.id}` as never)} />}
            </Async>
          </View>

          {/* ---------- add more ---------- */}
          {missingTypes.length > 0 && (
            <View style={{ gap: 16 }}>
              <SectionHead title="Add more to your wallet" />
              <Row gap={12} align="stretch">
                {missingTypes.map((t) => (
                  <Card
                    key={t}
                    flat
                    onPress={addDocument}
                    style={{ flex: 1, gap: 12, borderStyle: 'dashed', borderColor: C.line, borderWidth: 1.5 }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: R.sm,
                        backgroundColor: C.skyWash,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Plus size={18} color={C.skyPressed} />
                    </View>
                    <View>
                      <Txt v="bodyStrong" lines={1}>
                        {DOC_STYLE[t].title}
                      </Txt>
                      <Txt v="small">Scan to add</Txt>
                    </View>
                  </Card>
                ))}
              </Row>
            </View>
          )}

          {/* ---------- issued to you ---------- */}
          <View style={{ gap: 16 }}>
            <SectionHead title="Issued to you" />
            <Card>
              <EmptyView
                compact
                icon={Ticket}
                title="No issued credentials"
                body="Credentials issued at venue check-ins appear here."
              />
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ───────────────────────── identity strength ───────────────────────── */

/**
 * Local estimate of identity strength (face 40, document 35, selfie match 25;
 * "pending" counts half), shown only while GET /user/me/security-score is
 * loading or has failed. The server's `identityStrength` is the real number.
 */
function strengthOf(s: IdentitySummary): number {
  const part = (v: VerificationStatus, w: number) => (v === 'verified' ? w : v === 'pending' ? w / 2 : 0);
  return Math.round(part(s.face, 40) + part(s.document, 35) + part(s.selfieMatch, 25));
}

/** Next-step line for the local estimate (same wording as the server suggestions). */
function localSuggestion(s: IdentitySummary): string {
  if (s.face !== 'verified') return 'Set up your face';
  if (s.document === 'missing') return 'Add an ID document';
  if (s.document !== 'verified') return 'Verify your document';
  return 'Your identity strength is good';
}

const IDENTITY_SUGGESTIONS = new Set(['enroll_face', 'add_document', 'verify_document', 'renew_document']);

function IdentityStrengthCard({
  server,
  s,
  docs,
  onPress,
}: {
  /** GET /user/me/security-score, preferred. */
  server?: SecurityScore;
  /** Identity summary: local fallback when the server score is unavailable. */
  s?: IdentitySummary;
  docs?: IdentityDocument[];
  onPress: () => void;
}) {
  const raw = server ? server.identityStrength : s ? strengthOf(s) : 0;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const total = docs?.length ?? 0;
  const verifiedDocs = docs?.filter((d) => d.status === 'verified').length ?? 0;
  const tone = score >= 90 ? 'green' : score >= 60 ? 'sky' : 'amber';
  const color = tone === 'green' ? C.green : tone === 'sky' ? C.skyPressed : C.amberInk;

  const title =
    total > 0 ? `${verifiedDocs} of ${total} document${total === 1 ? '' : 's'} verified` : 'No documents yet';
  // Only identity steps belong here — 2-step sign-in, devices and password
  // raise the security score (Security screen), not identity strength.
  const identityTip = server?.suggestions.find((x) => IDENTITY_SUGGESTIONS.has(String(x.id)));
  // The score needs one verified document, so "excellent" next to "1 of 3
  // verified" read as a contradiction: name the documents still open.
  const open = total - verifiedDocs;
  const sub =
    score >= 90
      ? open > 0
        ? `${open} document${open === 1 ? ' needs' : 's need'} attention`
        : 'Your identity strength is excellent'
      : identityTip
        ? identityTip.title
        : s
          ? localSuggestion(s)
          : 'Your identity strength is good';

  return (
    <Card pad={16} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Tile icon={ShieldCheck} tone={tone} size={46} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="bodyStrong">{title}</Txt>
        <Txt v="small">{sub}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`Identity strength ${score} out of 100`}>
        <Text style={{ fontFamily: F.extrabold, fontSize: 22, color }}>{score}</Text>
        <Text style={{ fontFamily: F.medium, fontSize: 10.5, color: C.ink4, marginTop: -2 }}>/ 100</Text>
      </View>
    </Card>
  );
}

/* ───────────────────────── swipeable wallet stack ───────────────────────── */

function DocumentStack({
  docs,
  cat,
  setCat,
  onOpen,
}: {
  docs: IdentityDocument[];
  cat: Cat;
  setCat: (c: Cat) => void;
  onOpen: (d: IdentityDocument) => void;
}) {
  /* Category chips filter locally — only categories the user actually has. */
  const cats = CATS.filter((c) => docs.some((d) => c.types.includes(d.type)));
  const showChips = docs.length > 1 && cats.length > 1;
  const active = showChips && cat !== 'all' && cats.some((c) => c.key === cat) ? cat : 'all';
  const types = CATS.find((c) => c.key === active)?.types;
  const shown = types ? docs.filter((d) => types.includes(d.type)) : docs;

  /* Deck order (back → front). New documents join at the front. */
  const [order, setOrder] = useState<string[]>([]);
  const ordered = [
    ...order.map((id) => shown.find((d) => d.id === id)).filter((d): d is IdentityDocument => !!d),
    ...shown.filter((d) => !order.includes(d.id)),
  ];
  const sendToBack = (id: string) => setOrder([id, ...ordered.map((d) => d.id).filter((x) => x !== id)]);

  return (
    <View style={{ gap: 18 }}>
      {showChips && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip label="All" active={active === 'all'} onPress={() => setCat('all')} />
          {cats.map((c) => (
            <Chip key={c.key} label={c.label} active={active === c.key} onPress={() => setCat(c.key)} />
          ))}
        </ScrollView>
      )}
      {/* fanned stack — each card keeps its top WALLET_PEEK px visible; the
          bottom (fully visible) card is the front of the deck */}
      <View style={{ height: WALLET_CARD_H + (ordered.length - 1) * WALLET_PEEK }}>
        {ordered.map((d, i) => (
          <DeckCard
            key={d.id}
            d={d}
            index={i}
            front={ordered.length > 1 && i === ordered.length - 1}
            onOpen={() => onOpen(d)}
            onSwiped={() => sendToBack(d.id)}
          />
        ))}
      </View>
      {ordered.length > 1 && (
        <Row gap={6} style={{ justifyContent: 'center', marginTop: -6 }}>
          <MoveHorizontal size={14} color={C.ink4} />
          <Txt v="small" color={C.ink4}>
            Swipe the front card to see the next
          </Txt>
        </Row>
      )}
    </View>
  );
}

const SWIPE_DISTANCE = 90;

/**
 * One card in the deck. Its slot animates when the order changes; the front
 * card can be swiped left or right, flies out, and slides back in at the back
 * of the deck (like moving the top playing card to the bottom). A tap still
 * opens the document.
 */
function DeckCard({
  d,
  index,
  front,
  onOpen,
  onSwiped,
}: {
  d: IdentityDocument;
  index: number;
  front: boolean;
  onOpen: () => void;
  onSwiped: () => void;
}) {
  const { width } = useWindowDimensions();
  const y = useState(() => new Animated.Value(index * WALLET_PEEK))[0];
  const x = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    Animated.spring(y, { toValue: index * WALLET_PEEK, speed: 14, bounciness: 5, useNativeDriver: true }).start();
  }, [index, y]);

  // Latest props for the responder, which is created once.
  const latest = useRef({ front, onSwiped, width });
  useEffect(() => {
    latest.current = { front, onSwiped, width };
  });

  /* A drag must not also count as a tap (web fires click after mouseup). */
  const draggedAt = useRef(0);

  /* Handlers read `latest` only while a gesture runs, never during render. */
  /* eslint-disable react-hooks/refs */
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => latest.current.front && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        latest.current.front && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        draggedAt.current = Date.now();
        x.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        draggedAt.current = Date.now();
        const out = Math.abs(g.dx) > SWIPE_DISTANCE || Math.abs(g.vx) > 0.6;
        if (!out) {
          Animated.spring(x, { toValue: 0, speed: 18, bounciness: 8, useNativeDriver: true }).start();
          return;
        }
        const dir = g.dx >= 0 ? 1 : -1;
        const off = dir * (latest.current.width + 40);
        Animated.timing(x, { toValue: off, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
          selectHaptic();
          latest.current.onSwiped();
          Animated.spring(x, { toValue: 0, speed: 12, bounciness: 4, useNativeDriver: true }).start();
        });
      },
      onPanResponderTerminate: () => {
        draggedAt.current = Date.now();
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );
  const open = () => {
    if (Date.now() - draggedAt.current > 400) onOpen();
  };
  /* eslint-enable react-hooks/refs */

  const rotate = x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-7deg', '0deg', '7deg'] });

  return (
    <Animated.View
      {...(front ? pan.panHandlers : {})}
      accessibilityHint={front ? 'Swipe left or right to move this card to the back' : undefined}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: y }, { translateX: x }, { rotate }] }}
    >
      <WalletCard d={d} onPress={open} />
    </Animated.View>
  );
}
