-- AI EXAMHUB DAU - PostgreSQL schema
-- Migration 001: Initial schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email VARCHAR(255) UNIQUE NOT NULL,
	password_hash TEXT NOT NULL,
	full_name VARCHAR(255) NOT NULL,
	role VARCHAR(32) NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	subject VARCHAR(255) NOT NULL,
	content TEXT NOT NULL,
	choices JSONB NOT NULL DEFAULT '[]'::jsonb,
	answer_index INTEGER,
	difficulty VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
	created_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exams (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title VARCHAR(255) NOT NULL,
	subject VARCHAR(255) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
	created_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
	status VARCHAR(16) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'closed'))
);

CREATE TABLE IF NOT EXISTS submissions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
	student_id UUID REFERENCES users(id) ON DELETE SET NULL,
	answers JSONB NOT NULL DEFAULT '{}'::jsonb,
	status VARCHAR(16) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'grading', 'graded')),
	submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_questions_subject_difficulty ON questions(subject, difficulty);
CREATE INDEX IF NOT EXISTS idx_submissions_exam ON submissions(exam_id);
