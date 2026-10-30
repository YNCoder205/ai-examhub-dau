const fs = require('fs');
const path = require('path');
const { Client } = require('../../backend/api/node_modules/pg');

async function runMigration() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'ai_examhub_dau',
    user: 'postgres',
    password: '123456'
  });

  try {
    await client.connect();
    console.log('✅ Đã kết nối tới Database');

    const sqlPath = path.join(__dirname, '../migrations/002_add_metadata_to_exams.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('⚙️ Đang chạy migration 002...');
    await client.query(sql);
    console.log('✅ Chạy migration 002 thành công!');

  } catch (err) {
    console.error('❌ Lỗi:', err);
  } finally {
    await client.end();
  }
}

runMigration();
