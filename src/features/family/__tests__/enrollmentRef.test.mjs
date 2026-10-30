// An enrolment attempt's reference: from a secure UUID, never anything else.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { ENROLLMENT_REF_PATTERN, newEnrollmentRef } from '../enrollmentRef.ts';

describe('newEnrollmentRef', () => {
  it('wraps a secure v4 UUID in the shape the BFF and the account service accept', () => {
    const ref = newEnrollmentRef(randomUUID);
    assert.match(ref, /^enr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(ref, ENROLLMENT_REF_PATTERN);
    assert.ok(ref.length <= 64);
  });

  it('is different every time', () => {
    const refs = new Set(Array.from({ length: 500 }, () => newEnrollmentRef(randomUUID)));
    assert.equal(refs.size, 500);
  });

  it('refuses a generator that is missing or not a v4 UUID — no attempt starts without one', () => {
    for (const bad of [() => '', () => 'person-1', () => '00000000-0000-1000-8000-000000000000', () => undefined]) {
      assert.throws(() => newEnrollmentRef(bad));
    }
    assert.throws(() => newEnrollmentRef(() => {
      throw new Error("Native UUID version 4 generator implementation wasn't found");
    }));
  });

  it('matches the pattern the backends enforce', () => {
    assert.match('enr_' + 'a'.repeat(16), ENROLLMENT_REF_PATTERN);
    for (const bad of ['enr_short', 'person-1', `enr_${'a'.repeat(61)}`, 'enr_has/slash/in/it/here']) {
      assert.doesNotMatch(bad, ENROLLMENT_REF_PATTERN);
    }
  });
});
