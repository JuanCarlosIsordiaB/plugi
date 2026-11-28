# Architecture

For the product goals, driver flows, and planned features, see [Product overview](PRODUCT.md).
For tables, keys, and relationships, see the [PostgreSQL database design](DATABASE.md).

## Repository structure

| Path | Responsibility |
| --- | --- |
| `frontend/src/app/` | Expo Router entry points |
| `frontend/src/charging/`, `frontend/src/contact/`, `frontend/src/proposals/` | Web screens and shared feature code |
| `frontend/public/styles/` | Shared web navigation, page layouts, and form styles in `charging.css`, with feature styles in `contact.css` and `proposals.css` |
| `frontend/public/fonts/` | Self-hosted Spectral and DM Sans web fonts and their SIL Open Font Licenses |
| `backend/src/auth/`, `backend/src/stations/`, `backend/src/vehicle-contact/` | NestJS feature modules |
| `backend/src/database/`, `backend/migrations/` | Database access and versioned schema |
| `backend/test/` | HTTP integration tests |
| `scripts/` | Station catalog collection, cleanup, and import commands |
| `.codex/agents/`, `AGENTS.md` | Agent roles and repository working agreements |
| `docs/` | Architecture, product overview, API contracts, and timeline |

## Current state

buscaPila has two independent TypeScript applications in one Git repository.
Expo web links the stylesheets in `frontend/public/styles/` from the server-rendered HTML so the browser can style the page before JavaScript starts. It uses Leaflet for the map and calls the NestJS API for account, station, and vehicle contact flows. The map stays mounted when the station drawer switches between results and charger details. The native target currently displays the buscaPila placeholder. The API root route is `GET /`.
PostgreSQL 18 is configured locally with Docker Compose and connected to NestJS through a node-postgres pool. Startup performs SELECT 1, and db:check verifies a real connection. The backend provides first-party authentication, community charging status, station proposal review, vehicle registration, authenticated exact-match vehicle lookup, and private charging messages. The mobile client integration and production deployment are pending.

Timed occupancy reports store their duration and report time in PostgreSQL. Station reads derive availability from the latest report and the database clock. Expo web displays the countdown and refreshes station results at the next expiration while retaining the map view.

The web explorer requests chargers with each station viewport and reads connector names from the public connector catalog. Search and the Filters panel update the list and map together. The panel groups availability, connector type and public access. Its trigger shows the number of active criteria, and resetting the panel preserves the search text. When a connector and availability are selected, the same charger must meet both conditions. Station details show the catalog's access and pricing categories.

At lower zoom levels, the web map groups nearby stations and labels each group with its charger total. At high zoom, the map places individual chargers with known coordinates. The station pin represents chargers with no mapped position. Pins show the reported status alongside any active occupancy countdown. Selecting a marker for one station opens a compact preview from the viewport data. A marker shared by multiple stations opens their list. The map identifies the selected group by its member pin IDs, so separate groups serving the same stations can be selected independently. The preview and list rows open the same station detail.

## System diagram

Solid arrows describe implemented relationships. Dashed arrows describe planned connections.

```mermaid
flowchart LR
    Scripts[Root npm scripts] --> Mobile[frontend: React Native + Expo]
    Scripts --> API[backend: NestJS]
    Mobile --> Router[Expo Router: src/app]
    Router --> Home[Native home placeholder]
    Router --> Web[Expo web: map, account, proposals and messages]
    Web --> Tiles[OpenStreetMap tiles]
    Location[Browser location permission] -->|User-requested position| Web
    API --> Module[AppModule]
    Module --> DatabaseModule[DatabaseModule]
    DatabaseModule --> Pool[DatabaseService: pg pool]
    Pool --> Postgres[(PostgreSQL 18)]
    Postgres --> Volume[Docker named volume]
    Module --> Controller[AppController: GET /]
    Controller --> Service[AppService: Hello World!]
    Module --> Auth[AuthModule]
    Auth --> Pool
    Auth --> Email[Resend verification and recovery email]
    Web --> Auth
    Mobile -. Planned native authentication .-> Auth
    Module --> Stations[StationsModule]
    StationImport[San Luis Potosí import CLI] -->|Administrator POST| Stations
    Module --> Contact[VehicleContactModule]
    Stations --> Pool
    Contact --> Pool
    Stations --> Auth
    Contact --> Auth
    Web --> Stations
    Web --> Contact
    Mobile -. Planned native map and proposals .-> Stations
    Mobile -. Planned vehicle and messaging requests .-> Contact
```

This shows logical ownership and calls. The existing API uses port 3000 by default. Local browser requests use an explicit loopback CORS origin, and access and refresh tokens live in browser memory for the life of the page. On request, the browser position centers the map and sorts stations by distance. API and tile requests use the viewed area.
A physical phone must use the PC's reachable network address rather than localhost. PostgreSQL is bound only to 127.0.0.1 (port 5433 on this workstation). The phone never receives database credentials or connects to PostgreSQL directly. Versioned migrations create the authentication, charging catalog, and vehicle contact schema. See the API contracts for [authentication](api/auth.md), [charging and station proposals](api/charging.md), and [vehicles and messages](api/vehicle-contact.md).

The web contact screen looks up a vehicle by VIN or Mexican plate through the authenticated API. For a unique plate registration, the API issues an expiring opaque token that binds the subsequent message to the requesting account and the same registration. The vehicle contact module uses the auth module's existing token encryption service for this binding.

The web registration form sends a Mexican plate and VIN. The API records the issuing region as unknown. Mexican plate registration, plate-only lookup, and token-based delivery for the same plate share a transaction lock.
The mobile app targets iOS and Android; an Android JavaScript export has passed, but this is not native/device verification.

The [station catalog import CLI](STATION_CATALOG_IMPORT.md) submits validated source listings through the administrator station route. PostgreSQL stores external listing identities in `station_sources` and links them to charging stations so retries can resolve to the original station.

## Agent workflow

| Role | Responsibility |
| --- | --- |
| Coordinator | Owns scope, integration, shared contracts, and project documentation. |
| `frontend` | Implements Expo screens, navigation, and client behavior. |
| `backend` | Implements NestJS endpoints, business rules, and persistence. |
| `reviewer` | Independently checks substantial changes for regressions, correctness, and security. |
| `model_router` | Recommends a model and reasoning effort for unclear or high-impact tasks. |
| `ios_policy` | Assesses current Apple requirements and release evidence. |

```mermaid
flowchart TD
    User[User task] --> Assess[Coordinator: assess scope and risk]
    Assess --> NeedRouter{Unclear or high impact?}
    NeedRouter -->|Yes| ModelRouter[model_router: recommend model and effort]
    ModelRouter --> SelectModel[Coordinator: select available task model]
    NeedRouter -->|No| SelectModel
    SelectModel --> PolicyNeeded{Apple-sensitive task?}
    PolicyNeeded -->|Yes| IOSPolicy[ios_policy: current rules and applicability]
    IOSPolicy --> Route{Coordinator: assign role}
    PolicyNeeded -->|No| Route
    Route -->|Mobile| Frontend[frontend agent]
    Route -->|API| Backend[backend agent]
    Route -->|Cross-app| Contract[Agree on API contract]
    Contract --> Frontend
    Contract --> Backend
    Route -->|Root config or small docs task| Direct[Coordinator implements]
    Route -->|Information only| Answer[Answer directly]
    Frontend --> Validate[Coordinator: integrate and validate]
    Backend --> Validate
    Direct --> Validate
    Validate --> Release{App Store release or resubmission?}
    Release -->|Yes| IOSRelease[ios_policy: final iOS evidence review]
    IOSRelease --> ReviewNeeded{Substantial functional change?}
    Release -->|No| ReviewNeeded
    ReviewNeeded -->|Yes| Reviewer[reviewer: independent review]
    Reviewer --> Resolve[Coordinator: resolve findings and verify]
    ReviewNeeded -->|No| Docs[Record meaningful timeline milestone and check architecture]
    Resolve --> Docs
    Docs --> Report[Report roles, checks, documentation, and limits]
```

The coordinator automatically routes implementation tasks without requiring the user to name agents.
The coordinator assigns non-overlapping files and waits for review before closing substantial functional work.
Timeline maintenance and architecture checks are part of task completion. Diagrams change only when relationships or workflows change.
The model routing policy is documented in MODEL_ROUTING.md. Role and model selection are independent; the main chat model is unchanged. Model recommendations must be applied through supported spawn overrides and availability must be checked. ios_policy advises before Apple-sensitive changes and checks available evidence before App Store submissions; it is not a runtime component or approval guarantee. This workflow operates during active Codex tasks; it is not a background watcher or an npm command hook.

## Change rules

- Update the diagram when real modules or connections change; use actual implementation names.
- Convert a dashed connection to solid only after implementation and a successful real request.
- Add data stores or external services only when configured and implemented, and label unverified behavior.
- Record meaningful milestones in TIMELINE.md using BACKEND, FRONTEND, or SHARED.
- Keep runtime architecture separate from the agent collaboration workflow.
