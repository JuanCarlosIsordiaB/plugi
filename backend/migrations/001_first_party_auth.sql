CREATE TABLE auth_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  last_name text,
  avatar text,
  country text,
  language text,
  password_hash text NOT NULL,
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_last_step bigint,
  totp_setup_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users ON DELETE CASCADE,
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('account_confirmation','password_reset','2fa')),
  user_id uuid REFERENCES auth_users ON DELETE CASCADE,
  email text,
  pending_name text,
  pending_hash text,
  code_hash text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_challenges_user_idx ON auth_challenges(user_id);
CREATE INDEX auth_challenges_expiry_idx ON auth_challenges(expires_at);

CREATE TABLE auth_rate_limits (
  bucket text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_expiry_idx ON auth_rate_limits(expires_at);
