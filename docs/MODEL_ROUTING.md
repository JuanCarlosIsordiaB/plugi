# Model routing policy

## Purpose

Use task-appropriate capability without running the most demanding model for every task.
The user has authorized automatic task-based model selection for delegated agents.
This policy applies to development agents, not the AI model used inside the product.

## Routing matrix

| Tier | Model | Reasoning | Typical tasks |
| --- | --- | --- | --- |
| ROUTINE | gpt-6.2-sol | low | Read-only GitHub lookups, git status/diff, known safe commands, small documentation edits, simple renames with clear scope. |
| STANDARD | gpt-6.2-sol | medium | Ordinary screens, straightforward endpoints, scoped tests, routine bug fixes with clear requirements. |
| CRITICAL | gpt-6.2-astra | high | Authentication/authorization, payments, data migrations, architecture decisions, complex integration, hard-to-reproduce bugs, concurrency, sensitive security fixes, major dependency changes, production-impacting operations, material App Store policy/privacy/login/payment and submission-readiness decisions. |

These are project defaults, not claims about pricing. Use only model IDs exposed by the active client/session.
Review uses STANDARD by default and CRITICAL for security-sensitive, complex, or high-impact changes.
The model_router itself uses gpt-6.2-sol with low reasoning and only classifies tasks.

## Execution

1. The coordinator classifies each task automatically using the matrix. For unclear, mixed-scope, or high-impact work, consult model_router before spawning implementation agents.
2. Deterministic routine work does not need an extra classifier agent; avoid paying classification overhead for every shell command.
3. Choose the role by ownership (frontend/backend/reviewer/ios_policy/coordinator) and the model by complexity and impact. An agent's role does not permanently fix its model.
4. Apply explicit model and reasoning overrides when spawning frontend, backend, reviewer, or ios_policy. Keep their TOML files free of fixed model settings so they do not override the selection. For critical work owned by the coordinator, delegate the substantive planning, risk analysis, and independent review to a CRITICAL-tier subagent with an explicit brief; the main agent retains orchestration and any authorized tool execution on its unchanged model.
5. Where the client does not expose named roles, pass their instructions to a generic subagent with the selected model and reasoning overrides.
6. Model-changing spawn APIs may require a fresh context rather than a full-history fork. Supply a self-contained brief with repository path, requirements, owned files, API contract, checks, and links to project guidance.
7. Reassess before high-impact steps, after a failed substantive repair, or when new evidence expands the scope. Escalate to CRITICAL for unresolved reasoning or security uncertainty rather than repeatedly retrying the cheaper model. Infrastructure/access failures need diagnosis, not automatic model escalation.
8. If a selected model is unavailable, report the limitation. For CRITICAL work use an available equally capable alternative or pause dependent work for user input; never silently downgrade critical work. Routine work may use the inherited available model, with the fallback disclosed.
9. Include actual delegated model/effort and fallback decisions in the completion summary. Recommendations alone are not evidence that a switch occurred.

The main chat retains its selected model. A task policy cannot automatically change the main chat's model picker.
The coordinator still consumes its own model while planning, using tools, and integrating results.
Model selection does not bypass permissions, authorize publishing, or change approval requirements.
A release or destructive Git operation is assessed by its impact even if its command is short.

## Documentation

Record meaningful routing-policy changes in TIMELINE.md and update the agent workflow diagram.
Do not create a timeline entry for each command or each classification.
