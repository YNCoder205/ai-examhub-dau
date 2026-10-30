const bcrypt = require('bcryptjs');
const { query } = require('./src/config/db');

async function run() {
  const accounts = [
    { email: 'admin@dau.edu.vn', pass: 'Admin123!', name: 'Quản trị DAU', role: 'admin' },
    { email: 'teacher@dau.edu.vn', pass: 'Teacher123!', name: 'Giảng viên DAU', role: 'teacher' },
    { email: 'student@sv.dau.edu.vn', pass: 'Student123!', name: 'Sinh viên DAU', role: 'student' },
  ];

  for (const acc of accounts) {
    const hash = await bcrypt.hash(acc.pass, 12);
    const exists = await query('SELECT id FROM users WHERE email = $1', [acc.email]);
    if (exists.rows.length) {
      await query('UPDATE users SET password_hash = $1, full_name = $2, role = $3 WHERE email = $4', [hash, acc.name, acc.role, acc.email]);
      console.log('Updated:', acc.email);
    } else {
      await query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
        [acc.email, hash, acc.name, acc.role]
      );
      console.log('Created:', acc.email);
    }
  }

  // Check nguyenvana (existing teacher)
  const h2 = await bcrypt.hash('Teacher123!', 12);
  await query('UPDATE users SET password_hash = $1 WHERE email = $2', [h2, 'nguyenvana@dau.edu.vn']);
  console.log('Updated: nguyenvana@dau.edu.vn');

  // Check sv001 (existing student)
  const h3 = await bcrypt.hash('Student123!', 12);
  await query('UPDATE users SET password_hash = $1 WHERE email = $2', [h3, 'sv001@sv.dau.edu.vn']);
  console.log('Updated: sv001@sv.dau.edu.vn');

  console.log('=== All demo accounts reset OK ===');
  process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
