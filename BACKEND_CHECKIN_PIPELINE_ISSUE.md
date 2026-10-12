# Check-ins never reach customer history: event delivery gap (BUG018)

| | |
|---|---|
| **Related bug** | BUG018: completed check-ins missing from Check-In History |
| **Severity** | High. Every kiosk check-in on dev is missing from the User App |
| **Owner** | Backend / platform: event-relay-service, kiosk-service, customer-account-service |
| **Date** | 12-Oct-2026 |
| **Frontend status** | No change needed. The app shows whatever `GET /cb/bookings` returns |
| **Follows up** | [BACKEND_KIOSK_CHECKIN_SYNC.md](BACKEND_KIOSK_CHECKIN_SYNC.md) (10-Oct request: dev evidence and the full app-side checklist) |

## 1. Summary

We read the code of all five services in the check-in path. The producer (kiosk-service) and the consumer (customer-account-service) are correct, and their event contract matches field for field. **The events are most likely lost in event-relay-service.**

With its default config, the relay accepts the event, returns `202 Accepted`, and delivers it nowhere. kiosk-service marks the outbox row as published and never retries. No service logs an error. The kiosk shows a successful check-in, and the customer's history stays empty.

There is also a separate gap: **twin and look-alike check-ins are blocked**. kiosk-service's `verify-pin` always returns 503, even though customer-account-service has stored per-twin PINs since 9 Oct. See §7.

## 2. The check-in path

```
Kiosk app
  → kiosk-bff        POST /kb/api/kiosk/v1/check-ins       (forwards the image only)
  → kiosk-service    POST /ks/api/v1/check-ins             (face match + release)
        writes outbox_events row: checkin.completed.v1 / checkin.failed.v1
  → kiosk-outbox worker (separate process)  POST /er/internal/v1/events
  → event-relay-service                      ❌ events dropped here (see §3)
  → customer-account-service POST /internal/v1/events → customer_bookings
  → customer-app-bff GET /cb/bookings → User App "Check-ins" tab
```

Contract check (no change needed):

| Field | kiosk-service sends (`app/checkin.py` `_record_outcome`) | customer-account-service expects (`app/main.py` `CheckInProjection`) |
|---|---|---|
| `booking_id` | `checkin-<32 hex>` (40 chars) | 1–64 chars ✅ |
| `customer_id` | account holder id from the person directory | 1–36 chars, must exist as an account ✅ |
| `venue` / `location` | merchant venue lookup; falls back to ids, never empty | non-empty ✅ |
| `type` | `"checkin"` | non-empty ✅ |
| `check_in` / `checked_in_at` | date / ISO timestamp | date / datetime ✅ |
| `status` | `completed` \| `failed` | same ✅ |
| `guests` | `1` | ≥ 1 ✅ |
| extra fields (`outcome`, `merchant_id`, …) | sent | ignored ✅ |

## 3. Root cause: event-relay-service drops events in memory mode

Repo: `event-relay-service`

- `app/config.py`: `EVENT_TRANSPORT` defaults to `"memory"` and `CONSUMER_URLS` defaults to `""`.
- `app/publishers.py` `InMemoryPublisher.publish()`: appends the event to an in-process list, then loops over `self.consumers`. **With no consumer URLs the loop body never runs.** The event is not delivered anywhere.
- `app/main.py` `publish_event`: returns `202 {"accepted": true}` anyway.
- `app/config.py` `get_settings()`: only non-dev environments are forced to `EVENT_TRANSPORT=eventbridge`. **Dev may run memory mode with no consumers, and nothing warns about it.**
- Before commit `4063a7c` (30-Sep, "Deliver in-memory transport events to a local target"), memory mode never delivered events to anyone, whatever the config.

Effect on the producer: kiosk-service's `drain_outbox` (`app/outbox.py`) sees a 2xx, sets `published_at`, and never tries again. kiosk-service's `StalledCount` alarm stays at 0, because nothing failed.

## 4. Other ways the chain can break

These may apply as well as §3. Check them in the same pass.

1. **The kiosk-outbox worker isn't deployed.** `python -m app.outbox_worker` is a separate deployment; the Dockerfile only starts the API. It refuses to start without `EVENT_RELAY_API_KEY` (`app/outbox_worker.py`). Without it, outbox rows are created but never published.
2. **Events were ignored before account-service knew the event type.** customer-account-service learned `checkin.*` in `1cab32a` (30-Sep). Any check-in event received before that was saved in `event_inbox` with `applied = false` and acknowledged. Every redelivery since is then treated as a duplicate.
3. **Outbox write failures are swallowed.** In kiosk-service `_record_outcome`, any exception (for example a missing migration) is logged and ignored, and the check-in still succeeds.
4. **Venue names may be missing.** If `MERCHANT_ACCOUNT_SERVICE_API_KEY` is unset in kiosk-service, `venue_details` falls back to the merchant and location ids. History would then show a UUID instead of the venue name.

## 5. How to confirm on dev

**Step 1: kiosk-service DB.** Are rows created and published?

```sql
select event_type, occurred_at, published_at, attempts, last_error
from outbox_events
where event_type like 'checkin.%'
order by occurred_at desc
limit 20;
```

**Step 2: customer-account-service DB.** Did they arrive?

```sql
select event_id, event_type, applied, received_at
from event_inbox
where event_type like 'checkin.%'
order by received_at desc
limit 20;

select id, customer_id, venue, status, checked_in_at
from customer_bookings
where source = 'checkin'
order by checked_in_at desc
limit 20;
```

**Step 3: event-relay-service env on dev.** Check `EVENT_TRANSPORT`, `CONSUMER_URLS`, `CONSUMER_API_KEY`. For eventbridge, also check the EventBridge rule, the SQS queue and the relay worker deployment.

| What you see | Cause |
|---|---|
| No `outbox_events` rows after a check-in | §4.3: outbox write failing. Check kiosk-service logs for `check-in history record failed` |
| Rows with `published_at` null, `attempts` rising, `last_error` set | §4.1 worker/relay error, or account-service rejecting (409/422). Read `last_error` |
| Rows with `published_at` null, `attempts` = 0 | §4.1: kiosk-outbox worker not running |
| Rows published, **no** `checkin.%` rows in `event_inbox` | **§3: relay swallowing events** |
| `event_inbox` rows with `applied = false` | §4.2: ignored before deploy. Needs recovery (§6.3) |
| `event_inbox` applied, `customer_bookings` rows present | Backend is fine; recheck the BFF and token `sub` |

## 6. Requested fixes

### 6.1 Configure delivery on dev (ops)

Pick one:

| Mode | Required config |
|---|---|
| `EVENT_TRANSPORT=memory` | `CONSUMER_URLS=<customer-account-service base URL>`, `CONSUMER_API_KEY=<customer-account-service internal API key>` |
| `EVENT_TRANSPORT=eventbridge` | An EventBridge rule routing `checkin.completed.v1` and `checkin.failed.v1` on the bus to customer-account-service's SQS queue (with DLQ), plus a relay worker (`python -m app.worker`) with `SQS_QUEUE_URL`, `CONSUMER_URL`, `CONSUMER_API_KEY` |

Also confirm the **kiosk-outbox** deployment is running with `EVENT_RELAY_URL` and `EVENT_RELAY_API_KEY`.

### 6.2 Make misconfiguration fail loudly (event-relay-service code)

- In `InMemoryPublisher.publish()`, when no consumers are configured, **raise `PublishError`** (or reject at startup outside `test`) instead of returning 202. The producer outbox then retries and raises its `StalledCount` alarm instead of losing the event.
- Stop keeping every event in `self.events` outside tests. That list grows forever (memory leak).
- Optional: log `event_type` and the consumer count on every publish.

### 6.3 Recover existing check-ins (needs approval; run in this order)

Run both scripts in dry-run mode first:

```bash
# 1. customer-account-service: forget check-in events that were ignored before the consumer existed
python scripts/clear_ignored_checkin_inbox.py           # dry run
python scripts/clear_ignored_checkin_inbox.py --apply

# 2. kiosk-service: queue the already-published check-in events again
python scripts/republish_checkin_events.py --since 2026-09-30T00:00:00Z           # dry run
python scripts/republish_checkin_events.py --since 2026-09-30T00:00:00Z --apply
```

Step 2 also recovers events the relay swallowed (§3), because kiosk-service keeps published rows. Consumers deduplicate on `event_id`, so a republish never creates a duplicate.

**Limitation:** kiosk-service only started writing outbox rows in `ddbf265` (30-Sep). Check-ins before that have no row and cannot be recovered this way.

## 7. Separate issue: twin / look-alike check-in blocked

- kiosk-service `app/checkin.py` `identify_and_release`: when the top two face scores are within the ambiguity margin, it returns `pin_required` and records nothing.
- kiosk-service `app/main.py` `POST /api/v1/check-ins/verify-pin`: **always returns 503** "PIN disambiguation is unavailable during account-service cutover".
- customer-account-service `f11e0ab` (9-Oct) added per-twin kiosk check-in PINs, and customer-app-bff exposes `PUT /cb/family/{person_id}/check-in-pin`. Customers can set the PIN, but no service checks it.

This is the backend half of [BACKEND_TWIN_PIN_REQUEST.md](BACKEND_TWIN_PIN_REQUEST.md) (8-Oct).

**Request:** implement `verify-pin` in kiosk-service against customer-account-service's PIN check, limited to the candidate person ids. After a successful PIN, run the same release + `_record_outcome` path as `matched`.

Until then, twins can never check in at a kiosk, and the kiosk app has nothing to call. We will build the PIN entry screen on the kiosk once the endpoint exists. Please share the request/response contract.

## 8. Acceptance criteria (QA re-test)

1. A check-in on dev appears in `GET /cb/bookings` within about 5 s, with `status: "completed"` and the correct venue name (not an id).
2. A not-eligible check-in appears with `status: "failed"`.
3. A family member's check-in appears in the guardian's history with the member in `checkedInMembers`.
4. After the §6.3 recovery, QA's check-ins since 30-Sep appear once each, with no duplicates.
5. With the relay deliberately misconfigured, kiosk-service outbox rows stay unpublished and `StalledCount` alarms. Events are no longer silently dropped.
6. Twins: after a PIN is set, a twin can check in with the PIN, and the check-in appears in history.

## 9. Open questions

1. Which transport does dev's event-relay-service run today (`memory` or `eventbridge`), and what are `CONSUMER_URLS` / the EventBridge rules?
2. Is the kiosk-outbox worker deployed on dev?
3. Has the EKS guide §14.1 recovery been run on dev already?
4. What timeline and contract can we expect for `verify-pin`?
