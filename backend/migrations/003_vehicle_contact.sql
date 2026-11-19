CREATE TABLE contact_vehicles (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  vin text NOT NULL UNIQUE,
  plate text NOT NULL,
  plate_country text NOT NULL,
  plate_region text NOT NULL,
  accepts_contact boolean NOT NULL DEFAULT true,
  UNIQUE (plate_country, plate_region, plate)
);
CREATE INDEX contact_vehicles_owner_idx ON contact_vehicles(owner_id);

CREATE TABLE contact_conversations (
  id uuid PRIMARY KEY,
  initiator uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  recipient uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  answered boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (initiator <> recipient)
);
CREATE INDEX contact_inbox_idx ON contact_conversations(recipient, updated_at DESC, id DESC);
CREATE INDEX contact_answered_idx ON contact_conversations(initiator, updated_at DESC, id DESC) WHERE answered;
CREATE INDEX contact_pending_pair_idx ON contact_conversations(initiator,recipient,updated_at) WHERE NOT answered;

CREATE TABLE contact_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES contact_conversations ON DELETE CASCADE,
  from_initiator boolean NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  hidden boolean NOT NULL DEFAULT false
);
CREATE INDEX contact_history_idx ON contact_messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE contact_blocks (
  blocker uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  blocked uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);
CREATE TABLE contact_suspensions (
  user_id uuid PRIMARY KEY REFERENCES auth_users ON DELETE CASCADE
);
CREATE TABLE contact_reports (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES contact_messages ON DELETE CASCADE,
  reporter uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('abuse','spam','other')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolution text CHECK (resolution IN ('dismiss','hide','suspend')),
  resolved_at timestamptz,
  UNIQUE (message_id, reporter)
);
CREATE INDEX contact_pending_reports_idx ON contact_reports(created_at, id) WHERE resolution IS NULL;
