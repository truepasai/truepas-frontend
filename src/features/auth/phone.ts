/**
 * Typed phone numbers → the format the API matches on. Login sends an E.164
 * identifier; register sends { countryCode, phone } and the backend stores
 * countryCode + phone as E.164. Both screens read the number here, so the
 * number an account is created with is the number sign-in looks up.
 *
 * No runtime imports — the rules are unit-tested with plain Node.
 */

/** Shortest national number accepted — the 7-digit floor login always had. */
const MIN_NATIONAL_DIGITS = 7;
/** A bare national number is at most 10 digits (India) — longer input that
 *  starts with the picked code's digits already includes the code. */
const MAX_NATIONAL_DIGITS = 10;
/** E.164 caps a whole number, country code included, at 15 digits. */
const MAX_E164_DIGITS = 15;

export interface NormalizedPhone {
  /** '+<country code><national number>' — the login identifier. */
  e164: string;
  /** RegisterRequest.phone (sent with the picked countryCode): no country
   *  code, no trunk 0. Null when the number was typed with a '+'/00 code
   *  other than the picked one — without a numbering-plan table there's no
   *  telling where that code ends. */
  national: string | null;
}

/**
 * Read a typed number against the picked country code (e.g. '+91').
 * Spaces, dashes, dots and brackets are ignored. In order:
 * 1. '+' before the first digit — the country code is typed in; the picker
 *    is ignored ('+1 907 643 3740').
 * 2. '00' — the international dialling prefix (India, UK, EU, UAE…), read
 *    exactly like '+': '00 91 98765 43210' → +919876543210. Other exit codes
 *    (US 011, Japan 010, Australia 0011) aren't recognised; '+' always works.
 * 3. A leading '0' — the trunk prefix ('098765 43210'): a national number.
 * 4. Starts with the picked code's digits and is longer than a national
 *    number (> 10 digits) — the code is already there ('91 98765 43210').
 *    A 10-digit number that merely starts with 91 stays national.
 * 5. Anything else — a national number; the picked code is added.
 * Leading zeros of the national part are then dropped (the trunk prefix,
 * also when typed after the code: '+91 0 98765 43210'). Safe for every code
 * in COUNTRIES — none has national numbers starting with 0 (Italy, +39,
 * does: revisit before adding it).
 *
 * Null when it can't be a phone number: letters or '@', a national part
 * under 7 digits, or more than 15 digits in all.
 */
export function normalizePhone(input: string, countryCode: string): NormalizedPhone | null {
  if (/[a-z@]/i.test(input)) return null;
  const cc = countryCode.replace(/\D/g, '');
  let digits = input.replace(/\D/g, '');
  // Rules 1–2: the country code is typed in after '+' or the 00 prefix.
  let international = /^\D*\+/.test(input);
  if (!international && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }
  // Rule 4 — a trunk 0 (rule 3) means the code isn't in front.
  const hasCode =
    international || (!digits.startsWith('0') && digits.startsWith(cc) && digits.length > MAX_NATIONAL_DIGITS);

  if (hasCode && !digits.startsWith(cc)) {
    // Another country's code: kept as typed (no country code starts with 0).
    const valid = !digits.startsWith('0') && digits.length > MIN_NATIONAL_DIGITS && digits.length <= MAX_E164_DIGITS;
    return valid ? { e164: `+${digits}`, national: null } : null;
  }
  const national = (hasCode ? digits.slice(cc.length) : digits).replace(/^0+/, '');
  if (national.length < MIN_NATIONAL_DIGITS || cc.length + national.length > MAX_E164_DIGITS) return null;
  return { e164: `+${cc}${national}`, national };
}

/**
 * Sign-in identifier for POST /auth/login. An email (anything with an '@')
 * comes back as typed, only trimmed; anything else is read as a phone number
 * (normalizePhone) → E.164, or null when it can't be one.
 */
export function toLoginIdentifier(input: string, countryCode: string): string | null {
  const value = input.trim();
  return value.includes('@') ? value : (normalizePhone(value, countryCode)?.e164 ?? null);
}

/** Mobile numbering per country in COUNTRIES (national part: no country
 *  code, no trunk 0). Registration texts an OTP, so only mobile ranges pass. */
const MOBILE_RULES: Record<string, { lengths: number[]; start: RegExp; message: string }> = {
  '91': { lengths: [10], start: /^[6-9]/, message: 'Indian mobile numbers have 10 digits and start with 6–9.' },
  '1': { lengths: [10], start: /^[2-9]\d{2}[2-9]/, message: 'US numbers have 10 digits (area code + number).' },
  '44': { lengths: [10], start: /^7/, message: 'UK mobile numbers have 10 digits after the 0 and start with 7.' },
  '61': { lengths: [9], start: /^4/, message: 'Australian mobile numbers have 9 digits after the 0 and start with 4.' },
  '86': { lengths: [11], start: /^1/, message: 'Chinese mobile numbers have 11 digits and start with 1.' },
  '81': { lengths: [10], start: /^[6-9]0/, message: 'Japanese mobile numbers have 10 digits after the 0 (70, 80 or 90…).' },
  '49': { lengths: [10, 11], start: /^1[5-7]/, message: 'German mobile numbers have 10–11 digits after the 0 and start with 15, 16 or 17.' },
  '33': { lengths: [9], start: /^[67]/, message: 'French mobile numbers have 9 digits after the 0 and start with 6 or 7.' },
  '971': { lengths: [9], start: /^5/, message: 'UAE mobile numbers have 9 digits after the 0 and start with 5.' },
  '65': { lengths: [8], start: /^[89]/, message: 'Singapore mobile numbers have 8 digits and start with 8 or 9.' },
  '92': { lengths: [10], start: /^3/, message: 'Pakistani mobile numbers have 10 digits after the 0 and start with 3.' },
  '880': { lengths: [10], start: /^1[3-9]/, message: 'Bangladeshi mobile numbers have 10 digits after the 0 and start with 1.' },
};

/**
 * Registration check of a national number (normalizePhone().national)
 * against the picked country's mobile numbering: the problem as a message,
 * or null when it fits. A code without a rule keeps the generic 7–15 digits.
 */
export function mobileNumberError(national: string, countryCode: string): string | null {
  const rule = MOBILE_RULES[countryCode.replace(/\D/g, '')];
  if (!rule) return null;
  return rule.lengths.includes(national.length) && rule.start.test(national) ? null : rule.message;
}
