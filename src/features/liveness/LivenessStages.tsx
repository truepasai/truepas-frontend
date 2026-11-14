/**
 * LivenessStages — presentational stages for the liveness pipeline, ported
 * 1:1 from UI-design-repo `verify/LivenessScreen.tsx` (challenge/finishing)
 * and `verify/VerifyResultScreen.tsx` (passed/failed).
 *
 * No camera imports — the live preview arrives as a ReactNode (`camera` /
 * `cameraSlot`) so every stage renders on web/Expo Go too (dev screen
 * browser previews pass a placeholder instead of <Camera/>).
 */
import { useRouter } from 'expo-router';
import { Check, CircleCheck, CircleX, RotateCcw, ScanFace, SwitchCamera } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
    Alert as RNAlert,
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/composite';
import {
    Blink,
    CoreButton,
    FadeUp,
    IconButton,
    NeuBox,
    NeuWell,
    PopIn,
    Pulse,
    ScanFrame,
    Spinner,
    Typography,
} from '@/components/ui';
import { alpha, useThemeTokens } from '@/theme';
import { iconSize } from '@/theme/tokens';
import type { LivenessFailure } from '@/features/liveness/regulaLiveness';
import type { LivenessChallenge } from '@/types/domain';

/* Scan target is a square region sized like the design repo's liveness
   ring (RING 240, clamped to the window). The live camera preview fills it. */
function useRing() {
  const { height: winH } = useWindowDimensions();
  return { winH, ring: Math.round(Math.min(240, Math.max(168, winH * 0.32))) };
}

/** Camera parked outside the viewport — photo output stays alive while the
 *  finishing/result screens show (capturePhotoToFile needs a live camera). */
function OffscreenCamera({ camera }: { camera?: ReactNode }) {
  if (!camera) return null;
  return <View style={{ position: 'absolute', top: -2000, left: -2000, width: 400, height: 533 }}>{camera}</View>;
}

/* ------------------------------------------------------------- challenge */

export interface ChallengeStageProps {
  instruction: string;
  steps: LivenessChallenge[];
  stepIndex: number;
  labels: Record<string, string>;
  /** 0→1 progress within the current step (drives the track fill sweep). */
  stepProgress: Animated.Value;
  expiresIn?: number | null;
  sessionExpiring?: boolean;
  multiFace?: boolean;
  hint?: string | null;
  /** Live camera preview (or a dev placeholder) — rendered inside the
   *  ScanFrame square so the user sees their own face in the brackets. */
  camera?: ReactNode;
  allowBackCamera?: boolean;
  cameraPosition?: 'front' | 'back';
  onSwitchCamera?: () => void;
  onRestart: () => void;
}

export function ChallengeStage({
  instruction,
  steps,
  stepIndex,
  labels,
  stepProgress,
  expiresIn,
  sessionExpiring,
  multiFace,
  hint,
  camera,
  allowBackCamera,
  cameraPosition,
  onSwitchCamera,
  onRestart,
}: ChallengeStageProps) {
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { winH, ring } = useRing();

  const total = steps.length;
  const span = Math.max(total, 1);
  const fillWidth = stepProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      `${(Math.min(stepIndex, span) / span) * 100}%`,
      `${(Math.min(stepIndex + 1, span) / span) * 100}%`,
    ],
  });

  // Cancel discards the in-flight session — confirm before leaving (design).
  const confirmCancel = () =>
    RNAlert.alert('Discard session?', 'The current verification session will be discarded.', [
      { text: 'Keep scanning', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);

  const stage = (
    <>
      {/* Instruction pill — solid actionPrimary, blinking rec dot (design). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing[2],
          paddingHorizontal: theme.spacing[4],
          paddingVertical: theme.spacing[2],
          borderRadius: theme.radii.full,
          backgroundColor: theme.colors.actionPrimary,
          maxWidth: '100%',
        }}>
        <Blink ms={650}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: theme.radii.full,
              backgroundColor: theme.colors.onActionPrimary,
            }}
          />
        </Blink>
        <Text
          style={{
            color: theme.colors.onActionPrimary,
            fontFamily: theme.fontFamily.sans.semibold,
            fontSize: theme.fontSize.base,
            flexShrink: 1,
          }}>
          {instruction}
        </Text>
      </View>

      {/* ScanFrame square — the live camera preview fills the framed region
          so the user sees their own face inside the brackets. */}
      <ScanFrame size={ring + 24}>
        <View
          style={{
            width: ring,
            height: ring,
            borderRadius: theme.radii['2xl'],
            overflow: 'hidden',
            backgroundColor: theme.colors.surfaceSunken,
          }}>
          {camera}
        </View>
      </ScanFrame>

      {total > 0 ? (
        <Text
          style={{
            fontFamily: theme.fontFamily.mono.regular,
            fontSize: theme.fontSize.sm,
            color: theme.colors.textSecondary,
            letterSpacing: theme.letterSpacing.wide,
          }}>
          Step {Math.min(stepIndex + 1, total)} of {total}
        </Text>
      ) : null}

      <NeuWell radius={theme.radii.full} depth={3} style={{ width: '100%', height: 8 }}>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            borderRadius: theme.radii.full,
            backgroundColor: theme.colors.actionPrimary,
            width: fillWidth,
          }}
        />
      </NeuWell>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing[2] }}>
        {steps.map((c, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <View key={`${c}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 32 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: theme.radii.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done
                    ? theme.colors.successSubtle
                    : active
                      ? theme.colors.actionPrimary
                      : theme.colors.surfaceSunken,
                }}>
                {done ? (
                  <Check size={12} color={theme.colors.onSuccessSubtle} />
                ) : (
                  <Text
                    style={{
                      fontFamily: theme.fontFamily.mono.medium,
                      fontSize: theme.fontSize.xs,
                      color: active ? theme.colors.onActionPrimary : theme.colors.textMuted,
                    }}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  flex: 1,
                  fontSize: theme.fontSize.base,
                  color: done ? theme.colors.textSecondary : active ? theme.colors.textPrimary : theme.colors.textMuted,
                  fontWeight: active ? theme.fontWeight.semibold : theme.fontWeight.regular,
                }}>
                {labels[c] ?? c.replace(/_/g, ' ')}
              </Text>
              {active ? (
                <Text
                  style={{
                    fontFamily: theme.fontFamily.mono.regular,
                    fontSize: theme.fontSize.xs,
                    color: theme.colors.actionPrimary,
                    textTransform: 'uppercase',
                    letterSpacing: theme.letterSpacing.caps,
                  }}>
                  now
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {multiFace ? (
        <Typography variant="caption" center style={{ color: theme.colors.error }}>
          Only one person in the frame
        </Typography>
      ) : hint ? (
        <Typography variant="caption" color="muted" center>
          {hint}
        </Typography>
      ) : expiresIn != null ? (
        <Typography
          variant="caption"
          center
          style={{
            fontFamily: theme.fontFamily.mono.regular,
            color: sessionExpiring ? theme.colors.error : theme.colors.textMuted,
          }}>
          Session expires in {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, '0')}
        </Typography>
      ) : null}
    </>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title="Face verification"
        onBack={confirmCancel}
        actions={
          allowBackCamera ? (
            <IconButton
              accessibilityLabel={cameraPosition === 'front' ? 'Switch to back camera' : 'Switch to front camera'}
              icon={<SwitchCamera size={iconSize.md} color={theme.colors.textPrimary} />}
              onPress={onSwitchCamera}
            />
          ) : undefined
        }
      />
      {winH < 700 ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing[4],
            paddingHorizontal: theme.spacing[4],
            paddingVertical: theme.spacing[4],
          }}>
          {stage}
        </ScrollView>
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing[4],
            paddingHorizontal: theme.spacing[4],
            paddingVertical: theme.spacing[4],
          }}>
          {stage}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing[3],
          padding: theme.spacing[4],
          paddingTop: theme.spacing[3],
          paddingBottom: theme.spacing[4] + insets.bottom,
        }}>
        <CoreButton
          style={{ flex: 1 }}
          accessibilityLabel="Restart scan"
          iconLeft={<RotateCcw size={iconSize.sm} color={theme.colors.onActionPrimary} />}
          onPress={onRestart}>
          Restart scan
        </CoreButton>
        <CoreButton style={{ flex: 1 }} variant="ghost" accessibilityLabel="Cancel" onPress={confirmCancel}>
          Cancel
        </CoreButton>
      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------- finishing */

export function FinishingStage({ cameraSlot }: { cameraSlot?: ReactNode }) {
  const theme = useThemeTokens();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScreenHeader title="Face verification" />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing[3],
          paddingHorizontal: theme.spacing[4],
        }}>
        <Pulse to={1.07} ms={850}>
          <NeuWell radius={theme.radii.full} style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            <ScanFace size={iconSize.xl} color={theme.colors.actionPrimary} />
          </NeuWell>
        </Pulse>
        <Typography variant="h3" center>
          Verifying…
        </Typography>
        <Typography variant="body-sm" color="secondary" center>
          Running anti-spoof checks. Don&apos;t close the app.
        </Typography>
        <Spinner size="lg" label="Verifying" />
      </View>
      <OffscreenCamera camera={cameraSlot} />
    </SafeAreaView>
  );
}

/* -------------------------------------------------------- verify result */

export type LivenessOutcome = 'passed' | 'failed';

export interface LivenessResultStageProps {
  outcome: LivenessOutcome;
  /** Family member enrollment — swaps the copy to the "they" variant. */
  personId?: string;
  /** Anti-spoof score 0–1 — dev-only chip (design hides it in prod). */
  score?: number | null;
  /** Real failure detail (toApiError message) under the design copy. */
  error?: string | null;
  /** How a failed check ended: picks the heading (cancelled, timed out, …). */
  failure?: LivenessFailure | null;
  primaryLabel: string;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  onBack: () => void;
  cameraSlot?: ReactNode;
}

export function LivenessResultStage({
  outcome,
  personId,
  score,
  error,
  primaryLabel,
  primaryLoading,
  primaryDisabled,
  onPrimary,
  onBack,
  cameraSlot,
}: LivenessResultStageProps) {
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();

  const conf =
    outcome === 'passed'
      ? {
          icon: CircleCheck,
          bg: theme.colors.successSubtle,
          fg: theme.colors.onSuccessSubtle,
          // Nothing is saved yet — the primary button runs the enrollment.
          title: 'Almost done',
          body: personId
            ? `Tap ${primaryLabel} to save their face. It isn't set up until you do.`
            : `Tap ${primaryLabel} to save your face and finish.`,
        }
      : {
          icon: CircleX,
          bg: theme.colors.errorSubtle,
          fg: theme.colors.onErrorSubtle,
          title: "We couldn't verify liveness",
          body: 'Move to a brighter spot and keep the face inside the ring for the whole step.',
        };
  const IconCmp = conf.icon;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing[2],
          paddingHorizontal: theme.spacing[4],
        }}>
        <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing[2] }}>
          {outcome === 'passed' && (
            <Pulse to={1.09} ms={1600} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <View
                style={{
                  position: 'absolute',
                  width: 156,
                  height: 156,
                  borderRadius: theme.radii.full,
                  backgroundColor: alpha(theme.colors.successSubtle, 0.45),
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  width: 120,
                  height: 120,
                  borderRadius: theme.radii.full,
                  backgroundColor: theme.colors.successSubtle,
                }}
              />
            </Pulse>
          )}
          <PopIn>
            <NeuBox
              variant="raised"
              radius={theme.radii.full}
              depth={8}
              color={conf.bg}
              style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
              <IconCmp size={40} color={conf.fg} />
            </NeuBox>
          </PopIn>
        </View>
        <FadeUp delay={140}>
          <Typography variant="h2" center>
            {conf.title}
          </Typography>
        </FadeUp>
        <FadeUp delay={220}>
          <Typography variant="body" color="secondary" center>
            {conf.body}
          </Typography>
        </FadeUp>
        {error ? (
          <Typography variant="caption" color="muted" center>
            {error}
          </Typography>
        ) : null}
        {__DEV__ && score != null && (
          <NeuBox
            variant="inset"
            radius={theme.radii.full}
            depth={3}
            style={{ paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[2] }}>
            <Typography variant="caption" color="secondary" style={{ fontFamily: theme.fontFamily.mono.regular }}>
              Anti-spoof score · {score.toFixed(2)}
            </Typography>
          </NeuBox>
        )}
      </View>
      <View
        style={{
          padding: theme.spacing[4],
          paddingTop: theme.spacing[3],
          paddingBottom: theme.spacing[4] + insets.bottom,
          gap: theme.spacing[2],
        }}>
        <CoreButton
          fullWidth
          size="lg"
          loading={primaryLoading}
          disabled={primaryDisabled}
          accessibilityLabel={primaryLabel}
          onPress={onPrimary}>
          {primaryLabel}
        </CoreButton>
        <CoreButton fullWidth variant="ghost" accessibilityLabel="Back to start" onPress={onBack}>
          Back to start
        </CoreButton>
      </View>
      <OffscreenCamera camera={cameraSlot} />
    </SafeAreaView>
  );
}
