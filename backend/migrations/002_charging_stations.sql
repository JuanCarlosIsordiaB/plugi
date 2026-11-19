CREATE TABLE connector_types (
  id text PRIMARY KEY,
  label text NOT NULL
);
INSERT INTO connector_types (id, label) VALUES
  ('j1772', 'Type 1 (J1772)'),
  ('type_2', 'Type 2 (Mennekes)'),
  ('ccs1', 'CCS Combo 1'),
  ('ccs2', 'CCS Combo 2'),
  ('chademo', 'CHAdeMO'),
  ('nacs', 'NACS (J3400)'),
  ('gbt_ac', 'GB/T AC'),
  ('gbt_dc', 'GB/T DC');

CREATE TABLE charging_stations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX charging_stations_coordinates_idx ON charging_stations(latitude, longitude);

CREATE TABLE station_chargers (
  id uuid PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES charging_stations ON DELETE CASCADE,
  position integer NOT NULL,
  label text NOT NULL,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  UNIQUE (station_id, position)
);
CREATE TABLE charger_connectors (
  charger_id uuid NOT NULL REFERENCES station_chargers ON DELETE CASCADE,
  connector_type text NOT NULL REFERENCES connector_types,
  PRIMARY KEY (charger_id, connector_type)
);
CREATE TABLE charger_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  charger_id uuid NOT NULL REFERENCES station_chargers ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth_users ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('available', 'occupied', 'out_of_service')),
  reported_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX charger_reports_latest_idx ON charger_reports(charger_id, reported_at DESC, id DESC);
CREATE INDEX charger_reports_quota_idx ON charger_reports(reporter_id, reported_at DESC);

CREATE VIEW charger_availability AS
SELECT c.*, COALESCE(r.status, 'unreported') AS status, r.reported_at
FROM station_chargers c
LEFT JOIN LATERAL (
  SELECT status, reported_at FROM charger_reports WHERE charger_id = c.id
  ORDER BY reported_at DESC, id DESC LIMIT 1
) r ON true;

CREATE TABLE station_proposals (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  station jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  station_id uuid REFERENCES charging_stations,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth_users ON DELETE SET NULL,
  CHECK ((status = 'approved') = (station_id IS NOT NULL)),
  CHECK ((status = 'pending') = (reviewed_at IS NULL))
);
CREATE INDEX station_proposals_author_idx ON station_proposals(author_id, created_at DESC, id DESC);
CREATE INDEX station_proposals_queue_idx ON station_proposals(created_at, id) WHERE status = 'pending';
