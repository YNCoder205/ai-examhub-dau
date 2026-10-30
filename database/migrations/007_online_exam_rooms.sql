CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE exam_rooms
  ADD COLUMN IF NOT EXISTS access_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE exam_rooms
SET access_code = upper(encode(gen_random_bytes(4), 'hex'))
WHERE access_code IS NULL;

UPDATE exam_rooms r
SET created_by = e.created_by
FROM exams e
WHERE r.exam_id = e.id AND r.created_by IS NULL;

ALTER TABLE exam_rooms
  ALTER COLUMN access_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_rooms_access_code
  ON exam_rooms(access_code);

CREATE TABLE IF NOT EXISTS exam_room_exams (
  room_id UUID NOT NULL REFERENCES exam_rooms(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (room_id, exam_id),
  UNIQUE (room_id, position)
);

INSERT INTO exam_room_exams (room_id, exam_id, position)
SELECT id, exam_id, 1
FROM exam_rooms
ON CONFLICT (room_id, exam_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES exam_rooms(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_set JSONB NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  marked_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_question INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  submission_id UUID UNIQUE REFERENCES submissions(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_student
  ON exam_attempts(student_id, started_at DESC);
