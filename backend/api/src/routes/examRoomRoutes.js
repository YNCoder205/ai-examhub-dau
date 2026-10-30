const crypto = require('node:crypto');
const express = require('express');
const { pool, query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const shuffle = (items) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const safeQuestions = (questionSet = []) => questionSet.map(({ answer_index, answerText, ...question }) => question);
const isValidAnswer = (question, answer) => question.type === 'multipleChoice'
  ? Number.isInteger(answer) && answer >= 0 && answer < question.choices.length
  : typeof answer === 'string' && answer.length <= 10000;

function mapAttempt(row) {
  const questions = Array.isArray(row.question_set) ? row.question_set : [];
  return {
    id: row.id,
    roomId: row.room_id,
    status: row.submitted_at ? 'submitted' : 'in_progress',
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    deadlineAt: row.deadline_at,
    answers: row.answers || {},
    markedQuestions: row.marked_questions || [],
    currentQuestion: Number(row.current_question || 0),
    tabSwitchCount: Number(row.tab_switch_count || 0),
    submissionId: row.submission_id || null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    feedback: row.feedback || null,
    exam: { id: row.exam_id, title: row.exam_title, subject: row.subject, totalScore: Number(row.total_score || 10) },
    room: { id: row.room_id, name: row.room_name, code: row.access_code },
    questions: safeQuestions(questions),
  };
}

router.post('/', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, startsAt, endsAt } = req.body || {};
    const examIds = [...new Set(Array.isArray(req.body?.examIds) ? req.body.examIds : req.body?.examId ? [req.body.examId] : [])];
    if (!examIds.length || examIds.some((id) => typeof id !== 'string' || !isUuid(id)) || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Chọn ít nhất một đề thi và nhập tên phòng.' });
    }
    const startDate = startsAt ? new Date(startsAt) : null;
    const endDate = endsAt ? new Date(endsAt) : null;
    if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
      return res.status(400).json({ message: 'Thời gian mở/đóng phòng không hợp lệ.' });
    }
    if (startDate && endDate && endDate <= startDate) {
      return res.status(400).json({ message: 'Thời gian đóng phòng phải sau thời gian mở.' });
    }

    const examResult = await query(
      `SELECT e.id, e.title, COUNT(eq.question_id)::int AS question_count
       FROM exams e
       LEFT JOIN exam_questions eq ON eq.exam_id = e.id
       WHERE e.id = ANY($1::uuid[])
       GROUP BY e.id`,
      [examIds]
    );
    if (examResult.rows.length !== examIds.length) return res.status(404).json({ message: 'Không tìm thấy một hoặc nhiều đề thi đã chọn.' });
    const emptyExam = examResult.rows.find((exam) => !exam.question_count);
    if (emptyExam) {
      return res.status(400).json({ message: `Đề thi ${emptyExam.id} chưa có câu hỏi được lưu trong ngân hàng.` });
    }

    const client = await pool.connect();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        await client.query('BEGIN');
        try {
          const result = await client.query(
            `INSERT INTO exam_rooms (exam_id, name, starts_at, ends_at, status, access_code, created_by)
             VALUES ($1, $2, $3, $4, 'scheduled', $5, $6)
             RETURNING id, exam_id AS "examId", name, starts_at AS "startsAt", ends_at AS "endsAt",
                       status, access_code AS "accessCode"`,
            [examIds[0], name.trim(), startDate, endDate, code, req.user.id]
          );
          await client.query(
            `INSERT INTO exam_room_exams (room_id, exam_id, position)
             SELECT $1, selected.exam_id, selected.position
             FROM unnest($2::uuid[]) WITH ORDINALITY AS selected(exam_id, position)`,
            [result.rows[0].id, examIds]
          );
          await client.query('COMMIT');
          return res.status(201).json({
            ...result.rows[0],
            examIds,
            exams: examIds.map((id) => {
              const assignedExam = examResult.rows.find((exam) => exam.id === id);
              return { id, title: assignedExam.title };
            }),
          });
        } catch (error) {
          await client.query('ROLLBACK');
          if (error.code !== '23505' || attempt === 2) throw error;
        }
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create exam room error:', error);
    return res.status(500).json({ message: 'Không thể tạo phòng thi.' });
  }
});

router.get('/', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const params = [];
    const ownerFilter = req.user.role === 'admin' ? '' : 'WHERE r.created_by = $1';
    if (ownerFilter) params.push(req.user.id);
    const result = await query(
      `SELECT r.id, r.exam_id AS "examId", r.name, r.starts_at AS "startsAt",
              r.ends_at AS "endsAt", r.status, r.access_code AS "accessCode",
              e.title AS "examTitle",
              COALESCE(assigned.exams, '[]'::jsonb) AS exams,
              ARRAY(SELECT re.exam_id FROM exam_room_exams re WHERE re.room_id = r.id ORDER BY re.position) AS "examIds",
              (SELECT COUNT(*)::int FROM exam_attempts a WHERE a.room_id = r.id) AS "attemptCount"
       FROM exam_rooms r
       JOIN exams e ON e.id = r.exam_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', ae.id, 'title', ae.title) ORDER BY re.position) AS exams
         FROM exam_room_exams re
         JOIN exams ae ON ae.id = re.exam_id
         WHERE re.room_id = r.id
       ) assigned ON true
       ${ownerFilter}
       ORDER BY r.starts_at DESC NULLS LAST, r.id DESC`,
      params
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('List exam rooms error:', error);
    res.status(500).json({ message: 'Không thể tải danh sách phòng thi.' });
  }
});

router.patch('/:id/status', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'closed'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái phòng chỉ có thể là active hoặc closed.' });
    }
    const result = await query(
      `UPDATE exam_rooms
       SET status = $1
       WHERE id = $2 AND ($3::boolean OR created_by = $4)
       RETURNING id, exam_id AS "examId", name, starts_at AS "startsAt",
                 ends_at AS "endsAt", status, access_code AS "accessCode"`,
      [status, req.params.id, req.user.role === 'admin', req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy phòng thi hoặc bạn không có quyền quản lý.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update exam room status error:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái phòng thi.' });
  }
});

router.get('/:id/grading', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const roomResult = await query(
      `SELECT id, name, created_by FROM exam_rooms WHERE id = $1`,
      [req.params.id]
    );
    if (!roomResult.rows.length) return res.status(404).json({ message: 'Không tìm thấy phòng thi.' });
    const room = roomResult.rows[0];
    if (req.user.role !== 'admin' && room.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Bạn không có quyền xem kết quả chấm thi của phòng này.' });
    }

    const attemptsResult = await query(
      `SELECT a.id, a.submission_id, a.question_set, a.answers, a.submitted_at,
              e.id AS exam_id, e.title AS exam_title,
              COALESCE((e.metadata->>'totalScore')::numeric, 10) AS total_score,
              u.full_name AS student_name, u.email AS student_email,
              result.score, result.feedback
       FROM exam_attempts a
       JOIN submissions s ON s.id = a.submission_id
       JOIN users u ON u.id = a.student_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN results result ON result.submission_id = a.submission_id
       WHERE a.room_id = $1 AND a.submitted_at IS NOT NULL
       ORDER BY a.submitted_at DESC`,
      [req.params.id]
    );
    const attempts = attemptsResult.rows.map((row) => ({
      id: row.id,
      submissionId: row.submission_id,
      exam_id: row.exam_id,
      exam_title: row.exam_title,
      totalScore: Number(row.total_score),
      student_name: row.student_name,
      student_email: row.student_email,
      answers: row.answers || {},
      status: row.score === null || row.score === undefined ? 'submitted' : 'graded',
      submitted_at: row.submitted_at,
      score: row.score === null || row.score === undefined ? undefined : Number(row.score),
      feedback: row.feedback || '',
      questions: Array.isArray(row.question_set) ? row.question_set : [],
    }));

    res.json({
      room: { id: room.id, name: room.name },
      attempts,
      total: attempts.length,
    });
  } catch (error) {
    console.error('Get exam room grading results error:', error);
    res.status(500).json({ message: 'Không thể tải kết quả chấm thi của phòng.' });
  }
});

router.post('/attempts/:id/grade', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  const { score, feedback } = req.body || {};
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return res.status(400).json({ message: 'Điểm chấm phải là số không âm hợp lệ.' });
  }
  if (feedback !== undefined && typeof feedback !== 'string') {
    return res.status(400).json({ message: 'Nhận xét phải là văn bản hợp lệ.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attemptResult = await client.query(
      `SELECT a.submission_id, a.submitted_at, r.created_by,
              COALESCE((e.metadata->>'totalScore')::numeric, 10) AS total_score
       FROM exam_attempts a
       JOIN exam_rooms r ON r.id = a.room_id
       JOIN exams e ON e.id = a.exam_id
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [req.params.id]
    );
    if (!attemptResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy bài thi trong phòng.' });
    }
    const attempt = attemptResult.rows[0];
    if (req.user.role !== 'admin' && attempt.created_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Bạn không có quyền chấm bài thi trong phòng này.' });
    }
    if (!attempt.submitted_at || !attempt.submission_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Chỉ có thể chấm bài sau khi sinh viên đã nộp.' });
    }
    const totalScore = Number(attempt.total_score);
    if (score > totalScore) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Điểm không được vượt quá ${totalScore}.` });
    }

    await client.query(
      `UPDATE submissions SET status = 'graded' WHERE id = $1`,
      [attempt.submission_id]
    );
    const result = await client.query(
      `INSERT INTO results (submission_id, score, feedback)
       VALUES ($1, $2, $3)
       ON CONFLICT (submission_id) DO UPDATE
       SET score = EXCLUDED.score, feedback = EXCLUDED.feedback, graded_at = now()
       RETURNING score, feedback, graded_at`,
      [attempt.submission_id, score, feedback?.trim() || null]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Grade exam room attempt error:', error);
    res.status(500).json({ message: 'Không thể lưu kết quả chấm bài.' });
  } finally {
    client.release();
  }
});

router.get('/:id/attempts', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const roomResult = await query(
      `SELECT r.id, r.name, r.status, r.starts_at, r.ends_at, r.created_by,
              COALESCE(assigned.exams, '[]'::jsonb) AS exams
       FROM exam_rooms r
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title) ORDER BY re.position) AS exams
         FROM exam_room_exams re
         JOIN exams e ON e.id = re.exam_id
         WHERE re.room_id = r.id
       ) assigned ON true
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!roomResult.rows.length) return res.status(404).json({ message: 'Không tìm thấy phòng thi.' });
    const room = roomResult.rows[0];
    if (req.user.role !== 'admin' && room.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Bạn không có quyền giám sát phòng thi này.' });
    }

    const attemptsResult = await query(
      `SELECT a.id, a.student_id, a.question_set, a.answers, a.marked_questions,
              a.current_question, a.started_at, a.deadline_at, a.submitted_at, a.updated_at,
              COALESCE(tab_events.tab_switch_count, 0)::int AS tab_switch_count,
              tab_events.recent_tab_switches,
              u.full_name AS student_name, u.email AS student_email, e.id AS exam_id, e.title AS exam_title,
              result.score, result.feedback
       FROM exam_attempts a
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS tab_switch_count,
                (SELECT jsonb_agg(recent.occurred_at ORDER BY recent.occurred_at DESC)
                 FROM (
                   SELECT occurred_at
                   FROM exam_attempt_events
                   WHERE attempt_id = a.id AND event_type = 'tab_hidden'
                   ORDER BY occurred_at DESC
                   LIMIT 10
                 ) recent) AS recent_tab_switches
         FROM exam_attempt_events
         WHERE attempt_id = a.id AND event_type = 'tab_hidden'
       ) tab_events ON true
       JOIN users u ON u.id = a.student_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN results result ON result.submission_id = a.submission_id
       WHERE a.room_id = $1
       ORDER BY a.started_at ASC`,
      [req.params.id]
    );
    const attempts = attemptsResult.rows.map((row) => {
      const questions = Array.isArray(row.question_set) ? row.question_set : [];
      const answers = row.answers || {};
      const answeredCount = questions.filter((question) => {
        const answer = answers[question.id];
        return answer !== undefined && answer !== '';
      }).length;
      return {
        id: row.id,
        student: { id: row.student_id, fullName: row.student_name, email: row.student_email },
        exam: { id: row.exam_id, title: row.exam_title },
        status: row.submitted_at ? 'submitted' : 'in_progress',
        startedAt: row.started_at,
        lastActivityAt: row.updated_at,
        tabSwitchCount: Number(row.tab_switch_count || 0),
        recentTabSwitches: row.recent_tab_switches || [],
        deadlineAt: row.deadline_at,
        submittedAt: row.submitted_at,
        currentQuestion: Number(row.current_question || 0),
        totalQuestions: questions.length,
        answeredCount,
        progressPercent: questions.length ? Math.round((answeredCount / questions.length) * 100) : 0,
        answers,
        markedQuestions: row.marked_questions || [],
        score: row.score === null || row.score === undefined ? null : Number(row.score),
        feedback: row.feedback || null,
        questions: safeQuestions(questions),
      };
    });

    res.json({
      room: {
        id: room.id,
        name: room.name,
        exams: room.exams,
        status: room.status,
        startsAt: room.starts_at,
        endsAt: room.ends_at,
      },
      attempts,
      total: attempts.length,
    });
  } catch (error) {
    console.error('Monitor exam room attempts error:', error);
    res.status(500).json({ message: 'Không thể tải tiến độ sinh viên trong phòng thi.' });
  }
});

router.get('/my-attempts', authenticate, requireRole('student'), async (req, res) => {
  try {
    const result = await query(
      `SELECT a.id, a.room_id, a.exam_id, a.started_at, a.submitted_at, a.submission_id,
              r.name AS room_name, r.access_code, e.title AS exam_title,
              result.score, result.feedback
       FROM exam_attempts a
       JOIN exam_rooms r ON r.id = a.room_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN results result ON result.submission_id = a.submission_id
       WHERE a.student_id = $1
       ORDER BY a.started_at DESC`,
      [req.user.id]
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('List student exam attempts error:', error);
    res.status(500).json({ message: 'Không thể tải lịch sử thi.' });
  }
});

router.post('/:code/start', authenticate, requireRole('student'), async (req, res) => {
  try {
    const roomResult = await query(
      `SELECT r.* FROM exam_rooms r WHERE r.access_code = $1`,
      [String(req.params.code).trim().toUpperCase()]
    );
    if (!roomResult.rows.length) return res.status(404).json({ message: 'Không tìm thấy phòng thi với mã này.' });
    const room = roomResult.rows[0];
    const now = Date.now();
    const startsAt = room.starts_at ? new Date(room.starts_at).getTime() : null;
    const endsAt = room.ends_at ? new Date(room.ends_at).getTime() : null;

    const existing = await query(
      `SELECT a.*, r.name AS room_name, r.access_code, e.title AS exam_title, e.subject,
              COALESCE((e.metadata->>'totalScore')::numeric, 10) AS total_score,
              (SELECT COUNT(*)::int FROM exam_attempt_events event WHERE event.attempt_id = a.id) AS tab_switch_count,
              CASE WHEN a.submission_id IS NOT NULL THEN result.score END AS score,
              CASE WHEN a.submission_id IS NOT NULL THEN result.feedback END AS feedback
       FROM exam_attempts a
       JOIN exam_rooms r ON r.id = a.room_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN results result ON result.submission_id = a.submission_id
       WHERE a.room_id = $1 AND a.student_id = $2`,
      [room.id, req.user.id]
    );
    if (existing.rows.length) return res.json({ attempt: mapAttempt(existing.rows[0]) });
    if (room.status === 'closed' || (startsAt && now < startsAt)) {
      return res.status(409).json({ message: startsAt && now < startsAt ? 'Phòng thi chưa đến giờ mở.' : 'Phòng thi đã đóng.' });
    }
    if (endsAt && now >= endsAt) return res.status(409).json({ message: 'Đã hết thời gian tham gia phòng thi.' });

    const assignedExams = await query(
      `SELECT e.id, e.metadata, e.title, e.subject
       FROM exam_room_exams re
       JOIN exams e ON e.id = re.exam_id
       WHERE re.room_id = $1
       ORDER BY re.position`,
      [room.id]
    );
    if (!assignedExams.rows.length) {
      return res.status(409).json({ message: 'Phòng thi chưa được gán đề thi.' });
    }
    const assignedExam = assignedExams.rows[crypto.randomInt(assignedExams.rows.length)];

    const examQuestions = await query(
      `SELECT q.id, q.content AS text, q.subject, q.difficulty, q.choices,
              q.answer_index, q.answer_text AS "answerText", q.cognitive_level AS "cognitiveLevel",
              q.rubric, q.type, eq.position
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.position`,
      [assignedExam.id]
    );
    if (!examQuestions.rows.length) {
      return res.status(409).json({ message: 'Đề thi chưa có câu hỏi được lưu đầy đủ trong ngân hàng.' });
    }

    const questionSet = shuffle(examQuestions.rows).map((question) => {
      const choices = Array.isArray(question.choices) ? question.choices : [];
      const indexedChoices = choices.map((text, index) => ({ text, index }));
      const questionType = question.type || (choices.length >= 2 ? 'multipleChoice' : 'essay');
      const shuffledChoices = questionType === 'multipleChoice' ? shuffle(indexedChoices) : indexedChoices;
      const answerIndex = question.answer_index === null
        ? null
        : shuffledChoices.findIndex((choice) => choice.index === question.answer_index);
      return {
        id: question.id,
        text: question.text,
        subject: question.subject,
        difficulty: question.difficulty,
        type: questionType,
        choices: shuffledChoices.map((choice) => choice.text),
        answer_index: answerIndex,
        answerText: question.answerText || '',
        cognitiveLevel: question.cognitiveLevel || null,
        rubric: question.rubric || null,
      };
    });

    const durationMs = Math.max(1, Number(assignedExam.metadata?.durationMinutes || 45)) * 60 * 1000;
    const deadlineAt = new Date(Math.min(now + durationMs, endsAt || Number.POSITIVE_INFINITY));
    const attemptInsert = await query(
      `INSERT INTO exam_attempts
         (room_id, exam_id, student_id, question_set, answers, started_at, deadline_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, now(), $5)
       ON CONFLICT (room_id, student_id) DO NOTHING
       RETURNING id`,
      [room.id, assignedExam.id, req.user.id, JSON.stringify(questionSet), deadlineAt]
    );
    const attemptId = attemptInsert.rows[0]?.id;
    if (!attemptId) {
      const resumed = await query(
        `SELECT a.*, r.name AS room_name, r.access_code, e.title AS exam_title, e.subject,
                COALESCE((e.metadata->>'totalScore')::numeric, 10) AS total_score,
                (SELECT COUNT(*)::int FROM exam_attempt_events event WHERE event.attempt_id = a.id) AS tab_switch_count,
                CASE WHEN a.submission_id IS NOT NULL THEN result.score END AS score,
                CASE WHEN a.submission_id IS NOT NULL THEN result.feedback END AS feedback
         FROM exam_attempts a
         JOIN exam_rooms r ON r.id = a.room_id
         JOIN exams e ON e.id = a.exam_id
         LEFT JOIN results result ON result.submission_id = a.submission_id
         WHERE a.room_id = $1 AND a.student_id = $2`,
        [room.id, req.user.id]
      );
      return res.json({ attempt: mapAttempt(resumed.rows[0]) });
    }
    const created = await query(
      `SELECT a.*, r.name AS room_name, r.access_code, e.title AS exam_title, e.subject,
              COALESCE((e.metadata->>'totalScore')::numeric, 10) AS total_score,
              0::int AS tab_switch_count,
              NULL::numeric AS score, NULL::text AS feedback
       FROM exam_attempts a
       JOIN exam_rooms r ON r.id = a.room_id
       JOIN exams e ON e.id = a.exam_id
       WHERE a.id = $1`,
      [attemptId]
    );
    res.status(201).json({ attempt: mapAttempt(created.rows[0]) });
  } catch (error) {
    console.error('Start exam attempt error:', error);
    res.status(500).json({ message: 'Không thể bắt đầu bài thi.' });
  }
});

router.put('/attempts/:id/answers', authenticate, requireRole('student'), async (req, res) => {
  try {
    const { answers, markedQuestions = [], currentQuestion = 0 } = req.body || {};
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ message: 'Câu trả lời phải là một đối tượng hợp lệ.' });
    }
    const attemptResult = await query(
      `SELECT question_set, deadline_at, submitted_at
       FROM exam_attempts WHERE id = $1 AND student_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!attemptResult.rows.length) return res.status(404).json({ message: 'Không tìm thấy bài thi.' });
    const attempt = attemptResult.rows[0];
    if (attempt.submitted_at) return res.status(409).json({ message: 'Bài thi đã được nộp.' });
    if (new Date(attempt.deadline_at).getTime() <= Date.now()) return res.status(409).json({ message: 'Đã hết thời gian làm bài.' });

    const questionsById = new Map(attempt.question_set.map((question) => [question.id, question]));
    const safeAnswers = {};
    for (const [questionId, answer] of Object.entries(answers)) {
      const question = questionsById.get(questionId);
      if (!question) return res.status(400).json({ message: 'Có câu trả lời không thuộc đề thi.' });
      if (!isValidAnswer(question, answer)) return res.status(400).json({ message: 'Định dạng câu trả lời không hợp lệ.' });
      safeAnswers[questionId] = answer;
    }
    const questionIds = new Set(questionsById.keys());
    if (!Array.isArray(markedQuestions) || markedQuestions.some((id) => !questionIds.has(id))) {
      return res.status(400).json({ message: 'Danh sách câu đánh dấu không hợp lệ.' });
    }
    const safeCurrentQuestion = Math.min(Math.max(0, Number(currentQuestion) || 0), questionIds.size - 1);
    const savedResult = await query(
      `UPDATE exam_attempts
       SET answers = $1, marked_questions = $2, current_question = $3, updated_at = now()
       WHERE id = $4 AND student_id = $5 AND submitted_at IS NULL AND deadline_at > now()
       RETURNING id`,
      [JSON.stringify(safeAnswers), JSON.stringify(markedQuestions), safeCurrentQuestion, req.params.id, req.user.id]
    );
    if (!savedResult.rows.length) {
      return res.status(409).json({ message: 'Bài thi đã nộp hoặc đã hết thời gian; câu trả lời chưa được lưu.' });
    }
    res.json({ saved: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Save exam answers error:', error);
    res.status(500).json({ message: 'Không thể lưu câu trả lời.' });
  }
});

router.post('/attempts/:id/tab-switch', authenticate, requireRole('student'), async (req, res) => {
  try {
    const result = await query(
      `INSERT INTO exam_attempt_events (attempt_id, event_type)
       SELECT id, 'tab_hidden'
       FROM exam_attempts
       WHERE id = $1 AND student_id = $2
         AND submitted_at IS NULL AND deadline_at > now()
       RETURNING occurred_at`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      const attemptResult = await query(
        'SELECT submitted_at, deadline_at FROM exam_attempts WHERE id = $1 AND student_id = $2',
        [req.params.id, req.user.id]
      );
      if (!attemptResult.rows.length) return res.status(404).json({ message: 'Không tìm thấy bài thi đang làm.' });
      return res.status(409).json({ message: 'Bài thi đã nộp hoặc đã hết giờ; không thể ghi nhận sự kiện.' });
    }

    const countResult = await query(
      'SELECT COUNT(*)::int AS count FROM exam_attempt_events WHERE attempt_id = $1',
      [req.params.id]
    );
    res.status(201).json({
      tabSwitchCount: countResult.rows[0].count,
      occurredAt: result.rows[0].occurred_at,
    });
  } catch (error) {
    console.error('Log exam tab switch error:', error);
    res.status(500).json({ message: 'Không thể ghi nhận sự kiện chuyển tab.' });
  }
});

router.post('/attempts/:id/submit', authenticate, requireRole('student'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attemptResult = await client.query(
      `SELECT a.*, e.metadata
       FROM exam_attempts a
       JOIN exams e ON e.id = a.exam_id
       WHERE a.id = $1 AND a.student_id = $2
       FOR UPDATE OF a`,
      [req.params.id, req.user.id]
    );
    if (!attemptResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy bài thi.' });
    }
    const attempt = attemptResult.rows[0];
    if (attempt.submitted_at) {
      const savedResult = await client.query(
        'SELECT score FROM results WHERE submission_id = $1',
        [attempt.submission_id]
      );
      await client.query('COMMIT');
      return res.json({
        submitted: true,
        submissionId: attempt.submission_id,
        score: savedResult.rows.length ? Number(savedResult.rows[0].score) : null,
        totalScore: Number(attempt.metadata?.totalScore || 10),
        message: 'Bài thi đã được nộp trước đó.',
      });
    }

    const questionSet = Array.isArray(attempt.question_set) ? attempt.question_set : [];
    const bodyAnswers = req.body?.answers;
    if (bodyAnswers !== undefined && (!bodyAnswers || typeof bodyAnswers !== 'object' || Array.isArray(bodyAnswers))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Câu trả lời phải là một đối tượng hợp lệ.' });
    }
    const answersToSubmit = bodyAnswers && typeof bodyAnswers === 'object' && !Array.isArray(bodyAnswers)
      ? bodyAnswers
      : attempt.answers || {};
    const questionsById = new Map(questionSet.map((question) => [question.id, question]));
    if (Object.keys(answersToSubmit).some((questionId) => !questionsById.has(questionId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Có câu trả lời không thuộc đề thi.' });
    }
    if (Object.entries(answersToSubmit).some(([questionId, answer]) => !isValidAnswer(questionsById.get(questionId), answer))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Định dạng câu trả lời không hợp lệ.' });
    }
    const questionIds = new Set(questionsById.keys());
    const markedQuestions = req.body?.markedQuestions;
    if (markedQuestions !== undefined && (!Array.isArray(markedQuestions) || markedQuestions.some((id) => !questionIds.has(id)))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Danh sách câu đánh dấu không hợp lệ.' });
    }
    const multipleChoice = questionSet.filter((question) => question.type === 'multipleChoice' && question.answer_index !== null);
    const allMultipleChoice = multipleChoice.length === questionSet.length && questionSet.length > 0;
    const totalScore = Number(attempt.metadata?.totalScore || 10);
    const correctCount = multipleChoice.filter((question) => Number(answersToSubmit[question.id]) === question.answer_index).length;
    const score = allMultipleChoice ? Math.round((correctCount / questionSet.length * totalScore) * 100) / 100 : null;

    const submission = await client.query(
      `INSERT INTO submissions (exam_id, student_id, answers, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [attempt.exam_id, req.user.id, JSON.stringify(answersToSubmit), allMultipleChoice ? 'graded' : 'submitted']
    );
    const submissionId = submission.rows[0].id;
    if (allMultipleChoice) {
      await client.query(
        `INSERT INTO results (submission_id, score, feedback)
         VALUES ($1, $2, $3)
         ON CONFLICT (submission_id) DO NOTHING`,
        [submissionId, score, `Tự động chấm ${correctCount}/${questionSet.length} câu trắc nghiệm.`]
      );
    }
    await client.query(
      `UPDATE exam_attempts
       SET answers = $1, marked_questions = $2, current_question = $3,
           submitted_at = now(), submission_id = $4, updated_at = now()
       WHERE id = $5`,
      [
        JSON.stringify(answersToSubmit),
        JSON.stringify(Array.isArray(markedQuestions) ? markedQuestions : attempt.marked_questions),
        Math.min(Math.max(0, Number(req.body?.currentQuestion) || 0), Math.max(0, questionSet.length - 1)),
        submissionId,
        req.params.id,
      ]
    );
    await client.query('COMMIT');
    res.json({
      submitted: true,
      submissionId,
      score,
      totalScore: allMultipleChoice ? totalScore : null,
      message: allMultipleChoice ? 'Bài thi đã được chấm tự động.' : 'Bài thi đã nộp và đang chờ giảng viên chấm.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Submit exam attempt error:', error);
    res.status(500).json({ message: 'Không thể nộp bài thi.' });
  } finally {
    client.release();
  }
});

module.exports = router;
