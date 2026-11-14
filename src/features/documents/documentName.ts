/**
 * The holder's name rows on the document detail screen.
 *
 * Regula reads a document's name three ways (identity-proofing-service
 * app/regula_provider.py): field 9 "Given Names" → extractedGivenNames, field 8
 * "Surname" → extractedSurname, and field 25 "Surname And Given Names" →
 * extractedName, the combined value as the document prints it (surname first on
 * passports). The parts are Regula's own fields. They are never cut out of the
 * combined value by word position, and never ordered after the profile name.
 */
import type { IdentityDocument } from '@/types/domain';

export type NameRow = { key: 'givenNames' | 'surname' | 'printed'; title: string; value: string };

type NameFields = Pick<IdentityDocument, 'extractedName' | 'extractedGivenNames' | 'extractedSurname'>;

/** Display spacing only: the words and their order stay as read. */
const tidy = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** The words of a name, for comparing only (case and MRZ filler ignored). */
const words = (value: string) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s,<]+/)
    .filter(Boolean)
    .sort()
    .join(' ');

export function documentNameRows(doc: NameFields): NameRow[] {
  const given = tidy(doc.extractedGivenNames);
  const surname = tidy(doc.extractedSurname);
  const printed = tidy(doc.extractedName);
  const rows: NameRow[] = [];
  if (given) rows.push({ key: 'givenNames', title: 'Given names', value: given });
  if (surname) rows.push({ key: 'surname', title: 'Surname', value: surname });
  // The printed name as well, unless the parts hold exactly its words: when
  // Regula read one part only, or the parts and the printed name disagree, the
  // customer sees what the document says rather than a guess.
  if (printed && !(rows.length > 0 && words(`${given} ${surname}`) === words(printed))) {
    rows.push({ key: 'printed', title: 'Name on document', value: printed });
  }
  return rows;
}
