# buscaPila working agreements

## Project and language

- One Git repository, two independent npm projects: frontend/ (React Native + Expo) and backend/ (NestJS).
- Also read the AGENTS.md in each affected directory. User instructions take precedence.
- Reference runtime: Node 24.22.3 LTS. Each app owns its manifest, lockfile, and node_modules.
- All project artifacts must be in English: code, variables, identifiers, filenames, comments, documentation, commit messages, and new UI text. Preserve the buscaPila brand. Add localization only when requested.
- User-facing chat may follow the user's language. Report verified results separately from pending work.

## Roles and coordination

Custom definitions live in .codex/agents/frontend.toml, backend.toml, reviewer.toml, model_router.toml, and ios_policy.toml.
The main agent coordinates requirements, contracts, root files, shared documentation, and integration.

- Automatically classify each implementation task and delegate mobile work to frontend and API work to backend; no separate user request to invoke agents is needed.
- For changes involving both apps, use both specialists with explicit ownership and coordinate their shared contract first.
- Answer informational questions directly. The coordinator may handle root-only configuration and small documentation changes directly; do not spawn unrelated roles for those tasks.
- For cross-app features, agree on the contract first, then parallelize only independent work.
- Assign requirements, owned files, contract, and expected validation explicitly.
- Never have agents write the same file concurrently. The coordinator owns root files and shared docs unless reassigned.
- Automatically consult ios_policy before Apple-sensitive design changes (login, account lifecycle, data/SDKs, tracking, permissions, purchases, UGC, distribution) and before App Store release/resubmission; see docs/IOS_REVIEW.md. Backend-only changes can also trigger this review.
- Obtain policy guidance before implementation and recheck changed evidence before release. ios_policy advises; frontend/backend implement and reviewer checks correctness independently.
- Request an independent reviewer pass after substantial functional changes; wait for the findings before closing.
- Delegation is part of an active development task, not a background process or an npm hook. Do not ask for confirmation just to select or invoke a role.
- If named custom roles are unavailable, pass the appropriate TOML instructions explicitly to an available agent.
- Role boundaries are working agreements, not separate sandboxes. Session permissions still apply.

## Automatic model selection

Follow docs/MODEL_ROUTING.md for every delegated task. The user authorizes task-based model overrides.
Use gpt-6.2-sol with low reasoning for routine tasks, gpt-6.2-sol with medium reasoning for standard development,
and gpt-6.2-astra with high reasoning for critical or complex work, subject to actual client availability.
Consult model_router for unclear, mixed-scope, or high-impact tasks; classify obvious small tasks directly.
Apply explicit spawn-time overrides and keep frontend/backend/reviewer/ios_policy definitions model-neutral. Use CRITICAL routing for material ios_policy audits and verify current official Apple sources rather than assuming universal requirements.
Classify by risk and uncertainty, not tool names. GitHub commands can have major production or data-loss impact.
Escalate when scope or risk increases. Never silently downgrade critical tasks when a model is unavailable.
Report actual models used and fallbacks; a recommendation is not proof of execution on that model.
This policy cannot switch the main chat model or remove the coordinator's own model usage.
Do not recursively spawn model_router to classify model_router itself.

## Contracts and implementation

Before changing an integration define method, route, input, response, status codes, and authentication.
Check existing consumers before changing a contract. Capture agreements in task context; persist durable contracts
under docs/api/ when needed. Do not create empty documents or invent endpoints.
Label mocks and planned connections. Do not declare integration complete without a real request.
On physical phones localhost is the phone; configure the API URL for the environment.
Preserve existing code conventions and strict TypeScript. Avoid unjustified any and premature abstractions.
Preserve other people's changes. Commit, push, or deploy only when requested.
Never store secrets in Git, logs, or EXPO_PUBLIC_*. Enforce business rules and authorization server-side.
Install dependencies in their owning app and use Expo to resolve SDK-compatible mobile libraries.
Do not use npm audit fix --force or suppress alerts to obtain green output; assess compatibility and actual risk.

## Timeline and architecture

- docs/TIMELINE.md is the chronological project record; use BACKEND, FRONTEND, or SHARED tags.
- Maintain the timeline automatically as part of each meaningful implementation, configuration, or workflow change; do not wait for the user to ask.
- Before closing a change, the coordinator records the date, tag, status, outcome, actual validation, and remaining work. Group related edits from the same task into one milestone; do not log every command or chat message.
- Record completed facts as DONE; use PLANNED or IN PROGRESS for unfinished work. Never fabricate dates, checks, or deadlines.
- Agents return proposed documentation updates; the coordinator merges them to avoid conflicting writes.
- Before closing each change, compare the final implementation and workflow against docs/ARCHITECTURE.md. Automatically update affected diagrams and descriptions when modules, services, dependencies, connections, or agent routing change.
- If architecture is unchanged, keep the diagram intact and state that briefly in the completion report rather than introducing artificial diagram edits.
- Completion requires relevant validation, resolution of actionable review findings, and the timeline/architecture check. Report roles used, checks performed, documentation updates, and remaining limitations.
- Mermaid solid arrows represent implemented relationships; dashed arrows represent planned connections.
- Do not draw databases, authentication providers, or other infrastructure as implemented until they exist.

## Validation

From root: npm.cmd run typecheck and npm.cmd run lint.
Backend: npm.cmd run build:backend, npm.cmd run test:backend, and npm.cmd run test:e2e as relevant.
Frontend: validate bundling or devices when dependencies, configuration, navigation, or native behavior change.
Do not add tests that merely repeat implementation or rerun expensive application checks for text-only changes.
Report changes, checks, and limits. A JavaScript export is neither a native build nor a device test.

## Code Review Rules

Prioritize evidenced correctness, security, and regression issues, API contracts, and error states.
Include file, line, scenario, and impact per finding. Avoid purely cosmetic findings.
Check that timeline and architecture statements match the implementation and verification evidence.
