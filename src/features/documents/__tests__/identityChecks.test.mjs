// App-side document checks: lenient name match and expiry.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isExpired, namesMatch } from '../identityChecks.ts';

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
