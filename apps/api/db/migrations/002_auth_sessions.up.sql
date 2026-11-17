ALTER TABLE refresh_tokens
  ADD COLUMN device_fingerprint_hash text,
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN ip_geolocation text;

ALTER TABLE users ADD COLUMN last_login_ip inet;

ALTER TABLE email_logs ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX email_logs_dedupe_key_idx ON email_logs(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX refresh_tokens_active_expiry_idx
  ON refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX auth_action_tokens_user_purpose_idx ON auth_action_tokens(user_id, purpose);
CREATE INDEX auth_action_tokens_expiry_idx ON auth_action_tokens(expires_at);
