/** The parent's terms before an under-5 child's document (childDocumentConsent.ts)
 *  and the Add member form that shows them: only under 5, one unticked box,
 *  Continue needs the tick, nothing sent to the server. Synthetic names. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CHILD_DOCUMENT_CONSENT_MISSING,
  CHILD_DOCUMENT_CONSENT_TEXT,
  CHILD_DOCUMENT_CONSENT_UNDER_AGE,
  childDocumentConsentTerms,
  needsChildDocumentConsent,
} from '../childDocumentConsent.ts';
import { PHOTO_ENROLLMENT_UNDER_AGE } from '../memberSetupState.ts';

describe('needsChildDocumentConsent: under 5 only', () => {
  it('applies from birth to 4', () => {
    for (const age of [0, 1, 2, 3, 4]) assert.equal(needsChildDocumentConsent(age), true, String(age));
  });
  it('never from 5, and never without a known age', () => {
    for (const age of [5, 6, 9, 17, 18, 40, -1, NaN, undefined, null]) {
      assert.equal(needsChildDocumentConsent(age), false, String(age));
    }
  });
  it('uses the same cut-off as the photo enrolment', () => {
    assert.equal(CHILD_DOCUMENT_CONSENT_UNDER_AGE, PHOTO_ENROLLMENT_UNDER_AGE);
  });
});

describe('the terms', () => {
  it("name the child and say what the venue receives", () => {
    const text = childDocumentConsentTerms('Mira').map((t) => `${t.heading} ${t.body}`).join(' ');
    assert.match(text, /Mira's identity document/);
    assert.match(text, /that venue receives Mira's document/);
    assert.match(text, /encrypted storage/);
  });
  it('read sensibly before a name is typed', () => {
    assert.match(childDocumentConsentTerms('').map((t) => t.body).join(' '), /your child's identity document/);
  });
  it('ask for no evidence', () => {
    const text = [CHILD_DOCUMENT_CONSENT_TEXT, ...childDocumentConsentTerms('Mira').map((t) => t.body)].join(' ');
    assert.doesNotMatch(text, /evidence|upload proof|reviewer/i);
  });
});

const form = readFileSync(new URL('../../../app/family/add/index.tsx', import.meta.url), 'utf8');

describe('the Add member form', () => {
  it('shows the terms only once the date of birth makes them under 5', () => {
    assert.match(form, /const underFive = !!dob && needsChildDocumentConsent\(ageFromDob\(dob\)\);/);
    assert.match(form, /\{underFive \? \(\s*<Card>/);
  });
  it('starts unticked and Continue needs the tick', () => {
    assert.match(form, /const \[childConsent, setChildConsent\] = useState\(false\);/);
    assert.match(form, /if \(!next\.dob && underFive && !childConsent\) next\.consent = CHILD_DOCUMENT_CONSENT_MISSING;/);
    assert.match(form, /<CheckboxRow\s+checked=\{childConsent\}/);
    assert.match(form, /label=\{CHILD_DOCUMENT_CONSENT_TEXT\}/);
    assert.ok(CHILD_DOCUMENT_CONSENT_MISSING.length > 0);
  });
  it('sends nothing for it to the server (testing only)', () => {
    const create = form.match(/addMember\.mutateAsync\(([^)]*)\)/);
    assert.ok(create, 'the create call is still there');
    assert.doesNotMatch(create[1], /consent/i);
    assert.doesNotMatch(form, /giveMemberPhotoConsent|photo-consent/);
  });
});
