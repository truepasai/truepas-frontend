/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — documents flow pieces shared by `src/app/document/*`:
 * per-type metadata, the real-data document card, the flip card (card ↔
 * captured scan), the match ring, the processing step list and the scan hero.
 *
 * Everything here renders REAL values only (IdentityDocument / verify
 * response fields). Missing values fall back to "—" or are omitted.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BookUser,
  Car,
  Check,
  CreditCard,
  FileText,
  IdCard,
  Landmark,
  Loader,
  type LucideIcon,
  ScanFace,
  ScrollText,
  UserRound,
  X,
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Guilloche } from '@/premium/blocks';
import { Bone } from '@/premium/kit';
import { C, F, R, SH } from '@/premium/theme';
import { Badge, type BadgeTone, Card, Row, Txt } from '@/premium/ui';
import type { DocumentImages, DocumentType } from '@/types/domain';

/* ───────────────────────── type metadata ───────────────────────── */

export interface DocMeta {
  /** Display label — same strings the original flow used (DOC_LABELS). */
  label: string;
  /** Lower-case noun for headlines ("Scan passport", "Checking your passport."). */
  noun: string;
  /** One-line description on the type picker. */
  sub: string;
  icon: LucideIcon;
  colors: readonly [string, string];
}

/** The six backend `DocumentType`s, in the original picker order. */
export const DOC_TYPES: DocumentType[] = ['passport', 'drivingLicense', 'idCard', 'greenCard', 'birthCertificate', 'usVisa'];

export const DOC_META: Record<DocumentType, DocMeta> = {
  passport: { label: 'Passport', noun: 'passport', sub: 'Photo page · best for travel', icon: BookUser, colors: ['#0B3A5B', '#021B2B'] },
  drivingLicense: { label: "Driver's License", noun: "driver's license", sub: 'Front of the card', icon: Car, colors: ['#3A4A57', '#1A252E'] },
  idCard: { label: 'ID Card', noun: 'ID card', sub: 'Government-issued identity card', icon: IdCard, colors: ['#0E5A6E', '#06303B'] },
  greenCard: { label: 'US Green Card', noun: 'green card', sub: 'Permanent resident card', icon: CreditCard, colors: ['#1C6B5A', '#0A3A30'] },
  birthCertificate: { label: 'Birth Certificate', noun: 'birth certificate', sub: 'Document only · no face check', icon: ScrollText, colors: ['#5A6B78', '#34424D'] },
  usVisa: { label: 'U.S. Visa', noun: 'U.S. visa', sub: 'Visa foil in your passport', icon: Landmark, colors: ['#08B6FC', '#0574A8'] },
};

const FALLBACK_META: DocMeta = { label: 'Document', noun: 'document', sub: '', icon: FileText, colors: ['#3A4A57', '#1A252E'] };

export function docMeta(type?: string | null): DocMeta {
  return (type ? DOC_META[type as DocumentType] : undefined) ?? FALLBACK_META;
}

/* ───────────────────────── status / formatting ───────────────────────── */

export interface StatusBadgeSpec {
  label: string;
  tone: BadgeTone;
  icon?: LucideIcon;
  dot?: boolean;
}

/** Same status vocabulary as the old kit's StatusBadge. `onDark` = on a card gradient. */
export function statusBadge(status?: string | null, onDark?: boolean): StatusBadgeSpec {
  const s = (status ?? '').toLowerCase();
  switch (s) {
    case 'verified':
      return { label: 'Verified', tone: onDark ? 'glass' : 'green', icon: ScanFace };
    case 'approved':
      return { label: 'Approved', tone: onDark ? 'glass' : 'green', icon: ScanFace };
    case 'pending':
      return { label: 'Pending', tone: 'amber', dot: true };
    case 'failed':
      return { label: 'Failed', tone: 'red', dot: true };
    case 'rejected':
      return { label: 'Rejected', tone: 'red', dot: true };
    case 'expired':
      return { label: 'Expired', tone: 'red', dot: true };
    default:
      return {
        label: s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—',
        tone: onDark ? 'glass' : 'neutral',
      };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parses the leading `YYYY-MM[-DD]` of an ISO string without timezone shifts. */
function ymd(v: string): { y: number; m: number; d: number | null } | null {
  const hit = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(v.trim());
  if (!hit) return null;
  const m = Number(hit[2]);
  if (m < 1 || m > 12) return null;
  return { y: Number(hit[1]), m, d: hit[3] ? Number(hit[3]) : null };
}

/** "Jan 2033" — raw value when it isn't ISO; null when empty. */
export function monthYear(v?: string | null): string | null {
  if (!v) return null;
  const p = ymd(v);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : v;
}

/** "12 Mar 2026" — raw value when it isn't ISO; "—" when empty. */
export function prettyDate(v?: string | null): string {
  if (!v) return '—';
  const p = ymd(v);
  if (!p || p.d == null) return v;
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "12 Mar 2026" for an ISO timestamp in the user's time zone (date-only
 *  strings as in prettyDate); "—" when empty. */
export function localDay(v?: string | null): string {
  if (!v) return '—';
  if (!/T\d/.test(v)) return prettyDate(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return prettyDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Match score → whole percent. The BFF sends 0–1; tolerate 0–100 too. */
export function matchPct(score?: number | string | null): number | null {
  if (score == null || score === '') return null;
  const n = typeof score === 'number' ? score : parseFloat(score);
  if (Number.isNaN(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
}

/* ───────────────────────── document card ───────────────────────── */

/** Small holographic chip in the corner of identity documents. */
function Chip3D() {
  return (
    <View style={{ width: 40, height: 30, borderRadius: 7, overflow: 'hidden' }}>
      <LinearGradient colors={['#E9F7FF', '#9FD9F5', '#F3E6C4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(10,30,42,0.2)' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 1, backgroundColor: 'rgba(10,30,42,0.2)' }} />
    </View>
  );
}

/**
 * Premium wallet card over a real document record — the approved DocCard
 * look, but every value comes from the API (no showcase fallbacks).
 */
export function DocumentCard({
  type,
  label,
  number,
  status,
  holder,
  expiresAt,
  issuer,
  badge,
  height = 196,
  style,
}: {
  type?: string | null;
  label: string;
  number?: string | null;
  status?: string | null;
  holder?: string | null;
  expiresAt?: string | null;
  /** Issuing state / nationality when the backend extracted one. */
  issuer?: string | null;
  /** Override the status badge (e.g. "Checking" while processing). */
  badge?: StatusBadgeSpec;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const meta = docMeta(type);
  const b = badge ?? statusBadge(status, true);
  const exp = monthYear(expiresAt);
  const sub = [holder || null, exp ? `Exp. ${exp}` : null].filter(Boolean).join(' · ');
  return (
    <View style={[{ borderRadius: R.xl }, SH.md, style]}>
      <View style={{ height, borderRadius: R.xl, overflow: 'hidden', padding: 20, justifyContent: 'space-between' }}>
        <LinearGradient colors={meta.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Guilloche size={340} opacity={0.08} style={{ right: -150, top: -150 }} />
        <Row between align="flex-start">
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.3, color: 'rgba(255,255,255,0.6)' }} numberOfLines={1}>
              {(issuer || 'Identity document').toUpperCase()}
            </Text>
            <Text style={{ fontFamily: F.bold, fontSize: 20, letterSpacing: -0.4, color: C.white }} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <Badge label={b.label} tone={b.tone} icon={b.icon} dot={b.dot} />
        </Row>
        <Row between align="flex-end">
          <View style={{ gap: 4, flex: 1 }}>
            {!!number && (
              <Text style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: 2, color: C.white }} numberOfLines={1}>
                {number}
              </Text>
            )}
            {!!sub && (
              <Text style={{ fontFamily: F.medium, fontSize: 12, color: 'rgba(255,255,255,0.6)' }} numberOfLines={1}>
                {sub}
              </Text>
            )}
          </View>
          <Chip3D />
        </Row>
      </View>
    </View>
  );
}

/* ───────────────────────── flip card ───────────────────────── */

/**
 * Card ↔ captured scan. Same spring + rotateY/backface pattern the original
 * verified/[id] screens used.
 *
 * Once the scan has loaded, BOTH sides take the scan's shape: the frame is
 * the card's width and the scan's height-for-that-width. The scan then fills
 * it exactly (no crop, no stretch, no filler), and flipping never changes the
 * height, so the page below doesn't jump. `front` can be a function of that
 * height so the credential card matches it.
 */
export function FlipCard({
  flipped,
  front,
  scanUri,
  height = 196,
  style,
  noScan,
}: {
  flipped: boolean;
  front: ReactNode | ((height: number) => ReactNode);
  scanUri?: string | null;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Back face when there's no scan (default: "Original scan not available"). */
  noScan?: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const frameHeight =
    scanUri && width > 0 && ratio ? Math.min(Math.max(Math.round(width / ratio), height * 0.75), height * 1.6) : height;
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(anim, { toValue: flipped ? 1 : 0, useNativeDriver: true, friction: 8, tension: 10 }).start();
  }, [anim, flipped]);
  const frontRot = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRot = anim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  return (
    <View style={[{ height: frameHeight }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View
        accessibilityElementsHidden={flipped}
        importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'}
        style={{
          height: frameHeight,
          transform: [{ perspective: 1000 }, { rotateY: frontRot }],
          backfaceVisibility: 'hidden',
          zIndex: flipped ? 0 : 1,
        }}
      >
        {typeof front === 'function' ? front(frameHeight) : front}
      </Animated.View>
      <Animated.View
        accessibilityElementsHidden={!flipped}
        importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: R.xl,
            overflow: 'hidden',
            backgroundColor: C.sunken,
            borderWidth: 1,
            borderColor: C.line,
            transform: [{ perspective: 1000 }, { rotateY: backRot }],
            backfaceVisibility: 'hidden',
            zIndex: flipped ? 1 : 0,
          },
        ]}
      >
        {scanUri ? (
          <Image
            source={{ uri: scanUri }}
            style={StyleSheet.absoluteFill}
            // The frame takes the scan's shape within its height limits; a
            // scan taller than that (an A4 page) is shown whole, never cropped.
            contentFit="contain"
            cachePolicy="memory"
            accessibilityLabel="Document scan"
            onLoad={(e) => {
              const { width: w, height: h } = e.source;
              if (w > 0 && h > 0) setRatio(w / h);
            }}
          />
        ) : (
          noScan ?? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FileText size={34} color={C.ink4} strokeWidth={1.6} />
              <Txt v="small" color={C.ink3}>
                Original scan not available
              </Txt>
            </View>
          )
        )}
      </Animated.View>
    </View>
  );
}

/* ───────────────────────── document images ───────────────────────── */

const IMAGE_PARTS: { key: keyof DocumentImages; label: string; icon: LucideIcon; fit: 'cover' | 'contain' }[] = [
  { key: 'front', label: 'Front', icon: FileText, fit: 'cover' },
  { key: 'back', label: 'Back', icon: FileText, fit: 'cover' },
  { key: 'selfie', label: 'Selfie', icon: ScanFace, fit: 'contain' },
  { key: 'portrait', label: 'Photo on document', icon: UserRound, fit: 'contain' },
];

/**
 * GET /documents/{id}/images as a 2×2 grid — front, back, selfie, portrait.
 * Each part is a signed, expiring URL or null (placeholder). Images are kept
 * in memory only, never in the disk cache.
 */
export function DocumentImageGrid({ images, loading }: { images?: DocumentImages | null; loading?: boolean }) {
  const tile = (p: (typeof IMAGE_PARTS)[number]) => {
    const url = images?.[p.key]?.url;
    return (
      <View key={p.key} style={{ flex: 1, gap: 6 }}>
        {loading && !images ? (
          <Bone h={96} r={R.md} />
        ) : (
          <View
            style={{
              height: 96,
              borderRadius: R.md,
              overflow: 'hidden',
              backgroundColor: C.sunken,
              borderWidth: 1,
              borderColor: C.lineSoft,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}>
            {url ? (
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit={p.fit} cachePolicy="memory" accessibilityLabel={p.label} />
            ) : (
              <>
                <p.icon size={22} color={C.ink4} strokeWidth={1.6} />
                <Txt v="small" color={C.ink4}>
                  Not available
                </Txt>
              </>
            )}
          </View>
        )}
        <Txt v="small" color={C.ink3} style={{ marginLeft: 2 }}>
          {p.label}
        </Txt>
      </View>
    );
  };
  return (
    <Card pad={14} style={{ gap: 12 }}>
      <Row gap={12} align="flex-start">
        {IMAGE_PARTS.slice(0, 2).map(tile)}
      </Row>
      <Row gap={12} align="flex-start">
        {IMAGE_PARTS.slice(2).map(tile)}
      </Row>
    </Card>
  );
}

/* ───────────────────────── match ring ───────────────────────── */

/** Confidence ring (percent) with a label — premium ConfidenceRing. */
export function MatchRing({
  value,
  label = 'Match confidence',
  sub,
  right,
  children,
}: {
  value: number;
  label?: string;
  sub?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const size = 78;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <Card>
      <View style={{ gap: 16 }}>
        <Row gap={16}>
          <View
            style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${label} ${value}%`}
          >
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.skyWash} strokeWidth={stroke} fill="none" />
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={C.sky}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${(circ * v) / 100} ${circ}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </Svg>
            <Text style={{ fontFamily: F.extrabold, fontSize: 18, letterSpacing: -0.4, color: C.ink }}>{value}%</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="bodyStrong">{label}</Txt>
            {!!sub && <Txt v="small">{sub}</Txt>}
          </View>
          {right}
        </Row>
        {children}
      </View>
    </Card>
  );
}

/* ───────────────────────── processing steps ───────────────────────── */

function Spin({ children }: { children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [v]);
  return <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>{children}</Animated.View>;
}

export type FlowStepState = 'done' | 'active' | 'todo' | 'failed';

/** ProcessingView's step card, plus a `failed` state for the step that broke. */
export function StepList({ steps }: { steps: { label: string; detail?: string; state: FlowStepState }[] }) {
  return (
    <Card pad={6} style={{ paddingHorizontal: 18 }}>
      {steps.map((s, i) => (
        <View
          key={s.label}
          accessible
          accessibilityLabel={`${s.label}: ${s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : s.state === 'failed' ? 'failed' : 'pending'}`}
          style={{ flexDirection: 'row', gap: 14, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.lineSoft, alignItems: 'center' }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s.state === 'done' ? C.sky : s.state === 'active' ? C.skyWash : s.state === 'failed' ? C.redWash : C.sunken,
            }}
          >
            {s.state === 'done' ? (
              <Check size={16} color={C.white} strokeWidth={3} />
            ) : s.state === 'active' ? (
              <Spin>
                <Loader size={16} color={C.skyPressed} strokeWidth={2.6} />
              </Spin>
            ) : s.state === 'failed' ? (
              <X size={16} color={C.redInk} strokeWidth={3} />
            ) : (
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.ink4 }} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="bodyStrong" color={s.state === 'todo' ? C.ink3 : s.state === 'failed' ? C.redInk : C.ink}>
              {s.label}
            </Txt>
            {s.detail != null && <Txt v="small">{s.detail}</Txt>}
          </View>
          {s.state === 'done' && (
            <Txt v="small" color={C.green}>
              Done
            </Txt>
          )}
          {s.state === 'failed' && (
            <Txt v="small" color={C.redInk}>
              Failed
            </Txt>
          )}
        </View>
      ))}
    </Card>
  );
}

/* ───────────────────────── scan hero ───────────────────────── */

/** The captured document photo, tilted, with a sky scan beam while `scanning`.
 *  Shaped like the photo once it loads (a portrait A4 page stands tall, a
 *  card lies flat) and shown whole: never cropped, never turned. */
export function ScanHero({
  uri,
  scanning,
  width = 300,
  height: initialHeight = 190,
}: {
  uri: string;
  scanning?: boolean;
  width?: number;
  height?: number;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const height = ratio ? Math.min(Math.max(Math.round(width / ratio), 150), 440) : initialHeight;
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    l.start();
    return () => l.stop();
  }, [v]);
  const y = v.interpolate({ inputRange: [0, 1], outputRange: [-20, height - 26] });
  return (
    <View style={[{ width, height, borderRadius: R.xl, transform: [{ rotate: '-4deg' }] }, SH.lg]}>
      <View style={{ width, height, borderRadius: R.xl, overflow: 'hidden', backgroundColor: C.navyNight }}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          accessibilityLabel="Captured document"
          onLoad={(e) => {
            const { width: w, height: h } = e.source;
            if (w > 0 && h > 0) setRatio(w / h);
          }}
        />
        {scanning && (
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: y }] }}>
            <LinearGradient colors={['rgba(8,182,252,0)', 'rgba(8,182,252,0.4)', 'rgba(8,182,252,0)']} style={{ height: 46 }} />
            <View style={{ position: 'absolute', top: 22, left: 0, right: 0, height: 2, backgroundColor: C.sky }} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}
