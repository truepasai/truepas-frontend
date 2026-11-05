import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/composite/Toast';
import { AddressFailureBanner, AddressFields, useAddressForm } from '@/features/address/AddressForm';
import {
  addressFailure,
  addressKeys,
  deferSignupAddress,
  emptyAddress,
  useAddress,
  useSaveAddress,
} from '@/features/address/hooks';
import { useLogoutFlow } from '@/features/auth/useLogoutFlow';
import { C } from '@/premium/theme';
import { Button, Heading, Screen, TopBar, Txt } from '@/premium/ui';
import type { AddressInput, AddressSuggestion } from '@/types/domain';

/**
 * Signup — home address, verified before face setup (as in FacePe): right
 * after email verification, POST /user/me/address (no PIN on a first
 * address). US addresses are checked by Smarty; a 400 ADDRESS_NOT_VERIFIED
 * shows "Did you mean…?" and the user can't continue until one is saved.
 * - 409 ADDRESS_ALREADY_EXISTS / an address on file → straight to consent.
 * - 503 / timeout → "Add later" appears, so signup is never stuck on it.
 * No back button: the onboarding stack has no skip path; sign out instead.
 */
export default function SignupAddressScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logout, isPending: signingOut } = useLogoutFlow();
  const existing = useAddress();
  const form = useAddressForm(() => emptyAddress());
  const { input, setInput } = form;
  const save = useSaveAddress();
  const [checkDown, setCheckDown] = useState(false);

  // Saved on an earlier try (signup resumed): nothing to ask.
  if (existing.data) return <Redirect href="/(onboarding)/consent" />;

  const next = () => router.replace('/(onboarding)/consent');

  const submit = async (raw: AddressInput) => {
    const value = form.check(raw);
    if (!value) return;
    try {
      await save.mutateAsync({ mode: 'create', input: value });
      toast({
        variant: 'success',
        title: 'Address verified',
        description: value.country === 'US' ? 'We matched it to the postal service record.' : undefined,
      });
      next();
    } catch (err) {
      const f = addressFailure(err);
      if (f.kind === 'already_exists') {
        void queryClient.invalidateQueries({ queryKey: addressKeys.mine });
        next();
        return;
      }
      if (f.kind === 'unavailable') setCheckDown(true);
      form.fail(f);
    }
  };

  // "Use this": the suggestion has no line2, so the typed one is kept.
  const applySuggestion = (s: AddressSuggestion) => {
    const nextInput = { ...input, ...s };
    setInput(nextInput);
    void submit(nextInput);
  };

  const addLater = () => {
    deferSignupAddress();
    next();
  };

  const busy = save.isPending;
  const loading = busy || signingOut;

  return (
    <Screen
      keyboard
      header={<TopBar title="Your address" hideBack />}
      contentStyle={{ paddingTop: 8, gap: 18 }}
      footer={
        <View style={{ gap: 10 }}>
          {busy && (
            <Txt v="small" color={C.ink3} center>
              Checking the address… this can take a few seconds.
            </Txt>
          )}
          <Button label="Verify address" loading={busy} disabled={loading} onPress={() => void submit(input)} />
          {checkDown ? (
            <Button label="Add it later" tone="ghost" size="md" disabled={loading} onPress={addLater} />
          ) : (
            <Button label="Sign out instead" tone="ghost" size="md" disabled={loading} onPress={() => void logout()} />
          )}
        </View>
      }>
      <Heading
        title="Where do"
        accent="you live?"
        sub="We verify your home address before setting up your face. It's encrypted and only used to confirm your identity."
      />
      <AddressFailureBanner failure={form.failure} busy={busy} onUseSuggestion={applySuggestion} />
      <AddressFields form={form} busy={busy} />
    </Screen>
  );
}
