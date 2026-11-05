/** @jsxImportSource react */
import { Redirect, useRouter } from 'expo-router';
import { Fingerprint, Info, LockKeyhole, ScanFace, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { toApiError } from '@/api/errors';
import { isSignupAddressDeferred, useAddress } from '@/features/address/hooks';
import { useBiometricConsent } from '@/features/auth/mutations';
import { biometricConsentGiven } from '@/features/auth/slice';
import { useLogoutFlow } from '@/features/auth/useLogoutFlow';
import { FaceRing } from '@/premium/blocks';
import { Banner } from '@/premium/kit';
import { Button, Card, Divider, Heading, Row, Screen, TextLink, Tile, TopBar, Txt } from '@/premium/ui';
import { useAppDispatch } from '@/store';

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ScanFace,
    title: 'A quick liveness check',
    body: "A short guided scan proves it's really you — photos and masks are rejected.",
  },
  {
    icon: LockKeyhole,
    title: 'Encrypted face template',
    body: 'Your scan becomes an encrypted face template, kept in dedicated secure storage and used only to verify you.',
  },
  {
    icon: Info,
    title: 'Required to continue',
    body: "Face check-in is how TruePas works, so this step can't be skipped. Withdraw later in Settings.",
  },
];

/** Biometric consent — POST /user/me/biometric-consent { accepted: true }.
 *  Mandatory gate before liveness enrollment: accept → face-scan or sign out.
 *  Comes after the signup address step (no address on file → back to it).
 *  No back button: the onboarding stack has no skip path (PRD). */
export default function ConsentScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { logout, isPending: signingOut } = useLogoutFlow();
  const biometricConsent = useBiometricConsent();
  const loading = biometricConsent.isPending || signingOut;
  const [error, setError] = useState<string | null>(null);
  // Signup verifies the home address first (onboarding/address): a session
  // resumed without one goes back there. A failed read never blocks.
  const address = useAddress();

  if (address.data === null && !isSignupAddressDeferred()) return <Redirect href="/(onboarding)/address" />;

  const accept = async () => {
    if (loading) return;
    setError(null);
    try {
      await biometricConsent.mutateAsync({ accepted: true });
      dispatch(biometricConsentGiven());
      router.push('/(onboarding)/face-scan');
    } catch (err) {
      // User-facing text, not axios's "Request failed with status code 503".
      setError(toApiError(err).message);
    }
  };

  return (
    <Screen
      header={<TopBar title="Face setup" hideBack />}
      footer={
        <>
          <Button
            label="I agree, set up my face"
            icon={Fingerprint}
            loading={biometricConsent.isPending}
            disabled={loading}
            onPress={() => void accept()}
          />
          <Button label="Sign out instead" tone="ghost" size="md" disabled={loading} onPress={() => void logout()} />
        </>
      }>
      <View style={{ alignItems: 'center', marginTop: -6, marginBottom: -14 }}>
        <FaceRing size={170} mode="idle" photo={false} />
      </View>
      <Heading
        title="Your face,"
        accent="your control."
        center
        sub="TruePas verifies it's really you at venues — one glance, no phone, no wallet."
      />
      {error != null && <Banner tone="error" title="Couldn't save consent" body={error} />}
      <Card pad={4} style={{ paddingHorizontal: 18 }}>
        {POINTS.map((p, i) => (
          <View key={p.title}>
            {i > 0 && <Divider inset={58} />}
            <Row gap={14} style={{ paddingVertical: 16 }} align="flex-start">
              <Tile icon={p.icon} tone="sky" size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt v="bodyStrong">{p.title}</Txt>
                <Txt v="small" style={{ lineHeight: 19 }}>
                  {p.body}
                </Txt>
              </View>
            </Row>
          </View>
        ))}
      </Card>
      <Row style={{ justifyContent: 'center' }}>
        <TextLink label="How we handle biometric data" onPress={() => router.push('/legal/privacy-policy')} />
      </Row>
    </Screen>
  );
}
