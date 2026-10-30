const { query } = require('../config/db');

async function uploadDocument(req, res) {
  const { filename, size, mimeType } = req.body || {};
  if (!filename) return res.status(400).json({ message: 'filename là bắt buộc.' });
  
  // Trả về mock ID cho file (thực tế sẽ lưu vào minio/S3 hoặc disk)
  res.status(202).json({ 
    id: `doc-${Date.now()}`, 
    filename, 
    size: Number(size || 0), 
    mimeType: mimeType || 'application/octet-stream', 
    status: 'ready', 
    message: 'Tài liệu đã sẵn sàng để AI phân tích.' 
  });
}

async function analyzeDocument(req, res) {
  try {
    const { documentId, subject, requestedCount = 10, content = '' } = req.body || {};
    if (!documentId) return res.status(400).json({ message: 'documentId là bắt buộc.' });

    // Mock AI text extraction logic
    const parsed = String(content).split(/\r?\n/).reduce((items, line) => {
      const questionStart = line.match(/^\s*(?:câu\s*)?(\d+)[.)\-:]\s*(.*)$/i);
      if (questionStart) items.push({ number: questionStart[1], text: questionStart[2], choices: [] });
      else if (items.length) {
        const choice = line.match(/^\s*([A-D])[.)\-:]\s*(.*)$/i);
        if (choice) items[items.length - 1].choices.push(choice[2]);
        else if (line.trim()) items[items.length - 1].text += ` ${line.trim()}`;
      }
      return items;
    }, []);

    const scannedQuestions = parsed.slice(0, Number(requestedCount)).map(item => ({
      text: item.text,
      subject: subject || 'Chưa phân loại',
      difficulty: 'medium',
      type: item.choices.length >= 2 ? 'multipleChoice' : 'essay',
      choices: item.choices,
      answer: 0,
    }));

    const userId = req.user.id;
    const insertedQuestions = [];

    // Bulk insert into database
    for (const q of scannedQuestions) {
      const result = await query(
        `INSERT INTO questions (subject, content, choices, answer_index, difficulty, type, created_by) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [q.subject, q.text, JSON.stringify(q.choices), q.answer, q.difficulty, q.type, userId]
      );
      
      const row = result.rows[0];
      insertedQuestions.push({
        id: row.id,
        text: row.content,
        subject: row.subject,
        difficulty: row.difficulty,
        type: row.type,
        choices: row.choices,
        answer: row.answer_index
      });
    }

    // Nếu không quét được, fallback lấy vài câu trong thư viện (để test Frontend)
    let candidates = insertedQuestions;
    if (candidates.length === 0) {
      const fallback = await query(`SELECT * FROM questions WHERE subject = $1 LIMIT $2`, [subject || 'Kiến trúc cơ sở', requestedCount]);
      candidates = fallback.rows.map(row => ({
        id: row.id,
        text: row.content,
        subject: row.subject,
        difficulty: row.difficulty,
        type: row.type || (row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
        choices: row.choices,
        answer: row.answer_index
      }));
    }

    const multipleChoiceCount = candidates.filter(q => q.type === 'multipleChoice').length;
    const essayCount = candidates.length - multipleChoiceCount;

    res.json({ 
      documentId, 
      status: 'analyzed', 
      candidates, 
      selectedCount: candidates.length, 
      questionTypes: { multipleChoice: multipleChoiceCount, essay: essayCount }, 
      confidence: insertedQuestions.length ? 0.9 : 0.7, 
      summary: `AI đã quét ${candidates.length} câu: ${multipleChoiceCount} trắc nghiệm và ${essayCount} tự luận.` 
    });
  } catch (err) {
    console.error('Error analyzing document:', err);
    res.status(500).json({ message: 'Lỗi khi phân tích tài liệu.' });
  }
}

module.exports = { uploadDocument, analyzeDocument };
