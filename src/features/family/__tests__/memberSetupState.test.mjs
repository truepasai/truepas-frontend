// A family member's setup state: a pending profile is never shown as verified,
// and an under-5 member without a face can still add a birth certificate.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isMemberFaceDone, memberCaptureMode, memberSetupBadge, offersBirthCertificateInstead } from '../memberSetupState.ts';

// Records as customer-account-service returns them (_family_member).
const toddler = (overrides = {}) => ({
  id: 'person-mia', age: 3, ageBand: '0-4', faceCaptureMode: 'photo', faceEnrolled: false, verification: 'pending_document', ...overrides,
});
const badge = (member, { docDone = false, pinNeeded = false, checking = false } = {}) =>
  memberSetupBadge({ faceDone: isMemberFaceDone(member), docDone, pinNeeded, checking }).label;

describe('a profile saved before its photo', () => {
  it('is "Face pending", never verified', () => {
    const saved = toddler();
    assert.equal(isMemberFaceDone(saved), false);
    assert.equal(badge(saved), 'Face pending');
  });

  it('stays "Face pending" with a verified birth certificate (the account keeps check-in frozen)', () => {
    // A dependant's document verified without a face becomes pending_face, not active.
    const withCertificate = toddler({ verification: 'pending_face' });
    assert.equal(isMemberFaceDone(withCertificate), false);
    assert.equal(badge(withCertificate, { docDone: true }), 'Face pending');
  });

  it('is verified only with the face and the document', () => {
    const enrolled = toddler({ faceEnrolled: true });
    assert.equal(badge(enrolled), 'Document needed');
    assert.equal(badge(enrolled, { docDone: true }), 'Verified');
    assert.equal(badge(toddler({ faceEnrolled: true, verification: 'verified' }), { docDone: true }), 'Verified');
  });
});

describe('the birth-certificate route', () => {
  it('is offered for an under-5 member whose photo is pending', () => {
    assert.equal(memberCaptureMode(toddler()), 'photo');
    assert.equal(offersBirthCertificateInstead(toddler(), { docDone: false }), true);
  });

  it('is not offered once a document is done, or once the face is', () => {
    assert.equal(offersBirthCertificateInstead(toddler({ verification: 'pending_face' }), { docDone: true }), false);
    assert.equal(offersBirthCertificateInstead(toddler({ faceEnrolled: true }), { docDone: false }), false);
  });

  it('is not how members of 5 and over set up (they use liveness)', () => {
    const seven = { age: 7, faceCaptureMode: 'liveness', faceEnrolled: false, verification: 'pending_document' };
    assert.equal(offersBirthCertificateInstead(seven, { docDone: false }), false);
    assert.equal(memberCaptureMode({ age: 7 }), 'liveness');
    assert.equal(memberCaptureMode({ age: 4 }), 'photo');
  });
});

describe('leaving the photo step keeps the new member', () => {
  // Source guard: the screens can't be rendered under node --test, so this
  // pins the wiring that decides whether leaving deletes a new member.
  const route = readFileSync(new URL('../../../app/family/add/photo-capture.tsx', import.meta.url), 'utf8');
  const camera = readFileSync(new URL('../../../premium/flows/familyPhotoCapture.tsx', import.meta.url), 'utf8');

  it('the photo route no longer removes a new member when it unmounts', () => {
    assert.equal(/useDiscardNewMemberOnLeave/.test(route), false);
  });

  it('the camera removes one only through the confirmed "Cancel adding", gated on the phase', () => {
    assert.equal((camera.match(/removeMember\.mutateAsync\(/g) ?? []).length, 1);
    assert.match(camera, /const cancelAdding = async \(\) => \{\s*if \(!personId \|\| !canCancelNewMember\(phase\)\) return;/);
    assert.match(camera, /onConfirm=\{\(\) => void cancelAdding\(\)\}/);
  });

  it('offers the birth certificate from the photo step', () => {
    assert.match(camera, /prefer: 'birthCertificate'/);
  });
});
