import { useCallback, useEffect, useRef, useState } from 'react';

import {
  autocompleteAddress,
  isPlacesEnabled,
  newPlacesSession,
  type PlacePrediction,
  placeAddress,
} from '@/services/places';
import type { AddressCountry, AddressSuggestion } from '@/types/domain';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/**
 * Street-field autofill: suggestions while typing (debounced, stale requests
 * aborted), then the picked place as form fields. Failures stay silent — the
 * field keeps working as a plain input.
 */
export function useAddressAutofill(country: AddressCountry) {
  const enabled = isPlacesEnabled();
  const [items, setItems] = useState<PlacePrediction[]>([]);
  const [picking, setPicking] = useState(false);
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inflight.current?.abort();
    inflight.current = null;
  }, []);

  const clear = useCallback(() => {
    cancel();
    setItems([]);
  }, [cancel]);

  const search = useCallback(
    (text: string) => {
      if (!enabled) return;
      cancel();
      const query = text.trim();
      if (query.length < MIN_CHARS) {
        setItems([]);
        return;
      }
      timer.current = setTimeout(() => {
        session.current ??= newPlacesSession();
        const ctrl = new AbortController();
        inflight.current = ctrl;
        autocompleteAddress(query, country, session.current, ctrl.signal)
          .then((found) => {
            if (!ctrl.signal.aborted) setItems(found);
          })
          .catch((err) => {
            if (ctrl.signal.aborted) return;
            if (__DEV__) console.warn('[Places] autocomplete failed', err);
            setItems([]);
          });
      }, DEBOUNCE_MS);
    },
    [country, enabled, cancel],
  );

  /** Resolves to the picked address, or null if the lookup failed. */
  const pick = useCallback(
    async (prediction: PlacePrediction): Promise<AddressSuggestion | null> => {
      clear();
      setPicking(true);
      try {
        return await placeAddress(prediction.placeId, country, session.current ?? newPlacesSession());
      } catch (err) {
        if (__DEV__) console.warn('[Places] details failed', err);
        return null;
      } finally {
        // The session ends with a pick; the next search starts a new one.
        session.current = null;
        setPicking(false);
      }
    },
    [country, clear],
  );

  useEffect(() => cancel, [cancel]);

  return { enabled, items, picking, search, pick, clear };
}
