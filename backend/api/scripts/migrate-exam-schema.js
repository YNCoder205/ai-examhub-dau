const { query } = require('../src/config/db');

async function migrate() {
  // 1. Ensure exam_questions has UNIQUE constraint on (exam_id, question_id)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='exam_questions' AND constraint_type='UNIQUE'
          AND constraint_name='exam_questions_exam_id_question_id_key'
      ) THEN
        ALTER TABLE exam_questions ADD CONSTRAINT exam_questions_exam_id_question_id_key
          UNIQUE (exam_id, question_id);
      END IF;
    END $$;
  `);
  console.log('✓ exam_questions UNIQUE constraint OK');

  // 2. Ensure created_by column on exams
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
  console.log('✓ exams.created_by column OK');

  // 3. Ensure type column on questions
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'essay';`);
  console.log('✓ questions.type column OK');

  // 4. Backfill type for existing questions
  await query(`
    UPDATE questions
    SET type = CASE
      WHEN jsonb_array_length(choices) >= 2 THEN 'multipleChoice'
      ELSE 'essay'
    END
    WHERE type IS NULL OR type = '';
  `);
  console.log('✓ questions.type backfilled');

  // 5. Sync exam_questions from exams.question_ids (for legacy exams without exam_questions rows)
  const legacyExams = await query(`
    SELECT e.id, e.question_ids
    FROM exams e
    WHERE NOT EXISTS (
      SELECT 1 FROM exam_questions eq WHERE eq.exam_id = e.id
    )
    AND jsonb_array_length(e.question_ids) > 0
  `);
  let synced = 0;
  for (const row of legacyExams.rows) {
    const ids = Array.isArray(row.question_ids) ? row.question_ids : JSON.parse(row.question_ids || '[]');
    for (let i = 0; i < ids.length; i++) {
      const qid = ids[i];
      // Only insert if question exists in DB (skip in-memory q-001 style IDs)
      const exists = await query('SELECT id FROM questions WHERE id = $1', [qid]).catch(() => ({ rows: [] }));
      if (!exists.rows.length) continue;
      await query(
        'INSERT INTO exam_questions (exam_id, question_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [row.id, qid, i + 1]
      );
      synced++;
    }
  }
  console.log(`✓ Synced ${synced} exam_questions rows from legacy exams`);

  console.log('\n=== Migration complete ===');
  process.exit(0);
}

migrate().catch(err => { console.error('Migration error:', err.message); process.exit(1); });
