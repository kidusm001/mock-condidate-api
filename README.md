# mock-condidate-api

Mock Frappe candidates API for local development. Serves the same `receive_candidate` contract so a consuming project can swap its real Frappe backend for this mock without code changes.

## Install

```bash
bun install
```

## Run

```bash
bun run dev      # hot reload
bun start        # production-style start
```

Listens on `http://localhost:8001` by default (override with `PORT`).

The dev/start scripts load environment variables from `.env` via Bun's `--env-file` flag.

## Configuration (`.env`)

```
WEBHOOK_URL=http://localhost:8000/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
FRAPPE_BASE_URL=
AUTO_CONFIRM_RESERVATION=false
EXTERNAL_RESERVATION_TOKEN=
GOOGLE_API_KEY=
API_KEY=api_key:api_secret
```

| Var | Purpose | If unset |
|---|---|---|
| `WEBHOOK_URL` | Where to POST a `candidate.created` form-encoded payload after each create | Mock is fully inert, no outbound calls |
| `FRAPPE_BASE_URL` | Origin used to build the Frappe `request_reservation` RPC URL | Derived from `WEBHOOK_URL`'s origin |
| `EXTERNAL_RESERVATION_TOKEN` | Shared secret Frappe must send as `Authorization: token <value>` on `PUT /api/external/reservation`. Must match `external_reservation_token` in Frappe's `site_config.json` | Auth check on that endpoint is disabled — any caller is accepted |
| `AUTO_CONFIRM_RESERVATION` | Auto-call `request_reservation` after receiving a "ready for reservation" PUT | Defaults to `false` — reservation is driven manually (dispatcher UI, or `POST /api/reservations/:id/request-reservation`); set to `true` to auto-confirm |
| `GOOGLE_API_KEY` | Google Places API key used to resolve `dropoff_location` → place data | Place data resolves to all-nulls |
| `API_KEY` | Frappe `api_key:api_secret` pair, sent as `Authorization: token <key>` on outbound calls (webhook, `request_reservation`) | Sent with no auth header (server may reject with `401`/`403`) |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/method/receive_candidate` | Create a candidate (primary) |
| `GET`  | `/api/method/receive_candidate` | Same handler, args from query string |
| `GET`  | `/api/method/frappe.client.get_list?doctype=Candidate` | List all candidates |
| `GET`  | `/api/resource/Candidate/:name` | Fetch one candidate by name |
| `PUT`  | `/api/external/reservation` | Inbound: Frappe notifies a candidate is "Ready for Reservation" |
| `POST` | `/api/reservations/:idOrName/request-reservation` | Manually call Frappe's `request_reservation` |
| `POST` | `/api/reset` | Wipe store and reseed |
| `GET`  | `/health` | Liveness check |
| `GET`  | `/` | HTML form for manual testing |
| `OPTIONS` | `*` | CORS preflight |

## `receive_candidate` Contract

### Request

```json
{
  "candidate_name": "Alice Smith",
  "dropoff_location": "Near Edna Mall, Bole",
  "phone": "+251911234567",
  "id": "REQ-9001"
}
```

- `candidate_name` — required, string
- `dropoff_location` — required, string (raw text — gets resolved to a Place)
- `phone` — optional, string
- `id` — optional, string

Unknown fields are rejected with `400 ValidationError`.

### 201 Response

```json
{
  "name": "Alice Smith",
  "candidate_name": "Alice Smith",
  "id": "REQ-9001",
  "phone": "+251911234567",
  "dropoff_location": "Near Edna Mall, Bole",
  "dropoff_place": {
    "place_id": "ChIJ...",
    "display_name": "Edna Mall",
    "formatted_address": "Bole, Addis Ababa, Ethiopia",
    "lat": 9.0054,
    "lng": 38.789
  },
  "created_at": "2026-06-02T14:35:03.362Z"
}
```

`dropoff_place` is `null` or all-nulls if `GOOGLE_API_KEY` is unset, Google returned no result, or the call failed.

### Error Responses

- **400 Bad Request** — `{"error":"ValidationError","message":"..."}`
- **409 Conflict** — `{"error":"DuplicateCandidate","message":"..."}`

## Place Resolution Flow

1. Mock receives `receive_candidate` with `dropoff_location` (raw text)
2. **Cache read** *(deferred — Frappe side endpoint not yet public; will be added when ready)*
3. Mock calls Google Places API (`findplacefromtext`) to resolve to `{place_id, display_name, formatted_address, geometry}`
4. Mock stores the resolved place in the candidate record
5. Mock fires the candidate webhook (see below) carrying the 4 candidate fields + 5 place fields
6. Frappe's `_get_or_create_place` looks up `Place` by `raw_text`; if missing, it creates one; the candidate is linked to it

## Webhook

After a successful create, the mock fires a `POST` to `WEBHOOK_URL` if it is set. Fire-and-forget — the create response is returned immediately and webhook failures are logged but never block or fail the request. If `WEBHOOK_URL` is unset, the mock is fully inert (no outbound calls).

### Payload (form-encoded)

```
candidate_name=Alice+Smith
&phone=%2B251911234567
&external_request_id=REQ-9001
&dropoff_landmark_raw=Near+Edna+Mall%2C+Bole
&dropoff_place_place_id=ChIJ...
&dropoff_place_display_name=Edna+Mall
&dropoff_place_formatted_address=Bole%2C+Addis+Ababa%2C+Ethiopia
&dropoff_place_lat=9.0054
&dropoff_place_lng=38.789
```

### Request headers

```
Content-Type: application/x-www-form-urlencoded
X-Mock-Event: candidate.created
Authorization: token <api_key>:<api_secret>   # only if API_KEY is set
```

5-second timeout on the webhook delivery.

## Reservation Callback Flow

Mirrors `mmcy_fleet_management`'s post-match flow. Approving a match is a
Frappe-side dispatcher decision made in the Frappe desk — the mock does not
call `approve_match` itself. The mock's role starts once Frappe notifies it
that a candidate is ready:

0. After `receive_candidate`'s webhook fires, the mock parses Frappe's
   response (`{"message": "<Candidate name>"}`) and stores it as
   `frappe_candidate` on the local record, purely for display/reference.
1. A dispatcher approves the matched candidate in Frappe (`approve_match`),
   which PUTs to `external_reservation_url` (Frappe's `site_config.json`) —
   point that at this mock's `PUT /api/external/reservation`.
2. Payload: `{external_request_id, candidate, candidate_name, matched_route, state}`.
   The mock looks up the local candidate by `external_request_id` and records
   the reservation state as `Ready for Reservation`.
3. If `AUTO_CONFIRM_RESERVATION=true`, the mock calls Frappe's
   `request_reservation` (form-encoded POST, carrying `external_request_id`),
   advancing the candidate `Approved → Requested Reservation → Reserved` (or
   leaving it at `Requested Reservation` if the route is full). Defaults to
   `false`, so the candidate rests at `Approved` until reservation is triggered
   manually.
4. If `AUTO_CONFIRM_RESERVATION=false`, trigger the call manually — click
   **"Request Reservation"** on the candidate's card, or
   `POST /api/reservations/:idOrName/request-reservation` (accepts either the
   mock's candidate `name` or its `id`/`external_request_id`).

Reservation state is stored per-candidate under `reservation`:

```json
{
  "status": "Ready for Reservation" | "Requested" | "Failed",
  "matched_route": "ROUTE-0001",
  "frappe_candidate": "CAND-0001",
  "notified_at": "2026-07-02T15:56:52.515Z",
  "requested_at": null,
  "response": null
}
```

## Storage

Candidates are persisted to `data/candidates.json` (gitignored). On first boot, the file is seeded with 3 sample candidates — each with a pre-resolved `dropoff_place` for Edna Mall, Piassa, and Sarbet.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
