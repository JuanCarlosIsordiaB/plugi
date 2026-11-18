# buscaPila Backend

The NestJS API serves the public `GET /` health check and versioned email/password, session, recovery and authenticator endpoints under `/api/v1`. It listens on port `3000` by default. See the [authentication contract](../docs/api/auth.md).

## Local development

Start PostgreSQL and configure `backend/.env` using the [root setup instructions](../README.md#postgresql-local-development). The API reads `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Process environment values take precedence over the file.

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for a verified Resend sender. Set `AUTH_ENCRYPTION_KEY` to a stable, private 64-character hex key. This key protects authenticator secrets and email challenge codes. Existing authenticator enrollments depend on the key. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and store it with the backend secrets.

Run these commands from `backend/`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run start:dev
```

At startup the API checks the PostgreSQL connection with `SELECT 1` before accepting requests. It closes the connection pool on shutdown.

`db:migrate` applies the versioned authentication schema in a transaction and records its name in `buscapila_migrations`. Repeated runs skip applied SQL. Run it explicitly on the intended database before serving authentication requests.

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

The default test runs use a mocked pool and a public-route HTTP test. To exercise authentication over a real HTTP socket and PostgreSQL, point the PG settings at a **test database** whose role can create schemas, then run the following commands.

```powershell
$env:AUTH_TEST_POSTGRES = '1'
npm.cmd run test:e2e
Remove-Item Env:AUTH_TEST_POSTGRES
```

The suite creates a unique schema, provisions it from the migration, captures outgoing email in memory, and removes its own schema on completion. It covers concurrent refresh, password updates, recovery, expiry, access control, TOTP replay and rate limits. Production email delivery requires a configured Resend account.

The feature adapts the first-party flows from the Ivnoff authentication project. Its MIT notice is in [LICENSE-auth-reference](LICENSE-auth-reference).
