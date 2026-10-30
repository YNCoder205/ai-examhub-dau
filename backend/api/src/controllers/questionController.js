const { query } = require('../config/db');

async function getQuestions(req, res) {
  try {
    const { subject, difficulty } = req.query;
    let sql = 'SELECT id, subject, content as text, choices, answer_index as answer, difficulty, type FROM questions WHERE 1=1';
    const params = [];

    if (subject) {
      params.push(subject);
      sql += ` AND subject = $${params.length}`;
    }
    if (difficulty) {
      params.push(difficulty);
      sql += ` AND difficulty = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    
    // Map data for frontend
    const data = result.rows.map(row => ({
      id: row.id,
      text: row.text,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type || (row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
      choices: row.choices,
      answer: row.answer
    }));

    res.json({ data, total: data.length });
  } catch (err) {
    console.error('Error fetching questions:', err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách câu hỏi.' });
  }
}

async function createQuestion(req, res) {
  try {
    const { text, subject, difficulty = 'medium', choices = [], answer = 0 } = req.body || {};
    
    if (!text || !subject || !Array.isArray(choices)) {
      return res.status(400).json({ message: 'text, subject và choices là bắt buộc.' });
    }

    const type = choices.length >= 2 ? 'multipleChoice' : 'essay';
    const userId = req.user.id;

    const result = await query(
      `INSERT INTO questions (subject, content, choices, answer_index, difficulty, type, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [subject, text, JSON.stringify(choices), answer, difficulty, type, userId]
    );

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      text: row.content,
      subject: row.subject,
      difficulty: row.difficulty,
      type: row.type,
      choices: row.choices,
      answer: row.answer_index
    });
  } catch (err) {
    console.error('Error creating question:', err);
    res.status(500).json({ message: 'Lỗi khi tạo câu hỏi.' });
  }
}

module.exports = { getQuestions, createQuestion };
