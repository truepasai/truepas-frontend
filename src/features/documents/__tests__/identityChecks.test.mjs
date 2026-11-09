// App-side document checks: lenient name match and expiry.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isExpired, namesMatch, splitPassportName } from '../identityChecks.ts';

describe('namesMatch', () => {
  it('ignores case, spacing, punctuation and accents', () => {
    assert.equal(namesMatch('Pradeep Mali', 'PRADEEP  MALI'), true);
    assert.equal(namesMatch('Anne-Marie Lopez', 'ANNE MARIE LÓPEZ'), true);
    assert.equal(namesMatch("O'Brien Sean", 'OBRIEN SEAN'), true);
  });

  it('ignores word order (surname first on the document)', () => {
    assert.equal(namesMatch('Pradeep Mali', 'MALI PRADEEP'), true);
    assert.equal(namesMatch('John Doe', 'DOE<<JOHN'), true);
  });

  it('allows a missing middle name on either side', () => {
    assert.equal(namesMatch('Rahul Kumar', 'RAHUL DEV KUMAR'), true);
    assert.equal(namesMatch('Rahul Dev Kumar', 'RAHUL KUMAR'), true);
  });

  it('matches an initial to a full name', () => {
    assert.equal(namesMatch('R. Kumar', 'RAHUL KUMAR'), true);
    assert.equal(namesMatch('Rahul Kumar', 'R KUMAR'), true);
  });

  it('matches the same letters spaced differently', () => {
    assert.equal(namesMatch('Mohammedali Khan', 'MOHAMMED ALI KHAN'), true);
  });

  it('rejects a different first or last name', () => {
    assert.equal(namesMatch('Rahul Kumar', 'RAHUL SHARMA'), false);
    assert.equal(namesMatch('Rahul Kumar', 'AMIT KUMAR'), false);
    assert.equal(namesMatch('Pradeep Mali', 'SARAH KIM'), false);
  });

  it('needs a full word in common, not only initials', () => {
    assert.equal(namesMatch('R K', 'RAHUL KUMAR'), false);
  });

  it('passes when either side is unknown', () => {
    assert.equal(namesMatch('Rahul Kumar', null), true);
    assert.equal(namesMatch('', 'RAHUL KUMAR'), true);
  });
});

describe('isExpired', () => {
  const TODAY = new Date(2026, 9, 28); // 28 Oct 2026, local

  it('is expired before today', () => {
    assert.equal(isExpired('2026-10-27', TODAY), true);
    assert.equal(isExpired('2019-01-01', TODAY), true);
  });

  it('is valid today and later', () => {
    assert.equal(isExpired('2026-10-28', TODAY), false);
    assert.equal(isExpired('2030-04-12T00:00:00Z', TODAY), false);
  });

  it('is not expired when the date is missing or unreadable', () => {
    assert.equal(isExpired(null, TODAY), false);
    assert.equal(isExpired('', TODAY), false);
    assert.equal(isExpired('12/01/2020', TODAY), false);
  });
});

describe('splitPassportName', () => {
  it('takes the surname from the front without a matching profile', () => {
    assert.deepEqual(splitPassportName('MALI PRADEEP', ''), { firstName: 'PRADEEP', lastName: 'MALI' });
    assert.deepEqual(splitPassportName('MALI PRADEEP KUMAR', 'Someone Else'), { firstName: 'PRADEEP KUMAR', lastName: 'MALI' });
    assert.deepEqual(splitPassportName('DOE<<JOHN', null), { firstName: 'JOHN', lastName: 'DOE' });
  });

  it("follows the profile's order when the words are the same", () => {
    assert.deepEqual(splitPassportName('DE SOUZA JOHN', 'John De Souza'), { firstName: 'JOHN', lastName: 'DE SOUZA' });
    assert.deepEqual(splitPassportName('MALI PRADEEP', 'pradeep mali'), { firstName: 'PRADEEP', lastName: 'MALI' });
    assert.deepEqual(splitPassportName('LÓPEZ ANNE', 'Anne Lopez'), { firstName: 'ANNE', lastName: 'LÓPEZ' });
  });

  it("uses the account owner's surname on a family member's passport", () => {
    assert.deepEqual(splitPassportName('DE SOUZA MARIA', 'Maria', 'John De Souza'), { firstName: 'MARIA', lastName: 'DE SOUZA' });
    assert.deepEqual(splitPassportName('DE SOUZA MARIA ANN', 'Maria', 'John De Souza'), { firstName: 'MARIA ANN', lastName: 'DE SOUZA' });
    assert.deepEqual(splitPassportName('MALI AARAV', 'Aarav', 'Pradeep Mali'), { firstName: 'AARAV', lastName: 'MALI' });
    // The holder's own longer passport name, owner = holder.
    assert.deepEqual(splitPassportName('DE SOUZA JOHN PAUL', 'John De Souza', 'John De Souza'), { firstName: 'JOHN PAUL', lastName: 'DE SOUZA' });
  });

  it("finds the member's first name when the surname differs", () => {
    assert.deepEqual(splitPassportName('FERNANDES RITA', 'Rita', 'John De Souza'), { firstName: 'RITA', lastName: 'FERNANDES' });
    assert.deepEqual(splitPassportName('VAN DER BERG ANNA', 'Anna', 'John De Souza'), { firstName: 'ANNA', lastName: 'VAN DER BERG' });
    assert.deepEqual(splitPassportName('FERNANDES RITA MARIE', 'Rita Fernandes', 'John De Souza'), { firstName: 'RITA MARIE', lastName: 'FERNANDES' });
  });

  it('falls back to the first word with nothing to go on', () => {
    assert.deepEqual(splitPassportName('VAN DER BERG ANNA', '', 'John De Souza'), { firstName: 'DER BERG ANNA', lastName: 'VAN' });
    // An owner name typed surname-first does not match, so it is skipped.
    assert.deepEqual(splitPassportName('DE SOUZA MARIA', '', 'Souza John'), { firstName: 'SOUZA MARIA', lastName: 'DE' });
  });

  it('handles a single word and an empty name', () => {
    assert.deepEqual(splitPassportName('MADONNA', 'Madonna'), { firstName: '', lastName: 'MADONNA' });
    assert.deepEqual(splitPassportName('', 'John'), { firstName: '', lastName: '' });
  });
});
