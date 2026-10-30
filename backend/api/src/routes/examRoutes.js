/**
 * examRoutes.js – AI ExamHub DAU
 * Quản lý toàn bộ quy trình tạo đề thi:
 *   POST /api/exams/generate  – tạo đề, lưu exam_questions bằng transaction
 *   GET  /api/exams            – danh sách đề
 *   GET  /api/exams/:id        – chi tiết đề (kèm câu hỏi từ exam_questions)
 *   PUT  /api/exams/:id        – cập nhật đề
 *   DELETE /api/exams/:id      – xóa đề
 *   POST /api/exams/:id/variants – tạo mã đề (answer remapped đúng)
 *   POST /api/exams/:id/validate – kiểm tra backend trước khi phát hành
 */

const express = require('express');
const { pool, query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function mapDbExamRow(row = {}) {
  const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    status: row.status,
    workflowStatus: row.workflow_status || row.status || 'draft',
    questionIds: normalizeIds(row.question_ids),
    document: meta.document || null,
    questionTypes: meta.questionTypes || { multipleChoice: 0, essay: 0 },
    difficultyDistribution: meta.difficultyDistribution || { easy: 30, medium: 50, hard: 20 },
    durationMinutes: meta.durationMinutes || 45,
    totalScore: meta.totalScore || 10,
    shuffleQuestions: Boolean(meta.shuffleQuestions),
    ownerName: meta.ownerName || '',
    department: meta.department || '',
    examType: meta.examType || 'Giữa kỳ',
    securityLevel: meta.securityLevel || 'restricted',
    approver: meta.approver || '',
    academicYear: meta.academicYear || '2024-2025',
    semester: meta.semester || '1',
    faculty: meta.faculty || '',
    examCode: meta.examCode || '101',
    examDate: meta.examDate || new Date().toISOString().slice(0, 10),
    rubric: meta.rubric || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeIds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function isUuidLike(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildLegacyQuestionFallback(id, index, subject) {
  const isMc = index % 2 === 0;
  return {
    id,
    text: isMc ? `Câu hỏi legacy ${index + 1}: Chọn phương án đúng nhất theo nội dung môn ${subject || 'Kiến trúc cơ sở'}.` : `Câu hỏi legacy ${index + 1}: Trình bày và phân tích theo yêu cầu môn ${subject || 'Kiến trúc cơ sở'}.`,
    subject: subject || 'Kiến trúc cơ sở',
    difficulty: ['easy', 'medium', 'hard'][index % 3],
    type: isMc ? 'multipleChoice' : 'essay',
    choices: isMc ? ['A', 'B', 'C', 'D'] : [],
    answer: 0,
    answer_index: 0,
  };
}

function mapDbQuestion(row) {
  return {
    id: row.id,
    text: row.content,
    content: row.content,
    subject: row.subject,
    difficulty: row.difficulty,
    type: row.type || (Array.isArray(row.choices) && row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
    choices: Array.isArray(row.choices) ? row.choices : (typeof row.choices === 'string' ? safeParseJson(row.choices, []) : []),
    answer: row.answer_index ?? 0,
    answer_index: row.answer_index ?? 0,
    answerText: row.answer_text || '',
    sourceEvidence: row.source_evidence || '',
    cognitiveLevel: row.cognitive_level || null,
    rubric: row.rubric || null,
  };
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Tính phân bổ câu theo tỷ lệ độ khó (làm tròn phần dư lớn nhất / Largest Remainder)
 * Trả về { easy, medium, hard } tổng đúng bằng total
 */
function allocateByDifficulty(total, ratio) {
  const totalRatio = (ratio.easy || 0) + (ratio.medium || 0) + (ratio.hard || 0) || 100;
  const raw = {
    easy:   total * (ratio.easy   || 0) / totalRatio,
    medium: total * (ratio.medium || 0) / totalRatio,
    hard:   total * (ratio.hard   || 0) / totalRatio,
  };
  const floored = { easy: Math.floor(raw.easy), medium: Math.floor(raw.medium), hard: Math.floor(raw.hard) };
  let remainder = total - floored.easy - floored.medium - floored.hard;
  // Distribute remainder to keys with largest fractional part
  const fracs = Object.entries(raw).map(([k, v]) => ({ k, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) floored[fracs[i % 3].k]++;
  return floored;
}

/**
 * Chọn câu hỏi từ pool theo loại và độ khó.
 * Áp dụng Largest Remainder cho độ khó.
 */
function selectQuestions(pool, targetMC, targetEssay, difficultyRatio) {
  const isMC = q => q.type === 'multipleChoice' || (Array.isArray(q.choices) && q.choices.length >= 2);
  const mcPool    = pool.filter(isMC);
  const essayPool = pool.filter(q => !isMC(q));

  function pickFromPool(src, count) {
    if (count <= 0 || !src.length) return [];
    const alloc = allocateByDifficulty(count, difficultyRatio);
    const easy   = src.filter(q => q.difficulty === 'easy');
    const medium = src.filter(q => q.difficulty === 'medium' || !['easy','hard'].includes(q.difficulty));
    const hard   = src.filter(q => q.difficulty === 'hard');
    const picked = [
      ...easy.slice(0, alloc.easy),
      ...medium.slice(0, alloc.medium),
      ...hard.slice(0, alloc.hard),
    ];
    if (picked.length < count) {
      const usedIds = new Set(picked.map(q => q.id));
      const leftover = src.filter(q => !usedIds.has(q.id));
      picked.push(...leftover.slice(0, count - picked.length));
    }
    return picked.slice(0, count);
  }

  const selectedMC    = pickFromPool(mcPool, targetMC);
  const selectedEssay = pickFromPool(essayPool, targetEssay);
  const combined = [...selectedMC, ...selectedEssay];

  // If still short, try any remaining questions
  if (combined.length < targetMC + targetEssay) {
    const usedIds = new Set(combined.map(q => q.id));
    const extra = pool.filter(q => !usedIds.has(q.id));
    combined.push(...extra.slice(0, targetMC + targetEssay - combined.length));
  }

  return combined.slice(0, targetMC + targetEssay);
}

/**
 * Validation backend – trả về mảng lỗi
 */
function validateExamData({ questions, targetMC, targetEssay, totalScore, durationMinutes }) {
  const errors = [];
  const total = targetMC + targetEssay;

  if (questions.length !== total) {
    errors.push({
      code: 'QUESTION_COUNT_MISMATCH',
      field: 'questions',
      message: `Yêu cầu ${total} câu (${targetMC} TN + ${targetEssay} TL) nhưng chỉ chọn được ${questions.length} câu.`,
      required: total,
      actual: questions.length,
    });
  }

  const ids = questions.map(q => q.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length) {
    errors.push({ code: 'DUPLICATE_QUESTION_IDS', field: 'questions', message: `Có ${dupIds.length} ID câu hỏi bị trùng: ${dupIds.slice(0,5).join(', ')}` });
  }

  if (!totalScore || Number(totalScore) <= 0) {
    errors.push({ code: 'INVALID_TOTAL_SCORE', field: 'totalScore', message: 'Tổng điểm phải lớn hơn 0.' });
  }

  if (!durationMinutes || Number(durationMinutes) <= 0) {
    errors.push({ code: 'INVALID_DURATION', field: 'durationMinutes', message: 'Thời gian làm bài phải lớn hơn 0 phút.' });
  }

  const mcActual    = questions.filter(q => q.type === 'multipleChoice' || (Array.isArray(q.choices) && q.choices.length >= 2)).length;
  const essayActual = questions.length - mcActual;
  if (targetMC > 0 && mcActual !== targetMC) {
    errors.push({ code: 'MC_COUNT_MISMATCH', field: 'questionTypes.multipleChoice', message: `Cần ${targetMC} câu trắc nghiệm, thực tế ${mcActual}.`, required: targetMC, actual: mcActual });
  }
  if (targetEssay > 0 && essayActual !== targetEssay) {
    errors.push({ code: 'ESSAY_COUNT_MISMATCH', field: 'questionTypes.essay', message: `Cần ${targetEssay} câu tự luận, thực tế ${essayActual}.`, required: targetEssay, actual: essayActual });
  }

  return errors;
}

// seeded shuffle – stable across calls with same seed
function seededShuffle(arr, seed) {
  const out = [...arr];
  let v = seed;
  for (let i = out.length - 1; i > 0; i--) {
    v = (v * 9301 + 49297) % 233280;
    const j = Math.floor((v / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── GET /api/exams ────────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('teacher', 'admin', 'student'), async (req, res) => {
  try {
    const { status, subject, page = 1, limit = 100 } = req.query;
    const conds = [];
    const vals  = [];
    let idx = 1;
    if (status)  { conds.push(`workflow_status = $${idx++}`); vals.push(status); }
    if (subject) { conds.push(`subject = $${idx++}`); vals.push(subject); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const countRes = await query(`SELECT COUNT(*) FROM exams ${where}`, vals);
    vals.push(Number(limit), (Number(page) - 1) * Number(limit));
    const result = await query(
      `SELECT * FROM exams ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      vals
    );
    res.json({ data: result.rows.map(mapDbExamRow), total: Number(countRes.rows[0].count) });
  } catch (err) {
    console.error('GET /exams error:', err.message);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách đề thi.' });
  }
});

// ─── GET /api/exams/:id ────────────────────────────────────────────────────────
router.get('/:id', authenticate, requireRole('teacher', 'admin', 'student'), async (req, res) => {
  try {
    const examRes = await query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    if (!examRes.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });

    const exam = mapDbExamRow(examRes.rows[0]);

    // Load questions from exam_questions junction table (authoritative)
    const eqRes = await query(
      `SELECT q.*, eq.position
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.position`,
      [req.params.id]
    );

    let examQuestions = eqRes.rows.map(r => {
      const q = mapDbQuestion(r);
      return q;
    });

    const rawQuestionIds = normalizeIds(exam.questionIds || exam.question_ids);
    if (!examQuestions.length && rawQuestionIds.length) {
      examQuestions = rawQuestionIds.map((id, index) => buildLegacyQuestionFallback(id, index, exam.subject));
    }

    const isStudent = req.user?.role === 'student';
    if (isStudent) {
      examQuestions = examQuestions.map(q => {
        const safe = { ...q };
        delete safe.answer;
        delete safe.answer_index;
        delete safe.answerText;
        delete safe.sourceEvidence;
        return safe;
      });
    }

    res.json({ ...exam, questions: examQuestions });
  } catch (err) {
    console.error('GET /exams/:id error:', err.message);
    res.status(500).json({ message: 'Lỗi khi lấy chi tiết đề thi.' });
  }
});

// ─── POST /api/exams/generate ─────────────────────────────────────────────────
router.post('/generate', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  const {
    title, subject,
    questionIds,
    questionTypes = {},
    difficultyDistribution = { easy: 30, medium: 50, hard: 20 },
    durationMinutes = 45,
    totalScore = 10,
    shuffleQuestions = false,
    ownerName = '', department = '', examType = 'Giữa kỳ',
    securityLevel = 'restricted', approver = '',
    academicYear = '2024-2025', semester = '1',
    faculty = '', examCode = '101',
    examDate = new Date().toISOString().slice(0, 10),
    status = 'draft',
    workflowStatus = 'draft',
    document = null,
    rubric = null,
  } = req.body || {};

  const normalizedSubject = (subject || 'Kiến trúc cơ sở').trim();
  const normalizedTitle = (title || 'Đề thi mới').trim();
  const normalizedIds = Array.isArray(questionIds) ? questionIds.filter(Boolean) : [];

  if (!normalizedTitle) return res.status(400).json({ code: 'MISSING_TITLE', message: 'Tên đề thi là bắt buộc.' });

  let targetMC = Math.max(0, Number(questionTypes.multipleChoice || 0));
  let targetEssay = Math.max(0, Number(questionTypes.essay || 0));

  if (!targetMC && !targetEssay && normalizedIds.length) {
    targetMC = normalizedIds.length;
    targetEssay = 0;
  }

  const targetTotal = targetMC + targetEssay;
  if (targetTotal === 0) {
    return res.status(400).json({ code: 'MISSING_QUESTION_COUNT', message: 'Phải chỉ định số câu trắc nghiệm hoặc tự luận.' });
  }

  let poolResult = { rows: [] };
  const validUuidIds = normalizedIds.filter(isUuidLike);
  const legacyIds = normalizedIds.filter(id => !isUuidLike(id));

  if (document && (!validUuidIds.length || legacyIds.length)) {
    return res.status(422).json({ code: 'DOCUMENT_QUESTIONS_REQUIRED', message: 'Đề tạo từ tài liệu chỉ nhận các câu hỏi đã được lọc và lưu từ chính tài liệu đó.' });
  }

  if (validUuidIds.length) {
    poolResult = await query('SELECT * FROM questions WHERE id = ANY($1::uuid[])', [validUuidIds]);
  }

  const candidatePool = poolResult.rows.map(mapDbQuestion);
  let selectedQuestions = selectQuestions(candidatePool, targetMC, targetEssay, {
    easy: Number(difficultyDistribution.easy || 30),
    medium: Number(difficultyDistribution.medium || 50),
    hard: Number(difficultyDistribution.hard || 20),
  });

  if (!selectedQuestions.length && normalizedIds.length && !document) {
    selectedQuestions = normalizedIds.map((id, index) => buildLegacyQuestionFallback(id, index, normalizedSubject));
  }

  if (document) {
    const selectedMC = selectedQuestions.filter(q => q.type === 'multipleChoice' || (Array.isArray(q.choices) && q.choices.length >= 2)).length;
    const selectedEssay = selectedQuestions.length - selectedMC;
    if (selectedQuestions.length !== targetTotal || selectedMC !== targetMC || selectedEssay !== targetEssay) {
      return res.status(422).json({
        code: 'DOCUMENT_QUESTION_MATRIX_MISMATCH',
        message: `Tài liệu không có đủ câu hỏi phù hợp ma trận (${selectedMC} trắc nghiệm, ${selectedEssay} tự luận). Hãy phân tích lại hoặc điều chỉnh số câu.`,
      });
    }
  }

  const validationErrors = validateExamData({
    questions: selectedQuestions,
    targetMC,
    targetEssay,
    totalScore,
    durationMinutes,
  });

  const warnings = [];
  if (selectedQuestions.length < targetTotal && normalizedIds.length) {
    warnings.push({ code: 'LEGACY_QUESTION_FALLBACK', field: 'questionIds', message: `Chỉ có ${selectedQuestions.length}/${targetTotal} câu được khớp với dữ liệu hiện có. Các ID legacy được giữ nguyên trên bản nháp.` });
  }
  if (validationErrors.some(e => e.code === 'QUESTION_COUNT_MISMATCH')) {
    warnings.push(...validationErrors.filter(e => e.code === 'QUESTION_COUNT_MISMATCH'));
  }

  const blockingErrors = validationErrors.filter(e =>
    ['DUPLICATE_QUESTION_IDS', 'INVALID_TOTAL_SCORE', 'INVALID_DURATION'].includes(e.code)
  );
  if (blockingErrors.length) {
    return res.status(422).json({ code: 'VALIDATION_FAILED', errors: blockingErrors });
  }

  const isMultipleChoice = q => q.type === 'multipleChoice' || (Array.isArray(q.choices) && q.choices.length >= 2);
  const actualMC = selectedQuestions.filter(isMultipleChoice).length;
  const actualEssay = selectedQuestions.length - actualMC;

  const diffAlloc = allocateByDifficulty(selectedQuestions.length, {
    easy: Number(difficultyDistribution.easy || 30),
    medium: Number(difficultyDistribution.medium || 50),
    hard: Number(difficultyDistribution.hard || 20),
  });

  const metadata = {
    questionTypes: { multipleChoice: actualMC, essay: actualEssay },
    difficultyDistribution,
    difficultyActual: diffAlloc,
    durationMinutes: Number(durationMinutes),
    totalScore: Number(totalScore),
    shuffleQuestions: Boolean(shuffleQuestions),
    ownerName, department, examType, securityLevel, approver,
    academicYear, semester, faculty, examCode, examDate,
    document: document || null,
    rubric: rubric || null,
    generatedAt: new Date().toISOString(),
    generatedBy: req.user?.id || null,
  };

  const finalStatus = workflowStatus || status || 'draft';
  const selectedQuestionIds = selectedQuestions.map(q => q.id);

  const client = await pool.connect();
  let savedExam;
  try {
    await client.query('BEGIN');

    const examInsert = await client.query(
      `INSERT INTO exams (title, subject, status, workflow_status, question_ids, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        normalizedTitle, normalizedSubject,
        finalStatus, finalStatus,
        JSON.stringify(normalizedIds.length ? normalizedIds : selectedQuestionIds),
        JSON.stringify(metadata),
        req.user?.id || null,
      ]
    );
    savedExam = examInsert.rows[0];

    if (selectedQuestions.length) {
      const validExamQuestionRows = selectedQuestions.filter(q => isUuidLike(q.id));
      if (validExamQuestionRows.length) {
        const eqValues = validExamQuestionRows
          .map((q, i) => `('${savedExam.id}', '${q.id}', ${i + 1})`)
          .join(', ');
        await client.query(
          `INSERT INTO exam_questions (exam_id, question_id, position) VALUES ${eqValues}
           ON CONFLICT (exam_id, question_id) DO UPDATE SET position = EXCLUDED.position`
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction failed in generate exam:', err.message);
    return res.status(500).json({ message: 'Lỗi khi lưu đề thi vào cơ sở dữ liệu. Đã rollback.', detail: err.message });
  } finally {
    client.release();
  }

  const responseExam = mapDbExamRow(savedExam);
  res.status(201).json({
    ...responseExam,
    questionIds: normalizedIds.length ? normalizedIds : selectedQuestionIds,
    questions: selectedQuestions,
    blueprint: {
      targetTotal,
      actualTotal: selectedQuestions.length,
      targetMC, actualMC,
      targetEssay, actualEssay,
      difficultyActual: diffAlloc,
      source: document?.filename || 'Ngân hàng câu hỏi',
    },
    warnings,
    message: warnings.length
      ? `Đã tạo bản nháp với ${selectedQuestions.length}/${targetTotal} câu. Có cảnh báo dữ liệu legacy và cần kiểm tra lại.`
      : `Đã tạo bản nháp đề thi với đúng ${selectedQuestions.length} câu (${actualMC} TN + ${actualEssay} TL).`,
  });
});

// ─── PUT /api/exams/:id ────────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await query('SELECT * FROM exams WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });

    const cur = mapDbExamRow(existing.rows[0]);
    const body = req.body || {};

    const newStatus = body.workflowStatus || body.status || cur.workflowStatus;
    const newMeta   = { ...cur, ...body }; // merge all fields

    const metadata = {
      questionTypes:        newMeta.questionTypes        || cur.questionTypes,
      difficultyDistribution: newMeta.difficultyDistribution || cur.difficultyDistribution,
      durationMinutes:      Number(newMeta.durationMinutes ?? cur.durationMinutes),
      totalScore:           Number(newMeta.totalScore    ?? cur.totalScore),
      shuffleQuestions:     Boolean(newMeta.shuffleQuestions ?? cur.shuffleQuestions),
      ownerName:            newMeta.ownerName    || cur.ownerName,
      department:           newMeta.department   || cur.department,
      examType:             newMeta.examType     || cur.examType,
      securityLevel:        newMeta.securityLevel|| cur.securityLevel,
      approver:             newMeta.approver     || cur.approver,
      academicYear:         newMeta.academicYear || cur.academicYear,
      semester:             newMeta.semester     || cur.semester,
      faculty:              newMeta.faculty      || cur.faculty,
      examCode:             newMeta.examCode     || cur.examCode,
      examDate:             newMeta.examDate     || cur.examDate,
      document:             newMeta.document     || cur.document,
      rubric:               newMeta.rubric       || cur.rubric,
    };

    const result = await query(
      `UPDATE exams SET
         title = $1, subject = $2, status = $3, workflow_status = $4,
         question_ids = $5, metadata = $6, updated_at = now()
       WHERE id = $7 RETURNING *`,
      [
        newMeta.title   || cur.title,
        newMeta.subject || cur.subject,
        newStatus, newStatus,
        JSON.stringify(normalizeIds(body.questionIds || cur.questionIds)),
        JSON.stringify(metadata),
        id,
      ]
    );
    res.json(mapDbExamRow(result.rows[0]));
  } catch (err) {
    console.error('PUT /exams/:id error:', err.message);
    res.status(500).json({ message: 'Lỗi khi cập nhật đề thi.' });
  }
});

// ─── DELETE /api/exams/:id ────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const result = await query('DELETE FROM exams WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    res.status(204).send();
  } catch (err) {
    console.error('DELETE /exams/:id error:', err.message);
    res.status(500).json({ message: 'Lỗi khi xóa đề thi.' });
  }
});

// ─── POST /api/exams/:id/validate ─────────────────────────────────────────────
router.post('/:id/validate', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const examRes = await query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    if (!examRes.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    const exam = mapDbExamRow(examRes.rows[0]);

    const eqRes = await query(
      'SELECT q.* FROM exam_questions eq JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = $1 ORDER BY eq.position',
      [req.params.id]
    );
    const questions = eqRes.rows.map(mapDbQuestion);

    const errors = validateExamData({
      questions,
      targetMC:    exam.questionTypes?.multipleChoice || 0,
      targetEssay: exam.questionTypes?.essay || 0,
      totalScore:  exam.totalScore,
      durationMinutes: exam.durationMinutes,
    });

    // Extra: verify DB read-back
    const dbCheck = await query('SELECT id, question_ids FROM exams WHERE id = $1', [req.params.id]);
    const dbIds   = normalizeIds(dbCheck.rows[0]?.question_ids);
    if (dbIds.length !== questions.length) {
      errors.push({ code: 'DB_SYNC_MISMATCH', field: 'exam_questions', message: `question_ids trong exams (${dbIds.length}) không khớp với exam_questions (${questions.length}).` });
    }

    res.json({
      examId: req.params.id,
      valid: errors.length === 0,
      errors,
      summary: {
        totalQuestions:    questions.length,
        multipleChoice:    questions.filter(q => q.type === 'multipleChoice').length,
        essay:             questions.filter(q => q.type !== 'multipleChoice').length,
        totalScore:        exam.totalScore,
        durationMinutes:   exam.durationMinutes,
        workflowStatus:    exam.workflowStatus,
      },
    });
  } catch (err) {
    console.error('POST /exams/:id/validate error:', err.message);
    res.status(500).json({ message: 'Lỗi khi kiểm tra đề thi.' });
  }
});

// ─── POST /api/exams/:id/variants ─────────────────────────────────────────────
router.post('/:id/variants', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const examRes = await query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    if (!examRes.rows.length) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    const exam = mapDbExamRow(examRes.rows[0]);

    // Load questions from exam_questions (authoritative)
    const eqRes = await query(
      'SELECT q.* FROM exam_questions eq JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = $1 ORDER BY eq.position',
      [req.params.id]
    );
    let sourceQuestions = eqRes.rows.map(mapDbQuestion);

    const rawQuestionIds = normalizeIds(exam.questionIds || exam.question_ids);
    if (!sourceQuestions.length && rawQuestionIds.length) {
      sourceQuestions = rawQuestionIds.map((id, index) => buildLegacyQuestionFallback(id, index, exam.subject));
    }

    if (!sourceQuestions.length) {
      return res.status(400).json({ message: 'Đề thi chưa có câu hỏi. Không thể tạo mã đề.' });
    }

    const count = Math.min(Math.max(Number(req.body?.count || 2), 1), 10);

    const variants = Array.from({ length: count }, (_, variantIdx) => {
      const variantCode = `M${String.fromCharCode(65 + variantIdx)}`; // MA, MB, MC…

      let shuffledQuestions = seededShuffle(sourceQuestions, variantIdx * 997 + 17);
      if (variantIdx > 0 && shuffledQuestions.every((q, i) => q.id === sourceQuestions[i]?.id)) {
        shuffledQuestions = [...shuffledQuestions.slice(1), shuffledQuestions[0]];
      }

      // For each MC question: shuffle choices + remap answer_index
      const variantQuestions = shuffledQuestions.map(q => {
        if (q.type !== 'multipleChoice' || !Array.isArray(q.choices) || !q.choices.length) {
          return { ...q };
        }
        const originalChoices = [...q.choices];
        const originalAnswer  = q.answer_index ?? 0;
        const correctText     = originalChoices[originalAnswer];

        const shuffledChoices = seededShuffle(originalChoices, variantIdx * 31 + q.id.length);
        const newAnswerIndex  = shuffledChoices.findIndex(c => c === correctText);

        return {
          ...q,
          choices: shuffledChoices,
          answer_index: newAnswerIndex >= 0 ? newAnswerIndex : 0,
          answer: newAnswerIndex >= 0 ? newAnswerIndex : 0,
          // Keep original for reference
          _originalAnswer: originalAnswer,
        };
      });

      // Build answer key for this variant
      const answerKey = variantQuestions.map((q, pos) => ({
        position: pos + 1,
        questionId: q.id,
        type: q.type,
        answer: q.type === 'multipleChoice' ? q.answer_index : null,
        answerLabel: q.type === 'multipleChoice'
          ? ['A', 'B', 'C', 'D', 'E'][q.answer_index] || String(q.answer_index + 1)
          : null,
      }));

      return {
        code:      variantCode,
        examId:    exam.id,
        examTitle: exam.title,
        subject:   exam.subject,
        questions: variantQuestions,
        answerKey,
        meta: {
          durationMinutes: exam.durationMinutes,
          totalScore:      exam.totalScore,
          examDate:        exam.examDate,
          academicYear:    exam.academicYear,
          semester:        exam.semester,
          faculty:         exam.faculty,
          examCode:        `${exam.examCode}-${variantCode}`,
          ownerName:       exam.ownerName,
          department:      exam.department,
          approver:        exam.approver,
          examType:        exam.examType,
        },
      };
    });

    res.status(201).json({
      examId: exam.id,
      variantCount: count,
      variants,
      message: `Đã tạo ${count} mã đề. Đáp án đã được ánh xạ lại theo thứ tự câu và phương án của từng mã đề.`,
    });
  } catch (err) {
    console.error('POST /exams/:id/variants error:', err.message);
    res.status(500).json({ message: 'Lỗi khi tạo mã đề.' });
  }
});

module.exports = router;
