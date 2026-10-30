import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import type { Booking, CreateReservationRequest, ReservationConsentDecision, UpdateReservationRequest } from '@/types/domain';

export const historyKeys = {
  all: ['bookings'] as const,
  detail: (id: string) => ['bookings', id] as const,
  venues: (q: string) => ['merchants', 'search', q] as const,
  locations: (merchantId: string) => ['merchants', merchantId, 'locations'] as const,
  merchant: (merchantId: string) => ['merchants', merchantId] as const,
  consents: (bookingId: string) => ['bookings', bookingId, 'document-consents'] as const,
};

/** A 4xx is final; anything else is retried once. */
const retryUnless4xx = (failureCount: number, error: unknown) => {
  const status = toApiError(error).status;
  return !(status != null && status >= 400 && status < 500) && failureCount < 1;
};

/** GET /merchants/{merchantId} — the venue's documentAccess, which decides
 *  whether the holder is asked for document consent. Skipped without one. */
export function useMerchant(merchantId: string | null | undefined) {
  return useQuery({
    queryKey: historyKeys.merchant(merchantId ?? ''),
    queryFn: () => api.getMerchant(merchantId as string),
    enabled: !!merchantId,
    retry: retryUnless4xx,
  });
}

/** GET /bookings/{id}/document-consents — each selected person's own
 *  decision. Skipped (pass null) where nobody can be asked. */
export function useReservationConsents(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: historyKeys.consents(bookingId ?? ''),
    queryFn: () => api.getReservationConsents(bookingId as string),
    enabled: !!bookingId,
    retry: retryUnless4xx,
  });
}

/** POST /bookings/{id}/document-consents/{personId} — an adult family
 *  member's own decision, with the liveness capture that proves it is them. */
export function useDecideReservationConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, personId, payload }: { bookingId: string; personId: string; payload: ReservationConsentDecision }) =>
      api.decideReservationConsent(bookingId, personId, payload),
    onSettled: (_data, _error, { bookingId }) => {
      void qc.invalidateQueries({ queryKey: historyKeys.consents(bookingId) });
    },
  });
}

/** GET /merchants/{merchantId}/locations — the picked venue's active
 *  locations. Skipped without a venue. A 4xx (the venue is gone) is final. */
export function useMerchantLocations(merchantId: string | null) {
  return useQuery({
    queryKey: historyKeys.locations(merchantId ?? ''),
    queryFn: () => api.getMerchantLocations(merchantId as string),
    enabled: !!merchantId,
    retry: retryUnless4xx,
  });
}

/** Venue search starts at this many characters. */
export const VENUE_SEARCH_MIN = 2;
const VENUE_SEARCH_DEBOUNCE_MS = 300;
/** The BFF rejects longer queries. */
const VENUE_SEARCH_MAX = 100;

/** GET /merchants?q= — TruePas venues for the reservation form, debounced.
 *  `searching` also covers the debounce wait, so "no matches" never shows
 *  for text that hasn't been searched yet. A 4xx isn't retried. */
export function useVenueSearch(text: string, enabled: boolean) {
  const q = text.trim().slice(0, VENUE_SEARCH_MAX);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), VENUE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const active = enabled && q.length >= VENUE_SEARCH_MIN;
  const settled = debounced === q;
  const query = useQuery({
    queryKey: historyKeys.venues(debounced),
    queryFn: () => api.searchMerchants(debounced),
    enabled: active && debounced.length >= VENUE_SEARCH_MIN,
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => {
      const status = toApiError(error).status;
      return !(status != null && status >= 400 && status < 500) && failureCount < 1;
    },
  });
  return {
    active,
    searching: active && (!settled || query.isFetching),
    failed: active && settled && query.isError && !query.isFetching,
    results: active ? (query.data ?? []) : [],
    retry: () => void query.refetch(),
  };
}

export function useBookings() {
  return useQuery({ queryKey: historyKeys.all, queryFn: api.getBookings });
}

/** GET /bookings/{id}. Pass null/'' to skip (e.g. no linked reservation).
 *  A 4xx is final — 404 = deleted (e.g. opened from an old notification) —
 *  so it isn't retried and the screen shows "not found" at once. */
export function useBooking(id: string | null | undefined) {
  return useQuery({
    queryKey: historyKeys.detail(id ?? ''),
    queryFn: () => api.getBooking(id as string),
    enabled: !!id,
    retry: (failureCount, error) => {
      const status = toApiError(error).status;
      // An expired session maps to 401 too. Anything else: the app default, 2 retries.
      return !(status != null && status >= 400 && status < 500) && failureCount < 2;
    },
  });
}

/** Only the customer's own upcoming reservations can be edited or deleted. */
export function isEditableReservation(b: Booking): boolean {
  return b.source === 'customer' && b.status === 'upcoming';
}

/** `listOnly`: leave the detail caches alone (a deleted booking's open
 *  screen would otherwise refetch into "not found" while it closes). */
function useInvalidateBookings() {
  const qc = useQueryClient();
  return (listOnly = false) => {
    void qc.invalidateQueries({ queryKey: historyKeys.all, exact: listOnly });
    void qc.invalidateQueries({ queryKey: ['account'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

/** POST /bookings — dates as the user's local YYYY-MM-DD. The new booking is
 *  primed into the detail cache so its screen opens without a spinner. */
export function useCreateReservation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (payload: CreateReservationRequest) => api.createReservation(payload),
    onSuccess: (created) => {
      if (created?.id) qc.setQueryData(historyKeys.detail(created.id), created);
      invalidate();
    },
  });
}

/** PATCH /bookings/{id} — send only the fields that changed. */
export function useUpdateReservation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateReservationRequest }) => api.updateReservation(id, patch),
    onSuccess: (updated, { id }) => {
      if (updated) qc.setQueryData(historyKeys.detail(id), updated);
      invalidate();
    },
  });
}

/** DELETE /bookings/{id}. Drops the booking from the list cache at once; its
 *  detail cache is left to garbage-collect after the screen closes. */
export function useDeleteReservation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (id: string) => api.deleteReservation(id),
    onSuccess: (_ok, id) => {
      qc.setQueryData<Booking[]>(historyKeys.all, (list) => list?.filter((b) => b.id !== id));
      invalidate(true);
    },
  });
}
