/** @jsxImportSource react */
/**
 * TRUEPAS PREMIUM — the real bottom tab bar. Same look as blocks.TabBar
 * (floating pill + raised face button) but wired to the navigator:
 * tabPress events + haptics like the original CustomTabBar. The centre face
 * button opens "Your identity", whose pass shows your face: at venues the
 * face is the pass (there is no in-app check-in API to trigger instead).
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarCheck, House, type LucideIcon, ScanFace, Users, Wallet } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openOnce } from '@/premium/openOnce';
import { C, F, G, SH } from '@/premium/theme';
import { Press } from '@/premium/ui';
import { tapHaptic } from '@/services/haptics';

type Item =
  | { kind: 'tab'; route: string; label: string; icon: LucideIcon }
  | { kind: 'link'; href: string; label: string; icon: LucideIcon };

const LEFT: Item[] = [
  { kind: 'tab', route: 'index', label: 'Home', icon: House },
  { kind: 'tab', route: 'history', label: 'Check-ins', icon: CalendarCheck },
];
const RIGHT: Item[] = [
  { kind: 'tab', route: 'documents', label: 'Wallet', icon: Wallet },
  { kind: 'link', href: '/family', label: 'Family', icon: Users },
];

type Route = BottomTabBarProps['state']['routes'][number];

export function PremiumTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index]?.name;

  const press = (it: Item) => {
    tapHaptic();
    if (it.kind === 'link') {
      openOnce(it.href);
      return;
    }
    const route = state.routes.find((r: Route) => r.name === it.route);
    if (!route) return;
    const isFocused = activeRoute === it.route;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name as never);
  };

  const item = (it: Item) => {
    const on = it.kind === 'tab' && it.route === activeRoute;
    return (
      <Pressable
        key={it.label}
        onPress={() => press(it)}
        style={{ flex: 1, alignItems: 'center', gap: 4 }}
        accessibilityRole="tab"
        accessibilityLabel={it.label}
        accessibilityState={{ selected: on }}
      >
        <it.icon size={22} color={on ? C.ink : C.ink4} strokeWidth={on ? 2.4 : 2} />
        <Text style={{ fontFamily: on ? F.bold : F.medium, fontSize: 11, color: on ? C.ink : C.ink4 }}>{it.label}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 10, paddingHorizontal: 16 }}
      >
        {/* Canvas behind the floating bar, down through the system nav area,
            so scrolled content doesn't show in the gap under the pill. Fades
            in above the bar so the page still reads as running underneath. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(246,248,250,0)', C.canvas, C.canvas]}
          locations={[0, 0.4, 1]}
          style={[StyleSheet.absoluteFill, { top: -28 }]}
        />
        <View
          style={[
            {
              height: 68,
              borderRadius: 34,
              backgroundColor: 'rgba(255,255,255,0.96)',
              borderWidth: 1,
              borderColor: C.lineSoft,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 6,
            },
            SH.lg,
          ]}
        >
          {LEFT.map(item)}
          <View style={{ width: 76, alignItems: 'center' }}>
            <Press
              onPress={() => {
                tapHaptic();
                openOnce('/identity');
              }}
              label="Your identity"
              role="button"
              style={[{ borderRadius: 30, marginTop: -30 }, SH.sky]}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 4,
                  borderColor: C.canvas,
                }}
              >
                <LinearGradient colors={G.sky} style={StyleSheet.absoluteFill} />
                <View>
                  <ScanFace size={26} color={C.white} strokeWidth={2.2} />
                </View>
              </View>
            </Press>
          </View>
          {RIGHT.map(item)}
        </View>
      </View>
    </>
  );
}
