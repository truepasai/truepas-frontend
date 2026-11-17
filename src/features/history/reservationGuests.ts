/**
 * Who can be added to or taken off a reservation, and the one reservation per
 * venue and day — pure (no React Native), so it runs under `node --test`
 * (src/features/history/__tests__). customer-account-service enforces every
 * rule here; this only decides what the app offers and how it explains it.
 *
 *  - A customer has one reservation with a venue (merchant) on any day: a
 *    second one is refused (RESERVATION_ALREADY_EXISTS) and the customer is
 *    sent to the one they have, to add family members there.
 *  - Family members can be added to a reservation until its dates pass, also
 *    after someone on it checked in; each then checks in for themselves.
 *  - Family members can be taken off it until the account holder has checked
 *    in on it, even after one of them checked in (their check-in stays);
 *    once the holder has, nobody can be (GUEST_REMOVAL_LOCKED). Adding stays
 *    open. The reservation itself can't be deleted once anyone checked in.
 */
import type { Booking, UpdateReservationRequest } from '@/types/domain';

export const RESERVATION_EXISTS = 'RESERVATION_ALREADY_EXISTS';
export const GUEST_REMOVAL_LOCKED = 'GUEST_REMOVAL_LOCKED';

export const REMOVAL_LOCKED_MESSAGE =
  "You've already checked in on this reservation, so nobody can be removed from it. You can still add family members.";
export const SAME_DAY_MESSAGE =
  'You already have a reservation with this venue on these dates. Add family members to that reservation instead of making another one.';

const day = (value?: string | null) => (value ?? '').slice(0, 10);
const lastDayOf = (b: Pick<Booking, 'checkIn' | 'checkOut'>) => day(b.checkOut) || day(b.checkIn);
const isCheckIn = (row: Booking) => row.source === 'checkin' || (row.source == null && !!row.checkedInAt);

/** customer-account-service's "today somewhere": the UTC date one day back,
 *  so a reservation still open in a zone behind UTC is not closed early. The
 *  venue's kiosk decides the actual check-in day in the venue's own zone. */
export function earliestLocalToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Whether anyone on this reservation has completed a kiosk check-in: it
 *  reads completed once the first one links to it, and each later check-in
 *  names it (`linkedBookingId`) from its own row in the list. */
export function someoneCheckedIn(reservation: Booking, rows: (Booking | null | undefined)[]): boolean {
  if (reservation.source !== 'customer') return false;
  if (reservation.status === 'completed' || !!reservation.linkedBookingId) return true;
  return rows.some((row) => !!row && isCheckIn(row) && row.status === 'completed' && row.linkedBookingId === reservation.id);
}

/** Whether the account holder has completed a kiosk check-in on this
 *  reservation, which locks taking anyone off it: a completed check-in linked
 *  to it that names them (each names the one person it checked in). As on the
 *  server, one that names nobody, a completed reservation whose check-in
 *  isn't in `rows` yet, or a holder not known yet counts as theirs. */
export function holderCheckedIn(
  reservation: Booking,
  rows: (Booking | null | undefined)[],
  holderPersonId: string | null | undefined,
): boolean {
  if (reservation.source !== 'customer') return false;
  const linked = rows.filter(
    (row): row is Booking => !!row && isCheckIn(row) && row.status === 'completed' && row.linkedBookingId === reservation.id,
  );
  if ((reservation.status === 'completed' || !!reservation.linkedBookingId) && !linked.some((row) => row.id === reservation.linkedBookingId)) {
    return true;
  }
  return linked.some((row) => !holderPersonId || !row.checkedInMembers?.length || row.checkedInMembers.includes(holderPersonId));
}

/** The update that takes `personId` off the reservation and keeps everyone
 *  else (and the guest count). */
export function removeGuestPatch(onIt: string[], personId: string): UpdateReservationRequest {
  return { memberIds: onIt.filter((id) => id !== personId) };
}

/** Family members can be added while its dates have not passed, before or
 *  after a check-in. `today` defaults to the server's lenient day. */
export function canAddGuests(reservation: Booking, today: string = earliestLocalToday()): boolean {
  if (reservation.source !== 'customer') return false;
  if (reservation.status !== 'upcoming' && reservation.status !== 'completed') return false;
  return lastDayOf(reservation) >= today;
}

/** Who on the account is not on the reservation yet, in the order given. */
export function addablePeople<P extends { personId: string }>(onIt: string[], people: P[]): P[] {
  const taken = new Set(onIt);
  return people.filter((p) => !taken.has(p.personId));
}

/** The update that adds `added` to the people already on it: nobody is
 *  dropped, and the guest count never goes down (it is the people on it, or
 *  more if the reservation already counted more). */
export function addGuestsPatch(reservation: Pick<Booking, 'guests'>, onIt: string[], added: string[]): UpdateReservationRequest {
  const memberIds = [...new Set([...onIt, ...added])];
  return { memberIds, guests: Math.max(reservation.guests || 0, memberIds.length) };
}

/** People an edit would take off the reservation. */
export const removedFrom = (before: string[], after: string[]) => before.filter((id) => !after.includes(id));

/** The customer's reservation with `merchantId` that shares a day with
 *  `checkIn`..`checkOut` (inclusive, as the kiosk admits them), or null.
 *  Its id comes from the list: an open reservation listed as itself, or one a
 *  check-in completed, which the list shows as that check-in (its
 *  `linkedBookingId`) on the day of the check-in. */
export function sameDayReservation(
  rows: (Booking | null | undefined)[],
  { merchantId, checkIn, checkOut }: { merchantId?: string | null; checkIn: string; checkOut?: string | null },
): string | null {
  if (!merchantId || !checkIn) return null;
  const start = day(checkIn);
  const end = day(checkOut) || start;
  for (const row of rows) {
    if (!row || row.merchantId !== merchantId) continue;
    if (row.source === 'customer' && (row.status === 'upcoming' || row.status === 'completed')) {
      if (day(row.checkIn) <= end && lastDayOf(row) >= start) return row.id;
    } else if (isCheckIn(row) && row.status === 'completed' && row.linkedBookingId) {
      const on = day(row.checkIn);
      if (on >= start && on <= end) return row.linkedBookingId;
    }
  }
  return null;
}
