// Phone reading + registration's per-country mobile check.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mobileNumberError, normalizePhone } from '../phone.ts';

/** Typed number → national part → per-country check, as register does. */
const check = (typed, code) => {
  const parsed = normalizePhone(typed, code);
  assert.ok(parsed?.national, `${typed} (${code}) should parse`);
  return mobileNumberError(parsed.national, code);
};

describe('mobileNumberError — valid mobiles, as people type them', () => {
  const valid = [
    ['98765 43210', '+91'],
    ['098765 43210', '+91'],
    ['91 98765 43210', '+91'],
    ['(907) 643-3740', '+1'],
    ['07911 123456', '+44'],
    ['0412 345 678', '+61'],
    ['138 1234 5678', '+86'],
    ['090-1234-5678', '+81'],
    ['0151 12345678', '+49'],
    ['0160 1234567', '+49'],
    ['06 12 34 56 78', '+33'],
    ['050 123 4567', '+971'],
    ['9123 4567', '+65'],
    ['0300 1234567', '+92'],
    ['01712 345678', '+880'],
  ];
  for (const [typed, code] of valid) {
    it(`${code} ${typed}`, () => assert.equal(check(typed, code), null));
  }
});

describe('mobileNumberError — wrong length or not a mobile', () => {
  const invalid = [
    ['9876543', '+91'], // 7 digits — passed the old generic check
    ['98765432101', '+91'], // 11 digits
    ['58765 43210', '+91'], // Indian mobiles start 6–9
    ['907 643 374', '+1'],
    ['020 7946 0958', '+44'], // London landline
    ['0412 345 67', '+61'],
    ['138 1234 567', '+86'],
    ['03-1234-5678', '+81'], // Tokyo landline
    ['030 1234567', '+49'], // Berlin landline
    ['01 23 45 67 89', '+33'], // Paris landline
    ['04 123 4567', '+971'],
    ['6123 4567', '+65'],
    ['0300 123456', '+92'],
    ['01712 34567', '+880'],
  ];
  for (const [typed, code] of invalid) {
    it(`${code} ${typed}`, () => assert.notEqual(check(typed, code), null));
  }
});

describe('mobileNumberError — codes without a rule', () => {
  it('keeps the generic check', () => assert.equal(mobileNumberError('3123456789', '+39'), null));
});
