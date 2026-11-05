/**
 * Date-based booking status — pure (no React Native), so it runs under
 * `node --test` (src/features/history/__tests__).
 *
 * The BFF keeps a reservation "upcoming" until a kiosk check-in completes it,
 * even on its check-in day or after its dates have passed (BUG056). Until the
 * server derives this itself, the app does, from the local calendar day:
 *  - before the check-in day       → upcoming      "Upcoming"
 *  - check-in day … last day       → check_in_due  "Check-in due"
 *  - after the last day            → expired       "Expired" (never checked in)
 *  - completed (kiosk check-in)    → checked_in    "Checked in"
 * Dates are local days (YYYY-MM-DD); a reservation without check-out is a
 * single day. `today` is the local YYYY-MM-DD (isoDay()).
 */
import type { Booking } from '@/types/domain';

/** The reservation's last day (check-out, else the check-in day). */
export const lastDayOf = (b: Pick<Booking, 'checkIn' | 'checkOut'>) => (b.checkOut || b.checkIn || '').slice(0, 10);

/** The booking with an "upcoming" status the dates have overtaken turned
 *  "expired" — so a past reservation leaves Upcoming and can't be edited. */
export function withLiveStatus<B extends Pick<Booking, 'status' | 'checkIn' | 'checkOut'>>(b: B, today: string): B {
  if (b.status !== 'upcoming') return b;
  const last = lastDayOf(b);
  return last && last < today ? { ...b, status: 'expired' } : b;
}

/** The status the badge shows (a key of the premium STATUS table). */
export function bookingDisplayStatus(b: Pick<Booking, 'status' | 'checkIn' | 'checkOut'>, today: string): string {
  const live = withLiveStatus(b, today).status;
  if (live === 'completed') return 'checked_in';
  if (live === 'upcoming' && (b.checkIn || '').slice(0, 10) <= today) return 'check_in_due';
  return live;
}
