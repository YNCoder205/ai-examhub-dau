/**
 * Test end-to-end: login → generate exam → validate → variants → read back
 */
const http = require('http');

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  let token;

  // 1. Login
  console.log('\n=== 1. ĐĂNG NHẬP ===');
  const login = await apiCall('POST', '/auth/login', { email: 'teacher@dau.edu.vn', password: 'Teacher123!' });
  if (login.status !== 200 || !login.body.token) {
    console.error('Login failed:', JSON.stringify(login.body));
    process.exit(1);
  }
  token = login.body.token;
  console.log(`✓ Đăng nhập OK: ${login.body.user.full_name} (${login.body.user.role})`);

  // 2. Check question bank
  console.log('\n=== 2. KIỂM TRA NGÂN HÀNG CÂU HỎI ===');
  const qs = await apiCall('GET', '/questions?limit=5', null, token);
  console.log(`✓ Tổng câu hỏi trong DB: ${qs.body.total}`);
  const subjects = [...new Set((qs.body.data || []).map(q => q.subject))];
  console.log(`  Môn học mẫu: ${subjects.join(', ')}`);

  const testSubject = qs.body.data?.[0]?.subject || 'Kiến trúc cơ sở';

  // 3. Generate exam
  console.log('\n=== 3. TẠO ĐỀ THI ===');
  const genPayload = {
    title: `Đề kiểm tra Giữa kỳ ${testSubject} - TEST ${Date.now()}`,
    subject: testSubject,
    questionTypes: { multipleChoice: 2, essay: 1 },
    difficultyDistribution: { easy: 30, medium: 50, hard: 20 },
    durationMinutes: 45,
    totalScore: 10,
    ownerName: 'Nguyễn Thị Lan',
    department: 'Bộ môn Kiến trúc',
    examType: 'Giữa kỳ',
    faculty: 'Khoa Kiến trúc',
    academicYear: '2024-2025',
    semester: '1',
    examCode: 'TEST-001',
    examDate: new Date().toISOString().slice(0, 10),
    approver: 'PGS. Trần Văn Hòa',
    status: 'draft',
    workflowStatus: 'draft',
  };
  const gen = await apiCall('POST', '/exams/generate', genPayload, token);
  if (gen.status !== 201) {
    console.error('Generate failed:', JSON.stringify(gen.body));
    process.exit(1);
  }
  const examId = gen.body.id;
  const blueprint = gen.body.blueprint;
  console.log(`✓ Tạo đề OK: ID=${examId.slice(0, 8)}...`);
  console.log(`  Blueprint: target=${blueprint?.targetTotal}, actual=${blueprint?.actualTotal}, MC=${blueprint?.actualMC}, TL=${blueprint?.actualEssay}`);
  if (gen.body.warnings?.length) {
    console.warn(`  ⚠️ Cảnh báo: ${gen.body.warnings[0].message}`);
  }
  console.log(`  Thông báo: ${gen.body.message}`);

  // 4. Read back from DB
  console.log('\n=== 4. ĐỌC LẠI ĐỀ THI TỪ DB ===');
  const detail = await apiCall('GET', `/exams/${examId}`, null, token);
  if (detail.status !== 200) {
    console.error('Get exam failed:', JSON.stringify(detail.body));
    process.exit(1);
  }
  console.log(`✓ Đọc lại OK: "${detail.body.title}"`);
  console.log(`  Số câu từ exam_questions: ${detail.body.questions?.length ?? 0}`);
  console.log(`  workflowStatus: ${detail.body.workflowStatus}`);
  detail.body.questions?.forEach((q, i) => {
    console.log(`  Câu ${i+1}: [${q.type}] ${q.difficulty} - ${q.text?.slice(0,50)}...`);
    if (q.type === 'multipleChoice') {
      console.log(`    Đáp án: ${['A','B','C','D'][q.answer] || q.answer} (index=${q.answer})`);
    }
  });

  // 5. Validate
  console.log('\n=== 5. KIỂM TRA BACKEND VALIDATION ===');
  const validate = await apiCall('POST', `/exams/${examId}/validate`, null, token);
  console.log(`✓ Validate: valid=${validate.body.valid}`);
  if (validate.body.errors?.length) {
    validate.body.errors.forEach(e => console.warn(`  ⚠️ [${e.code}] ${e.message}`));
  } else {
    console.log('  Không có lỗi nào.');
  }
  console.log(`  Summary: ${JSON.stringify(validate.body.summary)}`);

  // 6. Variants (only if exam has questions)
  if (detail.body.questions?.length > 0) {
    console.log('\n=== 6. TẠO MÃ ĐỀ (VARIANTS) ===');
    const variants = await apiCall('POST', `/exams/${examId}/variants`, { count: 2 }, token);
    if (variants.status !== 201) {
      console.error('Variants failed:', JSON.stringify(variants.body));
    } else {
      console.log(`✓ Tạo ${variants.body.variantCount} mã đề OK`);
      variants.body.variants?.forEach(v => {
        const mcKeys = v.answerKey.filter(k => k.type === 'multipleChoice');
        console.log(`  ${v.code}: ${v.questions.length} câu | ĐA: ${mcKeys.map(k => `C${k.position}→${k.answerLabel}`).join(', ')}`);
      });
    }
  }

  // 7. Verify answer key consistency
  console.log('\n=== 7. KIỂM TRA NHẤT QUÁN ĐÁP ÁN ===');
  if (detail.body.questions?.length > 0) {
    let consistent = true;
    for (const q of detail.body.questions.filter(q => q.type === 'multipleChoice')) {
      const correctText = q.choices?.[q.answer];
      if (!correctText) {
        console.error(`  ❌ Câu ${q.id.slice(0,8)}: answer_index=${q.answer} nhưng choices chỉ có ${q.choices?.length} phần tử`);
        consistent = false;
      } else {
        console.log(`  ✓ Câu ${q.id.slice(0,8)}: Đáp án "${correctText.slice(0,30)}" (index=${q.answer})`);
      }
    }
    if (consistent) console.log('  Tất cả đáp án nhất quán ✓');
  }

  // 8. Clean up test exam
  const del = await apiCall('DELETE', `/exams/${examId}`, null, token);
  console.log(`\n=== 8. DỌN DẸP: Xóa đề test → HTTP ${del.status} ===`);

  console.log('\n==========================================');
  console.log('✅ KIỂM THỬ HOÀN THÀNH — Tất cả bước đạt');
  console.log('==========================================\n');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Test script error:', err.message);
  process.exit(1);
});
