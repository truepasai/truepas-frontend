// Guardian verification on a child's page: what the parent is shown, and that
// nothing in the app can present a guardianship as verified on its own.
// Run: npm test   (node --test; Node 22.6+ imports the .ts modules directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NO_MOCK_FALLBACK } from '../../../api/fallbackPolicy.ts';
import {
  GUARDIAN_EVIDENCE_PRIVACY,
  GUARDIAN_STATUSES,
  base64Bytes,
  canSubmitEvidence,
  evidenceTooLarge,
  evidenceTypeOptions,
  guardianStatusLabel,
  guardianStatusOf,
  needsGuardianVerification,
} from '../guardianVerification.ts';

describe('guardian verification statuses', () => {
  it('names the six statuses the parent can see', () => {
    assert.deepEqual(GUARDIAN_STATUSES.map(guardianStatusLabel), [
      'Not submitted', 'Pending review', 'Verified', 'Rejected', 'Additional information required', 'Revoked',
    ]);
  });

  it('shows an unknown or missing answer as not submitted, never as verified', () => {
    for (const view of [undefined, null, {}, { status: 'approved' }, { status: 'VERIFIED' }]) {
      assert.equal(guardianStatusOf(view), 'not_submitted');
    }
    assert.equal(guardianStatusOf({ status: 'verified' }), 'verified');
  });
});

describe('the evidence form', () => {
  it('opens only when the server says the feature is on and this parent may submit', () => {
    assert.equal(canSubmitEvidence({ submissionEnabled: true, canSubmit: true }), true);
    assert.equal(canSubmitEvidence({ submissionEnabled: false, canSubmit: true }), false);
    assert.equal(canSubmitEvidence({ submissionEnabled: true, canSubmit: false }), false);
    assert.equal(canSubmitEvidence(undefined), false);
  });

  it('offers only the document kinds the server lists', () => {
    assert.deepEqual(evidenceTypeOptions({ evidenceTypes: ['birth_certificate', 'court_guardianship_order'] }), [
      { value: 'birth_certificate', label: 'Birth certificate' },
      { value: 'court_guardianship_order', label: 'Court guardianship order' },
    ]);
    assert.deepEqual(evidenceTypeOptions({}), []);
  });

  it('measures a base64 file without decoding it', () => {
    assert.equal(base64Bytes(Buffer.from('abcd').toString('base64')), 4);
    assert.equal(base64Bytes(Buffer.from('abcde').toString('base64')), 5);
    const twentyBytes = Buffer.alloc(20).toString('base64');
    assert.equal(evidenceTooLarge(twentyBytes, 19), true);
    assert.equal(evidenceTooLarge(twentyBytes, 20), false);
  });

  it('is shown for children only', () => {
    assert.equal(needsGuardianVerification(0), true);
    assert.equal(needsGuardianVerification(17), true);
    assert.equal(needsGuardianVerification(18), false);
    assert.equal(needsGuardianVerification(undefined), false);
  });

  it('tells the parent who sees the document and what verification does not do', () => {
    assert.match(GUARDIAN_EVIDENCE_PRIVACY, /never shared with venues or kiosks/);
    assert.match(GUARDIAN_EVIDENCE_PRIVACY, /not consent/);
  });

  it('is never answered from mock data when the server call fails', () => {
    assert.ok(NO_MOCK_FALLBACK.has('getGuardianVerification'));
    assert.ok(NO_MOCK_FALLBACK.has('submitGuardianVerification'));
  });
});
