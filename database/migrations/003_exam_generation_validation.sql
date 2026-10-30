-- AI EXAMHUB DAU - Migration 003
-- Compat + validation for AI exam generation workflow

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'essay';

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS answer_index INTEGER;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(16) DEFAULT 'draft';

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS question_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE exam_questions
  DROP CONSTRAINT IF EXISTS exam_questions_pkey;

ALTER TABLE exam_questions
  ADD PRIMARY KEY (exam_id, question_id);

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam_id
  ON exam_questions (exam_id);

CREATE INDEX IF NOT EXISTS idx_exams_workflow_status
  ON exams (workflow_status);

CREATE INDEX IF NOT EXISTS idx_exams_created_by
  ON exams (created_by);

UPDATE exams
SET workflow_status = COALESCE(workflow_status, status, 'draft')
WHERE workflow_status IS NULL OR workflow_status = '';

UPDATE exams
SET question_ids = COALESCE(question_ids, '[]'::jsonb)
WHERE question_ids IS NULL;

UPDATE exams
SET metadata = COALESCE(metadata, '{}'::jsonb)
WHERE metadata IS NULL;

UPDATE exams
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

UPDATE questions
SET type = CASE
  WHEN type IS NULL OR type = '' THEN
    CASE WHEN choices IS NOT NULL AND jsonb_array_length(COALESCE(choices, '[]'::jsonb)) >= 2 THEN 'multipleChoice' ELSE 'essay' END
  ELSE type
END
WHERE type IS NULL OR type = '';
