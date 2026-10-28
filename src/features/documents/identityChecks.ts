/**
 * App-side checks on a verified document. The server checks the face and the
 * profile name, but not expiry, and an approval can still carry a name that
 * clearly isn't the holder's. These run on the approved result; when one
 * fails the document is discarded like a rejection.
 */

/** Words of a name: accents, case, dots, hyphens and MRZ fillers dropped. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** "r" matches "rahul"; full words must be equal. */
function wordsMatch(a: string, b: string): boolean {
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return a === b;
}

/**
 * Lenient name match: case, spacing, punctuation, accents and word order are
 * ignored, a middle name may be missing on one side and an initial matches a
 * full name ("R. Kumar" = "Rahul Kumar"). Every word of the shorter name must
 * be found in the longer one, with at least one full word in common.
 * Unknown (empty) on either side counts as a match — nothing to compare.
 */
export function namesMatch(profileName: string | null | undefined, documentName: string | null | undefined): boolean {
  const a = nameWords(profileName ?? '');
  const b = nameWords(documentName ?? '');
  if (a.length === 0 || b.length === 0) return true;
  // Same letters, different spacing ("Mohammedali" / "Mohammed Ali").
  if (a.join('') === b.join('')) return true;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const left = [...long];
  let fullWord = false;
  // Full words first, so an initial can't take a word a full word needs.
  const ordered = [...short].sort((x, y) => y.length - x.length);
  for (const w of ordered) {
    const i = left.findIndex((l) => wordsMatch(w, l));
    if (i < 0) return false;
    if (w.length > 1 && left[i].length > 1) fullWord = true;
    left.splice(i, 1);
  }
  return fullWord;
}

/** True when the expiry date (ISO yyyy-mm-dd, as the verify response sends
 *  it) is before today (local). Missing or unreadable dates — the server
 *  doesn't always return one — are not treated as expired. */
export function isExpired(dateOfExpiry: string | null | undefined, today: Date = new Date()): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfExpiry?.trim() ?? '');
  if (!iso) return false;
  const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayYmd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return ymd < todayYmd;
}
