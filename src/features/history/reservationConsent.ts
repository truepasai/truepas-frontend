/**
 * Reservation document sharing and each person's real check-in — pure (no
 * React Native), so it runs under `node --test` (src/features/history/__tests__).
 *
 * At a venue whose policy in force is all_person_documents (cruises, once
 * enabled and chosen by the merchant), a check-in may also release the
 * documents of the other people selected on the reservation — each adult's
 * own documents, and only with their own consent: the holder's switch covers
 * the holder alone; every other adult decides for themselves, after a live
 * face check on the holder's phone. Nobody decides for another adult, and a
 * kiosk face scan is never consent.
 *
 * A child's own verified document is shared only at the child's own check-in,
 * and only if their parent or guardian accepted it for that child on this
 * reservation (the holder, in their own session; customer-account-service
 * records it only once the holder's guardianship of the child is verified:
 * GUARDIANSHIP_NOT_VERIFIED otherwise). Each child is decided separately, at
 * any TruePas venue, and never with someone else's check-in.
 * Twins (the family's Twin tag) can't consent this way at all: a face check
 * can't tell them apart, so customer-account-service refuses it
 * (TWIN_CONSENT_UNAVAILABLE) — for a Twin member, and for a holder who is a
 * twin, whose session may have been opened by face sign-in.
 *
 * Who checked in comes from the persisted kiosk check-ins linked to the
 * reservation (each names the person scanned), never from who was selected.
 */
import type { Booking, DocumentAccess, FamilyMember, ReservationConsent, ReservationConsentStatus } from '@/types/domain';

/** The consent text below, by version: customer-account-service refuses a
 *  decision taken on any other, so change both together. */
export const RESERVATION_DOCUMENT_TERMS = 'reservation-documents-2026-11';

export const ADULT_AGE = 18;

/** What a parent accepts for one child (part of RESERVATION_DOCUMENT_TERMS). */
export const CHILD_DOCUMENT_AUTHORIZATION =
  "I authorize TruePas to share my child's verified identity document with the venue for reservation check-in. I understand that the venue will receive the document through the TruePas platform for identity verification and check-in purposes.";

/** customer-account-service: the holder's guardianship of the child isn't verified. */
export const GUARDIANSHIP_NOT_VERIFIED = 'GUARDIANSHIP_NOT_VERIFIED';

/** A family member known to be under 18: their parent or guardian decides. */
export const isChildMember = (member?: Pick<FamilyMember, 'age'> | null) =>
  !!member && typeof member.age === 'number' && member.age >= 0 && member.age < ADULT_AGE;

/** customer-account-service's refusal of face-only consent for twins. */
export const TWIN_CONSENT_UNAVAILABLE = 'TWIN_FACE_CONSENT_UNAVAILABLE';
export const TWIN_CONSENT_MESSAGE =
  "Face-only consent isn't available for twins, because a face check can't tell twins apart. Their documents aren't shared with the other guests' check-ins.";

export const releasesEveryone = (access?: DocumentAccess | null) => access === 'all_person_documents';

/** The consent text, for the holder ("your") or a family member (by name).
 *  `dates` is the reservation's dates as shown. */
export function consentTerms({ venue, dates, name }: { venue: string; dates: string; name?: string }): string[] {
  const whose = name ? `${name}'s` : 'Your';
  const theirs = name ? 'their' : 'your';
  return [
    `What: ${whose} own verified identity documents — the type, masked number, expiry date, verification status and the photo on the document.`,
    `Who sees them: ${venue}, at its check-in kiosk and in its check-in records.`,
    `When: only when someone else selected on this reservation checks in there, between ${dates}.`,
    `Never shared: ${theirs} face scan, full document numbers or other document images, or anything with another venue.`,
    `It covers ${name ? 'only their' : 'only your'} documents. Each adult on the reservation decides for themselves, a parent or guardian decides separately for each child, and a face scan at the kiosk is never consent.`,
    `It ends if the venue or dates change or ${name ? 'they are' : 'you are'} removed from the reservation, and can be withdrawn at any time before a check-in. A release that already happened is not undone.`,
  ];
}

/** What a parent's acceptance for one child covers (after
 *  CHILD_DOCUMENT_AUTHORIZATION), by the child's name. */
export function childConsentTerms({ venue, dates, name }: { venue: string; dates: string; name: string }): string[] {
  return [
    `What: ${name}'s own verified identity document — the type, masked number, expiry date, verification status and the photo on the document. Never yours or anyone else's in its place.`,
    `Who sees it: ${venue}, at its check-in kiosk and in its check-in records, through TruePas.`,
    `When: only when ${name} checks in there on this reservation, between ${dates}. Never with anyone else's check-in.`,
    `Never shared: ${name}'s face scan, full document numbers or other document images, or anything with another venue.`,
    `It covers ${name} only: you decide for each child separately, as their verified parent or guardian. A face scan at the kiosk is never consent.`,
    `It ends if the venue or dates change or ${name} is removed from the reservation, and can be withdrawn at any time before a check-in. A release that already happened is not undone.`,
  ];
}

/** The reservation's document sharing section, in one line. */
export function sharingIntro({ venue, allPerson, anyShared, hasChild }: {
  venue: string; allPerson: boolean; anyShared: boolean; hasChild: boolean;
}): string {
  const adults = allPerson
    ? `When someone on this reservation checks in at ${venue}, the documents of the others who consented themselves are shared too. Choosing someone isn't consent.`
    : `${venue} doesn't share documents between guests' check-ins.${anyShared ? ' Consents still in force can be withdrawn.' : ''}`;
  return hasChild
    ? `${adults} For each child, you decide whether their own verified document is shared when they check in.`
    : adults;
}

/* ───────────────────────── who checked in ───────────────────────── */

const isCheckIn = (row: Booking) => row.source === 'checkin' || (row.source == null && !!row.checkedInAt);

/** Person id → when they checked in (ISO, or null when not recorded), from the
 *  completed kiosk check-ins linked to this reservation. */
export function checkInsOn(reservation: Booking, rows: (Booking | null | undefined)[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const row of rows) {
    if (!row || !isCheckIn(row) || row.status !== 'completed' || row.linkedBookingId !== reservation.id) continue;
    const at = row.checkedInAt ?? null;
    for (const personId of row.checkedInMembers ?? []) {
      if (typeof personId !== 'string') continue;
      const earlier = out.get(personId);
      // The first check-in on it counts.
      if (!out.has(personId) || (at != null && (earlier == null || at < earlier))) out.set(personId, at);
    }
  }
  return out;
}

export type PersonCheckIn = { state: 'checked_in'; at: string | null } | { state: 'not_yet' } | { state: 'missed' };

/** One selected person's own check-in on the reservation. `today` is the
 *  local YYYY-MM-DD. */
export function personCheckIn(personId: string, reservation: Booking, checkIns: Map<string, string | null>, today: string): PersonCheckIn {
  if (checkIns.has(personId)) return { state: 'checked_in', at: checkIns.get(personId) ?? null };
  const lastDay = (reservation.checkOut || reservation.checkIn || '').slice(0, 10);
  const open = reservation.status === 'upcoming' || reservation.status === 'completed';
  return open && lastDay >= today ? { state: 'not_yet' } : { state: 'missed' };
}

export const checkInLabel = (c: PersonCheckIn) =>
  c.state === 'checked_in' ? 'Checked in' : c.state === 'not_yet' ? 'Not checked in yet' : "Didn't check in";

/* ───────────────────────── document sharing ───────────────────────── */

export type SharingState = ReservationConsentStatus | 'not_decided' | 'minor' | 'twin';

export interface PersonSharing {
  state: SharingState;
  /** What the detail screen shows under the person's name. */
  label: string;
  /** Their documents may be released with the others' check-ins. */
  shared: boolean;
  /** A family member who can be asked (or change their decision): an adult
   *  themselves, a child by their parent or guardian (`child`). */
  canDecide: boolean;
  /** A child: the holder decides, as their guardian, about the child's own
   *  document at the child's own check-in. */
  child?: true;
}

const MEMBER_LABEL: Record<SharingState, string> = {
  granted: 'Shares their documents',
  declined: 'Declined — not shared',
  withdrawn: 'Withdrew consent — not shared',
  ended: 'Consent ended when the reservation changed — not shared',
  expired: 'Consent expired — not shared',
  not_decided: "Hasn't decided — not shared",
  minor: 'Not shared',
  twin: "Twin — a face check can't tell twins apart, so not shared",
};

const CHILD_LABEL: Record<SharingState, string> = {
  ...MEMBER_LABEL,
  granted: 'You share their document at their check-in',
  declined: 'You declined — not shared',
  withdrawn: 'You withdrew consent — not shared',
  not_decided: "You haven't decided — not shared",
};

/** A family member selected on the reservation: their own latest decision,
 *  or for a child their parent or guardian's. A Twin can't be asked; one
 *  consent from before they were tagged stays withdrawable. */
export function memberSharing(
  member: Pick<FamilyMember, 'id' | 'age' | 'isTwin'> | undefined,
  consents: ReservationConsent[],
): PersonSharing {
  const child = isChildMember(member);
  if (!member || (!child && !(member.age >= ADULT_AGE))) {
    return { state: 'minor', label: MEMBER_LABEL.minor, shared: false, canDecide: false };
  }
  const state: SharingState = consents.find((c) => c.personId === member.id)?.status ?? 'not_decided';
  if (member.isTwin === true && state !== 'granted') {
    return { state: 'twin', label: MEMBER_LABEL.twin, shared: false, canDecide: false };
  }
  const labels = child ? CHILD_LABEL : MEMBER_LABEL;
  return {
    state, label: labels[state] ?? labels.not_decided, shared: state === 'granted', canDecide: true,
    ...(child ? { child: true as const } : {}),
  };
}

/** The holder: their own switch on the reservation. */
export function holderSharing(reservation: Pick<Booking, 'documentReleaseConsent'>): PersonSharing {
  const on = reservation.documentReleaseConsent === true;
  return {
    state: on ? 'granted' : 'not_decided',
    label: on ? 'You share your documents' : "You don't share your documents",
    shared: on,
    canDecide: false,
  };
}
