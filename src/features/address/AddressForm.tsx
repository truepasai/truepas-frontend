import { Building2, Globe, Hash, Landmark, Map as MapIcon, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useToast } from '@/components/composite/Toast';
import {
  type AddressFailure,
  type AddressField,
  addressLines,
  trimAddress,
  validateAddress,
} from '@/features/address/hooks';
import { OptionPicker, type PickerOption } from '@/features/address/OptionPicker';
import {
  ADDRESS_COUNTRIES,
  flagOf,
  INDIAN_STATES,
  isSupportedCountry,
  normalizeState,
  US_STATES,
} from '@/features/address/regions';
import { useAddressAutofill } from '@/features/address/useAddressAutofill';
import { Banner } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Card, Field, Txt } from '@/premium/ui';
import type { PlacePrediction } from '@/services/places';
import type { AddressCountry, AddressInput, AddressSuggestion } from '@/types/domain';

/**
 * The address form shared by Profile → Address (add / change) and the signup
 * address step: country, Google autofill on the street field, the fields the
 * backend checks, and a banner for every server outcome. The screens own the
 * save call and where it goes next.
 */

const FIELDS: AddressField[] = ['line1', 'line2', 'city', 'state', 'postal_code'];

// Every country is listed; only the ones the backend saves can be picked.
const COUNTRY_OPTIONS: PickerOption[] = ADDRESS_COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  leading: flagOf(c.code),
  disabledNote: isSupportedCountry(c.code) ? undefined : 'Coming soon',
}));
const US_STATE_OPTIONS: PickerOption[] = US_STATES.map((s) => ({ value: s.code, label: s.name, detail: s.code }));
const IN_STATE_OPTIONS: PickerOption[] = INDIAN_STATES.map((s) => ({ value: s.name, label: s.name, detail: s.code }));

export function useAddressForm(initial: () => AddressInput) {
  const { toast } = useToast();
  const [input, setInput] = useState<AddressInput>(initial);
  const [errors, setErrors] = useState<Partial<Record<AddressField, string>>>({});
  const [failure, setFailure] = useState<AddressFailure | null>(null);
  const autofill = useAddressAutofill(input.country);

  const set = (field: AddressField) => (value: string) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const setCountry = (country: AddressCountry) => {
    if (country === input.country) return;
    autofill.clear();
    // State values differ per country (US code vs India name): pick again.
    setInput((prev) => ({ ...prev, country, state: '' }));
    setErrors({});
    setFailure(null);
  };

  // Picking a suggestion fills street, city, state and ZIP; the typed line2
  // and the chosen country stay. Saving still runs the backend's check.
  const pickPlace = async (prediction: PlacePrediction) => {
    const filled = await autofill.pick(prediction);
    if (!filled) {
      toast({ variant: 'error', title: "Couldn't fill in that address", description: 'Type the rest of it in, or pick it again.' });
      return;
    }
    setInput((prev) => ({ ...prev, ...filled, state: normalizeState(prev.country, filled.state) }));
    setErrors({});
    setFailure(null);
  };

  /** The trimmed input when the local checks pass, else null (errors shown). */
  const check = (raw: AddressInput): AddressInput | null => {
    const value = trimAddress(raw);
    const fieldErrors = validateAddress(value);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return null;
    setFailure(null);
    return value;
  };

  /** A failed save: the banner, plus the fields a 422 named. */
  const fail = (f: AddressFailure) => {
    if (f.kind === 'validation') {
      setErrors((prev) => {
        const next = { ...prev };
        for (const field of FIELDS) if (f.fields[field]) next[field] = f.fields[field];
        return next;
      });
    }
    setFailure(f);
  };

  return { input, setInput, errors, failure, autofill, set, setCountry, pickPlace, check, fail };
}

export type AddressFormState = ReturnType<typeof useAddressForm>;

export function AddressFields({ form, busy }: { form: AddressFormState; busy: boolean }) {
  const { input, errors, autofill, set } = form;
  const isUS = input.country === 'US';
  return (
    <>
      <OptionPicker
        label="Country"
        icon={Globe}
        value={input.country}
        options={COUNTRY_OPTIONS}
        onChange={(code) => isSupportedCountry(code) && form.setCountry(code)}
        searchPlaceholder="Search countries"
        disabled={busy}
      />

      <Field
        label="Street address"
        icon={MapPin}
        value={input.line1}
        onChangeText={(v) => {
          set('line1')(v);
          autofill.search(v);
        }}
        // Late, so a tap on a suggestion lands before the list goes.
        onBlur={() => setTimeout(autofill.clear, 250)}
        error={errors.line1}
        placeholder={isUS ? 'Start typing your address' : '12 MG Road'}
        hint={autofill.enabled ? 'Pick your address from the list to fill in the rest.' : undefined}
        editable={!busy && !autofill.picking}
        right={autofill.picking ? <ActivityIndicator size="small" color={C.ink3} /> : undefined}
        inputProps={{ maxLength: 200, autoComplete: 'address-line1', textContentType: 'streetAddressLine1', autoCapitalize: 'words' }}
      />
      {autofill.items.length > 0 && <PlaceSuggestions items={autofill.items} onPick={(p) => void form.pickPlace(p)} />}
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
      {/* A list, not free text: the backend only takes these exact values
          (US 2-letter code, India's state/UT name). */}
      <OptionPicker
        label={isUS ? 'State' : 'State / union territory'}
        icon={Landmark}
        value={input.state}
        options={isUS ? US_STATE_OPTIONS : IN_STATE_OPTIONS}
        onChange={set('state')}
        placeholder={isUS ? 'Select a state' : 'Select a state or UT'}
        searchPlaceholder="Search states"
        error={errors.state}
        disabled={busy}
      />
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

      <Txt v="small" color={C.ink3}>
        {isUS
          ? 'US addresses are checked with the postal service and may be saved in its standard format.'
          : 'Indian addresses are saved as you type them.'}
      </Txt>
    </>
  );
}

function PlaceSuggestions({ items, onPick }: { items: PlacePrediction[]; onPick: (p: PlacePrediction) => void }) {
  return (
    <Card pad={0} style={{ marginTop: -10, paddingHorizontal: 16, paddingVertical: 4 }}>
      {items.map((p, i) => (
        <Pressable
          key={p.placeId}
          onPress={() => onPick(p)}
          accessibilityRole="button"
          accessibilityLabel={`${p.main}, ${p.secondary}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            borderTopWidth: i ? 1 : 0,
            borderTopColor: C.lineSoft,
          }}>
          <MapPin size={16} color={C.ink3} />
          <View style={{ flex: 1 }}>
            <Txt v="bodyStrong" lines={1}>
              {p.main}
            </Txt>
            {!!p.secondary && (
              <Txt v="small" lines={1}>
                {p.secondary}
              </Txt>
            )}
          </View>
        </Pressable>
      ))}
      {/* Google requires attribution next to Places results shown off a map. */}
      <Txt v="small" color={C.ink4} style={{ textAlign: 'right', paddingVertical: 8 }}>
        Powered by Google
      </Txt>
    </Card>
  );
}

/** `onContinueToPin`: Profile only — an existing address is changed through
 *  the PIN step. Signup never reaches already_exists (it moves on instead). */
export function AddressFailureBanner({
  failure,
  busy,
  onUseSuggestion,
  onContinueToPin,
}: {
  failure: AddressFailure | null;
  busy: boolean;
  onUseSuggestion: (s: AddressSuggestion) => void;
  onContinueToPin?: () => void;
}) {
  if (!failure) return null;
  switch (failure.kind) {
    case 'not_verified':
      return (
        <View style={{ gap: 12 }}>
          <Banner
            tone="error"
            title="We couldn't verify this address"
            body={[failure.message, ...failure.issues.map((i) => `• ${i}`)].join('\n')}
          />
          {failure.suggestion && (
            <Card>
              <View style={{ gap: 10 }}>
                <Txt v="smallStrong" color={C.ink2}>
                  Did you mean…?
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
          action={onContinueToPin ? <Button label="Continue" size="sm" full={false} onPress={onContinueToPin} /> : undefined}
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
