// A family member's setup state: a pending profile is never shown as verified,
// and an under-5 member without a face can still add a birth certificate.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  PHOTO_ENROLLMENT_UNDER_AGE,
  isMemberFaceDone,
  memberCaptureMode,
  memberSetupBadge,
  offersBirthCertificateInstead,
} from '../memberSetupState.ts';

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

  it('is offered to a photo-enrolled 4-year-old too', () => {
    const four = { age: 4, faceCaptureMode: 'photo', faceEnrolled: false, verification: 'pending_document' };
    assert.equal(offersBirthCertificateInstead(four, { docDone: false }), true);
  });

  it('is not how members of 5 and over set up (they use liveness)', () => {
    for (const age of [5, 9, 12]) {
      const member = { age, faceCaptureMode: 'liveness', faceEnrolled: false, verification: 'pending_document' };
      assert.equal(offersBirthCertificateInstead(member, { docDone: false }), false);
    }
  });
});

describe('the capture mode: one photo under 5, liveness from 5', () => {
  it('sends a 2-year-old and a 4-year-old to the photo step', () => {
    assert.equal(PHOTO_ENROLLMENT_UNDER_AGE, 5);
    assert.equal(memberCaptureMode({ age: 2 }), 'photo');
    assert.equal(memberCaptureMode({ age: 4 }), 'photo');
    assert.equal(memberCaptureMode(null, 3), 'photo');
  });

  it('keeps 5 and over on liveness', () => {
    for (const age of [5, 9, 10, 17, 40]) assert.equal(memberCaptureMode({ age }), 'liveness');
    assert.equal(memberCaptureMode(null, 5), 'liveness');
  });

  it("follows the server's faceCaptureMode over the app's own rule", () => {
    assert.equal(memberCaptureMode({ age: 3, faceCaptureMode: 'liveness' }), 'liveness');
    assert.equal(memberCaptureMode({ age: 12, faceCaptureMode: 'photo' }), 'photo');
  });

  it('uses liveness when the age is unknown', () => {
    assert.equal(memberCaptureMode(null), 'liveness');
    assert.equal(memberCaptureMode({ age: Number.NaN }), 'liveness');
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

  it('the photo step offers no way on without the photo; the member page keeps birth certificate first', () => {
    const code = camera.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /Continue without photo|continueWithoutPhoto|prefer: 'birthCertificate'/);
    const memberPage = readFileSync(new URL('../../../app/family/[id].tsx', import.meta.url), 'utf8');
    assert.match(memberPage, /const birthCertificateInstead = !!m && offersBirthCertificateInstead\(m, setup\);/);
    assert.match(memberPage, /pathname: '\/family\/add\/document',\s*params: \{ personId: id, name: first, age: String\(m\.age\), band: m\.ageBand, prefer: 'birthCertificate' \}/);
  });
});
