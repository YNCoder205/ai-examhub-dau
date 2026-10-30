/**
 * Seed script — Tạo tài khoản mẫu cho dev/test.
 *
 * Chạy:  node database/seeders/run_seed.js
 *
 * Yêu cầu: PostgreSQL đang chạy, DB đã được tạo và chạy migration.
 */
require('../../backend/api/node_modules/dotenv').config({ path: '../../.env' }); // Load .env from project root

const { Pool } = require('../../backend/api/node_modules/pg');
const bcrypt = require('../../backend/api/node_modules/bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'ai_examhub_dau',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
});

const SALT_ROUNDS = 10;

const seedUsers = [
  { email: 'admin@dau.edu.vn',       password: 'admin123',   full_name: 'Quản trị viên DAU',      role: 'admin'   },
  { email: 'nguyenvana@dau.edu.vn',   password: 'teacher123', full_name: 'TS. Nguyễn Văn A',       role: 'teacher' },
  { email: 'tranthib@dau.edu.vn',     password: 'teacher123', full_name: 'ThS. Trần Thị B',        role: 'teacher' },
  { email: 'sv001@sv.dau.edu.vn',     password: 'student123', full_name: 'Lê Văn Minh (SV001)',     role: 'student' },
  { email: 'sv002@sv.dau.edu.vn',     password: 'student123', full_name: 'Phạm Thị Hoa (SV002)',    role: 'student' },
];

async function seed() {
  const client = await pool.connect();

  try {
    console.log('🌱 Bắt đầu seed dữ liệu...\n');

    for (const user of seedUsers) {
      const hash = await bcrypt.hash(user.password, SALT_ROUNDS);

      // Upsert — nếu email đã tồn tại thì cập nhật
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           full_name     = EXCLUDED.full_name,
           role          = EXCLUDED.role`,
        [user.email, hash, user.full_name, user.role]
      );

      const roleLabel = user.role === 'admin' ? '🔴 Admin'
        : user.role === 'teacher' ? '🟢 Giảng viên'
        : '🔵 Sinh viên';

      console.log(`  ✅ ${roleLabel}: ${user.email} (mật khẩu: ${user.password})`);
    }

    console.log('\n🎉 Seed hoàn tất! Tổng cộng:', seedUsers.length, 'tài khoản.');
  } catch (err) {
    console.error('❌ Seed lỗi:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
