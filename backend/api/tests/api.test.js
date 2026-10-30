const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { app } = require('../src/app');
const { query } = require('../src/config/db');

let server;
let baseUrl;

const authHeaders = (token) => ({ Authorization: ['Bearer', token].join(' ') });

async function createPrivilegedToken(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}@examhub.test`;
  const passwordHash = await bcrypt.hash('Password123', 4);
  await query(
    'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
    [email, passwordHash, `Test ${role}`, role]
  );

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123' }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200, `${role} login should succeed`);
  assert.equal(loginBody.user.role, role);
  return loginBody.token;
}

const createTeacherToken = () => createPrivilegedToken('teacher');

async function createStudentToken() {
  const email = `student-${Date.now()}-${Math.random().toString(16).slice(2)}@examhub.test`;
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ full_name: 'Test Student', email, password: 'Password123', role: 'student' }),
  });
  assert.equal(register.status, 201, 'student registration should succeed');

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123' }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200, 'student login should succeed');
  return loginBody.token;
}

async function createAdminToken() {
  return createPrivilegedToken('admin');
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('current-user endpoint refreshes authentication claims after role changes', async () => {
  const email = `role-refresh-${Date.now()}@examhub.test`;
  const passwordHash = await bcrypt.hash('Password123', 4);
  await query(
    'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
    [email, passwordHash, 'Role Refresh Test', 'student']
  );

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123' }),
    });
    const { token: staleToken } = await login.json();
    assert.equal(login.status, 200);

    await query('UPDATE users SET role = $1 WHERE email = $2', ['teacher', email]);

    const currentUserResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(staleToken),
    });
    const currentUser = await currentUserResponse.json();
    assert.equal(currentUserResponse.status, 200);
    assert.equal(currentUser.user.role, 'teacher');
    assert.ok(currentUser.token);

    const analyzeResponse = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(currentUser.token) },
      body: JSON.stringify({ documentId: 'role-refresh-test', content: '' }),
    });
    assert.equal(analyzeResponse.status, 422);
    assert.equal((await analyzeResponse.json()).code, 'EMPTY_DOCUMENT_CONTENT');

    await query('UPDATE users SET role = $1 WHERE email = $2', ['student', email]);
    const refreshedStudentResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(currentUser.token),
    });
    const refreshedStudent = await refreshedStudentResponse.json();
    assert.equal(refreshedStudentResponse.status, 200);
    assert.equal(refreshedStudent.user.role, 'student');

    const studentHistoryResponse = await fetch(`${baseUrl}/api/exam-rooms/my-attempts`, {
      headers: authHeaders(refreshedStudent.token),
    });
    assert.equal(studentHistoryResponse.status, 200);
  } finally {
    await query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('admin can manage accounts and gets system-wide role counts', async () => {
  const token = await createAdminToken();
  const headers = { 'content-type': 'application/json', ...authHeaders(token) };
  const listResponse = await fetch(`${baseUrl}/api/users?page=1&limit=1`, { headers });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.data.length, 1);
  assert.ok(list.roleCounts.admin > 0);
  assert.ok(list.roleCounts.teacher >= 0);
  assert.ok(list.roleCounts.student >= 0);

  const invalidPage = await fetch(`${baseUrl}/api/users?page=0`, { headers });
  assert.equal(invalidPage.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: `managed-${Date.now()}@examhub.test`,
      password: 'Password123',
      full_name: 'Managed User',
      role: 'teacher',
      institutional_id: `STAFF-${Date.now()}`,
      faculty: 'Khoa Kiến trúc',
      department: 'Bộ môn Thiết kế',
    }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(created.role, 'teacher');
  assert.equal(created.faculty, 'Khoa Kiến trúc');
  assert.equal(created.department, 'Bộ môn Thiết kế');

  const createdLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: created.email, password: 'Password123' }),
  });
  assert.equal(createdLogin.status, 200, 'newly created account should be able to sign in');
  assert.equal((await createdLogin.json()).user.role, 'teacher');

  const updateResponse = await fetch(`${baseUrl}/api/users/${created.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ email: `managed-updated-${Date.now()}@examhub.test`, role: 'student' }),
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.match(updated.email, /^managed-updated-/);
  assert.equal(updated.role, 'student');
});

test('admin can bulk-create university accounts and skip existing IDs with generated credentials', async () => {
  const token = await createAdminToken();
  const headers = { 'content-type': 'application/json', ...authHeaders(token) };
  const unique = `bulk-${Date.now()}`;
  const accounts = [
    {
      email: `${unique}-student@examhub.test`,
      full_name: 'Bulk Student',
      role: 'student',
      password: 'StudentPass123',
      institutional_id: `STU-${unique}`,
      faculty: 'Khoa Kiến trúc',
      department: 'Ngành Kiến trúc',
      cohort: 'K26',
      class_name: '26KT1',
    },
    {
      email: `${unique}-teacher@examhub.test`,
      full_name: 'Bulk Teacher',
      role: 'teacher',
      password: 'TeacherPass123',
      institutional_id: `STAFF-${unique}`,
      faculty: 'Khoa Xây dựng',
      department: 'Bộ môn Kết cấu',
    },
    {
      email: `${unique}-generated@examhub.test`,
      full_name: 'Generated Password Student',
      institutional_id: `STU-GEN-${unique}`,
      faculty: 'Khoa Kiến trúc',
    },
  ];
  const response = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ users: accounts }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.createdCount, 3);
  assert.equal(result.data[0].institutional_id, `STU-${unique}`);
  assert.equal(result.credentials.length, 1);
  assert.equal(result.credentials[0].email, accounts[2].email);

  const studentLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: accounts[0].email, password: accounts[0].password }),
  });
  assert.equal(studentLogin.status, 200);

  const generatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: result.credentials[0].email,
      password: result.credentials[0].initial_password,
    }),
  });
  assert.equal(generatedLogin.status, 200, 'generated initial password should sign in');
  assert.equal((await generatedLogin.json()).user.role, 'student');

  const duplicateResponse = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      users: [
        {
          email: `${unique}-new@examhub.test`,
          full_name: 'Not Created',
          role: 'student',
          password: 'StudentPass123',
        },
        {
          ...accounts[0],
          email: `${unique}-duplicate-code@examhub.test`,
        },
      ],
    }),
  });
  const duplicateResult = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicateResult.createdCount, 1);
  assert.equal(duplicateResult.skippedCount, 1);

  const listResponse = await fetch(`${baseUrl}/api/users?search=${encodeURIComponent(`${unique}-new@examhub.test`)}`, { headers });
  const list = await listResponse.json();
  assert.equal(list.total, 1, 'non-duplicate users should be created when another row conflicts');
});

test('admin can delete all users matching filters without deleting their own account', async () => {
  const token = await createAdminToken();
  const headers = { 'content-type': 'application/json', ...authHeaders(token) };
  const search = `bulk-delete-${Date.now()}`;
  const createTestUser = async (suffix) => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: `${search}-${suffix}@examhub.test`,
        password: 'Password123',
        full_name: `Bulk delete ${suffix}`,
        role: 'teacher',
      }),
    });
    assert.equal(response.status, 201);
  };
  await Promise.all([createTestUser('one'), createTestUser('two')]);

  const noFilterResponse = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ confirmation: 'DELETE_FILTERED_USERS' }),
  });
  assert.equal(noFilterResponse.status, 400);

  const missingConfirmationResponse = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ role: 'teacher' }),
  });
  assert.equal(missingConfirmationResponse.status, 400);

  const response = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ role: 'teacher', search, confirmation: 'DELETE_FILTERED_USERS' }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.deletedCount, 2);

  const adminCheck = await fetch(`${baseUrl}/api/users?search=${encodeURIComponent(search)}`, { headers });
  const remaining = await adminCheck.json();
  assert.equal(adminCheck.status, 200);
  assert.equal(remaining.total, 0);

  const ownAccountResponse = await fetch(`${baseUrl}/api/auth/me`, { headers });
  assert.equal(ownAccountResponse.status, 200);
  const ownAccount = await ownAccountResponse.json();
  const otherAdminEmail = `bulk-admin-${Date.now()}@examhub.test`;
  const otherAdminResponse = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: otherAdminEmail,
      password: 'Password123',
      full_name: 'Bulk Admin Target',
      role: 'admin',
    }),
  });
  assert.equal(otherAdminResponse.status, 201);

  const adminBulkResponse = await fetch(`${baseUrl}/api/users/bulk`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({
      role: 'admin',
      search: otherAdminEmail,
      confirmation: 'DELETE_FILTERED_USERS',
    }),
  });
  assert.equal(adminBulkResponse.status, 200);
  assert.equal((await adminBulkResponse.json()).deletedCount, 1);
  const ownAccountAfterDelete = await fetch(`${baseUrl}/api/auth/me`, { headers });
  assert.equal(ownAccountAfterDelete.status, 200);
  assert.equal((await ownAccountAfterDelete.json()).user.id, ownAccount.user.id);
});

test('student cannot access full administrative analytics', async () => {
  const token = await createStudentToken();
  const response = await fetch(`${baseUrl}/api/analytics/dashboard`, {
    headers: authHeaders(token),
  });
  assert.equal(response.status, 403);
});

test('public registration cannot grant admin or teacher roles', async () => {
  for (const role of ['admin', 'teacher']) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        full_name: `Unauthorized ${role}`,
        email: `unauthorized-${role}-${Date.now()}@examhub.test`,
        password: 'Password123',
        role,
      }),
    });
    assert.equal(response.status, 403);
  }
});

test('health endpoint reports an operational API', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('CORS preflight accepts the local Vite frontend origin', async () => {
  const response = await fetch(`${baseUrl}/api/documents/upload`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('questions endpoint returns seeded questions', async () => {
  const response = await fetch(`${baseUrl}/api/questions?difficulty=easy`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.total > 0);
  assert.ok(body.data.every((question) => question.difficulty === 'easy'));
});

test('exam generation creates an exam from selected questions', async () => {
  const token = await createTeacherToken();
  const response = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'Bài kiểm tra mẫu', questionIds: ['q-001', 'q-002'] }),
  });
  const exam = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(exam.questionIds, ['q-001', 'q-002']);
});

test('exam generation persists the record in the database', async () => {
  const token = await createTeacherToken();
  const title = `DB persistence ${Date.now()}`;
  const response = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title, subject: 'Kiến trúc cơ sở', questionIds: ['q-001', 'q-002'] }),
  });
  const exam = await response.json();
  assert.equal(response.status, 201);
  const result = await query('SELECT id, title, subject FROM exams WHERE id = $1', [exam.id]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, title);
  assert.equal(result.rows[0].subject, 'Kiến trúc cơ sở');
});

test('teacher auth should be required before generating exams', async () => {
  const withoutToken = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Protected exam', subject: 'Kiến trúc cơ sở', questionIds: ['q-001'] }),
  });
  assert.equal(withoutToken.status, 401);

  const token = await createTeacherToken();

  const withToken = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'Teacher exam', subject: 'Kiến trúc cơ sở', questionIds: ['q-001'] }),
  });
  assert.equal(withToken.status, 201);
});

test('Google OAuth is configuration-gated and rejects invalid state', async () => {
  const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'API_PUBLIC_URL', 'FRONTEND_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    process.env.FRONTEND_URL = 'http://localhost:5173';
    const disabledResponse = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    assert.equal(disabledResponse.status, 303);
    assert.equal(new URL(disabledResponse.headers.get('location')).hash, '#google_error=google_not_configured');

    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    assert.equal(startResponse.status, 302);
    const authorizationUrl = new URL(startResponse.headers.get('location'));
    assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
    assert.equal(authorizationUrl.searchParams.get('client_id'), 'test-client-id');
    assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email profile');
    assert.ok(startResponse.headers.get('set-cookie').includes('HttpOnly'));
    assert.ok(startResponse.headers.get('set-cookie').includes('SameSite=Lax'));

    const invalidStateResponse = await fetch(
      `${baseUrl}/api/auth/google/callback?code=unused-code&state=invalid`,
      {
        headers: { Cookie: 'examhub_google_oauth_state=expected' },
        redirect: 'manual',
      }
    );
    assert.equal(invalidStateResponse.status, 303);
    assert.equal(new URL(invalidStateResponse.headers.get('location')).hash, '#google_error=google_state_invalid');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('users can update profile details, avatar and change password securely', async () => {
  const email = `profile-${Date.now()}@examhub.test`;
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ full_name: 'Profile Student', email, password: 'Password123' }),
  });
  assert.equal(registration.status, 201);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123' }),
  });
  const { token } = await login.json();
  assert.equal(login.status, 200);

  const avatar = `data:image/png;base64,${Buffer.from('test-avatar').toString('base64')}`;
  const profileResponse = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({
      full_name: 'Profile Student Updated',
      email: `profile-updated-${Date.now()}@examhub.test`,
      phone: '0905123456',
      avatar_url: avatar,
    }),
  });
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.user.full_name, 'Profile Student Updated');
  assert.equal(profile.user.phone, '0905123456');
  assert.equal(profile.user.avatar_url, avatar);

  const invalidAvatarResponse = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({
      full_name: profile.user.full_name,
      email: profile.user.email,
      phone: profile.user.phone,
      avatar_url: 'https://example.test/avatar.jpg',
    }),
  });
  assert.equal(invalidAvatarResponse.status, 400);

  const wrongPasswordResponse = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ current_password: 'incorrect', new_password: 'NewPassword123' }),
  });
  assert.equal(wrongPasswordResponse.status, 400);

  const changePasswordResponse = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ current_password: 'Password123', new_password: 'NewPassword123' }),
  });
  assert.equal(changePasswordResponse.status, 200);

  const newLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: profile.user.email, password: 'NewPassword123' }),
  });
  assert.equal(newLoginResponse.status, 200);
  assert.equal((await newLoginResponse.json()).user.avatar_url, avatar);
});


test('exam CRUD and shuffled variants work', async () => {
  const token = await createTeacherToken();
  const createResponse = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'CRUD exam', subject: 'Kiến trúc cơ sở', questionIds: ['q-001', 'q-002'] }),
  });
  const created = await createResponse.json();
  const updateResponse = await fetch(`${baseUrl}/api/exams/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Updated exam' }),
  });
  assert.equal((await updateResponse.json()).title, 'Updated exam');
  const variantResponse = await fetch(`${baseUrl}/api/exams/${created.id}/variants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count: 3 }),
  });
  const variants = (await variantResponse.json()).variants;
  assert.deepEqual(variants.map((variant) => variant.code), ['MA', 'MB', 'MC']);
  assert.notDeepEqual(variants[0].questions.map((question) => question.id), variants[1].questions.map((question) => question.id));
  const deleteResponse = await fetch(`${baseUrl}/api/exams/${created.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(deleteResponse.status, 204);
});

test('document analysis returns relevant candidates and exam details', async () => {
  const token = await createTeacherToken();
  const uploadResponse = await fetch(`${baseUrl}/api/documents/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filename: 'bai-giang.pdf', size: 2048, mimeType: 'application/pdf' }),
  });
  const document = await uploadResponse.json();
  const analysisResponse = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      documentId: document.id,
      subject: 'Kiến trúc cơ sở',
      requestedCount: 2,
      content: 'Tổ chức không gian là nguyên tắc nền tảng trong thiết kế kiến trúc công trình.',
    }),
  });
  const analysis = await analysisResponse.json();
  assert.equal(analysis.status, 'analyzed');
  assert.equal(analysis.candidates.length, 1);
  assert.ok(analysis.candidates[0].answerText, 'generated question should include a reference answer');
  assert.equal(analysis.candidates[0].sourceEvidence, 'Tổ chức không gian là nguyên tắc nền tảng trong thiết kế kiến trúc công trình.');
  const createResponse = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Exam detail',
      subject: 'Kiến trúc cơ sở',
      questionIds: analysis.candidates.map((question) => question.id),
      questionTypes: analysis.questionTypes,
      document: { id: document.id, filename: document.filename },
    }),
  });
  const created = await createResponse.json();
  const detailResponse = await fetch(`${baseUrl}/api/exams/${created.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const detail = await detailResponse.json();
  assert.equal(detail.questions[0].id, analysis.candidates[0].id);
  assert.equal(detail.questions[0].answerText, analysis.candidates[0].answerText);
  assert.equal(detail.questions[0].sourceEvidence, analysis.candidates[0].sourceEvidence);
  assert.equal(detail.document.filename, document.filename);

  const studentToken = await createStudentToken();
  const studentDetailResponse = await fetch(`${baseUrl}/api/exams/${created.id}`, { headers: { Authorization: `Bearer ${studentToken}` } });
  const studentDetail = await studentDetailResponse.json();
  assert.equal(studentDetail.questions[0].answerText, undefined);
  assert.equal(studentDetail.questions[0].sourceEvidence, undefined);
});

test('document analysis classifies multiple-choice and essay questions', async () => {
  const token = await createTeacherToken();
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      documentId: 'doc-mixed', subject: 'Kiến trúc cơ sở', requestedCount: 2,
      content: 'Câu 1. Công năng của mặt bằng là gì?\nA. Tổ chức không gian\nB. Trang trí mặt đứng\nC. Tính kết cấu\nD. Lập dự toán\nĐáp án: B\nCâu 2. Phân tích vai trò của ánh sáng tự nhiên trong công trình.',
    }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(analysis.questionTypes, { multipleChoice: 1, essay: 1 });
  assert.equal(analysis.candidates[0].type, 'multipleChoice');
  assert.equal(analysis.candidates[0].choices.length, 4);
  assert.equal(analysis.candidates[0].choices[analysis.candidates[0].answer], 'Trang trí mặt đứng');
  assert.equal(analysis.candidates[1].type, 'essay');
});

test('definition passages create direct concept questions with the definition as the keyed answer', async () => {
  const token = await createTeacherToken();
  const content = [
    'CNTT là việc sử dụng máy tính, phần mềm và mạng để xử lý, lưu trữ, truyền tải thông tin trong tổ chức và xã hội.',
    'Phần mềm là tập hợp các chương trình và dữ liệu hướng dẫn máy tính thực hiện một nhiệm vụ cụ thể.',
    'Mạng máy tính là hệ thống các thiết bị được kết nối để trao đổi dữ liệu và chia sẻ tài nguyên.',
    'Cơ sở dữ liệu là tập hợp dữ liệu có tổ chức được lưu trữ để truy xuất và quản lý hiệu quả.',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-definition-question', subject: 'Tin học', requestedCount: 1, content }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  const question = analysis.candidates[0];
  assert.equal(question.text, 'CNTT là gì?');
  assert.equal(question.choices[question.answer], 'việc sử dụng máy tính, phần mềm và mạng để xử lý, lưu trữ, truyền tải thông tin trong tổ chức và xã hội');
});

test('multiple-choice options stay unique and scale distractor similarity with difficulty', async () => {
  const token = await createTeacherToken();
  const content = [
    'CPU là bộ xử lý trung tâm của máy tính.',
    'RAM là bộ nhớ tạm thời tốc độ cao giúp máy tính truy xuất dữ liệu đang sử dụng.',
    'GPU là bộ xử lý chuyên dụng thực hiện song song các phép tính đồ họa và hỗ trợ xử lý tác vụ đa phương tiện phức tạp.',
    'SSD là thiết bị lưu trữ dữ liệu bằng bộ nhớ flash, cho phép truy xuất nhanh và không có bộ phận cơ học chuyển động.',
    'Mạng máy tính là hệ thống bao gồm nhiều thiết bị kết nối, giao thức truyền thông và hạ tầng mạng để trao đổi dữ liệu, chia sẻ tài nguyên, phối hợp xử lý thông tin trong phạm vi cục bộ hoặc toàn cầu.',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-difficulty-distractors', subject: 'Tin học', requestedCount: 5, content }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  const multipleChoice = analysis.candidates.filter((question) => question.type === 'multipleChoice');
  for (const question of multipleChoice) {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices.map((choice) => choice.toLocaleLowerCase('vi-VN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim())).size, 4);
  }
  const easyQuestion = multipleChoice.find((question) => question.difficulty === 'easy');
  const hardQuestion = multipleChoice.find((question) => question.difficulty === 'hard');
  assert.ok(easyQuestion);
  assert.ok(hardQuestion);
  const distractors = (question) => question.choices
    .filter((_, index) => index !== question.answer)
    .map((choice) => choice.toLocaleLowerCase('vi-VN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
    .sort();
  assert.notDeepEqual(distractors(easyQuestion), distractors(hardQuestion));
});

test('related distractors vary across generations while the keyed answer stays correct', async () => {
  const token = await createTeacherToken();
  const content = [
    'CPU là bộ xử lý trung tâm điều khiển và thực hiện các phép tính của máy tính.',
    'RAM là bộ nhớ tạm thời lưu dữ liệu và chương trình đang được CPU xử lý.',
    'GPU là bộ xử lý đồ họa chuyên thực hiện song song các phép tính hình ảnh.',
    'SSD là thiết bị lưu trữ dữ liệu bằng chip nhớ flash và cho tốc độ truy xuất cao.',
    'Hệ điều hành là phần mềm quản lý phần cứng và điều phối tài nguyên máy tính.',
    'Mạng máy tính là tập hợp thiết bị kết nối để trao đổi dữ liệu và chia sẻ tài nguyên.',
    'Cơ sở dữ liệu là tập hợp dữ liệu có tổ chức nhằm hỗ trợ truy xuất và quản lý.',
    'Phần mềm ứng dụng là chương trình hỗ trợ người dùng hoàn thành một nhóm công việc cụ thể.',
  ].join('\n');
  const distractorSets = new Set();

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentId: `doc-random-options-${attempt}`, subject: 'Tin học', requestedCount: 1, content }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    const question = analysis.candidates[0];
    assert.equal(question.choices.length, 4);
    const correctAnswer = question.choices[question.answer];
    assert.match(correctAnswer, /^bộ xử lý trung tâm/);
    const wrongAnswers = question.choices.filter((_, index) => index !== question.answer);
    assert.equal(new Set(wrongAnswers.map((choice) => choice.toLocaleLowerCase('vi-VN'))).size, 3);
    assert.ok(wrongAnswers.every((choice) => choice.length >= 18 && !/[,;:]$/.test(choice)), 'distractors should be complete, natural options rather than clipped fragments');
    distractorSets.add(question.choices.filter((_, index) => index !== question.answer).sort().join('|'));
  }

  assert.ok(distractorSets.size > 1, 'repeated generations should be able to select different related distractors');
});

test('document facts produce direct questions about components, purpose, and effects', async () => {
  const token = await createTeacherToken();
  const content = [
    'CNTT gồm phần cứng, phần mềm, dữ liệu và mạng máy tính.',
    'Phần mềm được sử dụng để điều khiển phần cứng và xử lý dữ liệu theo yêu cầu.',
    'Ánh sáng tự nhiên ảnh hưởng trực tiếp đến độ rọi và tiện nghi thị giác trong không gian.',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-structured-facts', subject: 'Tin học', requestedCount: 3, content }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  assert.equal(analysis.candidates[0].text, 'CNTT gồm những thành phần nào?');
  assert.match(analysis.candidates[1].text, /mục đích hoặc chức năng của Phần mềm/i);
  assert.match(analysis.candidates[2].text, /Yếu tố nào chịu ảnh hưởng trực tiếp từ Ánh sáng tự nhiên/i);
  assert.ok(analysis.candidates.every((question) => question.choices[question.answer].length > 0));
  for (const question of analysis.candidates) {
    const correctAnswer = question.choices[question.answer];
    assert.ok(
      question.sourceEvidence.toLocaleLowerCase('vi-VN').includes(correctAnswer.toLocaleLowerCase('vi-VN')),
      'the keyed answer should be directly supported by its cited source passage',
    );
  }
});

test('document relations generate natural role and consequence questions', async () => {
  const token = await createTeacherToken();
  const content = [
    'Hệ điều hành có vai trò quan trọng trong việc quản lý tài nguyên và điều phối hoạt động của máy tính.',
    'Thiết kế không hợp lý dẫn đến lãng phí năng lượng và giảm tiện nghi sử dụng trong công trình.',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-role-consequence', subject: 'Tin học', requestedCount: 2, content }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  assert.equal(analysis.candidates[0].text, 'Vai trò của Hệ điều hành là gì?');
  assert.equal(analysis.candidates[1].text, 'Hệ quả chính của Thiết kế không hợp lý là gì?');
  for (const question of analysis.candidates) {
    assert.ok(!question.text.toLocaleLowerCase('vi-VN').includes(question.choices[question.answer].toLocaleLowerCase('vi-VN')));
  }
});

test('document fallback varies question prompts across source passages', async () => {
  const token = await createTeacherToken();
  const content = [
    'Nguyên tắc thứ nhất tổ chức không gian theo công năng thực tế của từng khu vực.',
    'Ánh sáng tự nhiên góp phần tạo nên chất lượng môi trường bên trong công trình.',
    'Tỷ lệ bản vẽ giúp biểu diễn chính xác kích thước công trình trên mặt giấy.',
    'Thông gió chéo giữ vị trí quan trọng trong thiết kế nhà ở và không gian sinh hoạt.',
    'Vật liệu xây dựng cần phù hợp với điều kiện khí hậu và yêu cầu vận hành công trình.',
    'Kết cấu chịu lực truyền tải trọng an toàn xuống nền đất thông qua hệ thống móng.',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-varied-prompts', subject: 'Kiến trúc', requestedCount: 6, content }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  for (const question of analysis.candidates) {
    assert.match(question.text, /[.!?]$/);
    assert.doesNotMatch(question.text, /[.!?]{2,}$/);
    assert.doesNotMatch(question.text, /[.!?]["”]\?$/);
  }
  assert.ok(analysis.candidates.every((question) => !/trong tài liệu|theo tài liệu|theo văn bản/i.test(question.text)));
});

test('document question generation preserves accurate sentence boundaries and abbreviations', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const content = [
    'PGS. TS. Nguyễn Văn An cho biết RAM lưu tạm dữ liệu',
    'đang được CPU xử lý. Tại TP. HCM, các phòng máy kiểm soát nhiệt độ để thiết bị hoạt động ổn định.',
    'Tốc độ truyền tải có thể đạt 3.5 GHz trong một số điều kiện thử nghiệm.',
  ].join('\n');

  try {
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        documentId: 'doc-accurate-sentence-boundaries',
        subject: 'Tin học',
        requestedCount: 10,
        content,
      }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    const evidence = analysis.candidates.map((question) => question.sourceEvidence);
    assert.ok(evidence.some((sentence) => sentence.includes('PGS. TS. Nguyễn Văn An')));
    assert.ok(evidence.some((sentence) => sentence.includes('RAM lưu tạm dữ liệu đang được CPU xử lý.')));
    assert.ok(evidence.some((sentence) => sentence.includes('Tại TP. HCM, các phòng máy')));
    assert.ok(evidence.some((sentence) => sentence.includes('3.5 GHz')));
    assert.ok(evidence.every((sentence) => !sentence.includes('CPU xử lý. Tại TP. HCM')));
  } finally {
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
  }
});

test('document analysis rejects empty content instead of using question-bank items', async () => {
  const token = await createTeacherToken();
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId: 'doc-empty-source', subject: 'Kiến trúc cơ sở', requestedCount: 2 }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, 'EMPTY_DOCUMENT_CONTENT');
  assert.equal(body.candidates, undefined);
});

test('document-backed exam generation rejects legacy IDs instead of creating placeholder questions', async () => {
  const token = await createTeacherToken();
  const response = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Exam from uploaded file',
      subject: 'Kiến trúc cơ sở',
      questionIds: ['q-001'],
      questionTypes: { multipleChoice: 1, essay: 0 },
      document: { id: 'doc-uploaded', filename: 'source.txt' },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, 'DOCUMENT_QUESTIONS_REQUIRED');
});

test('document fallback creates mixed question candidates from source passages', async () => {
  const token = await createTeacherToken();
  const content = 'Mô hình MVC gồm ba tầng: model, view, controller. Tầng model lưu dữ liệu và quy tắc nghiệp vụ. Tầng view hiển thị giao diện người dùng.';
  const response = await fetch(`${baseUrl}/api/documents/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      documentId: 'doc-content-grounded',
      subject: 'Lập trình hướng đối tượng',
      requestedCount: 3,
      content,
    }),
  });
  const analysis = await response.json();
  assert.equal(response.status, 200);
  assert.equal(analysis.questionTypes.multipleChoice, 2);
  assert.equal(analysis.questionTypes.essay, 1);
  assert.ok(analysis.candidates.some((candidate) => candidate.type === 'multipleChoice' && candidate.choices.length === 4));
  assert.ok(analysis.candidates.some((candidate) => candidate.type === 'essay'));
  assert.ok(analysis.candidates.some((candidate) => candidate.text.toLowerCase().includes('mô hình mvc')));
  for (const question of analysis.candidates.filter((candidate) => candidate.type === 'multipleChoice')) {
    const answerText = question.choices[question.answer].toLocaleLowerCase('vi-VN');
    assert.ok(!question.text.toLocaleLowerCase('vi-VN').includes(answerText));
  }
});

test('document analysis still returns candidates when no LLM is configured', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        documentId: 'doc-no-llm-answer-key',
        subject: 'Kiến trúc cơ sở',
        requestedCount: 1,
        questionTypes: { multipleChoice: 1, essay: 0 },
        content: 'Ánh sáng tự nhiên ảnh hưởng trực tiếp đến chất lượng môi trường bên trong công trình.',
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.candidates.length, 1);
    assert.equal(body.questionTypes.multipleChoice, 0);
    assert.equal(body.questionTypes.essay, 1);
  } finally {
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
  }
});

test('AI-generated questions allow original wording and lesson-related paraphrased choices', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  const sourceEvidence = 'RAM lưu tạm thời dữ liệu và chương trình mà bộ xử lý đang sử dụng, để hệ thống truy cập nhanh khi thực hiện tác vụ.';
  const generatedQuestion = {
    text: 'Một ứng dụng đang chạy cần truy xuất nhanh thông tin. Thành phần nào giữ những dữ liệu cần thiết cho tác vụ hiện tại?',
    difficulty: 'medium',
    type: 'multipleChoice',
    cognitiveLevel: null,
    choices: [
      'Bộ phận điều phối lệnh và thực hiện các phép tính của máy tính.',
      'Vùng nhớ tốc độ cao giữ dữ liệu và chương trình cần cho tác vụ đang chạy.',
      'Thiết bị lưu trữ lâu dài tệp và ứng dụng kể cả khi máy ngừng hoạt động.',
      'Bộ xử lý chuyên tăng tốc dựng hình và xử lý nội dung thị giác.',
    ],
    answerIndex: 1,
    expectedAnswer: 'RAM phù hợp vì giữ tạm dữ liệu và chương trình đang được xử lý để truy xuất nhanh.',
    sourceEvidence,
  };
  const content = [
    sourceEvidence,
    'CPU điều khiển máy tính và thực hiện các phép tính theo lệnh.',
    'GPU xử lý song song các tác vụ hình ảnh và đồ họa.',
    'SSD lưu trữ dữ liệu lâu dài bằng bộ nhớ flash.',
  ].join('\n');
  let promptText = '';
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://api.openai.com/v1/chat/completions') {
      promptText = JSON.parse(init.body).messages[0].content;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: [generatedQuestion] }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        documentId: 'doc-creative-paraphrase',
        subject: 'Tin học',
        requestedCount: 3,
        content,
      }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    assert.equal(analysis.generationMode, 'ai');
    assert.match(promptText, /không cần trùng nguyên văn nguồn/);
    assert.match(promptText, /lựa chọn phải liên quan chủ đề bài học/);
    assert.match(promptText, /xuống dòng trong PDF\/OCR có thể chỉ là ngắt dòng trình bày/);
    assert.match(promptText, /sourceEvidence phải là đoạn trích nguyên văn liên tục/);
    const question = analysis.candidates.find((candidate) => candidate.text === generatedQuestion.text);
    assert.ok(question, 'the original scenario-based question should pass validation');
    assert.equal(question.choices[question.answer], generatedQuestion.choices[generatedQuestion.answerIndex]);
    assert.notEqual(question.choices[question.answer], sourceEvidence);
    assert.equal(new Set(question.choices).size, 4);
  } finally {
    global.fetch = originalFetch;
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('AI-generated questions accept explained background knowledge beyond the source', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  const sourceEvidence = 'Sinh sản hữu tính tạo ra thế hệ con mang những đặc điểm của cả bố và mẹ.';
  const generatedQuestion = {
    text: 'Trong quá trình hình thành giao tử ở sinh sản hữu tính, cơ chế nào có thể tạo ra các tổ hợp alen mới? Hãy xác định cơ chế đó và giải thích ngắn gọn vai trò của nó đối với sự đa dạng di truyền ở đời con.',
    difficulty: 'medium',
    type: 'multipleChoice',
    choices: [
      'Sự trao đổi chéo giữa các nhiễm sắc thể tương đồng trong giảm phân.',
      'Sự nhân đôi ADN theo nguyên tắc bổ sung trước khi tế bào phân chia.',
      'Sự phân li đồng đều của tế bào chất vào các tế bào con.',
      'Sự tổng hợp protein mới từ các axit amin trong tế bào.',
    ],
    answerIndex: 0,
    answerBasis: 'background',
    backgroundKnowledge: 'Trao đổi chéo trong giảm phân tạo các tổ hợp alen mới trên nhiễm sắc thể.',
    expectedAnswer: 'Đáp án đúng là sự trao đổi chéo giữa các nhiễm sắc thể tương đồng trong giảm phân. Quá trình này có thể hoán đổi các đoạn tương ứng, tạo ra những tổ hợp alen mới trên nhiễm sắc thể. Khi các giao tử khác nhau kết hợp trong thụ tinh, các tổ hợp mới góp phần làm đời con đa dạng về di truyền.',
    sourceEvidence,
  };
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://api.openai.com/v1/chat/completions') {
      const request = JSON.parse(init.body);
      assert.match(request.messages[0].content, /answerBasis="background"/);
      assert.match(request.messages[1].content, /đáp án tự luận nên giải thích thành 3-5 câu/);
      assert.match(request.messages[1].content, /không thêm câu chữ cho dài/);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: [generatedQuestion] }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        documentId: 'doc-background-answer',
        subject: 'Sinh học',
        requestedCount: 1,
        questionTypes: { multipleChoice: 1, essay: 0 },
        content: sourceEvidence,
      }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    assert.equal(analysis.generationMode, 'ai');
    const question = analysis.candidates.find((candidate) => candidate.text === generatedQuestion.text);
    assert.ok(question, 'a source-anchored question with explained background knowledge should pass validation');
    assert.ok(question.text.length > 100, 'the question can provide context and ask for a reasoned explanation');
    assert.ok(question.answerText.length > 200, 'the full, relevant explanation should be retained for teachers');
    assert.match(question.answerText, /các tổ hợp mới góp phần làm đời con đa dạng về di truyền/);
    assert.match(question.answerText, /Kiến thức nền bổ sung: Trao đổi chéo trong giảm phân/);
  } finally {
    global.fetch = originalFetch;
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('document fallback does not turn a sentence fragment into a question subject', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const content = [
      'Được cấu tạo từ các lớp vật liệu có khả năng cách nhiệt và chống ẩm.',
      'Thông gió chéo giúp không khí lưu thông qua các không gian ở.',
      'Ánh sáng tự nhiên cải thiện chất lượng môi trường bên trong công trình.',
      'Vật liệu phù hợp khí hậu làm tăng độ bền và hiệu quả vận hành.',
    ].join('\n');
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ documentId: 'doc-fragment-stem', subject: 'Kiến trúc', requestedCount: 4, content }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    assert.ok(analysis.candidates.length > 0);
    assert.ok(analysis.candidates.every((question) => !/đặc điểm nào được nêu về được cấu tạo từ/i.test(question.text)));
  } finally {
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
  }
});

test('document analysis applies the requested essay cognitive split and returns analytic rubrics', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const content = [
      'Ánh sáng tự nhiên cải thiện chất lượng môi trường bên trong công trình.',
      'Thông gió chéo giúp không khí lưu thông qua các không gian ở.',
      'Vật liệu phù hợp khí hậu làm tăng độ bền và hiệu quả vận hành.',
      'Kết cấu chịu lực truyền tải trọng công trình an toàn xuống nền đất.',
      'Tỷ lệ bản vẽ biểu diễn kích thước công trình trên mặt giấy.',
      'Công năng của từng khu vực quyết định cách tổ chức không gian.',
    ].join('\n');
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        documentId: 'doc-cognitive-rubric',
        subject: 'Kiến trúc',
        requestedCount: 6,
        content,
        questionTypes: { multipleChoice: 0, essay: 2 },
        cognitiveDistribution: { understanding: 1, application: 1 },
      }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    assert.equal(analysis.candidates.length, 6);
    const essayCandidates = analysis.candidates.filter((question) => question.type === 'essay');
    assert.deepEqual(
      [...new Set(essayCandidates.map((question) => question.cognitiveLevel))].sort(),
      ['application', 'understanding'],
    );
    for (const question of essayCandidates) {
      assert.equal(question.rubric.type, 'analytic');
      assert.equal(question.rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 100);
      assert.ok(question.rubric.criteria.every((criterion) => criterion.levels.length === 4));
      assert.match(question.text, /[.!?]$/);
      assert.doesNotMatch(question.text, /[.!?]{2,}$/);
      assert.doesNotMatch(question.text, /[.!?]["”]\?$/);
    }
  } finally {
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
  }
});

test('document analysis returns a diverse bank of distinct source-grounded essay questions', async () => {
  const token = await createTeacherToken();
  const configuredKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const content = [
      'Ánh sáng tự nhiên cải thiện chất lượng môi trường bên trong công trình.',
      'Thông gió chéo giúp không khí lưu thông qua các không gian ở.',
      'Vật liệu phù hợp khí hậu làm tăng độ bền và hiệu quả vận hành.',
    ].join('\n');
    const response = await fetch(`${baseUrl}/api/documents/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        documentId: 'doc-diverse-question-bank',
        subject: 'Kiến trúc',
        requestedCount: 9,
        content,
        questionTypes: { multipleChoice: 0, essay: 2 },
        cognitiveDistribution: { understanding: 1, application: 1 },
      }),
    });
    const analysis = await response.json();
    assert.equal(response.status, 200);
    assert.ok(analysis.candidates.length > 2, 'the returned bank should include alternatives beyond the exam matrix');
    assert.equal(new Set(analysis.candidates.map((question) => question.text)).size, analysis.candidates.length);
    const normalizedContent = content.toLocaleLowerCase('vi-VN');
    for (const question of analysis.candidates) {
      assert.equal(question.type, 'essay');
      assert.ok(normalizedContent.includes(question.sourceEvidence.toLocaleLowerCase('vi-VN')), `evidence should match source: ${question.sourceEvidence}`);
      assert.ok(['understanding', 'application'].includes(question.cognitiveLevel));
    }
    assert.ok(analysis.candidates.some((question) => question.cognitiveLevel === 'understanding'));
    assert.ok(analysis.candidates.some((question) => question.cognitiveLevel === 'application'));
  } finally {
    if (configuredKey) process.env.OPENAI_API_KEY = configuredKey;
  }
});

test('online exam rooms randomize safely, save attempts, auto-grade and allow student resume', async () => {
  const teacherToken = await createTeacherToken();
  const studentToken = await createStudentToken();
  const questionResponse = await fetch(`${baseUrl}/api/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({
      text: 'Online test question',
      subject: 'Online testing',
      type: 'multipleChoice',
      choices: ['Incorrect option', 'Correct option', 'Other option', 'Last option'],
      answer: 1,
    }),
  });
  assert.equal(questionResponse.status, 201);
  const question = await questionResponse.json();

  const examResponse = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({
      title: 'Online room integration exam',
      subject: 'Online testing',
      questionIds: [question.id],
      questionTypes: { multipleChoice: 1, essay: 0 },
      durationMinutes: 20,
      totalScore: 10,
    }),
  });
  assert.equal(examResponse.status, 201);
  const exam = await examResponse.json();

  const secondExamResponse = await fetch(`${baseUrl}/api/exams/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({
      title: 'Second online room exam',
      subject: 'Online testing',
      questionIds: [question.id],
      questionTypes: { multipleChoice: 1, essay: 0 },
      durationMinutes: 25,
      totalScore: 5,
    }),
  });
  assert.equal(secondExamResponse.status, 201);
  const secondExam = await secondExamResponse.json();

  const roomResponse = await fetch(`${baseUrl}/api/exam-rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({
      examIds: [exam.id, secondExam.id],
      name: 'Online test room',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  assert.equal(roomResponse.status, 201);
  const room = await roomResponse.json();
  assert.deepEqual(room.examIds, [exam.id, secondExam.id]);
  assert.equal(room.exams.length, 2);
  assert.match(room.accessCode, /^[A-F0-9]{8}$/);

  const roomsResponse = await fetch(`${baseUrl}/api/exam-rooms`, { headers: authHeaders(teacherToken) });
  const rooms = await roomsResponse.json();
  assert.equal(roomsResponse.status, 200);
  const listedRoom = rooms.data.find((item) => item.id === room.id);
  assert.deepEqual(listedRoom.examIds, [exam.id, secondExam.id]);
  assert.equal(listedRoom.exams.length, 2);

  const startResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.accessCode}/start`, {
    method: 'POST',
    headers: authHeaders(studentToken),
  });
  assert.equal(startResponse.status, 201);
  const { attempt } = await startResponse.json();
  assert.equal(attempt.status, 'in_progress');
  assert.equal(attempt.tabSwitchCount, 0);
  assert.ok(room.examIds.includes(attempt.exam.id));
  assert.equal(attempt.exam.title, attempt.exam.id === exam.id ? exam.title : secondExam.title);
  assert.equal(attempt.questions.length, 1);
  assert.equal('answer_index' in attempt.questions[0], false);
  assert.equal('answerText' in attempt.questions[0], false);
  const correctAnswer = attempt.questions[0].choices.indexOf('Correct option');
  assert.notEqual(correctAnswer, -1);
  const answers = { [question.id]: correctAnswer };
  const previouslySavedAnswers = { [question.id]: (correctAnswer + 1) % question.choices.length };
  const saveResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(studentToken) },
    body: JSON.stringify({ answers: previouslySavedAnswers, markedQuestions: [question.id], currentQuestion: 0 }),
  });
  assert.equal(saveResponse.status, 200);

  const tabSwitchResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/tab-switch`, {
    method: 'POST',
    headers: authHeaders(studentToken),
  });
  assert.equal(tabSwitchResponse.status, 201);
  assert.equal((await tabSwitchResponse.json()).tabSwitchCount, 1);

  const otherStudentToken = await createStudentToken();
  const foreignTabSwitchResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/tab-switch`, {
    method: 'POST',
    headers: authHeaders(otherStudentToken),
  });
  assert.equal(foreignTabSwitchResponse.status, 404);

  const teacherTabSwitchResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/tab-switch`, {
    method: 'POST',
    headers: authHeaders(teacherToken),
  });
  assert.equal(teacherTabSwitchResponse.status, 403);

  const monitorResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.id}/attempts`, {
    headers: authHeaders(teacherToken),
  });
  assert.equal(monitorResponse.status, 200);
  const monitor = await monitorResponse.json();
  assert.equal(monitor.room.id, room.id);
  assert.equal(monitor.attempts.length, 1);
  assert.equal(monitor.attempts[0].answeredCount, 1);
  assert.equal(monitor.attempts[0].progressPercent, 100);
  assert.equal(monitor.attempts[0].answers[question.id], previouslySavedAnswers[question.id]);
  assert.equal(monitor.attempts[0].tabSwitchCount, 1);
  assert.equal(monitor.attempts[0].recentTabSwitches.length, 1);
  assert.equal(monitor.attempts[0].student.fullName, 'Test Student');
  assert.equal(monitor.attempts[0].exam.id, attempt.exam.id);
  assert.equal('answer_index' in monitor.attempts[0].questions[0], false);

  const studentMonitorResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.id}/attempts`, {
    headers: authHeaders(studentToken),
  });
  assert.equal(studentMonitorResponse.status, 403);

  const prematureGradeResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({ score: 1 }),
  });
  assert.equal(prematureGradeResponse.status, 409);

  const submitResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(studentToken) },
    body: JSON.stringify({ answers, markedQuestions: [], currentQuestion: 0 }),
  });
  const result = await submitResponse.json();
  assert.equal(submitResponse.status, 200);
  assert.equal(result.score, attempt.exam.totalScore);
  assert.equal(result.submitted, true, 'the latest answers should submit even if they have not been autosaved yet');

  const submittedTabSwitchResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/tab-switch`, {
    method: 'POST',
    headers: authHeaders(studentToken),
  });
  assert.equal(submittedTabSwitchResponse.status, 409);

  const resumeResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.accessCode}/start`, {
    method: 'POST',
    headers: authHeaders(studentToken),
  });
  const resumed = await resumeResponse.json();
  assert.equal(resumeResponse.status, 200);
  assert.equal(resumed.attempt.status, 'submitted');
  assert.equal(resumed.attempt.exam.id, attempt.exam.id);
  assert.equal(resumed.attempt.score, attempt.exam.totalScore);
  assert.equal(resumed.attempt.tabSwitchCount, 1);

  const historyResponse = await fetch(`${baseUrl}/api/exam-rooms/my-attempts`, {
    headers: authHeaders(studentToken),
  });
  const history = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.ok(history.data.some((item) => item.id === attempt.id && Number(item.score) === attempt.exam.totalScore));

  const gradingResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.id}/grading`, {
    headers: authHeaders(teacherToken),
  });
  const grading = await gradingResponse.json();
  assert.equal(gradingResponse.status, 200);
  assert.equal(grading.room.id, room.id);
  assert.equal(grading.attempts.length, 1);
  assert.equal(grading.attempts[0].student_name, 'Test Student');
  assert.equal(grading.attempts[0].answers[question.id], correctAnswer);
  assert.equal(grading.attempts[0].questions[0].answer_index !== null, true);

  const studentGradingResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.id}/grading`, {
    headers: authHeaders(studentToken),
  });
  assert.equal(studentGradingResponse.status, 403);

  const invalidGradeResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({ score: attempt.exam.totalScore + 1 }),
  });
  assert.equal(invalidGradeResponse.status, 400);

  const manualScore = attempt.exam.totalScore / 2;
  const gradeResponse = await fetch(`${baseUrl}/api/exam-rooms/attempts/${attempt.id}/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(teacherToken) },
    body: JSON.stringify({ score: manualScore, feedback: 'Đã rà soát bài làm.' }),
  });
  const savedGrade = await gradeResponse.json();
  assert.equal(gradeResponse.status, 200);
  assert.equal(Number(savedGrade.score), manualScore);

  const updatedGradingResponse = await fetch(`${baseUrl}/api/exam-rooms/${room.id}/grading`, {
    headers: authHeaders(teacherToken),
  });
  const updatedGrading = await updatedGradingResponse.json();
  assert.equal(Number(updatedGrading.attempts[0].score), manualScore);
  assert.equal(updatedGrading.attempts[0].feedback, 'Đã rà soát bài làm.');
});

test('classrooms support Google Meet rooms, code-based student join, audience avatars, and access controls', async () => {
  const teacherToken = await createTeacherToken();
  const studentToken = await createStudentToken();
  const otherStudentToken = await createStudentToken();
  const jsonHeaders = (token) => ({ 'content-type': 'application/json', ...authHeaders(token) });

  const unauthorizedList = await fetch(`${baseUrl}/api/classrooms`);
  assert.equal(unauthorizedList.status, 401);

  const studentCreate = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'POST',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ name: 'Student room', meetUrl: 'https://meet.google.com/abc-defg-hij' }),
  });
  assert.equal(studentCreate.status, 403);

  const invalidMeetLink = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'POST',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ name: 'Invalid meeting link', meetUrl: 'https://example.com/meeting' }),
  });
  assert.equal(invalidMeetLink.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'POST',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({
      name: 'Architecture Lecture Hall',
      description: 'Studio review and presentation.',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(created.classroom.name, 'Architecture Lecture Hall');
  assert.equal(created.classroom.mode, 'google_meet');
  assert.equal(created.classroom.status, 'scheduled');
  assert.equal(created.classroom.admissionsOpen, true);
  assert.match(created.classroom.accessCode, /^[A-F0-9]{8}$/);
  assert.equal(created.classroom.audience.length, 0);

  const directCreateResponse = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'POST',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ name: 'Direct presentation room', description: 'Screen share preview only.', mode: 'direct' }),
  });
  const directCreated = await directCreateResponse.json();
  assert.equal(directCreateResponse.status, 201);
  assert.equal(directCreated.classroom.mode, 'direct');
  assert.equal(directCreated.classroom.meetUrl, null);

  const beforeJoinListResponse = await fetch(`${baseUrl}/api/classrooms`, {
    headers: authHeaders(studentToken),
  });
  assert.equal((await beforeJoinListResponse.json()).total, 0);

  const invalidCodeResponse = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ accessCode: 'bad' }),
  });
  assert.equal(invalidCodeResponse.status, 400);

  const joinResponse = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ accessCode: created.classroom.accessCode.toLowerCase() }),
  });
  const joined = await joinResponse.json();
  assert.equal(joinResponse.status, 200);
  assert.equal(joined.classroom.audience.length, 1);
  assert.match(joined.classroom.audience[0].email, /@examhub\.test$/);
  assert.ok(joined.classroom.audience[0].fullName);

  const duplicateJoin = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal((await duplicateJoin.json()).classroom.audience.length, 1);

  const secondStudentJoin = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(otherStudentToken),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal((await secondStudentJoin.json()).classroom.audience.length, 2);

  const ownerDetailResponse = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}`, {
    headers: authHeaders(teacherToken),
  });
  const ownerDetail = await ownerDetailResponse.json();
  assert.equal(ownerDetailResponse.status, 200);
  assert.equal(ownerDetail.classroom.audience.length, 2);

  const nonMemberDetail = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}`, {
    headers: authHeaders(await createStudentToken()),
  });
  assert.equal(nonMemberDetail.status, 404);

  const startResponse = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}/status`, {
    method: 'PATCH',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ status: 'live' }),
  });
  const started = await startResponse.json();
  assert.equal(started.classroom.status, 'live');
  assert.ok(started.classroom.startedAt);
  assert.equal(started.classroom.endedAt, null);

  const pauseAdmissionsResponse = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}/status`, {
    method: 'PATCH',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ admissionsOpen: false }),
  });
  assert.equal((await pauseAdmissionsResponse.json()).classroom.admissionsOpen, false);

  const memberRejoinWhilePaused = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal(memberRejoinWhilePaused.status, 200);

  const pausedJoin = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(await createStudentToken()),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal(pausedJoin.status, 409);

  const endResponse = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}/status`, {
    method: 'PATCH',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ status: 'ended' }),
  });
  const ended = await endResponse.json();
  assert.equal(endResponse.status, 200);
  assert.equal(ended.classroom.status, 'ended');
  assert.ok(ended.classroom.endedAt);
  assert.equal(ended.classroom.audience.length, 2);

  const closedJoin = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(await createStudentToken()),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal(closedJoin.status, 409);

  const reopenResponse = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}/status`, {
    method: 'PATCH',
    headers: jsonHeaders(teacherToken),
    body: JSON.stringify({ status: 'live', admissionsOpen: true }),
  });
  const reopened = await reopenResponse.json();
  assert.equal(reopenResponse.status, 200);
  assert.equal(reopened.classroom.status, 'live');
  assert.ok(reopened.classroom.startedAt);
  assert.equal(reopened.classroom.endedAt, null);
  assert.equal(reopened.classroom.admissionsOpen, true);
  assert.equal(reopened.classroom.audience.length, 2);

  const afterReopenJoin = await fetch(`${baseUrl}/api/classrooms/join`, {
    method: 'POST',
    headers: jsonHeaders(await createStudentToken()),
    body: JSON.stringify({ accessCode: created.classroom.accessCode }),
  });
  assert.equal(afterReopenJoin.status, 200);

  const studentStatusUpdate = await fetch(`${baseUrl}/api/classrooms/${created.classroom.id}/status`, {
    method: 'PATCH',
    headers: jsonHeaders(studentToken),
    body: JSON.stringify({ status: 'ended' }),
  });
  assert.equal(studentStatusUpdate.status, 403);
});
