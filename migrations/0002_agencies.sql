-- Multi-tenant support: agencies own users, allocations, repo_allocations, notifications.
-- Safe to run against an existing single-tenant database: any pre-existing rows
-- are backfilled into one auto-created "legacy" agency so nothing is lost.

CREATE TABLE IF NOT EXISTS agencies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  owner_name VARCHAR(255) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backfill: if there is existing data with no agency yet, create one legacy
-- agency and attach all existing rows to it, so an upgrade never orphans data.
DO $$
DECLARE
  legacy_id INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'agency_id') THEN

    INSERT INTO agencies (name, code, owner_name, is_active)
    VALUES ('Dhanraj Enterprises', 'DHANRAJ1', 'Legacy Admin', TRUE)
    RETURNING id INTO legacy_id;

    ALTER TABLE users ADD COLUMN agency_id INTEGER;
    UPDATE users SET agency_id = legacy_id WHERE agency_id IS NULL;
    ALTER TABLE users ALTER COLUMN agency_id SET NOT NULL;
    ALTER TABLE users ADD CONSTRAINT users_agency_fk FOREIGN KEY (agency_id) REFERENCES agencies(id);

    -- Username is now unique per-agency, not globally.
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS users_agency_username_idx ON users (agency_id, username);

    ALTER TABLE allocations ADD COLUMN agency_id INTEGER;
    UPDATE allocations SET agency_id = legacy_id WHERE agency_id IS NULL;
    ALTER TABLE allocations ALTER COLUMN agency_id SET NOT NULL;

    ALTER TABLE repo_allocations ADD COLUMN agency_id INTEGER;
    UPDATE repo_allocations SET agency_id = legacy_id WHERE agency_id IS NULL;
    ALTER TABLE repo_allocations ALTER COLUMN agency_id SET NOT NULL;

    ALTER TABLE notifications ADD COLUMN agency_id INTEGER;
    UPDATE notifications SET agency_id = legacy_id WHERE agency_id IS NULL;
    ALTER TABLE notifications ALTER COLUMN agency_id SET NOT NULL;

    RAISE NOTICE 'Backfilled legacy agency % (code DHANRAJ1) for pre-existing data', legacy_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_agency ON users (agency_id);
CREATE INDEX IF NOT EXISTS idx_allocations_agency ON allocations (agency_id);
CREATE INDEX IF NOT EXISTS idx_repo_allocations_agency ON repo_allocations (agency_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agency ON notifications (agency_id);
