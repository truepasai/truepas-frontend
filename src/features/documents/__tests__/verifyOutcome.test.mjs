/** The server's verify answer decides a document; the app never deletes one
 *  the server holds as verified (verifyOutcome, document/processing,
 *  family/add/processing). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alreadyVerified, mayDiscard, rejectKind } from '../verifyOutcome.ts';

const source = (path) => readFileSync(new URL(`../../../app/${path}`, import.meta.url), 'utf8');

describe('rejectKind: by the server reasonCode only', () => {
  it('maps the popups', () => {
    assert.equal(rejectKind('DOCUMENT_EXPIRED'), 'expired');
    assert.equal(rejectKind('DOCUMENT_FACE_MISMATCH'), 'face');
    assert.equal(rejectKind('PROFILE_MISMATCH'), 'profile');
    assert.equal(rejectKind('NAME_REVIEW_REQUIRED'), 'review');
  });
  it('leaves every other rejection to its own screen', () => {
    for (const code of ['AUTHENTICITY_FAILED', 'DOCUMENT_UNREADABLE', 'FACE_NOT_ENROLLED', 'SOMETHING_NEW', '', null, undefined]) {
      assert.equal(rejectKind(code), null);
    }
  });
});

describe('mayDiscard: never a document the server holds as verified', () => {
  it('discards a rejected attempt', () => {
    assert.equal(mayDiscard('failed'), true);
    assert.equal(mayDiscard('pending'), true);
  });
  it('keeps a verified one, and one whose state is unknown', () => {
    assert.equal(mayDiscard('verified'), false);
    assert.equal(mayDiscard(undefined), false);
    assert.equal(mayDiscard(null), false);
  });
});

describe('alreadyVerified: a lost approval found on Retry', () => {
  const stored = {
    id: 'doc-1', type: 'passport', label: 'Passport', number: '••••4567', status: 'verified', matchScore: 0.93,
    addedAt: '2026-11-13T09:00:00Z', expiresAt: '2031-01-01', extractedName: 'DOE JOHN',
    extractedGivenNames: 'JOHN', extractedSurname: 'DOE', extractedDob: '1990-01-15',
    nationality: 'USA', issuingState: 'Synthetic', portraitImageUrl: 'https://example.invalid/p',
  };
  it('turns the stored verified document into an approved answer', () => {
    const answer = alreadyVerified(stored);
    assert.equal(answer.outcome, 'approved');
    assert.equal(answer.document, stored);
    assert.deepEqual(
      [answer.extractedName, answer.extractedGivenNames, answer.extractedSurname, answer.dateOfExpiry],
      ['DOE JOHN', 'JOHN', 'DOE', '2031-01-01'],
    );
  });
  it('is nothing for a document that is not verified, or none', () => {
    assert.equal(alreadyVerified({ ...stored, status: 'failed' }), null);
    assert.equal(alreadyVerified(null), null);
  });
});

describe('the processing screens follow the server', () => {
  for (const path of ['document/processing.tsx', 'family/add/processing.tsx']) {
    const text = source(path);
    it(`${path}: no app-side name or expiry gate`, () => {
      assert.doesNotMatch(text, /namesMatch|isExpired|identityChecks|appCheck/);
    });
    it(`${path}: the attempt is discarded only when mayDiscard allows`, () => {
      assert.match(text, /mayDiscard\((result|verdict)\.document\?\.status\)/);
    });
    it(`${path}: a Retry looks for an approval the server already gave`, () => {
      assert.match(text, /alreadyVerified\(await api\.getDocument\(doc\.id\)/);
    });
  }
  it('document/processing.tsx: leaving after an error checks the server first', () => {
    const text = source('document/processing.tsx');
    const back = text.slice(text.indexOf('const backToDocuments'), text.indexOf('const scanAgain'));
    assert.match(back, /api\.getDocument\(doc\.id\)/);
    assert.match(back, /mayDiscard\(server\?\.status\)/);
  });
});

describe('document/[id].tsx shows the document name without inventing parts', () => {
  const text = source('document/[id].tsx');
  // The rows come from documentName.ts (its own tests: documentName.test.mjs).
  const rules = readFileSync(new URL('../documentName.ts', import.meta.url), 'utf8');
  it('uses Regula given-name and surname fields, never a split by position', () => {
    assert.match(text, /documentNameRows\(d\)/);
    assert.match(rules, /doc\.extractedGivenNames/);
    assert.match(rules, /doc\.extractedSurname/);
    assert.doesNotMatch(text, /split\(\/\\s\+\/\)/);
    assert.doesNotMatch(text, /title="First name"|title="Last name"/);
  });
  it('falls back to the name as printed', () => {
    assert.match(rules, /title: 'Name on document'/);
  });
});
