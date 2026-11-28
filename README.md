# buscaPila

Expo app and NestJS API in one Git repository. The browser MVP includes a charging map, community reports and proposals, and private vehicle contact. The native target is a placeholder.

Repository: [JuanCarlosIsordiaB/plugi](https://github.com/JuanCarlosIsordiaB/plugi), branch `main`. The repository is public; local environment files and generated output are excluded from version control.

```text
buscaPila/
|-- .codex/agents/       # Specialized agent definitions
|-- frontend/           # Mobile app, independent npm project
|-- backend/            # API, independent npm project
|-- docs/
|   |-- TIMELINE.md      # Dated milestones tagged by application
|   |-- ARCHITECTURE.md  # Repository, runtime, and agent workflow
|   `-- PRODUCT.md       # Product goals and driver experience
|-- AGENTS.md           # Shared working agreements
`-- package.json        # Forwarding scripts
```

Each application owns its package.json, package-lock.json, and node_modules.
There are no npm workspaces or shared runtime dependencies.
All project code, identifiers, comments, documentation, and new UI text use English unless a localization requirement says otherwise.

## Project progress and architecture

- [Timeline](docs/TIMELINE.md): completed milestones and planned work tagged BACKEND, FRONTEND, or SHARED.
- [Architecture](docs/ARCHITECTURE.md): repository structure, runtime modules, and agent workflow.
- [Product overview](docs/PRODUCT.md): the idea behind buscaPila, driver flows, and planned features.
- [Database design](docs/DATABASE.md): PostgreSQL entity-relationship diagrams.

View these documents using a Mermaid-capable Markdown preview, such as GitHub's rendered file view.
Solid system arrows represent implemented relationships; dashed arrows are planned.
See the [frontend setup](frontend/README.md), [backend setup](backend/README.md), and [API contracts](docs/api).

## Requirements

Node 24.22.3 LTS (pinned in .nvmrc and .node-version), npm, Docker Desktop for PostgreSQL, and Expo Go for initial device testing.
Windows development uses PowerShell; npm.cmd avoids PowerShell script execution-policy issues.

## Install after cloning

From the repository root:

```powershell
npm.cmd run setup
```

## PostgreSQL local development

The NestJS backend uses a node-postgres connection pool. PostgreSQL 18 runs locally through Docker Compose.
Start Docker Desktop first. The API uses versioned SQL migrations for authentication, charging stations, and vehicle contact. Database credentials belong to the backend environment.

This workstation has an ignored backend/.env with generated local credentials. For a new checkout,
copy backend/.env.example to backend/.env and set PGPASSWORD to a strong random 48-character hexadecimal password. Use only hexadecimal characters in this shared local file: Docker expands dollar signs and Node interprets hash characters differently in unquoted values, so a general special-character password may be parsed inconsistently.
The backend reads PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD. Compose uses the same port and initialization credentials; PGHOST applies only to the backend.
Environment variables take precedence; avoid unrelated PG* values in the shell.

```powershell
# From the project root, after configuring backend/.env
npm.cmd run db:up
npm.cmd run build:backend
npm.cmd --prefix backend run db:migrate
npm.cmd run db:check
```

Use npm.cmd run db:status to inspect the service and npm.cmd run db:stop to stop it without deleting data.
Data lives in the project's postgres_data named volume. Do not use docker compose down -v unless you intend
to permanently delete the local database. Changing initialization credentials in .env does not change
credentials in an already initialized PostgreSQL volume.

This workstation uses PGPORT=5433 because another service already occupies 5432. The example uses 5432 for fresh setups. The host port is bound to 127.0.0.1 only. If 5432 is occupied, choose another PGPORT before starting the service.
This is a local-development setup, not a production deployment: the initialization account is privileged.
Production needs a least-privilege application role, managed secrets, network/TLS configuration, backups,
and a deliberate migration workflow before deployment. Never disable certificate verification to connect remotely.

Backend startup checks database connectivity and fails if configuration or the connection is invalid.
The public GET / endpoint is a simple health response. The [backend guide](backend/README.md#validation) describes the opt-in HTTP suite with isolated PostgreSQL schemas.

## Development

Set `WEB_ORIGIN=http://localhost:8081` and the authentication settings in `backend/.env` as described in the [backend guide](backend/README.md). Open two terminals in the repository root.

```powershell
# Terminal 1
npm.cmd --prefix frontend run web -- --port 8081
```

```powershell
# Terminal 2: API with watch mode
npm.cmd run dev:backend
```

Open `http://localhost:8081`. The browser uses `http://localhost:3000/api/v1` by default. The local CORS setting accepts the configured loopback origin.

A fresh database contains connector types and starts with an empty station catalog. Create and verify a local account using the [authentication API](docs/api/auth.md), grant its administrator role with `npm.cmd --prefix backend run admin:role -- grant <email>`, and create a station using the [charging API](docs/api/charging.md). The new station appears in the map when its coordinates are within view. Registration and verification depend on a working Resend sender.

## Root commands

| Command | Purpose |
| --- | --- |
| npm.cmd start | Start Expo |
| npm.cmd run android | Open Expo on Android |
| npm.cmd run web | Start the web target |
| npm.cmd run build:backend | Compile NestJS |
| npm.cmd run typecheck | Check TypeScript in both apps |
| npm.cmd run lint | Run static checks in both apps |
| npm.cmd run test:backend | Run backend unit tests |
| npm.cmd run test:e2e | Run backend HTTP tests |
| npm.cmd run audit:frontend | Audit mobile dependencies |
| npm.cmd run audit:backend | Audit backend dependencies |

## Code organization

Frontend navigation lives in `frontend/src/app/`. Web features are organized under `charging/`, `contact/`, and `proposals/` within `frontend/src/`. Application icons and splash images live in `frontend/assets/`, and web fonts and icons live in `frontend/public/`.

Backend startup is src/main.ts; src/app.module.ts is the root module. The starter controller/service
handle GET /. HTTP tests live in test/. Add future backend features by domain, for example src/users/,
with their module, controller, service, schemas/DTOs, and tests. Avoid empty folders and speculative layers.

Install packages in their owning application. Use npx.cmd expo install package-name inside frontend/
for SDK-compatible mobile dependencies, and npm.cmd install package-name inside backend/ for API dependencies.
Keep secrets outside version control.

## Development agents

Project-scoped roles live in .codex/agents/:

- frontend: mobile implementation within frontend/.
- backend: API implementation within backend/.
- reviewer: independent review for correctness, security, regressions, and integration; does not edit files.
- model_router: classifies uncertain or high-impact tasks and recommends a model/effort; does not implement changes.
- ios_policy: checks current Apple requirements and scoped rejection risks before sensitive changes and App Store release; advisory, does not edit or submit apps.

Permissions are inherited from the session. The coordinator selects a task-specific model using the model routing policy; frontend, backend, reviewer, and ios_policy remain model-neutral. AGENTS.md files provide shared and directory-specific guidance.
The coordinator agrees on contracts, assigns non-overlapping files, integrates results, and maintains shared docs.
The reviewer's no-edit rule is an instruction, not a separate filesystem sandbox.

Open buscaPila as the Codex project and start a new chat so the client can discover the new files.
Implementation tasks are routed automatically by the coordinator: mobile work to frontend, API work to backend, and cross-app work to both. Substantial functional changes receive an independent reviewer pass. No separate request to invoke a role is needed. Saving definitions alone does not launch background processes. If named custom roles are unavailable,
the coordinator can provide the TOML instructions explicitly to an available agent.

Example requests:

- "Use frontend to implement the profile screen, then ask reviewer to review it."
- "Use backend to implement the agreed endpoint, then ask reviewer to check permissions and errors."
- "Coordinate frontend and backend: agree on the contract first, assign separate files, and review the result."

Informational questions, root-only configuration, and small documentation tasks can be handled directly without launching unrelated agents.
Agents propose timeline and architecture changes, and the coordinator merges them automatically before completing meaningful changes. The timeline records milestones rather than individual commands. Architecture is checked on each change and its diagrams are updated when relationships or workflows change.

## iOS and App Store guidance

The coordinator automatically consults ios_policy for login/account lifecycle, privacy/data/SDKs, tracking,
permissions, purchases/subscriptions, user-generated content, distribution, and release/rejection work.
See [iOS review workflow](docs/IOS_REVIEW.md) for sources, applicability checks, and the evidence format.
Material audits use Astra/high under the routing policy. The agent identifies required vs recommended work,
and returns frontend/backend actions; it does not add Apple login everywhere or guarantee approval.
Ordinary cosmetic changes do not need a separate policy audit.

## Automatic model selection

See [Model routing](docs/MODEL_ROUTING.md) for the policy and fallback behavior.

| Work | Model | Reasoning |
| --- | --- | --- |
| Routine commands, read-only GitHub work, small text edits | gpt-6.2-sol | low |
| Standard development | gpt-6.2-sol | medium |
| Critical, sensitive, or complex tasks | gpt-6.2-astra | high |

The coordinator classifies obvious tasks directly and consults model_router for uncertain or high-impact work.
GitHub releases, destructive commands, and migrations are classified by risk, not command length.
Selections apply to delegated agents when the active client supports the requested model; they do not switch the
main chat's model. Actual model choices and fallback limitations are reported rather than assumed.

## Dependency review: November 17, 2026

Historical snapshot before the frontend demo cleanup; these are not a fresh audit of the cleaned dependency tree.

- Frontend: 43 initial alerts -> 41 remaining high alerts, all propagated from picomatch.
- Backend: 16 initial alerts -> 11 remaining high alerts, all propagated from picomatch.
- Backend production dependency audit (npm audit --omit=dev): 0 alerts.

Removed unused @nestjs/mau and its deploy script, eliminating its undici and tmp dependency chains without changing the API.
The frontend has a scoped override for @expo/fingerprint to use minimatch 11.0.9 instead of vulnerable 10.x.
This is a major transitive substitution, verified with TypeScript, lint, fingerprint generation, and Android JS export.
Reassess and remove the override when Expo updates its original dependency.
Reference: https://github.com/advisories/GHSA-g3hv-75wg-m249

The latest picomatch version checked was 4.0.7, without a published fix for malicious repeated-extglob patterns.
Alerts on Expo, Metro, Nest CLI, and Vitest propagate from that dependency; they are not separate demonstrated flaws
in each framework. No forced major downgrades were applied. Do not process untrusted glob patterns with affected tools.
Reference: https://github.com/advisories/GHSA-fc5q-39xc-vjpf

Repeat audits with the root audit commands, or npm.cmd --prefix backend audit --omit=dev.
An audit with findings returns a nonzero exit code; findings change as advisories are published.
Node 24.22.3 has been installed and verified: typecheck/lint in both apps, backend build/unit/HTTP tests,
a live HTTP 200 response, Expo dependency compatibility/fingerprint, and Android JS export passed.
These checks do not establish native builds or physical-device behavior.
