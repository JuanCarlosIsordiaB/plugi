# Charging map and station proposals

The routes below use the `/api/v1` prefix. Write requests and proposal reads require an access token in `Authorization: Bearer <token>`. Administrator routes additionally require the database administrator role.

| Method and path | Access and input | Successful response |
| --- | --- | --- |
| `GET /connector-types` | Public | `200`, array of `{ id, label }` |
| `GET /stations` | Public. Optional viewport `south`, `west`, `north`, `east` and optional `limit` from 1 to 200 | `200`, array of station summaries |
| `GET /stations/:id` | Public | `200`, station summary with individual chargers |
| `POST /stations` | Administrator. Station input below | `201`, station detail |
| `POST /stations/:id/chargers/:chargerId/reports` | Signed in. `{ status }` | `201` with `{ id, chargerId, status, reportedAt }` |
| `POST /station-proposals` | Signed in. Station input below | `201`, proposal |
| `GET /station-proposals` | Signed in | `200`, proposals belonging to the signed-in user |
| `GET /station-proposals/:id` | Signed in, proposal author | `200`, proposal |
| `GET /admin/station-proposals` | Administrator | `200`, pending proposals |
| `POST /admin/station-proposals/:id/review` | Administrator. `{ decision: "approve" }` or `{ decision: "reject" }` | `200`, reviewed proposal |

A station input contains `name`, `address`, numeric `latitude` and `longitude`, and `chargers`. Each charger has a `label`, a `connectorTypes` array of catalog IDs, and optional `latitude` and `longitude` together.

A station summary contains `id`, `name`, `address`, `latitude`, `longitude`, `latestReportAt`, and `counts`. The counts group each charger's latest status as `available`, `occupied`, `out_of_service`, or `unreported`. Detail responses add `chargers` with their individual status and latest report timestamp. Timestamps are ISO 8601 and are `null` until a report exists. Mobile clients can compute elapsed time from the timestamp. Reports are community observations and retain their displayed age until superseded.

Proposals return `id`, `status`, the proposed `station`, `stationId` if approved, `createdAt`, and `reviewedAt` when decided. An approved proposal creates a station and its chargers atomically. Duplicate review attempts return `409`. The API allows three proposals per account in 24 hours, 30 reports per account per hour, and one report per account per charger per minute.

To grant or revoke the administrator role for a verified account, run `npm run admin:role -- grant <email>` or `npm run admin:role -- revoke <email>` from `backend` after building and running the migrations against the intended database.
