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

/**
 * First and last name of a passport holder. The document sends one string,
 * surname first (MRZ order). Words keep the document's spelling. In order:
 * 1. It holds exactly the words of the holder's name (profile, or the name a
 *    family member was added with): that name's order decides the split
 *    ("DE SOUZA JOHN" + "John De Souza" → JOHN / DE SOUZA).
 * 2. It starts with the account owner's surname (their name after the first
 *    word), as a family member's passport often does: that is the surname.
 * 3. The holder's first name is found past the front: the words before it
 *    are the surname ("VAN DER BERG ANNA" + "Anna" → ANNA / VAN DER BERG).
 * 4. Otherwise the first word is the surname and the rest the given names.
 */
export function splitPassportName(
  documentName: string | null | undefined,
  holderName: string | null | undefined,
  ownerName?: string | null,
): { firstName: string; lastName: string } {
  const tokens = (documentName ?? '').split(/[\s<]+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', lastName: '' };
  const at = (i: number) => ({ firstName: tokens.slice(i).join(' '), lastName: tokens.slice(0, i).join(' ') });

  const docKeys = tokens.map((t) => nameWords(t).join(''));
  const holder = nameWords(holderName ?? '');
  if (holder.length === tokens.length && holder.length > 1) {
    const left = tokens.map((t, i) => ({ t, k: docKeys[i] }));
    const ordered: string[] = [];
    for (const w of holder) {
      const i = left.findIndex((l) => l.k === w);
      if (i < 0) break;
      ordered.push(left[i].t);
      left.splice(i, 1);
    }
    if (ordered.length === tokens.length) {
      return { firstName: ordered[0], lastName: ordered.slice(1).join(' ') };
    }
  }

  const surname = nameWords(ownerName ?? '').slice(1);
  if (surname.length > 0 && surname.length < tokens.length && surname.every((w, i) => docKeys[i] === w)) {
    return at(surname.length);
  }

  const given = docKeys.indexOf(holder[0] ?? '', 1);
  if (given > 0) return at(given);

  return at(1);
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
