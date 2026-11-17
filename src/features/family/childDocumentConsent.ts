/**
 * The parent's terms on the Add member form, before an under-5 child's
 * document is uploaded: shown once the date of birth makes the child under 5
 * (nothing is shown from 5), with one unticked box that must be ticked to
 * continue.
 *
 * TESTING ONLY, until the parent's consent flow is built for production: the
 * tick is the whole consent. No evidence, no reviewer, and nothing is sent to
 * the server (in development, checkin-consent-service releases a matched
 * child's documents at the kiosk without parent consent:
 * CHILD_DOCUMENTS_WITHOUT_CONSENT). The photo step keeps its own consent.
 *
 * No imports, so it runs under `node --test` (__tests__/childDocumentConsent.test.mjs).
 */

// The age the photo enrolment (and this consent) applies under: must equal
// memberSetupState's PHOTO_ENROLLMENT_UNDER_AGE.
export const CHILD_DOCUMENT_CONSENT_UNDER_AGE = 5;

/** Whether the terms apply: a known age under 5. */
export const needsChildDocumentConsent = (age: number | null | undefined): boolean =>
  typeof age === 'number' && Number.isFinite(age) && age >= 0 && age < CHILD_DOCUMENT_CONSENT_UNDER_AGE;

export const CHILD_DOCUMENT_CONSENT_TEXT =
  "I confirm that I am this child's parent or legal guardian, and I agree to these terms on their behalf.";

export const CHILD_DOCUMENT_CONSENT_MISSING = 'Tick the box to agree before you add their document.';

export type ChildConsentTerm = { heading: string; body: string };

export const childDocumentConsentTerms = (firstName?: string): ChildConsentTerm[] => {
  const first = firstName?.trim() || 'your child';
  return [
    {
      heading: 'What you add',
      body: `${first}'s identity document (a passport, ID card or birth certificate), then one photo of ${first}'s face.`,
    },
    {
      heading: 'How it is used',
      body:
        `TruePas checks the document and uses it, with the photo, to identify ${first} at a venue's check-in kiosk. ` +
        `When ${first} checks in there, that venue receives ${first}'s document.`,
    },
    { heading: 'Where it is kept', body: "In TruePas's encrypted storage, linked to your account." },
    { heading: 'Removing it', body: `You can remove ${first} from your family at any time.` },
  ];
};
