const { pool, query } = require('../config/db');

async function generateExam(req, res) {
  const client = await pool.connect();
  try {
    const {
      title = 'Đề thi mới', subject = 'Kiến trúc cơ sở', questionCount,
      questionIds, document, questionTypes = { multipleChoice: 0, essay: 0 },
      difficultyDistribution = { easy: 40, medium: 40, hard: 20 },
    } = req.body || {};

    const userId = req.user.id;

    let selectedIds = questionIds || [];

    // Nếu không truyền cụ thể IDs, tự động random chọn từ CSDL
    if (!selectedIds.length) {
      const requestedTotal = Number(questionCount || Number(questionTypes.multipleChoice || 0) + Number(questionTypes.essay || 0) || 10);
      const randomQuestions = await client.query(
        'SELECT id FROM questions WHERE subject = $1 ORDER BY RANDOM() LIMIT $2', 
        [subject, requestedTotal]
      );
      selectedIds = randomQuestions.rows.map(r => r.id);
    }

    if (!selectedIds.length) {
      return res.status(400).json({ message: 'Không tìm thấy câu hỏi phù hợp.' });
    }

    const metadata = {
      questionTypes,
      difficultyDistribution,
      document: document || null
    };

    await client.query('BEGIN');

    // Tạo đề thi
    const examResult = await client.query(
      `INSERT INTO exams (title, subject, status, created_by, metadata) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, title, subject, status, created_at, metadata`,
      [title, subject, 'draft', userId, JSON.stringify(metadata)]
    );

    const exam = examResult.rows[0];

    // Thêm các câu hỏi vào exam_questions
    for (let i = 0; i < selectedIds.length; i++) {
      await client.query(
        `INSERT INTO exam_questions (exam_id, question_id, position) VALUES ($1, $2, $3)`,
        [exam.id, selectedIds[i], i + 1]
      );
    }

    await client.query('COMMIT');

    // Lấy lại danh sách câu hỏi để trả về (đúng thứ tự)
    const questionsResult = await client.query(
      `SELECT q.id, q.subject, q.content as text, q.choices, q.answer_index as answer, q.difficulty, q.type 
       FROM questions q
       JOIN exam_questions eq ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.position`,
      [exam.id]
    );

    const questions = questionsResult.rows.map(row => ({
      id: row.id,
      text: row.text,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type || (row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
      choices: row.choices,
      answer: row.answer
    }));

    res.status(201).json({
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      status: exam.status,
      questionTypes: exam.metadata.questionTypes,
      difficultyDistribution: exam.metadata.difficultyDistribution,
      questionIds: selectedIds,
      createdAt: exam.created_at,
      blueprint: {
        total: selectedIds.length,
        generated: selectedIds.length,
        source: exam.metadata.document?.filename || 'Ngân hàng câu hỏi'
      },
      questions
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error generating exam:', err);
    res.status(500).json({ message: 'Lỗi khi tạo đề thi.' });
  } finally {
    client.release();
  }
}

async function getExams(req, res) {
  try {
    const result = await query(
      `SELECT e.id, e.title, e.subject, e.status, e.created_at, e.metadata, 
              COALESCE(json_agg(eq.question_id ORDER BY eq.position) FILTER (WHERE eq.question_id IS NOT NULL), '[]') as "questionIds"
       FROM exams e
       LEFT JOIN exam_questions eq ON e.id = eq.exam_id
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    );

    const data = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      status: row.status,
      questionIds: row.questionIds,
      questionTypes: row.metadata.questionTypes,
      difficultyDistribution: row.metadata.difficultyDistribution,
      createdAt: row.created_at
    }));

    res.json({ data, total: data.length });
  } catch (err) {
    console.error('Error fetching exams:', err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách đề thi.' });
  }
}

async function getExamById(req, res) {
  try {
    const examResult = await query(
      `SELECT e.id, e.title, e.subject, e.status, e.created_at, e.metadata, 
              COALESCE(json_agg(eq.question_id ORDER BY eq.position) FILTER (WHERE eq.question_id IS NOT NULL), '[]') as "questionIds"
       FROM exams e
       LEFT JOIN exam_questions eq ON e.id = eq.exam_id
       WHERE e.id = $1
       GROUP BY e.id`,
      [req.params.id]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    }

    const examRow = examResult.rows[0];

    const questionsResult = await query(
      `SELECT q.id, q.subject, q.content as text, q.choices, q.answer_index as answer, q.difficulty, q.type 
       FROM questions q
       JOIN exam_questions eq ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.position`,
      [req.params.id]
    );

    const questions = questionsResult.rows.map(row => ({
      id: row.id,
      text: row.text,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type || (row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
      choices: row.choices,
      answer: row.answer
    }));

    res.json({
      id: examRow.id,
      title: examRow.title,
      subject: examRow.subject,
      status: examRow.status,
      questionIds: examRow.questionIds,
      questionTypes: examRow.metadata.questionTypes,
      difficultyDistribution: examRow.metadata.difficultyDistribution,
      createdAt: examRow.created_at,
      questions
    });
  } catch (err) {
    console.error('Error fetching exam:', err);
    res.status(500).json({ message: 'Lỗi khi tải đề thi.' });
  }
}

async function updateExam(req, res) {
  try {
    const { title, subject, status, questionTypes, difficultyDistribution, document, questionIds } = req.body;
    
    // Validate exam exists
    const check = await query('SELECT id, metadata FROM exams WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });

    const existingMetadata = check.rows[0].metadata;
    const metadata = {
      ...existingMetadata,
      questionTypes: questionTypes || existingMetadata.questionTypes,
      difficultyDistribution: difficultyDistribution || existingMetadata.difficultyDistribution,
      document: document !== undefined ? document : existingMetadata.document
    };

    const result = await query(
      `UPDATE exams 
       SET title = COALESCE($1, title), 
           subject = COALESCE($2, subject), 
           status = COALESCE($3, status),
           metadata = $4
       WHERE id = $5 RETURNING *`,
      [title, subject, status, JSON.stringify(metadata), req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating exam:', err);
    res.status(500).json({ message: 'Lỗi khi cập nhật đề thi.' });
  }
}

async function deleteExam(req, res) {
  try {
    const result = await query('DELETE FROM exams WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting exam:', err);
    res.status(500).json({ message: 'Lỗi khi xóa đề thi.' });
  }
}

// In-memory variant generation (no db save needed for variants according to requirements)
async function createExamVariants(req, res) {
  try {
    const examResult = await query(
      `SELECT e.id, e.title
       FROM exams e
       WHERE e.id = $1`,
      [req.params.id]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đề thi.' });
    }

    const exam = examResult.rows[0];
    const count = Math.min(Math.max(Number(req.body?.count || 2), 1), 20);

    const questionsResult = await query(
      `SELECT q.id, q.subject, q.content as text, q.choices, q.answer_index as answer, q.difficulty, q.type 
       FROM questions q
       JOIN exam_questions eq ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.position`,
      [req.params.id]
    );

    const sourceQuestions = questionsResult.rows;

    const seededShuffle = (items, seed) => {
      const output = [...items];
      let value = seed;
      for (let index = output.length - 1; index > 0; index -= 1) {
        value = (value * 9301 + 49297) % 233280;
        const swapIndex = Math.floor((value / 233280) * (index + 1));
        [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
      }
      return output;
    };

    const variants = Array.from({ length: count }, (_, variantIndex) => {
      const variantCode = \`M\${String.fromCharCode(65 + variantIndex)}\`;
      let orderedQuestions = seededShuffle(sourceQuestions, variantIndex + 17);
      if (variantIndex > 0 && orderedQuestions.every((q, i) => q.id === sourceQuestions[i]?.id)) {
        orderedQuestions = [...orderedQuestions.slice(1), orderedQuestions[0]];
      }
      
      const variantQuestions = orderedQuestions.map((q) => ({
        id: q.id,
        text: q.text,
        subject: q.subject,
        difficulty: q.difficulty,
        type: q.type || (q.choices.length >= 2 ? 'multipleChoice' : 'essay'),
        choices: seededShuffle(q.choices, variantIndex + q.id.length + 3),
        answer: q.answer
      }));

      return { 
        id: \`\${exam.id}-\${variantCode}\`, 
        code: variantCode, 
        examId: exam.id, 
        title: exam.title, 
        questions: variantQuestions, 
        createdAt: new Date().toISOString() 
      };
    });

    res.status(201).json({ examId: exam.id, variants });
  } catch (err) {
    console.error('Error generating variants:', err);
    res.status(500).json({ message: 'Lỗi tạo mã đề.' });
  }
}

module.exports = { generateExam, getExams, getExamById, updateExam, deleteExam, createExamVariants };
