import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { waitText } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { AddressFailureBanner, AddressFields, useAddressForm } from '@/features/address/AddressForm';
import {
  addressFailure,
  addressKeys,
  emptyAddress,
  setAddressDraft,
  takeAddressDraft,
  toInput,
  useSaveAddress,
} from '@/features/address/hooks';
import { C } from '@/premium/theme';
import { Button, Screen, TopBar, Txt } from '@/premium/ui';
import { cooldownKey, setCooldown, useCooldown } from '@/services/cooldowns';
import { hasReauthToken } from '@/services/reauth';
import { useAppSelector } from '@/store';
import type { Address, AddressInput, AddressSuggestion } from '@/types/domain';

const FIFTEEN_DAYS_S = 15 * 86_400;

/**
 * Add (POST, no PIN) or change (PUT + address_update PIN token) the address.
 * Every backend outcome has a place to land:
 * - 400 ADDRESS_NOT_VERIFIED → message, issues, and "Did you mean…?" with a
 *   one-tap resubmit (keeps the typed line2; never resubmits on its own).
 * - 409 on POST → an address exists: continue to the PIN + PUT flow.
 * - 404 on PUT → none exists: the same input goes out as a POST.
 * - 429 → 15-day cooldown: message, Save disabled until retry_after.
 * - 403 REAUTH_REQUIRED → back to the PIN step; the input is kept.
 * - 503 / timeout → "try again shortly", input kept.
 * - 422 → the field the server named.
 */
export default function AddressEditScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAppSelector((state) => state.auth.user);
  const params = useLocalSearchParams<{ mode?: 'create' | 'update' }>();

  const [mode, setMode] = useState<'create' | 'update'>(params.mode === 'update' ? 'update' : 'create');
  // Changing an address only works with a fresh PIN check — checked once on
  // entry, like the face update camera.
  const [pinVerified] = useState(() => params.mode !== 'update' || hasReauthToken());
  const form = useAddressForm(() => {
    const draft = takeAddressDraft();
    if (draft) return draft;
    const saved = queryClient.getQueryData<Address | null>(addressKeys.mine);
    return saved ? toInput(saved) : emptyAddress();
  });
  const { input, setInput } = form;
  const save = useSaveAddress();
  const key = user ? cooldownKey('address-update', user.id) : null;
  const cooldownLeft = useCooldown(mode === 'update' ? key : null);

  if (!pinVerified) return <Redirect href="/profile/address-pin" />;

  const toPin = (value: AddressInput, reason?: 'expired') => {
    setAddressDraft(value);
    router.replace({ pathname: '/profile/address-pin', params: reason ? { reason } : {} });
  };

  const submit = async (raw: AddressInput, asMode: 'create' | 'update' = mode): Promise<void> => {
    const value = form.check(raw);
    if (!value) return;
    try {
      await save.mutateAsync({ mode: asMode, input: value });
      toast({
        variant: 'success',
        title: asMode === 'create' ? 'Address saved' : 'Address updated',
        description: value.country === 'US' ? 'We matched it to the postal service record.' : undefined,
      });
      router.back();
    } catch (err) {
      const f = addressFailure(err);
      if (f.kind === 'reauth') {
        toPin(raw, 'expired');
        return;
      }
      if (f.kind === 'not_found' && asMode === 'update') {
        setMode('create');
        return submit(raw, 'create');
      }
      if (f.kind === 'already_exists') void queryClient.invalidateQueries({ queryKey: addressKeys.mine });
      if (f.kind === 'cooldown' && key) setCooldown(key, f.retryAfter || FIFTEEN_DAYS_S);
      form.fail(f);
    }
  };

  // "Use this": the suggestion has no line2, so the typed one is kept.
  const applySuggestion = (s: AddressSuggestion) => {
    const next = { ...input, ...s };
    setInput(next);
    void submit(next);
  };

  const busy = save.isPending;

  return (
    <Screen
      keyboard
      header={<TopBar title={mode === 'create' ? 'Add address' : 'Change address'} />}
      contentStyle={{ paddingTop: 8, gap: 18 }}
      footer={
        <View style={{ gap: 10 }}>
          {busy && (
            <Txt v="small" color={C.ink3} center>
              Checking the address… this can take a few seconds.
            </Txt>
          )}
          <Button
            label={cooldownLeft > 0 ? `Try again in ${waitText(cooldownLeft)}` : 'Save address'}
            loading={busy}
            disabled={busy || cooldownLeft > 0}
            onPress={() => void submit(input)}
          />
        </View>
      }>
      <AddressFailureBanner failure={form.failure} busy={busy} onUseSuggestion={applySuggestion} onContinueToPin={() => toPin(input)} />
      <AddressFields form={form} busy={busy} />
    </Screen>
  );
}
