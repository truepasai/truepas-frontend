/**
 * A person's name, checked the way customer-account-service checks it
 * (app/person_name.py). The server is the authority; this only answers
 * before the round trip, with the same messages.
 *
 * Whitespace is trimmed and each run becomes one space; nothing else is
 * changed (case, accents, punctuation, Unicode form). Any script: letters, the
 * combining marks a script spells with (Indic vowel signs and viramas), the
 * zero-width joiners used inside a word, spaces, apostrophes (' ’ ʼ), hyphens
 * (- ‐ ‑), full stops (initials, "Jr."), commas and the middle dot. At least
 * one letter, starting with a letter or an apostrophe, no two punctuation
 * marks in a row, 2–100 characters. One word is a whole name.
 */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 100;

const APOSTROPHES = new Set(["'", '’', 'ʼ']);
const PUNCTUATION = new Set([...APOSTROPHES, '-', '‐', '‑', '.', ',', '·']);
const JOINERS = new Set(['‌', '‍']);
const MAX_MARKS_IN_A_ROW = 4;
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const INVALID = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}]/u;

/** The name as it will be stored: trimmed, whitespace runs made one space. */
export function cleanName(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(' ');
}

/** Why `value` would be refused, or null. Checks the cleaned value. */
export function nameError(value: string): string | null {
  const name = cleanName(value ?? '');
  if (!name) return 'Enter a name';
  if (INVALID.test(name)) return 'Name contains control or invalid characters';
  const chars = Array.from(name);
  if (chars.length < NAME_MIN_LENGTH) return `Name must be at least ${NAME_MIN_LENGTH} characters`;
  if (chars.length > NAME_MAX_LENGTH) return `Name must be at most ${NAME_MAX_LENGTH} characters`;
  if (!LETTER.test(name)) return 'Name must contain at least one letter';
  if (!(LETTER.test(chars[0]) || APOSTROPHES.has(chars[0]))) return 'Name must start with a letter';
  let previous = '';
  let marks = 0;
  for (const ch of chars) {
    if (MARK.test(ch)) {
      marks += 1;
      if (!(previous && (LETTER_OR_MARK.test(previous) || JOINERS.has(previous)))) return 'Name contains unsupported characters';
      if (marks > MAX_MARKS_IN_A_ROW) return 'Name contains unsupported characters';
    } else {
      marks = 0;
      if (LETTER.test(ch) || ch === ' ') {
        // fine
      } else if (JOINERS.has(ch)) {
        if (!(previous && LETTER_OR_MARK.test(previous))) return 'Name contains unsupported characters';
      } else if (PUNCTUATION.has(ch)) {
        if (PUNCTUATION.has(previous)) return 'Name contains unsupported characters';
      } else {
        return 'Name contains unsupported characters';
      }
    }
    previous = ch;
  }
  return null;
}
