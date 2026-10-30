ALTER TABLE users
  ADD COLUMN IF NOT EXISTS institutional_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS faculty VARCHAR(255),
  ADD COLUMN IF NOT EXISTS department VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cohort VARCHAR(64),
  ADD COLUMN IF NOT EXISTS class_name VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_institutional_id
  ON users (institutional_id)
  WHERE institutional_id IS NOT NULL;
