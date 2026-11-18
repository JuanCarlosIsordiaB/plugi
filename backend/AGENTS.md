# buscaPila backend

## Ownership and architecture

Follow root AGENTS.md. Write in backend/; read frontend/ for contract verification and coordinate writes elsewhere.
Use English for all project artifacts. Organize features by domain with modules, controllers, services, schemas/DTOs,
and relevant tests. Keep controllers HTTP-focused and use constructor dependency injection.
Avoid circular dependencies and speculative abstractions. PostgreSQL connections go through
`DatabaseService`. Use SQL parameters for user-supplied values. Authentication is not configured yet.

## Versions and documentation

Read package.json before using APIs. Find current official documentation through https://docs.nestjs.com/llms.txt.
This project uses ESM (relative imports end in .js) and Vitest (vi.fn(), not jest.fn()).
Use nestjs-best-practices when available. Check official integrations before choosing alternatives;
only add infrastructure needed by the requirement.

## API and security

Agree on method, route, inputs, responses, errors, and authentication before integration.
Validate HTTP inputs using a mechanism compatible with the installed version and project conventions.
Use NestJS HTTP exceptions without exposing secrets or internal details.
When adding authentication, enforce authorization server-side and test denied access.
Load configuration from environment, validate required values, and keep secrets out of code and logs.
Configure CORS for web consumers when needed; CORS is not authentication or authorization.
Telemetry and Mau deployment are not configured. Do not assume they exist or enable them without a requirement.

## Commands from backend/

- npm.cmd run start:dev: watch server.
- npm.cmd run build: compile.
- npm.cmd run typecheck: TypeScript validation.
- npm.cmd run lint: static checks.
- npm.cmd test: unit tests.
- npm.cmd run test:e2e: HTTP tests.

After code changes run build, typecheck, lint, and affected tests. Add meaningful behavior tests for new rules,
errors, and permissions. See root README for dependency audit context; do not downgrade major versions blindly.
Return proposed BACKEND timeline and architecture updates to the coordinator.

## Code Review Rules

Check validation, authorization, sensitive data exposure, contracts, HTTP responses, and observable errors.
A DTO alone does not establish route security. Do not assume integrations exist without implementation evidence.
