const express = require('express');
const crypto = require('node:crypto');
const { pool, query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');
const bcrypt = require('bcryptjs');

const router = express.Router();
const isValidAvatar = (avatar) => avatar === null
  || (typeof avatar === 'string'
    && avatar.length <= 700_000
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar));
const INSTITUTIONAL_FIELDS = {
  institutional_id: { max: 64, label: 'Mã số' },
  faculty: { max: 255, label: 'Khoa' },
  department: { max: 255, label: 'Đơn vị/Bộ môn' },
  cohort: { max: 64, label: 'Khóa' },
  class_name: { max: 128, label: 'Lớp' },
};

function normalizeInstitutionalFields(body) {
  const fields = {};
  for (const [field, { max, label }] of Object.entries(INSTITUTIONAL_FIELDS)) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { error: `${label} không hợp lệ.` };
    }
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length > max) return { error: `${label} không được vượt quá ${max} ký tự.` };
    fields[field] = normalized || null;
  }
  return { fields };
}

// GET /api/users — Lấy danh sách user (admin only)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ message: 'Trang hoặc số lượng tài khoản mỗi trang không hợp lệ.' });
    }
    if (role && !['admin', 'teacher', 'student'].includes(role)) {
      return res.status(400).json({ message: 'Vai trò lọc không hợp lệ.' });
    }
    const offset = (pageNumber - 1) * pageSize;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (role) {
      conditions.push(`role = $${idx++}`);
      values.push(role);
    }
    if (search) {
      conditions.push(`(full_name ILIKE $${idx} OR email ILIKE $${idx} OR institutional_id ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRes, roleCountsRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM users ${where}`, values),
      query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role'),
    ]);
    const total = Number(countRes.rows[0].count);
    const roleCounts = { admin: 0, teacher: 0, student: 0 };
    roleCountsRes.rows.forEach((row) => { roleCounts[row.role] = Number(row.count); });

    values.push(pageSize, offset);
    const result = await query(
      `SELECT id, email, full_name, role, avatar_url, phone, institutional_id, faculty, department, cohort, class_name, created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    res.json({ data: result.rows, total, page: pageNumber, limit: pageSize, roleCounts });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách người dùng.' });
  }
});

// GET /api/users/:id — Lấy thông tin một user
router.get('/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, avatar_url, phone, institutional_id, faculty, department, cohort, class_name, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// POST /api/users — Tạo user mới (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { email, password, full_name, role = 'student', avatar_url = null, phone = '' } = req.body || {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string'
      || password.length < 8 || typeof full_name !== 'string' || !full_name.trim()) {
      return res.status(400).json({ message: 'Email, mật khẩu và họ tên là bắt buộc.' });
    }
    if (!isValidAvatar(avatar_url)) return res.status(400).json({ message: 'Ảnh đại diện không hợp lệ.' });
    if (typeof phone !== 'string' || phone.length > 30) return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    if (!['admin', 'teacher', 'student'].includes(role)) return res.status(400).json({ message: 'Vai trò không hợp lệ.' });
    const institutional = normalizeInstitutionalFields(req.body || {});
    if (institutional.error) return res.status(400).json({ message: institutional.error });
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) return res.status(409).json({ message: 'Email đã tồn tại.' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (
        email, password_hash, full_name, role, avatar_url, phone,
        institutional_id, faculty, department, cohort, class_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, email, full_name, role, avatar_url, phone, institutional_id, faculty, department, cohort, class_name, created_at`,
      [
        normalizedEmail, hash, full_name.trim(), role, avatar_url, phone.trim(),
        institutional.fields.institutional_id, institutional.fields.faculty, institutional.fields.department,
        institutional.fields.cohort, institutional.fields.class_name,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email hoặc mã số đã tồn tại.' });
    console.error('Create user error:', err);
    res.status(500).json({ message: 'Lỗi khi tạo người dùng.' });
  }
});

// POST /api/users/bulk — Tạo tài khoản từ danh sách CSV (admin only)
router.post('/bulk', authenticate, requireRole('admin'), async (req, res) => {
  const { users } = req.body || {};
  if (!Array.isArray(users) || users.length < 1 || users.length > 500) {
    return res.status(400).json({ message: 'Danh sách cần có từ 1 đến 500 tài khoản.' });
  }

  const normalizedUsers = [];
  const seenEmails = new Set();
  const seenInstitutionalIds = new Set();
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      return res.status(400).json({ message: `Dòng ${index + 2}: dữ liệu tài khoản không hợp lệ.` });
    }
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const fullName = typeof user.full_name === 'string' ? user.full_name.trim() : '';
    const role = typeof user.role === 'string' && user.role.trim() ? user.role.trim() : 'student';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return res.status(400).json({ message: `Dòng ${index + 2}: email không hợp lệ.` });
    }
    if (!fullName || fullName.length > 255) {
      return res.status(400).json({ message: `Dòng ${index + 2}: họ tên bắt buộc và tối đa 255 ký tự.` });
    }
    if (user.password !== undefined && typeof user.password !== 'string') {
      return res.status(400).json({ message: `Dòng ${index + 2}: mật khẩu phải là văn bản.` });
    }
    if (user.password && (user.password.length < 8 || user.password.length > 128)) {
      return res.status(400).json({ message: `Dòng ${index + 2}: mật khẩu phải từ 8 đến 128 ký tự.` });
    }
    if (!['admin', 'teacher', 'student'].includes(role)) {
      return res.status(400).json({ message: `Dòng ${index + 2}: vai trò không hợp lệ.` });
    }
    if (user.phone !== undefined && (typeof user.phone !== 'string' || user.phone.length > 30)) {
      return res.status(400).json({ message: `Dòng ${index + 2}: số điện thoại không hợp lệ.` });
    }
    const institutional = normalizeInstitutionalFields(user);
    if (institutional.error) {
      return res.status(400).json({ message: `Dòng ${index + 2}: ${institutional.error}` });
    }
    const institutionalId = institutional.fields.institutional_id;
    const duplicateInFile = seenEmails.has(email)
      || (institutionalId && seenInstitutionalIds.has(institutionalId.toLowerCase()));
    seenEmails.add(email);
    if (institutionalId) seenInstitutionalIds.add(institutionalId.toLowerCase());
    normalizedUsers.push({
      email,
      full_name: fullName,
      role,
      password: user.password || null,
      phone: (user.phone || '').trim(),
      duplicateInFile,
      ...institutional.fields,
    });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const candidates = normalizedUsers.filter((user) => !user.duplicateInFile);
    const institutionalIds = candidates.map((user) => user.institutional_id).filter(Boolean);
    const existing = await client.query(
      'SELECT email, institutional_id FROM users WHERE email = ANY($1::text[]) OR institutional_id = ANY($2::text[])',
      [candidates.map((user) => user.email), institutionalIds]
    );
    const existingEmails = new Set(existing.rows.map((row) => row.email.toLowerCase()));
    const existingInstitutionalIds = new Set(
      existing.rows.map((row) => row.institutional_id).filter(Boolean).map((id) => id.toLowerCase())
    );
    const skipped = [];
    const importUsers = candidates.filter((user) => {
      if (existingEmails.has(user.email)) {
        skipped.push({ email: user.email, reason: 'Email đã tồn tại.' });
        return false;
      }
      if (user.institutional_id && existingInstitutionalIds.has(user.institutional_id.toLowerCase())) {
        skipped.push({ email: user.email, reason: `Mã số ${user.institutional_id} đã tồn tại.` });
        return false;
      }
      return true;
    });
    normalizedUsers.forEach((user) => {
      if (user.duplicateInFile) skipped.push({ email: user.email, reason: 'Email hoặc mã số bị lặp trong tệp.' });
    });
    if (!importUsers.length) {
      await client.query('COMMIT');
      transactionStarted = false;
      return res.status(200).json({ createdCount: 0, skippedCount: skipped.length, skipped, data: [] });
    }

    const valueGroups = [];
    const values = [];
    const credentials = [];
    for (const user of importUsers) {
      const initialPassword = user.password || crypto.randomBytes(18).toString('base64url');
      const passwordHash = await bcrypt.hash(initialPassword, 12);
      if (!user.password) credentials.push({
        email: user.email,
        full_name: user.full_name,
        initial_password: initialPassword,
      });
      const start = values.length + 1;
      values.push(
        user.email, passwordHash, user.full_name, user.role, user.phone || null,
        user.institutional_id, user.faculty, user.department, user.cohort, user.class_name
      );
      valueGroups.push(`($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9})`);
    }
    const result = await client.query(
      `INSERT INTO users (
        email, password_hash, full_name, role, phone,
        institutional_id, faculty, department, cohort, class_name
      ) VALUES ${valueGroups.join(', ')}
      RETURNING id, email, full_name, role, institutional_id`,
      values
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json({
      createdCount: result.rowCount,
      skippedCount: skipped.length,
      skipped,
      credentials,
      data: result.rows,
    });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ message: 'Email hoặc mã số đã được tài khoản khác sử dụng; chưa tạo tài khoản nào.' });
    console.error('Bulk create users error:', err);
    res.status(500).json({ message: 'Không thể tạo danh sách tài khoản.' });
  } finally {
    client.release();
  }
});

// PUT /api/users/:id — Cập nhật user
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, full_name, role, password, avatar_url, phone } = req.body || {};
    const institutional = normalizeInstitutionalFields(req.body || {});
    if (email !== undefined && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }
    if (full_name !== undefined && (typeof full_name !== 'string' || !full_name.trim())) {
      return res.status(400).json({ message: 'Họ và tên không được để trống.' });
    }
    if (role !== undefined && !['admin', 'teacher', 'student'].includes(role)) {
      return res.status(400).json({ message: 'Vai trò không hợp lệ.' });
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      return res.status(400).json({ message: 'Mật khẩu mới cần có ít nhất 8 ký tự.' });
    }
    if (institutional.error) return res.status(400).json({ message: institutional.error });
    const sets = [];
    const values = [];
    let idx = 1;

    if (email !== undefined) { sets.push(`email = $${idx++}`); values.push(email.trim().toLowerCase()); }
    if (full_name !== undefined) { sets.push(`full_name = $${idx++}`); values.push(full_name.trim()); }
    if (role !== undefined) { sets.push(`role = $${idx++}`); values.push(role); }
    if (avatar_url !== undefined) {
      if (!isValidAvatar(avatar_url)) return res.status(400).json({ message: 'Ảnh đại diện không hợp lệ.' });
      sets.push(`avatar_url = $${idx++}`); values.push(avatar_url);
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.length > 30) return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
      sets.push(`phone = $${idx++}`); values.push(phone.trim());
    }
    for (const field of Object.keys(INSTITUTIONAL_FIELDS)) {
      if (req.body[field] !== undefined) {
        sets.push(`${field} = $${idx++}`);
        values.push(institutional.fields[field]);
      }
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      sets.push(`password_hash = $${idx++}`); values.push(hash);
    }
    if (!sets.length) return res.status(400).json({ message: 'Không có dữ liệu để cập nhật.' });

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [175118, 1]);
    const target = await client.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    if (target.rows[0].role === 'admin' && role && role !== 'admin') {
      const admins = await client.query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', ['admin']);
      if (admins.rows[0].count <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Không thể hạ quyền quản trị viên cuối cùng.' });
      }
    }

    values.push(req.params.id);
    const result = await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role, avatar_url, phone, institutional_id, faculty, department, cohort, class_name, created_at`,
      values
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ message: 'Email hoặc mã số đã được tài khoản khác sử dụng.' });
    console.error('Update user error:', err);
    res.status(500).json({ message: 'Lỗi khi cập nhật người dùng.' });
  } finally {
    client.release();
  }
});

// DELETE /api/users/bulk — Xóa tất cả tài khoản khớp bộ lọc (admin only)
router.delete('/bulk', authenticate, requireRole('admin'), async (req, res) => {
  const { role, search, confirmation } = req.body || {};
  if ((!role && (typeof search !== 'string' || !search.trim()))
    || (role && !['admin', 'teacher', 'student'].includes(role))
    || (search !== undefined && (typeof search !== 'string' || search.trim().length > 200))) {
    return res.status(400).json({ message: 'Cần chọn bộ lọc vai trò hoặc từ khóa hợp lệ trước khi xóa hàng loạt.' });
  }
  if (confirmation !== 'DELETE_FILTERED_USERS') {
    return res.status(400).json({ message: 'Thiếu xác nhận xóa tài khoản theo bộ lọc.' });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [175118, 1]);

    const conditions = ['id <> $1'];
    const values = [req.user.id];
    let index = 2;
    if (role) {
      conditions.push(`role = $${index++}`);
      values.push(role);
    }
    if (search?.trim()) {
      conditions.push(`(full_name ILIKE $${index} OR email ILIKE $${index})`);
      values.push(`%${search.trim()}%`);
    }

    const result = await client.query(
      `DELETE FROM users WHERE ${conditions.join(' AND ')} RETURNING id`,
      values
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ deletedCount: result.rowCount });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error('Bulk delete users error:', err);
    res.status(500).json({ message: 'Không thể xóa tài khoản theo bộ lọc.' });
  } finally {
    client.release();
  }
});

// DELETE /api/users/:id — Xóa user (admin only)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'Không thể xóa tài khoản đang đăng nhập.' });
    }
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [175118, 1]);
    const target = await client.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    if (target.rows[0].role === 'admin') {
      const admins = await client.query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', ['admin']);
      if (admins.rows[0].count <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Không thể xóa quản trị viên cuối cùng.' });
      }
    }
    await client.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete user error:', err);
    res.status(500).json({ message: 'Lỗi khi xóa người dùng.' });
  } finally {
    client.release();
  }
});

module.exports = router;
