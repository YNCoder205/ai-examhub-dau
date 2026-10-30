const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/submissions — Lấy danh sách bài nộp
router.get('/', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { exam_id, status, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (exam_id) { conditions.push(`s.exam_id = $${idx++}`); values.push(exam_id); }
    if (status) { conditions.push(`s.status = $${idx++}`); values.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await query(
      `SELECT COUNT(*) FROM submissions s ${where}`, values
    );
    const total = Number(countRes.rows[0].count);

    values.push(Number(limit), offset);
    const result = await query(
      `SELECT s.*, u.full_name as student_name, u.email as student_email, e.title as exam_title,
              r.score, r.feedback, r.graded_at
       FROM submissions s
       LEFT JOIN users u ON s.student_id = u.id
       LEFT JOIN exams e ON s.exam_id = e.id
       LEFT JOIN results r ON r.submission_id = s.id
       ${where}
       ORDER BY s.submitted_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    res.json({ data: result.rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('Get submissions error:', err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách bài nộp.' });
  }
});

// GET /api/submissions/:id — Lấy chi tiết bài nộp
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*, u.full_name as student_name, u.email as student_email, e.title as exam_title,
              r.score, r.feedback, r.graded_at
       FROM submissions s
       LEFT JOIN users u ON s.student_id = u.id
       LEFT JOIN exams e ON s.exam_id = e.id
       LEFT JOIN results r ON r.submission_id = s.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy bài nộp.' });

    const sub = result.rows[0];
    // Students can only see their own submissions
    if (req.user.role === 'student' && sub.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Bạn không có quyền xem bài nộp này.' });
    }
    res.json(sub);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// POST /api/submissions — Nộp bài thi (student)
router.post('/', authenticate, async (req, res) => {
  try {
    const { exam_id, answers } = req.body || {};
    if (!exam_id) return res.status(400).json({ message: 'exam_id là bắt buộc.' });

    // Check exam exists
    const examCheck = await query('SELECT id, status FROM exams WHERE id = $1', [exam_id]);
    if (!examCheck.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });

    const result = await query(
      `INSERT INTO submissions (exam_id, student_id, answers, status)
       VALUES ($1, $2, $3, 'submitted') RETURNING *`,
      [exam_id, req.user.id, JSON.stringify(answers || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ message: 'Lỗi khi nộp bài.' });
  }
});

// POST /api/submissions/:id/grade — Chấm bài
router.post('/:id/grade', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { score, feedback } = req.body || {};
    if (score === undefined) return res.status(400).json({ message: 'score là bắt buộc.' });

    // Update submission status
    await query(
      "UPDATE submissions SET status = 'graded' WHERE id = $1",
      [req.params.id]
    );

    // Upsert result
    const result = await query(
      `INSERT INTO results (submission_id, score, feedback)
       VALUES ($1, $2, $3)
       ON CONFLICT (submission_id) DO UPDATE SET score = $2, feedback = $3, graded_at = now()
       RETURNING *`,
      [req.params.id, Number(score), feedback || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ message: 'Lỗi khi chấm bài.' });
  }
});

module.exports = router;
