# Charging map and station proposals

The routes below use the `/api/v1` prefix. Write requests and proposal reads require an access token in `Authorization: Bearer <token>`. Administrator routes additionally require the database administrator role.

| Method and path | Access and input | Successful response |
| --- | --- | --- |
| `GET /connector-types` | Public | `200`, array of `{ id, label }` |
| `GET /stations` | Public. Optional viewport `south`, `west`, `north`, `east`, optional `limit` from 1 to 200, and optional `includeChargers=true` or `false` | `200`, array of station summaries, with `chargers` when requested |
| `GET /stations/:id` | Public | `200`, station summary with individual chargers |
| `POST /stations` | Administrator. Station input with optional source metadata and confirmed station ID | `201`, station detail |
| `POST /stations/:id/chargers/:chargerId/reports` | Signed in. `{ status, durationMinutes? }` | `201` with `{ id, chargerId, status, reportedAt, occupiedUntil }` |
| `POST /station-proposals` | Signed in. Station input below | `201`, proposal |
| `GET /station-proposals` | Signed in | `200`, proposals belonging to the signed-in user |
| `GET /station-proposals/:id` | Signed in, proposal author | `200`, proposal |
| `GET /admin/station-proposals` | Administrator | `200`, pending proposals |
| `POST /admin/station-proposals/:id/review` | Administrator. `{ decision: "approve" }` or `{ decision: "reject" }` | `200`, reviewed proposal |

A station input contains `name`, `address`, numeric `latitude` and `longitude`, and `chargers`. Each charger has a `label`, a `connectorTypes` array of catalog IDs, and optional `latitude` and `longitude` together.

The administrator creation route also accepts `source: { provider, externalId, sourceUrl }`. The provider uses 1–32 lowercase ASCII letters, digits, or underscores. The external ID is case-sensitive and has a limit of 300 characters. The source URL is an absolute HTTP(S) URL without credentials and has a limit of 2,048 characters. Repeating the same provider and external ID returns the existing station detail with `201`. When supplying a source, an administrator can send an `existingStationId` UUID v4 to attach a confirmed match. Linking and replaying preserve station and charger data. Invalid input returns `400`, missing or insufficient authentication returns `401` or `403` respectively, a missing target returns `404`, and a source already linked to a different explicit target returns `409`.

A station summary contains `id`, `name`, `address`, `latitude`, `longitude`, `latestReportAt`, `nextStatusChangeAt`, `statusAsOf`, and `counts`. The counts group each charger's current status as `available`, `occupied`, `out_of_service`, or `unreported`. Detail responses add `chargers` with their individual status, latest report timestamp, and `occupiedUntil`. Timestamps use ISO 8601. `statusAsOf` is the database time used to evaluate expiration in that response. Clients can anchor countdowns to it to account for device clock skew. Reports are community observations and retain their displayed age until superseded.

When `includeChargers=true`, the list includes the same charger records as station detail. A station can match the viewport through its own point or a geocoded charger's point. The limit still counts stations. Charger coordinates are nullable. The map uses those coordinates for individual pins and keeps a station marker for chargers without a mapped point.

`durationMinutes` is optional and accepts an integer from 1 to 720 only when `status` is `occupied`. Invalid combinations return `400`. A timed report returns its expected end as `occupiedUntil`, computed from the database report time and duration. When that deadline passes, reads derive `available` from the expired latest report and keep its original `reportedAt`. A newer manual report always takes precedence. Occupied reports without a duration remain occupied until superseded. Detail `occupiedUntil` is `null` when there is no active timer, and summary `nextStatusChangeAt` is the earliest active deadline or `null`. Detail charger `availableByTimer` is true when an expired estimate accounts for the available status.

Proposals return `id`, `status`, the proposed `station`, `stationId` if approved, `createdAt`, and `reviewedAt` when decided. An approved proposal creates a station and its chargers atomically. Duplicate review attempts return `409`. The API allows three proposals per account in 24 hours, 30 reports per account per hour, and one report per account per charger per minute.

To grant or revoke the administrator role for a verified account, run `npm run admin:role -- grant <email>` or `npm run admin:role -- revoke <email>` from `backend` after building and running the migrations against the intended database.

Station responses also include `access_type` (public, private, restricted, unknown) and `pricing_type` (free, paid, mixed, unknown). These fields are maintained in PostgreSQL. The initial San Luis Potosi access classifications are venue-based estimates.
