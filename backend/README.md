# buscaPila Backend

The NestJS API currently serves `GET /` with HTTP 200 and the response body `Hello World!`. It listens on port `3000` by default. Set `PORT` to use a different port.

## Local development

Start PostgreSQL and configure `backend/.env` using the [root setup instructions](../README.md#postgresql-local-development). The API reads `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Process environment values take precedence over the file.

Run these commands from `backend/`.

```powershell
npm.cmd ci
npm.cmd run start:dev
```

At startup the API checks the PostgreSQL connection with `SELECT 1` before accepting requests. It closes the connection pool on shutdown.

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

The unit tests mock the PostgreSQL pool, and the HTTP tests replace the database provider. Both suites can run without a PostgreSQL server.
