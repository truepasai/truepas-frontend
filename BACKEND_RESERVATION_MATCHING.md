# Backend request: reservations ("Add reservation") and kiosk check-ins

**For:** Priyanshu (customer backend) and the AI agent working on it
**From:** TruePas user app team (`truepasai/truepas-frontend`)
**Date:** 15 Oct 2026
**Repos involved:** `customer-account-service`, `customer-app-bff`, `kiosk-service`, merchant account service
**Related:** [BACKEND_CHECKIN_PIPELINE_ISSUE.md](BACKEND_CHECKIN_PIPELINE_ISSUE.md) (check-in events not reaching the customer side), [BACKEND_KIOSK_CHECKIN_SYNC.md](BACKEND_KIOSK_CHECKIN_SYNC.md)

---

## 1. Summary

Customers can add their own upcoming reservations in the app ("Add reservation" on the Check-ins tab). A kiosk check-in at that venue is supposed to complete the reservation, so the history shows it once, as the check-in.

The linking code exists and is correct for what it does. In practice it will almost never link:

1. **Venue names are compared as text.** The customer types the venue ("Taj"). The kiosk sends the merchant's venue name ("Taj Lands End"), or the merchant id if the name lookup isn't configured. These rarely match exactly.
2. **The check-in date is the UTC date, not the venue's local date.** An early-morning check-in in India lands on the previous day.
3. **Kiosk check-ins have no `kind`**, so the app's Hotels / Travel / Events filters can't place them.

On dev, none of this is visible yet because check-in events don't reach `customer-account-service` (see the pipeline doc). Fix that first. This doc covers what breaks right after.

---

## 2. How it works today (code read on 15 Oct 2026)

### 2.1 Creating a reservation (works)

App → `POST /cb/bookings` → `customer-account-service` `POST /customers/me/reservations` (`app/booking_api.py`).

`ReservationRequest`:

| Field | Rule |
|---|---|
| `venue` | required, free text, 1–255, whitespace collapsed |
| `location` | optional free text (city) |
| `kind` | `hotel \| park \| flight \| cinema \| cruise \| stadium \| concert \| other`, default `other` |
| `checkIn` | required, not before the earliest local "today" |
| `checkOut` | optional, ≥ `checkIn` |
| `guests` | 1–100 |
| `memberIds` | optional, must be the holder's family members |
| `notes` | optional, ≤ 500 |

At most 50 open (non-expired) upcoming reservations. "Expired" is derived when the dates pass with no check-in. The docstring says: *"There is no reservation system upstream, so the customer is the source: venue details are free text."*

### 2.2 Recording a kiosk check-in

`kiosk-service` `app/checkin.py` `_record_outcome` writes `checkin.completed.v1` / `checkin.failed.v1` with:

```jsonc
{
  "booking_id": "checkin-<hex>",
  "customer_id": "<account holder>",
  "venue": "<merchant venue name, or merchant_id if the lookup fails>",
  "location": "<location name, or location_id / merchant_id>",
  "type": "checkin",
  "check_in": "<now.date()>",          // UTC date
  "checked_in_at": "<UTC ISO>",
  "status": "completed | failed",
  "guests": 1,
  "checked_in_members": ["<person id>"],
  "duration_ms": 820,
  "merchant_id": "…", "kiosk_id": "…", "outcome": "…", "checkin_id": "…"   // ignored by the consumer
}
```

Venue names come from `merchant_account.venue_details()`, which calls `GET /ma/internal/v1/merchants/{merchant_id}/venue`. Without `MERCHANT_ACCOUNT_SERVICE_API_KEY`, or on any error or timeout, it falls back to the **ids**.

### 2.3 Linking a check-in to a reservation

`customer-account-service` `app/main.py` `_match_reservation()` runs for `completed` check-ins:

1. It loads the holder's reservations with `source = "customer"` and `status = "upcoming"`.
2. It keeps those where `normalize(reservation.venue) == normalize(checkin.venue)`, and `checkIn ≤ check_in ≤ (checkOut or checkIn)`. `normalize` = collapse whitespace + `casefold()`.
3. It prefers an exact `checkIn` date. It marks the reservation `completed` and sets `linked_booking_id` on both rows.

---

## 3. Problems

### P1. Free-text venue vs merchant venue name (HIGH)

| Customer typed | Kiosk sends | Linked? |
|---|---|---|
| `Taj Lands End` | `Taj Lands End` | ✅ |
| `taj lands  end` | `Taj Lands End` | ✅ (normalised) |
| `Taj` | `Taj Lands End` | ❌ |
| `Taj Lands End, Mumbai` | `Taj Lands End` | ❌ |
| `Taj Lands End` | `Taj Lands End – Bandra` | ❌ |
| `Taj Lands End` | `3f2c…` (merchant id: lookup not configured or failed) | ❌ |

Result: the reservation stays "Upcoming" (later "Expired") and the check-in appears as a separate row. That's exactly the duplicate history the link was meant to prevent.

### P2. UTC date for `check_in` (HIGH for India)

`check_in = now.date()` in UTC. A check-in at 00:00–05:29 IST is recorded on the **previous** calendar day. A reservation for "today" (local) doesn't cover it, so it doesn't link, and the history row shows the wrong day.

### P3. No `kind` on check-in rows (MEDIUM)

`CheckInProjection` has no `kind`, so kiosk rows reach the app with `kind: null`. The Check-ins tab's **Hotels / Travel / Events** chips use `kind` (or the older `type`), so kiosk check-ins only show under **All**. Stats per category are impossible.

### P4. Venue name lookup must be configured on every environment (MEDIUM)

If `MERCHANT_ACCOUNT_SERVICE_API_KEY` is unset in `kiosk-service`, every history row shows a UUID as the venue name and nothing can ever link. Please confirm it's set on dev.

### P5. Member-only reservations (LOW, confirm the intent)

Matching is by `customer_id` (the holder) only. `memberIds` on the reservation and `checked_in_members` on the check-in aren't compared. That's fine if one reservation per venue and date is the rule. With two reservations at the same venue and date (for example two rooms, different members), the first one wins.

---

## 4. Requests

### R1. Partner venue search for the app (HIGH)

Let the customer pick a TruePas partner venue instead of typing one:

```http
GET /cb/venues?query=taj&city=Mumbai&limit=20
→ 200 [
  { "venueId": "<location id>", "merchantId": "…", "name": "Taj Lands End",
    "city": "Mumbai", "kind": "hotel", "image": null }
]
```

- Backed by the merchant account service: active merchants and their locations.
- `kind`: the merchant's or location's category in the app's enum.
- Empty `query` → popular or nearby venues (optional).

### R2. Reservations and check-ins carry venue ids; match by id (HIGH)

- `POST/PATCH /cb/bookings` accepts optional `venueId` (and `merchantId`). When given, store them and fill `venue`, `location` and `kind` from the merchant record. Free text stays allowed for venues that aren't partners.
- `kiosk-service` adds `location_id` to the check-in event (it already sends `merchant_id`). `CheckInProjection` stores `merchant_id` and `location_id` on the booking row instead of ignoring them.
- `_match_reservation` rule, in order:
  1. same `location_id` (or same `merchant_id` when the reservation has no location), date window covers the local check-in date;
  2. otherwise today's normalised-name comparison, as a fallback for free-text reservations.

### R3. Local date for `check_in` (HIGH)

Compute `check_in` in the venue's time zone: from the location record, or the kiosk's configured time zone, falling back to `Asia/Kolkata` for India. Keep `checked_in_at` in UTC. Apply the same local date in the reservation date-window check.

### R4. `kind` on check-in rows (MEDIUM)

Send `kind` in the check-in event from the merchant or location category. If the check-in links to a reservation and has no kind, copy the reservation's `kind`. Return it on `GET /cb/bookings`.

### R5. Config check (MEDIUM)

Confirm `MERCHANT_ACCOUNT_SERVICE_API_KEY` and `MERCHANT_ACCOUNT_SERVICE_URL` are set for `kiosk-service` on dev and prod. Alert when `venue_details` falls back to ids, so missing names don't go unnoticed.

### R6. Optional: smarter free-text fallback

Only if R1/R2 can't ship soon. When exactly **one** upcoming reservation is open for that customer **on that local date**, and one name contains the other after normalising (`"taj"` ⊂ `"taj lands end"`), link it. Never link when there are several candidates.

---

## 5. What the app will do once this ships

- The reservation form gets a venue search (R1). Picking a venue sends `venueId` and pre-fills the name, city and type. Typing a venue that isn't a partner stays possible.
- The Check-ins chips start working for kiosk rows (R4). Nothing else changes in the app: it already reads `linkedBookingId`, `status`, `kind` and `checkedInAt`.

Until R1/R2 ship, the app could add a hint under the venue field: "Use the venue's full name as it appears at check-in". Tell us if you want that.

---

## 6. Acceptance checklist

Prerequisite: the check-in pipeline delivers events on dev (see the pipeline doc).

- [ ] `GET /cb/venues?query=taj` returns partner venues with `venueId`, `name`, `city`, `kind`.
- [ ] Reservation created with `venueId` → stored with the merchant's name, city and kind.
- [ ] Check-in at that venue on a date inside the reservation → one history row (the check-in), `linkedBookingId` = reservation id, reservation `completed`.
- [ ] Same with a free-text reservation whose name matches exactly → still links (fallback).
- [ ] Check-in at 01:30 IST → `check_in` is the IST date, and it links to a reservation for that date.
- [ ] Kiosk check-in row has a `kind`. It shows under the right chip in the app.
- [ ] With the merchant lookup unavailable, an alert or log fires. The row still saves.
- [ ] Two reservations at the same venue and date → no wrong link (first-by-date rule documented, or the member-aware rule if you add one).
- [ ] Reservation whose dates passed with no check-in → `status: "expired"`, can't be edited (unchanged).

Questions: reply with the `trace_id` from any failing call.
