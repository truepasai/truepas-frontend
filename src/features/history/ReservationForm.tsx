/** @jsxImportSource react */
/**
 * Reservation form (BACKEND_UPDATE_2026-10 §8.3) — shared by
 * /booking/new (POST /bookings) and /booking/[id]/edit (PATCH, changed
 * fields only). Client checks mirror the backend's 422 rules: venue
 * required, check-in a local YYYY-MM-DD not in the past ("today" is fine),
 * check-out on or after check-in, 1–100 guests, notes up to 500 characters.
 * Server field errors land on their fields; anything else (409
 * RESERVATION_LIMIT, 404 member) shows in the banner. Check-in itself only
 * ever happens at the venue kiosk.
 *
 * The venue is a TruePas merchant picked from GET /merchants: a kiosk can
 * only match a reservation that carries its merchantId. New reservations
 * need a pick; typing after a pick drops it. A legacy free-text venue
 * still edits as before unless the user picks one.
 */
import { BadgeCheck, Building2, Check, MapPin, Minus, Plus, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View, type TextStyle } from 'react-native';

import { toApiError } from '@/api/errors';
import { VENUE_SEARCH_MIN, useVenueSearch } from '@/features/history/hooks';
import { BOOKING_KINDS, KIND_META, bookingKind, isoDay } from '@/premium/flows/home';
import { DateField } from '@/premium/flows/family';
import { Banner, Spinner } from '@/premium/kit';
import { C, F, R } from '@/premium/theme';
import { Button, Chip, Field, Group, Heading, ListRow, Row, Screen, TextLink, TopBar, Txt } from '@/premium/ui';
import type {
  Booking,
  BookingKind,
  CreateReservationRequest,
  FamilyMember,
  MerchantSummary,
  UpdateReservationRequest,
} from '@/types/domain';

export const NOTES_MAX = 500;
const GUESTS_MIN = 1;
const GUESTS_MAX = 100;

export interface ReservationDraft {
  venue: string;
  /** The picked TruePas venue; null for none or a legacy free-text venue. */
  merchantId: string | null;
  location: string;
  kind: BookingKind;
  checkIn: string;
  checkOut: string;
  guests: number;
  memberIds: string[];
  notes: string;
}

type FieldKey = keyof ReservationDraft;
type Errors = Partial<Record<FieldKey, string>>;

export const EMPTY_DRAFT: ReservationDraft = {
  venue: '',
  merchantId: null,
  location: '',
  kind: 'other',
  checkIn: '',
  checkOut: '',
  guests: 1,
  memberIds: [],
  notes: '',
};

/** Who's going on an existing reservation. The Booking payload has no
 *  `memberIds` in the documented shape; use it when the server sends it,
 *  else the person ids in checkedInMembers that are family members. */
export function knownMemberIds(b: Booking, family: FamilyMember[]): string[] {
  const sent = (b as Booking & { memberIds?: unknown }).memberIds;
  if (Array.isArray(sent)) return sent.filter((x): x is string => typeof x === 'string');
  const ids = new Set(family.map((m) => m.id));
  return (b.checkedInMembers ?? []).filter((x) => ids.has(x));
}

/** False when the payload says nothing about who's going (no memberIds and
 *  no family ids in checkedInMembers) — the form then can't show it. */
export function membersKnown(b: Booking, family: FamilyMember[]): boolean {
  return Array.isArray((b as Booking & { memberIds?: unknown }).memberIds) || knownMemberIds(b, family).length > 0;
}

export function draftFromBooking(b: Booking, family: FamilyMember[]): ReservationDraft {
  return {
    venue: b.venue ?? '',
    merchantId: b.merchantId ?? null,
    location: b.location ?? '',
    kind: bookingKind(b),
    checkIn: (b.checkIn ?? '').slice(0, 10),
    checkOut: (b.checkOut ?? '').slice(0, 10),
    guests: b.guests >= GUESTS_MIN ? b.guests : GUESTS_MIN,
    memberIds: knownMemberIds(b, family),
    notes: b.notes ?? '',
  };
}

/** A new reservation, or one already at a TruePas venue, needs a picked
 *  venue; a legacy free-text one may keep free text. */
const needsVenuePick = (original?: ReservationDraft) => !original || !!original.merchantId;

/** Same rules as the backend. An unchanged check-in day is not re-checked:
 *  a stay that started yesterday is still an editable upcoming reservation. */
function validate(d: ReservationDraft, original?: ReservationDraft): Errors {
  const e: Errors = {};
  if (needsVenuePick(original)) {
    if (!d.merchantId) e.venue = 'Choose a venue from the search results';
  } else if (!d.venue.trim()) e.venue = 'Enter the venue name';
  if (!d.checkIn) e.checkIn = 'Pick the check-in date';
  else if (d.checkIn < isoDay() && d.checkIn !== original?.checkIn) e.checkIn = "Check-in can't be in the past";
  if (d.checkOut && d.checkIn && d.checkOut < d.checkIn) e.checkOut = 'Check-out must be on or after check-in';
  if (!Number.isInteger(d.guests) || d.guests < GUESTS_MIN || d.guests > GUESTS_MAX) e.guests = 'Guests must be between 1 and 100';
  if (d.notes.trim().length > NOTES_MAX) e.notes = `Notes can be up to ${NOTES_MAX} characters`;
  return e;
}

function toCreate(d: ReservationDraft): CreateReservationRequest {
  const p: CreateReservationRequest = { venue: d.venue.trim(), kind: d.kind, checkIn: d.checkIn, guests: d.guests };
  if (d.merchantId) p.merchantId = d.merchantId;
  if (d.location.trim()) p.location = d.location.trim();
  if (d.checkOut) p.checkOut = d.checkOut;
  if (d.memberIds.length > 0) p.memberIds = d.memberIds;
  if (d.notes.trim()) p.notes = d.notes.trim();
  return p;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Only what changed (PATCH accepts any subset). */
function toPatch(d: ReservationDraft, o: ReservationDraft): UpdateReservationRequest {
  const p: UpdateReservationRequest = {};
  // A venue sent without merchantId drops the merchant upstream, so a picked
  // venue always goes with its id.
  if (d.venue.trim() !== o.venue.trim() || d.merchantId !== o.merchantId) {
    p.venue = d.venue.trim();
    if (d.merchantId) p.merchantId = d.merchantId;
  }
  if (d.location.trim() !== o.location.trim()) p.location = d.location.trim();
  if (d.kind !== o.kind) p.kind = d.kind;
  if (d.checkIn !== o.checkIn) p.checkIn = d.checkIn;
  if (d.checkOut && d.checkOut !== o.checkOut) p.checkOut = d.checkOut;
  if (d.guests !== o.guests) p.guests = d.guests;
  if (!sameSet(d.memberIds, o.memberIds)) p.memberIds = d.memberIds;
  if (d.notes.trim() !== o.notes.trim()) p.notes = d.notes.trim();
  return p;
}

/** 422 field names (camelCase or snake_case) → form fields. */
const FIELD_OF: Record<string, FieldKey> = {
  venue: 'venue',
  // 422 MERCHANT_UNAVAILABLE: the picked venue was removed or deactivated.
  merchantId: 'venue',
  merchant_id: 'venue',
  location: 'location',
  kind: 'kind',
  checkIn: 'checkIn',
  check_in: 'checkIn',
  checkOut: 'checkOut',
  check_out: 'checkOut',
  guests: 'guests',
  memberIds: 'memberIds',
  member_ids: 'memberIds',
  notes: 'notes',
};

export type SubmitResult = { ok: true } | { ok: false; error: unknown };

export function ReservationForm({
  mode,
  initial,
  family,
  saving,
  onCreate,
  onUpdate,
  membersUnknown,
}: {
  mode: 'create' | 'edit';
  initial: ReservationDraft;
  family: FamilyMember[];
  saving: boolean;
  onCreate?: (payload: CreateReservationRequest) => Promise<SubmitResult>;
  /** Called with an empty patch when nothing changed. */
  onUpdate?: (patch: UpdateReservationRequest) => Promise<SubmitResult>;
  /** Editing a booking whose payload doesn't list who's going: untouched
   *  chips are not sent, so the server keeps its list. */
  membersUnknown?: boolean;
}) {
  const [d, setD] = useState<ReservationDraft>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const editing = mode === 'edit';
  // Results show once the user types in the venue field, until a pick.
  const [venueTyped, setVenueTyped] = useState(false);
  const venueSearch = useVenueSearch(d.venue, venueTyped && !d.merchantId);
  const pickRequired = needsVenuePick(editing ? initial : undefined);

  const set = <K extends FieldKey>(k: K, v: ReservationDraft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  /** Typing searches again and drops any picked venue. */
  const typeVenue = (t: string) => {
    setD((prev) => ({ ...prev, venue: t, merchantId: null }));
    setVenueTyped(true);
    if (errors.venue) setErrors((prev) => ({ ...prev, venue: undefined }));
  };

  const pickVenue = (m: MerchantSummary) => {
    setD((prev) => ({ ...prev, venue: m.businessName, merchantId: m.merchantId }));
    setVenueTyped(false);
    if (errors.venue) setErrors((prev) => ({ ...prev, venue: undefined }));
    Keyboard.dismiss();
  };

  const toggleMember = (id: string) =>
    set('memberIds', d.memberIds.includes(id) ? d.memberIds.filter((x) => x !== id) : [...d.memberIds, id]);

  const submit = async () => {
    setBanner(null);
    const next = validate(d, editing ? initial : undefined);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = editing ? await onUpdate?.(toPatch(d, initial)) : await onCreate?.(toCreate(d));
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
      // The picked venue is gone: drop it and show matches for its name again.
      setD((prev) => ({ ...prev, merchantId: null }));
      setVenueTyped(true);
    }
    const mapped = Object.keys(fieldErrors).length > 0;
    setBanner(loose.length > 0 ? loose.join('\n') : mapped ? null : err.message);
  };

  // Clearing an existing check-out isn't in the PATCH contract (string only).
  const canClearCheckOut = !!d.checkOut && !(editing && initial.checkOut);
  const today = isoDay();

  return (
    <Screen
      keyboard
      header={<TopBar title={editing ? 'Edit reservation' : 'Add reservation'} />}
      contentStyle={{ paddingTop: 8, gap: 24 }}
      footer={
        <Button
          label={editing ? 'Save changes' : 'Save reservation'}
          icon={Check}
          loading={saving}
          disabled={saving}
          onPress={() => void submit()}
        />
      }
    >
      <Heading
        title={editing ? 'Edit your' : 'Add a'}
        accent="reservation"
        sub="Keep your plans in one place. You still check in at the venue kiosk."
      />

      {banner != null && <Banner tone="error" title={editing ? "Couldn't save changes" : "Couldn't add the reservation"} body={banner} />}

      <View style={{ gap: 18 }}>
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
                ? 'TruePas venue selected.'
                : pickRequired && !venueSearch.active
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
        <Field
          label="Location (optional)"
          icon={MapPin}
          placeholder="City"
          value={d.location}
          onChangeText={(t) => set('location', t)}
          error={errors.location}
          inputProps={{ autoCapitalize: 'words', maxLength: 120, autoComplete: 'off' }}
        />
      </View>

      <View style={{ gap: 10 }}>
        <Txt v="smallStrong" color={C.ink2}>
          Type
        </Txt>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {BOOKING_KINDS.map((k) => (
            <Chip key={k} label={KIND_META[k].label} icon={KIND_META[k].icon} active={d.kind === k} onPress={() => set('kind', k)} />
          ))}
        </Row>
        {!!errors.kind && (
          <Txt v="small" color={C.redInk}>
            {errors.kind}
          </Txt>
        )}
      </View>

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

      <GuestStepper value={d.guests} onChange={(n) => set('guests', n)} error={errors.guests} />

      {family.length > 0 && (
        <View style={{ gap: 10 }}>
          <Txt v="smallStrong" color={C.ink2}>
            {"Who's going (optional)"}
          </Txt>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {family.map((m) => {
              const on = d.memberIds.includes(m.id);
              return (
                <Chip key={m.id} label={m.name.split(' ')[0]} icon={on ? Check : UserRound} active={on} onPress={() => toggleMember(m.id)} />
              );
            })}
          </Row>
          {errors.memberIds ? (
            <Txt v="small" color={C.redInk}>
              {errors.memberIds}
            </Txt>
          ) : (
            <Txt v="small">
              {membersUnknown && sameSet(d.memberIds, initial.memberIds)
                ? "Leave as is to keep who's going unchanged."
                : 'Family members on this booking.'}
            </Txt>
          )}
        </View>
      )}

      <NotesField value={d.notes} onChange={(t) => set('notes', t)} error={errors.notes} />
    </Screen>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

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
          <ListRow key={m.merchantId} icon={Building2} tone="sky" title={m.businessName} chevron={false} onPress={() => onPick(m)} />
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

function StepButton({ icon: Icon, label, disabled, onPress }: { icon: typeof Plus; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: disabled ? C.sunken : C.skyWash,
        }}
      >
        <Icon size={18} color={disabled ? C.ink4 : C.skyPressed} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

function GuestStepper({ value, onChange, error }: { value: number; onChange: (n: number) => void; error?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        Guests
      </Txt>
      <View
        accessible={false}
        style={{
          height: 56,
          borderRadius: R.md,
          backgroundColor: C.surface,
          borderWidth: 1.5,
          borderColor: error ? C.red : C.line,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 8,
        }}
      >
        <StepButton icon={Minus} label="Fewer guests" disabled={value <= GUESTS_MIN} onPress={() => onChange(Math.max(GUESTS_MIN, value - 1))} />
        <Text
          accessibilityLabel={`${value} ${value === 1 ? 'guest' : 'guests'}`}
          style={{ fontFamily: F.bold, fontSize: 18, color: C.ink }}
        >
          {value}
        </Text>
        <StepButton icon={Plus} label="More guests" disabled={value >= GUESTS_MAX} onPress={() => onChange(Math.min(GUESTS_MAX, value + 1))} />
      </View>
      <Txt v="small" color={error ? C.redInk : C.ink3}>
        {error ?? 'Including you.'}
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
