ALTER TABLE charging_stations
  ADD COLUMN access_type text NOT NULL DEFAULT 'unknown'
    CHECK (access_type IN ('public', 'private', 'restricted', 'unknown')),
  ADD COLUMN pricing_type text NOT NULL DEFAULT 'unknown'
    CHECK (pricing_type IN ('free', 'paid', 'mixed', 'unknown'));
