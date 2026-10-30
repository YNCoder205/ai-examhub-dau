-- AI EXAMHUB DAU - PostgreSQL schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email VARCHAR(255) UNIQUE NOT NULL,
	password_hash TEXT NOT NULL,
	full_name VARCHAR(255) NOT NULL,
	role VARCHAR(32) NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
	avatar_url TEXT,
	phone VARCHAR(30),
	institutional_id VARCHAR(64) UNIQUE,
	faculty VARCHAR(255),
	department VARCHAR(255),
	cohort VARCHAR(64),
	class_name VARCHAR(128),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	subject VARCHAR(255) NOT NULL,
	content TEXT NOT NULL,
	choices JSONB NOT NULL DEFAULT '[]'::jsonb,
	answer_index INTEGER,
	answer_text TEXT,
	source_evidence TEXT,
	cognitive_level VARCHAR(32),
	rubric JSONB,
	difficulty VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
	created_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exams (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title VARCHAR(255) NOT NULL,
	subject VARCHAR(255) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
	workflow_status VARCHAR(16) NOT NULL DEFAULT 'draft',
	question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
	metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE exams ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(16) DEFAULT 'draft';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS exam_questions (
	exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
	question_id UUID REFERENCES questions(id) ON DELETE RESTRICT,
	position INTEGER NOT NULL,
	PRIMARY KEY (exam_id, question_id)
);

CREATE TABLE IF NOT EXISTS exam_rooms (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
	name VARCHAR(255) NOT NULL,
	starts_at TIMESTAMPTZ,
	ends_at TIMESTAMPTZ,
	status VARCHAR(16) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'closed')),
	access_code VARCHAR(8) NOT NULL UNIQUE,
	created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS exam_room_exams (
	room_id UUID NOT NULL REFERENCES exam_rooms(id) ON DELETE CASCADE,
	exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
	position INTEGER NOT NULL,
	PRIMARY KEY (room_id, exam_id),
	UNIQUE (room_id, position)
);

CREATE TABLE IF NOT EXISTS submissions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
	student_id UUID REFERENCES users(id) ON DELETE SET NULL,
	answers JSONB NOT NULL DEFAULT '{}'::jsonb,
	status VARCHAR(16) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'grading', 'graded')),
	submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS exam_attempt_events (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
	event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('tab_hidden')),
	occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_attempt_time
	ON exam_attempt_events (attempt_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS rubrics (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
	title VARCHAR(255) NOT NULL,
	criteria JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS results (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	submission_id UUID UNIQUE NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
	score NUMERIC(5,2) NOT NULL DEFAULT 0,
	feedback TEXT,
	graded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_subject_difficulty ON questions(subject, difficulty);
CREATE INDEX IF NOT EXISTS idx_submissions_exam ON submissions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id, started_at DESC);

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

CREATE TABLE IF NOT EXISTS classroom_members (
	classroom_id UUID NOT NULL REFERENCES classroom_rooms(id) ON DELETE CASCADE,
	student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_rooms_owner ON classroom_rooms(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classroom_members_student ON classroom_members(student_id, joined_at DESC);
