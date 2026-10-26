/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — auth-flow pieces shared by the (auth) routes:
 * keyboard-safe form shell, country-code picker, DOB calendar, PIN and
 * password fields, sign-in method switch, and the OTP verification screen.
 *
 * `OtpScreen` is the premium rebuild of features/auth/components/OtpVerification:
 * the verify / resend / attempts / expiry logic is ported 1:1, only the UI
 * changed (CodeInput, Banner, premium header).
 */
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  type LucideIcon,
} from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { setRegistrationToken } from '@/api/client';
import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { COUNTRIES } from '@/constants/countries';
import { useVerifyOtp } from '@/features/auth/mutations';
import { useCountdown } from '@/hooks/useCountdown';
import { useKeyboardScrollPad } from '@/hooks/useKeyboardScrollPad';
import type { OtpPurpose, VerifyOtpRequest, VerifyOtpResponse } from '@/types/domain';

import { Banner, CodeInput } from '../kit';
import { C, F, R, S, SH } from '../theme';
import { Button, Card, Field, Footer, Heading, Row, Steps, TextLink, Tile, TopBar, Txt } from '../ui';
import { errorHaptic, successHaptic, tapHaptic } from '@/services/haptics';

/* ───────────────────────── form shell ───────────────────────── */

/**
 * Premium form screen that keeps the original keyboard contract:
 * KeyboardAvoidingView ('padding' iOS / 'height' Android) + useKeyboardScrollPad
 * so the focused input always clears the sticky footer on Android edge-to-edge.
 * (premium `Screen` uses no Android behaviour and exposes no scroll ref.)
 */
export function AuthScreen({
  header,
  footer,
  children,
  contentStyle,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const {
    scrollProps: { ref: scrollRef, ...scrollHandlers },
    footerProps: { ref: footerRef },
  } = useKeyboardScrollPad();
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          {header}
          <ScrollView
            ref={scrollRef}
            {...scrollHandlers}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              { flexGrow: 1, paddingHorizontal: S.gutter, paddingTop: 8, paddingBottom: 24, gap: S.section },
              contentStyle,
            ]}>
            {children}
          </ScrollView>
          {footer != null && (
            <View ref={footerRef} collapsable={false}>
              <Footer>{footer}</Footer>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/** TopBar with the "n/total" step counter used across account creation. */
export function FlowBar({
  title,
  step,
  total,
  onBack,
}: {
  title?: string;
  step?: number;
  total?: number;
  onBack?: () => void;
}) {
  return (
    <TopBar
      title={title}
      onBack={onBack}
      right={
        step != null && total != null ? (
          <Txt v="smallStrong" color={C.ink3}>
            {step}/{total}
          </Txt>
        ) : undefined
      }
    />
  );
}

/** Account creation is four auth steps: mobile → verify mobile → details → verify email. */
export const SIGNUP_STEPS = 4;

/** Centered "Prompt? Link" row (footer helpers). */
export function LinkRow({ prompt, label, onPress }: { prompt?: string; label: string; onPress: () => void }) {
  return (
    <Row gap={6} style={{ justifyContent: 'center', paddingVertical: 4 }}>
      {prompt != null && <Txt v="body">{prompt}</Txt>}
      <TextLink label={label} onPress={onPress} />
    </Row>
  );
}

/* ───────────────────────── bottom sheet ───────────────────────── */

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(1,27,39,0.45)' }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          {
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10 + insets.bottom,
            maxHeight: '82%',
            backgroundColor: C.surface,
            borderRadius: 32,
            padding: 20,
            gap: 12,
          },
          SH.lg,
        ]}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line }} />
        {title != null && <Txt v="h3">{title}</Txt>}
        {children}
      </View>
    </Modal>
  );
}

/* ───────────────────────── country code ───────────────────────── */

/** Compact "🇮🇳 +91 ▾" trigger for a Field's trailing slot; opens a sheet of COUNTRIES. */
export function CountryCodePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = COUNTRIES.find((c) => c.code === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Country code"
        accessibilityValue={{ text: value }}
        hitSlop={8}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            height: 32,
            paddingLeft: 12,
            borderLeftWidth: 1,
            borderLeftColor: C.line,
          }}>
          {current != null && <Text style={{ fontSize: 15 }}>{current.flag}</Text>}
          <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink2 }}>{value}</Text>
          <ChevronDown size={15} color={C.ink3} strokeWidth={2.2} />
        </View>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Country code">
        <FlatList
          data={COUNTRIES}
          keyExtractor={(c) => c.code}
          style={{ flexGrow: 0, flexShrink: 1 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const selected = item.code === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.name} ${item.code}`}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 52,
                    paddingHorizontal: 12,
                    borderRadius: R.md,
                    backgroundColor: selected ? C.skyMist : 'transparent',
                  }}>
                  <Text style={{ fontSize: 20, width: 30 }}>{item.flag}</Text>
                  <Txt v="bodyStrong" style={{ flex: 1 }} lines={1}>
                    {item.name}
                  </Txt>
                  <Text style={{ fontFamily: F.mono, fontSize: 13, color: selected ? C.skyPressed : C.ink3 }}>{item.code}</Text>
                  {selected && <Check size={17} color={C.sky} strokeWidth={2.6} />}
                </View>
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}

/* ───────────────────────── date of birth ───────────────────────── */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const YEAR_ROW = 48;
const CELL_W = `${100 / 7}%` as const;

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "1994-08-14" → "14 Aug 1994". */
function fmtISO(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month.slice(0, 3)} ${y}` : iso;
}

/**
 * Premium date field + calendar sheet (port of composite/DatePicker: ISO in/out,
 * min/max bounds, month nav, year grid, Cancel/Apply).
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select a date',
  minDate,
  maxDate,
  error,
  hint,
}: {
  label: string;
  /** ISO "YYYY-MM-DD". */
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  error?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  // With no value, open on today — or on maxDate when it lies in the past
  // (e.g. an 18+ DOB field), so the first view isn't all disabled days.
  const startDate = () => {
    if (value) return new Date(`${value}T00:00:00`);
    const today = new Date();
    return maxDate && maxDate < toISO(today) ? new Date(`${maxDate}T00:00:00`) : today;
  };
  const initial = startDate();
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [draft, setDraft] = useState<string | undefined>(value);
  const [mode, setMode] = useState<'days' | 'years'>('days');

  const openPicker = () => {
    const base = startDate();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setDraft(value);
    setMode('days');
    setOpen(true);
  };

  const navMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const firstDay = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const todayISO = toISO(new Date());
  const inRange = (iso: string) => (!minDate || iso >= minDate) && (!maxDate || iso <= maxDate);
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISO(new Date(view.year, view.month, i + 1))),
  ];

  const currentYear = new Date().getFullYear();
  const minYear = minDate ? parseInt(minDate.slice(0, 4), 10) : currentYear - 100;
  const maxYear = maxDate ? parseInt(maxDate.slice(0, 4), 10) : currentYear + 50;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const yearScrollOffset = Math.max(0, (Math.floor((maxYear - view.year) / 4) - 1) * YEAR_ROW);

  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        {label}
      </Txt>
      <Pressable onPress={openPicker} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: fmtISO(value) }}>
        <View
          style={{
            height: 56,
            borderRadius: R.md,
            backgroundColor: C.surface,
            borderWidth: 1.5,
            borderColor: error ? C.red : open ? C.sky : C.line,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            gap: 12,
          }}>
          <CalendarDays size={19} color={open ? C.sky : C.ink3} strokeWidth={2} />
          <Text style={{ flex: 1, fontFamily: F.semibold, fontSize: 15.5, color: value ? C.ink : C.ink4 }} numberOfLines={1}>
            {value ? fmtISO(value) : placeholder}
          </Text>
          <ChevronDown size={17} color={C.ink3} />
        </View>
      </Pressable>
      {(hint != null || error != null) && (
        <Txt v="small" color={error ? C.redInk : C.ink3}>
          {error ?? hint}
        </Txt>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)}>
        <Row between style={{ minHeight: 44 }}>
          {mode === 'years' ? (
            <Txt v="h3" style={{ flex: 1, textAlign: 'center' }}>
              Select year
            </Txt>
          ) : (
            <>
              <CalNav icon={ChevronLeft} label="Previous month" onPress={() => navMonth(-1)} />
              <Pressable onPress={() => setMode('years')} accessibilityRole="button" accessibilityLabel="Choose year" hitSlop={8}>
                <Row gap={4}>
                  <Txt v="h3">
                    {MONTHS[view.month]} {view.year}
                  </Txt>
                  <ChevronDown size={16} color={C.ink3} />
                </Row>
              </Pressable>
              <CalNav icon={ChevronRight} label="Next month" onPress={() => navMonth(1)} />
            </>
          )}
        </Row>

        {mode === 'years' ? (
          <ScrollView
            style={{ height: YEAR_ROW * 6, flexGrow: 0 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentOffset={{ x: 0, y: yearScrollOffset }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {years.map((y) => {
                const selected = y === view.year;
                return (
                  <Pressable
                    key={y}
                    onPress={() => {
                      setView({ year: y, month: view.month });
                      setMode('days');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Year ${y}`}
                    accessibilityState={{ selected }}
                    style={{ width: '25%', height: YEAR_ROW, alignItems: 'center', justifyContent: 'center' }}>
                    <View
                      style={{
                        paddingHorizontal: 14,
                        height: 38,
                        borderRadius: R.full,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: selected ? C.sky : 'transparent',
                      }}>
                      <Text style={{ fontFamily: selected ? F.bold : F.semibold, fontSize: 15, color: selected ? C.white : C.ink }}>{y}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DAYS.map((d) => (
              <Text
                key={d}
                style={{ width: CELL_W, textAlign: 'center', fontFamily: F.semibold, fontSize: 12, color: C.ink3, paddingVertical: 6 }}>
                {d}
              </Text>
            ))}
            {cells.map((iso, i) => {
              if (!iso) return <View key={`e${i}`} style={{ width: CELL_W, height: 44 }} />;
              const day = parseInt(iso.slice(8, 10), 10);
              const selected = iso === draft;
              const isToday = iso === todayISO;
              const out = !inRange(iso);
              return (
                <Pressable
                  key={iso}
                  onPress={() => setDraft(iso)}
                  disabled={out}
                  accessibilityRole="button"
                  accessibilityLabel={fmtISO(iso)}
                  accessibilityState={{ selected, disabled: out }}
                  style={{ width: CELL_W, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? C.sky : 'transparent',
                      borderWidth: !selected && isToday ? 1.5 : 0,
                      borderColor: C.sky,
                    }}>
                    <Text
                      style={{
                        fontFamily: selected ? F.bold : F.semibold,
                        fontSize: 15,
                        color: selected ? C.white : out ? C.ink4 : C.ink,
                        opacity: out ? 0.55 : 1,
                        fontVariant: ['tabular-nums'],
                      }}>
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <Row gap={10} style={{ paddingTop: 4 }}>
          <Button label="Cancel" tone="white" size="md" style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <Button
            label="Apply"
            size="md"
            style={{ flex: 1 }}
            onPress={() => {
              if (draft) onChange(draft);
              setOpen(false);
            }}
          />
        </Row>
      </Sheet>
    </View>
  );
}

function CalNav({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: C.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon size={18} color={C.ink2} />
      </View>
    </Pressable>
  );
}

/* ───────────────────────── PIN / password ───────────────────────── */

/** Labelled 4-digit masked PIN entry (CodeInput), left-aligned for forms. */
export function PinField({
  label,
  value,
  onChange,
  error,
  invalid,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Message under the cells. */
  error?: string;
  /** Red cells without (or in addition to) a message. */
  invalid?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        {label}
      </Txt>
      <View style={{ width: 4 * 54 + 3 * 10, maxWidth: '100%' }}>
        <CodeInput length={4} dots value={value} onChange={onChange} error={invalid || error != null} autoFocus={false} label={label} />
      </View>
      {(hint != null || error != null) && (
        <Txt v="small" color={error ? C.redInk : C.ink3}>
          {error ?? hint}
        </Txt>
      )}
    </View>
  );
}

/** Field with a lock icon and a show/hide toggle. */
export function PasswordField({
  label,
  value,
  onChangeText,
  onBlur,
  error,
  hint,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: TextInputProps['autoComplete'];
}) {
  const [show, setShow] = useState(false);
  const EyeIcon = show ? EyeOff : Eye;
  return (
    <Field
      label={label}
      icon={Lock}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      error={error}
      hint={hint}
      placeholder={placeholder}
      secure={!show}
      inputProps={{ autoCapitalize: 'none', autoCorrect: false, autoComplete }}
      right={
        <Pressable
          onPress={() => setShow((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel={show ? 'Hide password' : 'Show password'}
          hitSlop={10}>
          <EyeIcon size={19} color={C.ink3} />
        </Pressable>
      }
    />
  );
}

/* ───────────────────────── segmented switch ───────────────────────── */

const SEG_H = 42;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', backgroundColor: C.sunken, borderRadius: (SEG_H + 8) / 2, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1 }}>
            <View style={{ height: SEG_H, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
              {/* The pill is its own view, mounted when selected. Adding the fill
                  and shadow to an existing view on Android dropped the rounded
                  corners (see BUG_REPORT_ANDROID_RADIUS_FILL.md); the radius is
                  capped at h/2 for the same reason. */}
              {on && (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { borderRadius: SEG_H / 2, backgroundColor: C.surface, boxShadow: '0px 2px 8px rgba(10,30,42,0.08)' },
                  ]}
                />
              )}
              {Icon != null && <Icon size={16} color={on ? C.ink : C.ink3} strokeWidth={2.2} />}
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: on ? C.ink : C.ink3 }}>{o.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────────────────────── OTP verification ───────────────────────── */

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;
/** Backend contract: max 5 wrong attempts, OTP expires after 10 minutes. */
const MAX_OTP_ATTEMPTS = 5;
const OTP_TTL_SECONDS = 10 * 60;

/** Reads a server-provided attempts-remaining count if the backend sends one. */
function attemptsRemainingFrom(err: unknown): number | null {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const value = data?.attemptsRemaining ?? data?.attempts_remaining ?? data?.remainingAttempts;
  return typeof value === 'number' && value >= 0 ? value : null;
}

type VerifyState = 'idle' | 'loading' | 'error' | 'success';

export interface OtpScreenProps {
  /** Header title. */
  topTitle: string;
  /** Account-creation progress (n of total). */
  step?: { current: number; total: number };
  /** Optional tile above the heading (password reset). */
  icon?: LucideIcon;
  over?: string;
  title: string;
  accent?: string;
  sub: string;
  /** Destination shown in its own card so a long email never wraps mid-address. */
  address?: string;
  /** Small muted tip under the code (e.g. spam folder). */
  tip?: string;
  purpose: OtpPurpose;
  /** Identifier fields to send with the OTP verification. */
  identifier?: { registrationId?: string; phone?: string; countryCode?: string; email?: string };
  /**
   * Called after successful verification with the full response and the
   * verified code (password-reset needs it for /auth/reset-password).
   */
  onVerified: (response: VerifyOtpResponse, code: string) => void;
  /**
   * Actually re-sends the OTP (no generic resend endpoint — each screen
   * re-calls the endpoint that originally triggered the code). When omitted
   * the resend control is hidden instead of pretending to resend.
   */
  onResend?: () => Promise<void>;
  /** Overrides the header back action (e.g. returning to a previous in-screen step). */
  onBack?: () => void;
  /** Footer link that goes back to fix the destination ("Change number"). */
  change?: { prompt?: string; label: string };
}

export function OtpScreen({
  topTitle,
  step,
  icon,
  over,
  title,
  accent,
  sub,
  address,
  tip,
  purpose,
  identifier,
  onVerified,
  onResend,
  onBack,
  change,
}: OtpScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [resending, setResending] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_OTP_ATTEMPTS);
  const [verifyError, setVerifyError] = useState<{ title: string; message: string; status: number | null } | null>(null);
  const { seconds: resendSeconds, reset: resetResendCooldown } = useCountdown(RESEND_SECONDS);
  const { seconds: otpSecondsLeft, reset: resetOtpTtl } = useCountdown(OTP_TTL_SECONDS);
  const locked = attemptsLeft <= 0;
  const expired = otpSecondsLeft === 0;
  const shakeX = useRef(new Animated.Value(0)).current;
  const verifyOtp = useVerifyOtp();
  const goBack = onBack ?? router.back;

  const shake = () =>
    Animated.sequence(
      [-10, 10, -6, 6, 0].map((toValue) => Animated.timing(shakeX, { toValue, duration: 50, useNativeDriver: true })),
    ).start();

  const handleChange = (value: string) => {
    setCode(value);
    if (verifyState === 'error') {
      setVerifyState('idle');
    }
    if (verifyError) {
      setVerifyError(null);
    }
  };

  const handleVerify = async (submitted?: string) => {
    const otp = submitted ?? code;
    if (otp.length !== OTP_LENGTH || verifyState === 'loading' || verifyState === 'success' || locked || expired) return;
    setVerifyState('loading');
    setVerifyError(null);
    try {
      const payload: VerifyOtpRequest = {
        otp,
        purpose,
        ...identifier,
      };
      // Never log the raw payload — it carries the OTP code.
      console.log('[OTP] Verifying:', { purpose, registrationId: identifier?.registrationId, otpLength: otp.length });
      if (purpose === 'phone' && !identifier?.registrationId) {
        console.error('[OTP] Missing registrationId for phone verification — backend will return 404');
      }
      const response = await verifyOtp.mutateAsync(payload);
      // Response can carry session tokens (registrationToken/accessToken) — redact them.
      console.log(
        '[OTP] Response:',
        JSON.stringify({
          ...response,
          registrationToken: response.registrationToken ? '***' : undefined,
          accessToken: response.accessToken ? '***' : undefined,
          refreshToken: response.refreshToken ? '***' : undefined,
        }),
      );

      // Store registration token if present (phone verification during registration)
      if (response.registrationToken) {
        setRegistrationToken(response.registrationToken);
      }

      setVerifyState('success');
      successHaptic();
      onVerified(response, otp);
    } catch (err: unknown) {
      const apiErr = toApiError(err);
      setVerifyState('error');
      // Only rejections of the code itself burn an attempt — not a stale
      // registration session (404), an existing account (409), a malformed
      // payload (422), or network/5xx failures. Prefer a server-provided
      // remaining count.
      const isCodeRejection =
        apiErr.status !== null &&
        apiErr.status >= 400 &&
        apiErr.status < 500 &&
        apiErr.status !== 404 &&
        apiErr.status !== 409 &&
        apiErr.status !== 422;
      if (apiErr.status === 429) {
        // 429 on verify means the code is burned — waiting won't help, resend will.
        setAttemptsLeft(0);
        toast({
          variant: 'error',
          title: 'Incorrect code',
          description: 'Too many incorrect attempts. This code is no longer valid — request a new one.',
        });
      } else if (isCodeRejection) {
        toast({
          variant: 'error',
          title: 'Incorrect code',
          description: apiErr.message || 'Check the latest code and try again.',
        });
        setAttemptsLeft((prev) => attemptsRemainingFrom(err) ?? Math.max(0, prev - 1));
      } else {
        // Not a wrong code — pin the failure inline so it doesn't vanish with
        // the toast and the user gets a real next step.
        setVerifyError({
          title:
            apiErr.status === 409
              ? 'Account already exists'
              : apiErr.status === null
                ? 'No connection'
                : apiErr.status >= 500
                  ? 'Server error'
                  : "Couldn't verify",
          message:
            apiErr.status === 409
              ? 'Sign in instead, or go back and try different details.'
              : apiErr.message || 'Please try again.',
          status: apiErr.status,
        });
      }
      errorHaptic();
      shake();
      setCode('');
    }
  };

  const handleResend = async () => {
    if (!onResend || resending || resendSeconds > 0) return;
    setResending(true);
    tapHaptic();
    try {
      await onResend();
      // Fresh code sent — restart both timers, restore attempts and clear entry.
      resetResendCooldown();
      resetOtpTtl();
      setAttemptsLeft(MAX_OTP_ATTEMPTS);
      setCode('');
      setVerifyState('idle');
      setVerifyError(null);
      toast({ variant: 'success', title: 'Code resent' });
    } catch (err: unknown) {
      toast({
        variant: 'error',
        title: "Couldn't resend",
        description: toApiError(err).message || 'Wait a moment and try again.',
      });
    } finally {
      setResending(false);
    }
  };

  const status = expired ? (
    <Banner tone="warning" title="Code expired" body="This code is no longer valid — request a new one." />
  ) : locked ? (
    <Banner tone="error" title="Code locked" body="Too many incorrect attempts — request a new code." />
  ) : verifyError ? (
    <Banner
      tone="error"
      title={verifyError.title}
      body={verifyError.message}
      action={
        verifyError.status === 409 ? (
          <TextLink label="Sign in" color={C.redInk} onPress={() => router.replace('/(auth)/login')} />
        ) : undefined
      }
    />
  ) : attemptsLeft <= 2 ? (
    <Banner tone="warning" title={`${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining`} />
  ) : null;

  return (
    <AuthScreen
      header={<FlowBar title={topTitle} step={step?.current} total={step?.total} onBack={goBack} />}
      footer={
        <>
          <Button
            label="Verify"
            loading={verifyState === 'loading'}
            disabled={code.length !== OTP_LENGTH || verifyState === 'loading' || verifyState === 'success' || locked || expired}
            onPress={() => void handleVerify()}
          />
          {change != null && <LinkRow prompt={change.prompt} label={change.label} onPress={goBack} />}
        </>
      }>
      {step != null && <Steps total={step.total} current={step.current - 1} />}
      {icon != null && <Tile icon={icon} tone="sky" size={60} />}
      <Heading over={over} title={title} accent={accent} sub={sub} />

      {address ? (
        <Card style={{ gap: 4, alignItems: 'center' }}>
          <Txt v="small">Sent to</Txt>
          <Text
            style={{ fontFamily: F.semibold, fontSize: 15, color: C.ink }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}>
            {address}
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: 18 }}>
        <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
          <CodeInput
            length={OTP_LENGTH}
            value={code}
            onChange={handleChange}
            onComplete={(v) => void handleVerify(v)}
            autoFocus
            disabled={locked || expired || verifyState === 'loading'}
            error={verifyState === 'error'}
            label="Verification code"
          />
        </Animated.View>

        {onResend ? (
          <Row gap={6} style={{ justifyContent: 'center' }}>
            <Txt v="small">Didn&apos;t get it?</Txt>
            {resendSeconds > 0 ? (
              <Txt v="smallStrong" color={C.ink4}>
                Resend in {Math.floor(resendSeconds / 60)}:{String(resendSeconds % 60).padStart(2, '0')}
              </Txt>
            ) : (
              <TextLink
                label={resending ? 'Sending…' : 'Resend code'}
                color={resending ? C.ink4 : C.skyPressed}
                onPress={() => void handleResend()}
              />
            )}
          </Row>
        ) : null}
      </View>

      {status}

      {tip != null && (
        <Txt v="small" color={C.ink4} center style={{ alignSelf: 'center', maxWidth: 290 }}>
          {tip}
        </Txt>
      )}
    </AuthScreen>
  );
}
