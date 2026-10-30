CREATE TABLE IF NOT EXISTS exam_attempt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('tab_hidden')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_attempt_time
  ON exam_attempt_events (attempt_id, occurred_at DESC);
