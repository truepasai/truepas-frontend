# Backend request: kiosk check-ins must reach the customer side

**For:** Priyanshu, customer backend (customer-bff `/cb`), and the AI agent working on it
**From:** TruePas user app team (repo `Pradeepmali61/truepas-app-6`)
**Date:** 10 Oct 2026
**Priority:** High. The boss demo shows the kiosk check-in, but the app shows no check-in afterwards.

> **Follow-up (12 Oct 2026):** root cause traced across all five backend repos. See [BACKEND_CHECKIN_PIPELINE_ISSUE.md](BACKEND_CHECKIN_PIPELINE_ISSUE.md). event-relay-service in memory mode with no `CONSUMER_URLS` accepts check-in events and delivers them nowhere. That doc covers how to confirm it on dev and the recovery steps.

---

## 1. The problem in one paragraph

A user checks in at a TruePas kiosk and the kiosk shows a successful match. The user then opens the TruePas user app. The Check-ins tab, the Home "Today / Next check-in" card, the year stats, the activity feed and the notification inbox show **no trace of that check-in**. The kiosk and the user app talk to two different backends (`/kb` kiosk-bff and `/cb` customer-bff), and nothing carries the check-in from the first to the second on dev.

The backend's own update doc (`BACKEND_UPDATE_2026-10.md` §2) already lists this as not done:

> Kiosk check-ins appearing in Bookings history: ⏳ Needs event workers, **not in dev yet**
> Reservation auto-completes on a matching kiosk check-in: ⏳ Needs event workers
> Notifications from check-ins and document decisions: ⏳ Needs event workers
> Stats (`checkIns`, `minutesSaved`, …): ✅ Live, but shows zeros until check-in events flow

This document asks for that work, gives the exact shapes the app already reads, and lists how to verify it.

---

## 2. Evidence (dev, 9–10 Oct 2026)

Test account: **+91 9076433740** (user id `caf5190d-32d6-4572-b82b-2e88454dab87`, person id `33caa970-0220-4867-a986-28bbcd579ba1`).

A kiosk check-in was done on this account at **<date, time> at <kiosk / venue name>**. Afterwards, on `https://api.dev.truepas.com/cb`:

| Call | Result |
|---|---|
| `GET /cb/bookings` | `200`, **0 records** |
| `GET /cb/user/me/stats?year=2026` | `{ "checkIns": 0, "cities": 0, "avgCheckInMs": null, "minutesSaved": 0 }` |
| `GET /cb/user/me/activity` | Only `document_added`, `document_failed`, `document_verified`, `face_enrolled`, `family_member_added`. **No `check_in`.** |
| `GET /cb/notifications?limit=50` | No `booking` notification for a check-in |

So the gap is between kiosk-bff and customer-bff, not in the app.

---

## 3. How the two sides work today

### 3.1 Kiosk side (repo `truepass-kiosk`)

- Base URL: `KIOSK_API_BASE_URL = https://api.dev.truepas.com/kb`, client base `…/kb/api/kiosk/v1`.
- The kiosk is paired once (`POST /pair`) and then authenticates with its `tpk_…` credential.
- Check-in call (`services/kiosk/checkin.api.ts`):

```http
POST /kb/api/kiosk/v1/check-ins
Content-Type: multipart/form-data
file = <captured face JPEG>
```

- The backend does 1:N face identification, eligibility, verification status and consent checks. No person id, amount or booking is sent by the kiosk.
- Responses (all HTTP 200, branch on `outcome`), from `services/kiosk/checkin.types.ts`:

```jsonc
// success
{ "outcome": "matched", "grant_id": "…", "expires_at": "…",
  "data": { "person_id": "…", "full_name": "…", "identity_verified": true, "documents": [ … ] | null } }

{ "outcome": "no_match", "data": null }
{ "outcome": "not_eligible", "data": null }
{ "outcome": "pin_required", "data": null }   // twins; POST /check-ins/verify-pin currently returns 503 by design
```

Only `matched` is a completed check-in. `no_match`, `not_eligible` and `pin_required` must **not** create a completed check-in. A failed attempt may create a `failed` row (see §4.1), if that's the product decision.

### 3.2 Customer side (this app, `truepas-app-6`)

The app reads check-ins only from customer-bff. It needs **no change** once these endpoints return the data:

| Screen | Endpoint |
|---|---|
| Check-ins tab (list, month groups, category chips) | `GET /cb/bookings` |
| Booking detail | `GET /cb/bookings/{id}` |
| Home "Today / Next check-in" card, recent check-ins | `GET /cb/bookings` |
| Year card on the Check-ins tab | `GET /cb/user/me/stats?year=YYYY` |
| Home activity feed, identity screen activity | `GET /cb/user/me/activity` (also inside `GET /cb/identity/summary`) |
| Family member activity | `GET /cb/family/{personId}/activity` |
| Notification inbox and badge | `GET /cb/notifications`, counts |

Until the data arrives, the app shows a "how check-in works" guide on the empty Check-ins tab and zeros in stats.

---

## 4. What needs to happen when the kiosk returns `matched`

Implement a consumer (the "event workers") that receives the kiosk check-in event and writes the customer-side records below. The shapes are the ones already documented in `BACKEND_UPDATE_2026-10.md` §8–§10.

### 4.1 A booking row of type `checkin`

`GET /cb/bookings` must list a new row for the person who was matched (newest first, check-ins and reservations together):

```json
{
  "id": "checkin-…",
  "source": "checkin",
  "type": "checkin",
  "venue": "<venue name of the kiosk's merchant/location>",
  "location": "<city>",
  "kind": "hotel | park | flight | cinema | cruise | stadium | concert | other",
  "image": null,
  "checkIn": "2026-10-10",
  "checkOut": null,
  "checkedInAt": "2026-10-10T14:05:00Z",
  "status": "completed",
  "guests": 1,
  "amount": null,
  "durationMs": 820,
  "notes": null,
  "checkedInMembers": ["<person id>", "…"],
  "linkedBookingId": null,
  "createdAt": "2026-10-10T14:05:00Z"
}
```

Field notes:
- **`checkedInAt`**: exact UTC time of the match. The app formats it in the user's time zone and groups rows by month from it.
- **`venue`, `location`, `kind`**: come from the kiosk's pairing (merchant, location and venue category). The app's category chips (Hotels / Travel / Events) are driven by `kind`. `null` or `other` only shows under "All".
- **`durationMs`**: time from capture to match. Feeds `avgCheckInMs` in stats. `null` if unknown.
- **`status`**: `completed` for `matched`. Use `failed` only if failed attempts are stored (decide and tell us).
- **`checkedInMembers`**: every person checked in by this event.
- `GET /cb/bookings/{id}` must return the same row.
- Kiosk rows are read-only: editing or deleting returns `409 BOOKING_NOT_EDITABLE` (already documented).

### 4.2 Whose list it appears in

The kiosk matches a **person**, which can be the account holder or a family member.

| Person matched | Must appear in |
|---|---|
| The account holder | That account's `GET /cb/bookings`, stats, activity |
| A family member | The **holder's** `GET /cb/bookings` (with the member in `checkedInMembers`), and `GET /cb/family/{personId}/activity` for that member |

Use the person-to-account link (person id → owning account). Remember the holder's own person id differs from their user id (for this account: user `caf5190d-…`, person `33caa970-…`).

### 4.3 Complete a matching reservation

If the account has an `upcoming` reservation (`source: "customer"`) that matches the check-in (same person or member, same venue, `checkIn` date = check-in day or inside `checkIn…checkOut`):
- Mark the reservation `completed`.
- List the pair **once**, as the check-in row, with `linkedBookingId` = the reservation id.
- `GET /cb/bookings/{reservationId}` still returns the reservation (the app opens it for notes and kind).

Please write down the exact matching rule you use (venue id or name, date window, time zone), because the app shows "Upcoming" based on it.

### 4.4 Stats

`GET /cb/user/me/stats?year=YYYY` must count completed check-ins of that year:
- `checkIns`: count of completed check-in rows.
- `cities`: distinct `location` values.
- `avgCheckInMs`: average `durationMs`, or `null` with no data.
- `minutesSaved`: your existing formula.

### 4.5 Activity feed

Add an item to `GET /cb/user/me/activity` (and the `activity` inside `GET /cb/identity/summary`):

```json
{ "id": "check-in-…", "type": "check_in", "title": "Checked in at Taj Lands End",
  "occurredAt": "2026-10-10T14:05:00Z", "tone": "success",
  "ref": { "bookingId": "checkin-…", "personId": "…" } }
```

For a family member, also add it to `GET /cb/family/{personId}/activity`. The member activity screen already checks for `type === "check_in"`.

### 4.6 Notification

Create a `booking` notification ("Checked in at <venue>"), deep link `{ "type": "booking", "bookingId": "checkin-…" }`:
- Respect `GET /cb/user/me/notification-preferences` → `checkin: false` means no notification.
- For a family member, respect that member's `permissions.notifyOnCheckIn: false`.
- Send a push too once the push worker runs. Not required for this request.

### 4.7 Idempotency and failures

- One kiosk event creates exactly one booking row. Use the kiosk's `grant_id` (or the event id) as the idempotency key, so retries don't duplicate rows.
- If writing to the customer side fails, retry. The kiosk response must not wait for it.
- `faceCheckInEnabled: false` (`/cb/user/me/preferences`) is already refused at the kiosk. Make sure a refused attempt never creates a `completed` row.

---

## 5. Questions to answer back

1. For the check-in on <date, time> at <kiosk / venue>: what did `POST /kb/api/kiosk/v1/check-ins` return (`matched` with `person_id` / `grant_id`, or another outcome)? Please check the kiosk-bff logs.
2. Does kiosk-bff already publish a check-in event? Which fields does it carry (person id, venue or merchant id, location, kind, time, duration, grant id)?
3. When will the event workers run on dev?
4. Do you store failed attempts (`no_match`, `not_eligible`, `pin_required`) as `failed` rows? The app can show them, but it's a product call.
5. What is the reservation-matching rule in §4.3?
6. Twins: `pin_required` → `POST /kb/api/kiosk/v1/check-ins/verify-pin` returns 503 today. When will it complete a twin's check-in? See `BACKEND_TWIN_PIN_REQUEST.md` §4.

---

## 6. How to verify (acceptance checklist)

Use the test account above, or any account with a face enrolled and `faceCheckInEnabled: true`.

- [ ] Check in at a paired dev kiosk → kiosk shows `matched`.
- [ ] Shortly after, `GET /cb/bookings` has one new row with `source: "checkin"`, `status: "completed"`, a correct `checkedInAt`, `venue`, `location`, `kind` and `checkedInMembers`.
- [ ] Repeat the same kiosk event (retry) → still one row.
- [ ] `GET /cb/bookings/{id}` returns the row. `PATCH` and `DELETE` return `409 BOOKING_NOT_EDITABLE`.
- [ ] `GET /cb/user/me/stats?year=2026` → `checkIns` increased by 1, `cities` and `avgCheckInMs` updated.
- [ ] `GET /cb/user/me/activity` has a `check_in` item with `ref.bookingId`.
- [ ] `GET /cb/notifications` has a `booking` notification. With `checkin: false` in notification preferences it doesn't.
- [ ] Family member checks in → row in the holder's bookings with the member in `checkedInMembers`, item in `/cb/family/{personId}/activity`, no notification when that member's `notifyOnCheckIn` is false.
- [ ] Create a reservation for today at the kiosk's venue (`POST /cb/bookings`), then check in → one row only, the check-in, with `linkedBookingId` = the reservation id. The reservation is `completed`.
- [ ] `no_match` / `not_eligible` / `pin_required` → no `completed` row.
- [ ] In the user app (preview APK or dev build): the check-in shows on the Check-ins tab, on Home, in the year card and in the notification inbox, with no app change.

---

## 7. Reference files

- Kiosk check-in call: `truepass-kiosk/services/kiosk/checkin.api.ts`, `checkin.types.ts`, `checkinOutcome.ts`
- Kiosk base URLs: `truepass-kiosk/eas.json`, `.env` (`KIOSK_API_BASE_URL=https://api.dev.truepas.com/kb`)
- Customer contract: `truepas-app-6/BACKEND_UPDATE_2026-10.md` §2 (status), §7 (family permissions and activity), §8 (bookings), §9 (notifications), §10 (activity, stats, preferences)
- App readers: `truepas-app-6/src/api/endpoints.ts` (`getBookings`, `getUserStats`, activity, notifications), `src/app/(tabs)/history.tsx`, `src/app/(tabs)/index.tsx`
- Twin PIN at the kiosk: `truepas-app-6/BACKEND_TWIN_PIN_REQUEST.md`

Questions or a failing call: reply with the `trace_id` from the error body.
