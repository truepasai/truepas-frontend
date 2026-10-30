/** @jsxImportSource react */
/**
 * Reservation form — shared by /booking/new (POST /bookings) and
 * /booking/[id]/edit (PATCH, changed fields only), in five steps:
 *  1. Venue — a TruePas merchant picked from GET /merchants (a kiosk only
 *     matches a reservation that carries its merchantId).
 *  2. Location — one of that venue's active locations,
 *     GET /merchants/{merchantId}/locations. Changing the venue clears it.
 *  3. Who's going — you and your family members by name (memberIds); the
 *     guest count is exactly the people chosen.
 *  4. Dates — check-in a local YYYY-MM-DD not in the past ("today" is fine),
 *     check-out optional and on or after check-in.
 *  5. Review — every choice, notes, save. At a venue that releases everyone's
 *     documents (documentAccess all_person_documents) with you selected, a
 *     switch asks for your own consent to share your documents with the
 *     other selected guests' check-ins — off by default, your documents
 *     only; each other adult decides for themselves from the reservation.
 * The venue's name, the reservation kind (from the venue's category) and the
 * location's name are set by the BFF from the merchant's own profile; the
 * app sends ids only. Editing opens on the review step. Draft, validation
 * and payloads live in reservationDraft.ts (unit-tested). Server field
 * errors land on their step, anything else (409 RESERVATION_LIMIT, 404
 * member, 422 CONSENT_*) shows in the banner. Choosing who is going is not
 * consent to release anyone's documents. Check-in itself only ever happens at
 * the venue kiosk.
 */
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { Keyboard, Pressable, TextInput, View, type TextStyle } from 'react-native';

import { toApiError } from '@/api/errors';
import { VENUE_SEARCH_MIN, useMerchant, useMerchantLocations, useVenueSearch } from '@/features/history/hooks';
import {
  TWIN_CONSENT_MESSAGE,
  TWIN_CONSENT_UNAVAILABLE,
  consentTerms,
  releasesEveryone,
} from '@/features/history/reservationConsent';
import {
  NOTES_MAX,
  consentRescoped,
  draftFromBooking as draftFrom,
  guestsFor,
  holderConsentOn,
  personName,
  reservationPeople,
  toCreate,
  toPatch,
  toggleMember,
  validate,
  withHolderConsent,
  type DraftErrors,
  type ReservationDraft,
  type ReservationPerson,
  type ReservationSelf,
} from '@/features/history/reservationDraft';
import { DateField } from '@/premium/flows/family';
import { KIND_META, bookingKind, fmtDay, isoDay } from '@/premium/flows/home';
import { Banner, Spinner } from '@/premium/kit';
import { C, F, R } from '@/premium/theme';
import { Button, Card, Field, Group, Heading, ListRow, Row, Screen, Steps, TextLink, Toggle, TopBar, Txt } from '@/premium/ui';
import type {
  Booking,
  CreateReservationRequest,
  DocumentAccess,
  FamilyMember,
  MerchantLocation,
  MerchantSummary,
  UpdateReservationRequest,
} from '@/types/domain';

export { EMPTY_DRAFT, membersKnown, NOTES_MAX } from '@/features/history/reservationDraft';
export type { ReservationDraft, ReservationSelf } from '@/features/history/reservationDraft';

/** An existing booking as the form's starting draft. */
export const draftFromBooking = (b: Booking, family: FamilyMember[], selfPersonId?: string): ReservationDraft =>
  draftFrom(b, bookingKind(b), family, selfPersonId);

/** GET /family as the form sees it: still loading, failed, or loaded. */
export interface FamilyState {
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
}

/** The family query (useFamily) as a FamilyState: loaded once it has data;
 *  failed only when it has none and is not retrying. */
export function familyStateOf(q: { data?: unknown; isError: boolean; isFetching: boolean; refetch: () => unknown }): FamilyState {
  const status = q.data != null ? 'ready' : q.isError && !q.isFetching ? 'error' : 'loading';
  return { status, retry: () => void q.refetch() };
}

type FieldKey = keyof ReservationDraft;
type Errors = DraftErrors;

const STEPS = ['venue', 'location', 'people', 'dates', 'review'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, string> = {
  venue: 'Venue',
  location: 'Location',
  people: "Who's going",
  dates: 'Dates',
  review: 'Review',
};

/** Which step owns each field (where its error is shown). */
const STEP_OF: Record<FieldKey, Step> = {
  venue: 'venue',
  merchantId: 'venue',
  kind: 'venue',
  locationId: 'location',
  location: 'location',
  memberIds: 'people',
  guests: 'people',
  checkIn: 'dates',
  checkOut: 'dates',
  notes: 'review',
  documentReleaseConsent: 'review',
  consentScope: 'review',
};

const errorsOf = (errors: Errors, step: Step): Errors =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => STEP_OF[k as FieldKey] === step)) as Errors;

const firstStepWith = (errors: Errors): Step | undefined => STEPS.find((s) => Object.keys(errorsOf(errors, s)).length > 0);

/** 422 field names (camelCase or snake_case) → form fields. */
const FIELD_OF: Record<string, FieldKey> = {
  venue: 'venue',
  // 422 MERCHANT_UNAVAILABLE: the picked venue was removed or deactivated.
  merchantId: 'venue',
  merchant_id: 'venue',
  // 422 LOCATION_REQUIRED / LOCATION_UNAVAILABLE.
  locationId: 'locationId',
  location_id: 'locationId',
  location: 'locationId',
  checkIn: 'checkIn',
  check_in: 'checkIn',
  checkOut: 'checkOut',
  check_out: 'checkOut',
  guests: 'memberIds',
  memberIds: 'memberIds',
  member_ids: 'memberIds',
  notes: 'notes',
  // 422 CONSENT_NEEDS_HOLDER / CONSENT_NEEDS_MERCHANT / CONSENT_NOT_OFFERED.
  documentReleaseConsent: 'documentReleaseConsent',
};

const HEADINGS: Record<Step, { title: string; accent: string; sub: string }> = {
  venue: { title: 'Where are you', accent: 'going?', sub: 'Choose a TruePas venue. You check in at its kiosk.' },
  location: { title: 'Which', accent: 'location?', sub: 'Choose the location of the venue you are going to.' },
  people: { title: "Who's", accent: 'going?', sub: 'Choose yourself and the family members on this reservation.' },
  dates: { title: 'When are you', accent: 'going?', sub: 'Check-out is optional for a single day.' },
  review: { title: 'Review your', accent: 'reservation', sub: 'Check the details, then save. You still check in at the venue kiosk.' },
};

const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'} going`;

export type SubmitResult = { ok: true } | { ok: false; error: unknown };

export function ReservationForm({
  mode,
  initial,
  family,
  familyState,
  self,
  saving,
  onCreate,
  onUpdate,
  membersUnknown,
}: {
  mode: 'create' | 'edit';
  initial: ReservationDraft;
  family: FamilyMember[];
  /** Whether GET /family is loading, failed or loaded: never hidden. */
  familyState: FamilyState;
  /** The signed-in holder (GET /user/me personId); null while unknown. */
  self: ReservationSelf | null;
  saving: boolean;
  onCreate?: (payload: CreateReservationRequest) => Promise<SubmitResult>;
  /** Called with an empty patch when nothing changed. */
  onUpdate?: (patch: UpdateReservationRequest) => Promise<SubmitResult>;
  /** Editing a booking that never recorded who's going: left as is, nothing
   *  about the people is sent. */
  membersUnknown?: boolean;
}) {
  const editing = mode === 'edit';
  const [d, setD] = useState<ReservationDraft>(initial);
  const [step, setStep] = useState<Step>(editing ? 'review' : 'venue');
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  // Results show once the user types in the venue field, until a pick.
  const [venueTyped, setVenueTyped] = useState(false);
  const venueSearch = useVenueSearch(d.venue, venueTyped && !d.merchantId);
  const locations = useMerchantLocations(d.merchantId);
  // Whose documents the venue's check-ins may release: from the search pick,
  // else (editing, or a pick without it) GET /merchants/{id}.
  const [pickedAccess, setPickedAccess] = useState<{ merchantId: string; access: DocumentAccess } | null>(null);
  const knownAccess = pickedAccess && pickedAccess.merchantId === d.merchantId ? pickedAccess.access : undefined;
  const merchant = useMerchant(knownAccess ? null : d.merchantId);
  const access = knownAccess ?? merchant.data?.documentAccess;
  const index = STEPS.indexOf(step);
  const people = reservationPeople(self, family);
  // The holder's own consent: offered at a venue that releases everyone's
  // documents with you selected; an existing one can always be withdrawn.
  const selfId = self?.personId ?? null;
  const holderSelected = !!selfId && d.memberIds.includes(selfId);
  // The server refused it because you are a twin (a face check can't tell
  // twins apart): not offered again in this form.
  const [holderTwin, setHolderTwin] = useState(false);
  const consentOffered = releasesEveryone(access) && holderSelected && !!d.merchantId && !holderTwin;
  const consentOn = holderConsentOn(d, selfId);
  const consentWasOn = editing && initial.documentReleaseConsent;
  const consentEnded = consentWasOn && consentRescoped(d, initial);
  const consentShown = consentOffered || (consentWasOn && holderSelected && !consentEnded);
  const consent = { offered: consentOffered, on: consentOn };

  const set = <K extends FieldKey>(k: K, v: ReservationDraft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  /** Typing searches again and drops any picked venue, and its location. */
  const typeVenue = (t: string) => {
    setD((prev) => ({ ...prev, venue: t, merchantId: null, locationId: null, location: '' }));
    setVenueTyped(true);
    if (errors.venue) setErrors((prev) => ({ ...prev, venue: undefined }));
  };

  /** Another venue clears the previous one's location. */
  const pickVenue = (m: MerchantSummary) => {
    if (m.documentAccess) setPickedAccess({ merchantId: m.merchantId, access: m.documentAccess });
    setD((prev) => ({
      ...prev,
      venue: m.businessName,
      merchantId: m.merchantId,
      kind: m.category ?? 'other',
      ...(prev.merchantId !== m.merchantId ? { locationId: null, location: '' } : {}),
    }));
    setVenueTyped(false);
    if (errors.venue) setErrors((prev) => ({ ...prev, venue: undefined }));
    Keyboard.dismiss();
  };

  const pickLocation = (l: MerchantLocation) => {
    setD((prev) => ({ ...prev, locationId: l.locationId, location: l.name }));
    if (errors.locationId) setErrors((prev) => ({ ...prev, locationId: undefined }));
  };

  const toggle = (personId: string) => set('memberIds', toggleMember(d.memberIds, personId));

  const check = () => validate(d, isoDay(), editing ? initial : undefined, membersUnknown);

  const go = (next: Step) => {
    setBanner(null);
    setStep(next);
  };

  const nextStep = () => {
    const stepErrors = errorsOf(check(), step);
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    if (Object.keys(stepErrors).length > 0) return;
    go(STEPS[index + 1]);
  };

  const submit = async () => {
    setBanner(null);
    const all = check();
    setErrors(all);
    const failing = firstStepWith(all);
    if (failing) {
      setStep(failing);
      return;
    }

    const result = editing ? await onUpdate?.(toPatch(d, initial, consent)) : await onCreate?.(toCreate(d, consent));
    if (!result || result.ok) return;

    const err = toApiError(result.error);
    const fieldErrors: Errors = {};
    const loose: string[] = [];
    for (const [k, msg] of Object.entries(err.fieldErrors ?? {})) {
      const f = FIELD_OF[k];
      if (f) fieldErrors[f] = msg;
      else if (msg) loose.push(msg);
    }
    setErrors(fieldErrors);
    if (err.serverCode === 'MERCHANT_UNAVAILABLE') {
      // The picked venue is gone: drop it (and its location), search again.
      setD((prev) => ({ ...prev, merchantId: null, locationId: null, location: '' }));
      setVenueTyped(true);
    } else if (err.serverCode === 'LOCATION_REQUIRED' || err.serverCode === 'LOCATION_UNAVAILABLE') {
      setD((prev) => ({ ...prev, locationId: null, location: '' }));
      void locations.refetch();
    } else if (err.serverCode === TWIN_CONSENT_UNAVAILABLE) {
      setHolderTwin(true);
      setD((prev) => withHolderConsent(prev, false));
    } else if (err.serverCode === 'CONSENT_NOT_OFFERED') {
      // The venue stopped releasing everyone's documents: re-read its policy.
      setPickedAccess(null);
      void merchant.refetch();
    }
    const failingStep = firstStepWith(fieldErrors);
    if (failingStep) setStep(failingStep);
    const mapped = Object.keys(fieldErrors).length > 0;
    setBanner(loose.length > 0 ? loose.join('\n') : mapped ? null : err.message);
  };

  // Clearing an existing check-out isn't in the PATCH contract (string only).
  const canClearCheckOut = !!d.checkOut && !(editing && initial.checkOut);
  const today = isoDay();
  const heading = step === 'review' && editing ? { ...HEADINGS.review, title: 'Edit your' } : HEADINGS[step];
  const chosenLocation = (locations.data ?? []).find((l) => l.locationId === d.locationId);
  const nobodyRecorded = membersUnknown && d.memberIds.length === 0;

  const footer =
    step === 'review' ? (
      <Row gap={10}>
        {!editing && <Button label="Back" tone="white" full={false} onPress={() => go('dates')} />}
        <Button
          label={editing ? 'Save changes' : 'Save reservation'}
          icon={Check}
          loading={saving}
          disabled={saving}
          style={{ flex: 1 }}
          onPress={() => void submit()}
        />
      </Row>
    ) : (
      <Row gap={10}>
        {index > 0 && <Button label="Back" tone="white" full={false} onPress={() => go(STEPS[index - 1])} />}
        <Button label="Next" iconRight={ChevronRight} style={{ flex: 1 }} onPress={nextStep} />
      </Row>
    );

  return (
    <Screen
      keyboard
      header={<TopBar title={editing ? 'Edit reservation' : 'Add reservation'} />}
      contentStyle={{ paddingTop: 8, gap: 24 }}
      footer={footer}
    >
      <View
        style={{ gap: 8 }}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${index + 1} of ${STEPS.length}: ${STEP_TITLE[step]}`}
        accessibilityValue={{ min: 1, max: STEPS.length, now: index + 1 }}
      >
        <Steps total={STEPS.length} current={index} />
        <Txt v="small">{`Step ${index + 1} of ${STEPS.length} · ${STEP_TITLE[step]}`}</Txt>
      </View>

      <Heading title={heading.title} accent={heading.accent} sub={heading.sub} />

      {banner != null && <Banner tone="error" title={editing ? "Couldn't save changes" : "Couldn't add the reservation"} body={banner} />}

      {step === 'venue' && (
        <View style={{ gap: 10 }}>
          <Field
            label="Venue"
            icon={Building2}
            placeholder="Search TruePas venues"
            value={d.venue}
            onChangeText={typeVenue}
            error={errors.venue}
            hint={
              d.merchantId
                ? `${KIND_META[d.kind].label === 'Other' ? 'TruePas venue' : KIND_META[d.kind].label} selected.`
                : !venueSearch.active
                  ? `Type at least ${VENUE_SEARCH_MIN} characters, then choose your venue from the list.`
                  : undefined
            }
            right={
              d.merchantId ? (
                <BadgeCheck size={19} color={C.green} strokeWidth={2.2} />
              ) : venueSearch.searching ? (
                <Spinner size={18} />
              ) : undefined
            }
            inputProps={{ autoCapitalize: 'words', maxLength: 120, autoComplete: 'off', autoCorrect: false }}
          />
          {venueSearch.active && (
            <VenueResults
              query={d.venue.trim()}
              results={venueSearch.results}
              searching={venueSearch.searching}
              failed={venueSearch.failed}
              onPick={pickVenue}
              onRetry={venueSearch.retry}
            />
          )}
        </View>
      )}

      {step === 'location' && (
        <LocationSelect
          venue={d.venue}
          locations={locations.data}
          loading={locations.isPending && !!d.merchantId}
          failed={locations.isError}
          selectedId={d.locationId}
          selectedName={d.location}
          error={errors.locationId}
          onPick={pickLocation}
          onRetry={() => void locations.refetch()}
          onChangeVenue={() => go('venue')}
        />
      )}

      {step === 'people' && (
        <PeoplePicker
          people={people}
          selected={d.memberIds}
          familyState={familyState}
          selfKnown={!!self}
          error={errors.memberIds}
          hint={
            nobodyRecorded
              ? "This reservation doesn't say who's going. Leave it as is, or choose who's going."
              : "The venue's kiosk checks in only the people chosen here. Choosing someone doesn't share their documents."
          }
          onToggle={toggle}
        />
      )}

      {step === 'dates' && (
        <View style={{ gap: 18 }}>
          <DateField
            label="Check-in"
            value={d.checkIn || undefined}
            onChange={(iso) => {
              set('checkIn', iso);
              if (d.checkOut && d.checkOut < iso) set('checkOut', '');
            }}
            placeholder="Select date"
            minDate={today}
            error={errors.checkIn}
          />
          <View>
            <DateField
              label="Check-out (optional)"
              value={d.checkOut || undefined}
              onChange={(iso) => set('checkOut', iso)}
              placeholder="Select date"
              minDate={d.checkIn && d.checkIn > today ? d.checkIn : today}
              error={errors.checkOut}
            />
            {canClearCheckOut && (
              <View style={{ position: 'absolute', right: 2, top: 0 }}>
                <TextLink label="Clear" onPress={() => set('checkOut', '')} />
              </View>
            )}
          </View>
        </View>
      )}

      {step === 'review' && (
        <View style={{ gap: 24 }}>
          <Group>
            <ListRow
              icon={Building2}
              tone="sky"
              title={d.venue || 'Choose a venue'}
              sub={d.merchantId ? KIND_META[d.kind].label : 'Not a TruePas venue yet'}
              onPress={() => go('venue')}
            />
            <ListRow
              icon={MapPin}
              tone="sky"
              title={d.locationId ? (chosenLocation?.name ?? d.location) || 'Location chosen' : 'Choose a location'}
              sub={chosenLocation?.address || undefined}
              fullSub
              onPress={() => go(d.merchantId ? 'location' : 'venue')}
            />
            <ListRow
              icon={Users}
              tone="sky"
              title={
                d.memberIds.length > 0
                  ? d.memberIds.map((id) => personName(id, people)).join(', ')
                  : nobodyRecorded ? 'Not recorded' : "Choose who's going"
              }
              sub={d.memberIds.length > 0 ? peopleCount(d.memberIds.length) : nobodyRecorded ? `${guestsFor(d)} guests` : undefined}
              onPress={() => go('people')}
            />
            <ListRow
              icon={CalendarDays}
              tone="sky"
              title={d.checkIn ? reviewDates(d) : 'Choose the dates'}
              sub={d.checkOut ? undefined : 'Single day'}
              onPress={() => go('dates')}
            />
          </Group>
          {consentShown && (
            <HolderConsent
              on={consentOn}
              venue={d.venue}
              dates={reviewDates(d)}
              error={errors.documentReleaseConsent}
              onChange={(on) => {
                setD((prev) => withHolderConsent(prev, on));
                if (errors.documentReleaseConsent) setErrors((prev) => ({ ...prev, documentReleaseConsent: undefined }));
              }}
            />
          )}
          {holderTwin && (
            <Txt v="small" color={C.redInk} style={{ paddingHorizontal: 4 }}>
              {`${TWIN_CONSENT_MESSAGE} Save without it, or go back.`}
            </Txt>
          )}
          {consentEnded && holderSelected && (
            <Txt v="small" style={{ paddingHorizontal: 4 }}>
              {consentShown
                ? 'Your consent to share your documents covered the original venue and dates. Turn it on again to share them for these.'
                : 'Your consent to share your documents ends with this change of venue or dates.'}
            </Txt>
          )}
          <NotesField value={d.notes} onChange={(t) => set('notes', t)} error={errors.notes} />
        </View>
      )}
    </Screen>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

const reviewDates = (d: ReservationDraft) =>
  d.checkOut && d.checkOut !== d.checkIn ? `${fmtDay(d.checkIn)} – ${fmtDay(d.checkOut)}` : fmtDay(d.checkIn);

/** The holder's own consent: off by default, their documents only, with what
 *  it shares, with whom and when (the same terms each other adult reviews). */
function HolderConsent({
  on,
  venue,
  dates,
  error,
  onChange,
}: {
  on: boolean;
  venue: string;
  dates: string;
  error?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Card pad={16} style={error ? { borderColor: C.red } : undefined}>
      <View style={{ gap: 12 }}>
        <Row gap={12} align="flex-start">
          <ShieldCheck size={20} color={C.skyPressed} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt v="bodyStrong">{"Share my documents with the others' check-ins"}</Txt>
            <Txt v="small">
              {"This covers only your own documents, not anyone else's. Each adult going decides about their own " +
                'documents themselves, from the reservation.'}
            </Txt>
          </View>
          <Toggle on={on} onChange={onChange} label="Share my documents with the other guests' check-ins" />
        </Row>
        <View style={{ gap: 6 }}>
          {consentTerms({ venue, dates }).map((line) => (
            <Txt key={line} v="small" color={C.ink3}>
              {`• ${line}`}
            </Txt>
          ))}
        </View>
        {!!error && (
          <Txt v="small" color={C.redInk}>
            {error}
          </Txt>
        )}
      </View>
    </Card>
  );
}

/** Matches under the venue field; pressing one picks it. */
function VenueResults({
  query,
  results,
  searching,
  failed,
  onPick,
  onRetry,
}: {
  query: string;
  results: MerchantSummary[];
  searching: boolean;
  failed: boolean;
  onPick: (m: MerchantSummary) => void;
  onRetry: () => void;
}) {
  if (results.length > 0) {
    return (
      <Group>
        {results.map((m) => (
          <ListRow
            key={m.merchantId}
            icon={m.category ? KIND_META[m.category].icon : Building2}
            tone="sky"
            title={m.businessName}
            sub={m.category ? KIND_META[m.category].label : undefined}
            chevron={false}
            onPress={() => onPick(m)}
          />
        ))}
      </Group>
    );
  }
  if (failed) {
    return (
      <Row gap={8} style={{ flexWrap: 'wrap', paddingHorizontal: 4 }}>
        <Txt v="small" color={C.redInk}>
          {"Couldn't search venues."}
        </Txt>
        <TextLink label="Try again" onPress={onRetry} />
      </Row>
    );
  }
  return (
    <Txt v="small" style={{ paddingHorizontal: 4 }}>
      {searching ? 'Searching venues…' : `No TruePas venue matches "${query}".`}
    </Txt>
  );
}

/** A dropdown of the venue's active locations: the closed field shows the
 *  choice; opening it lists every location as a radio option. */
function LocationSelect({
  venue,
  locations,
  loading,
  failed,
  selectedId,
  selectedName,
  error,
  onPick,
  onRetry,
  onChangeVenue,
}: {
  venue: string;
  locations: MerchantLocation[] | undefined;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  selectedName: string;
  error?: string;
  onPick: (l: MerchantLocation) => void;
  onRetry: () => void;
  onChangeVenue: () => void;
}) {
  const [open, setOpen] = useState(!selectedId);
  const selected = locations?.find((l) => l.locationId === selectedId);
  const label = selected?.name ?? (selectedId ? selectedName : '');

  if (loading) {
    return (
      <Row gap={10} style={{ paddingHorizontal: 4 }}>
        <Spinner size={18} />
        <Txt v="small">{`Loading ${venue}'s locations…`}</Txt>
      </Row>
    );
  }
  if (failed) {
    return (
      <Row gap={8} style={{ flexWrap: 'wrap', paddingHorizontal: 4 }}>
        <Txt v="small" color={C.redInk}>
          {"Couldn't load the locations."}
        </Txt>
        <TextLink label="Try again" onPress={onRetry} />
      </Row>
    );
  }
  if (!locations || locations.length === 0) {
    return (
      <View style={{ gap: 8, paddingHorizontal: 4 }}>
        <Txt v="small" color={error ? C.redInk : C.ink3}>
          {`${venue} has no locations open for reservations yet.`}
        </Txt>
        <TextLink label="Choose another venue" onPress={onChangeVenue} />
      </View>
    );
  }

  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={{ gap: 10 }}>
      <Txt v="smallStrong" color={C.ink2}>
        Location
      </Txt>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`Location: ${label || 'not chosen'}`}
        accessibilityHint={open ? 'Hides the locations' : `Shows ${venue}'s locations`}
        aria-expanded={open}
      >
        <View
          style={{
            minHeight: 56,
            borderRadius: R.md,
            backgroundColor: C.surface,
            borderWidth: 1.5,
            borderColor: error ? C.red : open ? C.sky : C.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <MapPin size={18} color={C.ink3} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="bodyStrong" color={label ? C.ink : C.ink4}>
              {label || 'Choose a location'}
            </Txt>
            {!!selected?.address && <Txt v="small">{selected.address}</Txt>}
          </View>
          <Chevron size={18} color={C.ink3} />
        </View>
      </Pressable>
      {open && (
        <Group>
          {locations.map((l) => {
            const on = l.locationId === selectedId;
            return (
              <Pressable
                key={l.locationId}
                onPress={() => {
                  onPick(l);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityLabel={l.address ? `${l.name}, ${l.address}` : l.name}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt v="bodyStrong">{l.name}</Txt>
                    {!!l.address && <Txt v="small">{l.address}</Txt>}
                  </View>
                  {on && <Check size={18} color={C.skyPressed} strokeWidth={2.4} />}
                </View>
              </Pressable>
            );
          })}
        </Group>
      )}
      {!!error && (
        <Txt v="small" color={C.redInk}>
          {error}
        </Txt>
      )}
    </View>
  );
}

/** You and every family member as a checklist; the family list's loading,
 *  failure and emptiness are always shown, never silently hidden. */
function PeoplePicker({
  people,
  selected,
  familyState,
  selfKnown,
  error,
  hint,
  onToggle,
}: {
  people: ReservationPerson[];
  selected: string[];
  familyState: FamilyState;
  selfKnown: boolean;
  error?: string;
  hint: string;
  onToggle: (personId: string) => void;
}) {
  const familyCount = people.filter((p) => !p.self).length;
  // Chosen people the list can't name yet (family still loading or failed),
  // or no longer in the family: kept as they are, counted here.
  const unnamed = selected.filter((id) => !people.some((p) => p.personId === id)).length;
  return (
    <View style={{ gap: 12 }}>
      <Row between>
        <Txt v="smallStrong" color={C.ink2}>
          {"Who's going"}
        </Txt>
        <Txt v="smallStrong" color={selected.length > 0 ? C.skyPressed : C.ink4}>
          {peopleCount(selected.length)}
        </Txt>
      </Row>

      {people.length > 0 && (
        <Group>
          {people.map((p) => {
            const on = selected.includes(p.personId);
            return (
              <Pressable
                key={p.personId}
                onPress={() => onToggle(p.personId)}
                accessibilityRole="checkbox"
                aria-checked={on}
                accessibilityLabel={p.self ? `You, ${p.detail}` : p.detail ? `${p.name}, ${p.detail}` : p.name}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      borderWidth: 2,
                      borderColor: on ? C.sky : C.line,
                      backgroundColor: on ? C.sky : C.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on && <Check size={15} color={C.white} strokeWidth={3} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt v="bodyStrong" color={on ? C.ink : C.ink2}>
                      {p.name}
                    </Txt>
                    {!!p.detail && <Txt v="small">{p.detail}</Txt>}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </Group>
      )}

      {familyState.status === 'loading' && (
        <Row gap={10} style={{ paddingHorizontal: 4 }}>
          <Spinner size={18} />
          <Txt v="small">Loading your family members…</Txt>
        </Row>
      )}
      {familyState.status === 'error' && (
        <Row gap={8} style={{ flexWrap: 'wrap', paddingHorizontal: 4 }}>
          <Txt v="small" color={C.redInk}>
            {"Couldn't load your family members."}
          </Txt>
          <TextLink label="Try again" onPress={familyState.retry} />
        </Row>
      )}
      {familyState.status === 'ready' && familyCount === 0 && (
        <Txt v="small" style={{ paddingHorizontal: 4 }}>
          {selfKnown
            ? 'Only you can be added: there are no family members on your account yet. Add them in Family.'
            : 'There are no family members on your account yet. Add them in Family.'}
        </Txt>
      )}
      {unnamed > 0 && (
        <Txt v="small" style={{ paddingHorizontal: 4 }}>
          {familyState.status === 'ready'
            ? `${unnamed} more ${unnamed === 1 ? 'person is' : 'people are'} on this reservation who ${unnamed === 1 ? 'is' : 'are'} no longer in your family.`
            : `${unnamed} more ${unnamed === 1 ? 'person' : 'people'} on this reservation will show once your family list loads.`}
        </Txt>
      )}

      <Txt v="small" color={error ? C.redInk : C.ink3} style={{ paddingHorizontal: 4 }}>
        {error ?? hint}
      </Txt>
    </View>
  );
}

function NotesField({ value, onChange, error }: { value: string; onChange: (t: string) => void; error?: string }) {
  const [focus, setFocus] = useState(false);
  const over = value.trim().length > NOTES_MAX;
  return (
    <View style={{ gap: 8 }}>
      <Row between>
        <Txt v="smallStrong" color={C.ink2}>
          Notes (optional)
        </Txt>
        <Txt v="small" color={over ? C.redInk : C.ink4}>
          {value.length}/{NOTES_MAX}
        </Txt>
      </Row>
      <View
        style={[
          {
            minHeight: 112,
            borderRadius: R.md,
            backgroundColor: C.surface,
            borderWidth: 1.5,
            borderColor: error ? C.red : focus ? C.sky : C.line,
            paddingHorizontal: 16,
            paddingVertical: 12,
          },
          focus && !error && { boxShadow: '0px 0px 0px 4px rgba(8,182,252,0.14)' },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          multiline
          maxLength={NOTES_MAX}
          placeholder="e.g. Room booked via travel agent"
          placeholderTextColor={C.ink4}
          accessibilityLabel="Notes"
          textAlignVertical="top"
          style={{ minHeight: 88, fontFamily: F.semibold, fontSize: 15, lineHeight: 21, color: C.ink, outlineStyle: 'none' } as unknown as TextStyle}
        />
      </View>
      {!!error && (
        <Txt v="small" color={C.redInk}>
          {error}
        </Txt>
      )}
    </View>
  );
}
