// Document sharing on a reservation and each person's real check-in.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHILD_DOCUMENT_AUTHORIZATION,
  GUARDIANSHIP_NOT_VERIFIED,
  RESERVATION_DOCUMENT_TERMS,
  TWIN_CONSENT_MESSAGE,
  TWIN_CONSENT_UNAVAILABLE,
  checkInLabel,
  checkInsOn,
  childConsentTerms,
  consentTerms,
  holderSharing,
  isChildMember,
  memberSharing,
  personCheckIn,
  releasesEveryone,
  sharingIntro,
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

  it("a child's document is their parent or guardian's decision, not yet taken", () => {
    assert.deepEqual(memberSharing(NIECE, []), {
      state: 'not_decided', label: "You haven't decided — not shared", shared: false, canDecide: true, child: true,
    });
    // Nothing is ever decided for them: someone else's decision never counts.
    assert.equal(memberSharing(NIECE, [{ personId: BROTHER.id, status: 'granted' }]).shared, false);
    assert.equal(memberSharing(undefined, []).canDecide, false);
  });

  it("only the child's own accepted decision shares their document", () => {
    const decided = (status) => memberSharing(NIECE, [{ personId: NIECE.id, status }]);
    assert.deepEqual([decided('granted').shared, decided('granted').label], [true, 'You share their document at their check-in']);
    for (const status of ['declined', 'withdrawn', 'ended', 'expired']) {
      assert.deepEqual([decided(status).shared, decided(status).canDecide, decided(status).child], [false, true, true], status);
    }
    assert.equal(decided('withdrawn').label, 'You withdrew consent — not shared');
  });

  it('each child is decided separately', () => {
    const sibling = { id: 'person-leo', age: 3 };
    const consents = [{ personId: NIECE.id, status: 'granted' }];
    assert.equal(memberSharing(NIECE, consents).shared, true);
    assert.equal(memberSharing(sibling, consents).shared, false);
  });

  it('a child twin is not asked; an earlier acceptance stays withdrawable', () => {
    const twin = { id: 'person-tia', age: 7, isTwin: true };
    assert.deepEqual([memberSharing(twin, []).state, memberSharing(twin, []).canDecide], ['twin', false]);
    assert.equal(memberSharing(twin, [{ personId: twin.id, status: 'granted' }]).canDecide, true);
  });

  it('a child is someone known to be under 18', () => {
    assert.deepEqual([0, 4, 17].map((age) => isChildMember({ age })), [true, true, true]);
    assert.deepEqual([18, 40, undefined, null, Number.NaN, -1].map((age) => isChildMember({ age })), [false, false, false, false, false, false]);
    assert.equal(isChildMember(undefined), false);
    // Of unknown age: nobody decides.
    assert.deepEqual([memberSharing({ id: 'x' }, []).state, memberSharing({ id: 'x' }, []).canDecide], ['minor', false]);
  });

  it("the child statement is the approved wording, and the refusal code is customer-account-service's", () => {
    assert.equal(
      CHILD_DOCUMENT_AUTHORIZATION,
      "I authorize TruePas to share my child's verified identity document with the venue for reservation check-in. I understand that the venue will receive the document through the TruePas platform for identity verification and check-in purposes.",
    );
    assert.equal(GUARDIANSHIP_NOT_VERIFIED, 'GUARDIANSHIP_NOT_VERIFIED');
  });

  it("the child terms name the child, the venue and the dates, and cover only the child's own document", () => {
    const terms = childConsentTerms({ venue: 'Taj Lands End', dates: 'Nov 2 – Nov 4', name: 'Mia' });
    assert.equal(terms.length, 6);
    assert.match(terms[0], /^What: Mia's own verified identity document/);
    assert.match(terms[0], /Never yours or anyone else's in its place/);
    assert.match(terms[1], /Taj Lands End/);
    assert.match(terms[2], /only when Mia checks in there on this reservation, between Nov 2 – Nov 4\. Never with anyone else's check-in/);
    assert.match(terms[4], /each child separately/);
    assert.match(terms[5], /withdrawn at any time/);
  });

  it('the sharing section explains the child decision wherever a child is going', () => {
    assert.match(sharingIntro({ venue: 'V', allPerson: false, anyShared: false, hasChild: true }), /For each child, you decide/);
    assert.doesNotMatch(sharingIntro({ venue: 'V', allPerson: false, anyShared: false, hasChild: true }), /still in force/);
    assert.match(sharingIntro({ venue: 'V', allPerson: false, anyShared: true, hasChild: false }), /still in force can be withdrawn/);
    assert.doesNotMatch(sharingIntro({ venue: 'V', allPerson: true, anyShared: false, hasChild: false }), /child/);
    assert.match(sharingIntro({ venue: 'V', allPerson: true, anyShared: false, hasChild: true }), /others who consented themselves.*For each child/);
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
    assert.match(terms[4], /a parent or guardian decides separately for each child/);
    assert.doesNotMatch(terms.join(' '), /never shared/);
    assert.match(terms[4], /a face scan at the kiosk is never consent/);
    assert.match(terms[5], /withdrawn at any time/);
    assert.match(consentTerms({ venue: 'V', dates: 'D' })[0], /^What: Your own/);
    assert.equal(RESERVATION_DOCUMENT_TERMS, 'reservation-documents-2026-11');
  });
});
