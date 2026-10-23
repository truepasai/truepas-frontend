import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import type { Address, AddressCountry, AddressInput, AddressSuggestion } from '@/types/domain';

/**
 * Address (backend Oct 2026): GET/POST/PUT /user/me/address.
 * - GET 404 → no address yet (api.getAddress returns null) → Add form, POST.
 * - PUT needs a verify-pin reauth token (scope address_update).
 * - US addresses come back standardized by Smarty — always render the
 *   server's copy, never what was typed.
 * - Address errors carry their reason in the body's `error` field; the
 *   generic `code` (BAD_REQUEST…) is ignored.
 */
export const addressKeys = { mine: ['address', 'me'] as const };

export function useAddress() {
  return useQuery({ queryKey: addressKeys.mine, queryFn: () => api.getAddress() });
}

export function useSaveAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, input }: { mode: 'create' | 'update'; input: AddressInput }) =>
      mode === 'create' ? api.createAddress(input) : api.updateAddress(input),
    onSuccess: (saved) => queryClient.setQueryData(addressKeys.mine, saved),
  });
}

export type AddressFailure =
  | { kind: 'not_verified'; message: string; issues: string[]; suggestion: AddressSuggestion | null }
  | { kind: 'already_exists' }
  | { kind: 'not_found' }
  | { kind: 'cooldown'; message: string; retryAfter: number }
  | { kind: 'reauth' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'validation'; message: string; fields: Record<string, string> }
  | { kind: 'other'; message: string; traceId?: string };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** 422 `details`: [{ loc: [..., 'postal_code'], msg }] or [{ field, message }]. */
function detailFields(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const details = data?.details;
  if (!Array.isArray(details)) return out;
  for (const d of details as Record<string, unknown>[]) {
    const loc = Array.isArray(d?.loc) ? d.loc[d.loc.length - 1] : d?.field;
    const msg = str(d?.msg) ?? str(d?.message);
    if (typeof loc === 'string' && msg) out[loc] = msg;
  }
  return out;
}

export function addressFailure(err: unknown): AddressFailure {
  const apiErr = toApiError(err);
  const data = (isAxiosError(err) ? err.response?.data : undefined) as Record<string, unknown> | undefined;
  const serverMessage = str(data?.message);
  switch (apiErr.errorCode) {
    case 'ADDRESS_NOT_VERIFIED': {
      const s = data?.suggestion as Partial<AddressSuggestion> | null | undefined;
      return {
        kind: 'not_verified',
        message: serverMessage ?? "We couldn't verify this address. Check the street, city, state and ZIP code.",
        issues: Array.isArray(data?.issues) ? (data.issues as unknown[]).filter((i): i is string => typeof i === 'string') : [],
        suggestion:
          s && s.line1 && s.city && s.state && s.postal_code
            ? { line1: s.line1, city: s.city, state: s.state, postal_code: s.postal_code }
            : null,
      };
    }
    case 'ADDRESS_ALREADY_EXISTS':
      return { kind: 'already_exists' };
    case 'ADDRESS_NOT_FOUND':
      return { kind: 'not_found' };
    case 'ADDRESS_UPDATE_COOLDOWN':
      return {
        kind: 'cooldown',
        message: serverMessage ?? 'You can change your address once every 15 days.',
        retryAfter: apiErr.retryAfterSeconds ?? 0,
      };
    case 'ADDRESS_SERVICE_UNAVAILABLE':
      return { kind: 'unavailable', message: "We couldn't check the address right now. Please try again shortly." };
  }
  if (apiErr.code === 'REAUTH_REQUIRED') return { kind: 'reauth' };
  if (apiErr.status === 422) {
    return { kind: 'validation', message: 'Please check the highlighted fields.', fields: detailFields(data) };
  }
  if (apiErr.code === 'SERVICE_UNAVAILABLE' || apiErr.code === 'TIMEOUT' || apiErr.code === 'NETWORK') {
    return { kind: 'unavailable', message: apiErr.message };
  }
  return { kind: 'other', message: apiErr.message, traceId: apiErr.traceId };
}

/* ── client-side checks (mirror the server rules) ─────────────────────── */

export type AddressField = 'line1' | 'line2' | 'city' | 'state' | 'postal_code';

export function validateAddress(input: AddressInput): Partial<Record<AddressField, string>> {
  const e: Partial<Record<AddressField, string>> = {};
  const line1 = input.line1.trim();
  if (!line1) e.line1 = 'Enter the street address.';
  else if (line1.length > 200) e.line1 = 'Use 200 characters or fewer.';
  if ((input.line2 ?? '').trim().length > 200) e.line2 = 'Use 200 characters or fewer.';
  const city = input.city.trim();
  if (!city) e.city = 'Enter the city.';
  else if (city.length > 100) e.city = 'Use 100 characters or fewer.';
  const state = input.state.trim();
  if (input.country === 'US') {
    if (!/^[A-Za-z]{2}$/.test(state)) e.state = 'Use the 2-letter state code, like TX or CA.';
    if (!/^\d{5}(-\d{4})?$/.test(input.postal_code.trim())) e.postal_code = 'Use a 5-digit ZIP, like 32836 or 32836-1234.';
  } else {
    if (!state) e.state = 'Enter the state, like Maharashtra or MH.';
    if (!/^\d{6}$/.test(input.postal_code.trim())) e.postal_code = 'Use the 6-digit PIN code.';
  }
  return e;
}

export function trimAddress(input: AddressInput): AddressInput {
  const line2 = input.line2?.trim();
  return {
    line1: input.line1.trim(),
    ...(line2 ? { line2 } : {}),
    city: input.city.trim(),
    state: input.country === 'US' ? input.state.trim().toUpperCase() : input.state.trim(),
    postal_code: input.postal_code.trim(),
    country: input.country,
  };
}

export function emptyAddress(country: AddressCountry = 'US'): AddressInput {
  return { line1: '', line2: '', city: '', state: '', postal_code: '', country };
}

export function toInput(a: Address): AddressInput {
  return { line1: a.line1, line2: a.line2 ?? '', city: a.city, state: a.state, postal_code: a.postal_code, country: a.country };
}

/** "9214 Hanging Vine Ct, Apt 2" / "Orlando, FL 32836-1234". */
export function addressLines(a: Pick<Address, 'line1' | 'line2' | 'city' | 'state' | 'postal_code'>): [string, string] {
  return [a.line2 ? `${a.line1}, ${a.line2}` : a.line1, `${a.city}, ${a.state} ${a.postal_code}`];
}

/* ── draft kept across the PIN round trip ─────────────────────────────── */

let draft: AddressInput | null = null;

/** The form's input survives a trip to the PIN screen (expired token). */
export function setAddressDraft(value: AddressInput | null): void {
  draft = value;
}

export function takeAddressDraft(): AddressInput | null {
  const d = draft;
  draft = null;
  return d;
}
