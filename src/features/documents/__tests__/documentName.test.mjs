/** The holder's name on the document detail screen (documentName.ts): Regula's
 *  own given-name and surname fields under the right labels, never a split of
 *  the printed name by position, never ordered after the profile name. Only a
 *  passport Regula read neither part of falls back to splitPassportName's
 *  split of the printed name. Synthetic names only. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { documentNameRows } from '../documentName.ts';
import { splitPassportName } from '../identityChecks.ts';

const rows = (doc, split) => documentNameRows(doc, split).map(({ title, value }) => [title, value]);

describe('documentNameRows: passports (field 25 printed surname first)', () => {
  it('labels the surname and given names from their own fields', () => {
    assert.deepEqual(rows({ extractedName: 'DOE JOHN', extractedGivenNames: 'JOHN', extractedSurname: 'DOE' }), [
      ['Given names', 'JOHN'],
      ['Surname', 'DOE'],
    ]);
  });

  it('never calls the first printed word the first name', () => {
    const shown = rows({ extractedName: 'DOE JOHN', extractedGivenNames: 'JOHN', extractedSurname: 'DOE' });
    assert.ok(!shown.some(([title]) => /first name|last name/i.test(title)));
    assert.deepEqual(shown.find(([title]) => title === 'Given names'), ['Given names', 'JOHN']);
  });

  it('keeps several given names, middle names included, together and in order', () => {
    assert.deepEqual(rows({ extractedName: 'SMITH JOHN MICHAEL', extractedGivenNames: 'JOHN MICHAEL', extractedSurname: 'SMITH' }), [
      ['Given names', 'JOHN MICHAEL'],
      ['Surname', 'SMITH'],
    ]);
  });

  it('keeps a multi-word surname whole', () => {
    assert.deepEqual(rows({ extractedName: 'DE SOUZA MARIA ANN', extractedGivenNames: 'MARIA ANN', extractedSurname: 'DE SOUZA' }), [
      ['Given names', 'MARIA ANN'],
      ['Surname', 'DE SOUZA'],
    ]);
  });

  it('keeps accents, apostrophes and hyphens as read', () => {
    assert.deepEqual(rows({ extractedName: "O'BRIEN-LÓPEZ SIOBHÁN", extractedGivenNames: 'SIOBHÁN', extractedSurname: "O'BRIEN-LÓPEZ" }), [
      ['Given names', 'SIOBHÁN'],
      ['Surname', "O'BRIEN-LÓPEZ"],
    ]);
  });
});

describe('documentNameRows: missing or ambiguous parts', () => {
  it('a single name with no surname shows the given name only', () => {
    assert.deepEqual(rows({ extractedName: 'PRIYA', extractedGivenNames: 'PRIYA', extractedSurname: null }), [['Given names', 'PRIYA']]);
  });

  it('a missing given-name field shows the surname and the name as printed', () => {
    assert.deepEqual(rows({ extractedName: 'DOE JOHN', extractedGivenNames: null, extractedSurname: 'DOE' }), [
      ['Surname', 'DOE'],
      ['Name on document', 'DOE JOHN'],
    ]);
  });

  it('a missing surname field shows the given names and the name as printed', () => {
    assert.deepEqual(rows({ extractedName: 'DOE JOHN', extractedGivenNames: 'JOHN', extractedSurname: '' }), [
      ['Given names', 'JOHN'],
      ['Name on document', 'DOE JOHN'],
    ]);
  });

  it('parts that disagree with the printed name are shown with it, not reconciled', () => {
    assert.deepEqual(rows({ extractedName: 'DOE JONATHAN', extractedGivenNames: 'JOHN', extractedSurname: 'DOE' }), [
      ['Given names', 'JOHN'],
      ['Surname', 'DOE'],
      ['Name on document', 'DOE JONATHAN'],
    ]);
  });

  it('only the printed name: shown as printed, never split', () => {
    assert.deepEqual(rows({ extractedName: 'WANG XIAOMING', extractedGivenNames: null, extractedSurname: null }), [
      ['Name on document', 'WANG XIAOMING'],
    ]);
  });

  it('a licence printed given name first is shown as printed', () => {
    assert.deepEqual(rows({ extractedName: 'JOHN DOE' }), [['Name on document', 'JOHN DOE']]);
  });

  it('only spacing is tidied; MRZ filler and case are compared, not shown', () => {
    assert.deepEqual(rows({ extractedName: '  DOE   JOHN ', extractedGivenNames: ' JOHN', extractedSurname: 'DOE ' }), [
      ['Given names', 'JOHN'],
      ['Surname', 'DOE'],
    ]);
    assert.deepEqual(rows({ extractedName: 'DOE<<JOHN', extractedGivenNames: 'John', extractedSurname: 'Doe' }), [
      ['Given names', 'John'],
      ['Surname', 'Doe'],
    ]);
  });

  it('nothing read: no name rows', () => {
    assert.deepEqual(rows({}), []);
    assert.deepEqual(rows({ extractedName: '  ', extractedGivenNames: null, extractedSurname: undefined }), []);
  });
});

describe("documentNameRows: a passport's printed name split by the caller", () => {
  const printedOnly = (extractedName) => ({ extractedName, extractedGivenNames: null, extractedSurname: null });

  it('uses the split when Regula read neither part', () => {
    assert.deepEqual(rows(printedOnly('DE SOUZA MARIA'), splitPassportName('DE SOUZA MARIA', 'Maria', 'John De Souza')), [
      ['Given names', 'MARIA'],
      ['Surname', 'DE SOUZA'],
    ]);
    assert.deepEqual(rows(printedOnly('MALI PRADEEP KUMAR'), splitPassportName('MALI PRADEEP KUMAR', '')), [
      ['Given names', 'PRADEEP KUMAR'],
      ['Surname', 'MALI'],
    ]);
  });

  it("ignores the split once Regula read either part", () => {
    const wrong = { firstName: 'SOUZA JOHN', lastName: 'DE' };
    assert.deepEqual(rows({ extractedName: 'DE SOUZA JOHN', extractedGivenNames: 'JOHN', extractedSurname: 'DE SOUZA' }, wrong), [
      ['Given names', 'JOHN'],
      ['Surname', 'DE SOUZA'],
    ]);
    assert.deepEqual(rows({ extractedName: 'DOE JOHN', extractedGivenNames: null, extractedSurname: 'DOE' }, { firstName: 'JOHN', lastName: 'DOE' }), [
      ['Surname', 'DOE'],
      ['Name on document', 'DOE JOHN'],
    ]);
  });

  it('a one-word passport name is the surname only', () => {
    assert.deepEqual(rows(printedOnly('MADONNA'), splitPassportName('MADONNA', 'Madonna')), [['Surname', 'MADONNA']]);
  });

  it('still shows the printed name when the split leaves words out', () => {
    assert.deepEqual(rows(printedOnly('DOE JOHN'), { firstName: 'JOHN', lastName: '' }), [
      ['Given names', 'JOHN'],
      ['Name on document', 'DOE JOHN'],
    ]);
  });
});

const app = (path) => readFileSync(new URL(`../../../app/${path}`, import.meta.url), 'utf8');

describe('the document detail screen', () => {
  const screen = app('document/[id].tsx');

  it('shows the rows from documentNameRows, in the flat list Group separates', () => {
    assert.match(screen, /documentNameRows\(\s*d,/);
    // Group puts hairlines between top-level children only: the name rows are
    // spread into its one flat array, not nested as an array of their own.
    assert.match(screen, /\[\s*\.\.\.nameRows\.map\(/);
  });

  it("splits a printed name only as documentNameRows' passport fallback, never by word position", () => {
    // The profile and family names order a passport's printed name only through
    // splitPassportName, handed to documentNameRows (used when Regula read
    // neither part), and only for a passport.
    assert.match(screen, /documentNameRows\(\s*d,\s*d\.type === 'passport'\s*\?\s*splitPassportName\(/);
    assert.equal(screen.match(/splitPassportName\(/g)?.length, 1);
    assert.doesNotMatch(screen, /extractedName[^\n]*\.split\(/);
    assert.doesNotMatch(screen, /"First name"|"Last name"/);
  });
});

describe('the verified screen after a scan', () => {
  it('gets Regula name fields from processing and shows them with documentNameRows', () => {
    const processing = app('document/processing.tsx');
    assert.match(processing, /extractedGivenNames: result\.extractedGivenNames/);
    assert.match(processing, /extractedSurname: result\.extractedSurname/);
    const verified = app('document/verified.tsx');
    assert.match(verified, /documentNameRows\(\{ extractedName, extractedGivenNames, extractedSurname \}\)/);
    assert.doesNotMatch(verified, /Full name|First name|Last name/);
  });
});
