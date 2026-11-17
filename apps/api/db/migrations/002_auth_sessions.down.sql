DROP TABLE IF EXISTS auth_action_tokens;
DROP INDEX IF EXISTS email_logs_dedupe_key_idx;
ALTER TABLE email_logs
  DROP COLUMN IF EXISTS dedupe_key;
DROP INDEX IF EXISTS refresh_tokens_active_expiry_idx;
ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS ip_geolocation,
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS device_fingerprint_hash;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_ip;
