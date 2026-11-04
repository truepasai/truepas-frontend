# Truepas customer app — backend update (October 2026)

**For:** the React Native / Expo customer-app team
**Environment:** dev — `https://api.dev.truepas.com/cb` (deployed 5 October 2026)
**Covers:** the 37 backend requests from "Truepas app: backend requests" (`BACKEND_REQUESTS.md`)
**Full reference:** `CUSTOMER_APP_FRONTEND_INTEGRATION.md` (§18 lists every new route)

> Received from the backend team on 2026-10-05 and saved here unchanged as the integration reference.

This document tells you what changed, what you must change in the app first (two breaking changes), and how to build each new feature. Every request and response below matches what is running on dev.

---

## 1. Read this first: breaking changes

Two behaviours changed on dev. The current app build will hit both.

### 1.1 `PUT /cb/face` now needs a PIN proof

Changing an existing face (self or family member) now requires a fresh PIN check. Without it you get:

```http
403 { "code": "REAUTH_REQUIRED", "message": "PIN verification is required" }
```

**What to do:** call `POST /cb/auth/verify-pin` first. Then send the returned `reauthToken` in the `X-Reauth-Token` header on `PUT /cb/face`. See §5. First-time enrolment (`POST /cb/face/enroll`) is unchanged and needs no PIN.

### 1.2 Photo documents now check the face

Passport, ID card, driving licence, green card and US visa verification now compares the photo on the document with the person's face. For a **family member whose face is not enrolled yet**, the verify call must include a **liveness session** for that member. Otherwise the result is:

```json
{ "outcome": "rejected", "reasonCode": "FACE_NOT_ENROLLED",
  "reasonMessage": "Verify this document with a live selfie, or set up the face first." }
```

**What to do:** for family members aged 5+, run liveness for the member before verifying their photo document, and pass that session to verify. Or enrol the face first. See §6.4 and §7. Birth certificates need no face.

### 1.3 Other changes to adapt to (not breaking, but visible)

| Change | Effect in the app |
|---|---|
| `outcome: "review"` is never returned | Treat verification as `approved` or `rejected` only. Remove any "under review" UI. |
| Rejections carry `reasonCode` + `reasonMessage` | Show `reasonMessage` to the user (see §6.3). |
| Login while locked always returns `429 ACCOUNT_LOCKED` | Even with the right password. Show the countdown from `retry_after`. |
| Revoked/signed-out sessions stop working at once | Your 401 → refresh → logout interceptor handles it; no change if it already does. |
| A check-in that completes a reservation shows **once** | The check-in row carries `linkedBookingId` = the reservation id. |

---

## 2. What is live on dev, and what is not yet

All API routes below are deployed. A few features also need **background workers** (event consumers, push sender, export builder). Those are not running in dev yet. Until they are, those features return valid but empty or pending data.

| Area | Status on dev |
|---|---|
| Sign-in error codes, lockout, register conflict | ✅ Live |
| Sessions list / revoke / revoke others | ✅ Live |
| 2-step sign-in: email code and authenticator app (TOTP) | ✅ Live |
| Face sign-in and face recovery | ✅ Live (pending a security review before production) |
| PIN re-auth for face update | ✅ Live |
| Document decision policy, reason codes, images, supported types | ✅ Live |
| Reservations: create / edit / delete / list | ✅ Live |
| Activity feed, security score, stats, preferences, support channels | ✅ Live |
| Notification inbox, type filter, counts, mark read | ✅ Live |
| Notifications created by app actions (face, family, password/PIN, reservation) | ✅ Live |
| Push device registration and notification preferences | ✅ Live (stored) |
| Member permissions (`notifyOnCheckIn`, `independentCheckIn`) | ✅ Live (stored) |
| Kiosk check-ins appearing in Bookings history | ⏳ Needs event workers — **not in dev yet** |
| Reservation auto-completes on a matching kiosk check-in | ⏳ Needs event workers |
| Notifications from check-ins and document decisions | ⏳ Needs event workers |
| Push notifications actually delivered to the phone | ⏳ Needs the push worker |
| Data export ZIP becoming `ready` | ⏳ Needs the export worker (stays `pending` on dev) |
| Stats (`checkIns`, `minutesSaved`, …) | ✅ Live, but shows zeros until check-in events flow |

Build the ⏳ features now against the documented shapes. They will fill in when the workers are deployed, with no app change needed.

---

## 3. Conventions: errors, headers, auth

### 3.1 Error envelope

Every error has the same shape. Machine-readable fields from the service are merged to the top level:

```json
{
  "code": "ACCOUNT_LOCKED",
  "message": "Account is temporarily locked",
  "trace_id": "06b608a4-…",
  "retry_after": 900,
  "locked_until": "2026-10-05T10:15:00+00:00",
  "details": { "...": "same fields, kept for compatibility" }
}
```

- Branch on `code`, never on `message`.
- When a `429` has `retry_after` (seconds), there is also a `Retry-After` header.
- `422` validation errors have `code: "VALIDATION_ERROR"` and a `details` array.
- A malformed JSON body returns `400 BAD_REQUEST`.
- Include `trace_id` when reporting a bug.

### 3.2 Device information (used for sessions)

Send an optional `device` object on **login, refresh, verify-otp (registration), 2-step verify and face sign-in**. It labels the session in the "Signed-in devices" screen:

```json
"device": { "name": "Pixel 8", "platform": "android", "appVersion": "1.4.0" }
```

`platform` is `android`, `ios` or `web`. With Expo: `Device.modelName`, `Platform.OS`, `Application.nativeApplicationVersion`.

---

## 4. Sign-in and account security

### 4.1 Register conflict

```http
POST /cb/auth/register  → 409 { "code": "ACCOUNT_EXISTS" }
```

The same code comes back from `account-details` when the email is taken. Show "An account already exists — sign in instead".

### 4.2 Login and error codes

```http
POST /cb/auth/login
{ "identifier": "email or +E.164 phone", "password": "…", "device": { … } }
```

| Status | Body | What to show |
|---|---|---|
| `200` | `{ user, accessToken, refreshToken }` | Signed in |
| `202` | `{ nextStep: "verify2fa", challengeId, method }` | 2-step code screen (§4.4) |
| `401` | `{ code: "INVALID_CREDENTIALS" }` | "Email/phone or password is incorrect" (same for unknown account) |
| `429` | `{ code: "ACCOUNT_LOCKED", retry_after, locked_until }` | "Too many attempts. Try again in N minutes." |

Wrong passwords lock the account for a period after repeated failures. While locked, **every** attempt returns `429`, whatever password is sent. Disable the button and count down from `retry_after`.

`EMAIL_NOT_VERIFIED` and `REGISTRATION_INCOMPLETE` cannot happen: an account only exists after email verification.

### 4.3 Signed-in devices (sessions)

```http
GET    /cb/auth/sessions
→ [ { "id", "device", "platform", "appVersion", "createdAt", "lastActiveAt", "current" } ]

DELETE /cb/auth/sessions/{id}         → { "ok": true, "revoked": n }
POST   /cb/auth/sessions/revoke-others → { "ok": true, "revoked": n }
```

- One row per signed-in device. `current: true` marks this phone.
- Revoking a session signs that device out **immediately** for account data (profile, family, bookings, preferences). Its next refresh fails, so your interceptor logs it out.
- If the user revokes the **current** session, sign out locally right away.
- Sessions created before this release have `device: null`. Show "Unknown device".

### 4.4 2-step sign-in

Two methods: **email code** or **authenticator app** (Google Authenticator, 1Password, Authy…).

**Turn on (email):**

```http
POST /cb/auth/2fa/enable   { "method": "email" }
→ { "method": "email", "challengeId", "nextStep": "confirm" }   (a 6-digit code is emailed)

POST /cb/auth/2fa/confirm  { "challengeId", "code": "123456" }
→ { "ok": true, "twoFactorEnabled": true, "method": "email" }
```

**Turn on (authenticator app):**

```http
POST /cb/auth/2fa/enable   { "method": "totp" }
→ { "method": "totp", "challengeId", "nextStep": "confirm",
    "secret": "JBSWY3DPEHPK3PXP…", "otpauthUri": "otpauth://totp/Truepas%3Auser%40mail.com?secret=…&issuer=Truepas&digits=6&period=30" }

POST /cb/auth/2fa/confirm  { "challengeId", "code": "<6 digits from the app>" }
```

Show `otpauthUri` as a QR code (for example `react-native-qrcode-svg`). Also show `secret` with a copy button for manual entry. Starting a new set-up and abandoning it does not break an authenticator that already works.

**Sign in when 2-step is on:** login returns `202` (see §4.2). Then:

```http
POST /cb/auth/2fa/verify  { "challengeId", "code", "device": { … } }
→ 200 { user, accessToken, refreshToken }
```

For `method: "email"`, the code is emailed when login returns 202. For `method: "totp"`, read it from the authenticator app. Errors: `400 TWO_FACTOR_INVALID` (wrong or expired code), `429 TWO_FACTOR_LOCKED` (too many tries; start login again).

**Turn off:** `POST /cb/auth/2fa/disable { "pin": "1234" }` → `{ ok, twoFactorEnabled: false }`. PIN errors are the same as elsewhere (`400 PIN_INVALID` with `attempts_remaining`, `429 PIN_LOCKED`).

**Status for the settings toggle:** `GET /cb/user/me` returns `twoFactorEnabled` and `twoFactorMethod`.

### 4.5 Face sign-in and face recovery

Lets a user sign in, or reset a forgotten password or PIN, with their face. It is **live on dev, but needs a security review before production**, so keep it behind a feature flag.

```text
1. POST /cb/auth/face-login/start      { identifier, purpose: "login" | "recovery" }
2. Liveness with Authorization: Bearer <preauthToken>
3. POST /cb/auth/face-login             { preauthToken, livenessSessionId, sessionToken, device }
```

**Step 1**

```http
POST /cb/auth/face-login/start  { "identifier": "user@mail.com", "purpose": "login" }
→ 202 { "nextStep": "face", "preauthToken", "expiresIn": 300, "purpose": "login" }
```

This **always** returns 202 with a token, even for accounts that don't exist or have no face enrolled. Never show "account not found" here.

**Step 2:** run the normal liveness flow (`POST /cb/liveness/v2/challenge`, `…/evidence`, `…/finalize`). Use `Authorization: Bearer <preauthToken>` instead of an access token, and **no** `personId`. The preauth token works only on liveness routes.

**Step 3**

```http
POST /cb/auth/face-login
{ "preauthToken", "livenessSessionId", "sessionToken", "device": { … } }
```

| Status | Meaning |
|---|---|
| `200 { user, accessToken, refreshToken }` | Signed in (`purpose: "login"`) |
| `200 { resetToken, expiresIn }` | Face confirmed (`purpose: "recovery"`) — go to step 4 |
| `401 { code: "FACE_NOT_MATCHED" }` | Not matched, or not eligible. Show one generic "We couldn't sign you in with your face". |
| `429 { code: "FACE_LOGIN_LOCKED", retry_after }` | Too many failed tries |

**Step 4 (recovery only):** use the reset token instead of the email OTP. It works **once**: reset either the password or the PIN.

```http
POST /cb/auth/reset-password  { "resetToken", "newPassword" }
POST /cb/auth/reset-pin       { "resetToken", "newPin" }
```

Note: after face sign-in and 2-step verify, the `user` object contains `profileImageKey`, not a `profileImageUrl`. Call `GET /cb/user/me` right after signing in to get the photo URL.

### 4.6 Forgot PIN (existing endpoints, correct flow)

Use the reset-PIN flow, not a password reset:

```text
POST /cb/auth/forgot-password { email }
POST /cb/auth/verify-otp     { email, otp, purpose: "password_reset" }
POST /cb/auth/reset-pin      { email, otp, newPin }
```

---

## 5. Face update with PIN (re-auth)

Changing a face needs a fresh PIN check. One account PIN covers the account holder **and** family members.

```http
POST /cb/auth/verify-pin   { "pin": "1234" }
→ { "ok": true, "reauthToken", "scope": "face_update", "expiresIn": 300 }
```

- The token is valid for **5 minutes** and works **once**.
- PIN errors: `400 PIN_INVALID` (`attempts_remaining`), `429 PIN_LOCKED` (`retry_after`).

```http
PUT /cb/face
X-Reauth-Token: <reauthToken>
{ "livenessSessionId", "sessionToken", "personId": "<optional family member id>" }
```

- Members under 5 (`faceCaptureMode: "photo"`): send `{ "personId", "selfieBase64" }` instead of the liveness fields. The header is still required.
- No token, an expired one, or a used one → `403 REAUTH_REQUIRED`. Ask for the PIN again.
- The token is used up **before** the liveness session. If liveness then fails, ask for the PIN again before retrying.

Recommended order: PIN → liveness → `PUT /cb/face`. Then the 5-minute window covers the liveness capture.

---

## 6. Documents

### 6.1 Supported types (stop hard-coding them)

```http
GET /cb/documents/types/supported
→ [ { "type": "passport", "label": "Passport", "selfieRequired": true,
      "allowedForMinors": true, "allowedForAdults": true, "minAge": null, "maxAge": null }, … ]
```

`type` is one of `passport`, `drivingLicense`, `idCard`, `greenCard`, `usVisa`, `birthCertificate`. Build the "Add document" picker from this list, filtered by the person's age:

```ts
const allowed = types.filter(t =>
  (age < 18 ? t.allowedForMinors : t.allowedForAdults) &&
  (t.minAge == null || age >= t.minAge) && (t.maxAge == null || age <= t.maxAge));
```

### 6.2 Adding a document

`number` is now optional: stop sending `"PENDING"`. The masked number appears after verification reads it from the document.

```http
POST /cb/documents  { "type": "passport", "label": "My passport", "personId": "<optional>" }
```

Upload images through presigned URLs, not base64. This avoids `413` errors on large photos:

```http
POST /cb/documents/{documentId}/upload-urls  { "parts": ["front", "back"], "contentType": "image/jpeg" }
→ { "uploads": { "front": { "uploadUrl", "objectKey" }, "back": { … } }, "expiresIn": 900 }
```

`PUT` each image to its `uploadUrl` (with `Content-Type` matching), then pass the `objectKey`s when creating the verification session.

### 6.3 Rejection reasons

Results are only `approved` or `rejected`. A rejection always has a `reasonCode` and a ready-to-show `reasonMessage`:

| `reasonCode` | `reasonMessage` (shown to the user) | Suggested action button |
|---|---|---|
| `DOCUMENT_PROCESSING_ERROR` | We couldn't read this document. Retake the photos in good light. | Retake |
| `AUTHENTICITY_FAILED` | This document did not pass our security checks. Try another document. | Use another document |
| `DOCUMENT_TYPE_MISMATCH` | The document does not look like the type you selected. Check the type and retake it. | Change type |
| `DOCUMENT_UNREADABLE` | Some details on the document could not be read. Retake the photos in good light. | Retake |
| `NO_PORTRAIT_IN_DOCUMENT` | We couldn't find a photo of you on this document. Use a document that shows your face. | Use another document |
| `FACE_NOT_ENROLLED` | Verify this document with a live selfie, or set up the face first. | Start liveness / Set up face |
| `DOCUMENT_FACE_MISMATCH` | The photo on this document does not match your enrolled face. Make sure it is your own document. | Use another document |
| `PROFILE_MISMATCH` | The details on this document do not match your profile. Check the document or update your profile. | Edit profile |
| `DOCUMENT_CHECKS_INCONCLUSIVE` | We couldn't confirm this document automatically. Retake the photos in good light or try another document. | Retake |

Use `reasonMessage` as the text. Use `reasonCode` only to choose the action button.

`matchScore` (0–1) is the face match confidence between the document photo and the person's face.

### 6.4 Verification flow

```http
POST /cb/documents/{documentId}/verification-sessions
{ "frontObjectKey", "backObjectKey", "livenessSessionId": "<optional>", "requestId": "<optional idempotency id>" }
→ 201 { "sessionId", … }

POST /cb/document-verification-sessions/{sessionId}/verify
{ "sessionToken": "<liveness sessionToken, when a livenessSessionId is used>" }
→ { "outcome", "reasonCode", "reasonMessage", "matchScore", "extractedName", "extractedDob",
    "extractedDocumentNumber", "dateOfExpiry", "nationality", "issuingState", "document": { … } }
```

Which face the document photo is compared with:

| Person | Compared with | What the app sends |
|---|---|---|
| Account holder (face enrolled at registration) | Enrolled face | Nothing extra |
| Family member with an enrolled face | Enrolled face | Nothing extra |
| Family member **without** an enrolled face | The live selfie from a liveness session | `livenessSessionId` (on the session or in verify) + `sessionToken` |
| Birth certificate | No face check | Nothing extra |

Only a selfie from a **liveness session** counts as live. An uploaded selfie photo does not, and returns `FACE_NOT_ENROLLED` for a person without an enrolled face.

### 6.5 Other document changes

- **Images:** `GET /cb/documents/{id}/images` returns `{ front, back, selfie, portrait }`. Each is `{ url, expiresAt }` or `null`. URLs expire, so refetch rather than caching. Documents verified before image storage existed have `null` parts; show a placeholder.
- **One per type:** when a document is approved, older **verified** documents of the same type for that person are removed. Refetch the list after a successful verify.
- `verifiedAt` is now on each document.

---

## 7. Family members

### 7.1 Recommended flow by age

| Age | Flow |
|---|---|
| 0–4 | Add member → photo document only after face enrolment, or a birth certificate → face enrolment with `selfieBase64` (no liveness) |
| 5–9 | Add member → liveness for the member (front or back camera) → verify document with that liveness session → face enrolment with a **new** liveness session |
| 10+ | Same as 5–9, front camera only |

A liveness session can be used **once**. Document verification and face enrolment each need their own. Enrolling the face first and verifying the document afterwards also works for every age.

Start liveness for a member with `POST /cb/liveness/v2/challenge?personId=<memberId>`.

### 7.2 Permissions

```http
PATCH /cb/family/{personId}/permissions  { "notifyOnCheckIn": false }
→ full family member, including "permissions": { "independentCheckIn": false, "notifyOnCheckIn": false }
```

- `notifyOnCheckIn: false` stops the "checked in" alert for that member (once check-in events run).
- `independentCheckIn` is saved and returned, but **not enforced yet**: it waits on a consent-policy review. Label it "coming soon" or hide it.

Every family read (`GET /cb/family`, `GET /cb/family/{id}`) now includes `permissions`, `createdAt` and `faceEnrolledAt`.

### 7.3 Member activity

```http
GET /cb/family/{personId}/activity → same shape as §10.1, only that member's events
```

---

## 8. Bookings and reservations

Check-in happens **only at the venue kiosk**. Customers can now record their own **upcoming reservations**. A matching kiosk check-in completes them automatically (once check-in events run).

### 8.1 Booking shape

```json
{
  "id": "res-… | checkin-…",
  "source": "customer | checkin",
  "venue": "Taj Lands End",
  "location": "Mumbai",
  "type": "reservation | checkin",
  "kind": "hotel | park | flight | cinema | cruise | stadium | concert | other | null",
  "image": null,
  "checkIn": "2026-10-20",
  "checkOut": "2026-10-22",
  "checkedInAt": "2026-10-20T14:05:00Z",
  "status": "upcoming | completed | failed | expired",
  "guests": 2,
  "amount": null,
  "durationMs": 820,
  "notes": "Room booked via travel agent",
  "checkedInMembers": ["<person id>"],
  "linkedBookingId": "<the other side of a reservation↔check-in link>",
  "createdAt": "2026-10-05T09:00:00Z"
}
```

- `status: "expired"` means an upcoming reservation whose dates passed with no check-in.
- `checkedInAt` is the exact time of a kiosk check-in. Format it in the user's time zone.

### 8.2 List and detail

```http
GET /cb/bookings          → newest first: check-ins and reservations together
GET /cb/bookings/{id}
```

A reservation that a check-in completed is listed **once**, as the check-in row, with `linkedBookingId` = the reservation id. Open `GET /cb/bookings/{reservationId}` to show its notes and kind.

Suggested tabs: **Upcoming** (`status === 'upcoming'`) and **History** (everything else).

### 8.3 Create, edit, delete

```http
POST /cb/bookings
{
  "venue": "Taj Lands End",        // required
  "location": "Mumbai",            // optional
  "kind": "hotel",                 // optional, default "other"
  "checkIn": "2026-10-20",         // required, YYYY-MM-DD, not in the past
  "checkOut": "2026-10-22",        // optional, >= checkIn
  "guests": 2,                     // 1–100, default 1
  "memberIds": ["<family id>"],    // optional, must be your family members
  "notes": "…"                     // optional, ≤ 500 chars
}
→ 201 Booking { "status": "upcoming", "source": "customer", … }

PATCH  /cb/bookings/{id}   (any subset of the fields above)
DELETE /cb/bookings/{id}   → { "ok": true }
```

| Error | When |
|---|---|
| `409 BOOKING_NOT_EDITABLE` | Editing or deleting a kiosk check-in, a completed reservation, or one whose dates passed |
| `409 RESERVATION_LIMIT` | More than 50 upcoming reservations |
| `422` | Date in the past, `checkOut` before `checkIn`, invalid `kind`, duplicate `memberIds` |
| `404` | Not your booking, or a `memberIds` entry is not your family member |

Send dates as the user's **local** calendar date. "Today" is accepted in every time zone. Show edit and delete only for `source === 'customer' && status === 'upcoming'`.

---

## 9. Notifications and push

### 9.1 Inbox

```http
GET  /cb/notifications?limit=50&offset=0&unread_only=false&type=booking
GET  /cb/notifications/count?type=booking         → { "total_count", "unread_count" }
POST /cb/notifications/{id}/read
POST /cb/notifications/read      { "notification_ids": ["…"] }
POST /cb/notifications/read-all
```

Items (unchanged, snake_case): `{ id, title, message, notification_type, data, is_read, created_at, read_at }`.

`notification_type` and `data` drive the deep link:

| `notification_type` | `data` | Open |
|---|---|---|
| `booking` | `{ "type": "booking", "bookingId" }` | Booking detail |
| `document` | `{ "type": "document", "documentId", "personId" }` | Document detail |
| `family` | `{ "type": "family", "personId" }` | Family member |
| `identity` | `{ "type": "identity", "personId" }` | Face / identity screen |
| `account` | `{ "type": "account" }` | Account & security |

What creates notifications:

| Event | Type | On dev |
|---|---|---|
| Face enrolled / updated (self or member) | `identity` | ✅ |
| Family member added / removed | `family` | ✅ |
| Password or PIN changed | `account` | ✅ |
| Reservation added | `booking` | ✅ |
| Kiosk check-in completed / failed | `booking` | ⏳ needs event workers |
| Document verified / rejected | `document` | ⏳ needs event workers |
| Data export ready | `account` | ⏳ needs export worker |

### 9.2 Push devices

Register the Expo push token after sign-in and whenever it changes. Remove it on sign-out.

```http
POST   /cb/user/me/devices  { "pushToken": "ExponentPushToken[…]", "platform": "ios" | "android" }
→ 201 { "id", "platform", "createdAt", "lastSeenAt" }
GET    /cb/user/me/devices
DELETE /cb/user/me/devices/{id}
```

Registering the same token again updates it; it is not stored twice. Push payloads carry the same `data` as the inbox item, so you can use one deep-link handler for both. Delivery starts when the push worker is deployed.

### 9.3 Notification preferences

```http
GET /cb/user/me/notification-preferences  → { "checkin": true, "family": true, "security": true, "document": true }
PUT /cb/user/me/notification-preferences  { "checkin": false }   (send only what changed)
```

A preference turned off stops **push** for that category. The inbox still records the notification. `security` covers both `account` and `identity`.

---

## 10. Home, profile and settings data

### 10.1 Activity feed

```http
GET /cb/user/me/activity       → newest first, max 20
GET /cb/identity/summary       → now includes "activity" with the same list
```

```json
[ { "id": "document-verified-…", "type": "document_verified", "title": "Passport verified",
    "occurredAt": "2026-09-06T10:00:00Z", "tone": "success",
    "ref": { "documentId": "…", "personId": "…" } } ]
```

- **`type`:** `face_enrolled`, `document_added`, `document_verified`, `document_failed`, `family_member_added`, `family_face_enrolled`, `check_in`, `password_changed`.
- **`tone`:** `success`, `neutral` or `warning`.
- **`ref`:** has `documentId`, `personId` or `bookingId` for deep links.

Use `title` as-is and format `occurredAt` locally.

### 10.2 Security score

```http
GET /cb/user/me/security-score
→ { "score": 83, "identityStrength": 75,
    "suggestions": [ { "id": "enable_2fa", "title": "Turn on 2-step sign-in", "points": 8 } ] }
```

| `id` | Opens |
|---|---|
| `enroll_face` | Face set-up |
| `add_document` | Add document |
| `verify_document` | Verify document |
| `enable_2fa` | 2-step settings |
| `renew_document` (has `documentId`) | That document |
| `change_password` | Change password |
| `review_sessions` | Signed-in devices |

Use this instead of calculating the score in the app, so every device shows the same number.

### 10.3 Stats

```http
GET /cb/user/me/stats?year=2026
→ { "year": 2026, "checkIns": 12, "cities": 4, "avgCheckInMs": 950, "minutesSaved": 23 }
```

`avgCheckInMs` is `null` when there is no data. Expect zeros on dev until check-in events flow.

### 10.4 App preferences

```http
GET /cb/user/me/preferences  → { "language": "en", "region": null, "faceCheckInEnabled": true, "shareAnalytics": false }
PUT /cb/user/me/preferences  { "faceCheckInEnabled": false }   (send only what changed)
```

`faceCheckInEnabled: false` is **enforced at the kiosk**: the kiosk refuses face check-in for the account holder. Say this clearly next to the toggle.

### 10.5 Support channels

```http
GET /cb/support/channels → { "email": "support@truepas.com", "phone": null, "hours": null, "chatUrl": null }
```

Hide any channel that is `null`. The values come from server config, so they can change without an app release.

### 10.6 Profile additions

`GET /cb/user/me` now also returns `faceEnrolledAt`, `passwordChangedAt`, `pinChangedAt`, `twoFactorEnabled` and `twoFactorMethod`.

---

## 11. Privacy: data export and account deletion

### 11.1 Download my data

```http
POST /cb/user/me/export          → 202 { "exportId", "status": "pending" }
GET  /cb/user/me/export/{id}     → { "exportId", "status", "readyAt", "expiresAt", "url"? , "error"? }
```

- `status` is `pending`, `ready`, `failed` or `expired`. There is one active export per account; asking again returns the same `exportId`.
- Poll every 10–30 s while `pending`, or wait for the `account` notification.
- `url` is a **BFF path that needs the `Authorization` header**, not a public link. Don't open it in a browser. Download it with headers (`FileSystem.downloadAsync(BASE_URL + url, target, { headers: { Authorization } })`, then share).

The archive contains account, family, bookings, documents (masked numbers; no images) and notifications as JSON. It expires after 7 days. **On dev, exports stay `pending`** until the export worker is deployed.

### 11.2 Delete account with a reason

```http
DELETE /cb/user/me
{ "confirmation": "DELETE", "pin": "1234",
  "reason": "privacy | not_using | few_venues | other", "comment": "optional, ≤ 500 chars" }
```

`reason` and `comment` are optional. They are stored without any link to the account. Deleting the account also removes all its push devices.

---

## 12. App-side fixes needing no new backend

| Item | Fix |
|---|---|
| 7.3 / 22 profile photo | `src/api/endpoints.ts` calls `/profile/picture`, which does not exist. Use `POST /cb/persons/{personId}/profile-image/upload-url`, PUT the image, then `PUT /cb/persons/{personId}/profile-image { objectKey }`. Works for family members too. |
| 3 Forgot PIN | Use the reset-PIN flow in §4.6, not a password reset. |
| 10.5 large uploads (413) | Use presigned uploads (§6.2) instead of base64. |
| 31 Mark read | Wire the notification screen to the read routes in §9.1. |
| 27 "Check in with your face" button | Remove it. Check-in is kiosk-only. The opt-out toggle is `faceCheckInEnabled` (§10.4). |
| 29 Identity pass / digital key | Remove the two quick actions, or show "Coming soon". |
| 17 Liveness step retry | Not supported: a failed step fails the session. Start a new challenge. |

Already working before this release (no change needed): PIN reset and lockout codes (3), E.164 and session confirmations (6), DOB/address/partial profile update (7.1/7.2), re-adding a removed member (18), duplicate member `409 FAMILY_MEMBER_EXISTS` (19), `dateOfBirth` on family items (20), member `verification` values (21).

---

## 13. Requests not built, and why

| # | Request | Status |
|---|---|---|
| 14 | Issued credentials | `GET /cb/documents/issued` is live but always `[]`: nothing issues credentials yet. Keep the empty state. |
| 15 | Share link / usage history | Deferred: releasing identity data to a third party needs consent scoping and a verifier surface. |
| 16 | Indian document types | No change (product decision). Use `/documents/types/supported`. |
| 25 | Turning-18 handover invite | Deferred: needs an account-claim flow. `independentCheckIn` is stored but not enforced. |
| 27 | Face check-in from the phone | Not planned: check-in is kiosk-only. |
| 28 | Booking services / confirmation code | No booking system to source them from. Reservations have `kind` and `notes` instead. |
| 29 | Identity pass / digital key | Dropped by product ("the face is the key"). |

---

## 14. Test checklist on dev

- [ ] Wrong password → `401 INVALID_CREDENTIALS`. Repeated failures → `429 ACCOUNT_LOCKED` with a countdown, including for the right password.
- [ ] Register an existing phone → `409 ACCOUNT_EXISTS`.
- [ ] Sessions screen lists both phones. Revoking one signs it out on its next call.
- [ ] 2-step: turn on email, sign out, sign in → code screen → signed in. Repeat with an authenticator app.
- [ ] `PUT /cb/face` without PIN → 403. With `verify-pin` → succeeds for self and for a member.
- [ ] Add a passport for the account holder → approved, or rejected with a `reasonMessage`. Never "review".
- [ ] Family member aged 5+: liveness for the member → verify passport with that session → approved. Without liveness → `FACE_NOT_ENROLLED`.
- [ ] Document images screen shows front, back, selfie and portrait (or placeholders).
- [ ] Supported types picker changes with the person's age.
- [ ] Create, edit and delete a reservation. A past date → 422. Editing a completed one → 409.
- [ ] Activity feed and security score show on Home. Tapping a suggestion opens the right screen.
- [ ] Notifications: add a family member → `family` notification appears, deep link works, mark read works.
- [ ] Register push token → listed under devices. Sign out → removed.
- [ ] Preferences and notification preferences save and reload.
- [ ] Delete account with a reason works.

Questions or a failing call: send the `trace_id` from the error body to the backend team.
