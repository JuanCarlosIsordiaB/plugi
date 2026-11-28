# PostgreSQL database design

The diagrams show the schema defined by the [versioned migrations](../backend/migrations/). They include the fields needed to understand relationships and recent features. The migrations define the complete columns, constraints, and indexes.

## Stations and charging

```mermaid
erDiagram
    charging_stations ||..o{ station_chargers : contains
    charging_stations ||..o{ station_sources : links
    station_chargers ||--o{ charger_connectors : supports
    connector_types ||--o{ charger_connectors : classifies
    station_chargers ||..o{ charger_reports : receives
    auth_users o|..o{ charger_reports : submits
    auth_users ||..o{ station_proposals : proposes
    auth_users o|..o{ station_proposals : reviews
    charging_stations o|..o{ station_proposals : "results from"

    charging_stations {
        uuid id PK
        text name
        text address
        double latitude
        double longitude
        text access_type
        text pricing_type
    }
    station_chargers {
        uuid id PK
        uuid station_id FK
        int position
        text label
        double latitude "optional"
        double longitude "optional"
    }
    connector_types {
        text id PK
        text label
    }
    charger_connectors {
        uuid charger_id PK, FK
        text connector_type PK, FK
    }
    charger_reports {
        bigint id PK
        uuid charger_id FK
        uuid reporter_id FK "nullable"
        text status
        timestamptz reported_at
        smallint duration_minutes "optional for occupied"
    }
    station_proposals {
        uuid id PK
        uuid author_id FK
        uuid reviewed_by FK "nullable"
        uuid station_id FK "nullable"
        jsonb station
        text status
    }
    station_sources {
        text provider PK
        text external_id PK
        uuid station_id FK
        text source_url
    }
    auth_users {
        uuid id PK
    }
```

`charger_availability` is a view over chargers and their latest reports. A timed occupied report becomes available in the view once its deadline passes. The original report remains in `charger_reports`. Station availability totals are computed from the view.

## Accounts, vehicles, and messages

```mermaid
erDiagram
    auth_users ||..o{ auth_sessions : owns
    auth_users o|..o{ auth_challenges : uses
    auth_users ||..o{ contact_vehicles : registers
    auth_users ||..o{ contact_conversations : initiates
    auth_users ||..o{ contact_conversations : receives
    contact_conversations ||..o{ contact_messages : contains
    contact_messages ||..o{ contact_reports : receives
    auth_users ||..o{ contact_reports : submits
    auth_users ||--o{ contact_blocks : blocks
    auth_users ||--o{ contact_blocks : "is blocked"
    auth_users ||--o| contact_suspensions : "may have"

    auth_users {
        uuid id PK
        text email UK
        text password_hash
        boolean is_admin
    }
    auth_sessions {
        uuid id PK
        uuid user_id FK
        timestamptz expires_at
    }
    auth_challenges {
        uuid id PK
        uuid user_id FK "nullable"
        text kind
        timestamptz expires_at
    }
    contact_vehicles {
        uuid id PK
        uuid owner_id FK
        text vin UK
        text plate
        text plate_country
        text plate_region
    }
    contact_conversations {
        uuid id PK
        uuid initiator FK
        uuid recipient FK
        boolean answered
    }
    contact_messages {
        uuid id PK
        uuid conversation_id FK
        boolean from_initiator
        text body
        timestamptz created_at
    }
    contact_reports {
        uuid id PK
        uuid message_id FK
        uuid reporter FK
        text reason
        text resolution
    }
    contact_blocks {
        uuid blocker PK, FK
        uuid blocked PK, FK
    }
    contact_suspensions {
        uuid user_id PK, FK
    }
```

Vehicle plate uniqueness uses the combination of `plate_country`, `plate_region`, and `plate`. A vehicle helps resolve the recipient at the start of contact. Conversations link the two accounts directly.

`auth_rate_limits` tracks request budgets by bucket. The migration runner records applied migrations in `buscapila_migrations`. These tables have no foreign keys to the product tables.
