# Vehicles and charging messages

The routes below use the `/api/v1` prefix and require an access token in `Authorization: Bearer <token>`. The admin routes additionally require the database administrator role.

| Method and path | Input | Successful response |
| --- | --- | --- |
| `GET /vehicles` | None | `200` with `{ vehicles }` containing only the caller's vehicles |
| `POST /vehicles` | `{ vin, plate, plateCountry, plateRegion }` | `201` with the registered vehicle |
| `DELETE /vehicles/:id` | None | `204` |
| `POST /vehicle-contact/lookup` | `{ vin }` or `{ plate, plateCountry, plateRegion }` | `200` with `{ registered: boolean }` |
| `POST /vehicle-contact` | `{ vin, message? }` or `{ plate, plateCountry, plateRegion, message? }` | `202` with `{ accepted: true }` |
| `GET /vehicle-contact/conversations` | Optional `before` UUID | `200` with `{ conversations }`, newest first and up to 50 |
| `GET /vehicle-contact/conversations/:id` | Optional `before` message UUID | `200` with `{ id, messages }`, up to 100 messages in chronological order |
| `POST /vehicle-contact/conversations/:id/replies` | `{ message }` | `201` with the message |
| `POST /vehicle-contact/conversations/:id/block` | None | `204` |
| `POST /vehicle-contact/messages/:id/report` | `{ reason: "abuse" \| "spam" \| "other" }` | `204` |
| `GET /admin/vehicle-contact/reports` | None | `200` with `{ reports }` |
| `POST /admin/vehicle-contact/reports/:id/resolve` | `{ action: "dismiss" \| "hide" \| "suspend" }` | `204` |

Each vehicle includes its UUID `id`, `vin`, `plate`, `plateCountry`, and `plateRegion`. The country and plate-issuing region distinguish vehicles with the same plate text. Vehicle ownership is self-declared. Registration returns a generic `409` on an identifier conflict. A verified claim and a dispute process are pending for public use.

The lookup accepts an exact identifier. The planned mobile client can send identifiers entered manually or read by its camera. The response contains only whether the vehicle has a registration eligible for contact. Lookup responses use `Cache-Control: no-store`. A record opted out through the original API remains excluded until its owner deletes it and registers the vehicle again.

The initial message can be omitted to use the charging-time prompt. Custom messages and replies are plain text and limited to 500 characters. Sending a request needs no active charging session. The accepted response is identical whether a matching vehicle received the request or not. The sender can see the conversation after a reply. The other party's profile, identifiers, and vehicle data are private. A conversation summary has `id` and `updatedAt`. A message has `id`, `body`, `mine`, and `createdAt`.

Blocking prevents future messages from the blocked account. Reports go to the administrator queue. Lookup allows up to 10 attempts per account and 40 per source IP per hour. The API also allows up to 10 registration attempts, 10 initial contact attempts, and 60 replies per hour per account. The contact route suppresses repeat pending requests from the same sender to the same recipient for 24 hours and limits a recipient to 10 new requests per hour.

Clients can poll the conversation routes for messages. To fetch older pages, pass the last conversation's ID or the oldest returned message's ID as `before`.
