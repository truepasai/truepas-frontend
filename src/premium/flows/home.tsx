/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — main-tab flow pieces backed by REAL data:
 * Booking → journey hero / carousel card / list row adapters, the wallet
 * document card, the contract-status badge and the Home profile drawer.
 *
 * Shared premium primitives (ui / kit / blocks) are reused as-is; the bits
 * here exist because blocks.tsx's Trip / Doc shapes are showcase-only (bundled
 * photos, invented fields) and don't fit the API types.
 */
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Baby,
  BedDouble,
  CalendarDays,
  Check,
  CircleHelp,
  CircleX,
  Clapperboard,
  FerrisWheel,
  FileCheck,
  FileText,
  Heart,
  Info,
  KeyRound,
  Lock,
  LogOut,
  type LucideIcon,
  Mail,
  MapPin,
  Music,
  Pencil,
  Phone,
  Plane,
  ScanFace,
  Settings,
  ShieldCheck,
  Ship,
  Sparkles,
  Ticket,
  Trash2,
  TriangleAlert,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLogoutFlow } from '@/features/auth/useLogoutFlow';
import { displayDocNumber } from '@/features/documents/format';
import { useMemberPhoto } from '@/features/family/hooks';
import { useProfilePicture } from '@/features/profile/hooks';
import { Guilloche } from '@/premium/blocks';
import { IMG, type ImgKey } from '@/premium/images';
import { ComingSoon, ConfirmSheet } from '@/premium/kit';
import { C, F, G, R, SH } from '@/premium/theme';
import { Avatar, Badge, type BadgeTone, Button, Card, Group, IconCircle, ListRow, Press, Row, Tile, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type {
  ActivityItem,
  ActivityType,
  Booking,
  BookingKind,
  DocumentType,
  FamilyMember,
  IdentityDocument,
  VerificationStatus,
} from '@/types/domain';

/* ───────────────────────── formatting ───────────────────────── */

/** ISO or date-only → Date. Date-only strings are pinned to midday so they
 *  don't slip a day in negative-UTC time zones (design-repo formatCheckIn). */
function toDate(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN);
  return new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
}

/** "Jul 21, 2026" — falls back to the raw string when unparsable. */
export function fmtDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime())
    ? iso || '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Thu, 2 Oct" */
export function fmtDay(iso: string | null | undefined): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime())
    ? iso || '—'
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayDiff(iso: string | null | undefined): number | null {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return null;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
}

/** "Today" / "Tomorrow" / "Thu, 2 Oct". */
export function whenLabel(iso: string | null | undefined): string {
  const diff = dayDiff(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return fmtDay(iso);
}

export function isTodayIso(iso: string): boolean {
  return dayDiff(iso) === 0;
}

/** Booking amount — same rendering as the original BookingCard. Reservations
 *  have no amount (null) -> "—". */
export function money(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "May 2032" — for document expiry. */
export function fmtMonthYear(iso: string): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? iso || '—' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "September" (this year) / "September 2025" — list grouping headers. */
export function fmtMonthLabel(iso: string): string {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

export function yearOf(iso: string | null | undefined): number | null {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

/** Match score → whole percent. The API has sent both 0–1 and 0–100. */
export function matchPct(score: number): number {
  return Math.round(score <= 1 ? score * 100 : score);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/* ───────────────────────── status badges ───────────────────────── */

/** Contract status → premium badge. Same tone + copy table as the app's
 *  StatusChip so wording stays identical across screens. */
const STATUS: Record<string, [BadgeTone, string]> = {
  verified: ['green', 'Verified'],
  approved: ['green', 'Approved'],
  completed: ['green', 'Completed'],
  active: ['green', 'Active'],
  upcoming: ['sky', 'Upcoming'],
  pending: ['amber', 'Pending'],
  pending_document: ['amber', 'Document needed'],
  pending_liveness: ['amber', 'Liveness needed'],
  missing: ['neutral', 'Not added yet'],
  incomplete: ['neutral', 'Incomplete'],
  failed: ['red', 'Failed'],
  rejected: ['red', 'Rejected'],
  cancelled: ['neutral', 'Cancelled'],
  expired: ['red', 'Expired'],
};

export function statusTone(status: string): BadgeTone {
  return STATUS[status.toLowerCase()]?.[0] ?? 'neutral';
}

export function statusLabel(status: string): string {
  return STATUS[status.toLowerCase()]?.[1] ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, dot }: { status: string; dot?: boolean }) {
  return <Badge label={statusLabel(status)} tone={statusTone(status)} dot={dot} />;
}

/** Tile tone for a verification status (check rows). */
export function statusTileTone(status: string): 'green' | 'amber' | 'red' | 'neutral' {
  const t = statusTone(status);
  return t === 'green' || t === 'amber' || t === 'red' ? t : 'neutral';
}

/* ───────────────────────── bookings ───────────────────────── */

/** Venue kinds the API sends in Booking.kind — label, icon and the bundled
 *  category photo. Also the chips of the reservation form. */
export const KIND_META: Record<BookingKind, { label: string; icon: LucideIcon; photo: ImgKey | null }> = {
  hotel: { label: 'Hotel', icon: BedDouble, photo: 'hotelDusk' },
  park: { label: 'Theme park', icon: FerrisWheel, photo: 'themepark' },
  flight: { label: 'Flight', icon: Plane, photo: 'flight' },
  cinema: { label: 'Cinema', icon: Clapperboard, photo: 'cinema' },
  cruise: { label: 'Cruise', icon: Ship, photo: 'cruise' },
  stadium: { label: 'Stadium', icon: Trophy, photo: 'stadium' },
  concert: { label: 'Concert', icon: Music, photo: 'concert' },
  other: { label: 'Other', icon: CalendarDays, photo: null },
};

export const BOOKING_KINDS = Object.keys(KIND_META) as BookingKind[];

/** Older payloads sent the venue type as a free string in `type` ("Hotel",
 *  "Theme Park"…) — match loosely, never invent a kind the API didn't send. */
function kindFromType(type: string | null | undefined): BookingKind {
  const t = (type ?? '').toLowerCase();
  if (t.includes('hotel')) return 'hotel';
  if (t.includes('flight')) return 'flight';
  if (t.includes('park')) return 'park';
  if (t.includes('cruise')) return 'cruise';
  if (t.includes('cinema') || t.includes('movie')) return 'cinema';
  if (t.includes('stadium')) return 'stadium';
  if (t.includes('concert') || t.includes('event')) return 'concert';
  return 'other';
}

/** `kind` on Oct 2026 payloads (where `type` is reservation/checkin);
 *  older payloads carried the venue type in `type`. */
export function bookingKind(b: Pick<Booking, 'kind' | 'type'>): BookingKind {
  return b.kind && b.kind in KIND_META ? b.kind : kindFromType(b.type);
}

export function bookingIcon(b: Pick<Booking, 'kind' | 'type'>): LucideIcon {
  return KIND_META[bookingKind(b)].icon;
}

/** Icon for a booking kind as an element (avoids creating components in render). */
export function BookingKindIcon({ b, size = 16, color = C.ink }: { b: Pick<Booking, 'kind' | 'type'>; size?: number; color?: string }) {
  const Icon = KIND_META[bookingKind(b)].icon;
  return <Icon size={size} color={color} />;
}

const ROW_TYPES = ['reservation', 'checkin', 'check-in', 'check_in'];

/** "Hotel", "Theme park"… For kind `other`: an older payload's own venue
 *  type, else what the row is (reservation or kiosk check-in). */
export function bookingKindLabel(b: Pick<Booking, 'kind' | 'type' | 'source'>): string {
  const kind = bookingKind(b);
  if (kind !== 'other') return KIND_META[kind].label;
  const t = (b.type ?? '').trim();
  if (t && !ROW_TYPES.includes(t.toLowerCase())) return t[0].toUpperCase() + t.slice(1);
  return b.source === 'customer' || t.toLowerCase() === 'reservation' ? 'Reservation' : 'Check-in';
}

/** "Venue, Location" — location is optional on reservations. */
export function bookingPlace(b: Pick<Booking, 'venue' | 'location'>): string {
  return [b.venue, b.location].filter((s) => !!s?.trim()).join(', ');
}

/** When the visit happened (kiosk time) or is planned (check-in day) —
 *  for sorting and month grouping. */
export function bookingWhen(b: Pick<Booking, 'checkedInAt' | 'checkIn'>): string {
  return b.checkedInAt || b.checkIn;
}

/** Bookings use a neutral "Expired" (a reservation nobody checked in to),
 *  unlike an expired document. */
export function bookingStatusTone(status: string): BadgeTone {
  return status === 'expired' ? 'neutral' : statusTone(status);
}

export function BookingStatusBadge({ status, dot }: { status: string; dot?: boolean }) {
  return <Badge label={statusLabel(status)} tone={bookingStatusTone(status)} dot={dot} />;
}

/** Local calendar day as YYYY-MM-DD (reservation dates are local days). */
export function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2:05 PM" in the user's time zone. */
export function fmtTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Kiosk timing: 820 → "0.8 s", 12400 → "12 s". */
export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

const isUrl = (s?: string | null): s is string => !!s && /^https?:\/\//.test(s);

/**
 * Venue imagery: the booking's own photo when the API sends a URL; otherwise
 * a category photo for known kinds; otherwise a navy gradient + icon.
 */
export function BookingBackdrop({ b, iconSize = 44 }: { b: Booking; iconSize?: number }) {
  const meta = KIND_META[bookingKind(b)];
  if (isUrl(b.image)) {
    return <Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />;
  }
  if (meta.photo) {
    return <Image source={IMG[meta.photo]} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />;
  }
  const Icon = meta.icon;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Guilloche size={320} opacity={0.08} style={{ right: -140, top: -140 }} />
      <Icon size={iconSize} color="rgba(255,255,255,0.35)" strokeWidth={1.6} />
    </View>
  );
}

function GlassChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 30,
        paddingHorizontal: 12,
        borderRadius: R.full,
        backgroundColor: 'rgba(10,30,42,0.42)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        alignSelf: 'flex-start',
      }}
    >
      <Icon size={14} color={C.white} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.semibold, fontSize: 12.5, color: C.white }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function checkedIn(b: Booking) {
  const n = (b.checkedInMembers ?? []).length;
  return { n, progress: Math.min(1, n / Math.max(b.guests, 1)) };
}

/** Shared photo shell for the Home hero — the booking hero and the
 *  no-trips "get ready" hero render inside the same card. */
function HeroFrame({
  backdrop,
  top,
  children,
  onPress,
  label,
  role,
}: {
  backdrop: ReactNode;
  top: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  label: string;
  role?: 'button';
}) {
  const body = (
    <View style={{ minHeight: 420, borderRadius: R.xxl, overflow: 'hidden', justifyContent: 'space-between', padding: 18, gap: 24 }}>
      {backdrop}
      <LinearGradient colors={G.photoFade} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
      {top}
      <View style={{ gap: 14 }}>{children}</View>
    </View>
  );
  if (!onPress) {
    return <View style={[{ borderRadius: R.xxl }, SH.lg]}>{body}</View>;
  }
  return (
    <Press onPress={onPress} scaleTo={0.985} label={label} role={role} style={[{ borderRadius: R.xxl }, SH.lg]}>
      {body}
    </Press>
  );
}

/** Soft shadow so hero copy stays legible over bright photos. */
const HERO_SHADOW = { textShadowColor: 'rgba(1,27,39,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 } as const;

function HeroTitle({ eyebrow, title, sub, pin }: { eyebrow: string; title: string; sub: string; pin?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.skyLight, ...HERO_SHADOW }}>{eyebrow}</Text>
      <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -0.9, color: C.white, ...HERO_SHADOW }} numberOfLines={2}>
        {title}
      </Text>
      {!!sub && (
        <Row gap={6}>
          {pin && <MapPin size={14} color="rgba(255,255,255,0.78)" />}
          <Text
            style={{ fontFamily: F.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.85)', flexShrink: 1, ...HERO_SHADOW }}
            numberOfLines={pin ? 1 : 3}
          >
            {sub}
          </Text>
        </Row>
      )}
    </View>
  );
}

function GlassPanel({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        borderRadius: R.lg,
        padding: 14,
        gap: 12,
        backgroundColor: 'rgba(10,30,42,0.42)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.16)',
      }}
    >
      {children}
    </View>
  );
}

function GlassProgress({ label, value, progress }: { label: string; value: string; progress: number }) {
  return (
    <View style={{ gap: 6 }}>
      <Row between>
        <Text style={{ fontFamily: F.medium, fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{label}</Text>
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.white }}>{value}</Text>
      </Row>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
        <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, backgroundColor: C.sky }} />
      </View>
    </View>
  );
}

/** Hero journey for the next upcoming booking (Home "Today" / "Next").
 *  Check-in happens only at the venue kiosk, so the card carries a plain
 *  hint, never a check-in button. Reservations have no amount; the third
 *  fact is then the check-out day (when set). */
export function BookingHero({ b, onPress }: { b: Booking; onPress?: () => void }) {
  const Icon = bookingIcon(b);
  const { n, progress } = checkedIn(b);
  const facts: { k: string; v: string }[] = [{ k: 'Check-in', v: fmtDate(b.checkIn) }];
  if (b.amount == null && b.checkOut) facts.push({ k: 'Check-out', v: fmtDate(b.checkOut) });
  facts.push({ k: 'Guests', v: String(b.guests) });
  if (b.amount != null) facts.push({ k: 'Total', v: money(b.amount) });
  return (
    <HeroFrame
      onPress={onPress}
      label={`Next check-in at ${bookingPlace(b)}`}
      role="button"
      backdrop={<BookingBackdrop b={b} iconSize={64} />}
      top={
        <Row between>
          <GlassChip icon={Icon} label={bookingKindLabel(b)} />
          <BookingStatusBadge status={b.status} dot />
        </Row>
      }
    >
      <HeroTitle eyebrow={whenLabel(b.checkIn)} title={b.venue} sub={b.location} pin />
      <GlassPanel>
        <Row between>
          {facts.map((f, i) => (
            <GlassFact key={f.k} k={f.k} v={f.v} end={i === facts.length - 1 && facts.length > 1} />
          ))}
        </Row>
        <GlassProgress label="Checked in" value={`${n}/${b.guests}`} progress={progress} />
      </GlassPanel>
      {b.status === 'upcoming' && (
        <Row gap={8} style={{ paddingHorizontal: 4 }}>
          <ScanFace size={16} color={C.skyLight} />
          <Text style={{ fontFamily: F.semibold, fontSize: 13.5, color: 'rgba(255,255,255,0.88)', flexShrink: 1, ...HERO_SHADOW }}>
            Check in at the venue kiosk
          </Text>
        </Row>
      )}
    </HeroFrame>
  );
}

/* ───────────────────────── no-trips home ─────────────────────────
 * A new user has no bookings, so Today / Coming up would be empty. The same
 * photo cards carry the user's real setup progress and what TruePas is for,
 * never a made-up booking. Real bookings replace them as soon as they exist. */

export type ReadyStep = { label: string; done: boolean };

/** Same card as BookingHero, filled with the user's setup progress. */
export function ReadyHero({
  photo,
  chip,
  eyebrow,
  title,
  body,
  steps,
  cta,
}: {
  photo: ImgKey;
  chip: { icon: LucideIcon; label: string };
  eyebrow: string;
  title: string;
  body: string;
  steps: ReadyStep[];
  cta?: ReactNode;
}) {
  const done = steps.filter((x) => x.done).length;
  const all = done === steps.length;
  return (
    <HeroFrame
      label={title}
      backdrop={<Image source={IMG[photo]} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />}
      top={
        <Row between>
          <GlassChip icon={chip.icon} label={chip.label} />
          <Badge tone={all ? 'green' : 'sky'} dot label={all ? 'All set' : `${done} of ${steps.length} done`} />
        </Row>
      }
    >
      <HeroTitle eyebrow={eyebrow} title={title} sub={body} />
      <GlassPanel>
        <Row between>
          {steps.map((x) => (
            <GlassStep key={x.label} {...x} />
          ))}
        </Row>
        <GlassProgress label="Ready to travel" value={`${done}/${steps.length}`} progress={done / Math.max(steps.length, 1)} />
      </GlassPanel>
      {cta}
    </HeroFrame>
  );
}

function GlassStep({ label, done }: ReadyStep) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}
      accessible
      accessibilityLabel={`${label}, ${done ? 'done' : 'not done'}`}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? C.sky : 'transparent',
          borderWidth: done ? 0 : 1.5,
          borderColor: 'rgba(255,255,255,0.45)',
        }}
      >
        {done && <Check size={12} color={C.white} strokeWidth={3} />}
      </View>
      <Text style={{ fontFamily: F.semibold, fontSize: 13, color: done ? C.white : 'rgba(255,255,255,0.7)' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export type Venue = { photo: ImgKey; icon: LucideIcon; kind: string; title: string; body: string };

/** Where TruePas works — informational cards for the no-trips Home. */
export const VENUES: Venue[] = [
  { photo: 'hotelPool', icon: BedDouble, kind: 'Hotels', title: 'Skip the front desk', body: 'Check in with a look, not a form.' },
  { photo: 'themepark', icon: FerrisWheel, kind: 'Theme parks', title: 'Walk through the gate', body: 'No tickets to dig out at the turnstile.' },
  { photo: 'flight', icon: Plane, kind: 'Flights', title: 'Board without the fuss', body: 'Your verified ID travels with you.' },
  { photo: 'concert', icon: Ticket, kind: 'Events', title: 'Straight to your seat', body: 'Entry for you and your family together.' },
  { photo: 'cruise', icon: Ship, kind: 'Cruises', title: 'Board in seconds', body: 'One identity for the whole voyage.' },
];

/** Same card as BookingCarouselCard, with a venue category instead of a booking. */
export function VenueCard({ v, width = 248 }: { v: Venue; width?: number }) {
  return (
    <View accessible accessibilityLabel={`${v.kind}: ${v.title}. ${v.body}`} style={[{ width, borderRadius: R.xl }, SH.md]}>
      <View style={{ borderRadius: R.xl, overflow: 'hidden', backgroundColor: C.surface }}>
        <View style={{ height: 150 }}>
          <Image source={IMG[v.photo]} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          <View style={{ position: 'absolute', left: 12, top: 12 }}>
            <GlassChip icon={v.icon} label={v.kind} />
          </View>
        </View>
        <View style={{ padding: 14, gap: 3 }}>
          <Txt v="small" color={C.skyPressed} style={{ fontFamily: F.semibold }}>
            With TruePas
          </Txt>
          <Txt v="h3" lines={1}>
            {v.title}
          </Txt>
          <Txt v="small" lines={2}>
            {v.body}
          </Txt>
        </View>
      </View>
    </View>
  );
}

function GlassFact({ k, v, end }: { k: string; v: string; end?: boolean }) {
  return (
    <View style={{ gap: 2, alignItems: end ? 'flex-end' : 'flex-start', flexShrink: 1 }}>
      <Text style={{ fontFamily: F.medium, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>{k}</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.white }} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

/** Horizontal carousel card for further upcoming bookings. */
export function BookingCarouselCard({ b, onPress, width = 248 }: { b: Booking; onPress?: () => void; width?: number }) {
  const Icon = bookingIcon(b);
  const guests = `${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}`;
  const extra =
    b.amount != null ? money(b.amount) : b.checkOut && b.checkOut !== b.checkIn ? `Until ${fmtDay(b.checkOut)}` : null;
  return (
    <Press onPress={onPress} label={bookingPlace(b)} role="button" style={[{ width, borderRadius: R.xl }, SH.md]}>
      <View style={{ borderRadius: R.xl, overflow: 'hidden', backgroundColor: C.surface }}>
        <View style={{ height: 150 }}>
          <BookingBackdrop b={b} />
          <View style={{ position: 'absolute', left: 12, top: 12 }}>
            <GlassChip icon={Icon} label={bookingKindLabel(b)} />
          </View>
        </View>
        <View style={{ padding: 14, gap: 3 }}>
          <Txt v="small" color={C.skyPressed} style={{ fontFamily: F.semibold }}>
            {whenLabel(b.checkIn)}
          </Txt>
          <Txt v="h3" lines={1}>
            {b.venue}
          </Txt>
          <Txt v="small" lines={1}>
            {b.location || bookingKindLabel(b)}
          </Txt>
          <Txt v="small" color={C.ink4} lines={1}>
            {extra ? `${guests} · ${extra}` : guests}
          </Txt>
        </View>
      </View>
    </Press>
  );
}

/** Third line of a BookingRow: what happened (or is planned) for the visit. */
function rowDetail(b: Booking): string {
  const day = fmtDate(bookingWhen(b));
  if (b.status === 'upcoming') return `${day} · ${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}`;
  if (b.status === 'expired') return `${day} · No check-in`;
  const { n } = checkedIn(b);
  return `${day} · ${n}/${b.guests} checked in`;
}

/** Compact list row with thumbnail — history lists. */
export function BookingRow({ b, onPress }: { b: Booking; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${bookingPlace(b)}, ${statusLabel(b.status)}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
        <View style={{ width: 62, height: 62, borderRadius: 16, overflow: 'hidden' }}>
          <BookingBackdrop b={b} iconSize={22} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt v="bodyStrong" lines={1}>
            {b.venue}
          </Txt>
          <Txt v="small" lines={1}>
            {[bookingKindLabel(b), b.location].filter((s) => !!s?.trim()).join(' · ')}
          </Txt>
          <Txt v="small" color={C.ink4} lines={1}>
            {rowDetail(b)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <BookingStatusBadge status={b.status} />
          {b.amount != null && <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3 }}>{money(b.amount)}</Text>}
        </View>
      </View>
    </Pressable>
  );
}

/* ───────────────────────── travelling together ─────────────────────────
 * Home family card: overlapping avatar stack (you first, then members) with a
 * dashed Add button. With no members the stack shows placeholder circles for
 * the kinds of people you can add, never made-up photos. */

/** Initials tints so a stack of photo-less members still reads as people. */
const MEMBER_TINTS: readonly (readonly [string, string])[] = [
  [C.amberWash, C.amberInk],
  [C.greenWash, C.greenInk],
  ['#EEEAFB', '#4B3B8F'],
  [C.redWash, C.redInk],
];

const STACK_SIZE = 50;
const STACK_MAX = 3;

/** `z` keeps earlier avatars on top so each status dot stays visible. */
function StackSlot({ first, z, children }: { first?: boolean; z: number; children: ReactNode }) {
  return (
    <View
      style={{
        zIndex: z,
        marginLeft: first ? 0 : -14,
        borderRadius: STACK_SIZE / 2 + 3,
        borderWidth: 3,
        borderColor: C.surface,
        backgroundColor: C.surface,
      }}
    >
      {children}
    </View>
  );
}

function MemberAvatar({ m, tint }: { m: FamilyMember; tint: readonly [string, string] }) {
  const uri = useMemberPhoto(m.id);
  return <Avatar uri={uri} name={m.name} size={STACK_SIZE} tint={tint} status={m.faceEnrolled ? 'verified' : 'pending'} />;
}

function GhostCircle({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <View
      style={{
        width: STACK_SIZE,
        height: STACK_SIZE,
        borderRadius: STACK_SIZE / 2,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: C.ink4,
        backgroundColor: C.canvas,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={19} color={C.ink3} />
    </View>
  );
}

/** Compact you + family avatar stack, for cards outside Home. */
export function TravellerStack({
  you,
  members,
}: {
  you: { name?: string | null; uri?: string | null; faceEnrolled: boolean };
  members: FamilyMember[];
}) {
  const shown = members.slice(0, STACK_MAX);
  const extra = members.length - shown.length;
  return (
    <Row gap={0}>
      <StackSlot first z={9}>
        <Avatar uri={you.uri} name={you.name} size={STACK_SIZE} status={you.faceEnrolled ? 'verified' : 'pending'} />
      </StackSlot>
      {shown.map((m, i) => (
        <StackSlot key={m.id} z={8 - i}>
          <MemberAvatar m={m} tint={MEMBER_TINTS[i % MEMBER_TINTS.length]} />
        </StackSlot>
      ))}
      {extra > 0 && (
        <StackSlot z={0}>
          <View
            style={{
              width: STACK_SIZE,
              height: STACK_SIZE,
              borderRadius: STACK_SIZE / 2,
              backgroundColor: C.navy,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>+{extra}</Text>
          </View>
        </StackSlot>
      )}
    </Row>
  );
}

export function TogetherCard({
  members,
  you,
  onOpen,
  onAdd,
  onMember,
}: {
  members: FamilyMember[];
  you: { name?: string | null; uri?: string | null; faceEnrolled: boolean };
  onOpen: () => void;
  onAdd: () => void;
  onMember: (id: string) => void;
}) {
  const enrolled = members.filter((m) => m.faceEnrolled).length;
  const pending = members.filter((m) => !m.faceEnrolled);
  const shown = members.slice(0, STACK_MAX);
  const extra = members.length - shown.length;
  const empty = members.length === 0;

  const stackLabel = empty
    ? 'Family, no members yet'
    : `Family, ${members.length} member${members.length === 1 ? '' : 's'}, ${enrolled} face enrolled`;

  return (
    <Card pad={18}>
      <Row between>
        <Press onPress={onOpen} label={stackLabel} role="button" style={{ flexShrink: 1 }}>
          <Row gap={0}>
            <StackSlot first z={9}>
              <Avatar uri={you.uri} name={you.name} size={STACK_SIZE} status={you.faceEnrolled ? 'verified' : 'pending'} />
            </StackSlot>
            {empty ? (
              <>
                <StackSlot z={3}>
                  <GhostCircle icon={Heart} />
                </StackSlot>
                <StackSlot z={2}>
                  <GhostCircle icon={Baby} />
                </StackSlot>
                <StackSlot z={1}>
                  <GhostCircle icon={UserRound} />
                </StackSlot>
              </>
            ) : (
              shown.map((m, i) => (
                <StackSlot key={m.id} z={8 - i}>
                  <MemberAvatar m={m} tint={MEMBER_TINTS[i % MEMBER_TINTS.length]} />
                </StackSlot>
              ))
            )}
            {extra > 0 && (
              <StackSlot z={0}>
                <View
                  style={{
                    width: STACK_SIZE,
                    height: STACK_SIZE,
                    borderRadius: STACK_SIZE / 2,
                    backgroundColor: C.navy,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>+{extra}</Text>
                </View>
              </StackSlot>
            )}
          </Row>
        </Press>
        <Press onPress={onAdd} label="Add family member" role="button">
          <View
            style={{
              width: STACK_SIZE,
              height: STACK_SIZE,
              borderRadius: STACK_SIZE / 2,
              backgroundColor: C.skyWash,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: C.sky,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UserPlus size={20} color={C.skyPressed} />
          </View>
        </Press>
      </Row>

      <View style={{ height: 1, backgroundColor: C.line, marginVertical: 16 }} />

      {empty ? (
        <Row between gap={12}>
          <View style={{ gap: 2, flex: 1 }}>
            <Txt v="bodyStrong">Add your family</Txt>
            <Txt v="small">Check in together: kids, partner and parents.</Txt>
          </View>
          <Button label="Add" icon={UserPlus} size="sm" tone="soft" full={false} onPress={onAdd} />
        </Row>
      ) : (
        <View style={{ gap: 12 }}>
          <Row between gap={12}>
            <View style={{ gap: 2, flex: 1 }}>
              <Txt v="bodyStrong">
                {members.length} family member{members.length === 1 ? '' : 's'}
              </Txt>
              <Txt v="small" lines={2}>
                {pending.length === 0
                  ? 'All faces enrolled · ready to go'
                  : pending.length === 1
                    ? `${pending[0].name.split(' ')[0]} needs a face scan`
                    : `${pending.length} members need a face scan`}
              </Txt>
            </View>
            {pending.length === 0 ? (
              <Badge tone="green" icon={Check} label="Ready" />
            ) : (
              <Button label="Finish" size="sm" tone="soft" full={false} onPress={() => onMember(pending[0].id)} />
            )}
          </Row>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden' }}>
            <View
              style={{
                width: `${(enrolled / members.length) * 100}%`,
                height: '100%',
                backgroundColor: pending.length === 0 ? C.green : C.sky,
                borderRadius: 3,
              }}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

/* ───────────────────────── recent activity ─────────────────────────
 * Before the first check-in, "Recent check-ins" shows the account's real
 * activity (server identity activity, documents, family) in the same row
 * look as BookingRow, under a "Your first check-in" placeholder row. */

type TileTone = 'sky' | 'green' | 'amber' | 'red' | 'neutral';

export type ActivityEntry = {
  id: string;
  icon: LucideIcon;
  tone: TileTone;
  title: string;
  sub: string;
  badge: { label: string; tone: BadgeTone };
  href: string;
};

const SERVER_TONE: Record<ActivityItem['tone'], { icon: LucideIcon; tone: TileTone; badge: { label: string; tone: BadgeTone } }> = {
  success: { icon: ShieldCheck, tone: 'green', badge: { label: 'Done', tone: 'green' } },
  warning: { icon: TriangleAlert, tone: 'amber', badge: { label: 'Needs attention', tone: 'amber' } },
  error: { icon: CircleX, tone: 'red', badge: { label: 'Failed', tone: 'red' } },
  neutral: { icon: ShieldCheck, tone: 'sky', badge: { label: 'Done', tone: 'sky' } },
};

/** Server feed (GET /user/me/activity): icon + badge copy per event type;
 *  the colour comes from the server's tone. */
const FEED_TYPE: Record<ActivityType, { icon: LucideIcon; badge: string }> = {
  face_enrolled: { icon: ScanFace, badge: 'Done' },
  document_added: { icon: FileText, badge: 'Added' },
  document_verified: { icon: FileCheck, badge: 'Verified' },
  document_failed: { icon: FileText, badge: 'Failed' },
  family_member_added: { icon: Users, badge: 'Added' },
  family_face_enrolled: { icon: ScanFace, badge: 'Face enrolled' },
  check_in: { icon: MapPin, badge: 'Checked in' },
  password_changed: { icon: Lock, badge: 'Changed' },
  pin_changed: { icon: KeyRound, badge: 'Changed' },
};

const FEED_TONE: Record<ActivityItem['tone'], TileTone & BadgeTone> = {
  success: 'green',
  warning: 'amber',
  error: 'red',
  neutral: 'sky',
};

/** Deep link for a feed item's `ref` (document, family member or booking). */
export function activityHref(a: Pick<ActivityItem, 'ref' | 'type'>): string {
  if (a.ref?.documentId) return `/document/${a.ref.documentId}`;
  if (a.ref?.personId) return `/family/${a.ref.personId}`;
  if (a.ref?.bookingId) return `/booking/${a.ref.bookingId}`;
  if (a.type === 'password_changed' || a.type === 'pin_changed') return '/security';
  return '/identity';
}

/** Server activity feed → the same rows as buildActivity. Title and the
 *  locally formatted time are used as sent. */
export function feedActivity(items: ActivityItem[]): ActivityEntry[] {
  return items.map((a) => {
    const t = a.type ? FEED_TYPE[a.type] : undefined;
    const fallback = SERVER_TONE[a.tone] ?? SERVER_TONE.neutral;
    const tone = FEED_TONE[a.tone] ?? 'sky';
    return {
      id: `feed-${a.id}`,
      icon: t?.icon ?? fallback.icon,
      tone,
      title: a.title,
      sub: a.timestamp,
      badge: t ? { label: t.badge, tone } : fallback.badge,
      href: activityHref(a),
    };
  });
}

const DOC_ACTIVITY: Partial<Record<VerificationStatus, { verb: string; tone: TileTone; badge: { label: string; tone: BadgeTone } }>> = {
  verified: { verb: 'verified', tone: 'green', badge: { label: 'Verified', tone: 'green' } },
  pending: { verb: 'added', tone: 'sky', badge: { label: 'Added', tone: 'sky' } },
  failed: { verb: 'check failed', tone: 'red', badge: { label: 'Failed', tone: 'red' } },
};

/** Real account events, newest sources first; never invents a check-in. */
export function buildActivity({
  server,
  faceEnrolled,
  docs,
  members,
  firstName,
}: {
  server: ActivityItem[];
  faceEnrolled: boolean;
  docs: IdentityDocument[];
  members: FamilyMember[];
  firstName: string;
}): ActivityEntry[] {
  const out: ActivityEntry[] = server.map((a) => ({
    id: `srv-${a.id}`,
    ...SERVER_TONE[a.tone],
    title: a.title,
    sub: a.timestamp,
    href: activityHref(a),
  }));
  if (server.length === 0 && faceEnrolled) {
    out.push({
      id: 'face',
      icon: ScanFace,
      tone: 'green',
      title: 'Face enrolled',
      sub: 'Your face is your key',
      badge: { label: 'Done', tone: 'green' },
      href: '/identity',
    });
  }
  [...docs]
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .forEach((d) => {
      const meta = DOC_ACTIVITY[d.status];
      if (!meta) return;
      out.push({
        id: `doc-${d.id}`,
        icon: FileCheck,
        tone: meta.tone,
        title: `${docStyle(d.type).title} ${meta.verb}`,
        sub: d.addedAt ? `Added ${fmtDate(d.addedAt)}` : 'Identity document',
        badge: meta.badge,
        href: `/document/${d.id}`,
      });
    });
  members.forEach((m) => {
    out.push({
      id: `fam-${m.id}`,
      icon: Users,
      tone: 'sky',
      title: `${m.name.split(' ')[0]} added to family`,
      sub: `${m.relationship} · ${m.age} yrs`,
      badge: m.faceEnrolled ? { label: 'Face enrolled', tone: 'green' } : { label: 'Face pending', tone: 'amber' },
      href: `/family/${m.id}`,
    });
  });
  // Oldest event: every signed-in user has it.
  out.push({
    id: 'joined',
    icon: Sparkles,
    tone: 'sky',
    title: 'Joined TruePas',
    sub: firstName ? `Welcome aboard, ${firstName}` : 'Welcome aboard',
    badge: { label: 'Welcome', tone: 'sky' },
    href: '/identity',
  });
  return out;
}

/** Same layout as BookingRow: 62px tile, two lines, badge on the right. */
export function ActivityRow({ e, onPress }: { e: ActivityEntry; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${e.title}, ${e.badge.label}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
        <Tile icon={e.icon} tone={e.tone} size={62} radius={16} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt v="bodyStrong" lines={2}>
            {e.title}
          </Txt>
          <Txt v="small" lines={1}>
            {e.sub}
          </Txt>
        </View>
        <Badge label={e.badge.label} tone={e.badge.tone} />
      </View>
    </Pressable>
  );
}

/** Placeholder for where the first real check-in will land. */
export function FirstCheckInRow() {
  return (
    <View
      accessible
      accessibilityLabel="Your first check-in will show up here after your first visit"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 16,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: C.ink4,
          backgroundColor: C.canvas,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MapPin size={22} color={C.ink3} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt v="bodyStrong" lines={1}>
          Your first check-in
        </Txt>
        <Txt v="small" lines={2}>
          Shows up here after your first visit
        </Txt>
      </View>
      <Badge label="Waiting" tone="neutral" />
    </View>
  );
}

/* ───────────────────────── coming-soon helpers ───────────────────────── */

/** A dimmed, non-interactive action with a "Coming soon" tag on its edge —
 *  for approved-design CTAs that have no backend yet. */
export function SoonAction({ children, light, style }: { children: ReactNode; light?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} accessibilityState={{ disabled: true }} accessibilityHint="Coming soon">
      <View pointerEvents="none" style={{ opacity: 0.55 }}>
        {children}
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: -11, right: 14 }}>
        <ComingSoon light={light} />
      </View>
    </View>
  );
}

/* ───────────────────────── wallet documents ───────────────────────── */

export const DOC_STYLE: Record<DocumentType, { title: string; colors: readonly [string, string] }> = {
  passport: { title: 'Passport', colors: ['#0B3A5B', '#021B2B'] },
  idCard: { title: 'ID card', colors: ['#08B6FC', '#0574A8'] },
  drivingLicense: { title: "Driver's license", colors: ['#3A4A57', '#1A252E'] },
  greenCard: { title: 'US Green Card', colors: ['#0F5E6E', '#06323B'] },
  birthCertificate: { title: 'Birth certificate', colors: ['#5A6B78', '#34424D'] },
  usVisa: { title: 'U.S. Visa', colors: ['#2B3F73', '#141F3D'] },
};

const DOC_FALLBACK = { title: 'Document', colors: ['#5A6B78', '#34424D'] as const };

export function docStyle(type: string) {
  return DOC_STYLE[type as DocumentType] ?? DOC_FALLBACK;
}

/** Height of the part of a wallet card that stays visible when stacked. */
export const WALLET_PEEK = 104;
export const WALLET_CARD_H = 204;

function walletBadge(status: string) {
  if (status === 'verified') return <Badge label="Verified" tone="glass" icon={ScanFace} />;
  return <Badge label={statusLabel(status)} tone={statusTone(status) === 'green' ? 'glass' : statusTone(status)} dot />;
}

/** Real IdentityDocument as a wallet card (fanned-stack look). The top
 *  WALLET_PEEK px carry title, number, expiry, status and match score so
 *  every card stays readable when stacked. */
export function WalletCard({ d, onPress, style }: { d: IdentityDocument; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const s = docStyle(d.type);
  const issuer = (d.issuingState ?? s.title).toUpperCase();
  const expiry = d.expiresAt ? `Exp. ${fmtMonthYear(d.expiresAt)}` : 'No expiry';
  return (
    <Press onPress={onPress} scaleTo={0.985} label={`${d.label}, ${statusLabel(d.status)}`} role="button" style={[{ borderRadius: R.xl }, SH.md, style]}>
      <View style={{ height: WALLET_CARD_H, borderRadius: R.xl, overflow: 'hidden', padding: 20, justifyContent: 'space-between' }}>
        <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Guilloche size={340} opacity={0.08} style={{ right: -150, top: -150 }} />
        <Row between align="flex-start" gap={10}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.3, color: 'rgba(255,255,255,0.6)' }} numberOfLines={1}>
              {issuer}
            </Text>
            <Text style={{ fontFamily: F.bold, fontSize: 20, letterSpacing: -0.4, color: C.white }} numberOfLines={1}>
              {d.label}
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 12.5, letterSpacing: 1, color: 'rgba(255,255,255,0.72)' }} numberOfLines={1}>
              {displayDocNumber(d.number) ? `${displayDocNumber(d.number)} · ${expiry}` : expiry}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {walletBadge(d.status)}
            {d.matchScore != null && (
              <Text style={{ fontFamily: F.semibold, fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{matchPct(d.matchScore)}% match</Text>
            )}
          </View>
        </Row>
        <Row between align="flex-end">
          <View style={{ gap: 4, flex: 1 }}>
            {!!d.extractedName && (
              <Text style={{ fontFamily: F.semibold, fontSize: 14, color: C.white }} numberOfLines={1}>
                {d.extractedName}
              </Text>
            )}
            <Text style={{ fontFamily: F.medium, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Added {fmtDate(d.addedAt)}</Text>
          </View>
          <Chip3D />
        </Row>
      </View>
    </Press>
  );
}

function Chip3D() {
  return (
    <View style={{ width: 40, height: 30, borderRadius: 7, overflow: 'hidden' }}>
      <LinearGradient colors={['#E9F7FF', '#9FD9F5', '#F3E6C4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(10,30,42,0.2)' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 1, backgroundColor: 'rgba(10,30,42,0.2)' }} />
    </View>
  );
}

/* ───────────────────────── profile drawer ───────────────────────── */

/**
 * Right-edge slide-out opened from the Home avatar — account card plus the
 * same menu the original ProfileDrawer/ProfileMenu offered: Edit profile,
 * Security & sign-in, Appearance, Sign out (confirm → useLogoutFlow) and
 * Delete account, with the app version footer.
 */
export function ProfileDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const { url: avatarUri } = useProfilePicture();
  const { logout, isPending: signingOut } = useLogoutFlow();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { width: winW } = useWindowDimensions();
  const panelW = Math.min(340, Math.round(winW * 0.85));

  const [shown, setShown] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setShown(true);
  }

  // The open animation must start from the Modal's onShow: on native
  // (Fabric) a native-driver animation kicked off in the same commit that
  // mounts the Modal is lost, leaving an invisible scrim over the screen and
  // the panel parked off-screen — the avatar tap looked dead.
  const modalReady = useRef(false);
  const animateTo = (toValue: number, done?: () => void) =>
    Animated.timing(progress, {
      toValue,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) done?.();
    });

  useEffect(() => {
    if (visible) {
      // Re-opened while the close animation was still running — the Modal
      // never unmounted, so onShow won't fire again.
      if (modalReady.current) animateTo(1);
      return;
    }
    animateTo(0, () => {
      modalReady.current = false;
      setShown(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animateTo only closes over the stable `progress`
  }, [visible]);

  if (!shown || !user) return null;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [panelW, 0] });
  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      onShow={() => {
        modalReady.current = true;
        if (visible) animateTo(1);
      }}
    >
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(1,27,39,0.45)', opacity: progress }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: panelW,
              backgroundColor: C.canvas,
              borderTopLeftRadius: R.xxl,
              borderBottomLeftRadius: R.xxl,
              paddingHorizontal: 18,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX }],
            },
            SH.lg,
          ]}
        >
          <Row between style={{ paddingVertical: 8 }}>
            <Txt v="h2">Profile</Txt>
            <IconCircle icon={X} label="Close" onPress={onClose} />
          </Row>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22, paddingTop: 10, paddingBottom: 16 }}>
            <Card style={{ gap: 14 }}>
              <Row gap={14}>
                <Avatar uri={avatarUri} name={user.fullName} size={56} status={user.faceEnrolled ? 'verified' : 'pending'} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Txt v="h3" lines={1}>
                    {user.fullName}
                  </Txt>
                  <StatusBadge status={user.faceEnrolled ? 'verified' : 'missing'} />
                </View>
              </Row>
              <Row gap={10}>
                <Mail size={16} color={C.ink3} />
                <Txt v="body" lines={1} style={{ flex: 1 }}>
                  {user.email}
                </Txt>
              </Row>
              <Row gap={10}>
                <Phone size={16} color={C.ink3} />
                <Txt v="body" lines={1} style={{ flex: 1 }}>
                  {user.phone}
                </Txt>
              </Row>
            </Card>

            <Group title="Account">
              <ListRow icon={Pencil} tone="sky" title="Edit profile" onPress={() => go('/profile/edit')} />
              <ListRow icon={ShieldCheck} tone="sky" title="Security & sign-in" sub="Face, PIN, password & consent" onPress={() => go('/security')} />
              <ListRow icon={Settings} tone="sky" title="Settings" onPress={() => go('/settings')} />
            </Group>

            <Group title="Support">
              <ListRow icon={CircleHelp} tone="sky" title="Help & FAQ" sub="Answers and contact support" onPress={() => go('/help')} />
              <ListRow icon={Info} tone="sky" title="About TruePas" onPress={() => go('/about')} />
            </Group>

            <Group title="Legal & privacy">
              <ListRow icon={ScanFace} tone="sky" title="Biometric data & privacy" sub="How your face data is kept and deleted" onPress={() => go('/legal/data-privacy')} />
              <ListRow icon={Lock} tone="sky" title="Privacy Policy" onPress={() => go('/legal/privacy-policy')} />
              <ListRow icon={FileText} tone="sky" title="Terms of Service" onPress={() => go('/legal/terms')} />
            </Group>

            <Group>
              <ListRow icon={LogOut} tone="sky" title="Sign out" onPress={() => setConfirmSignOut(true)} />
              <ListRow icon={Trash2} danger title="Delete account" onPress={() => go('/account/delete')} />
            </Group>

            <Txt v="small" color={C.ink4} center>
              TruePas {Constants.expoConfig?.version ?? '1.0.0'}
            </Txt>
          </ScrollView>
        </Animated.View>
      </View>

      <ConfirmSheet
        visible={confirmSignOut}
        icon={LogOut}
        danger
        title="Sign out of TruePas?"
        confirmLabel="Sign out"
        loading={signingOut}
        onConfirm={() => void logout()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Modal>
  );
}

/* ───────────────────────── misc ───────────────────────── */

/** Big page title used by the tab roots (Check-ins, Wallet). */
export function TabTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <Row between>
      <Text style={{ fontFamily: F.extrabold, fontSize: 34, letterSpacing: -1.1, color: C.ink }}>{children}</Text>
      {right}
    </Row>
  );
}

/** Two-column fact (label over value) used on booking detail. */
export function Fact({ k, v, sub, children }: { k: string; v?: string; sub?: string; children?: ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Txt v="small">{k}</Txt>
      {children ?? <Txt v="h3">{v}</Txt>}
      {sub != null && <Txt v="small">{sub}</Txt>}
    </View>
  );
}

