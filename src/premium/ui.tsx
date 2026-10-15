/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — primitives.
 * Pure presentational building blocks; every screen composes these.
 */
import { Image, type ImageStyle } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Check, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";

import { IMG, type ImgKey } from "./images";
import { C, DESCENDERS, F, G, R, S, SH, T } from "./theme";

/* ───────────────────────── text ───────────────────────── */

export type TxtVariant = keyof typeof T;

export function Txt({
  v = "body",
  color,
  center,
  style,
  lines,
  children,
}: {
  v?: TxtVariant;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  lines?: number;
  children: ReactNode;
}) {
  return (
    <Text
      numberOfLines={lines}
      style={[T[v] as TextStyle, color != null && { color }, center && { textAlign: "center" }, style]}
    >
      {children}
    </Text>
  );
}

/** Editorial serif accent — use for one or two words inside a headline. */
export function Serif({ children, color, size }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <Text style={[T.serif as TextStyle, { fontSize: size, color: color ?? C.ink, letterSpacing: -0.2 }]}>
      {children}
    </Text>
  );
}

/* ───────────────────────── press ───────────────────────── */

export function Press({
  onPress,
  style,
  children,
  scaleTo = 0.97,
  label,
  disabled,
  role,
}: {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  scaleTo?: number;
  label?: string;
  disabled?: boolean;
  role?: "button" | "link";
}) {
  const scale = useState(() => new Animated.Value(1))[0];
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const outer: ViewStyle = {
    flex: flat.flex,
    flexGrow: flat.flexGrow,
    width: flat.width,
    alignSelf: flat.alignSelf,
    marginTop: flat.marginTop,
  };
  const to = (v: number) => Animated.spring(scale, { toValue: v, speed: 40, bounciness: 6, useNativeDriver: true }).start();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={role}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      style={outer}
    >
      <Animated.View style={[style, { marginTop: 0 }, outer.flex != null && { flex: 1 }, outer.width != null && { width: "100%" }, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export const go = (href: string) => () => router.push(href as never);
export const back = () => (router.canGoBack() ? router.back() : router.replace("/" as never));

/* ───────────────────────── layout ───────────────────────── */

export function Screen({
  children,
  scroll = true,
  bg = C.canvas,
  edges = ["top"],
  footer,
  contentStyle,
  header,
  keyboard,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  bg?: string;
  edges?: Edge[];
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  /** Forms: lift content + footer above the software keyboard. Android needs
   *  "height" too: edge-to-edge doesn't resize the window, so without it the
   *  keyboard covers the footer button (AuthScreen does the same). */
  keyboard?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  // With no footer (which pads itself) and no bottom edge, the end of the
  // page scrolled under the Android navigation bar: keep it clear.
  const insets = useSafeAreaInsets();
  const bottomInset = footer == null && !edges.includes("bottom") ? insets.bottom : 0;
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} enabled={!!keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        {header}
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.sky} /> : undefined
            }
            contentContainerStyle={[{ paddingHorizontal: S.gutter, paddingBottom: 40 + bottomInset, gap: S.section }, contentStyle]}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, paddingHorizontal: S.gutter }, contentStyle]}>{children}</View>
        )}
        {footer != null && <Footer>{footer}</Footer>}
      </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Sticky bottom action area with a soft top fade. */
export function Footer({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={["bottom"]} style={{ paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: 12, gap: 10 }}>
      {children}
    </SafeAreaView>
  );
}

export function Row({ children, gap = 12, style, between, align = "center" }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; between?: boolean; align?: ViewStyle["alignItems"] }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: align, gap }, between && { justifyContent: "space-between" }, style]}>
      {children}
    </View>
  );
}

export function Col({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Spacer({ h = 0, flex }: { h?: number; flex?: boolean }) {
  return <View style={flex ? { flex: 1 } : { height: h }} />;
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: C.lineSoft, marginLeft: inset }, style]} />;
}

/* ───────────────────────── header ───────────────────────── */

export function IconCircle({
  icon: Icon,
  onPress,
  tone = "light",
  size = 44,
  label,
  dot,
}: {
  icon: LucideIcon;
  onPress?: () => void;
  tone?: "light" | "glass" | "sky" | "plain";
  size?: number;
  label?: string;
  dot?: boolean;
}) {
  const bg =
    tone === "glass" ? "rgba(255,255,255,0.18)" : tone === "sky" ? C.sky : tone === "plain" ? "transparent" : C.surface;
  const fg = tone === "glass" || tone === "sky" ? C.white : C.ink;
  return (
    <Press onPress={onPress} label={label}>
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            alignItems: "center",
            justifyContent: "center",
          },
          tone === "light" && { borderWidth: 1, borderColor: C.line },
          tone === "glass" && { borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
        ]}
      >
        <Icon size={Math.round(size * 0.44)} color={fg} strokeWidth={2} />
        {dot && (
          <View
            style={{
              position: "absolute",
              top: size * 0.22,
              right: size * 0.24,
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: C.sky,
              borderWidth: 2,
              borderColor: bg === "transparent" ? C.canvas : bg,
            }}
          />
        )}
      </View>
    </Press>
  );
}

export function TopBar({
  title,
  right,
  tone = "light",
  onBack = back,
  hideBack,
  style,
}: {
  title?: string;
  right?: ReactNode;
  tone?: "light" | "glass";
  onBack?: () => void;
  hideBack?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height: 60, paddingHorizontal: S.gutter, flexDirection: "row", alignItems: "center" }, style]}>
      <View style={{ width: 44 }}>
        {!hideBack && <IconCircle icon={ChevronLeft} tone={tone} onPress={onBack} label="Back" />}
      </View>
      <View style={{ flex: 1, alignItems: "center" }}>
        {title != null && (
          <Txt v="h3" color={tone === "glass" ? C.white : C.ink} style={{ fontSize: 16 }} lines={1}>
            {title}
          </Txt>
        )}
      </View>
      <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

/** Big screen title block — overline, headline (with optional serif), body. */
export function Heading({
  over,
  title,
  accent,
  after,
  sub,
  center,
  light,
  size = "title",
}: {
  over?: string;
  title: string;
  accent?: string;
  after?: string;
  sub?: string;
  center?: boolean;
  light?: boolean;
  size?: "title" | "display";
}) {
  const fs = size === "display" ? 44 : 34;
  return (
    <View style={{ gap: 10, alignItems: center ? "center" : "flex-start" }}>
      {over != null && (
        <Txt v="micro" color={light ? C.skyLight : C.sky}>
          {over}
        </Txt>
      )}
      <Text style={[T[size] as TextStyle, DESCENDERS, light && { color: C.white }, center && { textAlign: "center" }]}>
        {title}
        {accent != null && (
          <>
            {" "}
            <Serif size={fs} color={light ? C.skyLight : C.sky}>
              {accent}
            </Serif>
          </>
        )}
        {after != null && <> {after}</>}
      </Text>
      {sub != null && (
        <Txt v="body" color={light ? "rgba(255,255,255,0.72)" : C.ink3} center={center} style={{ maxWidth: 340 }}>
          {sub}
        </Txt>
      )}
    </View>
  );
}

/* ───────────────────────── buttons ───────────────────────── */

export type ButtonTone = "sky" | "ink" | "white" | "soft" | "ghost" | "glass" | "danger";

export function Button({
  label,
  onPress,
  tone = "sky",
  icon: Icon,
  iconRight: IconR,
  size = "lg",
  style,
  full = true,
  loading,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  size?: "lg" | "md" | "sm";
  style?: StyleProp<ViewStyle>;
  full?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = !!disabled || !!loading;
  const h = size === "lg" ? 58 : size === "md" ? 48 : 38;
  const fg =
    tone === "sky" || tone === "ink" || tone === "danger" || tone === "glass"
      ? C.white
      : tone === "soft"
        ? C.navy
        : C.ink;
  const base: ViewStyle = {
    height: h,
    borderRadius: R.full,
    paddingHorizontal: size === "sm" ? 16 : 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
    alignSelf: full ? "stretch" : "flex-start",
  };
  const skin: ViewStyle =
    tone === "ink"
      ? { backgroundColor: C.ink }
      : tone === "white"
        ? { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }
        : tone === "soft"
          ? { backgroundColor: C.skyWash }
          : tone === "ghost"
            ? { backgroundColor: "transparent" }
            : tone === "glass"
              ? { backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }
            : tone === "danger"
              ? { backgroundColor: C.red }
              : {};
  return (
    <Press
      onPress={onPress}
      label={label}
      role="button"
      disabled={inactive}
      style={[full && { alignSelf: "stretch" }, tone === "sky" && !inactive && SH.sky, { borderRadius: R.full }, style]}
    >
      <View style={[base, skin, disabled && !loading && { opacity: 0.45 }]}>
        {tone === "sky" && <LinearGradient colors={G.sky} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          Icon && (
            <View>
              <Icon size={size === "sm" ? 16 : 19} color={fg} strokeWidth={2.2} />
            </View>
          )
        )}
        <Text style={{ fontFamily: F.bold, fontSize: size === "sm" ? 13.5 : 16, letterSpacing: -0.1, color: fg }}>{label}</Text>
        {IconR && (
          <View>
            <IconR size={size === "sm" ? 16 : 19} color={fg} strokeWidth={2.2} />
          </View>
        )}
      </View>
    </Press>
  );
}

export function TextLink({ label, onPress, color = C.skyPressed }: { label: string; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8}>
      <Text style={{ fontFamily: F.bold, fontSize: 14, color }}>{label}</Text>
    </Pressable>
  );
}

/* ───────────────────────── surfaces ───────────────────────── */

export function Card({
  children,
  style,
  pad = 18,
  onPress,
  flat,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pad?: number;
  onPress?: () => void;
  flat?: boolean;
}) {
  const body = (
    <View
      style={[
        { backgroundColor: C.surface, borderRadius: R.xl, padding: pad, borderWidth: 1, borderColor: C.lineSoft },
        !flat && SH.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
  return onPress ? <Press onPress={onPress}>{body}</Press> : body;
}

export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row between style={{ marginBottom: -4 }}>
      <Txt v="h3" style={{ fontSize: 18 }}>
        {title}
      </Txt>
      {action != null && <TextLink label={action} onPress={onAction} />}
    </Row>
  );
}

export function Tile({
  icon: Icon,
  tone = "sky",
  size = 44,
  radius,
}: {
  icon: LucideIcon;
  tone?: "sky" | "navy" | "green" | "amber" | "red" | "neutral" | "white";
  size?: number;
  radius?: number;
}) {
  const map = {
    sky: [C.skyWash, C.skyPressed],
    navy: [C.navy, C.white],
    green: [C.greenWash, C.greenInk],
    amber: [C.amberWash, C.amberInk],
    red: [C.redWash, C.redInk],
    neutral: [C.sunken, C.ink2],
    white: [C.surface, C.ink],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? size * 0.32,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={Math.round(size * 0.46)} color={fg} strokeWidth={2} />
    </View>
  );
}

/** List row: leading tile, title/subtitle, trailing value or chevron. */
export function ListRow({
  icon,
  tone,
  title,
  sub,
  value,
  trailing,
  onPress,
  danger,
  chevron = true,
}: {
  icon?: LucideIcon;
  tone?: Parameters<typeof Tile>[0]["tone"];
  title: string;
  sub?: string;
  value?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 }}>
        {icon && <Tile icon={icon} tone={danger ? "red" : tone ?? "neutral"} size={40} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="bodyStrong" color={danger ? C.redInk : C.ink} lines={2}>
            {title}
          </Txt>
          {sub != null && (
            <Txt v="small" lines={2}>
              {sub}
            </Txt>
          )}
        </View>
        {value != null && <Txt v="small">{value}</Txt>}
        {trailing}
        {chevron && trailing == null && <ChevronRight size={18} color={C.ink4} />}
      </View>
    </Pressable>
  );
}

/** Grouped card of rows separated by inset hairlines (iOS settings style). */
export function Group({ children, title }: { children: ReactNode[] | ReactNode; title?: string }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: 10 }}>
      {title != null && <Txt v="micro" style={{ marginLeft: 4 }}>{title}</Txt>}
      <Card pad={0} style={{ paddingHorizontal: 16 }}>
        {items.map((c, i) => (
          <View key={i}>
            {i > 0 && <Divider inset={54} />}
            {c}
          </View>
        ))}
      </Card>
    </View>
  );
}

/* ───────────────────────── status ───────────────────────── */

export type BadgeTone = "green" | "amber" | "sky" | "red" | "neutral" | "glass" | "navy";

export function Badge({ label, tone = "green", icon: Icon, dot }: { label: string; tone?: BadgeTone; icon?: LucideIcon; dot?: boolean }) {
  const map: Record<BadgeTone, [string, string]> = {
    green: [C.greenWash, C.greenInk],
    amber: [C.amberWash, C.amberInk],
    sky: [C.skyWash, C.navy],
    red: [C.redWash, C.redInk],
    neutral: [C.sunken, C.ink2],
    glass: ["rgba(255,255,255,0.16)", C.white],
    navy: [C.navy, C.white],
  };
  const [bg, fg] = map[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: bg,
        paddingHorizontal: 10,
        minHeight: 26,
        paddingVertical: 4,
        borderRadius: R.full,
        alignSelf: "flex-start",
      }}
    >
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />}
      {Icon && <Icon size={13} color={fg} strokeWidth={2.6} />}
      {/* Shrinks and wraps when the parent is narrower than the label (a
          family card on a 360dp phone) instead of being clipped. */}
      <Text style={{ flexShrink: 1, fontFamily: F.bold, fontSize: 12, color: fg, letterSpacing: 0.1 }}>{label}</Text>
    </View>
  );
}

export function VerifiedTick({ size = 18, color = C.sky }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Check size={size * 0.62} color={C.white} strokeWidth={3.4} />
    </View>
  );
}

/* ───────────────────────── media ───────────────────────── */

export function Photo({ src, style }: { src: ImgKey; style?: StyleProp<ImageStyle> }) {
  return <Image source={IMG[src]} style={style} contentFit="cover" transition={200} />;
}

export function Avatar({
  src,
  uri,
  name,
  size = 44,
  ring,
  status,
  ringColor = C.sky,
  tint,
}: {
  /** Bundled mock photo (showcase). Real data passes `uri` and/or `name`. */
  src?: ImgKey;
  uri?: string | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
  status?: "verified" | "pending";
  ringColor?: string;
  /** Initials background / text colours (defaults to sky). */
  tint?: readonly [string, string];
}) {
  const inner = ring ? size - 6 : size;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" },
        ring && { borderWidth: 2, borderColor: ringColor },
      ]}
    >
      {uri || src ? (
        <Image
          source={uri ? { uri } : IMG[src as ImgKey]}
          style={{ width: inner - (ring ? 2 : 0), height: inner - (ring ? 2 : 0), borderRadius: inner / 2 }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            width: inner - (ring ? 2 : 0),
            height: inner - (ring ? 2 : 0),
            borderRadius: inner / 2,
            backgroundColor: tint?.[0] ?? C.skyWash,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: F.bold, fontSize: Math.round(size * 0.36), color: tint?.[1] ?? C.navy }}>{initials(name)}</Text>
        </View>
      )}
      {status != null && (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: Math.max(16, size * 0.3),
            height: Math.max(16, size * 0.3),
            borderRadius: size,
            backgroundColor: status === "verified" ? C.sky : C.amber,
            borderWidth: 2.5,
            borderColor: C.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {status === "verified" && <Check size={Math.max(9, size * 0.15)} color={C.white} strokeWidth={4} />}
        </View>
      )}
    </View>
  );
}

export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/* ───────────────────────── form ───────────────────────── */

export function Field({
  label,
  value,
  placeholder,
  icon: Icon,
  right,
  focused,
  secure,
  hint,
  error,
  onChangeText,
  onBlur,
  keyboardType,
  editable = true,
  inputProps,
  left,
}: {
  label: string;
  /** Controlled when `onChangeText` is passed; otherwise a static showcase value. */
  value?: string;
  placeholder?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  /** Force the focused look (showcase). Real inputs track focus themselves. */
  focused?: boolean;
  secure?: boolean;
  hint?: string;
  error?: string;
  onChangeText?: (t: string) => void;
  onBlur?: () => void;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  /** Extra TextInput props (autoComplete, maxLength, autoCapitalize, textContentType...). */
  inputProps?: Omit<TextInputProps, "value" | "onChangeText" | "onBlur" | "style">;
  /** Leading element after the icon (e.g. a country-code picker). */
  left?: ReactNode;
}) {
  const [hasFocus, setHasFocus] = useState(false);
  const isFocused = !!focused || hasFocus;
  const controlled = onChangeText != null;
  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        {label}
      </Txt>
      <View
        style={[
          {
            height: 56,
            borderRadius: R.md,
            backgroundColor: C.surface,
            borderWidth: 1.5,
            borderColor: error ? C.red : isFocused ? C.sky : C.line,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            gap: 12,
          },
          isFocused && !error && { boxShadow: "0px 0px 0px 4px rgba(8,182,252,0.14)" },
          !editable && { backgroundColor: C.sunken, borderStyle: "dashed" },
        ]}
      >
        {Icon && <Icon size={19} color={isFocused ? C.sky : C.ink3} strokeWidth={2} />}
        {left}
        <TextInput
          {...inputProps}
          {...(controlled ? { value } : { defaultValue: value })}
          onChangeText={onChangeText}
          onFocus={(e) => {
            setHasFocus(true);
            inputProps?.onFocus?.(e);
          }}
          onBlur={() => {
            setHasFocus(false);
            onBlur?.();
          }}
          editable={editable}
          keyboardType={keyboardType}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={C.ink4}
          secureTextEntry={secure}
          style={{ flex: 1, fontFamily: F.semibold, fontSize: 15.5, color: C.ink, outlineStyle: "none" } as unknown as TextStyle}
        />
        {right}
      </View>
      {(hint != null || error != null) && (
        <Txt v="small" color={error ? C.redInk : C.ink3}>
          {error ?? hint}
        </Txt>
      )}
    </View>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  const knob = (
    <View
      style={{
        width: 50,
        height: 30,
        borderRadius: 15,
        padding: 3,
        backgroundColor: on ? C.sky : C.line,
        alignItems: on ? "flex-end" : "flex-start",
      }}
    >
      <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.white }, SH.sm]} />
    </View>
  );
  if (!onChange) return knob;
  return (
    <Pressable
      onPress={() => onChange(!on)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: !!on, disabled: !!disabled }}
      hitSlop={8}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {knob}
    </Pressable>
  );
}

export function Chip({ label, active, icon: Icon, onPress }: { label: string; active?: boolean; icon?: LucideIcon; onPress?: () => void }) {
  const body = (
    <View
      style={{
        height: 38,
        paddingHorizontal: 16,
        borderRadius: R.full,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: active ? C.ink : C.surface,
        borderWidth: 1,
        borderColor: active ? C.ink : C.line,
      }}
    >
      {Icon && <Icon size={15} color={active ? C.white : C.ink2} />}
      <Text style={{ fontFamily: F.semibold, fontSize: 13.5, color: active ? C.white : C.ink2 }}>{label}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      {body}
    </Pressable>
  );
}

/** Segmented progress for guided flows (Royal Caribbean style). */
export function Steps({ total, current, light }: { total: number; current: number; light?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= current ? C.sky : light ? "rgba(255,255,255,0.2)" : C.line,
          }}
        />
      ))}
    </View>
  );
}

/** Six OTP/PIN cells. `filled` digits shown, cursor on the next cell. */
export function CodeCells({ value, length = 6, dots }: { value: string; length?: number; dots?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
      {Array.from({ length }, (_, i) => {
        const ch = value[i];
        const active = i === value.length;
        return (
          <View
            key={i}
            style={[
              {
                flex: 1,
                maxWidth: 54,
                height: 62,
                borderRadius: R.md,
                backgroundColor: C.surface,
                borderWidth: 1.5,
                borderColor: active ? C.sky : ch ? C.line : C.lineSoft,
                alignItems: "center",
                justifyContent: "center",
              },
              active && { boxShadow: "0px 0px 0px 4px rgba(8,182,252,0.14)" },
            ]}
          >
            {ch != null &&
              (dots ? (
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.ink }} />
              ) : (
                <Text style={{ fontFamily: F.bold, fontSize: 24, color: C.ink }}>{ch}</Text>
              ))}
            {active && <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: C.sky }} />}
          </View>
        );
      })}
    </View>
  );
}
