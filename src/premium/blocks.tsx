/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — signature blocks: identity card, journey cards, face
 * scanner, wallet documents, tab bar, keypad.
 */
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  BedDouble,
  CalendarCheck,
  Clapperboard,
  Delete,
  FerrisWheel,
  House,
  type LucideIcon,
  Music2,
  Plane,
  ScanFace,
  Ship,
  Trophy,
  Users,
  Wallet,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { KIND_LABEL, USER, type Doc, type Trip, type TripKind } from "./data";
import { IMG } from "./images";
import { C, F, G, R, SH } from "./theme";
import { Badge, Press, Row, Txt, VerifiedTick } from "./ui";

/* ───────────────────────── brand ───────────────────────── */

export function Logo({ size = 22, color = C.sky }: { size?: number; color?: string }) {
  return (
    <Svg width={size * (546 / 404)} height={size} viewBox="0 0 546 404">
      <Path fill={color} d="M0 0h263c44 0 77 30 77 72 0 14-4 29-11 42L177 404l-76-97 106-195H86L0 0Z" />
      <Path fill={color} d="M420 0h93c18 0 33 15 33 32 0 6-2 12-5 18l-15 27c-12 21-39 35-66 35H360L420 0Z" />
    </Svg>
  );
}

/** `ring`: the mark in a sky-blue badge with a soft glow, like the tab
 *  bar's scan button (the identity card uses it). */
export function Wordmark({ light, size = 20, ring }: { light?: boolean; size?: number; ring?: boolean }) {
  return (
    <Row gap={9}>
      {ring ? (
        <View style={{ borderRadius: size, boxShadow: "0px 4px 14px rgba(8,182,252,0.45)" }}>
          <LinearGradient
            colors={["#2EC4FF", C.skyPressed]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: size * 2,
              height: size * 2,
              borderRadius: size,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.35)",
              alignItems: "center",
              justifyContent: "center",
            }}>
            {/* The mark is wider than tall and weighted left: nudge it to look centred. */}
            <View style={{ marginLeft: size * 0.1 }}>
              <Logo size={size * 0.76} color={C.white} />
            </View>
          </LinearGradient>
        </View>
      ) : (
        <Logo size={size * 0.9} color={light ? C.white : C.sky} />
      )}
      <Text style={{ fontFamily: F.extrabold, fontSize: size, letterSpacing: -0.6, color: light ? C.white : C.ink }}>
        TruePas
      </Text>
    </Row>
  );
}

/** Soft radial light — the "glow" behind hero moments. */
export function Glow({ color = C.sky, size = 320, opacity = 0.55, style }: { color?: string; size?: number; opacity?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[{ position: "absolute", width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#g)" />
      </Svg>
    </View>
  );
}

/** Concentric guilloché-like arcs — the security pattern on identity surfaces. */
export function Guilloche({ size = 360, color = "#FFFFFF", opacity = 0.07, style }: { size?: number; color?: string; opacity?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[{ position: "absolute", width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        {Array.from({ length: 14 }, (_, i) => (
          <Circle key={i} cx={size / 2} cy={size / 2} r={18 + i * 12} stroke={color} strokeOpacity={opacity * (1 - i / 18)} strokeWidth={1} fill="none" />
        ))}
      </Svg>
    </View>
  );
}

/* ───────────────────────── identity ───────────────────────── */

export interface IdentityMeta {
  k: string;
  v: string;
}

export function IdentityCard({
  onPress,
  compact,
  name = USER.name,
  idLine = USER.id,
  photoUri,
  verified = true,
  statusLabel,
  meta = [
    { k: "Face", v: "Linked" },
    { k: "Documents", v: "3 verified" },
    { k: "Member since", v: USER.since },
  ],
}: {
  onPress?: () => void;
  compact?: boolean;
  name?: string;
  /** Second line under the name (ID number, email...). */
  idLine?: string;
  /** Real profile photo; falls back to initials when null and no showcase photo. */
  photoUri?: string | null;
  verified?: boolean;
  statusLabel?: string;
  meta?: IdentityMeta[];
}) {
  return (
    <Press onPress={onPress} scaleTo={0.985} style={[{ borderRadius: R.xxl }, SH.navy]}>
      <View style={{ borderRadius: R.xxl, overflow: "hidden", padding: 22, gap: compact ? 18 : 26 }}>
        <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Glow size={300} opacity={0.5} style={{ top: -150, right: -110 }} />
        <Guilloche size={420} style={{ right: -210, bottom: -230 }} />

        <Row between>
          <Wordmark light ring size={17} />
          <Badge label={statusLabel ?? (verified ? "Verified" : "Setup pending")} tone={verified ? "glass" : "amber"} icon={verified ? ScanFace : undefined} dot={!verified} />
        </Row>

        <Row gap={16} align="flex-end">
          <View style={{ padding: 3, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.14)" }}>
            {photoUri !== undefined && !photoUri ? (
              <View style={{ width: compact ? 64 : 76, height: compact ? 72 : 88, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: F.bold, fontSize: 24, color: C.white }}>{initialsOf(name)}</Text>
              </View>
            ) : (
              <Image source={photoUri ? { uri: photoUri } : IMG.user} style={{ width: compact ? 64 : 76, height: compact ? 72 : 88, borderRadius: 20 }} contentFit="cover" />
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.4, color: C.skyLight }}>DIGITAL IDENTITY</Text>
            <Text style={{ fontFamily: F.bold, fontSize: 22, letterSpacing: -0.5, color: C.white }} numberOfLines={1}>{name}</Text>
            {/* A long email doesn't fit one line on a narrow (360dp) phone:
                wrap to a second line before the @ instead of cutting it off. */}
            {!!idLine && (
              <Text style={{ fontFamily: F.mono, fontSize: 13, letterSpacing: idLine.includes("@") ? 0.2 : 2, color: "rgba(255,255,255,0.66)" }} numberOfLines={2}>
                {idLine.replace("@", "​@")}
              </Text>
            )}
          </View>
        </Row>

        {!compact && meta.length > 0 && (
          <Row between style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" }}>
            {meta.map((m) => (
              <Meta key={m.k} k={m.k} v={m.v} />
            ))}
          </Row>
        )}
      </View>
    </Press>
  );
}

function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return p.length ? ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() : "?";
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ fontFamily: F.medium, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>{k}</Text>
      <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.white }}>{v}</Text>
    </View>
  );
}

/* ───────────────────────── journeys ───────────────────────── */

export const KIND_ICON: Record<TripKind, LucideIcon> = {
  hotel: BedDouble,
  park: FerrisWheel,
  flight: Plane,
  cinema: Clapperboard,
  cruise: Ship,
  stadium: Trophy,
  concert: Music2,
};

function GlassChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingHorizontal: 12,
        borderRadius: R.full,
        backgroundColor: "rgba(10,30,42,0.42)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.22)",
        alignSelf: "flex-start",
      }}
    >
      <Icon size={14} color={C.white} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.semibold, fontSize: 12.5, color: C.white }}>{label}</Text>
    </View>
  );
}

/** Hero journey — full-bleed photography with the primary check-in action. */
export function JourneyHero({ trip, onPress, cta }: { trip: Trip; onPress?: () => void; cta?: ReactNode }) {
  return (
    <Press onPress={onPress} scaleTo={0.985} style={[{ borderRadius: R.xxl }, SH.lg]}>
      <View style={{ height: 420, borderRadius: R.xxl, overflow: "hidden", justifyContent: "space-between", padding: 18 }}>
        <Image source={IMG[trip.image]} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient colors={G.photoFade} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
        <Row between>
          <GlassChip icon={KIND_ICON[trip.kind]} label={KIND_LABEL[trip.kind]} />
          {trip.status === "ready" && <Badge label="Ready for face check-in" tone="green" dot />}
        </Row>
        <View style={{ gap: 14 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.skyLight }}>{trip.when}</Text>
            <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -0.9, color: C.white }}>{trip.title}</Text>
            <Text style={{ fontFamily: F.medium, fontSize: 14, color: "rgba(255,255,255,0.78)" }}>
              {trip.place} · {trip.detail}
            </Text>
          </View>
          {cta}
        </View>
      </View>
    </Press>
  );
}

/** Horizontal carousel card. */
export function JourneyCard({ trip, onPress, width = 248 }: { trip: Trip; onPress?: () => void; width?: number }) {
  const Icon = KIND_ICON[trip.kind];
  return (
    <Press onPress={onPress} style={[{ width, borderRadius: R.xl }, SH.md]}>
      <View style={{ borderRadius: R.xl, overflow: "hidden", backgroundColor: C.surface }}>
        <View style={{ height: 150 }}>
          <Image source={IMG[trip.image]} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={{ position: "absolute", left: 12, top: 12 }}>
            <GlassChip icon={Icon} label={KIND_LABEL[trip.kind]} />
          </View>
        </View>
        <View style={{ padding: 14, gap: 3 }}>
          <Txt v="small" color={C.skyPressed} style={{ fontFamily: F.semibold }}>
            {trip.when}
          </Txt>
          <Txt v="h3" lines={1}>
            {trip.title}
          </Txt>
          <Txt v="small" lines={1}>
            {trip.place}
          </Txt>
        </View>
      </View>
    </Press>
  );
}

/** Compact row with thumbnail — history lists. */
export function TripRow({ trip, onPress }: { trip: Trip; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 }}>
        <Image source={IMG[trip.image]} style={{ width: 62, height: 62, borderRadius: 16 }} contentFit="cover" />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt v="bodyStrong" lines={1}>
            {trip.title}
          </Txt>
          <Txt v="small" lines={1}>
            {KIND_LABEL[trip.kind]} · {trip.place}
          </Txt>
          <Txt v="small" color={C.ink4} lines={1}>
            {trip.when}
          </Txt>
        </View>
        {trip.status === "completed" ? (
          <VerifiedTick size={22} color={C.green} />
        ) : (
          <Badge label={trip.status === "ready" ? "Ready" : "Upcoming"} tone={trip.status === "ready" ? "green" : "sky"} />
        )}
      </View>
    </Pressable>
  );
}

/* ───────────────────────── documents ───────────────────────── */

export function DocCard({ doc, onPress, height = 196, style }: { doc: Doc; onPress?: () => void; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Press onPress={onPress} scaleTo={0.985} style={[{ borderRadius: R.xl }, SH.md, style]}>
      <View style={{ height, borderRadius: R.xl, overflow: "hidden", padding: 20, justifyContent: "space-between" }}>
        <LinearGradient colors={doc.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Guilloche size={340} opacity={0.08} style={{ right: -150, top: -150 }} />
        <Row between align="flex-start">
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.3, color: "rgba(255,255,255,0.6)" }}>
              {doc.issuer.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: F.bold, fontSize: 20, letterSpacing: -0.4, color: C.white }}>{doc.title}</Text>
          </View>
          {doc.status === "verified" ? (
            <Badge label="Verified" tone="glass" icon={ScanFace} />
          ) : (
            <Badge label="In review" tone="amber" dot />
          )}
        </Row>
        <Row between align="flex-end">
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: 2, color: C.white }}>{doc.number}</Text>
            <Text style={{ fontFamily: F.medium, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{USER.name} · {doc.expires}</Text>
          </View>
          <Chip3D />
        </Row>
      </View>
    </Press>
  );
}

/** Small holographic chip in the corner of identity documents. */
function Chip3D() {
  return (
    <View style={{ width: 40, height: 30, borderRadius: 7, overflow: "hidden" }}>
      <LinearGradient colors={["#E9F7FF", "#9FD9F5", "#F3E6C4"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: "absolute", left: 13, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(10,30,42,0.2)" }} />
      <View style={{ position: "absolute", left: 0, right: 0, top: 14, height: 1, backgroundColor: "rgba(10,30,42,0.2)" }} />
    </View>
  );
}

/* ───────────────────────── face scanner ───────────────────────── */

function useSpin(ms = 2600) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, ms]);
  return v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
}

function usePulse(ms = 1800) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, ms]);
  return v;
}

/**
 * The biometric moment. `mode`:
 *  scan    — rotating sky arc + progress ring around the live face
 *  success — solid sky ring with a check medallion
 *  error   — amber ring
 */
export function FaceRing({
  size = 270,
  mode = "scan",
  progress = 0.68,
  dark,
  photo = true,
  src = "user",
  uri,
  children,
}: {
  size?: number;
  mode?: "scan" | "success" | "error" | "idle";
  progress?: number;
  dark?: boolean;
  photo?: boolean;
  src?: keyof typeof IMG;
  /** Real photo URI (overrides the bundled showcase photo). */
  uri?: string | null;
  /** Live content (e.g. the camera preview) rendered inside the circle. */
  children?: ReactNode;
}) {
  const spin = useSpin();
  const pulse = usePulse();
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const ringColor = mode === "error" ? C.amber : C.sky;
  const track = dark ? "rgba(255,255,255,0.12)" : C.line;
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={{ width: size + 60, height: size + 60, alignItems: "center", justifyContent: "center" }}>
      <Glow color={ringColor} size={size + 160} opacity={dark ? 0.35 : 0.22} style={{ left: -50, top: -50 }} />
      {mode !== "idle" && (
        <Animated.View
          style={{
            position: "absolute",
            width: size + 30,
            height: size + 30,
            borderRadius: size,
            borderWidth: 1.5,
            borderColor: ringColor,
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          }}
        />
      )}
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={4} fill="none" />
          {mode !== "idle" && (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={ringColor}
              strokeWidth={4}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circ * (mode === "scan" ? progress : 1)} ${circ}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </Svg>
        {mode === "scan" && (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin }] }]}>
            <Svg width={size} height={size}>
              {Array.from({ length: 60 }, (_, i) => {
                const a = (i / 60) * Math.PI * 2;
                const r1 = r - 14;
                const r2 = r - (i % 5 === 0 ? 24 : 19);
                return (
                  <Path
                    key={i}
                    d={`M${size / 2 + r1 * Math.cos(a)} ${size / 2 + r1 * Math.sin(a)} L${size / 2 + r2 * Math.cos(a)} ${size / 2 + r2 * Math.sin(a)}`}
                    stroke={ringColor}
                    strokeOpacity={0.15 + 0.85 * (i / 60)}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                );
              })}
            </Svg>
          </Animated.View>
        )}
        <View
          style={{
            width: size - 64,
            height: size - 64,
            borderRadius: size,
            overflow: "hidden",
            backgroundColor: dark ? "#0B2A3A" : C.sunken,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {children != null ? (
            <View style={StyleSheet.absoluteFill}>{children}</View>
          ) : photo ? (
            <Image source={uri ? { uri } : IMG[src]} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ScanFace size={size * 0.3} color={dark ? "rgba(255,255,255,0.5)" : C.ink4} strokeWidth={1.2} />
          )}
          {mode === "scan" && (photo || children != null) && <ScanBeam size={size - 64} />}
          {mode === "success" && <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(8,182,252,0.18)" }]} />}
        </View>
        {mode === "success" && (
          <View style={[{ position: "absolute", bottom: 4 }, SH.sky]}>
            <VerifiedTick size={52} />
          </View>
        )}
      </View>
    </View>
  );
}

function ScanBeam({ size }: { size: number }) {
  const v = usePulse(2400);
  const y = v.interpolate({ inputRange: [0, 1], outputRange: [size * 0.12, size * 0.82] });
  return (
    <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, transform: [{ translateY: y }] }}>
      <LinearGradient colors={["rgba(8,182,252,0)", "rgba(8,182,252,0.45)", "rgba(8,182,252,0)"]} style={{ height: 46 }} />
      <View style={{ position: "absolute", top: 22, left: 0, right: 0, height: 2, backgroundColor: C.sky, opacity: 0.9 }} />
    </Animated.View>
  );
}

/* ───────────────────────── tab bar ───────────────────────── */

export type TabKey = "home" | "trips" | "wallet" | "profile";

const TABS: { key: TabKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: "home", label: "Home", icon: House, href: "/(tabs)" },
  { key: "trips", label: "Check-ins", icon: CalendarCheck, href: "/(tabs)/history" },
  { key: "wallet", label: "Wallet", icon: Wallet, href: "/(tabs)/documents" },
  { key: "profile", label: "Family", icon: Users, href: "/family" },
];

/** Scroll padding under the floating tab bar: bar (68) + gap (10) + the
 *  Android 3-button nav inset (~48) + air. */
export const TAB_BAR_SPACE = 130;

export function TabBar({ active }: { active: TabKey }) {
  const insets = useSafeAreaInsets();
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);
  const item = (t: (typeof TABS)[number]) => {
    const on = t.key === active;
    return (
      <Pressable key={t.key} onPress={() => router.navigate(t.href as never)} style={{ flex: 1, alignItems: "center", gap: 4 }} accessibilityRole="tab" accessibilityState={{ selected: on }}>
        <t.icon size={22} color={on ? C.ink : C.ink4} strokeWidth={on ? 2.4 : 2} />
        <Text style={{ fontFamily: on ? F.bold : F.medium, fontSize: 11, color: on ? C.ink : C.ink4 }}>{t.label}</Text>
      </Pressable>
    );
  };
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: 16 }}>
      <View
        style={[
          {
            height: 68,
            borderRadius: 34,
            backgroundColor: "rgba(255,255,255,0.96)",
            borderWidth: 1,
            borderColor: C.lineSoft,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 6,
          },
          SH.lg,
        ]}
      >
        {left.map(item)}
        <View style={{ width: 76, alignItems: "center" }}>
          <Press onPress={() => router.push("/face-update/camera" as never)} label="Scan face" style={[{ borderRadius: 30, marginTop: -30 }, SH.sky]}>
            <View style={{ width: 60, height: 60, borderRadius: 30, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: C.canvas }}>
              <LinearGradient colors={G.sky} style={StyleSheet.absoluteFill} />
              <View>
                <ScanFace size={26} color={C.white} strokeWidth={2.2} />
              </View>
            </View>
          </Press>
        </View>
        {right.map(item)}
      </View>
    </View>
  );
}

/* ───────────────────────── keypad ───────────────────────── */

export function Keypad({ dark, onKey, disabled }: { dark?: boolean; onKey?: (k: string) => void; disabled?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  const fg = dark ? C.white : C.ink;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8 }}>
      {keys.map((k, i) => (
        <View key={i} style={{ width: "33.33%", alignItems: "center" }}>
          {k === "" ? (
            <View style={{ height: 64 }} />
          ) : (
            <Press
              scaleTo={0.9}
              disabled={disabled}
              onPress={onKey ? () => onKey(k) : undefined}
              label={k === "del" ? "Delete" : k}
              role="button"
              style={{ width: 76, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
            >
              {k === "del" ? (
                <Delete size={24} color={fg} strokeWidth={1.8} />
              ) : (
                <Text style={{ fontFamily: F.semibold, fontSize: 28, color: fg }}>{k}</Text>
              )}
            </Press>
          )}
        </View>
      ))}
    </View>
  );
}

/* ───────────────────────── misc ───────────────────────── */

/** Deterministic pseudo-QR — the digital key / pass code. */
const QR_N = 25;
const QR_CELLS: [number, number][] = (() => {
  const out: [number, number][] = [];
  let seed = 7;
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= QR_N - 7 && y < 7) || (x < 7 && y >= QR_N - 7);
  for (let y = 0; y < QR_N; y++)
    for (let x = 0; x < QR_N; x++) {
      seed = (seed * 9301 + 49297) % 233280;
      if (!finder(x, y) && seed / 233280 > 0.52) out.push([x, y]);
    }
  return out;
})();

function qrFinder(x: number, y: number, cell: number, color: string, key: string) {
  return [
    <Rect key={key + "o"} x={x * cell} y={y * cell} width={cell * 7} height={cell * 7} rx={cell * 1.8} fill={color} />,
    <Rect key={key + "m"} x={(x + 1) * cell} y={(y + 1) * cell} width={cell * 5} height={cell * 5} rx={cell * 1.3} fill={C.white} />,
    <Rect key={key + "i"} x={(x + 2) * cell} y={(y + 2) * cell} width={cell * 3} height={cell * 3} rx={cell * 0.9} fill={color} />,
  ];
}

export function PassCode({ size = 168, color = C.ink }: { size?: number; color?: string }) {
  const cell = size / QR_N;
  return (
    <Svg width={size} height={size}>
      {QR_CELLS.map(([x, y]) => (
        <Rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} rx={cell * 0.3} fill={color} />
      ))}
      {qrFinder(0, 0, cell, color, "a")}
      {qrFinder(QR_N - 7, 0, cell, color, "b")}
      {qrFinder(0, QR_N - 7, cell, color, "c")}
    </Svg>
  );
}

/** Icon medallion for result screens (success / warning / error). */
export function Medallion({ icon: Icon, tone = "sky", size = 96 }: { icon: LucideIcon; tone?: "sky" | "green" | "amber" | "red"; size?: number }) {
  const c = { sky: C.sky, green: C.green, amber: C.amber, red: C.red }[tone];
  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: "center", justifyContent: "center" }}>
      <Glow color={c} size={size * 2.4} opacity={0.3} style={{ left: -size * 0.2, top: -size * 0.2 }} />
      <View style={{ position: "absolute", width: size * 1.55, height: size * 1.55, borderRadius: size, backgroundColor: c, opacity: 0.1 }} />
      <View style={{ position: "absolute", width: size * 1.25, height: size * 1.25, borderRadius: size, backgroundColor: c, opacity: 0.16 }} />
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, alignItems: "center", justifyContent: "center" }, { boxShadow: `0px 14px 30px ${c}66` }]}>
        <Icon size={size * 0.46} color={C.white} strokeWidth={2.6} />
      </View>
    </View>
  );
}


