CREATE TABLE station_sources (
  station_id uuid NOT NULL REFERENCES charging_stations ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_]{1,32}$'),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 300),
  source_url text NOT NULL CHECK (length(source_url) BETWEEN 1 AND 2048),
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX station_sources_station_id_idx ON station_sources(station_id);
