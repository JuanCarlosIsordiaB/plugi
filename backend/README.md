# buscaPila Backend

The NestJS API serves the public `GET /` health check and versioned routes under `/api/v1`. It listens on port `3000` by default. See the API contracts for [authentication](../docs/api/auth.md), [charging and station proposals](../docs/api/charging.md), and [vehicles and messages](../docs/api/vehicle-contact.md).

## Local development

Start PostgreSQL and configure `backend/.env` using the [root setup instructions](../README.md#postgresql-local-development). The API reads `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Process environment values take precedence over the file.

For Expo web development, set `WEB_ORIGIN=http://localhost:8081` in `backend/.env` and restart the API. Match the exact browser origin, including the port, using HTTP with `localhost`, `127.0.0.1`, or `[::1]`. Omit a trailing slash. CORS is disabled when the value is unset or `NODE_ENV=production`. The configured origin can use GET, POST, DELETE and OPTIONS with the `Authorization`, `Content-Type` and `x-challenge-id` headers. Browser credentials are disabled.

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for a verified Resend sender. Set `AUTH_ENCRYPTION_KEY` to a stable, private 64-character hex key. This key protects authenticator secrets and email challenge codes. Existing authenticator enrollments depend on the key. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and store it with the backend secrets.

Run these commands from `backend/`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run start:dev
```

At startup the API checks the PostgreSQL connection with `SELECT 1` before accepting requests. It closes the connection pool on shutdown.

`db:migrate` applies versioned SQL migrations in order and records their names in `buscapila_migrations`. Repeated runs skip applied files. Run it explicitly on the intended database before serving API requests.

Create and verify an account before granting the administrator role. The CLI changes only the specified account on the configured database.

```powershell
npm.cmd run admin:role -- grant admin@example.com
npm.cmd run admin:role -- revoke admin@example.com
```

Production clients should connect over HTTPS. Request paths for verification and recovery contain short-lived credentials. Configure gateway access logs to redact those paths, authorization headers and challenge headers. The default Express configuration uses the connection address for per-IP limits. When deploying behind a proxy, configure trust for the specific ingress topology so the API can identify individual clients.

## Build and check PostgreSQL

```powershell
npm.cmd run build
npm.cmd run db:check
```

`db:check` verifies the configured database connection without starting the HTTP server. Use `npm.cmd run start:prod` to run the compiled API.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
```

The default test runs use a mocked pool and a public-route HTTP test. To exercise authentication and the charging MVP over real HTTP sockets and PostgreSQL, point the PG settings at a **test database** whose role can create schemas, then run the following commands.

```powershell
$env:AUTH_TEST_POSTGRES = '1'
npm.cmd run test:e2e
Remove-Item Env:AUTH_TEST_POSTGRES
```

The suite creates a unique schema, provisions it from the migration, captures outgoing email in memory, and removes its own schema on completion. It covers concurrent refresh, password updates, recovery, expiry, access control, TOTP replay and rate limits. Production email delivery requires a configured Resend account.

The feature adapts the first-party flows from the Ivnoff authentication project. Its MIT notice is in [LICENSE-auth-reference](LICENSE-auth-reference).
