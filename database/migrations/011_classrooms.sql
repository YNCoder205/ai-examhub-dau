CREATE TABLE IF NOT EXISTS classroom_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mode VARCHAR(20) NOT NULL DEFAULT 'google_meet' CHECK (mode IN ('google_meet', 'direct')),
  meet_url TEXT,
  access_code VARCHAR(8) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
  admissions_open BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'google_meet';
ALTER TABLE classroom_rooms ALTER COLUMN meet_url DROP NOT NULL;

CREATE TABLE IF NOT EXISTS classroom_members (
  classroom_id UUID NOT NULL REFERENCES classroom_rooms(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_rooms_owner
  ON classroom_rooms (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classroom_members_student
  ON classroom_members (student_id, joined_at DESC);
