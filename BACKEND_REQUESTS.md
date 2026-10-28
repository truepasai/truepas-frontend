# Truepas app: backend requests

**Date:** 2026-10-04 · **From:** Truepas mobile app team · **BFF:** `https://api.dev.truepas.com/cb`

This is the single list of everything the mobile app needs from the backend. It replaces the older `BACKEND_*.md`, `BUG*.md`, `BUG018_*.md` and `PENDING_INTEGRATIONS.md` reports in this repo. Each item was checked against the current app code; items that are already working were dropped (see the [appendix](#appendix-closed-items-from-older-reports)). All request/response shapes below are **proposals** for discussion, not final contracts. If you already have a different shape, tell us and the app will adapt.

**Status values:** **new** = not in any older report · **open** = in an older report and still needed per the current code · **verify** = may already be fixed on your side; we can't tell from the app, so please confirm.

**Priority:** P0 = blocks a core flow for real users · P1 = visible gap or data loss in a shipped screen · P2 = feature shown as "Coming soon" or a client-side workaround · P3 = nice to have / confirmation only.

## Summary

| # | Request | Priority | Status | App screen |
|---|---|---|---|---|
| **Auth & sessions** | | | | |
| 1 | Sign in and recover the account with your face | P2 | open | Sign in, Forgot password |
| 2 | Signed-in sessions/devices and 2-step sign-in | P1 | open | Security, Delete account |
| 3 | PIN reset path and verify-pin lockout contract | P1 | open | Confirm PIN, Update face PIN |
| 4 | Distinct error codes on login failure | P2 | open | Sign in |
| 5 | `409` from `/auth/register` for an existing account | P1 | verify | Register |
| 6 | Auth contract confirmations (E.164, user flags, OTP reuse, password policy) | P2 | verify | Login, Register, Forgot password |
| 7 | Profile fields: DOB format, `address`, partial PUT, profile picture | P2 | open / verify | Register, Edit profile |
| **Identity & documents** | | | | |
| 8 | Fetch captured document images (`GET /documents/{id}/images`) | P1 | open | Document detail |
| 9 | Remaining extracted fields and document number clean-up | P1 | verify | Document verified, Document detail |
| 10 | Passport decision: auto-approve policy, liveness binding, reason codes, `review` | P1 | open | Document processing / result |
| 11 | One document per type (server-side duplicates) | P3 | open | Wallet |
| 12 | Identity strength / security score | P2 | new | Wallet, Security |
| 13 | Richer account activity in `/identity/summary` | P2 | new | Home "Recent activity", Your identity |
| 14 | Issued credentials (`GET /documents/issued`) | P2 | verify | Wallet "Issued to you" |
| 15 | Document share link and usage history | P3 | open | Document detail |
| 16 | Supported document types (incl. India) | P3 | open | Wallet "Add more", Add document |
| 17 | Liveness contract: evidence body encoding and confirmations | P3 | open | Face scan (all) |
| 38 | Reject expired documents on the server (`DOCUMENT_EXPIRED`) | P1 | new | Document processing |
| **Family** | | | | |
| 18 | Removed member can't be added again | P1 | open | Add family member |
| 19 | Machine-readable duplicate error on `POST /family` | P2 | open | Add family member |
| 20 | `dateOfBirth` on `GET /family` items | P2 | verify | Add family member |
| 21 | Define member `verification` values | P2 | open | Family list, Member detail |
| 22 | Member photos stored on the server | P1 | new | Family list, Member detail, Activity |
| 23 | Update a family member's face (`PUT /face` with `personId`) | P1 | new (needs confirmation) | Member detail → Update face |
| 24 | Family activity projection | P2 | open | Member activity |
| 25 | Member permissions and turning-18 handover | P3 | open | Member detail |
| **Bookings & check-ins** | | | | |
| 26 | Check-in event producer for `GET /bookings` | P0 | open | Check-ins tab, Home |
| 27 | Face check-in at venues from the app | P1 | open | Home "Today" card, Settings |
| 28 | Richer booking detail | P2 | open | Booking detail |
| 29 | Identity pass / digital key | P3 | open | Home quick actions |
| 30 | Check-in stats | P3 | open | Check-ins tab |
| **Notifications** | | | | |
| 31 | Mark notifications read (single + all) | P1 | open | Notifications, bell badge |
| 32 | `unread_count`, `type` enum, deep-link payload, server filter | P2 | open | Notifications |
| 33 | Notification preferences and push device tokens | P2 | open | Settings, Member detail |
| **Settings & support** | | | | |
| 34 | Download my data (export) | P2 | new | Data & privacy |
| 35 | Account preferences (language, face check-in opt-in, analytics) | P3 | open | Settings, Data & privacy |
| 36 | Support channels (chat / call) | P3 | open | Help |
| 37 | Delete-account reason | P3 | new | Delete account |

**Count by priority:** P0: 1 · P1: 11 · P2: 15 · P3: 10 (37 total).

---

## Auth & sessions

### 1. Sign in and recover the account with your face — P2, open

- **Today:** Sign in shows a disabled "Sign in with your face" button with a Coming soon tag (`src/app/(auth)/login.tsx:186-193`). Forgot password shows a disabled "Faster: recover with your face" card (`src/app/(auth)/forgot-password.tsx:145-160`). Users sign in with phone/email + password only.
- **Why backend:** there is no endpoint that exchanges a passed liveness session for tokens.
- **Suggested contract:**

```http
POST /auth/face-login
{ "identifier": "+919876543210", "livenessSessionId": "...", "sessionToken": "..." }
→ 200 AuthResponse { user, accessToken, refreshToken }
→ 401 { "code": "FACE_NOT_MATCHED" }   423 { "code": "FACE_LOGIN_LOCKED", "retryAfter": 900 }
```

  Recovery could reuse the same check and return a short-lived reset token for `POST /auth/reset-password` instead of an email OTP. The liveness challenge would need to be creatable without an access token (today it requires one).
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #1.

### 2. Signed-in sessions/devices and 2-step sign-in — P1, open

- **Today:** Security shows "2-step sign-in" and "Signed-in devices" as Coming soon (`src/app/security/index.tsx:77`, `:93-95`). Delete account lists "Active sessions — Signed out everywhere" as static text (`src/app/account/delete/index.tsx:98`). Login has no second factor.
- **Why backend:** session list, remote sign-out and 2FA enrolment are server state.
- **Suggested contract:**

```http
GET /auth/sessions
→ [{ "id": "s1", "device": "Pixel 8", "platform": "android", "city": "Pune", "lastActiveAt": "ISO", "current": true }]
DELETE /auth/sessions/{id}            → { "ok": true }   (revokes that refresh-token family)
POST /auth/2fa/enable                 → { "method": "sms|email|totp", ... }
POST /auth/2fa/disable  { "pin": "1234" }
```

  If 2FA is enabled, `POST /auth/login` should return `202 { "nextStep": "verify2fa", "challengeId": "..." }` instead of tokens (the app will add that screen).
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #6; `BACKEND_CONSOLIDATED_REPORT.md` A4.

### 3. PIN reset path and verify-pin lockout contract — P1, open

- **Today:** "Forgot PIN?" signs the user out and sends them to email password reset (`src/app/security/confirm-pin.tsx:37-44`). After a password reset the old PIN is still active, so the user is asked again for the PIN they forgot. Wrong-PIN handling guesses field names (`attemptsRemaining` / `attempts_remaining` / `remainingAttempts`, `retryAfter` / `lockedUntil`) and falls back to a local 5-attempt / 15-minute counter per screen (`src/features/auth/usePinVerification.ts:7-35`).
- **Why backend:** only the server can reset a PIN and own the attempt counter.
- **Suggested contract:**

```http
POST /auth/reset-pin   { "email": "...", "otp": "123456", "newPin": "1234" }   → { "ok": true }
  (or: reset-password also clears the PIN and the next login asks for a new one)

POST /auth/verify-pin  wrong PIN →
  401 { "code": "PIN_INVALID", "attemptsRemaining": 3 }
  423 { "code": "PIN_LOCKED", "retryAfter": 900 }
```

  Please also confirm the attempt counter is per account (shared by `security/confirm-pin` and `face-update/pin`).
- **Source:** `BACKEND_CONSOLIDATED_REPORT.md` B1–B4.

### 4. Distinct error codes on login failure — P2, open

- **Today:** any 401 from `/auth/login` is shown as "Invalid credentials".
- **Why backend:** a locked account, unverified email or half-finished registration also comes back as 401, so the app can't tell the user what to do.
- **Suggested contract:** `401 { "code": "INVALID_CREDENTIALS" }`, `403 { "code": "ACCOUNT_LOCKED" | "EMAIL_NOT_VERIFIED" | "REGISTRATION_INCOMPLETE" }`. Never `200` with missing tokens; a multi-step login returns `202 { "nextStep": "..." }`.
- **Source:** `BACKEND_LOGIN_ISSUE_REPORT.md` §4, §6 #4.

### 5. `409` from `/auth/register` for an existing account — P1, verify

- **Today:** as of 17 Sep 2026, registering a phone that already has a completed account returned `202` with a `registrationId`. The app only learns about the duplicate at the email-OTP step (it handles `409` there: `src/features/auth/components/OtpVerification.tsx:142-180`), after the user has filled in the whole form.
- **Needed:** `POST /auth/register` returns `409 { "code": "ACCOUNT_EXISTS" }` when the phone belongs to a completed account. A registration still in progress keeps returning `202`.
- **Source:** `BACKEND_ISSUES.md` #8.

### 6. Auth contract confirmations — P2, verify

The app works today under these assumptions. Please confirm each, or tell us what differs:

| Item | App assumption | Evidence |
|---|---|---|
| Phone format | Register sends `{ phone, countryCode }`; login sends a combined `+<cc><digits>` identifier. Backend stores E.164 and normalises at lookup. | `src/types/domain.ts` `RegisterRequest` / `LoginRequest` |
| User flags | `AuthResponse.user` and `GET /user/me` always include `faceEnrolled: boolean` and `biometricConsentAt: string \| null`. If either is missing, post-login routing goes wrong. | `BACKEND_CONSOLIDATED_REPORT.md` A2 |
| Password reset OTP | `verify-otp` (purpose `password_reset`) does not consume the OTP; the same OTP is sent again to `reset-password`. | `src/app/(auth)/forgot-password.tsx:80` |
| Password policy | 8–128 chars, upper, lower, digit, symbol, enforced by the server on register, reset and change (the app now enforces this on all three). | `src/features/auth/schemas.ts`, `src/app/security/change-password.tsx:18-25` |
| Token field names | `accessToken` / `refreshToken` camelCase on login, refresh and email verify (the app also accepts snake_case). | `src/api/client.ts:116-117`, `src/api/endpoints.ts` `login` |

- **Source:** `BACKEND_CONSOLIDATED_REPORT.md` A1–A3, A7; `BACKEND_ISSUES.md` #2.

### 7. Profile fields: DOB format, `address`, partial PUT, profile picture — P2, open / verify

- **Today:** registration sends `dateOfBirth` as `MM/DD/YYYY` (`src/features/auth/schemas.ts:43`); Edit profile sends ISO `YYYY-MM-DD`, so the first profile save changes the stored format. Extracted document DOBs are ISO, so the mismatch screen can show the same date in two formats.
- **Needed:**
  1. One canonical DOB format. We propose ISO `YYYY-MM-DD` everywhere. Tell us if the server normalises on write; otherwise the app will switch registration to ISO.
  2. Confirm `GET /user/me` returns `address`, and that `PUT /user/me` is a partial update (the app omits unchanged keys).
  3. **verify:** is `POST /profile/picture` / `GET /profile/picture` live in dev? The app calls it and, on any error, saves the picture only on the phone (`src/features/profile/hooks.ts:46-66`, `src/services/profileImageStore.ts:1-8`).
- **Source:** `BACKEND_CONSOLIDATED_REPORT.md` A5, A6.

---

## Identity & documents

### 8. Fetch captured document images — P1, open

- **Today:** `GET /documents/{id}` returns no image and `portraitImageUrl` / `documentImageUrl` come back `null`. The app keeps the captured front/back/selfie only on the phone (`src/services/documentImageStore.ts`). The Document detail "View scan" flip and the verified-screen portrait (`src/app/document/verified.tsx:94`, falls back to the selfie) are lost after reinstall, on a new phone, or for documents added on another device.
- **Needed:** server-stored images with short-lived signed URLs. Once this ships the app stops storing document photos on the device.
- **Suggested contract:**

```http
GET /documents/{id}/images
→ { "front": { "url": "https://…", "expiresAt": "ISO" },
    "back": null,
    "selfie": { "url": "…", "expiresAt": "ISO" },
    "portrait": { "url": "…", "expiresAt": "ISO" } }
```

  …and fill `portraitImageUrl` / `documentImageUrl` on the verify response and on `GET /documents[/{id}]`.
- **Source:** `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #5; `BUG_REPORT_BACKEND_EXTRACTED_DATA.md` §4.

### 9. Remaining extracted fields and document number clean-up — P1, verify

As of 6 Sep 2026 the verify response returns `extractedName`, `extractedDob`, `issuingState` and `extractedDocumentNumber`. Still open at that time:

| Field / issue | Observed | Needed |
|---|---|---|
| `dateOfExpiry` | always `null` (passport and DL) | map the Regula expiry field; also set `expiresAt` on the document |
| `matchScore` | `null` even when `selfieImageBase64` was sent | forward the selfie to Regula and return the face-match score (0–1) |
| `nationality` | `null` on passports | map the Regula nationality field |
| `number` = `"PENDING"` | app creates the document with `number: "PENDING"` because the real number only exists after OCR (`src/app/document/processing.tsx:79`, `:133`) | overwrite `number` with the masked extracted number after verify (or make `number` optional on `POST /documents`) |
| Number encoding | stored DL numbers contained `�` characters | normalise to ASCII/UTF-8 before storing |
| Masking | the app renders `number` exactly as received | confirm `number` is masked (`••••1234`) in every response, including `POST /documents` |

- **Source:** `BUG_REPORT_BACKEND_EXTRACTED_DATA.md` (6 Sep update); `BACKEND_REPORT_PASSPORT_VERIFICATION.md` R5; `BACKEND_CONSOLIDATED_REPORT.md` D1, D2.

### 10. Passport decision: auto-approve policy, liveness binding, reason codes, `review` — P1, open

- **Today:** a real US passport with full OCR and portrait extraction came back non-approved. The app maps every outcome other than `approved` (including `review`) to "Verification Failed" (`src/app/document/verified.tsx:75-77`; `processing.tsx:184` routes `approved` and `review` to that screen). Driving licences pass with `matchScore: null`, i.e. no face match.
- **Needed:**
  1. **Approval policy:** OCR fields present + authenticity checks pass + document portrait matches the user's **enrolled face** → `approved`. Keep `review` for genuinely ambiguous cases.
  2. **Trusted face reference:** either match the portrait against the enrolled face, or honour `livenessSessionId` on `POST /documents/{id}/verification-sessions` (already in `VerificationSessionRequest`; the app will send it once you confirm).
  3. **Reason codes** on non-approved outcomes: `PROFILE_MISMATCH`, `DOCUMENT_FACE_MISMATCH`, `NO_PORTRAIT_IN_DOCUMENT`, `DOCUMENT_TYPE_MISMATCH`, `AUTHENTICITY_FAILED`, `MANUAL_REVIEW_QUEUED`.
  4. **`review` semantics:** if manual review stays, confirm it means "pending human review" and that the result arrives later (notification + `GET /document-verification-sessions/{id}`). The app will then show "Under review" instead of "Failed".
  5. Optional: accept `multipart/form-data` on `/verify` instead of base64-in-JSON to avoid 413s on large captures.
- **Questions:** what `reasonCode` did the failing passport session return? Is the face-match threshold configurable per document type?
- **Source:** `BACKEND_REPORT_PASSPORT_VERIFICATION.md` R1–R4, R7, §8; `BACKEND_CONSOLIDATED_REPORT.md` D3.

### 11. One document per type — P3, open

- **Today:** after a successful re-verify the app deletes older documents of the same type itself (`src/app/document/processing.tsx:190-202`). A test account had 5 verified driving licences.
- **Needed:** enforce one active document per (person, type) on the server (replace on re-verify), or confirm the app-side clean-up is the intended design, and clean up existing duplicates.
- **Source:** `BACKEND_REPORT_PASSPORT_VERIFICATION.md` R6.

### 12. Identity strength / security score — P2, new

- **Today:** the Wallet shows an "Identity strength" score out of 100 calculated on the phone: face 40, document 35, selfie match 25, `pending` counts half (`src/app/(tabs)/documents.tsx:155-163` `strengthOf`). The improvement hint is also chosen on the phone. Security shows an empty score ring as Coming soon (`src/app/security/index.tsx:69-71`, `ScoreHero` at `:126`).
- **Why backend:** the score should be the same on every device and include signals the phone can't see (2FA, document expiry, failed attempts, sessions).
- **Suggested contract:**

```http
GET /user/me/security-score
→ { "score": 92,
    "identityStrength": 85,
    "suggestions": [{ "id": "enable_2fa", "title": "Turn on 2-step sign-in", "points": 8 }] }
```

- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #5.

### 13. Richer account activity in `/identity/summary` — P2, new

- **Today:** Home shows "Recent activity" until the first check-in (`src/app/(tabs)/index.tsx:88-96`, `:293-296`). It uses `summary.activity`, whose `timestamp` is a preformatted string (`"Jul 1, 10:04 AM"` in the contract fixture `src/api/data/identitySummary.json`). Because the server list is usually empty, the app builds the rest itself from the documents list, family list and `faceEnrolled` (`src/premium/flows/home.tsx:861-925` `buildActivity`). Those derived rows have no real time.
- **Needed:** server events with ISO timestamps and a type the app can route on.
- **Suggested contract** (on `GET /identity/summary`, or a separate `GET /user/me/activity?limit=20`):

```json
"activity": [
  { "id": "evt_1", "type": "face_enrolled" | "document_added" | "document_verified" | "document_failed"
            | "family_member_added" | "family_face_enrolled" | "check_in" | "password_changed",
    "title": "Passport verified", "occurredAt": "2026-10-03T09:12:00Z",
    "tone": "success" | "warning" | "error",
    "ref": { "documentId": "…" } }
]
```

- **Source:** new (premium UI); `CUSTOMER_APP_FRONTEND_INTEGRATION.md` §12.

### 14. Issued credentials (`GET /documents/issued`) — P2, verify

- **Today:** the Wallet's "Issued to you" section always shows its empty state "No issued credentials" (`src/app/(tabs)/documents.tsx:135-146`). The app does not call any issued-credentials endpoint.
- **Note:** the integration contract lists `GET /cb/documents/issued` returning `IssuedDoc[]` (`id, name, issuer, issuedAt, icon, number, status: Active|Expired`) (`CUSTOMER_APP_FRONTEND_INTEGRATION.md` §10). Please confirm it is deployed, what produces the data (venue check-ins?), and whether it can return data on dev. The app will wire it as soon as you confirm.
- **Source:** `CUSTOMER_APP_FRONTEND_INTEGRATION.md` §10; premium UI.

### 15. Document share link and usage history — P3, open

- **Today:** Document detail shows a disabled "Share" button (`src/app/document/[id].tsx:158-166`) and a Coming soon "Recently used at" section (`:215-220`).
- **Suggested contract:**

```http
POST /documents/{id}/share  { "expiresInMinutes": 30, "fields": ["name", "dob", "photo"] }
→ { "url": "https://…", "expiresAt": "ISO" }
GET  /documents/{id}/usage  → [{ "venue": "…", "kind": "hotel", "usedAt": "ISO", "bookingId": "…" }]
```

- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #8.

### 16. Supported document types — P3, open

- **Today:** the `DocumentType` enum is fixed in the app: `passport | drivingLicense | idCard | greenCard | birthCertificate | usVisa` (`src/types/domain.ts`). The design's "Add more" also shows Voter ID; Aadhaar/PAN are not supported.
- **Needed:** a product decision on India types, and ideally `GET /documents/types/supported` → `[{ "type": "passport", "label": "Passport", "selfieRequired": true, "minAge": 0 }]` so the app stops hard-coding rules like "no selfie for birth certificate" and "no driving licence for minors".
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #8; `BACKEND_REPORT_PASSPORT_VERIFICATION.md` §7.5.

### 17. Liveness contract: evidence body encoding and confirmations — P3, open

- **Evidence encoding:** the BFF drops JSON bodies on `POST /liveness/v2/challenge/{id}/evidence` (422, every field `input: null`). The app now sends `application/x-www-form-urlencoded`, which works (`src/api/endpoints.ts:313-340`). Please either fix JSON forwarding and tell us, or make form encoding the official contract.
- **Confirmations:**
  - `challenge_sequence` is a closed enum `blink | turn_left | turn_right`. Please give notice before adding new actions; the app fails the session on unknown ones.
  - Can a step be retried within the same session after `max_ms`, instead of starting a new session?
  - On 429: which signal is authoritative, the `Retry-After` header or a `retry_after` body field? The app currently uses a fixed 10 s cooldown.
  - Finalize: field name `frame`, JPEG only. Please share the max size and minimum resolution.
  - `antispoof_score`: is higher better, and may the app show it to users?
- **Source:** `BUG_REPORT_LIVENESS_EVIDENCE.md`; `BACKEND_BLOCKERS_REPORT.md` Issue 1; `BACKEND_CONSOLIDATED_REPORT.md` C1–C6.

### 38. Reject expired documents on the server — P1, new

- **Today:** `/verify` can return `approved` for an expired document; there is no expiry reason code. Since 28 Oct 2026 the app checks `dateOfExpiry` itself and deletes an approved document that has expired (`src/app/document/processing.tsx`, `src/features/documents/identityChecks.ts`). It does the same when `extractedName` clearly differs from the profile name.
- **Problem:** by the time the app sees the approval, the server has already removed the user's older **verified** document of that type (§6.5 one-per-type). An expired scan therefore costs the user their valid document.
- **Needed:**
  1. Reject expired documents in `/verify` with a new `reasonCode: "DOCUMENT_EXPIRED"`, before replacing any older document.
  2. Return `dateOfExpiry` (ISO `yyyy-mm-dd`) on every passport and licence (see #9; it was always `null` on 6 Sep). Without it the app can't detect expiry at all.
  3. Only replace the older verified document after every check has passed.
- **Question:** how strict is the `PROFILE_MISMATCH` name check? The app accepts case, accent, punctuation and word-order differences, a missing middle name and initials (`namesMatch`). Please match that so the two sides agree.

---

## Family

### 18. Removed member can't be added again — P1, open

- **Today:** after `DELETE /family/{id}`, adding the same name + DOB fails with "A family member with this name and date of birth already exists", but that member is not in `GET /family`. The user is stuck.
- **Needed:** a removed member must not block re-adding. Either exclude deleted rows from the uniqueness check or restore the old record. Please also confirm whether `DELETE /family/{id}` is a hard or soft delete (the contract says "tombstones").
- **Source:** `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #1.

### 19. Machine-readable duplicate error on `POST /family` — P2, open

- **Today:** the app detects a duplicate by status `409` **or** by matching the message text `/already exists/` (`src/features/family/hooks.ts:168-173`).
- **Suggested contract:**

```json
HTTP 409
{ "code": "FAMILY_MEMBER_EXISTS", "message": "…", "existingMemberId": "<id>" }
```

  With `existingMemberId` the app opens that member instead of showing an error.
- **Source:** `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #2.

### 20. `dateOfBirth` on `GET /family` items — P2, verify

- **Today:** the pre-submit duplicate check compares name + DOB, and falls back to comparing `age` when `dateOfBirth` is missing (`src/features/family/hooks.ts:149-166`). `FamilyMember.dateOfBirth` is typed optional, "absent on older payloads". Comparing ages can miss real duplicates or flag two different people of the same age. The member activity timeline also needs it for the "Turns 18 on …" milestone (`src/app/family/[id]/activity.tsx:37-45`).
- **Needed:** always return `dateOfBirth` (`YYYY-MM-DD`) on `GET /family` and `GET /family/{id}`, including for members created before the field existed.
- **Source:** `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #3.

### 21. Define member `verification` values — P2, open

- **Today:** after a member's document is added and their face enrolled, `faceEnrolled` becomes `true` but `verification` never becomes `"verified"`. The app treats `faceEnrolled || verification === 'verified'` as "setup complete" (`src/app/family/[id].tsx:63-67`, `src/app/family/index.tsx:67`). Observed values include `pending_document` and `pending_liveness`.
- **Needed:** document the full set of `verification` values and when each is set; set `"verified"` once setup is complete (document + face for 5–17; document + photo for 0–4).
- **Source:** `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #4.

### 22. Member photos stored on the server — P1, new

- **Today:** a member's avatar is the photo taken at face enrolment, or a camera/gallery pick. It is resized and saved **only on this phone** as `member-<personId>-image.jpg` (`src/services/profileImageStore.ts` `saveMemberFacePhoto`, `saveMemberProfileImage`; hooks `useMemberPhoto`, `useSetMemberPhoto`, `useRememberMemberPhoto` in `src/features/family/hooks.ts:78-140`). The photos are lost on reinstall or a new phone, and wiped on logout. Other devices show initials.
- **Needed:** a photo URL on the member and an upload endpoint, mirroring `/profile/picture`.
- **Suggested contract:**

```http
GET /family, GET /family/{id}
→ { …, "photoUrl": "https://…signed…", "photoUrlExpiresAt": "ISO" }   (null when none)

POST   /family/{id}/picture   multipart, field "file" (JPEG ≤ 2 MB, ~480 px)
→ { "url": "https://…", "expires_in": 3600, "updated_at": "ISO" }
DELETE /family/{id}/picture   → { "ok": true }
```

  Optionally the server could set the photo from the enrolment capture itself (liveness finalize frame, or `selfieBase64` for under-5s), so the app doesn't need to upload it separately. Photos should be deleted with the member.
- **Source:** new (premium UI); `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #9 (photo URL).

### 23. Update a family member's face (`PUT /face` with `personId`) — P1, new (needs confirmation)

- **Today:** the Update face flow (PIN → liveness → `PUT /face`) accepts an optional `personId` and passes it through. It creates the liveness challenge with `?personId=` and sends `{ livenessSessionId, sessionToken, personId }` to `PUT /face` (`src/app/face-update/pin.tsx:16-31`, `src/app/face-update/camera.tsx:10-34`, `src/features/liveness/LivenessCamera.tsx:407-425`). An "Update face" action for family members is being wired up now.
- **Unclear in the docs:** the contract only says "run a new liveness session and send the same body to `PUT /cb/face`" (`CUSTOMER_APP_FRONTEND_INTEGRATION.md` §9 "Update face"). It does not say whether `PUT /face` accepts `personId` for a family member.
- **Please confirm:**
  1. `PUT /face` with `personId` replaces that member's template (ownership checked), and a challenge created with `?personId=` is accepted for it.
  2. For members aged 0–4 (photo mode, enrolled with `{ selfieBase64, personId }` via `POST /face/enroll`, `src/features/liveness/PhotoCapture.tsx:82-83`): does `PUT /face` accept `selfieBase64`? `FaceUpdateRequest` currently has no such field.
  3. Is the account PIN the right re-auth gate for changing a member's face?
- **Source:** new.

### 24. Family activity projection — P2, open

- **Today:** `GET /family/{id}/activity` returns `[]` because the activity projection isn't connected (contract §11). The member activity screen builds its timeline locally from the member, their documents and "added to family" (`src/app/family/[id]/activity.tsx:1-8`, `:55-80`). `ActivityLogItem.date` is a display string in the fixture (`"Jul 20, 2026"`).
- **Needed:** connect the projection; return `[{ "id", "type", "title", "occurredAt": "ISO", "ref": { … } }]` with the same event types as #13, plus check-ins where the member is in `checkedInMembers`.
- **Source:** `CUSTOMER_APP_FRONTEND_INTEGRATION.md` §11; new (premium UI).

### 25. Member permissions and turning-18 handover — P3, open

- **Today:** Member detail shows a Coming soon "Permissions" group: "Check in independently" and "Notify me on every check-in" (`src/app/family/[id].tsx:306-311`). The turning-18 handover has no screen yet; the timeline only shows the "Turns 18 on …" milestone.
- **Suggested contract:**

```http
PATCH /family/{id}/permissions  { "independentCheckIn": true, "notifyOnCheckIn": true }  → FamilyMember
POST  /family/{id}/handover-invite  { "email": "…", "phone": "…" }  → { "inviteId", "expiresAt" }
```

  Return the current permissions on `GET /family/{id}`.
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #9.

---

## Bookings & check-ins

### 26. Check-in event producer for `GET /bookings` — P0, open

- **Today:** QA completed real venue check-ins, but the Check-ins tab shows "No bookings yet" because `GET /cb/bookings` returns `[]`. The bookings read model exists, but no check-in event reaches it. The Home "Today / Next check-in" card, the booking detail, the Check-ins stats and family check-in history all depend on this. The app is read-only for history. An unexpected response shape is now shown as an error, not as an empty list (`src/api/endpoints.ts:86-104`).
- **Needed:**
  - The venue/check-in service publishes one event per terminal check-in (`completed` / `failed`) and for upcoming reservations (`upcoming`), with `eventId` for idempotency, `customerId` = account holder (the guardian for a minor), and `checkedInMembers`.
  - customer-account-service upserts by `bookingId`, dedupes on `eventId`, alerts on unknown customers, and sends failures to a DLQ.
  - `GET /bookings` returns a bare array (or `{ bookings: [] }`), newest `checkIn` first, lowercase `status`, ISO timestamps, owner-scoped (404 on other users' ids), visible within about 5 s.
- **Open questions:** which service owns check-ins and which topic to use; backfill plan for QA's dev check-ins; is `amount` meaningful?
- **Source:** `BUG018_CHECKIN_HISTORY_BACKEND.md` (full event shape and acceptance criteria there); `BACKEND_INTEGRATION_REPORT.md` §6; contract §13/§16.

### 27. Face check-in at venues from the app — P1, open

- **Today:** the Home "Today / Next check-in" card shows a disabled "Check in with your face" button (`src/app/(tabs)/index.tsx:176-182`). Settings → "On the way" lists a "Face check-in at venues" opt-in toggle as Coming soon (`src/app/settings/index.tsx:109-112`). The app can only enrol or re-enrol a face.
- **Question first:** does check-in happen only at the venue (kiosk/partner camera), or should the phone also be able to check in? If venue-only, the app needs just the opt-in (#35) and the history (#26).
- **Suggested contract (if from the phone):**

```http
POST /bookings/{id}/check-in
{ "livenessSessionId": "…", "sessionToken": "…", "personIds": ["self", "child-id"] }
→ { "status": "checked_in" | "rejected", "checkedInAt": "ISO", "matchScore": 0.97, "durationMs": 820,
    "reasonCode": null }
```

- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #1.

### 28. Richer booking detail — P2, open

- **Today:** `Booking` has `venue, location, type, image, checkIn, checkOut, status, guests, amount, checkedInMembers`. The detail screen (`src/app/booking/[id].tsx:1-8`) replaces the design's venue services with local "Before you go" rows, because the API has no service data.
- **Needed on `GET /bookings/{id}`:**

```json
{ …,
  "kind": "hotel|park|flight|cinema|cruise|stadium|concert",
  "detail": "Deluxe room · Floor 12",
  "confirmationCode": "TP-8F2K1",
  "checkOutTime": "11:00",
  "services": [{ "id": "spa", "title": "Spa", "subtitle": "Open 9–21", "status": "available" }] }
```

- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #3.

### 29. Identity pass / digital key — P3, open

- **Today:** Home quick actions "Share identity" and "Digital keys" are Coming soon (`src/app/(tabs)/index.tsx:259-260`). The redesign dropped the QR pass on Profile, Identity and Booking detail because the face is the key at Truepas venues (`src/app/profile/index.tsx:8-10`, `src/app/identity/index.tsx:7-8`, `src/app/booking/[id].tsx:4-6`), so this only matters if product keeps those two actions.
- **Suggested contract:** `GET /bookings/{id}/pass` → `{ "kind": "room|gate|seat|cabin|entry", "label", "sublabel", "qrPayload": "signed-token", "expiresAt" }`; `GET /user/me/pass` → `{ "qrPayload", "expiresAt" }` (short-lived, signed, so screenshots can't be reused).
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #2.

### 30. Check-in stats — P3, open

- **Today:** the Check-ins tab hero ("Your 2026 so far") computes check-ins, places and guests from the bookings list. "Avg. time" shows "—" with a "Timing soon" tag (`src/app/(tabs)/history.tsx:270-293`).
- **Suggested contract:** `GET /user/me/stats?year=2026` → `{ "checkIns": 24, "cities": 9, "avgCheckInMs": 3100, "minutesSaved": 360 }`. Alternatively add `durationMs` to each booking and the app computes it.
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #4.

---

## Notifications

### 31. Mark notifications read (single + all) — P1, open

- **Today:** tapping a notification or "Mark all read" only updates local screen state (`src/app/notification/index.tsx:65-69`). The next refetch brings the unread state and the bell badge back.
- **Suggested contract:**

```http
POST /notifications/{id}/read   → { "ok": true }
POST /notifications/read-all    → { "ok": true, "updated": 7 }
```

- **Source:** `BACKEND_CONSOLIDATED_REPORT.md` E1; `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #7.

### 32. `unread_count`, `type` enum, deep-link payload, server filter — P2, open

- **Today:** the badge counts unread items in loaded pages only. Category chips filter locally by `type` using the labels `identity, document, account, booking, family` (`src/app/notification/index.tsx:33-39`, `:78-81`). Taps don't navigate anywhere.
- **Needed:**
  - `unread_count` in the `GET /notifications` response (or `GET /notifications/unread-count`).
  - The official `notification_type` enum.
  - A payload for deep links, e.g. `{ "type": "booking", "bookingId": "…" }`, `{ "type": "document", "documentId": "…" }`, `{ "type": "family", "personId": "…" }`.
  - Optional server filter `GET /notifications?type=…`.
- **Source:** `BACKEND_CONSOLIDATED_REPORT.md` E2, E3; `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #7.

### 33. Notification preferences and push device tokens — P2, open

- **Today:** there is no push. The app has no push client, and the contract says push, device-token registration and preferences are not public yet (§14). Settings → Notifications only opens the phone's system settings (`src/app/settings/index.tsx:104-106`). "Notify me on every check-in" (#25) needs push.
- **Suggested contract:**

```http
POST   /user/me/devices          { "pushToken": "ExponentPushToken[…]", "platform": "android" }
DELETE /user/me/devices/{id}
GET    /user/me/notification-preferences  → { "checkin": true, "family": true, "security": true, "document": true }
PUT    /user/me/notification-preferences  (same shape)
```

- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #7; `BACKEND_INTEGRATION_REPORT.md` §6; contract §14, §16.

---

## Settings & support

### 34. Download my data (export) — P2, new

- **Today:** Data & privacy shows "Download my data — Export all your data as ZIP" as Coming soon (`src/app/legal/data-privacy.tsx:39`).
- **Suggested contract:** `POST /user/me/export` → `202 { "exportId" }`; `GET /user/me/export/{exportId}` → `{ "status": "pending|ready|expired", "url": "signed", "expiresAt" }`, plus a notification when it's ready.
- **Source:** new (Coming soon marker in the premium UI).

### 35. Account preferences — P3, open

- **Today:** haptics and app lock are device-only settings kept in SecureStore (`src/services/prefs.ts:1-5`). Settings → "On the way" shows "Face check-in at venues" (opt-in) and "Language" as Coming soon (`src/app/settings/index.tsx:109-112`). Data & privacy shows "Share usage analytics" as Coming soon (`src/app/legal/data-privacy.tsx:95`).
- **Suggested contract:** `GET/PUT /user/me/preferences` → `{ "language": "en", "region": "IN", "faceCheckInEnabled": true, "shareAnalytics": false }`.
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #10.

### 36. Support channels — P3, open

- **Today:** Help → "Chat with us" and "Call us" are Coming soon. "Email us" works through `mailto` (`src/app/help/index.tsx:178-196`).
- **Needed:** support phone number / hours and a chat deep link or SDK choice, ideally from a config endpoint (`GET /support/channels` → `{ "email", "phone", "hours", "chatUrl" }`) so they can change without an app release.
- **Source:** `BACKEND_PREMIUM_FEATURE_REQUESTS.md` #10.

### 37. Delete-account reason — P3, new

- **Today:** Delete account shows an optional "Mind telling us why?" chip group (Privacy concerns / Not using it / Too few venues / Other) as Coming soon (`src/app/account/delete/index.tsx:101-112`). `DELETE /user/me` takes only `{ confirmation, pin }`.
- **Suggested contract:** accept optional `"reason": "privacy|not_using|few_venues|other"` and `"comment"` on `DELETE /user/me`.
- **Source:** new (Coming soon marker in the premium UI).

---

## Appendix: closed items from older reports

These were dropped because the app code or later reports show they are resolved, or because they are app-side work rather than backend work.

| Older item | Why dropped |
|---|---|
| `customer-account-service` down, 503 on register/login/account-details (`BACKEND_ISSUES.md` #1–3, `BACKEND_INTEGRATION_REPORT.md` §3) | Login, registration and phone/email OTP are reported working in `BACKEND_BLOCKERS_REPORT.md` ("What works end-to-end"). |
| Dev test OTP `123456` (`BACKEND_ISSUES.md` #4) | Same: the registration OTP flow works on dev. |
| Document verify 503 "images required until object storage…" (`BUG_REPORT_DOCUMENT_VERIFY.md`, `BACKEND_BLOCKERS_REPORT.md` Issue 2, `BACKEND_ISSUES.md` #5, signed-upload rows in `BACKEND_INTEGRATION_REPORT.md` §6) | Base64 verify now returns real outcomes and extracted data (6 Sep update in `BUG_REPORT_BACKEND_EXTRACTED_DATA.md`; DL `approved` in the passport report). The app uses `startVerificationWithImages` (`src/api/endpoints.ts:267`). Multipart upload remains an optional ask in #10. |
| Extracted `extractedName`, `extractedDob`, `issuingState`, `extractedDocumentNumber` missing | Confirmed returned as of 6 Sep (`BUG_REPORT_BACKEND_EXTRACTED_DATA.md`). Remaining fields are in #9. |
| Liveness/face endpoints deployed in dev (`BACKEND_ISSUES.md` #6) | Self and family face enrolment work (members reach `faceEnrolled: true`, `BACKEND_FAMILY_AND_DOCUMENT_REQUESTS.md` #4). |
| Liveness evidence body dropped, blocking (`BUG_REPORT_LIVENESS_EVIDENCE.md`) | No longer blocking: form-encoded workaround in `src/api/endpoints.ts:313-340`. The clean-up ask moved to #17 (P3). |
| Biometric consent endpoint deployed (`BACKEND_ISSUES.md` #7) | In use by onboarding consent and the Security consent toggle (`src/app/security/index.tsx`). No open failure reported. |
| Account-specific login 401 for `+19076433740` (`BACKEND_LOGIN_ISSUE_REPORT.md` §5–7 #1–3) | Single-account debugging from 6 Sep. The general asks are kept in #4 and #6. |
| Password policy differing across screens (`BACKEND_CONSOLIDATED_REPORT.md` A7, app side) | Reset and change password now use the shared `newPasswordSchema`. Only the server-side enforcement confirmation remains (#6). |
| `PENDING_INTEGRATIONS.md` (EAS/iOS builds, ML Kit calibration, document-type rules, image compression, 413/429/503 handling, recovery poll) | App-side work, not backend requests. |
