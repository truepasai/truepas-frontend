// The parent's one-checkbox consent before an under-5 child's photo enrolment.
// Run: npm test   (node --test; Node 22.6+ imports the .ts modules directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NO_MOCK_FALLBACK } from '../../../api/fallbackPolicy.ts';
import {
  CHILD_PHOTO_CONSENT_NOTICE_VERSION,
  CHILD_PHOTO_CONSENT_TEXT,
  childPhotoConsentNotice,
  consentIsActive,
  isConsentRequired,
} from '../photoConsent.ts';

describe('the photo consent', () => {
  it('is the parent confirming who they are and what the photo is for', () => {
    assert.match(CHILD_PHOTO_CONSENT_TEXT, /^I confirm that I am this child's parent or lawful guardian\./);
    assert.match(CHILD_PHOTO_CONSENT_TEXT, /child identification during check-in\.$/);
  });

  it('explains collection, use, storage, retention and withdrawal, and invents no period', () => {
    const notice = childPhotoConsentNotice('Mia');
    assert.deepEqual(notice.map((s) => s.heading), ['What is collected', 'How it is used', 'Where it is kept', 'How long', 'Withdrawing']);
    assert.match(notice[1].body, /never used for AI training, profiling or marketing/);
    assert.doesNotMatch(notice.find((s) => s.heading === 'How long').body, /\d/);
  });

  it('counts only an active answer for the notice this app shows', () => {
    assert.equal(consentIsActive({ active: true, noticeVersion: CHILD_PHOTO_CONSENT_NOTICE_VERSION }), true);
    assert.equal(consentIsActive({ active: true, noticeVersion: 'child-photo-enrolment-old' }), false);
    assert.equal(consentIsActive({ active: false }), false);
    assert.equal(consentIsActive(undefined), false);
  });

  it("recognises the server's consent refusal in either error shape", () => {
    assert.equal(isConsentRequired({ serverCode: 'GUARDIAN_CONSENT_REQUIRED' }), true);
    assert.equal(isConsentRequired({ response: { data: { code: 'GUARDIAN_CONSENT_REQUIRED' } } }), true);
    assert.equal(isConsentRequired({ serverCode: 'FACE_ALREADY_ENROLLED' }), false);
  });

  it('is never answered from mock data when the server is down', () => {
    for (const key of ['getMemberPhotoConsent', 'giveMemberPhotoConsent', 'withdrawMemberPhotoConsent']) {
      assert.ok(NO_MOCK_FALLBACK.has(key), key);
    }
  });
});
