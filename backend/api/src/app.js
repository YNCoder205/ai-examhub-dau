require('dotenv').config();

const { randomInt, randomUUID } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { createWorker } = require('tesseract.js');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const questionRoutes = require('./routes/questionRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const examRoutes = require('./routes/examRoutes');
const examRoomRoutes = require('./routes/examRoomRoutes');
const classroomRoutes = require('./routes/classroomRoutes');
const { authenticate, requireRole } = require('./middlewares/authMiddleware');
const { query } = require('./config/db');

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const configuredCorsOrigin = process.env.CORS_ORIGIN;
const corsOrigin = !configuredCorsOrigin || configuredCorsOrigin.toLowerCase() === 'true'
  ? true
  : configuredCorsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));

// ── Health check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ai-examhub-api', timestamp: new Date().toISOString() }));

// ── Routes ──
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/questions',   questionRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/analytics',   analyticsRoutes);
app.use('/api/exams',       examRoutes);   // DB-backed, transaction, validate, variants
app.use('/api/exam-rooms',  examRoomRoutes);
app.use('/api/classrooms', classroomRoutes);


// ══════════════════════════════════════════
//  IN-MEMORY DATA (will be migrated to DB later)
// ══════════════════════════════════════════
const questions = [
  { id: 'q-001', text: 'Trong kiến trúc, công năng của mặt bằng là gì?', subject: 'Kiến trúc cơ sở', difficulty: 'easy', type: 'multipleChoice', choices: ['Tổ chức không gian', 'Trang trí mặt đứng', 'Tính toán kết cấu', 'Lập dự toán'], answer: 0 },
  { id: 'q-002', text: 'Phân tích các yếu tố ảnh hưởng trực tiếp đến chiếu sáng tự nhiên trong công trình.', subject: 'Môi trường', difficulty: 'medium', type: 'essay', choices: [], answer: 0 },
  { id: 'q-003', text: 'Tỷ lệ bản vẽ được dùng để làm gì?', subject: 'Đồ họa kiến trúc', difficulty: 'easy', type: 'multipleChoice', choices: ['Biểu diễn kích thước thu nhỏ', 'Xác định tải trọng', 'Đo độ ẩm', 'Tính giá vật liệu'], answer: 0 },
];
const exams = [];
const examRooms = [];
const submissions = [];
const results = [];
const rubrics = [];

const isUuid = (value = '') => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const nextId = (prefix, collection) => `${prefix}-${String(collection.length + 1).padStart(3, '0')}`;

// ── DB helpers for questions ──
function mapDbQuestionRow(row) {
  return {
    id: row.id,
    text: row.content,
    subject: row.subject,
    difficulty: row.difficulty,
    type: row.type || (Array.isArray(row.choices) && row.choices.length >= 2 ? 'multipleChoice' : 'essay'),
    choices: Array.isArray(row.choices) ? row.choices : [],
    answer: row.answer_index ?? 0,
    answerText: row.answer_text || '',
    sourceEvidence: row.source_evidence || '',
    cognitiveLevel: row.cognitive_level || null,
    rubric: row.rubric || null,
  };
}

async function loadQuestionsFromDb() {
  try {
    const result = await query('SELECT * FROM questions ORDER BY created_at DESC');
    return result.rows.map(mapDbQuestionRow);
  } catch (err) {
    console.warn('DB question load failed, using in-memory:', err.message);
    return null;
  }
}

async function persistQuestion(q, userId) {
  try {
    const result = await query(
      `INSERT INTO questions (subject, content, choices, answer_index, answer_text, source_evidence, cognitive_level, rubric, difficulty, type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [q.subject, q.text, JSON.stringify(q.choices || []), q.answer ?? 0, q.answerText || null, q.sourceEvidence || null, q.cognitiveLevel || null, q.rubric ? JSON.stringify(q.rubric) : null, q.difficulty || 'medium', q.type || 'essay', userId || null]
    );
    return mapDbQuestionRow(result.rows[0]);
  } catch (err) {
    console.warn('DB question persist failed:', err.message);
    return null;
  }
}

async function seedQuestionsToDb() {
  for (const q of questions) {
    try {
      const existing = await query('SELECT id FROM questions WHERE content = $1 AND subject = $2 LIMIT 1', [q.text, q.subject]);
      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO questions (subject, content, choices, answer_index, difficulty, type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [q.subject, q.text, JSON.stringify(q.choices || []), q.answer ?? 0, q.difficulty || 'medium', q.type || 'essay']
        );
      }
    } catch { /* ignore duplicate */ }
  }
}
seedQuestionsToDb().catch(() => {});

async function ensureExamSchema() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS institutional_id VARCHAR(64);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS faculty VARCHAR(255);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cohort VARCHAR(64);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(128);`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_institutional_id ON users (institutional_id) WHERE institutional_id IS NOT NULL;`);
  await query(`
    CREATE TABLE IF NOT EXISTS exams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'draft',
      workflow_status VARCHAR(16) NOT NULL DEFAULT 'draft',
      question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(16) DEFAULT 'draft';`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_ids JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_text TEXT;`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_evidence TEXT;`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS cognitive_level VARCHAR(32);`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS rubric JSONB;`);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
    );
  `);
  await query(`ALTER TABLE exam_rooms ADD COLUMN IF NOT EXISTS access_code VARCHAR(8);`);
  await query(`ALTER TABLE exam_rooms ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`UPDATE exam_rooms SET access_code = upper(encode(gen_random_bytes(4), 'hex')) WHERE access_code IS NULL;`);
  await query(`UPDATE exam_rooms r SET created_by = e.created_by FROM exams e WHERE r.exam_id = e.id AND r.created_by IS NULL;`);
  await query(`ALTER TABLE exam_rooms ALTER COLUMN access_code SET NOT NULL;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_rooms_access_code ON exam_rooms(access_code);`);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_room_exams (
      room_id UUID NOT NULL REFERENCES exam_rooms(id) ON DELETE CASCADE,
      exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (room_id, exam_id),
      UNIQUE (room_id, position)
    );
  `);
  await query(`
    INSERT INTO exam_room_exams (room_id, exam_id, position)
    SELECT id, exam_id, 1 FROM exam_rooms
    ON CONFLICT (room_id, exam_id) DO NOTHING;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES exam_rooms(id) ON DELETE CASCADE,
      exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_set JSONB NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      marked_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_question INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deadline_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ,
      submission_id UUID UNIQUE REFERENCES submissions(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (room_id, student_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_attempt_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('tab_hidden')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_attempt_events_attempt_time ON exam_attempt_events (attempt_id, occurred_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS classroom_rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(160) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      mode VARCHAR(20) NOT NULL DEFAULT 'google_meet' CHECK (mode IN ('google_meet', 'direct')),
      meet_url TEXT,
      access_code VARCHAR(8) NOT NULL UNIQUE,
      status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
      admissions_open BOOLEAN NOT NULL DEFAULT true,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'google_meet';`);
  await query(`ALTER TABLE classroom_rooms ALTER COLUMN meet_url DROP NOT NULL;`);
  await query(`ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS admissions_open BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE classroom_rooms ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE classroom_rooms ALTER COLUMN status SET DEFAULT 'scheduled';`);
  await query(`ALTER TABLE classroom_rooms DROP CONSTRAINT IF EXISTS classroom_rooms_status_check;`);
  await query(`
    UPDATE classroom_rooms
    SET status = CASE status WHEN 'active' THEN 'scheduled' WHEN 'closed' THEN 'ended' ELSE status END
    WHERE status IN ('active', 'closed');
  `);
  await query(`ALTER TABLE classroom_rooms ADD CONSTRAINT classroom_rooms_status_check CHECK (status IN ('scheduled', 'live', 'ended'));`);
  await query(`
    CREATE TABLE IF NOT EXISTS classroom_members (
      classroom_id UUID NOT NULL REFERENCES classroom_rooms(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (classroom_id, student_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_classroom_rooms_owner ON classroom_rooms (created_by, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_classroom_members_student ON classroom_members (student_id, joined_at DESC);`);
}

function normalizeQuestionIds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mergeQuestionCollections(...collections) {
  const merged = [];
  const seen = new Set();

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const question of collection) {
      if (!question || !question.id || seen.has(question.id)) continue;
      seen.add(question.id);
      merged.push(question);
    }
  }

  return merged;
}

function mapDbExamRow(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    status: row.status,
    workflowStatus: row.workflow_status || row.status || 'draft',
    questionIds: normalizeQuestionIds(row.question_ids),
    document: metadata.document || null,
    questionTypes: metadata.questionTypes || { multipleChoice: 0, essay: 0 },
    difficultyDistribution: metadata.difficultyDistribution || { easy: 40, medium: 40, hard: 20 },
    durationMinutes: metadata.durationMinutes || 45,
    totalScore: metadata.totalScore || 10,
    shuffleQuestions: Boolean(metadata.shuffleQuestions),
    ownerName: metadata.ownerName || 'Người phụ trách',
    department: metadata.department || 'Ban kiểm định',
    examType: metadata.examType || 'Giữa kỳ',
    securityLevel: metadata.securityLevel || 'restricted',
    approver: metadata.approver || 'Phê duyệt nội bộ',
    academicYear: metadata.academicYear || '2024-2025',
    semester: metadata.semester || '1',
    faculty: metadata.faculty || 'Khoa Kiến trúc',
    examCode: metadata.examCode || '101',
    examDate: metadata.examDate || new Date().toISOString().slice(0, 10),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

async function getExamListFromDatabase() {
  try {
    const result = await query('SELECT * FROM exams ORDER BY created_at DESC');
    return result.rows.map(mapDbExamRow);
  } catch (error) {
    console.warn('Database exam lookup failed, using in-memory fallback:', error.message);
    return [];
  }
}

async function persistExamRecord(exam) {
  try {
    const examId = isUuid(exam.id) ? exam.id : randomUUID();
    const metadata = {
      questionTypes: exam.questionTypes || { multipleChoice: 0, essay: 0 },
      difficultyDistribution: exam.difficultyDistribution || { easy: 40, medium: 40, hard: 20 },
      durationMinutes: exam.durationMinutes || 45,
      totalScore: exam.totalScore || 10,
      shuffleQuestions: Boolean(exam.shuffleQuestions),
      ownerName: exam.ownerName || 'Người phụ trách',
      department: exam.department || 'Ban kiểm định',
      examType: exam.examType || 'Giữa kỳ',
      securityLevel: exam.securityLevel || 'restricted',
      approver: exam.approver || 'Phê duyệt nội bộ',
      academicYear: exam.academicYear || '2024-2025',
      semester: exam.semester || '1',
      faculty: exam.faculty || 'Khoa Kiến trúc',
      examCode: exam.examCode || '101',
      examDate: exam.examDate || new Date().toISOString().slice(0, 10),
      document: exam.document || null,
    };

    const result = await query(
      `INSERT INTO exams (id, title, subject, status, workflow_status, question_ids, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id)
       DO UPDATE SET title = EXCLUDED.title,
                    subject = EXCLUDED.subject,
                    status = EXCLUDED.status,
                    workflow_status = EXCLUDED.workflow_status,
                    question_ids = EXCLUDED.question_ids,
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
       RETURNING *;`,
      [examId, exam.title, exam.subject, exam.status || 'draft', exam.workflowStatus || exam.status || 'draft', JSON.stringify(exam.questionIds || []), JSON.stringify(metadata)]
    );

    const record = result.rows[0];
    return mapDbExamRow(record);
  } catch (error) {
    console.warn('Database persistence skipped for exam record:', error.message);
    return null;
  }
}

async function deleteExamRecordById(id) {
  try {
    await query('DELETE FROM exams WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.warn('Database delete skipped:', error.message);
    return false;
  }
}

async function updateExamRecordById(id, updates) {
  try {
    const fields = [];
    const values = [];
    let index = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'questionIds') {
        fields.push(`question_ids = $${index}`);
        values.push(JSON.stringify(value || []));
        index += 1;
        return;
      }
      if (key === 'workflowStatus') {
        fields.push(`workflow_status = $${index}`);
        values.push(value || 'draft');
        index += 1;
        return;
      }
      if (key === 'status') {
        fields.push(`status = $${index}`);
        values.push(value || 'draft');
        index += 1;
        return;
      }
      if (key === 'metadata') {
        fields.push(`metadata = $${index}`);
        values.push(JSON.stringify(value || {}));
        index += 1;
        return;
      }
      if (key === 'title' || key === 'subject') {
        fields.push(`${key} = $${index}`);
        values.push(value || '');
        index += 1;
      }
    });

    if (!fields.length) return null;
    values.push(id);
    const result = await query(`UPDATE exams SET ${fields.join(', ')}, updated_at = now() WHERE id = $${index} RETURNING *;`, values);
    return result.rows[0] ? mapDbExamRow(result.rows[0]) : null;
  } catch (error) {
    console.warn('Database update skipped:', error.message);
    return null;
  }
}

async function loadExamRecords() {
  const dbExams = await getExamListFromDatabase();
  return dbExams.length ? dbExams : exams;
}

async function seedDefaultUsers() {
  const users = [
    { email: 'teacher@dau.edu.vn', password: 'Teacher123!', full_name: 'Giảng viên DAU', role: 'teacher' },
    { email: 'admin@dau.edu.vn', password: 'Admin123!', full_name: 'Quản trị hệ thống', role: 'admin' },
    { email: 'student@sv.dau.edu.vn', password: 'Student123!', full_name: 'Sinh viên DAU', role: 'student' },
  ];

  for (const user of users) {
    try {
      const existing = await query('SELECT id FROM users WHERE email = $1', [user.email.toLowerCase()]);
      if (existing.rows.length > 0) continue;
      const hash = await bcrypt.hash(user.password, 12);
      await query('INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)', [user.email.toLowerCase(), hash, user.full_name, user.role]);
    } catch (error) {
      console.warn('Default user seeding skipped:', error.message);
    }
  }
}

ensureExamSchema().catch((error) => {
  console.warn('Exam schema setup skipped:', error.message);
});
seedDefaultUsers().catch((error) => {
  console.warn('Default account seeding skipped:', error.message);
});
const normalizeDocumentText = (value = '') => String(value)
  .replace(/\r/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\s+\n/g, '\n')
  .replace(/\n\s+/g, '\n')
  .trim();

async function extractTextFromUploadedFile(file) {
  if (!file || !file.buffer || !file.buffer.length) return '';

  const fileName = String(file.originalname || file.filename || 'upload');
  const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeType = String(file.mimetype || '');
  const buffer = file.buffer;

  try {
    if (mimeType.includes('pdf') || fileExt === 'pdf') {
      const parsed = await pdfParse(buffer);
      return normalizeDocumentText(parsed.text || '');
    }

    if (mimeType.includes('word') || fileExt === 'docx' || fileExt === 'doc') {
      const result = await mammoth.extractRawText({ buffer });
      return normalizeDocumentText(result.value || '');
    }

    if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(fileExt)) {
      const worker = await createWorker('eng');
      const { data } = await worker.recognize(buffer);
      await worker.terminate();
      return normalizeDocumentText(data?.text || '');
    }

    if (mimeType.includes('text') || ['txt', 'md', 'csv', 'json', 'log'].includes(fileExt)) {
      return normalizeDocumentText(buffer.toString('utf8'));
    }

    return normalizeDocumentText(buffer.toString('utf8'));
  } catch (error) {
    console.warn('Document extraction failed for file:', fileName, error.message);
    return normalizeDocumentText(buffer.toString('utf8'));
  }
}

function extractDocumentMetadata(text = '', filename = '') {
  const metadata = {
    subjectName: '',
    faculty: '',
    academicYear: '',
    semester: '',
    examType: '',
  };

  const sample = (text || '').slice(0, 3000);

  // Subject extraction
  const subjectMatch = sample.match(/(?:môn\s*học|môn\s*thi|học\s*phần|giáo\s*trình|bài\s*giảng|tên\s*học\s*phần)\s*[:：]\s*([^\n\r,;]+)/i);
  if (subjectMatch && subjectMatch[1].trim().length > 2) {
    metadata.subjectName = subjectMatch[1].trim().replace(/^["']|["']$/g, '');
  } else if (filename) {
    const cleanName = filename
      .replace(/\.[^.]+$/, '')
      .replace(/^[_\-\s]*(?:de\s*thi|giao\s*trinh|tai\s*lieu|bai\s*giang|mon|kiem\s*tra)[_\-\s]*/i, '')
      .replace(/[_\-]+/g, ' ')
      .trim();
    if (cleanName.length > 2) {
      metadata.subjectName = cleanName;
    }
  }

  // Faculty / Department extraction
  const facultyMatch = sample.match(/(?:khoa|viện|bộ\s*môn)\s*[:：]?\s*([^\n\r,;]{3,60})/i);
  if (facultyMatch && facultyMatch[0]) {
    metadata.faculty = facultyMatch[0].trim().replace(/\s+/g, ' ');
  }

  // Academic year: e.g. 2024-2025, 2024 - 2025
  const yearMatch = sample.match(/năm\s*học\s*[:：]?\s*(\d{4}\s*[-–/]\s*\d{4})/i);
  if (yearMatch) {
    metadata.academicYear = yearMatch[1].replace(/\s+/g, '');
  }

  // Semester: e.g. Học kỳ 1, Học kỳ 2, HK I, HK II, Hè
  const semMatch = sample.match(/(?:học\s*kỳ|học\s*kì|hk)\s*[:：]?\s*([123]|I{1,3}|hè)/i);
  if (semMatch) {
    let s = semMatch[1].toUpperCase();
    if (s === 'I') s = '1';
    if (s === 'II') s = '2';
    if (s === 'III') s = '3';
    metadata.semester = s;
  }

  // Exam type: Giữa kỳ / Cuối kỳ
  if (/giữa\s*kỳ|giữa\s*kì/i.test(sample)) {
    metadata.examType = 'Giữa kỳ';
  } else if (/cuối\s*kỳ|cuối\s*kì|kết\s*thúc\s*học\s*phần/i.test(sample)) {
    metadata.examType = 'Cuối kỳ';
  }

  return metadata;
}

const safeQuestionText = (value = '', fallback = 'Mô tả nội dung chính của tài liệu theo hướng phân tích.') => {
  const cleaned = String(value).replace(/^\s*[-*•\d.\)]\s*/, '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
};

const normalizeQuestionPunctuation = (value = '') => {
  const text = safeQuestionText(value, '');
  if (!text) return '';
  const normalized = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([!?]){2,}$/g, '$1')
    .replace(/\.{2,}$/g, '.');
  if (/[.!?]$/.test(normalized)) return normalized;
  return /\b(?:ai|cái nào|điều gì|gì|nào|ở đâu|khi nào|bao nhiêu|vì sao|như thế nào|ra sao)\b/i.test(normalized)
    ? `${normalized}?`
    : `${normalized}.`;
};

const removeTerminalPunctuation = (value = '') => String(value).trim().replace(/[.!?]+$/g, '');

const splitIntoSentences = (text = '') => {
  const source = String(text).replace(/\s+/g, ' ').trim();
  if (!source) return [];

  const abbreviations = new Set([
    'tp', 'q', 'p', 'ts', 'ths', 'pgs', 'gs', 'bs', 'ks',
    'th.s', 'nxb', 'tr', 'st', 'v.v', 'etc', 'dr', 'mr', 'mrs',
  ]);
  const sentences = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (!'.?!'.includes(source[index])) continue;
    if (source[index] === '.' && /\d/.test(source[index - 1] || '') && /\d/.test(source[index + 1] || '')) continue;
    if (source[index] === '.' && source[index + 1] === '.') continue;

    let wordStart = index - 1;
    while (wordStart >= 0 && /[\p{L}\p{N}.]/u.test(source[wordStart])) wordStart -= 1;
    const previousWord = source.slice(wordStart + 1, index).toLocaleLowerCase('vi-VN').replace(/\.$/, '');
    if (source[index] === '.' && (
      abbreviations.has(previousWord)
      || /^\p{Lu}$/u.test(source.slice(wordStart + 1, index))
    )) continue;

    let next = index + 1;
    while (next < source.length && /\s/u.test(source[next])) next += 1;
    while (next < source.length && /["'”’»)]/u.test(source[next])) next += 1;
    while (next < source.length && /\s/u.test(source[next])) next += 1;
    if (next >= source.length || /[\p{Lu}\p{N}“"'(]/u.test(source[next])) {
      let end = index + 1;
      while (end < source.length && /["'”’»)]/u.test(source[end])) end += 1;
      const sentence = source.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = next;
      index = next - 1;
    }
  }

  const remainder = source.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
};

const inferDifficulty = (text = '') => {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  if (words >= 28) return 'hard';
  if (words >= 16) return 'medium';
  return 'easy';
};

const extractDefinition = (sentence = '') => {
  const match = String(sentence).trim().match(/^(.{2,80}?)(?:\s*\(([^)]+)\))?\s+(?:được hiểu là|được định nghĩa là|có nghĩa là|là)\s+(.{20,})$/i);
  if (!match) return null;
  const term = match[1].trim();
  const abbreviation = match[2]?.trim();
  return {
    term: abbreviation ? `${term} (${abbreviation})` : term,
    meaning: match[3].trim(),
  };
};

const extractStructuredQuestion = (sentence = '') => {
  const source = removeTerminalPunctuation(sentence).trim();
  const definition = extractDefinition(source);
  if (definition) return {
    question: `${definition.term} là gì?`,
    variants: [`${definition.term} được hiểu như thế nào?`, `Nội dung nào giải thích đúng khái niệm ${definition.term}?`],
    answer: definition.meaning,
  };

  const componentMatch = source.match(/^(.{2,80}?)\s+(?:bao gồm|gồm|có các thành phần là|gồm các thành phần)\s+(.{12,})$/i);
  if (componentMatch) {
    const term = componentMatch[1].trim();
    return {
      question: `${term} gồm những thành phần nào?`,
      variants: [`Những yếu tố nào cấu thành ${term}?`, `Thành phần của ${term} được mô tả như thế nào?`],
      answer: componentMatch[2].trim(),
    };
  }

  const roleMatch = source.match(/^(.{2,80}?)\s+(?:có vai trò(?: quan trọng)?(?: là)?|đóng vai trò(?: quan trọng)?(?: là)?)\s+(.{15,})$/i);
  if (roleMatch) {
    const term = roleMatch[1].trim();
    return {
      question: `Vai trò của ${term} là gì?`,
      variants: [`${term} đóng góp như thế nào vào hoạt động được nêu?`, `Vì sao ${term} có ý nghĩa trong nội dung trên?`],
      answer: roleMatch[2].trim(),
    };
  }

  const purposeMatch = source.match(/^(.{2,80}?)\s+(?:được sử dụng để|được dùng để|dùng để|có chức năng(?: chính)? là|giúp|hỗ trợ|cho phép)\s+(.{15,})$/i);
  if (purposeMatch) {
    const term = purposeMatch[1].trim();
    return {
      question: `Mục đích hoặc chức năng của ${term} là gì?`,
      variants: [`${term} hỗ trợ thực hiện công việc nào?`, `Nội dung nào mô tả đúng tác dụng của ${term}?`],
      answer: purposeMatch[2].trim(),
    };
  }

  const effectMatch = source.match(/^(.{2,80}?)\s+(?:ảnh hưởng|tác động)\s+(?:trực tiếp\s+)?(?:đến|tới)\s+(.{15,})$/i);
  if (effectMatch) {
    const term = effectMatch[1].trim();
    return {
      question: `Yếu tố nào chịu ảnh hưởng trực tiếp từ ${term}?`,
      variants: [`${term} tác động đến nội dung nào?`, `Ảnh hưởng được nêu của ${term} là gì?`],
      answer: effectMatch[2].trim(),
    };
  }

  const consequenceMatch = source.match(/^(.{2,100}?)\s+(?:dẫn đến|gây ra|làm phát sinh)\s+(.{15,})$/i);
  if (consequenceMatch) {
    const term = consequenceMatch[1].trim();
    return {
      question: `Hệ quả chính của ${term} là gì?`,
      variants: [`${term} có thể dẫn đến kết quả nào?`, `Điều gì xảy ra khi ${term}?`],
      answer: consequenceMatch[2].trim(),
    };
  }

  const improvementMatch = source.match(/^(.{2,80}?)\s+(?:góp phần tạo nên|tạo nên|cải thiện|nâng cao|làm tăng|làm giảm)\s+(.{15,})$/i);
  if (improvementMatch) {
    const term = improvementMatch[1].trim();
    return {
      question: `${term} góp phần tạo nên hoặc cải thiện yếu tố nào?`,
      variants: [`Tác động tích cực được nêu của ${term} là gì?`, `Nội dung nào được cải thiện nhờ ${term}?`],
      answer: improvementMatch[2].trim(),
    };
  }

  const requirementMatch = source.match(/^(.{2,80}?)\s+(?:cần|phải)\s+(?:được\s+)?(?:phù hợp|đáp ứng|bảo đảm|đảm bảo)\s+(.{15,})$/i);
  if (requirementMatch) {
    const term = requirementMatch[1].trim();
    return {
      question: `${term} cần đáp ứng yêu cầu nào?`,
      variants: [`Điều kiện nào được đặt ra đối với ${term}?`, `Yếu tố nào cần được cân nhắc để ${term} phù hợp?`],
      answer: requirementMatch[2].trim(),
    };
  }

  const determinesMatch = source.match(/^(.{2,80}?)\s+(?:quyết định|chi phối)\s+(.{15,})$/i);
  if (determinesMatch) {
    const term = determinesMatch[1].trim();
    return {
      question: `${term} quyết định nội dung nào?`,
      variants: [`Nội dung nào chịu sự chi phối của ${term}?`, `Mối quan hệ giữa ${term} và nội dung được quyết định là gì?`],
      answer: determinesMatch[2].trim(),
    };
  }

  return null;
};

const normalizeEvidenceText = (text = '') => normalizeDocumentText(text)
  .normalize('NFC')
  .toLocaleLowerCase('vi-VN')
  .replace(/\s+/g, ' ')
  .trim();

const isAnswerSupportedByEvidence = (answer, evidence) => {
  const stopWords = new Set(['các', 'của', 'được', 'trong', 'trên', 'dưới', 'cho', 'với', 'một', 'những', 'này', 'đó', 'theo', 'giúp', 'là', 'và', 'hoặc', 'đến', 'từ', 'khi', 'như', 'để', 'có', 'thể']);
  const answerTerms = new Set(
    normalizeEvidenceText(answer).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2 && !stopWords.has(term)),
  );
  if (!answerTerms.size) return false;
  const evidenceTerms = new Set(
    normalizeEvidenceText(evidence).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2 && !stopWords.has(term)),
  );
  const supportedTerms = [...answerTerms].filter((term) => evidenceTerms.has(term)).length;
  return supportedTerms > 0 && supportedTerms / answerTerms.size >= 0.2;
};

const buildEssayRubric = (cognitiveLevel) => {
  const criteria = cognitiveLevel === 'application'
    ? [
      {
        name: 'Phân tích tình huống và xác định vấn đề',
        weight: 25,
        descriptors: [
          'Nhận diện đầy đủ vấn đề, dữ kiện liên quan và nguyên nhân cốt lõi.',
          'Nhận diện đúng vấn đề chính nhưng còn bỏ sót một dữ kiện hoặc nguyên nhân.',
          'Nêu được một phần vấn đề nhưng phân tích còn rời rạc hoặc nhầm lẫn.',
          'Không xác định được vấn đề phù hợp với tình huống.',
        ],
      },
      {
        name: 'Vận dụng kiến thức/nguyên lý phù hợp',
        weight: 35,
        descriptors: [
          'Chọn và vận dụng chính xác các kiến thức/nguyên lý phù hợp, giải thích rõ căn cứ.',
          'Vận dụng cơ bản đúng nhưng giải thích căn cứ chưa đầy đủ.',
          'Có liên hệ kiến thức nhưng lựa chọn hoặc vận dụng còn thiếu chính xác.',
          'Không vận dụng được kiến thức phù hợp hoặc áp dụng sai trọng tâm.',
        ],
      },
      {
        name: 'Đề xuất giải pháp và tính khả thi',
        weight: 25,
        descriptors: [
          'Giải pháp phù hợp, khả thi và được phân tích theo các điều kiện của tình huống.',
          'Giải pháp phù hợp nhưng chưa phân tích đầy đủ tính khả thi.',
          'Giải pháp mới dừng ở ý tưởng chung hoặc còn thiếu căn cứ thực hiện.',
          'Không đề xuất được giải pháp phù hợp.',
        ],
      },
      {
        name: 'Lập luận, minh chứng và trình bày',
        weight: 15,
        descriptors: [
          'Lập luận mạch lạc, minh chứng phù hợp, trình bày rõ ràng và đúng thuật ngữ.',
          'Lập luận nhìn chung hợp lý nhưng minh chứng hoặc cách trình bày còn hạn chế.',
          'Lập luận thiếu liên kết, minh chứng yếu hoặc diễn đạt khó theo dõi.',
          'Thiếu lập luận/minh chứng và trình bày không rõ nội dung.',
        ],
      },
    ]
    : [
      {
        name: 'Hiểu đúng khái niệm và nội dung trọng tâm',
        weight: 40,
        descriptors: [
          'Trình bày chính xác, đầy đủ khái niệm và các ý trọng tâm.',
          'Nêu đúng nội dung chính nhưng còn thiếu một ý hoặc chi tiết quan trọng.',
          'Thể hiện hiểu biết một phần nhưng còn nhầm lẫn hoặc thiếu nhiều ý.',
          'Không nêu được khái niệm/nội dung phù hợp hoặc giải thích sai.',
        ],
      },
      {
        name: 'Giải thích mối liên hệ và lập luận',
        weight: 35,
        descriptors: [
          'Giải thích rõ mối liên hệ, lập luận logic và làm rõ được bản chất vấn đề.',
          'Giải thích được mối liên hệ chính nhưng lập luận chưa thật đầy đủ.',
          'Lập luận còn rời rạc, giải thích mối liên hệ chưa rõ.',
          'Không giải thích được mối liên hệ hoặc lập luận sai trọng tâm.',
        ],
      },
      {
        name: 'Dùng thuật ngữ, dẫn chứng và trình bày',
        weight: 25,
        descriptors: [
          'Dùng thuật ngữ chính xác, dẫn chứng phù hợp và trình bày mạch lạc.',
          'Thuật ngữ và trình bày cơ bản chính xác nhưng dẫn chứng còn hạn chế.',
          'Dùng thuật ngữ chưa ổn định, dẫn chứng hoặc cách trình bày thiếu rõ ràng.',
          'Dùng sai thuật ngữ, không có dẫn chứng phù hợp hoặc trình bày khó hiểu.',
        ],
      },
    ];
  const levels = [
    { name: 'Tốt', multiplier: 1 },
    { name: 'Đạt', multiplier: 0.75 },
    { name: 'Đang phát triển', multiplier: 0.5 },
    { name: 'Chưa đạt', multiplier: 0 },
  ];
  return {
    type: 'analytic',
    scale: levels.map(({ name, multiplier }) => ({ name, multiplier })),
    criteria: criteria.map(({ descriptors, ...criterion }) => ({
      ...criterion,
      levels: levels.map(({ name, multiplier }, index) => ({
        name,
        points: Math.round(criterion.weight * multiplier * 100) / 100,
        descriptor: descriptors[index],
      })),
    })),
  };
};

const getEssayLevelForIndex = (index, distribution = {}) => {
  const understanding = Math.max(0, Number(distribution.understanding || 0));
  const application = Math.max(0, Number(distribution.application || 0));
  const total = understanding + application;
  if (!total) return index % 2 === 0 ? 'understanding' : 'application';
  return index % total < understanding ? 'understanding' : 'application';
};

const shuffleQuestionChoices = (question) => {
  if (question.type !== 'multipleChoice' || !Array.isArray(question.choices) || question.choices.length < 2) return question;
  const proposedIndex = Number(question.answer ?? 0);
  const correctIndex = Number.isInteger(proposedIndex) && proposedIndex >= 0 && proposedIndex < question.choices.length ? proposedIndex : 0;
  const choices = question.choices.map((text, index) => ({ text, index }));
  for (let index = choices.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return {
    ...question,
    choices: choices.map((choice) => choice.text),
    answer: choices.findIndex((choice) => choice.index === correctIndex),
  };
};

const extractCandidatesFromText = (content, subject, requestedCount, cognitiveDistribution = {}, questionTypes = {}) => {
  const normalized = normalizeDocumentText(content);
  if (!normalized) return [];

  const noisyPatterns = [
    /^\s*(trang\s*\d+|page\s*\d+|copyright|all rights reserved|đại học|university|bộ môn|khoa|học viện|thống kê)\b/i,
    /^\s*[-*•\d\.\)]\s*$/,
    /^\s*[A-ZÀ-Ỹ]{2,}\s*$/,
  ];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
  const chunks = paragraphs
    .filter((paragraph) => paragraph.length > 18 && !/^https?:/i.test(paragraph))
    .filter((paragraph) => !noisyPatterns.some((pattern) => pattern.test(paragraph)))
    .flatMap(splitIntoSentences)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18 && sentence.length < 500);

  const unique = Array.from(new Map(chunks.map((item) => [item.toLowerCase(), item])).values())
    .filter((item) => !/^(lời|bài|câu hỏi|đáp án|đề thi|giải thích|mục|chương)/i.test(item))
    .slice(0, Math.max(Number(requestedCount || 20), 30));

  const buildChoiceSet = (correctChoice, allSentences, sourceSentence = '', difficulty = 'medium') => {
    const normalizeOption = (option) => normalizeEvidenceText(option).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const cleanOption = (option) => safeQuestionText(option, '')
      .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
      .replace(/[.,;:!?…\s]+$/g, '')
      .trim();
    const correctKey = normalizeOption(correctChoice);
    const structuredDistractors = allSentences
      .map((item) => extractStructuredQuestion(item)?.answer)
      .filter(Boolean);
    const normalizeDistractors = (source) => source
      .map(cleanOption)
      .filter((option) => {
        const normalized = normalizeOption(option);
        return option.length >= 8
          && normalized !== correctKey
          && !normalized.includes(correctKey)
          && !correctKey.includes(normalized);
      });
    const completeStatements = [...structuredDistractors, ...allSentences];
    const splitPhrases = allSentences.flatMap((sentence) =>
      sentence.split(/\s+(?:và|hoặc)\s+/i)
        .map((phrase) => phrase.trim())
        .filter((phrase) => phrase.length >= 18 && phrase.split(/\s+/).length >= 3)
    );
    const structuredOptions = normalizeDistractors(structuredDistractors);
    const distractors = normalizeDistractors(
      structuredOptions.length >= 3 ? structuredDistractors : [...completeStatements, ...splitPhrases],
    );

    const uniqueDistractors = Array.from(new Map(distractors.map((option) => [normalizeOption(option), option])).values());
    const stopWords = new Set(['các', 'của', 'được', 'trong', 'trên', 'dưới', 'cho', 'với', 'một', 'những', 'này', 'đó', 'theo', 'giúp', 'là', 'và', 'hoặc']);
    const getTerms = (option) => new Set(normalizeOption(option).split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word)));
    const correctTerms = getTerms(correctChoice);
    const similarity = (option) => {
      const terms = getTerms(option);
      const overlap = [...terms].filter((term) => correctTerms.has(term)).length;
      return overlap / Math.max(1, Math.min(terms.size, correctTerms.size));
    };
    const lengthSimilarity = (option) => {
      const correctLength = Math.max(1, correctKey.split(' ').length);
      const optionLength = Math.max(1, normalizeOption(option).split(' ').length);
      return Math.min(correctLength, optionLength) / Math.max(correctLength, optionLength);
    };

    const rankedDistractors = uniqueDistractors
      .map((option) => ({
        option,
        similarity: similarity(option),
        lengthSimilarity: lengthSimilarity(option),
      }))
      .filter(({ similarity: score, lengthSimilarity: lengthScore }) => score < 0.9 && lengthScore >= 0.4)
      .sort((left, right) => {
      const leftSimilarity = left.similarity;
      const rightSimilarity = right.similarity;
      const leftScore = difficulty === 'easy'
        ? Math.abs(leftSimilarity - 0.12) + Math.abs(left.lengthSimilarity - 0.7) * 0.2
        : difficulty === 'hard'
          ? Math.abs(leftSimilarity - 0.5) + Math.abs(left.lengthSimilarity - 0.8) * 0.2
          : Math.abs(leftSimilarity - 0.3) + Math.abs(left.lengthSimilarity - 0.75) * 0.2;
      const rightScore = difficulty === 'easy'
        ? Math.abs(rightSimilarity - 0.12) + Math.abs(right.lengthSimilarity - 0.7) * 0.2
        : difficulty === 'hard'
          ? Math.abs(rightSimilarity - 0.5) + Math.abs(right.lengthSimilarity - 0.8) * 0.2
          : Math.abs(rightSimilarity - 0.3) + Math.abs(right.lengthSimilarity - 0.75) * 0.2;
      return leftScore - rightScore;
    });
    const relatedPool = rankedDistractors.length >= 3
      ? rankedDistractors
      : uniqueDistractors
        .map((option) => ({ option, similarity: similarity(option), lengthSimilarity: lengthSimilarity(option) }))
        .filter(({ similarity: score, lengthSimilarity: lengthScore }) => score < 0.9 && lengthScore >= 0.3)
        .sort((left, right) => left.similarity - right.similarity);
    const selectedDistractors = [];
    while (selectedDistractors.length < 3 && relatedPool.length) {
      const totalWeight = relatedPool.reduce((sum, _, index) => sum + 1 / (index + 1), 0);
      let threshold = Math.random() * totalWeight;
      let selectedIndex = relatedPool.length - 1;
      for (let index = 0; index < relatedPool.length; index++) {
        threshold -= 1 / (index + 1);
        if (threshold <= 0) {
          selectedIndex = index;
          break;
        }
      }
      selectedDistractors.push(relatedPool.splice(selectedIndex, 1)[0].option);
    }

    return selectedDistractors.length === 3 ? [correctChoice, ...selectedDistractors] : [];
  };

  const candidates = [];
  const total = Math.min(unique.length, Math.max(Number(requestedCount || 20), 10));
  const multipleChoicePrompts = [
    () => `Phát biểu nào diễn đạt đúng mối quan hệ được mô tả?`,
    () => `Kết luận nào phù hợp nhất với đặc điểm được nêu?`,
    () => `Cách giải thích nào phù hợp với nguyên lý này?`,
    () => `Nếu áp dụng nhận định trên, kết quả nào hợp lý nhất?`,
  ];
  const getGenericMultipleChoicePrompt = (_sentence, variantIndex) =>
    multipleChoicePrompts[variantIndex % multipleChoicePrompts.length]();
  const understandingPrompts = [
    (sentence) => `Hãy giải thích nhận định “${removeTerminalPunctuation(sentence)}” và làm rõ khái niệm trọng tâm.`,
    (sentence) => `Nhận định “${removeTerminalPunctuation(sentence)}” cho thấy mối liên hệ nào? Hãy giải thích.`,
    (sentence) => `Có thể rút ra kết luận gì từ nhận định “${removeTerminalPunctuation(sentence)}”? Nêu căn cứ.`,
    (sentence) => `Hãy phân tích ý nghĩa của nhận định “${removeTerminalPunctuation(sentence)}” đối với ${subject || 'môn học'}.`,
  ];
  const applicationPrompts = [
    (sentence) => `Một tình huống thực tế đặt ra vấn đề liên quan đến nhận định “${removeTerminalPunctuation(sentence)}”. Hãy đề xuất cách xử lý dựa trên kiến thức ${subject || 'môn học'}.`,
    (sentence) => `Khi vận dụng nguyên lý “${removeTerminalPunctuation(sentence)}” vào thực tế, cần cân nhắc những yếu tố nào? Giải thích lựa chọn.`,
    (sentence) => `Hãy đề xuất cách áp dụng nguyên lý “${removeTerminalPunctuation(sentence)}” vào một tình huống thuộc ${subject || 'môn học'} và nêu căn cứ.`,
    (sentence) => `Nếu gặp một vấn đề liên quan đến “${removeTerminalPunctuation(sentence)}”, anh/chị sẽ chọn giải pháp nào? Vì sao?`,
  ];
  let essayIndex = 0;

  for (let index = 0; index < total; index++) {
    const sentence = safeQuestionText(unique[index], 'Nội dung tài liệu');
    const difficultyLevel = inferDifficulty(sentence);
    const structuredQuestion = extractStructuredQuestion(sentence);
    const shouldBeMultipleChoice = Boolean(structuredQuestion) || index % 2 === 0;
    const choices = shouldBeMultipleChoice
      ? buildChoiceSet(structuredQuestion?.answer || sentence, unique, sentence, difficultyLevel)
      : [];
    if (shouldBeMultipleChoice && choices.length === 4) {
      candidates.push({
        id: randomUUID(),
        text: structuredQuestion
          ? structuredQuestion.question
          : getGenericMultipleChoicePrompt(sentence, Math.floor(index / 2)),
        subject: subject || 'Chưa phân loại',
        difficulty: difficultyLevel,
        type: 'multipleChoice',
        choices,
        answer: 0,
        answerText: structuredQuestion?.answer || sentence,
        sourceEvidence: sentence,
      });
    } else {
      const cognitiveLevel = getEssayLevelForIndex(essayIndex++, cognitiveDistribution);
      const prompts = cognitiveLevel === 'application' ? applicationPrompts : understandingPrompts;
      const essayText = prompts[(essayIndex - 1) % prompts.length](sentence);
      candidates.push({
        id: randomUUID(),
        text: essayText,
        subject: subject || 'Chưa phân loại',
        difficulty: difficultyLevel,
        type: 'essay',
        choices: [],
        answer: 0,
        answerText: structuredQuestion?.answer || sentence,
        sourceEvidence: sentence,
        cognitiveLevel,
        rubric: buildEssayRubric(cognitiveLevel),
      });
    }
  }

  const targetMultipleChoice = Math.max(0, Number(questionTypes.multipleChoice || 0));
  const targetEssay = Math.max(0, Number(questionTypes.essay || 0));
  const targetTypeTotal = targetMultipleChoice + targetEssay;
  const requestedPoolCount = Math.min(100, Math.max(0, Number(requestedCount || 0)));
  if (targetTypeTotal > 0 && requestedPoolCount > targetTypeTotal && unique.length) {
    let multipleChoiceCount = candidates.filter((question) => question.type === 'multipleChoice').length;
    let essayCount = candidates.length - multipleChoiceCount;
    let attempt = 0;
    while (candidates.length < requestedPoolCount && attempt < requestedPoolCount * 4) {
      const sentenceIndex = attempt % unique.length;
      const variantIndex = Math.floor(attempt / unique.length) + 1;
      const sentence = safeQuestionText(unique[sentenceIndex], 'Nội dung tài liệu');
      const structuredQuestion = extractStructuredQuestion(sentence);
      const preferMultipleChoice = targetMultipleChoice > 0
        && (targetEssay === 0 || multipleChoiceCount / targetMultipleChoice <= essayCount / targetEssay);

      if (preferMultipleChoice && structuredQuestion) {
        const variants = [structuredQuestion.question, ...(structuredQuestion.variants || [])];
        const text = variants[variantIndex % variants.length];
        const choices = buildChoiceSet(structuredQuestion.answer, unique, sentence, inferDifficulty(sentence));
        if (choices.length === 4) {
          candidates.push({
            id: randomUUID(),
            text,
            subject: subject || 'Chưa phân loại',
            difficulty: inferDifficulty(sentence),
            type: 'multipleChoice',
            choices,
            answer: 0,
            answerText: structuredQuestion.answer,
            sourceEvidence: sentence,
          });
          multipleChoiceCount += 1;
        } else if (targetEssay > 0) {
          const cognitiveLevel = getEssayLevelForIndex(essayIndex++, cognitiveDistribution);
          const prompts = cognitiveLevel === 'application' ? applicationPrompts : understandingPrompts;
          candidates.push({
            id: randomUUID(),
            text: prompts[variantIndex % prompts.length](sentence),
            subject: subject || 'Chưa phân loại',
            difficulty: inferDifficulty(sentence),
            type: 'essay',
            choices: [],
            answer: 0,
            answerText: sentence,
            sourceEvidence: sentence,
            cognitiveLevel,
            rubric: buildEssayRubric(cognitiveLevel),
          });
          essayCount += 1;
        }
      } else if (preferMultipleChoice) {
        const prompt = getGenericMultipleChoicePrompt(sentence, variantIndex);
        const choices = buildChoiceSet(sentence, unique, sentence, inferDifficulty(sentence));
        if (choices.length === 4) {
          candidates.push({
            id: randomUUID(),
            text: prompt,
            subject: subject || 'Chưa phân loại',
            difficulty: inferDifficulty(sentence),
            type: 'multipleChoice',
            choices,
            answer: 0,
            answerText: sentence,
            sourceEvidence: sentence,
          });
          multipleChoiceCount += 1;
        } else if (targetEssay > 0) {
          const cognitiveLevel = getEssayLevelForIndex(essayIndex++, cognitiveDistribution);
          const prompts = cognitiveLevel === 'application' ? applicationPrompts : understandingPrompts;
          candidates.push({
            id: randomUUID(),
            text: prompts[variantIndex % prompts.length](sentence),
            subject: subject || 'Chưa phân loại',
            difficulty: inferDifficulty(sentence),
            type: 'essay',
            choices: [],
            answer: 0,
            answerText: sentence,
            sourceEvidence: sentence,
            cognitiveLevel,
            rubric: buildEssayRubric(cognitiveLevel),
          });
          essayCount += 1;
        }
      } else {
        const cognitiveLevel = getEssayLevelForIndex(essayIndex++, cognitiveDistribution);
        const prompts = cognitiveLevel === 'application' ? applicationPrompts : understandingPrompts;
        candidates.push({
          id: randomUUID(),
          text: prompts[variantIndex % prompts.length](sentence),
          subject: subject || 'Chưa phân loại',
          difficulty: inferDifficulty(sentence),
          type: 'essay',
          choices: [],
          answer: 0,
          answerText: sentence,
          sourceEvidence: sentence,
          cognitiveLevel,
          rubric: buildEssayRubric(cognitiveLevel),
        });
        essayCount += 1;
      }
      attempt += 1;
    }
  }

  const uniqueCandidates = new Map();
  for (const candidate of candidates) {
    const key = normalizeEvidenceText(candidate.text);
    if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  }
  return [...uniqueCandidates.values()];
};

async function generateQuestionsFromDocument({ subject, requestedCount, content, questionTypes = {}, cognitiveDistribution = {} }) {
  const fallback = extractCandidatesFromText(content, subject, requestedCount, cognitiveDistribution, questionTypes);
  if (!process.env.OPENAI_API_KEY) return { questions: fallback, usedAI: false };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.75,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Bạn là chuyên gia biên soạn đề thi đại học. Hãy tạo ngân hàng câu hỏi có chất lượng sư phạm, trong đó câu hỏi, đáp án đúng, giải thích đáp án và đoạn căn cứ luôn khớp chặt chẽ với nhau. Trước khi viết, xác định một ý kiến kiến thức cụ thể trong nguồn làm chủ đề; đặt câu hỏi rõ ràng, tự nhiên, hỏi đúng điều đáp án trả lời, không tạo câu cụt như "Đặc điểm nào được nêu về Được cấu tạo từ?". Câu hỏi và đáp án được phép diễn đạt lại bằng lời mới, không cần giống nguyên văn nguồn; câu chữ không cần trùng nguyên văn nguồn nhưng phải giữ đúng ý. Được phép bổ sung kiến thức nền phổ thông/chuyên môn đáng tin cậy để câu hỏi, đáp án và phương án nhiễu đầy đủ, chính xác, hợp lý hơn; không đưa thông tin bổ sung mâu thuẫn với bài hoặc trình bày giả định như thể được trích từ nguồn. Khi đáp án cần kiến thức ngoài nguồn, đặt answerBasis="background" và nêu căn cứ kiến thức nền ngắn gọn trong backgroundKnowledge; nếu không, đặt answerBasis="source". expectedAnswer phải giải thích ngắn vì sao đáp án đúng, và nếu dùng kiến thức nền thì nêu rõ phần bổ sung đó. sourceEvidence phải là đoạn trích nguyên văn liên tục, đúng chính tả và dấu câu theo nguồn, xác định được chủ đề/căn cứ của câu hỏi; không bắt buộc phải chứa nguyên văn câu trả lời hay toàn bộ kiến thức bổ sung. Không được cắt, nối hoặc tách sai câu làm thay đổi ý; xuống dòng trong PDF/OCR có thể chỉ là ngắt dòng trình bày. Khai thác đa dạng khái niệm, chức năng, thành phần, nguyên nhân-kết quả, so sánh, mối quan hệ, hệ quả và ứng dụng; tránh lặp câu bằng cách thay vài từ. Có thể tạo tình huống ứng dụng mới nhưng không bịa dữ kiện. Mỗi câu phải có cấu trúc ngữ pháp rõ ràng, chủ thể và yêu cầu nhất quán; tránh câu máy móc, chủ thể là một mệnh đề vụn hoặc ghép yêu cầu không liên quan. Dùng dấu câu tiếng Việt tự nhiên: câu hỏi kết thúc bằng một dấu hỏi, yêu cầu mệnh lệnh/đề nghị kết thúc bằng dấu chấm. Stem không nhắc "trong tài liệu", "theo tài liệu", "theo văn bản" hay "đoạn văn trên". Câu trắc nghiệm có đúng 4 lựa chọn khác nhau, một đáp án đúng duy nhất. Ba phương án nhiễu phải cùng phạm trù, phạm vi và độ cụ thể với đáp án; diễn đạt trọn nghĩa, tự nhiên, có sức phân biệt và sai rõ; ưu tiên nhầm lẫn hợp lý về khái niệm, cơ chế, điều kiện hoặc hệ quả. Mọi lựa chọn phải liên quan chủ đề bài học; mọi phương án phải rõ nghĩa, không lạc đề hay vô lý; không để đáp án đúng dài/rõ chi tiết hơn hẳn lựa chọn khác. Tuân thủ số lượng và phân bổ loại câu/mức tư duy; thông hiểu cần giải thích/phân tích/so sánh, vận dụng cần áp dụng nguyên lý và nêu căn cứ. Ưu tiên chất lượng hơn số lượng khi nguồn không đủ ý. Gán difficulty hợp lý. Trả JSON {questions:[{text,difficulty,type,cognitiveLevel,choices,answerIndex,answerBasis,backgroundKnowledge,expectedAnswer,sourceEvidence}]}, không giải thích thêm.'
          },
          {
            role: 'system',
            content: 'Ưu tiên câu hỏi và đáp án mẫu đầy đủ ý, không quá cụt: với nội dung phức tạp, câu hỏi có thể gồm bối cảnh ngắn và yêu cầu phân tích rõ các khía cạnh liên quan; đáp án tự luận nên giải thích thành 3-5 câu, bao quát khái niệm chính, mối liên hệ hoặc nguyên nhân-kết quả và các điều kiện/ý quan trọng của chủ đề. Đáp án trắc nghiệm nên giải thích 2-4 câu vì sao lựa chọn đúng và liên hệ với kiến thức trọng tâm; nếu dùng kiến thức nền, nêu rõ phần bổ sung. Chỉ mở rộng bằng thông tin liên quan trực tiếp, chính xác và cần thiết; không thêm câu chữ cho dài, không lặp ý, không đưa dữ kiện không có căn cứ. Quy tắc độ dài này thay thế yêu cầu giải thích ngắn ở chỉ dẫn trước; giữ sourceEvidence nguyên văn và không bắt buộc đáp án phải lặp từ ngữ của nguồn.'
          },
          {
            role: 'user',
            content: `Môn học: ${subject || 'Chưa phân loại'}\nSố câu trong ngân hàng cần tạo (không phải số câu cuối cùng của đề): ${requestedCount || 10}\nSố câu tối thiểu cần đáp ứng cho ma trận đề: ${Number(questionTypes.multipleChoice || 0)} trắc nghiệm, ${Number(questionTypes.essay || 0)} tự luận.\nPhân bổ tự luận tối thiểu: ${Number(cognitiveDistribution.understanding || 0)} thông hiểu, ${Number(cognitiveDistribution.application || 0)} vận dụng.\nƯu tiên câu hỏi hợp lý, tự nhiên, có một đáp án đúng rõ ràng; có thể dùng kiến thức nền phổ thông/chuyên môn để bổ sung, nhưng phải đánh dấu answerBasis="background" và giải thích ngắn trong backgroundKnowledge. Câu hỏi/đáp án không cần giống nguyên văn; không tạo câu từ mảnh câu hoặc dùng cụm mở đầu làm chủ thể.\nTài liệu (có thể có xuống dòng do trình bày/OCR): ${content.slice(0, 12000)}`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const rawText = payload.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawText);
    const llmQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

    const sourceText = normalizeEvidenceText(content);
    const seenQuestions = new Set();
    const questionTokens = [];
    let essayIndex = 0;
    const validatedQuestions = llmQuestions.slice(0, Number(requestedCount || 10)).flatMap((item, index) => {
      const text = normalizeQuestionPunctuation(item.text || item.question || '');
      const evidence = normalizeEvidenceText(item.sourceEvidence || item.evidence || '');
      const type = item.type === 'multipleChoice' ? 'multipleChoice' : item.type === 'essay' ? 'essay' : null;
      const questionKey = normalizeEvidenceText(text);
      const tokens = new Set(questionKey.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
      const isNearDuplicate = questionTokens.some((previous) => {
        const intersection = [...tokens].filter((token) => previous.has(token)).length;
        return intersection / Math.max(1, new Set([...tokens, ...previous]).size) >= 0.9;
      });
      if (!text || !evidence || !sourceText.includes(evidence) || !type || seenQuestions.has(questionKey) || isNearDuplicate) return [];

      const choices = Array.isArray(item.choices) ? item.choices.map((choice) => String(choice).trim()) : [];
      const uniqueChoices = new Set(choices.map(normalizeEvidenceText));
      const answerValue = item.answerIndex ?? item.answer;
      const answerIndex = /^[A-D]$/i.test(String(answerValue))
        ? String(answerValue).toUpperCase().charCodeAt(0) - 65
        : Number(answerValue);
      const answerBasis = item.answerBasis === 'background' ? 'background' : 'source';
      const backgroundKnowledge = safeQuestionText(item.backgroundKnowledge || '', '');
      const answerExplanation = safeQuestionText(item.expectedAnswer || item.answerText || (type === 'multipleChoice' ? choices[answerIndex] : evidence), '');
      const answerText = answerBasis === 'background' && backgroundKnowledge
        ? `${answerExplanation} Kiến thức nền bổ sung: ${backgroundKnowledge}`
        : answerExplanation;
      if (!answerText || normalizeEvidenceText(text).includes(normalizeEvidenceText(answerText))) return [];
      if (type === 'multipleChoice' && (choices.length !== 4 || uniqueChoices.size !== 4
        || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length
        || normalizeEvidenceText(text).includes(normalizeEvidenceText(choices[answerIndex]))
        || /được nêu về\s+(?:được|bị|là|gồm|có)\b/i.test(text)
        || (!isAnswerSupportedByEvidence(choices[answerIndex], evidence)
          && (answerBasis !== 'background' || backgroundKnowledge.length < 20)))) return [];

      seenQuestions.add(questionKey);
      questionTokens.push(tokens);
      const cognitiveLevel = type === 'essay'
        ? (item.cognitiveLevel === 'application' || item.cognitiveLevel === 'understanding'
          ? item.cognitiveLevel
          : getEssayLevelForIndex(essayIndex, cognitiveDistribution))
        : null;
      if (type === 'essay') essayIndex++;
      return [{
        id: randomUUID(),
        text,
        subject: subject || 'Chưa phân loại',
        difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : inferDifficulty(text),
        type,
        choices: type === 'multipleChoice' ? choices : [],
        answer: type === 'multipleChoice' ? answerIndex : 0,
        answerText,
        sourceEvidence: String(item.sourceEvidence || item.evidence || '').trim(),
        cognitiveLevel,
        rubric: type === 'essay' ? buildEssayRubric(cognitiveLevel) : null,
      }];
    });

    return validatedQuestions.length
      ? { questions: validatedQuestions, usedAI: true }
      : { questions: fallback, usedAI: false };
  } catch (error) {
    console.warn('Fallback to heuristics because OpenAI was unavailable:', error.message);
    return { questions: fallback, usedAI: false };
  }
}

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

app.get('/api/questions', async (req, res) => {
  const { subject, difficulty } = req.query;
  const dbQuestions = await loadQuestionsFromDb();
  const source = questions.length ? questions : mergeQuestionCollections(questions, dbQuestions);
  const filtered = source.filter((question) => (!subject || question.subject === subject) && (!difficulty || question.difficulty === difficulty));
  res.json({ data: filtered, total: filtered.length });
});

app.post('/api/questions', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  const { text, subject, difficulty = 'medium', choices = [], answer = 0 } = req.body || {};
  if (!text || !subject || !Array.isArray(choices) || choices.length < 2) return res.status(400).json({ message: 'text, subject và ít nhất hai choices là bắt buộc.' });
  const question = { id: nextId('q', questions), text, subject, difficulty, choices, answer, type: choices.length >= 2 ? 'multipleChoice' : 'essay' };
  questions.push(question);
  const dbQuestion = await persistQuestion(question, req.user?.id);
  res.status(201).json(dbQuestion || question);
});

app.post('/api/documents/upload', authenticate, requireRole('teacher', 'admin'), upload.single('file'), async (req, res) => {
  const body = req.body || {};
  const file = req.file;

  if (file) {
    const text = await extractTextFromUploadedFile(file);
    const docMeta = extractDocumentMetadata(text, file.originalname || file.filename);
    return res.status(202).json({
      id: `doc-${Date.now()}`,
      filename: file.originalname || file.filename || 'upload',
      size: Number(file.size || 0),
      mimeType: file.mimetype || 'application/octet-stream',
      extractedText: text,
      documentMetadata: docMeta,
      status: 'ready',
      message: 'Tài liệu đã được đọc và OCR/phân tích nội dung thành công.'
    });
  }

  const { filename, size, mimeType } = body;
  if (!filename) return res.status(400).json({ message: 'filename là bắt buộc.' });
  const docMeta = extractDocumentMetadata(body.content || '', filename);
  return res.status(202).json({
    id: `doc-${Date.now()}`,
    filename,
    size: Number(size || 0),
    mimeType: mimeType || 'application/octet-stream',
    documentMetadata: docMeta,
    status: 'ready',
    message: 'Tài liệu đã sẵn sàng để AI phân tích.'
  });
});

const selectFromPoolByDifficultyRatio = (pool, targetCount, difficultyRatio = {}) => {
  if (targetCount <= 0 || !pool.length) return [];
  const totalRatio = Number(difficultyRatio.easy || 0) + Number(difficultyRatio.medium || 0) + Number(difficultyRatio.hard || 0) || 100;

  const targetEasy = Math.round(targetCount * Number(difficultyRatio.easy || 30) / totalRatio);
  const targetHard = Math.round(targetCount * Number(difficultyRatio.hard || 20) / totalRatio);
  const targetMedium = Math.max(0, targetCount - targetEasy - targetHard);

  const easyList = pool.filter((q) => q.difficulty === 'easy');
  const mediumList = pool.filter((q) => q.difficulty === 'medium' || !['easy', 'hard'].includes(q.difficulty));
  const hardList = pool.filter((q) => q.difficulty === 'hard');

  const picked = [
    ...easyList.slice(0, targetEasy),
    ...mediumList.slice(0, targetMedium),
    ...hardList.slice(0, targetHard),
  ];

  const pickedIds = new Set(picked.map((q) => q.id));
  if (picked.length < targetCount) {
    const remaining = pool.filter((q) => !pickedIds.has(q.id));
    picked.push(...remaining.slice(0, targetCount - picked.length));
  }

  return picked.slice(0, targetCount);
};

const applyQuestionRatio = (candidates, targetQuestionTypes = {}, difficultyDistribution = {}, cognitiveDistribution = {}) => {
  const mcTarget = Math.max(0, Number(targetQuestionTypes.multipleChoice || 0));
  const essayTarget = Math.max(0, Number(targetQuestionTypes.essay || 0));
  const totalTarget = mcTarget + essayTarget;

  if (!candidates.length || totalTarget === 0) {
    return candidates;
  }

  const isMultipleChoice = (q) => q.type === 'multipleChoice' || (Array.isArray(q.choices) && q.choices.length >= 2);

  const mcPool = candidates.filter(isMultipleChoice);
  const essayPool = candidates.filter((q) => !isMultipleChoice(q));

  const selectedMc = selectFromPoolByDifficultyRatio(mcPool, mcTarget, difficultyDistribution);
  const cognitiveTotal = Number(cognitiveDistribution.understanding || 0) + Number(cognitiveDistribution.application || 0);
  const selectedEssay = cognitiveTotal
    ? [
      ...selectFromPoolByDifficultyRatio(
        essayPool.filter((question) => question.cognitiveLevel === 'understanding'),
        Math.min(essayTarget, Number(cognitiveDistribution.understanding || 0)),
        difficultyDistribution,
      ),
      ...selectFromPoolByDifficultyRatio(
        essayPool.filter((question) => question.cognitiveLevel === 'application'),
        Math.min(essayTarget, Number(cognitiveDistribution.application || 0)),
        difficultyDistribution,
      ),
    ]
    : selectFromPoolByDifficultyRatio(essayPool, essayTarget, difficultyDistribution);

  const selected = [...selectedMc, ...selectedEssay];
  const usedIds = new Set(selected.map((q) => q.id));

  if (!cognitiveTotal && selected.length < totalTarget) {
    const remaining = candidates.filter((q) => !usedIds.has(q.id));
    const extra = selectFromPoolByDifficultyRatio(remaining, totalTarget - selected.length, difficultyDistribution);
    selected.push(...extra);
  }

  return selected.slice(0, totalTarget);
};

app.post('/api/documents/analyze', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  const { documentId, subject, requestedCount = 10, content = '', questionTypes = {}, difficultyDistribution = {}, cognitiveDistribution = {} } = req.body || {};
  if (!documentId) return res.status(400).json({ message: 'documentId là bắt buộc.' });
  const normalizedContent = normalizeDocumentText(content);
  if (!normalizedContent) {
    return res.status(422).json({ code: 'EMPTY_DOCUMENT_CONTENT', message: 'Không đọc được nội dung tài liệu. Không thể tạo đề khi chưa có dữ liệu nguồn.' });
  }

  const parsed = normalizedContent.split(/\r?\n/).reduce((items, line) => {
    const answerKey = line.match(/^\s*(?:đáp\s*án|answer)(?:\s+(?:đúng|tham khảo))?\s*[:：-]?\s*([A-D])\b/i);
    if (answerKey && items.length) {
      items[items.length - 1].answer = answerKey[1].toUpperCase().charCodeAt(0) - 65;
      items[items.length - 1].hasAnswerKey = true;
      return items;
    }
    const questionStart = line.match(/^\s*(?:câu\s*)?(\d+)[.)\-:]\s*(.*)$/i);
    if (questionStart) items.push({ number: questionStart[1], text: questionStart[2], choices: [], answer: 0, hasAnswerKey: false });
    else if (items.length) {
      const choice = line.match(/^\s*([A-D])[.)\-:]\s*(.*)$/i);
      if (choice) items[items.length - 1].choices.push(choice[2]);
      else if (line.trim()) items[items.length - 1].text += ` ${line.trim()}`;
    }
    return items;
  }, []);

  const poolCount = Math.min(100, Math.max(Number(requestedCount || 10), 30));
  const generation = await generateQuestionsFromDocument({
    subject,
    requestedCount: poolCount,
    content: normalizedContent,
    questionTypes,
    cognitiveDistribution,
  });
  const scannedFromContent = generation.questions;
  let parsedEssayIndex = 0;
  const formattedQuestions = parsed.map((item) => ({
    id: randomUUID(),
    text: safeQuestionText(item.text, 'Phân tích và mô tả nội dung trọng tâm của tài liệu.'),
    subject: subject || 'Chưa phân loại',
    difficulty: inferDifficulty(item.text),
    type: item.choices.length >= 2 ? 'multipleChoice' : 'essay',
    choices: item.choices.length >= 2 ? item.choices : [],
    answer: item.hasAnswerKey && item.answer < item.choices.length ? item.answer : 0,
    answerText: item.choices.length >= 2
      ? item.choices[item.hasAnswerKey && item.answer < item.choices.length ? item.answer : 0]
      : item.text,
    sourceEvidence: item.text,
    cognitiveLevel: item.choices.length >= 2 ? null : getEssayLevelForIndex(parsedEssayIndex++, cognitiveDistribution),
    rubric: item.choices.length >= 2 ? null : buildEssayRubric(getEssayLevelForIndex(parsedEssayIndex - 1, cognitiveDistribution)),
  }));

  const candidatePool = mergeQuestionCollections(formattedQuestions, scannedFromContent).map(shuffleQuestionChoices);
  if (!candidatePool.length) {
    return res.status(422).json({ code: 'NO_DOCUMENT_QUESTIONS', message: 'Không lọc được câu hỏi từ tài liệu. Hãy tải tệp có nội dung rõ hơn.' });
  }

  const targetQuestionTypes = {
    multipleChoice: Number(questionTypes.multipleChoice || 0),
    essay: Number(questionTypes.essay || 0),
  };
  const targetDifficulty = {
    easy: Number(difficultyDistribution.easy || 30),
    medium: Number(difficultyDistribution.medium || 50),
    hard: Number(difficultyDistribution.hard || 20),
  };

  const requestedLimit = Math.min(100, Math.max(1, Number(requestedCount || 10)));
  const targetCount = targetQuestionTypes.multipleChoice + targetQuestionTypes.essay;
  const selectedQuestions = targetCount
    ? applyQuestionRatio(candidatePool, targetQuestionTypes, targetDifficulty, cognitiveDistribution)
    : candidatePool.slice(0, Math.min(candidatePool.length, requestedLimit));
  const selectedIds = new Set(selectedQuestions.map((question) => question.id));
  const finalQuestions = targetCount && requestedLimit > targetCount
    ? [
      ...selectedQuestions,
      ...candidatePool.filter((question) => {
        if (selectedIds.has(question.id)) return false;
        const isMultipleChoice = question.type === 'multipleChoice' || (Array.isArray(question.choices) && question.choices.length >= 2);
        if (isMultipleChoice) return targetQuestionTypes.multipleChoice > 0;
        if (targetQuestionTypes.essay <= 0) return false;
        const requestedCognitiveCount = Number(cognitiveDistribution.understanding || 0) + Number(cognitiveDistribution.application || 0);
        return !requestedCognitiveCount || Number(cognitiveDistribution[question.cognitiveLevel] || 0) > 0;
      }),
    ].slice(0, requestedLimit)
    : selectedQuestions;

  const multipleChoiceCount = finalQuestions.filter((question) => question.type === 'multipleChoice' || (Array.isArray(question.choices) && question.choices.length >= 2)).length;
  const essayCount = finalQuestions.length - multipleChoiceCount;
  // Persist only questions generated from this document.
  const userId = req.user?.id || null;
  const persistedQuestions = [];
  for (const q of finalQuestions) {
    const dbQ = await persistQuestion(q, userId);
    if (!dbQ) {
      return res.status(503).json({ code: 'DOCUMENT_QUESTION_SAVE_FAILED', message: 'Không lưu được câu hỏi đã lọc từ tài liệu. Vui lòng thử lại.' });
    }
    questions.push(q);
    persistedQuestions.push(dbQ);
  }

  const returnedQuestions = persistedQuestions;
  const confidence = generation.usedAI ? 0.92 : formattedQuestions.some((question) => question.type === 'multipleChoice') ? 0.9 : 0.65;

  res.json({
    documentId,
    status: 'analyzed',
    candidates: returnedQuestions,
    selectedCount: returnedQuestions.length,
    questionTypes: { multipleChoice: multipleChoiceCount, essay: essayCount },
    confidence,
    generationMode: generation.usedAI ? 'ai' : 'source-extraction',
    summary: generation.usedAI
      ? `AI đã tạo ${returnedQuestions.length} câu hỏi có trích dẫn kiểm chứng từ tài liệu: ${multipleChoiceCount} trắc nghiệm, ${essayCount} tự luận.`
      : `Đã phân tích nội dung tài liệu và tạo ${returnedQuestions.length} câu hỏi: ${multipleChoiceCount} trắc nghiệm, ${essayCount} tự luận.`,
  });
});

// ══════════════════════════════════════════
//  NOTE: /api/exams/* routes are handled by
//  src/routes/examRoutes.js (registered above).
//  All generate, list, get, put, delete,
//  validate and variants are DB-backed.
// ══════════════════════════════════════════


app.post('/api/ocr/upload', authenticate, requireRole('teacher', 'admin'), (req, res) => {
  const { filename, content } = req.body || {};
  if (!filename) return res.status(400).json({ message: 'filename là bắt buộc.' });
  res.status(202).json({ id: `ocr-${Date.now()}`, filename, status: 'queued', extractedText: content || '', message: 'Tệp đã được tiếp nhận để xử lý OCR.' });
});

app.post('/api/grading/rubric', (req, res) => {
  const { submissionId = nextId('submission', submissions), criteria = [], scores = [] } = req.body || {};
  const total = criteria.reduce((sum, criterion) => sum + Number(criterion.maxScore || 0), 0);
  const earned = scores.reduce((sum, score) => sum + Number(score), 0);
  const result = { id: nextId('result', results), submissionId, score: total ? Math.round((earned / total) * 10 * 100) / 100 : 0, earned, total, status: 'completed', gradedAt: new Date().toISOString() };
  rubrics.push({ id: nextId('rubric', rubrics), submissionId, criteria });
  submissions.push({ id: submissionId, status: 'graded' });
  results.push(result);
  res.status(201).json(result);
});

app.get('/api/analytics/result', (req, res) => {
  const average = results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length * 100) / 100 : 0;
  res.json({ totalQuestions: questions.length, totalExams: exams.length, totalRooms: examRooms.length, gradedPapers: results.length, averageScore: average, results });
});

app.use((req, res) => res.status(404).json({ message: 'Endpoint không tồn tại.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(500).json({ message: 'Lỗi máy chủ.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
});

module.exports = { app, port };
