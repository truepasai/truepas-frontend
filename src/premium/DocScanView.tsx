/** @jsxImportSource react */
/**
 * Dark document viewfinder — card-shaped (or round) frame,
 * corner brackets, moving scan line.
 *
 * Showcase mode (no `camera`): blurred backdrop + ghost document; the shutter
 * pushes `next`. (family/add/photo-capture still uses it this way.)
 *
 * Live mode: `camera` fills the viewfinder box — the area between the header
 * and the footer — and the frame is centred in that SAME box, with everything
 * outside the frame dimmed. document/scan.tsx crops the captured photo to the
 * frame assuming exactly this geometry (frame centred in the camera view,
 * `onCameraLayout` = camera view size), so keep the two in sync.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Images, Zap } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { IMG } from './images';
import { ComingSoon } from './kit';
import { useLightStatusBar } from './statusBar';
import { C, F } from './theme';
import { back, Footer, go, IconCircle, Press, Row, Steps, TopBar, Txt } from './ui';

export interface ScanFrameSize {
  width: number;
  height: number;
  /** Round frame (width === height). */
  round?: boolean;
}

export type ScanPillTone = 'sky' | 'green' | 'red' | 'muted';

const CARD_FRAME: ScanFrameSize = { width: 330, height: 214 };
const BG = '#050B10';
const DIM = 'rgba(5,11,16,0.68)';

/** Status pill used under the frame (exported for custom centre content). */
export function ScanPill({ label, tone = 'sky' }: { label: string; tone?: ScanPillTone }) {
  const map: Record<ScanPillTone, [string, string]> = {
    sky: ['rgba(8,182,252,0.16)', C.sky],
    green: ['rgba(18,183,106,0.18)', '#4ADE9B'],
    red: ['rgba(240,68,56,0.18)', C.red],
    muted: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.5)'],
  };
  const [bg, dot] = map[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: bg, paddingHorizontal: 14, minHeight: 34, borderRadius: 17, maxWidth: 320 }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
      <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.white, flexShrink: 1 }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** Rounded-rect (or circle) hole centred in a bw×bh box, as an SVG path. */
function holePath(bw: number, bh: number, f: ScanFrameSize): string {
  const w = f.width;
  const h = f.height;
  const x = (bw - w) / 2;
  const y = (bh - h) / 2;
  const r = f.round ? Math.min(w, h) / 2 : 18;
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

function FrameWindow({
  frame,
  live,
  scanning,
  preview,
}: {
  frame: ScanFrameSize;
  live: boolean;
  scanning: boolean;
  preview?: ReactNode;
}) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    l.start();
    return () => l.stop();
  }, [v]);
  const W = frame.width;
  const H = frame.height;
  const radius = frame.round ? Math.min(W, H) / 2 : 18;
  const y = v.interpolate({ inputRange: [0, 1], outputRange: [8, H - 10] });
  const corner = (pos: object) => <View style={[{ position: 'absolute', width: 34, height: 34, borderColor: C.sky }, pos]} />;
  return (
    <View style={{ width: W + 16, height: H + 16, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: W, height: H, borderRadius: radius, overflow: 'hidden', backgroundColor: live ? 'transparent' : 'rgba(255,255,255,0.04)' }}>
        {preview ??
          (!live && !frame.round && (
            <>
              {/* ghost document */}
              <View style={{ position: 'absolute', left: W * 0.06, top: H * 0.12, width: W * 0.24, height: H * 0.45, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={{ position: 'absolute', left: W * 0.35, top: H * 0.16 + i * H * 0.1, width: W * (0.52 - i * 0.08), height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.08)' }}
                />
              ))}
              <View style={{ position: 'absolute', left: 20, right: 20, bottom: H * 0.1, height: 24, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            </>
          ))}
        {scanning && (
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: y }] }}>
            <View style={{ height: 2, backgroundColor: C.sky, boxShadow: '0px 0px 16px rgba(8,182,252,0.9)' }} />
          </Animated.View>
        )}
      </View>
      {frame.round ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', width: W + 12, height: H + 12, borderRadius: (W + 12) / 2, borderWidth: 3, borderColor: C.sky }}
        />
      ) : (
        <View pointerEvents="none" style={{ position: 'absolute', width: W + 16, height: H + 16 }}>
          {corner({ left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 20 })}
          {corner({ right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 20 })}
          {corner({ left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 20 })}
          {corner({ right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 20 })}
        </View>
      )}
    </View>
  );
}

export function DocScanView({
  topTitle,
  title,
  hint,
  step,
  total,
  next,
  onBack = back,
  camera,
  onCameraLayout,
  frame = CARD_FRAME,
  status = 'Hold steady — auto-capturing',
  statusTone = 'sky',
  scanning = true,
  preview,
  topRight,
  gallery = 'show',
  onCapture,
  capturing,
  captureLabel = 'Capture',
  children,
  footer,
}: {
  topTitle: string;
  title: string;
  hint?: string;
  step?: number;
  total?: number;
  /** Showcase: route the shutter pushes (ignored when `onCapture` is set). */
  next?: string;
  onBack?: () => void;
  /** Live camera preview — mounted full-bleed in the viewfinder box, behind the frame. */
  camera?: ReactNode;
  /** Size of the viewfinder box (= the camera view) for crop mapping. */
  onCameraLayout?: (width: number, height: number) => void;
  frame?: ScanFrameSize;
  /** Pill under the frame; `null` hides it. */
  status?: string | null;
  statusTone?: ScanPillTone;
  /** Animated scan line inside the frame. */
  scanning?: boolean;
  /** Content rendered inside the frame (e.g. a captured image). */
  preview?: ReactNode;
  /** TopBar right slot; `null` hides it (defaults to the showcase flash icon). */
  topRight?: ReactNode | null;
  /** Gallery button left of the shutter: shown, shown as "Coming soon", or hidden. */
  gallery?: 'show' | 'soon' | 'hide';
  onCapture?: () => void;
  capturing?: boolean;
  captureLabel?: string;
  /** Replaces the frame area entirely (permission prompts, review...). */
  children?: ReactNode;
  /** Replaces the shutter row; `null` renders no footer. */
  footer?: ReactNode | null;
}) {
  // Dark camera stage — light status bar icons while it's on screen.
  useLightStatusBar();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const live = camera != null;
  const shutter = onCapture ?? (next ? go(next) : undefined);
  const pillTop = box ? Math.min(box.h / 2 + frame.height / 2 + 26, box.h - 44) : 0;

  const galleryBtn =
    gallery === 'hide' ? (
      <View style={{ width: 50 }} />
    ) : gallery === 'soon' ? (
      <View style={{ width: 50 }} accessible accessibilityLabel="Upload from gallery" accessibilityHint="Coming soon" accessibilityState={{ disabled: true }}>
        <View pointerEvents="none" style={{ opacity: 0.45 }}>
          <IconCircle icon={Images} tone="glass" size={50} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', top: -14, left: 18 }}>
          <ComingSoon light label="Soon" />
        </View>
      </View>
    ) : (
      <IconCircle icon={Images} tone="glass" size={50} label="Upload from gallery" />
    );

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {!live && (
        <>
          {/* blurred "camera" backdrop */}
          <Image source={IMG.room} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} contentFit="cover" blurRadius={18} />
          <LinearGradient colors={['rgba(5,11,16,0.7)', 'rgba(5,11,16,0.2)', 'rgba(5,11,16,0.85)']} style={StyleSheet.absoluteFill} />
        </>
      )}
      {/* A Footer clears the bottom edge itself; without one, this does. */}
      <SafeAreaView edges={footer !== null ? ['top', 'left', 'right'] : undefined} style={{ flex: 1 }}>
        <TopBar
          tone="glass"
          title={topTitle}
          onBack={onBack}
          right={topRight === undefined ? <IconCircle icon={Zap} tone="glass" label="Flash" /> : topRight}
        />
        {step != null && total != null && (
          <View style={{ paddingHorizontal: 24, paddingTop: 6 }}>
            <Steps total={total} current={step - 1} light />
          </View>
        )}
        <View style={{ alignItems: 'center', paddingTop: 22, paddingBottom: 10, gap: 8, paddingHorizontal: 30 }}>
          <Text style={{ fontFamily: F.extrabold, fontSize: 26, letterSpacing: -0.7, color: C.white, textAlign: 'center' }}>{title}</Text>
          {!!hint && (
            <Txt v="body" color="rgba(255,255,255,0.65)" center>
              {hint}
            </Txt>
          )}
        </View>

        {/* Viewfinder box — the camera view; the frame is centred in it. */}
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setBox({ w: width, h: height });
            onCameraLayout?.(width, height);
          }}
        >
          {live && <View style={StyleSheet.absoluteFill}>{camera}</View>}
          {live && box != null && (
            <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path d={`M0 0H${box.w}V${box.h}H0Z${holePath(box.w, box.h, frame)}`} fill={DIM} fillRule="evenodd" />
            </Svg>
          )}
          {children != null ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>{children}</View>
          ) : (
            <>
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                <FrameWindow frame={frame} live={live} scanning={scanning} preview={preview} />
              </View>
              {status != null && box != null && (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: pillTop, alignItems: 'center', paddingHorizontal: 20 }}>
                  <ScanPill label={status} tone={statusTone} />
                </View>
              )}
            </>
          )}
        </View>

        {footer !== null && (
          <Footer>
            {footer ?? (
              <Row between style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
                {galleryBtn}
                <Press
                  onPress={shutter}
                  disabled={!!capturing || !shutter}
                  label={captureLabel}
                  role="button"
                  style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}
                >
                  {capturing ? (
                    <ActivityIndicator size="large" color={C.white} accessibilityLabel="Capturing" />
                  ) : (
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.white }} />
                  )}
                </Press>
                <View style={{ width: 50 }} />
              </Row>
            )}
          </Footer>
        )}
      </SafeAreaView>
    </View>
  );
}
