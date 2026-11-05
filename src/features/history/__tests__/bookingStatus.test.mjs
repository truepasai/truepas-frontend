// Date-based booking status (BUG056).
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bookingDisplayStatus, withLiveStatus } from '../bookingStatus.ts';

const TODAY = '2026-11-05';
const res = (overrides = {}) => ({ status: 'upcoming', checkIn: '2026-11-10', checkOut: '2026-11-12', ...overrides });

describe('bookingDisplayStatus', () => {
  it('is Upcoming before the check-in day', () => {
    assert.equal(bookingDisplayStatus(res(), TODAY), 'upcoming');
  });
  it('is Check-in due on the check-in day and through a multi-day stay', () => {
    assert.equal(bookingDisplayStatus(res({ checkIn: TODAY, checkOut: '2026-11-08' }), TODAY), 'check_in_due');
    assert.equal(bookingDisplayStatus(res({ checkIn: '2026-11-03', checkOut: TODAY }), TODAY), 'check_in_due');
    assert.equal(bookingDisplayStatus(res({ checkIn: `${TODAY}T00:00:00Z`, checkOut: null }), TODAY), 'check_in_due');
  });
  it('is Expired once the dates have passed without a check-in', () => {
    assert.equal(bookingDisplayStatus(res({ checkIn: '2026-11-01', checkOut: '2026-11-04' }), TODAY), 'expired');
    assert.equal(bookingDisplayStatus(res({ checkIn: '2026-11-04', checkOut: null }), TODAY), 'expired');
  });
  it('is Checked in after a completed check-in, whatever the dates', () => {
    assert.equal(bookingDisplayStatus(res({ status: 'completed', checkIn: '2026-11-01' }), TODAY), 'checked_in');
  });
  it('leaves other server statuses alone', () => {
    assert.equal(bookingDisplayStatus(res({ status: 'failed' }), TODAY), 'failed');
  });
});

describe('withLiveStatus', () => {
  it('turns only a past upcoming booking expired', () => {
    assert.equal(withLiveStatus(res({ checkIn: '2026-11-01', checkOut: '2026-11-02' }), TODAY).status, 'expired');
    const due = res({ checkIn: TODAY, checkOut: null });
    assert.equal(withLiveStatus(due, TODAY), due);
  });
});
