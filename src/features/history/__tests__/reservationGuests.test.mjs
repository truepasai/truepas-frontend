/** One reservation per venue and day, family members added to it (also after
 *  a check-in), taken off only until the account holder has checked in on it,
 *  never deleted once anyone has (reservationGuests.ts), and the screens that
 *  offer it. Synthetic ids. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addablePeople,
  addGuestsPatch,
  canAddGuests,
  earliestLocalToday,
  holderCheckedIn,
  removeGuestPatch,
  removedFrom,
  sameDayReservation,
  someoneCheckedIn,
} from '../reservationGuests.ts';

const reservation = (over = {}) => ({
  id: 'res-1', source: 'customer', status: 'upcoming', merchantId: 'm-1', venue: 'Harbour Cruise',
  checkIn: '2026-11-14', checkOut: null, guests: 1, checkedInMembers: ['parent'], linkedBookingId: null, ...over,
});
const checkIn = (over = {}) => ({
  id: 'checkin-1', source: 'checkin', status: 'completed', merchantId: 'm-1', checkIn: '2026-11-14',
  checkedInAt: '2026-11-14T12:46:53Z', checkedInMembers: ['parent'], linkedBookingId: 'res-1', ...over,
});

describe('someoneCheckedIn', () => {
  it('is false before any check-in', () => {
    assert.equal(someoneCheckedIn(reservation(), []), false);
  });
  it('is true once the reservation reads completed', () => {
    assert.equal(someoneCheckedIn(reservation({ status: 'completed', linkedBookingId: 'checkin-1' }), []), true);
  });
  it('is true from a completed check-in naming it before the reservation itself reads completed', () => {
    assert.equal(someoneCheckedIn(reservation(), [checkIn()]), true);
  });
  it('ignores failed check-ins and check-ins of other reservations', () => {
    assert.equal(someoneCheckedIn(reservation(), [checkIn({ status: 'failed' }), checkIn({ linkedBookingId: 'res-2' })]), false);
  });
  it('a child checking in locks it as well as an adult', () => {
    assert.equal(someoneCheckedIn(reservation(), [checkIn({ checkedInMembers: ['child'] })]), true);
  });
});

describe('holderCheckedIn: what locks taking people off', () => {
  const completed = (over = {}) => reservation({ status: 'completed', linkedBookingId: 'checkin-1', ...over });
  it('is false before any check-in', () => {
    assert.equal(holderCheckedIn(reservation(), [], 'parent'), false);
  });
  it("a family member's check-in alone does not lock it", () => {
    assert.equal(holderCheckedIn(completed(), [checkIn({ checkedInMembers: ['child'] })], 'parent'), false);
    assert.equal(holderCheckedIn(reservation(), [checkIn({ checkedInMembers: ['child'] })], 'parent'), false);
  });
  it("the holder's own check-in locks it, on any day of it and before the reservation reads completed", () => {
    assert.equal(holderCheckedIn(completed(), [checkIn({ checkedInMembers: ['child'] }), checkIn({ id: 'checkin-2' })], 'parent'), true);
    assert.equal(holderCheckedIn(reservation(), [checkIn()], 'parent'), true);
  });
  it('counts what it cannot attribute as the holder\'s, as the server does', () => {
    assert.equal(holderCheckedIn(completed(), [checkIn({ checkedInMembers: [] })], 'parent'), true);
    assert.equal(holderCheckedIn(completed(), [], 'parent'), true); // its check-in not loaded yet
    assert.equal(holderCheckedIn(completed(), [checkIn({ checkedInMembers: ['child'] })], undefined), true);
  });
  it('ignores failed check-ins, other reservations and kiosk rows themselves', () => {
    assert.equal(holderCheckedIn(reservation(), [checkIn({ status: 'failed' }), checkIn({ linkedBookingId: 'res-2' })], 'parent'), false);
    assert.equal(holderCheckedIn(checkIn(), [checkIn()], 'parent'), false);
  });
  it('removeGuestPatch takes one person off and keeps everyone else and the guest count', () => {
    assert.deepEqual(removeGuestPatch(['parent', 'child', 'spouse'], 'child'), { memberIds: ['parent', 'spouse'] });
  });
});

describe('canAddGuests', () => {
  it('is open on an upcoming reservation and after a check-in, until its dates pass', () => {
    assert.equal(canAddGuests(reservation(), '2026-11-14'), true);
    assert.equal(canAddGuests(reservation({ status: 'completed' }), '2026-11-14'), true);
    assert.equal(canAddGuests(reservation({ status: 'completed', checkOut: '2026-11-15' }), '2026-11-15'), true);
    assert.equal(canAddGuests(reservation({ status: 'completed' }), '2026-11-15'), false);
  });
  it('is closed for expired reservations, kiosk check-in rows and free-text bookings of others', () => {
    assert.equal(canAddGuests(reservation({ status: 'expired' }), '2026-11-01'), false);
    assert.equal(canAddGuests(checkIn(), '2026-11-01'), false);
  });
  it("uses the server's lenient day: one day behind UTC", () => {
    assert.equal(earliestLocalToday(new Date('2026-11-15T01:00:00Z')), '2026-11-14');
    assert.equal(canAddGuests(reservation(), earliestLocalToday(new Date('2026-11-15T01:00:00Z'))), true);
  });
});

describe('adding family members', () => {
  const people = [{ personId: 'parent' }, { personId: 'child' }, { personId: 'spouse' }];
  it('offers only people not on it yet', () => {
    assert.deepEqual(addablePeople(['parent'], people).map((p) => p.personId), ['child', 'spouse']);
  });
  it('keeps everyone on it and adds the picked people once', () => {
    assert.deepEqual(addGuestsPatch(reservation(), ['parent'], ['child', 'child']), { memberIds: ['parent', 'child'], guests: 2 });
  });
  it('never lowers the guest count', () => {
    assert.deepEqual(addGuestsPatch(reservation({ guests: 4 }), ['parent'], ['child']), { memberIds: ['parent', 'child'], guests: 4 });
  });
  it('removedFrom names who an edit would take off', () => {
    assert.deepEqual(removedFrom(['parent', 'child'], ['parent']), ['child']);
    assert.deepEqual(removedFrom(['parent'], ['parent', 'child']), []);
  });
});

describe('sameDayReservation: one per venue and day', () => {
  const draft = (over = {}) => ({ merchantId: 'm-1', checkIn: '2026-11-14', checkOut: '', ...over });
  it('finds an open reservation with the venue sharing a day', () => {
    assert.equal(sameDayReservation([reservation()], draft()), 'res-1');
    assert.equal(sameDayReservation([reservation({ checkIn: '2026-11-13', checkOut: '2026-11-15' })], draft()), 'res-1');
    assert.equal(sameDayReservation([reservation()], draft({ checkIn: '2026-11-12', checkOut: '2026-11-14' })), 'res-1');
  });
  it('finds a checked-in one through the check-in the list shows instead (the DEV case)', () => {
    // The list shows a completed reservation as its check-in row.
    assert.equal(sameDayReservation([checkIn()], draft()), 'res-1');
  });
  it('another venue, other days, or no venue at all is free', () => {
    assert.equal(sameDayReservation([reservation()], draft({ merchantId: 'm-2' })), null);
    assert.equal(sameDayReservation([reservation()], draft({ checkIn: '2026-11-15' })), null);
    assert.equal(sameDayReservation([reservation()], draft({ merchantId: null })), null);
    assert.equal(sameDayReservation([reservation({ status: 'expired' })], draft()), null);
    assert.equal(sameDayReservation([checkIn({ status: 'failed' })], draft()), null);
  });
});

const src = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('the screens', () => {
  it('the reservation locks removal on your own check-in and deletion on anyone\'s', () => {
    const screen = src('app/booking/[id].tsx');
    assert.match(screen, /removalLocked = isReservation && holderCheckedIn\(b, .*, selfPersonId\);/);
    assert.match(screen, /deleteLocked = isReservation && someoneCheckedIn\(b, /);
    assert.match(screen, /canAddGuests\(b\)/);
    assert.match(screen, /title="Add family members"/);
    assert.match(screen, /editable && !removalLocked && \(\s*<ListRow icon=\{Pencil\}/);
    assert.match(screen, /editable && !deleteLocked && \(\s*<ListRow icon=\{Trash2\} danger title="Delete reservation"/);
    assert.match(screen, /removalLocked && <Txt v="small">\{REMOVAL_LOCKED_MESSAGE\}<\/Txt>/);
  });
  it('the add screen adds, takes a family member off only until you checked in, and says why not after', () => {
    const screen = src('app/booking/[id]/add-guests.tsx');
    assert.match(screen, /addGuestsPatch\(b, onIt, picked\)/);
    assert.match(screen, /addablePeople\(onIt, people\)/);
    assert.match(screen, /const locked = holderCheckedIn\(b, rows, self\?\.personId\)/);
    assert.match(screen, /locked && <Banner tone="info" title="Nobody can be removed" body=\{REMOVAL_LOCKED_MESSAGE\}/);
    // Remove is offered only while unlocked, never for you, and always confirmed.
    assert.match(screen, /\{!locked && personId !== self\?\.personId && \(\s*<Button\s+label="Remove"/);
    assert.match(screen, /onPress=\{\(\) => setRemoving\(personId\)\}/);
    assert.match(screen, /<ConfirmSheet\s+visible=\{removing != null\}/);
    assert.match(screen, /removeGuestPatch\(onIt, personId\)/);
    assert.doesNotMatch(screen, /filter\(\(x\) => x !== personId\)\]/); // adding never drops someone on it
  });
  it('a refused edit after a check-in closes the form like an uneditable booking', () => {
    const screen = src('app/booking/[id]/edit.tsx');
    assert.match(screen, /code === 'BOOKING_NOT_EDITABLE' \|\| code === GUEST_REMOVAL_LOCKED/);
    assert.match(screen, /pathname: '\/booking\/\[id\]\/add-guests'/);
  });
  it('a second reservation for the day sends the customer to the one they have', () => {
    const form = src('features/history/ReservationForm.tsx');
    assert.match(form, /err\.serverCode === RESERVATION_EXISTS/);
    assert.match(form, /sameDayReservation\(bookings \?\? \[\], d\)/);
    assert.match(form, /label="Open your reservation"/);
    const create = src('app/booking/new.tsx');
    assert.match(create, /bookings=\{bookings\.data \?\? \[\]\}/);
    assert.match(create, /onOpenReservation=/);
  });
});
