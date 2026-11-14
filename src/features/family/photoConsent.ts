/**
 * The parent's one-checkbox consent before an under-5 child's photo enrolment.
 * customer-account-service records it (only for the child's recorded guardian,
 * only against its current notice version) and refuses to activate the child's
 * photo face without it; customer-app-bff checks it before the photo reaches
 * the face service. This module only words the screen and reads the answers.
 *
 * No imports, so it runs under `node --test` (__tests__/photoConsent.test.mjs).
 */

// Must equal customer-account-service's CHILD_PHOTO_CONSENT_NOTICE_VERSION. A
// draft until legal review approves the wording, the retention period and the
// withdrawal channel.
export const CHILD_PHOTO_CONSENT_NOTICE_VERSION = 'child-photo-enrolment-2026-11-draft';

export const CHILD_PHOTO_CONSENT_TEXT =
  "I confirm that I am this child's parent or lawful guardian. I authorize TruePas to capture and securely " +
  'store this photograph for child identification during check-in.';

export type ConsentSection = { heading: string; body: string };

export const childPhotoConsentNotice = (firstName: string): ConsentSection[] => [
  { heading: 'What is collected', body: `One photo of ${firstName}, taken now on this phone.` },
  {
    heading: 'How it is used',
    body:
      `TruePas turns it into the face record used to identify ${firstName} at check-in. ` +
      'It is never used for AI training, profiling or marketing.',
  },
  { heading: 'Where it is kept', body: "In TruePas's encrypted storage, linked to your account." },
  {
    heading: 'How long',
    body: 'For the period set in the TruePas privacy policy, unless you withdraw your consent sooner.',
  },
  {
    heading: 'Withdrawing',
    body: `You can withdraw on ${firstName}'s page at any time. Their enrolment photo and face record are then removed.`,
  },
];

export type PhotoConsentStatus = { active: boolean; noticeVersion?: string | null; acceptedAt?: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only the server's own "active" answer for the current notice counts as consent. */
export const consentIsActive = (status: unknown): boolean =>
  isRecord(status) && status.active === true && status.noticeVersion === CHILD_PHOTO_CONSENT_NOTICE_VERSION;

/** The server refused the photo because this consent is missing or withdrawn. */
export const isConsentRequired = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  // An ApiError (api/errors) carries the server's code as `serverCode`; a raw
  // axios error has it in its response body.
  const code =
    error.serverCode ??
    (isRecord(error.response) && isRecord(error.response.data) ? error.response.data.code : undefined);
  return code === 'GUARDIAN_CONSENT_REQUIRED';
};
