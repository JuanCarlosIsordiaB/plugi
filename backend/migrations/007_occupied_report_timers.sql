ALTER TABLE charger_reports
  ADD COLUMN duration_minutes smallint
    CHECK (duration_minutes IS NULL OR
           (status = 'occupied' AND duration_minutes BETWEEN 1 AND 720));

CREATE OR REPLACE VIEW charger_availability AS
SELECT c.*,
  CASE WHEN r.occupied_until <= statement_timestamp() THEN 'available'
       ELSE COALESCE(r.status, 'unreported') END AS status,
  r.reported_at,
  CASE WHEN r.occupied_until > statement_timestamp() THEN r.occupied_until END AS occupied_until,
  COALESCE(r.occupied_until <= statement_timestamp(), false) AS available_by_timer
FROM station_chargers c
LEFT JOIN LATERAL (
  SELECT status, reported_at, reported_at + duration_minutes * interval '1 minute' AS occupied_until
  FROM charger_reports WHERE charger_id = c.id
  ORDER BY reported_at DESC, id DESC LIMIT 1
) r ON true;
