const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/analytics/dashboard — Thống kê tổng quan từ DB
router.get('/dashboard', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const [questionsRes, examsRes, usersRes, submissionsRes, resultsRes, roomsRes] = await Promise.all([
      query('SELECT COUNT(*) as total, difficulty FROM questions GROUP BY difficulty'),
      query("SELECT COUNT(*) as total, workflow_status FROM exams GROUP BY workflow_status"),
      query('SELECT COUNT(*) as total, role FROM users GROUP BY role'),
      query("SELECT COUNT(*) as total, status FROM submissions GROUP BY status"),
      query('SELECT AVG(score) as avg_score, COUNT(*) as total FROM results'),
      query('SELECT COUNT(*) as total FROM exam_rooms'),
    ]);

    const questionsByDifficulty = { easy: 0, medium: 0, hard: 0, total: 0 };
    questionsRes.rows.forEach(r => {
      questionsByDifficulty[r.difficulty] = Number(r.total);
      questionsByDifficulty.total += Number(r.total);
    });

    const examsByStatus = { draft: 0, review: 0, approved: 0, published: 0, total: 0 };
    examsRes.rows.forEach(r => {
      const s = r.workflow_status || 'draft';
      if (examsByStatus[s] !== undefined) examsByStatus[s] = Number(r.total);
      examsByStatus.total += Number(r.total);
    });

    const usersByRole = { admin: 0, teacher: 0, student: 0, total: 0 };
    usersRes.rows.forEach(r => {
      if (usersByRole[r.role] !== undefined) usersByRole[r.role] = Number(r.total);
      usersByRole.total += Number(r.total);
    });

    const submissionsByStatus = { submitted: 0, grading: 0, graded: 0, total: 0 };
    submissionsRes.rows.forEach(r => {
      if (submissionsByStatus[r.status] !== undefined) submissionsByStatus[r.status] = Number(r.total);
      submissionsByStatus.total += Number(r.total);
    });

    const avgScore = resultsRes.rows[0]?.avg_score ? Math.round(Number(resultsRes.rows[0].avg_score) * 100) / 100 : 0;
    const gradedPapers = Number(resultsRes.rows[0]?.total || 0);

    res.json({
      totalQuestions: questionsByDifficulty.total,
      totalExams: examsByStatus.total,
      totalUsers: usersByRole.total,
      gradedPapers,
      averageScore: avgScore,
      totalRooms: Number(roomsRes.rows[0]?.total || 0),
      questionsByDifficulty,
      examsByStatus,
      usersByRole,
      submissionsByStatus,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ message: 'Không thể tải thống kê hệ thống.' });
  }
});

// GET /api/analytics/result — Legacy endpoint for dashboard
router.get('/result', authenticate, async (req, res) => {
  try {
    const [questionsRes, examsRes, resultsRes, roomsRes] = await Promise.all([
      query('SELECT COUNT(*) as total FROM questions'),
      query('SELECT COUNT(*) as total FROM exams'),
      query('SELECT COUNT(*) as total, AVG(score) as avg FROM results'),
      query('SELECT COUNT(*) as total FROM exam_rooms'),
    ]);

    const totalQuestions = Number(questionsRes.rows[0]?.total || 0);
    const totalExams = Number(examsRes.rows[0]?.total || 0);
    const gradedPapers = Number(resultsRes.rows[0]?.total || 0);
    const averageScore = resultsRes.rows[0]?.avg ? Math.round(Number(resultsRes.rows[0].avg) * 100) / 100 : 0;

    res.json({ totalQuestions, totalExams, totalRooms: Number(roomsRes.rows[0]?.total || 0), gradedPapers, averageScore, results: [] });
  } catch (err) {
    console.error('Legacy analytics error:', err);
    res.status(500).json({ message: 'Không thể tải thống kê hệ thống.' });
  }
});

module.exports = router;
