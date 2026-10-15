/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — Family flow pieces shared by the src/app/family/** routes.
 * Presentational only: the route files own every query, mutation, guard and
 * navigation target.
 *
 * NEVER import react-native-vision-camera here (or anything that does): the
 * under-5 photo camera lives in ./familyPhotoCapture and is lazy-required via
 * loadFamilyPhotoCapture(), same contract as features/liveness/cameraModule.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Contact,
  CreditCard,
  FileText,
  Landmark,
  Loader,
  type LucideIcon,
  Plane,
  ScrollText,
  X,
} from 'lucide-react-native';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMemberPhoto, useMemberSetup } from '@/features/family/hooks';
import type { FamilyMember, IdentityDocument } from '@/types/domain';

import { Guilloche } from '../blocks';
import { Banner, Bone } from '../kit';
import { useLightStatusBar } from '../statusBar';
import { C, F, G, R, SH } from '../theme';
import { Badge, type BadgeTone, Button, Card, Footer, initials, Press, Screen, Steps, Tile, TopBar, Txt } from '../ui';

/* ───────────────────────── status ───────────────────────── */

/** Contract status → premium badge. Same table as ui/StatusChip so the
 *  premium screens agree with the rest of the app. */
const STATUS: Record<string, [string, BadgeTone]> = {
  verified: ['Verified', 'green'],
  approved: ['Approved', 'green'],
  completed: ['Completed', 'green'],
  active: ['Active', 'green'],
  upcoming: ['Upcoming', 'sky'],
  pending: ['Pending', 'amber'],
  pending_document: ['Document needed', 'amber'],
  pending_liveness: ['Liveness needed', 'amber'],
  missing: ['Not added yet', 'neutral'],
  incomplete: ['Incomplete', 'neutral'],
  cancelled: ['Cancelled', 'neutral'],
  failed: ['Failed', 'red'],
  rejected: ['Rejected', 'red'],
  expired: ['Expired', 'red'],
};

export function statusBadge(status: string): { label: string; tone: BadgeTone } {
  const hit = STATUS[status.toLowerCase()];
  if (hit) return { label: hit[0], tone: hit[1] };
  return { label: status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), tone: 'neutral' };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIso(iso: string): Date | null {
  const m = iso.split('T')[0].match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2019-03-03" → "3 Mar 2019" (platform-independent). Falls back to the raw value. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = parseIso(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : iso;
}

/* ───────────────────────── member portraits (family list) ───────────────────────── */

/** Members without a photo get a stable brand tint instead. */
const TINTS = [
  ['#0A9BE0', '#034965'],
  ['#045A7C', '#011B27'],
  ['#1B7FB0', '#022F42'],
  ['#0692CA', '#03344A'],
] as const;

function tintFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Portrait card — the approved "party" grid look: a full-bleed photo when
 *  the member has one (their profile photo, else the one kept on this
 *  phone), otherwise initials on a tinted card. Front shows only name,
 *  relationship, age and status (useMemberSetup — the member page's badge);
 *  the capture details live on the member page. */
export function MemberPortrait({ member, onPress }: { member: FamilyMember; onPress: () => void }) {
  const setup = useMemberSetup(member);
  const photoUri = useMemberPhoto(member.id, member.profileImageUrl);
  return (
    <Press onPress={onPress} label={member.name} role="button" style={[{ flex: 1, borderRadius: R.xl }, SH.md]}>
      <View style={{ minHeight: 228, borderRadius: R.xl, overflow: 'hidden', padding: 12, justifyContent: 'flex-end', gap: 10 }}>
        {photoUri ? (
          <>
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={['rgba(1,27,39,0)', 'rgba(1,27,39,0.88)']} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
          </>
        ) : (
          <>
            <LinearGradient colors={tintFor(member.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Guilloche size={300} opacity={0.08} style={{ right: -150, top: -110 }} />
          </>
        )}
        {!photoUri && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: 'rgba(255,255,255,0.14)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.28)',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={{ fontFamily: F.bold, fontSize: 26, letterSpacing: 0.5, color: C.white }}>{initials(member.name)}</Text>
            </View>
          </View>
        )}
        <View>
          <Text numberOfLines={1} style={{ fontFamily: F.bold, fontSize: 17, color: C.white }}>
            {member.name.split(' ')[0]}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 12.5, color: 'rgba(255,255,255,0.72)' }}>
            {member.relationship} · {member.age} yrs
          </Text>
          {/* Status under the name, not on top: on a photo card the top is
              where the face is. Small and without a dot, so "Document
              needed" fits one line on a 360dp phone (the tone says the state). */}
          <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            <Badge label={setup.label} tone={setup.tone} small />
          </View>
        </View>
      </View>
    </Press>
  );
}

/** Two-column portrait grid; an odd last card keeps its column width. */
export function MemberGrid({ members, onOpen }: { members: FamilyMember[]; onOpen: (m: FamilyMember) => void }) {
  const rows: FamilyMember[][] = [];
  for (let i = 0; i < members.length; i += 2) rows.push(members.slice(i, i + 2));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((pair) => (
        <View key={pair[0].id} style={{ flexDirection: 'row', gap: 12 }}>
          {pair.map((m) => (
            <MemberPortrait key={m.id} member={m} onPress={() => onOpen(m)} />
          ))}
          {pair.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

export function MemberGridSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      {[0, 1].map((r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Bone h={236} r={R.xl} />
          </View>
          <View style={{ flex: 1 }}>
            <Bone h={236} r={R.xl} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ───────────────────────── member detail ───────────────────────── */

export interface ChecklistStep {
  icon: LucideIcon;
  label: string;
  sub: string;
  done: boolean;
}

/** Numbered setup checklist (Face → Document → Done). */
export function ChecklistCard({ title, steps }: { title: string; steps: ChecklistStep[] }) {
  return (
    <View style={{ gap: 10 }}>
      <Txt v="micro" style={{ marginLeft: 4 }}>
        {title}
      </Txt>
      <Card pad={0} style={{ paddingHorizontal: 16 }}>
        {steps.map((s, i) => (
          <View
            key={s.label}
            accessible
            accessibilityLabel={`Step ${i + 1}, ${s.label}, ${s.done ? 'done' : 'to do'}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 14,
              borderTopWidth: i ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: C.lineSoft,
            }}>
            <Tile icon={s.icon} tone={s.done ? 'green' : 'neutral'} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="bodyStrong" color={s.done ? C.ink : C.ink2}>
                {i + 1} · {s.label}
              </Txt>
              <Txt v="small">{s.sub}</Txt>
            </View>
            {s.done ? (
              <Badge label="Done" tone="green" icon={Check} />
            ) : (
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.line }} />
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}

export const DOC_ICON: Record<string, LucideIcon> = {
  passport: Plane,
  drivingLicense: CarFront,
  idCard: Contact,
  greenCard: CreditCard,
  birthCertificate: ScrollText,
  usVisa: Landmark,
};

/** Document list row — label, number, status (same fields the old DocumentRow showed). */
export function DocRow({ doc, onPress }: { doc: IdentityDocument; onPress: () => void }) {
  const s = statusBadge(doc.status);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${doc.label}, ${s.label}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
        <Tile icon={DOC_ICON[doc.type] ?? FileText} tone="sky" size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="bodyStrong" lines={1}>
            {doc.label}
          </Txt>
          <Txt v="mono" color={C.ink3} lines={1}>
            {doc.number}
          </Txt>
        </View>
        <Badge label={s.label} tone={s.tone} />
        <ChevronRight size={18} color={C.ink4} />
      </View>
    </Pressable>
  );
}

/* ───────────────────────── date of birth ───────────────────────── */

/** Field-styled date picker (premium port of composite/DatePicker): opens a
 *  calendar sheet with a year grid; value is ISO "YYYY-MM-DD". */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select date',
  minDate,
  maxDate,
  error,
  hint,
}: {
  label: string;
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  error?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        {label}
      </Txt>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatDate(value) : 'Not set' }}>
        <View
          style={[
            {
              height: 56,
              borderRadius: R.md,
              backgroundColor: C.surface,
              borderWidth: 1.5,
              borderColor: error ? C.red : open ? C.sky : C.line,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              gap: 12,
            },
            open && !error && { boxShadow: '0px 0px 0px 4px rgba(8,182,252,0.14)' },
          ]}>
          <CalendarDays size={19} color={open ? C.sky : C.ink3} strokeWidth={2} />
          <Text style={{ flex: 1, fontFamily: F.semibold, fontSize: 15.5, color: value ? C.ink : C.ink4 }}>
            {value ? formatDate(value) : placeholder}
          </Text>
          <ChevronDown size={18} color={C.ink4} />
        </View>
      </Pressable>
      {(hint != null || error != null) && (
        <Txt v="small" color={error ? C.redInk : C.ink3}>
          {error ?? hint}
        </Txt>
      )}
      {open && (
        <CalendarSheet
          title={label}
          value={value}
          minDate={minDate}
          maxDate={maxDate}
          onClose={() => setOpen(false)}
          onApply={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const CELL = 44;

/** Mounted only while open, so state initialises from `value` on every open. */
function CalendarSheet({
  title,
  value,
  minDate,
  maxDate,
  onClose,
  onApply,
}: {
  title: string;
  value?: string;
  minDate?: string;
  maxDate?: string;
  onClose: () => void;
  onApply: (iso: string) => void;
}) {
  const insets = useSafeAreaInsets();
  // With no value, open on today — or on maxDate when it lies in the past.
  const [view, setView] = useState(() => {
    const today = new Date();
    const base = (value && parseIso(value)) || (maxDate && maxDate < toIso(today) ? parseIso(maxDate) : null) || today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [draft, setDraft] = useState<string | undefined>(value);
  const [mode, setMode] = useState<'days' | 'years'>('days');

  const firstDay = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const todayIso = toIso(new Date());
  const inRange = (iso: string) => (!minDate || iso >= minDate) && (!maxDate || iso <= maxDate);
  const navMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toIso(new Date(view.year, view.month, i + 1))),
  ];
  const currentYear = new Date().getFullYear();
  const minYear = minDate ? parseInt(minDate.slice(0, 4), 10) : currentYear - 100;
  const maxYear = maxDate ? parseInt(maxDate.slice(0, 4), 10) : currentYear + 50;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const yearOffset = Math.max(0, (Math.floor((maxYear - view.year) / 4) - 1) * CELL);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(1,27,39,0.45)' }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          {
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10 + insets.bottom,
            backgroundColor: C.surface,
            borderRadius: 32,
            padding: 20,
            gap: 12,
          },
          SH.lg,
        ]}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line }} />
        <Txt v="micro">{title}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {mode === 'years' ? (
            <Txt v="h3" style={{ flex: 1, textAlign: 'center' }}>
              Select year
            </Txt>
          ) : (
            <>
              <Pressable onPress={() => navMonth(-1)} accessibilityLabel="Previous month" hitSlop={8} style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={20} color={C.ink2} />
              </Pressable>
              <Pressable
                onPress={() => setMode('years')}
                accessibilityRole="button"
                accessibilityLabel="Choose year"
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: CELL, paddingHorizontal: 8 }}>
                <Txt v="h3">
                  {MONTHS[view.month]} {view.year}
                </Txt>
                <ChevronDown size={16} color={C.ink3} />
              </Pressable>
              <Pressable onPress={() => navMonth(1)} accessibilityLabel="Next month" hitSlop={8} style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronRight size={20} color={C.ink2} />
              </Pressable>
            </>
          )}
        </View>
        {mode === 'years' ? (
          <ScrollView style={{ height: CELL * 6 }} nestedScrollEnabled showsVerticalScrollIndicator={false} contentOffset={{ x: 0, y: yearOffset }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {years.map((y) => {
                const selected = y === view.year;
                return (
                  <Pressable
                    key={y}
                    accessibilityRole="button"
                    accessibilityLabel={`Year ${y}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setView({ year: y, month: view.month });
                      setMode('days');
                    }}
                    style={{ width: '25%', height: CELL, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={[{ paddingHorizontal: 14, height: 36, borderRadius: R.full, alignItems: 'center', justifyContent: 'center' }, selected && { backgroundColor: C.sky }]}>
                      <Text style={{ fontFamily: selected ? F.bold : F.medium, fontSize: 15, color: selected ? C.white : C.ink }}>{y}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DAYS.map((d) => (
              <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', fontFamily: F.semibold, fontSize: 11.5, color: C.ink4, paddingVertical: 4 }}>
                {d}
              </Text>
            ))}
            {cells.map((iso, i) => {
              if (!iso) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: CELL }} />;
              const selected = iso === draft;
              const out = !inRange(iso);
              const today = iso === todayIso;
              return (
                <Pressable
                  key={iso}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(iso)}
                  accessibilityState={{ selected, disabled: out }}
                  disabled={out}
                  onPress={() => setDraft(iso)}
                  style={{ width: `${100 / 7}%`, height: CELL, alignItems: 'center', justifyContent: 'center' }}>
                  <View
                    style={[
                      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
                      selected && { backgroundColor: C.sky },
                      !selected && today && { borderWidth: 1.5, borderColor: C.sky },
                    ]}>
                    <Text style={{ fontFamily: selected ? F.bold : F.medium, fontSize: 15, color: selected ? C.white : out ? C.ink4 : C.ink }}>
                      {Number(iso.slice(8, 10))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Button label="Cancel" tone="white" size="md" style={{ flex: 1 }} onPress={onClose} />
          <Button label="Apply" size="md" style={{ flex: 1 }} disabled={!draft} onPress={() => draft && onApply(draft)} />
        </View>
      </View>
    </Modal>
  );
}

/* ───────────────────────── processing steps ───────────────────────── */

export type FlowStepState = 'done' | 'active' | 'failed' | 'todo';

/** Index-driven (StagedFlow semantics): before `index` done, at `index`
 *  active — or failed — and the rest to do. */
export function stagedSteps(labels: string[], index: number, failed: boolean): { label: string; state: FlowStepState }[] {
  return labels.map((label, i) => ({
    label,
    state: i < index ? 'done' : i === index ? (failed ? 'failed' : 'active') : 'todo',
  }));
}

function Spin({ children }: { children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [v]);
  return <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>{children}</Animated.View>;
}

/** The ProcessingView step card, plus a failed state. */
export function StepCard({ steps }: { steps: { label: string; state: FlowStepState }[] }) {
  return (
    <Card pad={6} style={{ paddingHorizontal: 18 }}>
      {steps.map((s, i) => (
        <View
          key={s.label}
          accessible
          accessibilityLabel={`${s.label}, ${s.state === 'todo' ? 'pending' : s.state}`}
          style={{ flexDirection: 'row', gap: 14, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.lineSoft, alignItems: 'center' }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s.state === 'done' ? C.sky : s.state === 'active' ? C.skyWash : s.state === 'failed' ? C.redWash : C.sunken,
            }}>
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
          <Txt v="bodyStrong" color={s.state === 'todo' ? C.ink3 : s.state === 'failed' ? C.redInk : C.ink} style={{ flex: 1 }}>
            {s.label}
          </Txt>
          {s.state === 'done' && (
            <Txt v="small" color={C.green}>
              Done
            </Txt>
          )}
        </View>
      ))}
    </Card>
  );
}

/* ───────────────────────── dark capture stage ───────────────────────── */

/** The approved dark biometric layout (FaceScanView look) with real slots:
 *  live camera / ring as children, actions in the footer. */
export function NightStage({
  topTitle,
  subtitle,
  right,
  onBack,
  step,
  total,
  title,
  accent,
  instruction,
  children,
  footer,
}: {
  topTitle?: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  step?: number;
  total?: number;
  title: string;
  accent?: string;
  instruction?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useLightStatusBar();
  return (
    <View style={{ flex: 1, backgroundColor: C.navyNight }}>
      <LinearGradient colors={G.night} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <TopBar tone="glass" title={topTitle} right={right} onBack={onBack} />
        {!!subtitle && (
          <Txt v="small" center color="rgba(255,255,255,0.55)" style={{ marginTop: -8 }}>
            {subtitle}
          </Txt>
        )}
        {step != null && total != null && (
          <View style={{ paddingHorizontal: 24, paddingTop: 10 }}>
            <Steps total={total} current={step - 1} light />
          </View>
        )}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16, gap: 18 }}
          showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -0.9, color: C.white, textAlign: 'center' }}>
              {title}
              {accent != null && (
                <>
                  {' '}
                  <Text style={{ fontFamily: F.serifItalic, fontSize: 36, color: C.skyLight }}>{accent}</Text>
                </>
              )}
            </Text>
            {!!instruction && (
              <Txt v="body" color="rgba(255,255,255,0.65)" center style={{ maxWidth: 300 }}>
                {instruction}
              </Txt>
            )}
          </View>
          {children}
        </ScrollView>
        {footer != null && <Footer>{footer}</Footer>}
      </SafeAreaView>
    </View>
  );
}

/** Glass row on the dark stage — icon disc, title, body. */
export function GlassRow({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(8,182,252,0.18)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={17} color={C.skyLight} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Txt v="smallStrong" color={C.white}>
          {title}
        </Txt>
        <Txt v="small" color="rgba(255,255,255,0.6)">
          {body}
        </Txt>
      </View>
    </View>
  );
}

/** Small status pill for the dark stage (camera notes). */
export function GlassPill({ icon: Icon, label, active }: { icon?: LucideIcon; label: string; active?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 34,
        paddingHorizontal: 14,
        borderRadius: R.full,
        backgroundColor: active ? 'rgba(8,182,252,0.18)' : 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: active ? 'rgba(8,182,252,0.6)' : 'rgba(255,255,255,0.12)',
      }}>
      {Icon ? <Icon size={14} color={active ? C.white : 'rgba(255,255,255,0.7)'} /> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: active ? C.sky : 'rgba(255,255,255,0.3)' }} />}
      <Text style={{ fontFamily: F.semibold, fontSize: 13, color: active ? C.white : 'rgba(255,255,255,0.7)' }}>{label}</Text>
    </View>
  );
}

/* ───────────────────────── camera module ───────────────────────── */

/** Premium CameraUnavailable — the build lacks NitroModules / vision-camera. */
export function CameraUnavailableView() {
  return (
    <Screen header={<TopBar title="Face verification" />} scroll={false} contentStyle={{ justifyContent: 'center', gap: 16, paddingBottom: 40 }}>
      <Banner
        tone="error"
        title="Camera unavailable"
        body="This build doesn't include the camera module. Rebuild the dev client (npx expo run:android or an EAS development build) and try again."
      />
      <Button label="Go back" tone="white" onPress={() => router.back()} />
    </Screen>
  );
}

let familyPhotoCapture: ComponentType | null | undefined;

/** Lazy, guarded load of the premium under-5 photo camera — it statically
 *  imports react-native-vision-camera, which throws without NitroModules. */
export function loadFamilyPhotoCapture(): ComponentType | null {
  if (familyPhotoCapture === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: throws without NitroModules
      familyPhotoCapture = (require('./familyPhotoCapture') as { FamilyPhotoCapture: ComponentType }).FamilyPhotoCapture ?? null;
    } catch {
      familyPhotoCapture = null;
    }
  }
  return familyPhotoCapture;
}
