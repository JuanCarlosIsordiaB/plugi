# Project timeline

Tags: `BACKEND`, `FRONTEND`, `SHARED`. Dates use America/Mexico_City.

| Date | Tag | Status | Milestone | Evidence / remaining work |
| --- | --- | --- | --- | --- |
| 2026-11-17 | BACKEND | DONE | Add local PostgreSQL foundation | PostgreSQL 18 healthy on localhost:5433; NestJS pg pool, explicit environment validation, bounded startup probe, and shutdown cleanup configured. Build, typecheck, lint, 18 unit tests, one isolated HTTP test, real db:check, and live HTTP 200 passed. Independent review findings resolved. No product tables or mobile-to-API integration yet. |
| 2026-11-17 | SHARED | DONE | Configure iOS and App Store policy specialist | Added read-only ios_policy role, automatic design/release triggers, current-official-source and applicability rules, and CRITICAL model routing. Updated workflow diagram and documentation; no Apple login implementation or App Store compliance certification. |
| 2026-11-17 | SHARED | DONE | Clean source before GitHub publication | Replaced Expo demo flows with minimal Home; removed unused demo code/assets and three unused direct packages; replaced starter READMEs, removed unused Claude settings, and tightened Git ignore rules. TypeScript/lint, backend build, 18 unit tests, one HTTP test, real PostgreSQL check, and Android/web JS exports passed. Independent review completed; credentials and generated output excluded. Remote upload awaits an accessible destination repository. |
