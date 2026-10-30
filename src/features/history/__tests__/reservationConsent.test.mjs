// Document sharing on a reservation and each person's real check-in.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RESERVATION_DOCUMENT_TERMS,
  TWIN_CONSENT_MESSAGE,
  TWIN_CONSENT_UNAVAILABLE,
  checkInLabel,
  checkInsOn,
  consentTerms,
  holderSharing,
  memberSharing,
  personCheckIn,
  releasesEveryone,
} from '../reservationConsent.ts';

const TODAY = '2026-10-27';
const HOLDER = 'person-self';
const BROTHER = { id: 'person-arjun', age: 34 };
const NIECE = { id: 'person-mia', age: 9 };

const reservation = (overrides = {}) => ({
  id: 'res-1', source: 'customer', status: 'upcoming', type: 'reservation', venue: 'Royal Caribbean Cruise',
  location: 'Port of Miami', merchantId: 'merchant-cruise', checkIn: '2026-11-02', checkOut: '2026-11-09',
  guests: 3, image: null, amount: null, checkedInMembers: [HOLDER, BROTHER.id, NIECE.id], ...overrides,
});
const checkIn = (personId, overrides = {}) => ({
  id: `checkin-${personId}`, source: 'checkin', status: 'completed', type: 'checkin', venue: 'Royal Caribbean Cruise',
  location: 'Port of Miami', checkIn: '2026-11-02', checkOut: null, guests: 1, image: null, amount: null,
  checkedInMembers: [personId], checkedInAt: '2026-11-02T09:15:00Z', linkedBookingId: 'res-1', ...overrides,
});

describe("who's going is not who checked in", () => {
  it('selected people are not checked in until a kiosk check-in on this reservation names them', () => {
    const r = reservation();
    const none = checkInsOn(r, []);
    for (const personId of r.checkedInMembers) {
      assert.deepEqual(personCheckIn(personId, r, none, TODAY), { state: 'not_yet' });
    }
    assert.equal(checkInLabel(personCheckIn(HOLDER, r, none, TODAY)), 'Not checked in yet');
  });

  it('each person is checked in by their own check-in only', () => {
    const r = reservation({ status: 'completed', linkedBookingId: 'checkin-person-self' });
    const map = checkInsOn(r, [checkIn(HOLDER)]);
    assert.deepEqual(personCheckIn(HOLDER, r, map, '2026-11-02'), { state: 'checked_in', at: '2026-11-02T09:15:00Z' });
    // The brother was selected but has not checked in himself.
    assert.deepEqual(personCheckIn(BROTHER.id, r, map, '2026-11-02'), { state: 'not_yet' });
    const both = checkInsOn(r, [checkIn(HOLDER), checkIn(BROTHER.id, { id: 'checkin-2', checkedInAt: '2026-11-02T09:40:00Z' })]);
    assert.equal(personCheckIn(BROTHER.id, r, both, '2026-11-02').state, 'checked_in');
  });

  it('ignores failed check-ins, other reservations and reservations themselves', () => {
    const r = reservation();
    const map = checkInsOn(r, [
      checkIn(HOLDER, { status: 'failed' }),
      checkIn(BROTHER.id, { linkedBookingId: 'res-other' }),
      reservation({ id: 'res-2', linkedBookingId: 'res-1', status: 'completed' }),
      null,
    ]);
    assert.equal(map.size, 0);
  });

  it("after the last day, someone who never checked in didn't", () => {
    const r = reservation({ status: 'expired' });
    assert.equal(checkInLabel(personCheckIn(BROTHER.id, r, new Map(), '2026-11-10')), "Didn't check in");
    const done = reservation({ status: 'completed' });
    assert.equal(personCheckIn(BROTHER.id, done, new Map(), '2026-11-10').state, 'missed');
  });

  it('the earliest check-in counts when a person checked in on several days', () => {
    const r = reservation();
    const map = checkInsOn(r, [
      checkIn(HOLDER, { id: 'later', checkedInAt: '2026-11-03T08:00:00Z' }),
      checkIn(HOLDER, { id: 'first', checkedInAt: '2026-11-02T08:00:00Z' }),
    ]);
    assert.equal(map.get(HOLDER), '2026-11-02T08:00:00Z');
  });
});

describe('document sharing', () => {
  it('only an all_person_documents venue asks for consent', () => {
    assert.equal(releasesEveryone('all_person_documents'), true);
    for (const access of ['scanned_person_documents', undefined, null, 'ALL_PERSON_DOCUMENTS']) {
      assert.equal(releasesEveryone(access), false);
    }
  });

  it('an adult who never decided is not shared, and can be asked', () => {
    assert.deepEqual(memberSharing(BROTHER, []), {
      state: 'not_decided', label: "Hasn't decided — not shared", shared: false, canDecide: true,
    });
  });

  it("each adult's own latest decision is shown; only granted is shared", () => {
    const shared = (status) => memberSharing(BROTHER, [{ personId: BROTHER.id, status }]);
    assert.equal(shared('granted').shared, true);
    for (const status of ['declined', 'withdrawn', 'ended', 'expired']) {
      assert.equal(shared(status).shared, false, status);
      assert.equal(shared(status).canDecide, true, status);
    }
    assert.equal(shared('declined').label, 'Declined — not shared');
    // Another person's decision never counts for him.
    assert.equal(memberSharing(BROTHER, [{ personId: 'someone-else', status: 'granted' }]).shared, false);
  });

  it("a child's documents are never shared and nobody can consent for them", () => {
    const child = memberSharing(NIECE, [{ personId: NIECE.id, status: 'granted' }]);
    assert.deepEqual([child.state, child.shared, child.canDecide], ['minor', false, false]);
    assert.equal(memberSharing(undefined, []).canDecide, false);
  });

  it("a twin can't be asked: a face check can't tell twins apart", () => {
    const twin = { id: 'person-ravi', age: 34, isTwin: true };
    for (const consents of [[], [{ personId: twin.id, status: 'declined' }], [{ personId: twin.id, status: 'withdrawn' }]]) {
      const sharing = memberSharing(twin, consents);
      assert.deepEqual([sharing.state, sharing.shared, sharing.canDecide], ['twin', false, false]);
    }
    assert.match(memberSharing(twin, []).label, /^Twin/);
    // An earlier consent (from before they were tagged) can still be withdrawn.
    const earlier = memberSharing(twin, [{ personId: twin.id, status: 'granted' }]);
    assert.deepEqual([earlier.state, earlier.shared, earlier.canDecide], ['granted', true, true]);
  });

  it('someone who is not a twin is asked as before, twins in the family or not', () => {
    assert.equal(memberSharing({ ...BROTHER, isTwin: false }, []).canDecide, true);
    assert.equal(memberSharing(BROTHER, []).canDecide, true);
  });

  it("the twin refusal is customer-account-service's code and says why", () => {
    assert.equal(TWIN_CONSENT_UNAVAILABLE, 'TWIN_FACE_CONSENT_UNAVAILABLE');
    assert.match(TWIN_CONSENT_MESSAGE, /twins/);
  });

  it("the holder's switch covers only the holder", () => {
    assert.equal(holderSharing({ documentReleaseConsent: true }).label, 'You share your documents');
    assert.equal(holderSharing({}).shared, false);
    assert.equal(holderSharing({ documentReleaseConsent: true }).canDecide, false);
  });

  it('the terms say what, who, when, what never, whose, and how it ends', () => {
    const terms = consentTerms({ venue: 'Royal Caribbean Cruise', dates: 'Nov 2 – Nov 9', name: 'Arjun' });
    assert.equal(terms.length, 6);
    assert.match(terms[0], /^What: Arjun's own verified identity documents/);
    assert.match(terms[1], /Royal Caribbean Cruise/);
    assert.match(terms[2], /someone else selected on this reservation checks in there, between Nov 2 – Nov 9/);
    assert.match(terms[3], /face scan/);
    assert.match(terms[4], /Each adult on the reservation decides for themselves/);
    assert.match(terms[4], /a face scan at the kiosk is never consent/);
    assert.match(terms[5], /withdrawn at any time/);
    assert.match(consentTerms({ venue: 'V', dates: 'D' })[0], /^What: Your own/);
    assert.equal(RESERVATION_DOCUMENT_TERMS, 'reservation-documents-2026-10');
  });
});
