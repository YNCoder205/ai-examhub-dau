-- Migration 002: Add metadata column to exams table

ALTER TABLE exams ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
