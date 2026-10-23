import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Building2, Hash, Map as MapIcon, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { waitText } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import {
  type AddressFailure,
  type AddressField,
  addressFailure,
  addressKeys,
  addressLines,
  emptyAddress,
  setAddressDraft,
  takeAddressDraft,
  toInput,
  trimAddress,
  useSaveAddress,
  validateAddress,
} from '@/features/address/hooks';
import { Banner } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Card, Chip, Field, Row, Screen, TopBar, Txt } from '@/premium/ui';
import { cooldownKey, setCooldown, useCooldown } from '@/services/cooldowns';
import { hasReauthToken } from '@/services/reauth';
import { useAppSelector } from '@/store';
import type { Address, AddressCountry, AddressInput, AddressSuggestion } from '@/types/domain';

const FIELDS: AddressField[] = ['line1', 'line2', 'city', 'state', 'postal_code'];
const FIFTEEN_DAYS_S = 15 * 86_400;

/**
 * Add (POST, no PIN) or change (PUT + address_update PIN token) the address.
 * Every backend outcome has a place to land:
 * - 400 ADDRESS_NOT_VERIFIED â†’ message, issues, and "Did you meanâ€¦?" with a
 *   one-tap resubmit (keeps the typed line2; never resubmits on its own).
 * - 409 on POST â†’ an address exists: continue to the PIN + PUT flow.
 * - 404 on PUT â†’ none exists: the same input goes out as a POST.
 * - 429 â†’ 15-day cooldown: message, Save disabled until retry_after.
 * - 403 REAUTH_REQUIRED â†’ back to the PIN step; the input is kept.
 * - 503 / timeout â†’ "try again shortly", input kept.
 * - 422 â†’ the field the server named.
 */
export default function AddressEditScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAppSelector((state) => state.auth.user);
  const params = useLocalSearchParams<{ mode?: 'create' | 'update' }>();

  const [mode, setMode] = useState<'create' | 'update'>(params.mode === 'update' ? 'update' : 'create');
  // Changing an address only works with a fresh PIN check â€” checked once on
  // entry, like the face update camera.
  const [pinVerified] = useState(() => params.mode !== 'update' || hasReauthToken());
  const [input, setInput] = useState<AddressInput>(() => {
    const draft = takeAddressDraft();
    if (draft) return draft;
    const saved = queryClient.getQueryData<Address | null>(addressKeys.mine);
    return saved ? toInput(saved) : emptyAddress();
  });
  const [errors, setErrors] = useState<Partial<Record<AddressField, string>>>({});
  const [failure, setFailure] = useState<AddressFailure | null>(null);
  const save = useSaveAddress();
  const key = user ? cooldownKey('address-update', user.id) : null;
  const cooldownLeft = useCooldown(mode === 'update' ? key : null);

  if (!pinVerified) return <Redirect href="/profile/address-pin" />;

  const isUS = input.country === 'US';
  const set = (field: AddressField) => (value: string) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const setCountry = (country: AddressCountry) => {
    if (country === input.country) return;
    setInput((prev) => ({ ...prev, country }));
    setErrors({});
    setFailure(null);
  };

  const toPin = (value: AddressInput, reason?: 'expired') => {
    setAddressDraft(value);
    router.replace({ pathname: '/profile/address-pin', params: reason ? { reason } : {} });
  };

  const submit = async (raw: AddressInput, asMode: 'create' | 'update' = mode): Promise<void> => {
    const value = trimAddress(raw);
    const fieldErrors = validateAddress(value);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setFailure(null);
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
      if (f.kind === 'validation') {
        setErrors((prev) => {
          const next = { ...prev };
          for (const field of FIELDS) if (f.fields[field]) next[field] = f.fields[field];
          return next;
        });
      }
      setFailure(f);
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
              Checking the addressâ€¦ this can take a few seconds.
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
      <FailureBanner failure={failure} busy={busy} onUseSuggestion={applySuggestion} onContinueToPin={() => toPin(input)} />

      <View style={{ gap: 8 }}>
        <Txt v="smallStrong" color={C.ink2}>
          Country
        </Txt>
        <Row gap={8}>
          <Chip label="United States" active={isUS} onPress={busy ? undefined : () => setCountry('US')} />
          <Chip label="India" active={!isUS} onPress={busy ? undefined : () => setCountry('IN')} />
        </Row>
      </View>

      <Field
        label="Street address"
        icon={MapPin}
        value={input.line1}
        onChangeText={set('line1')}
        error={errors.line1}
        placeholder={isUS ? '9214 Hanging Vine Ct' : '12 MG Road'}
        editable={!busy}
        inputProps={{ maxLength: 200, autoComplete: 'address-line1', textContentType: 'streetAddressLine1', autoCapitalize: 'words' }}
      />
      <Field
        label="Apt, suite, unit (optional)"
        icon={Building2}
        value={input.line2 ?? ''}
        onChangeText={set('line2')}
        error={errors.line2}
        placeholder="Apt 2"
        editable={!busy}
        inputProps={{ maxLength: 200, autoComplete: 'address-line2', textContentType: 'streetAddressLine2' }}
      />
      <Field
        label="City"
        icon={MapIcon}
        value={input.city}
        onChangeText={set('city')}
        error={errors.city}
        placeholder={isUS ? 'Orlando' : 'Mumbai'}
        editable={!busy}
        inputProps={{ maxLength: 100, textContentType: 'addressCity', autoCapitalize: 'words' }}
      />
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Field
            label="State"
            value={input.state}
            onChangeText={set('state')}
            error={errors.state}
            placeholder={isUS ? 'FL' : 'Maharashtra'}
            editable={!busy}
            inputProps={{
              maxLength: isUS ? 2 : 60,
              autoCapitalize: isUS ? 'characters' : 'words',
              textContentType: 'addressState',
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={isUS ? 'ZIP code' : 'PIN code'}
            icon={Hash}
            value={input.postal_code}
            onChangeText={set('postal_code')}
            error={errors.postal_code}
            placeholder={isUS ? '32836' : '400001'}
            keyboardType={isUS ? 'numbers-and-punctuation' : 'number-pad'}
            editable={!busy}
            inputProps={{ maxLength: isUS ? 10 : 6, autoComplete: 'postal-code', textContentType: 'postalCode' }}
          />
        </View>
      </Row>

      <Txt v="small" color={C.ink3}>
        {isUS
          ? 'US addresses are checked with the postal service and may be saved in its standard format.'
          : 'Indian addresses are saved as you type them.'}
      </Txt>
    </Screen>
  );
}

function FailureBanner({
  failure,
  busy,
  onUseSuggestion,
  onContinueToPin,
}: {
  failure: AddressFailure | null;
  busy: boolean;
  onUseSuggestion: (s: AddressSuggestion) => void;
  onContinueToPin: () => void;
}) {
  if (!failure) return null;
  switch (failure.kind) {
    case 'not_verified':
      return (
        <View style={{ gap: 12 }}>
          <Banner
            tone="error"
            title="We couldn't verify this address"
            body={[failure.message, ...failure.issues.map((i) => `â€¢ ${i}`)].join('\n')}
          />
          {failure.suggestion && (
            <Card>
              <View style={{ gap: 10 }}>
                <Txt v="smallStrong" color={C.ink2}>
                  Did you meanâ€¦?
                </Txt>
                {addressLines({ ...failure.suggestion, line2: null }).map((line) => (
                  <Txt key={line} v="bodyStrong">
                    {line}
                  </Txt>
                ))}
                <Button
                  label="Use this address"
                  tone="white"
                  size="sm"
                  full={false}
                  disabled={busy}
                  onPress={() => failure.suggestion && onUseSuggestion(failure.suggestion)}
                />
              </View>
            </Card>
          )}
        </View>
      );
    case 'already_exists':
      return (
        <Banner
          tone="warning"
          title="You already have an address"
          body="Enter your PIN to change it instead."
          action={<Button label="Continue" size="sm" full={false} onPress={onContinueToPin} />}
        />
      );
    case 'cooldown':
      return <Banner tone="info" title="Address recently changed" body={failure.message} />;
    case 'unavailable':
      return <Banner tone="warning" title="Address check unavailable" body={failure.message} />;
    case 'validation':
      return <Banner tone="error" body={failure.message} />;
    case 'other':
      return (
        <Banner
          tone="error"
          body={failure.traceId ? `${failure.message}\nReference: ${failure.traceId}` : failure.message}
        />
      );
    default:
      return null;
  }
}
