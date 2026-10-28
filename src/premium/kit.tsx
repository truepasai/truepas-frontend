/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — data-ready kit: real OTP/PIN input, async state blocks,
 * skeletons, "Coming soon" markers, inline banners and a confirm sheet.
 * Screens wired to the real API compose these alongside ui.tsx / blocks.tsx.
 */
import { AlertTriangle, CheckCircle2, CircleAlert, Clock, Inbox, Info, type LucideIcon, RotateCcw } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/api/errors";

import { C, F, R, SH } from "./theme";
import { Button, Card, Txt } from "./ui";

/* ───────────────────────── code input (OTP / PIN) ───────────────────────── */

/**
 * Segmented code input — premium cells over ONE invisible TextInput so paste,
 * SMS autofill and screen readers work (same approach as composite/OtpInput).
 * `dots` masks digits (PIN). Cells are circles (TruePas look — FacePe uses
 * squares), up to 54px and shrinking to fit 6 on small phones.
 */
export function CodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  error,
  dots,
  autoFocus = true,
  disabled,
  label = "One-time code",
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  dots?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const handle = (t: string) => {
    const clean = t.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };
  return (
    <View style={{ alignSelf: "stretch" }}>
      <View
        style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length }, (_, i) => {
          const ch = value[i];
          const active = focused && i === value.length;
          return (
            <View
              key={i}
              style={[
                {
                  flex: 1,
                  maxWidth: 54,
                  aspectRatio: 1,
                  borderRadius: R.full,
                  backgroundColor: disabled ? C.sunken : C.surface,
                  borderWidth: 1.5,
                  borderColor: error ? C.red : active ? C.sky : ch ? C.line : C.lineSoft,
                  alignItems: "center",
                  justifyContent: "center",
                },
                active && !error && { boxShadow: "0px 0px 0px 4px rgba(8,182,252,0.14)" },
              ]}
            >
              {ch != null &&
                (dots ? (
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: error ? C.red : C.ink }} />
                ) : (
                  <Text style={{ fontFamily: F.bold, fontSize: 24, color: error ? C.redInk : C.ink }}>{ch}</Text>
                ))}
              {active && <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: C.sky }} />}
            </View>
          );
        })}
      </View>
      <TextInput
        value={value}
        onChangeText={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        // No secureTextEntry / "password" for PINs: on a form that also has a
        // new-password field (registration), iOS applies Automatic Strong
        // Password to every secure field and locks it behind an overlay the
        // user can't see on this invisible input. Masking comes from `dots`.
        textContentType={dots ? "none" : "oneTimeCode"}
        autoComplete={dots ? "off" : "sms-otp"}
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        accessibilityLabel={label}
        accessibilityValue={{ text: `${value.length} of ${length} digits entered` }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
      />
    </View>
  );
}

/* ───────────────────────── async states ───────────────────────── */

export function Spinner({ size = 28, color = C.sky }: { size?: number; color?: string }) {
  return <ActivityIndicator size={size > 24 ? "large" : "small"} color={color} />;
}

export function LoadingView({ label = "Loading…", full }: { label?: string; full?: boolean }) {
  return (
    <View
      style={[{ alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }, full && { flex: 1, minHeight: 260 }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Spinner />
      {!!label && <Txt v="small">{label}</Txt>}
    </View>
  );
}

function StateShell({
  icon: Icon,
  tone,
  title,
  body,
  action,
  compact,
}: {
  icon: LucideIcon;
  tone: "neutral" | "red";
  title: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingVertical: compact ? 22 : 40, paddingHorizontal: 20 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: tone === "red" ? C.redWash : C.skyWash,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <Icon size={24} color={tone === "red" ? C.redInk : C.skyPressed} strokeWidth={2} />
      </View>
      <Txt v="h3" center>
        {title}
      </Txt>
      {!!body && (
        <Txt v="small" center style={{ maxWidth: 290, lineHeight: 19 }}>
          {body}
        </Txt>
      )}
      {action != null && <View style={{ marginTop: 6 }}>{action}</View>}
    </View>
  );
}

export function EmptyView({
  title = "Nothing here yet",
  body,
  icon = Inbox,
  action,
  compact,
}: {
  title?: string;
  body?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return <StateShell icon={icon} tone="neutral" title={title} body={body} action={action} compact={compact} />;
}

export function ErrorView({
  title = "Couldn't load",
  body = "Check your connection and try again.",
  onRetry,
  compact,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <StateShell
      icon={CircleAlert}
      tone="red"
      title={title}
      body={body}
      compact={compact}
      action={onRetry ? <Button label="Try again" tone="white" size="sm" full={false} icon={RotateCcw} onPress={onRetry} /> : undefined}
    />
  );
}

/** Minimal React Query shape — any useQuery result satisfies it. */
export interface QueryLike<T> {
  data: T | null | undefined;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => unknown;
}

/** Premium AsyncBlock: skeleton → error → empty → content. Keeps content during refetch. */
export function Async<T>({
  q,
  skeleton,
  empty,
  emptyView,
  compact,
  children,
}: {
  q: QueryLike<T>;
  skeleton?: ReactNode;
  /** Predicate: data present but empty (e.g. []). */
  empty?: (d: T) => boolean;
  emptyView?: ReactNode;
  compact?: boolean;
  children: (d: T) => ReactNode;
}) {
  if (q.isPending && q.data == null) return <>{skeleton ?? <LoadingView />}</>;
  // User-facing text ("Cannot reach the server…"), never axios's raw
  // "Request failed with status code 404" / "Network Error".
  if (q.isError && q.data == null)
    return (
      <ErrorView
        compact={compact}
        body={q.error != null ? toApiError(q.error).message : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  if (q.data == null || empty?.(q.data)) return <>{emptyView ?? <EmptyView compact={compact} />}</>;
  return <>{children(q.data)}</>;
}

/* ───────────────────────── skeletons ───────────────────────── */

function usePulse() {
  const v = useState(() => new Animated.Value(0.55))[0];
  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    l.start();
    return () => l.stop();
  }, [v]);
  return v;
}

export function Bone({ w = "100%", h = 14, r = 7, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const o = usePulse();
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.sunken, opacity: o }, style]} />;
}

/** List placeholder: N rows of thumbnail + two text lines inside a card. */
export function SkeletonList({ rows = 3, thumb = 52 }: { rows?: number; thumb?: number }) {
  return (
    <Card pad={0} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 }}>
          <Bone w={thumb} h={thumb} r={16} />
          <View style={{ flex: 1, gap: 8 }}>
            <Bone w="62%" />
            <Bone w="38%" h={11} />
          </View>
        </View>
      ))}
    </Card>
  );
}

/* ───────────────────────── coming soon ───────────────────────── */

/** Small pill marking a feature that has no backend yet. */
export function ComingSoon({ light, label = "Coming soon" }: { light?: boolean; label?: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 24,
        paddingHorizontal: 9,
        borderRadius: R.full,
        alignSelf: "flex-start",
        backgroundColor: light ? "rgba(255,255,255,0.16)" : C.sunken,
        borderWidth: 1,
        borderColor: light ? "rgba(255,255,255,0.24)" : C.line,
      }}
    >
      <Clock size={11} color={light ? C.white : C.ink3} strokeWidth={2.4} />
      <Text style={{ fontFamily: F.bold, fontSize: 11, letterSpacing: 0.2, color: light ? C.white : C.ink3 }}>{label}</Text>
    </View>
  );
}

/**
 * Wraps an approved-design element whose feature isn't backed by the API:
 * dims it, blocks interaction and pins a "Coming soon" pill on top.
 */
export function SoonOverlay({ children, light, style }: { children: ReactNode; light?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} accessibilityState={{ disabled: true }} accessibilityHint="Coming soon">
      <View pointerEvents="none" style={{ opacity: 0.55 }}>
        {children}
      </View>
      <View pointerEvents="none" style={{ position: "absolute", top: 10, right: 10 }}>
        <ComingSoon light={light} />
      </View>
    </View>
  );
}

/* ───────────────────────── banner ───────────────────────── */

export type BannerTone = "info" | "success" | "warning" | "error";

export function Banner({ tone = "info", title, body, action }: { tone?: BannerTone; title?: string; body?: string; action?: ReactNode }) {
  const map: Record<BannerTone, [string, string, string, LucideIcon]> = {
    info: [C.skyMist, C.skyWash, C.navy, Info],
    success: [C.greenWash, C.greenWash, C.greenInk, CheckCircle2],
    warning: [C.amberWash, C.amberWash, C.amberInk, AlertTriangle],
    error: [C.redWash, C.redWash, C.redInk, CircleAlert],
  };
  const [bg, border, fg, Icon] = map[tone];
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: R.lg, backgroundColor: bg, borderWidth: 1, borderColor: border }}
    >
      <Icon size={18} color={fg} strokeWidth={2.2} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {!!title && <Txt v="smallStrong" color={fg}>{title}</Txt>}
        {!!body && (
          <Txt v="small" color={fg} style={{ lineHeight: 19, opacity: 0.9 }}>
            {body}
          </Txt>
        )}
        {action != null && <View style={{ marginTop: 8 }}>{action}</View>}
      </View>
    </View>
  );
}

/* ───────────────────────── confirm sheet ───────────────────────── */

/** Bottom-sheet confirmation (replaces Alert.alert for destructive actions). */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  loading,
  onConfirm,
  onCancel,
  icon: Icon = AlertTriangle,
  children,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(1,27,39,0.45)" }} onPress={onCancel} accessibilityLabel="Close" />
      <View
        style={[
          {
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10 + insets.bottom,
            backgroundColor: C.surface,
            borderRadius: 32,
            padding: 22,
            gap: 16,
          },
          SH.lg,
        ]}
      >
        <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: C.line }} />
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: danger ? C.redWash : C.skyWash,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={24} color={danger ? C.redInk : C.skyPressed} />
        </View>
        <View style={{ gap: 6 }}>
          <Txt v="h2">{title}</Txt>
          {!!body && <Txt v="body">{body}</Txt>}
        </View>
        {children}
        <View style={{ gap: 8 }}>
          <Button label={confirmLabel} tone={danger ? "danger" : "sky"} loading={loading} onPress={onConfirm} />
          <Button label={cancelLabel} tone="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}
