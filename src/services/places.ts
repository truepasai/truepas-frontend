import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { AddressCountry, AddressSuggestion } from '@/types/domain';

/**
 * Address autofill — Google Places API (New), called straight from the app.
 * It only fills the form: the address is still checked by the backend
 * (Smarty) when it is saved, so a slightly off city ("Golden Oak" for an
 * Orlando ZIP) comes back corrected or as a "Did you mean…?".
 *
 * Plain fetch, never apiClient — that would send the user's TruePas token to
 * Google. The key is app-restricted in Google Cloud; the bundle id / package
 * header below is what lets a restricted key work from REST calls.
 *
 * No key configured → isPlacesEnabled() is false and the form works as before.
 */
const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
const BASE = 'https://places.googleapis.com/v1';

export function isPlacesEnabled(): boolean {
  return API_KEY.length > 0;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': API_KEY };
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  const pkg = Constants.expoConfig?.android?.package;
  if (Platform.OS === 'ios' && bundleId) h['X-Ios-Bundle-Identifier'] = bundleId;
  if (Platform.OS === 'android' && pkg) h['X-Android-Package'] = pkg;
  return h;
}

/** One token per search (typing → picking), so Google bills it as one session. */
export function newPlacesSession(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface PlacePrediction {
  placeId: string;
  main: string;
  secondary: string;
}

export async function autocompleteAddress(
  input: string,
  country: AddressCountry,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlacePrediction[]> {
  const res = await fetch(`${BASE}/places:autocomplete`, {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: [country.toLowerCase()],
      // US: street addresses only. India: many addresses are areas without a
      // street number, so no type filter there.
      ...(country === 'US' ? { includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Places autocomplete ${res.status}`);
  const data = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** The picked place as form fields (no line2 — the user keeps theirs). */
export async function placeAddress(placeId: string, country: AddressCountry, sessionToken: string): Promise<AddressSuggestion> {
  const res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, {
    headers: { ...headers(), 'X-Goog-FieldMask': 'addressComponents,formattedAddress' },
  });
  if (!res.ok) throw new Error(`Places details ${res.status}`);
  const data = (await res.json()) as { addressComponents?: AddressComponent[]; formattedAddress?: string };
  const parts = data.addressComponents ?? [];
  const find = (...types: string[]) => {
    for (const t of types) {
      const c = parts.find((p) => p.types?.includes(t));
      if (c) return c;
    }
    return undefined;
  };

  const street = [find('street_number')?.longText, find('route')?.longText].filter(Boolean).join(' ');
  // No street (common in India): the most specific named place instead.
  const line1 =
    street ||
    [find('premise')?.longText, find('sublocality_level_2', 'sublocality_level_3', 'neighborhood')?.longText]
      .filter(Boolean)
      .join(', ') ||
    data.formattedAddress?.split(',')[0] ||
    '';
  // US addresses often have no `locality` (Golden Oak, not Orlando); Smarty
  // corrects the city on save.
  const city =
    find('locality', 'postal_town')?.longText ??
    find('sublocality_level_1', 'neighborhood', 'administrative_area_level_3')?.longText ??
    '';
  const region = find('administrative_area_level_1');
  const state = (country === 'US' ? region?.shortText : region?.longText) ?? '';
  const postal = find('postal_code')?.longText ?? '';
  const suffix = find('postal_code_suffix')?.longText;

  return {
    line1,
    city,
    state,
    postal_code: country === 'US' && suffix && /^\d{5}$/.test(postal) ? `${postal}-${suffix}` : postal,
  };
}
