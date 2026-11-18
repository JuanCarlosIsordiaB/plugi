# Mobile authentication API

The base path is `/api/v1`. Requests with a body use JSON. Mobile clients send access and refresh tokens in the `Authorization: Bearer <token>` header on their respective routes. Treat both tokens as opaque and store persisted credentials using operating-system secure storage.

| Method and path | Authentication and input | Successful response |
| --- | --- | --- |
| `POST /auth/sign-up` | `{ name, email, password }` | `201` with `{ challengeId }` |
| `POST /auth/verify-email/:code` | Six-digit email code and `x-challenge-id` | `201` with `{ accessToken, refreshToken }` |
| `GET /auth/verify-email/challenge` | `x-challenge-id` | `200` with challenge metadata |
| `POST /auth/sign-in` | `{ email, password }` | `200` with a token pair or `{ requiresTwoFactor: true, challengeId }` |
| `POST /auth/2fa/sign-in/:code` | Authenticator code and `x-challenge-id` | `200` with a token pair |
| `GET /auth/2fa/challenge` | `x-challenge-id` | `200` with challenge metadata |
| `GET /auth/session` | Access token | `200` with `{ id, createdAt, lastUsedAt, user }` |
| `POST /auth/refresh` | Refresh token | `201` with a new token pair |
| `POST /auth/logout` | Access token | `201` after revoking the current session |
| `GET /account/profile` | Access token | `200` with the profile |
| `PUT /account/profile` | Access token and one or more of `name`, `lastName`, `avatar`, `country`, or `language` | `200` with the updated profile |
| `PUT /account/profile/password` | Access token and `{ currentPassword, newPassword }` | `200` after changing the password and revoking existing sessions |
| `POST /auth/forgot-password` | `{ email }` | `201` with `{ id, type: "password_reset" }` |
| `GET /auth/reset-password/challenge` | `x-challenge-id` | `200` with challenge metadata |
| `GET /auth/reset-password/verify/:token` | Hexadecimal email recovery token and `x-challenge-id` | `200` with `{ challengeId, type: "password_reset" }` |
| `POST /auth/reset-password/:token` | Email recovery token, `x-challenge-id`, and `{ password }` | `201` with the account ID as plain text after changing the password and revoking existing sessions |
| `GET /account/sessions` | Access token | `200` with the active sessions |
| `DELETE /account/sessions/:sessionId` | Access token | `200` with `{ count }` |
| `POST /account/sessions/delete-all` | Access token | `201` with `{ count }` |
| `POST /account/2fa/enable` | Access token | `201` with `{ secret, qrCode }`. The QR code is a data URL. |
| `POST /account/2fa/verify/:code` | Access token and authenticator code | `201` after confirming setup |
| `POST /account/2fa/disable/:code` | Access token and authenticator code | `201` after disabling TOTP |

The session user and profile contain `id`, `email`, `name`, `emailConfirm`, `twoFactorEnabled`, `createdAt`, `updatedAt`, and the nullable fields `lastName`, `avatar`, `country`, and `language`. Session lists return `id`, `userId`, `userAgent` (nullable), `createdAt`, and `lastUsedAt`. Timestamps in session and profile responses are ISO 8601 strings. Challenge metadata contains `id`, `type`, `issuedAt`, and `expiresAt`, with timestamps in epoch milliseconds.

Access tokens last up to 15 minutes, and sessions have a seven-day limit measured from sign-in. Use one refresh request at a time per session and save the new token pair before retrying pending requests. A used or revoked refresh token returns `401`. A password change or recovery requires the user to sign in again. Invalid input returns `400`, invalid or expired credentials return `401`, and a reached attempt limit returns `429`. Redact path parameters for verification, recovery, and TOTP routes in any proxy or access logging because these paths carry credentials.

For local setup, configure PostgreSQL, `AUTH_ENCRYPTION_KEY`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` in `backend/.env`. Generate a stable 32-byte encryption key in hexadecimal and keep it private. Run the backend build and then `npm run db:migrate` from `backend` before using the auth routes.

The current contract covers first-party email and password accounts. Google and Apple sign-in and in-app account deletion are tracked separately from this integration. Before releasing iOS registration, users must be able to initiate account deletion within the app. [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
