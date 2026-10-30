const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/questions — Lấy danh sách câu hỏi từ DB
router.get('/', async (req, res) => {
  try {
    const { subject, difficulty, type, search, page = 1, limit = 100 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (subject) { conditions.push(`subject = $${idx++}`); values.push(subject); }
    if (difficulty) { conditions.push(`difficulty = $${idx++}`); values.push(difficulty); }
    if (type) { conditions.push(`type = $${idx++}`); values.push(type); }
    if (search) {
      conditions.push(`content ILIKE $${idx++}`);
      values.push(`%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await query(`SELECT COUNT(*) FROM questions ${where}`, values);
    const total = Number(countRes.rows[0].count);

    values.push(Number(limit), offset);
    const result = await query(
      `SELECT q.*, u.full_name as creator_name 
       FROM questions q
       LEFT JOIN users u ON q.created_by = u.id
       ${where} 
       ORDER BY q.created_at DESC 
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    const data = result.rows.map(row => ({
      id: row.id,
      text: row.content,
      content: row.content,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type || (Array.isArray(row.choices) && row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
      choices: Array.isArray(row.choices) ? row.choices : (typeof row.choices === 'string' ? JSON.parse(row.choices) : []),
      answer: row.answer_index ?? 0,
      answer_index: row.answer_index,
      answerText: row.answer_text || '',
      created_by: row.created_by,
      creator_name: row.creator_name,
      created_at: row.created_at,
    }));

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('Get questions error:', err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách câu hỏi.' });
  }
});

// GET /api/questions/subjects — Lấy danh sách môn học
router.get('/subjects', async (req, res) => {
  try {
    const result = await query('SELECT DISTINCT subject FROM questions ORDER BY subject');
    res.json({ data: result.rows.map(r => r.subject) });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi khi lấy danh sách môn học.' });
  }
});

// GET /api/questions/:id — Lấy chi tiết câu hỏi
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT q.*, u.full_name as creator_name FROM questions q LEFT JOIN users u ON q.created_by = u.id WHERE q.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    const row = result.rows[0];
    res.json({
      id: row.id,
      text: row.content,
      content: row.content,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type || 'essay',
      choices: Array.isArray(row.choices) ? row.choices : [],
      answer: row.answer_index ?? 0,
      answerText: row.answer_text || '',
      created_by: row.created_by,
      creator_name: row.creator_name,
      created_at: row.created_at,
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// POST /api/questions — Tạo câu hỏi mới
router.post('/', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { text, content, subject, difficulty = 'medium', type = 'essay', choices = [], answer = 0, answerText = '' } = req.body || {};
    const questionText = content || text;
    if (!questionText || !subject) {
      return res.status(400).json({ message: 'Nội dung câu hỏi và môn học là bắt buộc.' });
    }
    const result = await query(
      `INSERT INTO questions (subject, content, choices, answer_index, answer_text, difficulty, type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subject, questionText.trim(), JSON.stringify(choices), Number(answer), answerText || null, difficulty, type, req.user.id]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      text: row.content,
      content: row.content,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type,
      choices: Array.isArray(row.choices) ? row.choices : [],
      answer: row.answer_index,
      created_by: row.created_by,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('Create question error:', err);
    res.status(500).json({ message: 'Lỗi khi tạo câu hỏi.' });
  }
});

// PUT /api/questions/:id — Cập nhật câu hỏi
router.put('/:id', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { text, content, subject, difficulty, type, choices, answer, answerText } = req.body || {};
    const questionText = content || text;
    const check = await query('SELECT id, created_by FROM questions WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    // Only creator or admin can edit
    if (req.user.role !== 'admin' && check.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Bạn không có quyền sửa câu hỏi này.' });
    }

    const result = await query(
      `UPDATE questions SET
         content = COALESCE($1, content),
         subject = COALESCE($2, subject),
         difficulty = COALESCE($3, difficulty),
         type = COALESCE($4, type),
         choices = COALESCE($5, choices),
         answer_index = COALESCE($6, answer_index),
         answer_text = COALESCE($7, answer_text)
       WHERE id = $8 RETURNING *`,
      [
        questionText?.trim() || null,
        subject || null,
        difficulty || null,
        type || null,
        choices ? JSON.stringify(choices) : null,
        answer !== undefined ? Number(answer) : null,
        answerText !== undefined ? String(answerText) : null,
        req.params.id
      ]
    );
    const row = result.rows[0];
    res.json({
      id: row.id,
      text: row.content,
      content: row.content,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type,
      choices: Array.isArray(row.choices) ? row.choices : [],
      answer: row.answer_index,
      answerText: row.answer_text || '',
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi khi cập nhật câu hỏi.' });
  }
});

// DELETE /api/questions/:id — Xóa câu hỏi
router.delete('/:id', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const check = await query('SELECT id, created_by FROM questions WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    if (req.user.role !== 'admin' && check.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Bạn không có quyền xóa câu hỏi này.' });
    }
    await query('DELETE FROM questions WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Lỗi khi xóa câu hỏi.' });
  }
});

module.exports = router;
