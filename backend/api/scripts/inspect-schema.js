const { query } = require('../src/config/db');

async function inspectSchema() {
  const tables = ['exams', 'exam_questions', 'questions', 'results', 'rubrics', 'submissions'];
  for (const t of tables) {
    const r = await query(
      `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [t]
    );
    console.log(`\n== ${t} ==`);
    r.rows.forEach(c => console.log(`  ${c.column_name} (${c.data_type}) nullable=${c.is_nullable}`));
  }
  process.exit(0);
}
inspectSchema().catch(e => { console.error(e.message); process.exit(1); });
