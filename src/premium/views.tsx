/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — whole-screen templates shared by several routes:
 * the dark biometric scanner, the guided processing screen, result
 * screens, PIN entry and long-form legal pages.
 */
import { LinearGradient } from "expo-linear-gradient";
import { Check, Lightbulb, Loader, type LucideIcon, ShieldCheck, X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FaceRing, Keypad, Medallion } from "./blocks";
import type { ImgKey } from "./images";
import { C, DESCENDERS, F, G, R } from "./theme";
import { Card, CodeCells, Footer, Heading, Row, Steps, TopBar, Txt } from "./ui";

/* ───────────────────────── dark biometric scanner ───────────────────────── */

export function FaceScanView({
  title = "Verify your",
  accent = "face",
  instruction,
  step = 1,
  total = 3,
  checks = [
    { label: "Blink", done: true },
    { label: "Turn left", done: false, active: true },
    { label: "Turn right", done: false },
  ],
  src = "user",
  progress = 0.62,
  topTitle = "Face verification",
  footer,
}: {
  title?: string;
  accent?: string;
  instruction: string;
  step?: number;
  total?: number;
  checks?: { label: string; done: boolean; active?: boolean }[];
  src?: ImgKey;
  progress?: number;
  topTitle?: string;
  footer?: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.navyNight }}>
      <LinearGradient colors={G.night} style={StyleSheet.absoluteFill} />
      {/* The Footer clears the bottom edge itself. */}
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <TopBar tone="glass" title={topTitle} right={<Txt v="smallStrong" color="rgba(255,255,255,0.6)">{step}/{total}</Txt>} />
        <View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
          <Steps total={total} current={step - 1} light />
        </View>
        <View style={{ alignItems: "center", paddingTop: 26, gap: 6 }}>
          <Text style={{ fontFamily: F.extrabold, fontSize: 30, letterSpacing: -0.9, color: C.white, textAlign: "center" }}>
            {title} <Text style={{ fontFamily: F.serifItalic, fontSize: 36, color: C.skyLight }}>{accent}</Text>
          </Text>
          <Txt v="body" color="rgba(255,255,255,0.65)" center style={{ maxWidth: 290 }}>
            {instruction}
          </Txt>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <FaceRing dark size={262} progress={progress} src={src} />
        </View>
        <Row gap={8} style={{ justifyContent: "center", paddingBottom: 18 }}>
          {checks.map((c) => (
            <View
              key={c.label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                height: 36,
                paddingHorizontal: 14,
                borderRadius: R.full,
                backgroundColor: c.done ? "rgba(18,183,106,0.16)" : c.active ? "rgba(8,182,252,0.18)" : "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor: c.done ? "rgba(18,183,106,0.4)" : c.active ? "rgba(8,182,252,0.6)" : "rgba(255,255,255,0.1)",
              }}
            >
              {c.done ? (
                <Check size={14} color="#4ADE9B" strokeWidth={3} />
              ) : (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.active ? C.sky : "rgba(255,255,255,0.3)" }} />
              )}
              <Text style={{ fontFamily: F.semibold, fontSize: 13, color: c.done ? "#4ADE9B" : c.active ? C.white : "rgba(255,255,255,0.5)" }}>{c.label}</Text>
            </View>
          ))}
        </Row>
        <Footer>
          {footer ?? (
            <Row gap={8} style={{ justifyContent: "center", paddingBottom: 6 }}>
              <ShieldCheck size={15} color="rgba(255,255,255,0.5)" />
              <Txt v="small" color="rgba(255,255,255,0.5)">
                Encrypted and stored securely
              </Txt>
            </Row>
          )}
        </Footer>
      </SafeAreaView>
    </View>
  );
}

/* ───────────────────────── processing ───────────────────────── */

function Spin({ children }: { children: ReactNode }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [v]);
  return <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>{children}</Animated.View>;
}

export type StepState = "done" | "active" | "todo";

export function ProcessingView({
  title,
  accent,
  sub,
  hero,
  steps,
  topTitle,
}: {
  title: string;
  accent: string;
  sub: string;
  hero: ReactNode;
  steps: { label: string; detail?: string; state: StepState }[];
  topTitle?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView style={{ flex: 1 }}>
        <TopBar title={topTitle} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 28 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", paddingTop: 10 }}>{hero}</View>
          <Heading title={title} accent={accent} sub={sub} center />
          <Card pad={6} style={{ paddingHorizontal: 18 }}>
            {steps.map((s, i) => (
              <View key={s.label} style={{ flexDirection: "row", gap: 14, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.lineSoft, alignItems: "center" }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: s.state === "done" ? C.sky : s.state === "active" ? C.skyWash : C.sunken,
                  }}
                >
                  {s.state === "done" ? (
                    <Check size={16} color={C.white} strokeWidth={3} />
                  ) : s.state === "active" ? (
                    <Spin>
                      <Loader size={16} color={C.skyPressed} strokeWidth={2.6} />
                    </Spin>
                  ) : (
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.ink4 }} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt v="bodyStrong" color={s.state === "todo" ? C.ink3 : C.ink}>
                    {s.label}
                  </Txt>
                  {s.detail != null && <Txt v="small">{s.detail}</Txt>}
                </View>
                {s.state === "done" && <Txt v="small" color={C.green}>Done</Txt>}
              </View>
            ))}
          </Card>
          <Row gap={8} style={{ justifyContent: "center" }}>
            <ShieldCheck size={15} color={C.ink3} />
            <Txt v="small">Your data is encrypted in transit and at rest</Txt>
          </Row>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ───────────────────────── result ───────────────────────── */

export function ResultView({
  icon,
  tone = "sky",
  over,
  title,
  accent,
  sub,
  children,
  primary,
  secondary,
  close,
}: {
  icon: LucideIcon;
  tone?: "sky" | "green" | "amber" | "red";
  over?: string;
  title: string;
  accent?: string;
  sub?: string;
  children?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  close?: boolean;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      {/* The Footer clears the bottom edge itself. */}
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        {close ? <TopBar hideBack right={<View />} /> : <TopBar />}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 26, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Medallion icon={icon} tone={tone} size={88} />
          </View>
          <Heading over={over} title={title} accent={accent} sub={sub} center />
          {children}
        </ScrollView>
        <Footer>
          {primary}
          {secondary}
        </Footer>
      </SafeAreaView>
    </View>
  );
}

/* ───────────────────────── PIN ───────────────────────── */

export function PinView({
  topTitle,
  title,
  accent,
  sub,
  value,
  step,
  total,
  error,
}: {
  topTitle?: string;
  title: string;
  accent: string;
  sub: string;
  value: string;
  step?: number;
  total?: number;
  error?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView style={{ flex: 1 }}>
        <TopBar title={topTitle} />
        <View style={{ flex: 1, paddingHorizontal: 24, gap: 30 }}>
          {step != null && total != null && <Steps total={total} current={step - 1} />}
          <Heading title={title} accent={accent} sub={sub} center />
          <View style={{ gap: 14 }}>
            <CodeCells value={value} length={4} dots />
            {error != null && (
              <Row gap={6} style={{ justifyContent: "center" }}>
                <X size={14} color={C.redInk} />
                <Txt v="small" color={C.redInk}>
                  {error}
                </Txt>
              </Row>
            )}
          </View>
          <View style={{ flex: 1 }} />
          <Keypad />
          <View style={{ height: 8 }} />
        </View>
      </SafeAreaView>
    </View>
  );
}

/* ───────────────────────── legal ───────────────────────── */

export function LegalView({
  topTitle,
  title,
  accent,
  updated,
  intro,
  sections,
  footer,
  summary,
}: {
  topTitle: string;
  title: string;
  accent: string;
  updated: string;
  intro: string;
  sections: { h: string; p: string }[];
  footer?: ReactNode;
  /** Optional plain-language summary callout — only pass text the legal copy supports. */
  summary?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.surface }}>
      <SafeAreaView style={{ flex: 1 }}>
        <TopBar title={topTitle} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48, gap: 26 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Txt v="micro" color={C.sky}>
              Updated {updated}
            </Txt>
            <Text style={{ fontFamily: F.extrabold, fontSize: 34, letterSpacing: -1.1, lineHeight: 40, color: C.ink, ...DESCENDERS }}>
              {title} <Text style={{ fontFamily: F.serifItalic, fontSize: 40, color: C.sky }}>{accent}</Text>
            </Text>
            <Txt v="body" style={{ fontSize: 16, lineHeight: 25 }}>
              {intro}
            </Txt>
          </View>
          {!!summary && (
            <View style={{ backgroundColor: C.skyMist, borderRadius: R.lg, padding: 16, flexDirection: "row", gap: 12, borderWidth: 1, borderColor: C.skyWash }}>
              <Lightbulb size={18} color={C.skyPressed} />
              <Txt v="small" color={C.navy} style={{ flex: 1, lineHeight: 19 }}>
                {summary}
              </Txt>
            </View>
          )}
          {sections.map((s, i) => (
            <View key={s.h} style={{ gap: 10 }}>
              <Row gap={10}>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.sky }}>{String(i + 1).padStart(2, "0")}</Text>
                <Txt v="h3">{s.h}</Txt>
              </Row>
              <Txt v="body" style={{ lineHeight: 24 }}>
                {s.p}
              </Txt>
            </View>
          ))}
          {footer}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
