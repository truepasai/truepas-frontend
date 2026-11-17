/** Only people with their own verified ID can be chosen for a reservation
 *  (reservationDraft.ts), in the create/edit form and on "Add family
 *  members"; the server checks it again (MEMBER_DOCUMENT_NOT_VERIFIED).
 *  Synthetic ids. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MEMBER_DOCUMENT_NOT_VERIFIED,
  MEMBER_NOT_VERIFIED,
  MEMBER_VERIFICATION_FAILED,
  SELF_NOT_VERIFIED,
  choosable,
  memberNotVerified,
  reservationPeople,
} from '../reservationDraft.ts';

const member = (id, verification, over = {}) => ({
  id, name: `Member ${id}`, relationship: 'Child', age: 9, ageBand: '5-17', verification,
  turning18Soon: false, faceEnrolled: verification === 'verified', ...over,
});
const self = (documentVerified) => ({ personId: 'parent', name: 'Parent Example', documentVerified });

describe('who qualifies', () => {
  it('counts only their own verified ID: verified, or verified with the face still to add', () => {
    assert.equal(memberNotVerified('verified'), null);
    assert.equal(memberNotVerified('pending_face'), null);
  });

  it('never a pending, failed, rejected or expired ID, or none at all', () => {
    assert.equal(memberNotVerified('pending_document'), MEMBER_NOT_VERIFIED); // none added, or one still being checked
    assert.equal(memberNotVerified('verification_failed'), MEMBER_VERIFICATION_FAILED); // failed, rejected or expired
    assert.equal(memberNotVerified(undefined), MEMBER_NOT_VERIFIED);
    assert.equal(memberNotVerified('pending_liveness'), MEMBER_NOT_VERIFIED); // anything unknown: not verified
  });

  it("a verified parent never qualifies an unverified child", () => {
    const people = reservationPeople(self(true), [member('child', 'pending_document')]);
    assert.deepEqual(people.map((p) => [p.personId, p.notVerified]), [['parent', null], ['child', MEMBER_NOT_VERIFIED]]);
  });

  it('an unverified holder is marked too; one still loading is left to the server', () => {
    assert.equal(reservationPeople(self(false), [])[0].notVerified, SELF_NOT_VERIFIED);
    assert.equal(reservationPeople(self(null), [])[0].notVerified, null);
    assert.equal(reservationPeople(self(undefined), [])[0].notVerified, null);
  });

  it('several independently verified members all qualify, each with their own id', () => {
    const people = reservationPeople(self(true), [member('spouse', 'verified'), member('son', 'pending_face'), member('baby', 'verification_failed')]);
    assert.deepEqual(people.filter((p) => choosable(p, [])).map((p) => p.personId), ['parent', 'spouse', 'son']);
  });

  it('someone already on the reservation stays choosable, whatever their ID says now', () => {
    const [, child] = reservationPeople(self(true), [member('child', 'verification_failed')]);
    assert.equal(choosable(child, []), false);
    assert.equal(choosable(child, ['child']), true);
  });
});

describe('the screens', () => {
  const form = readFileSync(new URL('../ReservationForm.tsx', import.meta.url), 'utf8');
  const addGuests = readFileSync(new URL('../../../app/booking/[id]/add-guests.tsx', import.meta.url), 'utf8');
  const create = readFileSync(new URL('../../../app/booking/new.tsx', import.meta.url), 'utf8');
  const edit = readFileSync(new URL('../../../app/booking/[id]/edit.tsx', import.meta.url), 'utf8');

  it('the form cannot tick someone without a verified ID, unless already on it, and says why', () => {
    assert.match(form, /kept=\{initial\.memberIds\}/);
    assert.match(form, /const blocked = !on && !choosable\(p, kept\);/);
    assert.match(form, /disabled=\{blocked\}/);
    assert.match(form, /const detail = blocked \? p\.notVerified : p\.detail;/);
  });

  it('"Add family members" cannot tick them either', () => {
    assert.match(addGuests, /const blocked = !on && !choosable\(p, \[\]\);/);
    assert.match(addGuests, /disabled=\{blocked\}/);
  });

  it("every screen tells the form whether the holder's own ID is verified", () => {
    for (const screen of [create, edit, addGuests]) {
      assert.match(screen, /useIdentitySummary\(\)/);
      assert.match(screen, /documentVerified: identity\.data \? identity\.data\.status === 'verified' : null/);
    }
  });

  it("the server's refusal is shown under the picker and reloads the family", () => {
    assert.equal(MEMBER_DOCUMENT_NOT_VERIFIED, 'MEMBER_DOCUMENT_NOT_VERIFIED');
    assert.match(form, /memberIds: 'memberIds'/); // errors.memberIds → the people step
    assert.match(form, /err\.serverCode === MEMBER_DOCUMENT_NOT_VERIFIED\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*familyState\.retry\(\);/);
    assert.match(addGuests, /err\.serverCode === MEMBER_DOCUMENT_NOT_VERIFIED\) retryFamily\(\);/);
  });
});
