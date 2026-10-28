import { useLocalSearchParams, useRouter } from 'expo-router';
import { Baby, Camera as CameraIcon, SwitchCamera } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    usePhotoOutput,
    type CameraRef,
} from 'react-native-vision-camera';

import { toApiError } from '@/api/errors';
import { Alert, ScreenHeader } from '@/components/composite';
import { CoreButton, IconButton, LoadingState, NeuBox, NeuWell, SoftIconButton, Typography } from '@/components/ui';
import { useEnrollFace } from '@/features/auth/mutations';
import { makeStyles, useThemeTokens } from '@/theme';
import { iconSize } from '@/theme/tokens';

/** Add family — photo enrollment for under-5 members (POST /cb/face/enroll).
 *  Under-5 members can't run liveness — one clear photo is sent as
 *  { selfieBase64, personId } instead of liveness session credentials.
 *  Layout mirrors UI-design-repo FamilyEnrollScreen photo mode: a carded
 *  photo frame with the live camera inside, camera note + capture button in
 *  the frame footer.
 *  Never imported statically by routes — loaded via cameraModule.loadPhotoCapture()
 *  so builds without NitroModules degrade to <CameraUnavailable />. */
export function PhotoCapture() {
  const styles = useStyles();
  const theme = useThemeTokens();
  const router = useRouter();
  const { name, age, personId } = useLocalSearchParams<{ name?: string; age?: string; personId?: string }>();

  const { hasPermission, requestPermission } = useCameraPermission();
  // Under-5 photo enrollment allows either camera — a parent can hold the
  // phone and capture the child with the rear camera.
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraPosition);
  // JPEG, not the 'native' default: that is HEIC on iOS, which the backend
  // can't decode ("no face detected").
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg' });
  const cameraRef = useRef<CameraRef>(null);
  const enrollFace = useEnrollFace();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stop the preview and let the native camera settle before leaving —
  // unmounting an ACTIVE Camera on Fabric crashes (see LivenessCamera
  // settleCameraThen).
  const [cameraActive, setCameraActive] = useState(true);
  const settleCameraThen = async (navigate: () => void) => {
    setCameraActive(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    navigate();
  };

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const goToMemberDetail = () => {
    if (personId) {
      router.replace({ pathname: '/family/[id]', params: { id: personId } });
    } else {
      router.dismissTo('/(tabs)');
    }
  };

  const capture = async () => {
    if (capturing) return;
    if (!personId) {
      setError('Missing family member reference. Please go back and try again.');
      return;
    }
    setCapturing(true);
    setError(null);
    try {
      const photoFile = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
      if (!photoFile) throw new Error('Failed to capture photo');
      const { File } = await import('expo-file-system');
      const filePath = photoFile.filePath.startsWith('file://') ? photoFile.filePath : `file://${photoFile.filePath}`;
      const selfieBase64 = await new File(filePath).base64();
      await enrollFace.mutateAsync({ selfieBase64, personId });
      await settleCameraThen(goToMemberDetail);
    } catch (err) {
      setError(toApiError(err).message || 'Could not enroll the photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const header = (
    <ScreenHeader
      title={name ?? 'Face enrollment'}
      subtitle={age ? `Age ${age} · photo enrollment` : 'Photo enrollment'}
      onBack={() => void settleCameraThen(router.back)}
      actions={
        <IconButton
          accessibilityLabel={cameraPosition === 'front' ? 'Switch to back camera' : 'Switch to front camera'}
          icon={<SwitchCamera size={iconSize.md} color={theme.colors.actionPrimary} />}
          onPress={() => setCameraPosition((p) => (p === 'front' ? 'back' : 'front'))}
        />
      }
    />
  );

  if (!hasPermission) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        {header}
        <View style={styles.centered}>
          <Typography variant="body" center>
            Camera permission is required to take the enrollment photo.
          </Typography>
          <CoreButton onPress={requestPermission} accessibilityLabel="Grant camera permission">
            Grant permission
          </CoreButton>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        {header}
        <LoadingState fullPage label="Loading camera…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {header}
      <View style={styles.body}>
        <NeuBox variant="raised" depth={6} color={theme.colors.surface} style={styles.card}>
          <View style={styles.cardHead}>
            <Baby size={iconSize.md} color={theme.colors.actionPrimary} />
            <Typography variant="h4">Photo enrollment</Typography>
          </View>
          <Typography variant="body-sm" color="secondary">
            Members under 5 enroll with one clear photo — no liveness check needed.
          </Typography>
          <NeuWell radius={theme.radii.xl} style={styles.photoFrame}>
            <View style={styles.photoGuide}>
              <Camera
                ref={cameraRef}
                style={styles.camera}
                device={device}
                isActive={cameraActive}
                outputs={[photoOutput]}
                mirrorMode="auto"
              />
            </View>
            <View style={styles.photoFooter}>
              <Typography variant="caption" color="muted" style={styles.cameraNote}>
                {cameraPosition === 'front' ? 'Front camera' : 'Back camera'}
              </Typography>
              <SoftIconButton
                icon={CameraIcon}
                size={56}
                solid
                disabled={capturing}
                onPress={() => void capture()}
                accessibilityLabel="Capture photo"
              />
            </View>
          </NeuWell>
        </NeuBox>

        {error ? (
          <Alert variant="error" title="Photo enrollment failed">
            {error}
          </Alert>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  safe: { flex: 1, backgroundColor: t.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing[6],
    gap: t.spacing[3],
  },
  body: { flex: 1, padding: t.spacing[4], gap: t.spacing[4] },
  card: { padding: t.spacing[4], gap: t.spacing[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] },
  photoFrame: { padding: t.spacing[3], gap: t.spacing[3] },
  photoGuide: {
    height: 260,
    borderRadius: t.radii.lg,
    borderWidth: t.sizes.fieldBorderWidth,
    borderColor: t.colors.borderStrong,
    overflow: 'hidden',
  },
  camera: { flex: 1 },
  photoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  cameraNote: { flexShrink: 1 },
}));
