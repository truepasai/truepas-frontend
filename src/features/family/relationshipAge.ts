import { ADULT_AGE } from '@/utils/age';

/** Oldest age the Add member form accepts for anyone. */
export const MAX_MEMBER_AGE = 120;
/** A parent must be at least this many years older than the account holder. */
const MIN_PARENT_GAP = 12;

/** Twins born either side of midnight have consecutive birthdays — the
 *  same tolerance the backend uses to group a twin set. */
const TWIN_DOB_TOLERANCE_DAYS = 1;

function dayNumber(iso: string): number | null {
  const m = iso.split('T')[0].match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Whether `dob` is within a day of any of `others` (the holder and the
 *  family members): a twin shares a birthday with their twin. */
export function sharesTwinBirthday(dob: string, others: (string | null | undefined)[]): boolean {
  const day = dayNumber(dob);
  if (day == null) return false;
  return others.some((o) => {
    const other = o ? dayNumber(o) : null;
    return other != null && Math.abs(other - day) <= TWIN_DOB_TOLERANCE_DAYS;
  });
}

/**
 * Age check for a new family member, by relationship. Returns the message to
 * show under the date of birth, or null when the age fits.
 *
 * `ownAge` is the account holder's age. When it's unknown, the Child and
 * Parent rules are skipped (the backend doesn't enforce them either). Twin
 * has no age rule — twin children, adult twins or your own twin all fit.
 */
export function relationshipAgeError(relationship: string, age: number, ownAge?: number): string | null {
  if (age > MAX_MEMBER_AGE) return 'Enter a real date of birth';
  const own = ownAge != null && Number.isFinite(ownAge) ? ownAge : null;
  switch (relationship) {
    case 'Spouse':
      return age < ADULT_AGE ? `A spouse must be ${ADULT_AGE} or older` : null;
    case 'Guardian':
      return age < ADULT_AGE ? `A guardian must be ${ADULT_AGE} or older` : null;
    case 'Child':
      return own != null && age >= own ? 'Your child must be younger than you' : null;
    case 'Parent':
      return own != null && age - own < MIN_PARENT_GAP
        ? `A parent must be at least ${MIN_PARENT_GAP} years older than you`
        : null;
    default:
      return null;
  }
}
