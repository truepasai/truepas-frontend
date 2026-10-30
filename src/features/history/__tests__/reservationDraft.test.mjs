// Reservation form logic: who can go, selection, guest count and what is sent.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_DRAFT,
  draftFromBooking,
  guestsFor,
  holderConsentOn,
  knownMemberIds,
  membersKnown,
  personName,
  reservationPeople,
  toCreate,
  toPatch,
  toggleMember,
  validate,
  withHolderConsent,
} from '../reservationDraft.ts';

const TODAY = '2026-10-26';
// GET /user/me: `id` is the account, `personId` the holder as a person.
const ME = { id: 'account-1', personId: 'person-self', fullName: 'Sarah Kim' };
const SELF = { personId: ME.personId, name: ME.fullName };
const MAYA = { id: 'person-maya', name: 'Maya Example', relationship: 'Daughter' };
const NOAH = { id: 'person-noah', name: 'Noah Example', relationship: 'Son' };

const draft = (overrides = {}) => ({
  ...EMPTY_DRAFT,
  venue: 'Hilton Garden Inn',
  merchantId: 'merchant-1',
  locationId: 'location-1',
  location: 'Downtown',
  checkIn: '2026-11-02',
  ...overrides,
});

const reservation = (overrides = {}) => ({
  id: 'res-1', source: 'customer', status: 'upcoming', type: 'reservation', venue: 'Hilton Garden Inn',
  location: 'Downtown', locationId: 'location-1', merchantId: 'merchant-1', checkIn: '2026-11-02', checkOut: null,
  guests: 2, image: null, amount: null, notes: null, checkedInMembers: [ME.personId, MAYA.id], ...overrides,
});

describe('who can go', () => {
  it('an account with no dependants offers only you, by your person id', () => {
    const people = reservationPeople(SELF, []);
    assert.deepEqual(people, [{ personId: 'person-self', name: 'You', detail: 'Sarah Kim', self: true }]);
    assert.ok(!people.some((p) => p.personId === ME.id), 'the account id is never a person');
  });

  it('an account with several dependants offers you and each of them by their actual name', () => {
    const people = reservationPeople(SELF, [MAYA, NOAH]);
    assert.deepEqual(people.map((p) => [p.personId, p.name, p.detail]), [
      ['person-self', 'You', 'Sarah Kim'],
      ['person-maya', 'Maya Example', 'Daughter'],
      ['person-noah', 'Noah Example', 'Son'],
    ]);
  });

  it('family is still offered while /user/me is unknown, and odd rows are skipped', () => {
    const people = reservationPeople(null, [MAYA, { id: '', name: 'No Id' }, { id: 'x', name: '  ' }, MAYA, { ...SELF, id: 'person-self', name: 'Sarah Kim' }]);
    assert.deepEqual(people.map((p) => p.personId), ['person-maya', 'person-self']);
    const withSelf = reservationPeople(SELF, [{ id: 'person-self', name: 'Sarah Kim' }, NOAH]);
    assert.deepEqual(withSelf.map((p) => p.name), ['You', 'Noah Example']); // the holder once, as You
  });

  it('names chosen people for the review, never printing a raw id', () => {
    const people = reservationPeople(SELF, [MAYA]);
    assert.equal(personName('person-self', people), 'You');
    assert.equal(personName('person-maya', people), 'Maya Example');
    assert.equal(personName('person-gone', people), 'Family member');
  });
});

describe('selecting', () => {
  it('selects and deselects each person; the guest count is exactly the people chosen', () => {
    let d = draft();
    d = { ...d, memberIds: toggleMember(d.memberIds, 'person-self') };
    d = { ...d, memberIds: toggleMember(d.memberIds, 'person-maya') };
    d = { ...d, memberIds: toggleMember(d.memberIds, 'person-noah') };
    assert.deepEqual(d.memberIds, ['person-self', 'person-maya', 'person-noah']);
    assert.equal(guestsFor(d), 3);
    d = { ...d, memberIds: toggleMember(d.memberIds, 'person-maya') };
    assert.deepEqual(d.memberIds, ['person-self', 'person-noah']);
    assert.equal(guestsFor(d), 2);
  });

  it('a stored guest count never implies unnamed people once someone is chosen', () => {
    assert.equal(guestsFor(draft({ guests: 2, memberIds: ['person-self'] })), 1);
  });

  it("nobody chosen is an error on the who's-going step", () => {
    assert.equal(validate(draft(), TODAY).memberIds, "Choose who's going");
    assert.equal(validate(draft({ memberIds: ['person-self'] }), TODAY).memberIds, undefined);
  });
});

describe('what is sent', () => {
  it('creating sends the chosen person ids as memberIds, with the guests they make', () => {
    const payload = toCreate(draft({ memberIds: ['person-self', 'person-maya'], guests: 1 }));
    assert.deepEqual(payload.memberIds, ['person-self', 'person-maya']);
    assert.equal(payload.guests, 2);
    assert.equal(payload.merchantId, 'merchant-1');
    assert.equal(payload.locationId, 'location-1');
  });

  it('an account with no dependants creates a reservation for you alone', () => {
    const payload = toCreate(draft({ memberIds: ['person-self'] }));
    assert.deepEqual([payload.memberIds, payload.guests], [['person-self'], 1]);
  });

  it('editing sends memberIds and guests only when who is going changed', () => {
    const original = draftFromBooking(reservation(), 'hotel', [MAYA], ME.personId);
    assert.deepEqual(toPatch({ ...original }, original), {});
    const withNoah = { ...original, memberIds: toggleMember(original.memberIds, 'person-noah') };
    assert.deepEqual(toPatch(withNoah, original), { memberIds: ['person-self', 'person-maya', 'person-noah'], guests: 3 });
    const withoutMaya = { ...original, memberIds: toggleMember(original.memberIds, 'person-maya') };
    assert.deepEqual(toPatch(withoutMaya, original), { memberIds: ['person-self'], guests: 1 });
  });

  it('a stored guest count that disagrees with the people on it is corrected', () => {
    const original = draftFromBooking(reservation({ guests: 4 }), 'hotel', [MAYA], ME.personId);
    assert.deepEqual(toPatch({ ...original, checkIn: '2026-11-03' }, original), { checkIn: '2026-11-03', guests: 2 });
  });
});

describe('editing an existing reservation', () => {
  it("keeps who's going even when the family list failed to load (nothing is dropped)", () => {
    const original = draftFromBooking(reservation(), 'hotel', [], ME.personId);
    assert.deepEqual(original.memberIds, ['person-self', 'person-maya']);
    // Choosing Noah later still sends Maya: she is not silently removed.
    assert.deepEqual(toPatch({ ...original, memberIds: [...original.memberIds, 'person-noah'] }, original).memberIds,
      ['person-self', 'person-maya', 'person-noah']);
  });

  it("a reservation that never recorded who's going is left alone unless changed", () => {
    const b = reservation({ checkedInMembers: null, guests: 3 });
    assert.equal(membersKnown(b, [MAYA], ME.personId), false);
    const original = draftFromBooking(b, 'hotel', [MAYA], ME.personId);
    assert.deepEqual(validate(original, TODAY, original, true), {});
    assert.deepEqual(toPatch({ ...original }, original), {});
    assert.equal(validate({ ...original, memberIds: [] }, TODAY, original, false).memberIds, "Choose who's going");
  });

  it('older check-in rows that list names keep only known people', () => {
    const b = reservation({ source: 'checkin', checkedInMembers: ['Sarah Kim', 'person-maya', ME.personId] });
    assert.deepEqual(knownMemberIds(b, [MAYA], ME.personId), ['person-maya', 'person-self']);
  });
});

describe("the holder's own document consent", () => {
  const choice = (d, offered = true) => ({ offered, on: holderConsentOn(d, ME.personId) });

  it('is off by default and never sent unless offered and turned on', () => {
    const d = draft({ memberIds: [ME.personId, MAYA.id] });
    assert.equal(holderConsentOn(d, ME.personId), false);
    assert.equal('documentReleaseConsent' in toCreate(d, choice(d)), false);
    const on = withHolderConsent(d, true);
    assert.equal(toCreate(on, choice(on)).documentReleaseConsent, true);
    // Not offered (a venue releasing only the scanned guest): nothing is sent.
    assert.equal('documentReleaseConsent' in toCreate(on, choice(on, false)), false);
  });

  it('covers only the holder: it needs the holder selected and never mentions anyone else', () => {
    const on = withHolderConsent(draft({ memberIds: [ME.personId, MAYA.id] }), true);
    const holderLeft = { ...on, memberIds: [MAYA.id] };
    assert.equal(holderConsentOn(holderLeft, ME.personId), false);
    assert.equal('documentReleaseConsent' in toCreate(holderLeft, choice(holderLeft)), false);
    assert.deepEqual(Object.keys(toCreate(on, choice(on))).filter((k) => /consent/i.test(k)), ['documentReleaseConsent']);
  });

  it('an existing consent opens on, and turning it off withdraws it', () => {
    const original = draftFromBooking(reservation({ documentReleaseConsent: true }), 'cruise', [MAYA], ME.personId);
    assert.equal(holderConsentOn(original, ME.personId), true);
    assert.deepEqual(toPatch({ ...original }, original, choice(original)), {});
    const off = withHolderConsent(original, false);
    assert.deepEqual(toPatch(off, original, choice(off)), { documentReleaseConsent: false });
    // Withdrawing is possible even where it would no longer be offered.
    assert.deepEqual(toPatch(off, original, choice(off, false)), { documentReleaseConsent: false });
  });

  it('consenting later on an existing reservation sends it', () => {
    const original = draftFromBooking(reservation(), 'cruise', [MAYA], ME.personId);
    const on = withHolderConsent(original, true);
    assert.deepEqual(toPatch(on, original, choice(on)), { documentReleaseConsent: true });
  });

  it('other dates or another venue show it off until confirmed again, and going back restores it', () => {
    const original = draftFromBooking(reservation({ documentReleaseConsent: true }), 'cruise', [MAYA], ME.personId);
    const moved = { ...original, checkIn: '2026-11-05' };
    assert.equal(holderConsentOn(moved, ME.personId), false);
    // Not re-confirmed: nothing about consent is sent (it ends upstream).
    assert.deepEqual(toPatch(moved, original, choice(moved)), { checkIn: '2026-11-05' });
    const confirmed = withHolderConsent(moved, true);
    assert.deepEqual(toPatch(confirmed, original, choice(confirmed)), { checkIn: '2026-11-05', documentReleaseConsent: true });
    // Back to the original dates: still on, nothing withdrawn by accident.
    const back = { ...moved, checkIn: original.checkIn };
    assert.equal(holderConsentOn(back, ME.personId), true);
    assert.deepEqual(toPatch(back, original, choice(back)), {});
    const otherVenue = { ...original, merchantId: 'merchant-2', venue: 'Other', locationId: 'location-9' };
    assert.equal(holderConsentOn(otherVenue, ME.personId), false);
  });

  it('a policy that could not be read changes nothing', () => {
    const original = draftFromBooking(reservation({ documentReleaseConsent: true }), 'cruise', [MAYA], ME.personId);
    assert.deepEqual(toPatch({ ...original, notes: 'Window seat' }, original, choice(original, false)), { notes: 'Window seat' });
    assert.deepEqual(toPatch({ ...original, notes: 'Window seat' }, original), { notes: 'Window seat' });
  });
});
