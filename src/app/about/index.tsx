/** @jsxImportSource react */
/**
 * About TruePas — brand header (real app version from expo-constants), what
 * TruePas offers, mission, contact and legal links. Contact options come
 * from GET /support/channels (null channels hidden; the default email shows
 * only while that call loads or fails).
 */
import { LinearGradient } from 'expo-linear-gradient';
import {
  Clock,
  FileText,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  ScanFace,
  Shield,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Glow, Guilloche, Wordmark } from '@/premium/blocks';
import { APP_VERSION, callSupport, emailSupport, openSupportChat, useSupportContact } from '@/premium/flows/account';
import { useHeroStatusBar } from '@/premium/statusBar';
import { C, F, G } from '@/premium/theme';
import { Card, Divider, go, Group, ListRow, Serif, Tile, TopBar, Txt } from '@/premium/ui';

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Shield,
    title: 'Encrypted Storage',
    desc: 'Your documents and face template are encrypted and kept in secure storage.',
  },
  {
    icon: ScanFace,
    title: 'Face Verification',
    desc: "A quick liveness check sets up your face, so venue kiosks can confirm it's really you.",
  },
  {
    icon: FileText,
    title: 'Document Vault',
    desc: "Store passports, driver's licenses, birth certificates, visas, and more — all in one secure, organized place.",
  },
  {
    icon: Users,
    title: 'Family Sharing',
    desc: 'Add family members and manage their identity documents from a single account. Perfect for parents and dependents.',
  },
  {
    icon: Zap,
    title: 'Instant Check-In',
    desc: 'Check in at partner hotels, cruises, theme parks and more with a look at the venue kiosk — skip the front desk queues.',
  },
  {
    icon: Lock,
    title: "You're in Control",
    desc: 'Sensitive changes need your PIN, and you can see and sign out every device signed in to your account.',
  },
];

export default function AboutScreen() {
  // Navy brand header: light status bar until it scrolls out from under it.
  const [headerH, setHeaderH] = useState(300);
  const heroStatusBar = useHeroStatusBar(headerH);
  const support = useSupportContact();
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} {...heroStatusBar}>
        {/* ---------- brand header ---------- */}
        <View style={{ paddingBottom: 40, overflow: 'hidden' }} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
          <LinearGradient colors={G.night} style={StyleSheet.absoluteFill} />
          <Glow size={420} opacity={0.4} style={{ top: -60, left: -20 }} />
          <Guilloche size={520} style={{ left: -60, top: -120 }} />
          <SafeAreaView edges={['top']}>
            <TopBar tone="glass" />
          </SafeAreaView>
          <View style={{ alignItems: 'center', gap: 14, paddingTop: 24, paddingHorizontal: 20 }}>
            <Wordmark light size={36} />
            <Text style={{ fontFamily: F.semibold, fontSize: 17, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
              Your identity, verified <Serif size={22} color={C.skyLight}>everywhere.</Serif>
            </Text>
            <Txt v="small" color="rgba(255,255,255,0.5)">
              Version {APP_VERSION}
            </Txt>
          </View>
        </View>

        <View style={{ padding: 20, gap: 24 }}>
          <Txt v="body" center>
            TruePas verifies your identity once, then lets you check in at partner venues with just your face. It
            keeps your documents and family in one place — no paper, no queues.
          </Txt>

          {/* ---------- features ---------- */}
          <View style={{ gap: 10 }}>
            <Txt v="micro" style={{ marginLeft: 4 }}>
              What TruePas offers
            </Txt>
            <Card pad={0} style={{ paddingHorizontal: 18 }}>
              {FEATURES.map((f, i) => (
                <View key={f.title}>
                  {i > 0 && <Divider inset={56} />}
                  <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 16 }}>
                    <Tile icon={f.icon} tone="sky" size={42} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Txt v="bodyStrong">{f.title}</Txt>
                      <Txt v="small" style={{ lineHeight: 19 }}>
                        {f.desc}
                      </Txt>
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          </View>

          {/* ---------- mission ---------- */}
          <View style={{ borderRadius: 26, overflow: 'hidden', padding: 22, gap: 10 }}>
            <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Guilloche size={360} style={{ right: -180, bottom: -200 }} />
            <ShieldCheck size={22} color={C.skyLight} />
            <Text style={{ fontFamily: F.bold, fontSize: 19, letterSpacing: -0.4, color: C.white }}>
              Our <Serif size={23} color={C.skyLight}>mission</Serif>
            </Text>
            <Txt v="body" color="rgba(255,255,255,0.78)">
              To eliminate identity fraud and make identity verification effortless for everyone, everywhere. We
              believe your identity should be yours to own, control, and share — securely and instantly.
            </Txt>
          </View>

          {/* ---------- contact ---------- */}
          {(!!support.email || !!support.phone || !!support.chatUrl || !!support.hours) && (
            <Group title="Get in touch">
              {!!support.email && (
                <ListRow
                  icon={Mail}
                  tone="sky"
                  title="Email support"
                  sub={support.email}
                  onPress={() => emailSupport(support.email ?? undefined)}
                />
              )}
              {!!support.phone && (
                <ListRow icon={Phone} tone="sky" title="Call support" sub={support.phone} onPress={() => callSupport(support.phone as string)} />
              )}
              {!!support.chatUrl && (
                <ListRow icon={MessageCircle} tone="sky" title="Chat with us" onPress={() => openSupportChat(support.chatUrl as string)} />
              )}
              {!!support.hours && <ListRow icon={Clock} tone="sky" title="Support hours" sub={support.hours} chevron={false} />}
            </Group>
          )}

          {/* ---------- legal ---------- */}
          <Group title="Legal">
            <ListRow icon={FileText} title="Terms of Service" onPress={go('/legal/terms')} />
            <ListRow icon={Lock} title="Privacy Policy" onPress={go('/legal/privacy-policy')} />
            <ListRow icon={ScanFace} title="Data & privacy" onPress={go('/legal/data-privacy')} />
          </Group>

          <View style={{ alignItems: 'center', gap: 4 }}>
            <Txt v="small" color={C.ink4} center>
              © {new Date().getFullYear()} TruePas. All rights reserved.
            </Txt>
            <Txt v="small" color={C.ink4} center>
              Made with care for your privacy.
            </Txt>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
