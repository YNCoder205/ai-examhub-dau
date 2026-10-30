ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS admissions_open BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE classroom_rooms ALTER COLUMN status SET DEFAULT 'scheduled';

ALTER TABLE classroom_rooms DROP CONSTRAINT IF EXISTS classroom_rooms_status_check;
UPDATE classroom_rooms
SET status = CASE status
  WHEN 'active' THEN 'scheduled'
  WHEN 'closed' THEN 'ended'
  ELSE status
END;
ALTER TABLE classroom_rooms
  ADD CONSTRAINT classroom_rooms_status_check CHECK (status IN ('scheduled', 'live', 'ended'));
