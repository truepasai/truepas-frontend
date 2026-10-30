/**
 * The reservation form's draft, who can go, and what the form sends —
 * pure (no React Native), so it runs under `node --test`
 * (src/features/history/__tests__). ReservationForm.tsx owns the UI.
 *
 * Who can go: you — the account holder, by the `personId` from GET /user/me
 * (never the account `id`) — and the account's family members from
 * GET /family (its non-deleted dependants). The chosen person ids are the
 * reservation's `memberIds`; customer-account-service checks each belongs to
 * the account. The guest count is exactly the people chosen. Choosing someone
 * is never consent to share their documents: the holder's own consent is a
 * separate switch (their documents only), and each other adult decides for
 * themselves (reservationConsent.ts).
 */
import type { Booking, BookingKind, CreateReservationRequest, FamilyMember, UpdateReservationRequest } from '@/types/domain';

export const NOTES_MAX = 500;
/** customer-account-service accepts at most 50 memberIds. */
export const MEMBERS_MAX = 50;

export interface ReservationDraft {
  venue: string;
  /** The picked TruePas venue; null for none or a legacy free-text venue. */
  merchantId: string | null;
  /** Shown only: the server sets it from the venue's category. */
  kind: BookingKind;
  /** One of the venue's locations; null until chosen (and on older reservations). */
  locationId: string | null;
  /** Shown only: the chosen location's name (the server sets it). */
  location: string;
  checkIn: string;
  checkOut: string;
  /** The stored guest count; what is sent is the number of people chosen. */
  guests: number;
  /** Person ids: you and/or family members. */
  memberIds: string[];
  notes: string;
  /** The holder's switch: share their own documents with the other selected
   *  guests' check-ins. Off by default. */
  documentReleaseConsent: boolean;
  /** The venue and dates the switch was turned on for (consentScopeOf): a
   *  consent covers only those, so another venue or other dates show it off
   *  until the holder turns it on again; going back to them restores it. */
  consentScope: string | null;
}

/** The holder's switch as the form shows it, for toCreate / toPatch. */
export interface ConsentChoice {
  /** The venue releases everyone's documents (all_person_documents) and the
   *  holder is selected: the switch can turn consent on. */
  offered: boolean;
  /** The switch as it applies to the draft now (holderConsentOn). */
  on: boolean;
}

export type DraftErrors = Partial<Record<keyof ReservationDraft, string>>;

/** The account holder, who can go on their own reservation too. */
export interface ReservationSelf {
  personId: string;
  name: string;
}

/** Someone who can be chosen: `name` is what the form shows ("You" for the
 *  holder), `detail` their full name or relationship. */
export interface ReservationPerson {
  personId: string;
  name: string;
  detail: string;
  self: boolean;
}

export const EMPTY_DRAFT: ReservationDraft = {
  venue: '',
  merchantId: null,
  kind: 'other',
  locationId: null,
  location: '',
  checkIn: '',
  checkOut: '',
  guests: 1,
  memberIds: [],
  notes: '',
  documentReleaseConsent: false,
  consentScope: null,
};

/** What a consent covers: one venue and one date range. */
export const consentScopeOf = (d: Pick<ReservationDraft, 'merchantId' | 'checkIn' | 'checkOut'>) =>
  `${d.merchantId ?? ''}|${d.checkIn}|${d.checkOut || d.checkIn}`;

/** Another venue or other dates: every consent on the reservation ends. */
export const consentRescoped = (d: ReservationDraft, o: ReservationDraft) => consentScopeOf(d) !== consentScopeOf(o);

/** The holder's switch as it applies now: on only for the venue and dates it
 *  was turned on for, with the holder still selected. */
export function holderConsentOn(d: ReservationDraft, selfPersonId?: string | null): boolean {
  return (
    d.documentReleaseConsent &&
    d.consentScope === consentScopeOf(d) &&
    !!d.merchantId &&
    !!selfPersonId &&
    d.memberIds.includes(selfPersonId)
  );
}

/** Turning the holder's switch on or off, for the venue and dates chosen now. */
export const withHolderConsent = (d: ReservationDraft, on: boolean): ReservationDraft => ({
  ...d,
  documentReleaseConsent: on,
  consentScope: on ? consentScopeOf(d) : null,
});

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** You first, then every family member by their actual name. */
export function reservationPeople(self: ReservationSelf | null, family: FamilyMember[]): ReservationPerson[] {
  const people: ReservationPerson[] = [];
  if (self?.personId) people.push({ personId: self.personId, name: 'You', detail: self.name, self: true });
  for (const m of family) {
    if (!m?.id || !m.name?.trim() || m.id === self?.personId || people.some((p) => p.personId === m.id)) continue;
    people.push({ personId: m.id, name: m.name.trim(), detail: m.relationship ?? '', self: false });
  }
  return people;
}

export function toggleMember(memberIds: string[], personId: string): string[] {
  return memberIds.includes(personId) ? memberIds.filter((x) => x !== personId) : [...memberIds, personId];
}

/** How the form names a chosen person id. */
export function personName(personId: string, people: ReservationPerson[]): string {
  return people.find((p) => p.personId === personId)?.name ?? 'Family member';
}

/** Who's going on an existing reservation, as person ids. On the customer's
 *  own reservation checkedInMembers is exactly its memberIds (checked
 *  upstream), so it does not depend on the family list having loaded; on
 *  older payloads (names, not ids) only ids known to be you or family count. */
export function knownMemberIds(b: Booking, family: FamilyMember[], selfPersonId?: string): string[] {
  const sent = (b as Booking & { memberIds?: unknown }).memberIds;
  if (Array.isArray(sent)) return sent.filter((x): x is string => typeof x === 'string');
  const listed = (b.checkedInMembers ?? []).filter((x): x is string => typeof x === 'string');
  if (b.source === 'customer') return listed;
  const ids = new Set(family.map((m) => m.id));
  if (selfPersonId) ids.add(selfPersonId);
  return listed.filter((x) => ids.has(x));
}

/** False when the reservation says nothing about who's going. */
export function membersKnown(b: Booking, family: FamilyMember[], selfPersonId?: string): boolean {
  return Array.isArray((b as Booking & { memberIds?: unknown }).memberIds) || knownMemberIds(b, family, selfPersonId).length > 0;
}

export function draftFromBooking(b: Booking, kind: BookingKind, family: FamilyMember[], selfPersonId?: string): ReservationDraft {
  const d: ReservationDraft = {
    venue: b.venue ?? '',
    merchantId: b.merchantId ?? null,
    kind,
    locationId: b.locationId ?? null,
    location: b.location ?? '',
    checkIn: (b.checkIn ?? '').slice(0, 10),
    checkOut: (b.checkOut ?? '').slice(0, 10),
    guests: b.guests >= 1 ? b.guests : 1,
    memberIds: knownMemberIds(b, family, selfPersonId),
    notes: b.notes ?? '',
    documentReleaseConsent: false,
    consentScope: null,
  };
  return b.documentReleaseConsent === true ? withHolderConsent(d, true) : d;
}

/** The guest count shown and sent: the people chosen. A reservation that
 *  never recorded who's going keeps its stored count until someone is chosen. */
export const guestsFor = (d: ReservationDraft) => (d.memberIds.length > 0 ? d.memberIds.length : d.guests);

/** Same rules as the backend. `today` is the local YYYY-MM-DD. An unchanged
 *  check-in day is not re-checked: a stay that started yesterday is still an
 *  editable upcoming reservation. Nobody chosen is allowed only on a
 *  reservation that never recorded who's going, left as it was. */
export function validate(d: ReservationDraft, today: string, original?: ReservationDraft, membersUnknown = false): DraftErrors {
  const e: DraftErrors = {};
  if (!d.merchantId) {
    e.venue = original && !original.merchantId
      ? 'Choose your venue from TruePas venues so its kiosk can check you in'
      : 'Choose a venue from the search results';
  } else if (!d.locationId) e.locationId = 'Choose a location';
  const untouchedUnknown = membersUnknown && !!original && sameSet(d.memberIds, original.memberIds);
  if (d.memberIds.length === 0 && !untouchedUnknown) e.memberIds = "Choose who's going";
  else if (d.memberIds.length > MEMBERS_MAX) e.memberIds = `Choose at most ${MEMBERS_MAX} people`;
  if (!d.checkIn) e.checkIn = 'Pick the check-in date';
  else if (d.checkIn < today && d.checkIn !== original?.checkIn) e.checkIn = "Check-in can't be in the past";
  if (d.checkOut && d.checkIn && d.checkOut < d.checkIn) e.checkOut = 'Check-out must be on or after check-in';
  if (d.notes.trim().length > NOTES_MAX) e.notes = `Notes can be up to ${NOTES_MAX} characters`;
  return e;
}

/** Ids only: the venue, kind and location names come from the server. The
 *  guests are the people chosen. The holder's consent goes only when it was
 *  offered and turned on. */
export function toCreate(d: ReservationDraft, consent?: ConsentChoice): CreateReservationRequest {
  const p: CreateReservationRequest = {
    venue: d.venue.trim(),
    merchantId: d.merchantId ?? undefined,
    locationId: d.locationId ?? undefined,
    checkIn: d.checkIn,
    guests: guestsFor(d),
    memberIds: d.memberIds,
  };
  if (d.checkOut) p.checkOut = d.checkOut;
  if (d.notes.trim()) p.notes = d.notes.trim();
  if (consent?.offered && consent.on) p.documentReleaseConsent = true;
  return p;
}

/** Only what changed (PATCH accepts any subset). A change of who's going
 *  sends memberIds with the matching guest count; a stored count that
 *  disagrees with the people chosen is corrected. The holder's consent: on
 *  (where offered) when it wasn't, or again for another venue or other dates
 *  (which end it upstream); off when it was on for this venue and these
 *  dates. Without `consent` (or with it unchanged) nothing about it is sent. */
export function toPatch(d: ReservationDraft, o: ReservationDraft, consent?: ConsentChoice): UpdateReservationRequest {
  const p: UpdateReservationRequest = {};
  // A venue sent without merchantId drops the merchant upstream, so a picked
  // venue always goes with its id (and, being another venue, its location).
  if (d.merchantId !== o.merchantId) {
    p.venue = d.venue.trim();
    if (d.merchantId) p.merchantId = d.merchantId;
  }
  if (d.locationId && d.locationId !== o.locationId) p.locationId = d.locationId;
  if (d.checkIn !== o.checkIn) p.checkIn = d.checkIn;
  if (d.checkOut && d.checkOut !== o.checkOut) p.checkOut = d.checkOut;
  if (!sameSet(d.memberIds, o.memberIds)) p.memberIds = d.memberIds;
  if (guestsFor(d) !== o.guests) p.guests = guestsFor(d);
  if (d.notes.trim() !== o.notes.trim()) p.notes = d.notes.trim();
  if (consent) {
    const rescoped = consentRescoped(d, o);
    if (consent.on && consent.offered && (rescoped || !o.documentReleaseConsent)) p.documentReleaseConsent = true;
    else if (!consent.on && o.documentReleaseConsent && !rescoped) p.documentReleaseConsent = false;
  }
  return p;
}
