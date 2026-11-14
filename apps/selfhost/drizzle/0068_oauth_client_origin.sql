-- AI apps (both editions, same SQL): which client address bucket registered an app (a SHA-256, never the address), so
-- one address cannot use up the installation's hourly registrations.
ALTER TABLE oauth_clients ADD COLUMN registered_from TEXT;
CREATE INDEX IF NOT EXISTS oauth_clients_registered_from ON oauth_clients(registered_from, created_at);
