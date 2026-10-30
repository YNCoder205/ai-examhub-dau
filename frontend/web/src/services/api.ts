const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
export const GOOGLE_AUTH_URL = `${API_URL}/auth/google`;

export type User = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'teacher' | 'student';
  avatar_url?: string | null;
  phone?: string;
  institutional_id?: string | null;
  faculty?: string | null;
  department?: string | null;
  cohort?: string | null;
  class_name?: string | null;
  created_at?: string;
};

export type LoginResponse = {
  token: string;
  user: User;
};

export type DashboardAnalytics = {
  totalQuestions: number;
  totalExams: number;
  totalRooms: number;
  gradedPapers: number;
  averageScore: number;
  totalUsers?: number;
  questionsByDifficulty?: { easy: number; medium: number; hard: number; total: number };
  examsByStatus?: { draft: number; review: number; approved: number; published: number; total: number };
  usersByRole?: { admin: number; teacher: number; student: number; total: number };
  submissionsByStatus?: { submitted: number; grading: number; graded: number; total: number };
};

function getToken(): string | null {
  return localStorage.getItem('examhub_token');
}

export function hasAuthToken(): boolean {
  return Boolean(getToken());
}

export function saveAuth(token: string, user: User): void {
  localStorage.setItem('examhub_token', token);
  localStorage.setItem('examhub_user', JSON.stringify(user));
}

export function saveUserProfile(user: User): void {
  localStorage.setItem('examhub_user', JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem('examhub_token');
  localStorage.removeItem('examhub_user');
}

export function getSavedUser(): User | null {
  const raw = localStorage.getItem('examhub_user');
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: `API request failed: ${response.status}` }));
    throw new Error(body.message || `API request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as unknown as T;
  return response.json() as Promise<T>;
}

// ── Auth ──
export const login = (email: string, password: string) => request<LoginResponse>('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});

export const getMe = () => request<{ token: string; user: User }>('/auth/me');
export const updateMyProfile = (payload: { full_name: string; email: string; phone: string; avatar_url: string | null }) =>
  request<{ user: User }>('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
export const changeMyPassword = (payload: { current_password: string; new_password: string }) =>
  request<{ message: string }>('/auth/password', { method: 'PUT', body: JSON.stringify(payload) });

// ── Users ──
export type UserListResponse = {
  data: User[];
  total: number;
  page: number;
  limit: number;
  roleCounts: { admin: number; teacher: number; student: number };
};
export const getUsers = (params?: { role?: string; search?: string; page?: number; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.role) q.set('role', params.role);
  if (params?.search) q.set('search', params.search);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return request<UserListResponse>(`/users${q.size ? `?${q}` : ''}`);
};
export type UniversityUserFields = {
  institutional_id?: string | null;
  faculty?: string | null;
  department?: string | null;
  cohort?: string | null;
  class_name?: string | null;
};
export const createUser = (payload: { email: string; password: string; full_name: string; role: string; avatar_url?: string | null; phone?: string } & UniversityUserFields) =>
  request<User>('/users', { method: 'POST', body: JSON.stringify(payload) });
export const createUsersBulk = (users: Array<{ email: string; password: string; full_name: string; role: string; phone?: string } & UniversityUserFields>) =>
  request<{
    createdCount: number;
    skippedCount: number;
    skipped: Array<{ email: string; reason: string }>;
    credentials: Array<{ email: string; full_name: string; initial_password: string }>;
    data: User[];
  }>('/users/bulk', { method: 'POST', body: JSON.stringify({ users }) });
export const updateUser = (id: string, payload: Partial<{ email: string; full_name: string; role: string; password: string; avatar_url: string | null; phone: string } & UniversityUserFields>) =>
  request<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteUser = (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' });
export const deleteFilteredUsers = (filters: { role: string; search: string }) =>
  request<{ deletedCount: number }>('/users/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ...filters, confirmation: 'DELETE_FILTERED_USERS' }),
  });

// ── Classrooms ──
export type ClassroomAudienceMember = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  joinedAt: string;
};

export type Classroom = {
  id: string;
  name: string;
  description: string;
  mode: 'google_meet' | 'direct';
  meetUrl: string | null;
  accessCode: string;
  status: 'scheduled' | 'live' | 'ended';
  admissionsOpen: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  teacherId: string;
  teacherName: string;
  teacherAvatar: string | null;
  audienceCount?: number;
  audience: ClassroomAudienceMember[];
};

export const getClassrooms = () =>
  request<{ data: Classroom[]; total: number }>('/classrooms');

export const getClassroom = (id: string) =>
  request<{ classroom: Classroom }>(`/classrooms/${id}`);

export const createClassroom = (payload: { name: string; description: string; mode: Classroom['mode']; meetUrl?: string }) =>
  request<{ classroom: Classroom }>('/classrooms', { method: 'POST', body: JSON.stringify(payload) });

export const joinClassroom = (accessCode: string) =>
  request<{ classroom: Classroom }>('/classrooms/join', {
    method: 'POST',
    body: JSON.stringify({ accessCode }),
  });

export const updateClassroomStatus = (id: string, payload: { status?: Classroom['status']; admissionsOpen?: boolean }) =>
  request<{ classroom: Classroom }>(`/classrooms/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

// ── Questions ──
export type Question = {
  id: string;
  text: string;
  content?: string;
  subject: string;
  difficulty: 'easy' | 'medium' | 'hard';
  type?: 'multipleChoice' | 'essay';
  choices?: string[];
  answer?: number;
  answer_index?: number;
  answerText?: string;
  sourceEvidence?: string;
  created_by?: string;
  creator_name?: string;
  created_at?: string;
};

export type QuestionListResponse = { data: Question[]; total: number; page: number; limit: number };

export const getQuestions = (filters?: { subject?: string; difficulty?: string; type?: string; search?: string; page?: number; limit?: number }) => {
  const params = new URLSearchParams();
  if (filters?.subject) params.set('subject', filters.subject);
  if (filters?.difficulty) params.set('difficulty', filters.difficulty);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));
  return request<QuestionListResponse>(`/questions${params.size ? `?${params}` : ''}`);
};

export const getQuestion = (id: string) => request<Question>(`/questions/${id}`);

export const getQuestionSubjects = () => request<{ data: string[] }>('/questions/subjects');

export const createQuestion = (payload: {
  text?: string; content?: string; subject: string;
  difficulty?: string; type?: string; choices?: string[]; answer?: number;
}) => request<Question>('/questions', { method: 'POST', body: JSON.stringify(payload) });

export const updateQuestion = (id: string, payload: Partial<Question>) =>
  request<Question>(`/questions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteQuestion = (id: string) => request<void>(`/questions/${id}`, { method: 'DELETE' });

// ── Submissions ──
export type Submission = {
  id: string;
  exam_id: string;
  student_id?: string;
  student_name?: string;
  student_email?: string;
  exam_title?: string;
  answers: Record<string, unknown>;
  status: 'submitted' | 'grading' | 'graded';
  submitted_at: string;
  score?: number;
  feedback?: string;
  graded_at?: string;
};

export const getSubmissions = (params?: { exam_id?: string; status?: string; page?: number; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.exam_id) q.set('exam_id', params.exam_id);
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  return request<{ data: Submission[]; total: number }>(`/submissions${q.size ? `?${q}` : ''}`);
};

export const getSubmission = (id: string) => request<Submission>(`/submissions/${id}`);

export const submitExam = (payload: { exam_id: string; answers: Record<string, unknown> }) =>
  request<Submission>('/submissions', { method: 'POST', body: JSON.stringify(payload) });

export const gradeSubmission = (id: string, payload: { score: number; feedback?: string }) =>
  request<{ id: string; score: number; feedback?: string; graded_at: string }>(`/submissions/${id}/grade`, {
    method: 'POST', body: JSON.stringify(payload),
  });

// ── Analytics ──
export const getDashboardAnalytics = () => request<DashboardAnalytics>('/analytics/result');
export const getFullAnalytics = () => request<DashboardAnalytics>('/analytics/dashboard');

// ── Document Upload / Analyze ──
export type DocumentMetadata = {
  subjectName?: string;
  faculty?: string;
  academicYear?: string;
  semester?: string;
  examType?: string;
};

export type UploadedDocument = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  extractedText?: string;
  documentMetadata?: DocumentMetadata;
  status: string;
  message?: string;
};

export type EssayCognitiveDistribution = { understanding: number; application: number };
export type EssayRubric = {
  type: 'analytic';
  scale: Array<{ name: string; multiplier: number }>;
  criteria: Array<{
    name: string;
    weight: number;
    levels: Array<{ name: string; points: number; descriptor: string }>;
  }>;
};
export type ExamQuestion = {
  id: string;
  text: string;
  subject: string;
  difficulty: string;
  choices: string[];
  answer: number;
  answerText?: string;
  sourceEvidence?: string;
  cognitiveLevel?: 'understanding' | 'application' | null;
  rubric?: EssayRubric | null;
};

export const uploadExamDocument = (fileOrPayload: File | { filename: string; size: number; mimeType: string }) => {
  if (fileOrPayload instanceof File) {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', fileOrPayload);
    return fetch(`${API_URL}/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: `Upload failed: ${response.status}` }));
        throw new Error(body.message || `Upload failed: ${response.status}`);
      }
      return response.json() as Promise<UploadedDocument>;
    });
  }
  return request<UploadedDocument>('/documents/upload', { method: 'POST', body: JSON.stringify(fileOrPayload) });
};

export const analyzeExamDocument = (payload: {
  documentId: string;
  subject: string;
  requestedCount: number;
  content?: string;
  questionTypes?: { multipleChoice: number; essay: number };
  difficultyDistribution?: { easy: number; medium: number; hard: number };
  cognitiveDistribution?: EssayCognitiveDistribution;
}) =>
  request<{
    candidates: Array<ExamQuestion & { type?: 'multipleChoice' | 'essay' }>;
    confidence: number;
    summary: string;
    questionTypes?: { multipleChoice: number; essay: number };
  }>('/documents/analyze', { method: 'POST', body: JSON.stringify(payload) });

// ── Exams ──
export type ExamSummary = {
  id: string;
  title: string;
  subject: string;
  status: string;
  workflowStatus?: string;
  questionIds: string[];
  questionTypes?: { multipleChoice: number; essay: number };
  difficultyDistribution?: { easy: number; medium: number; hard: number };
  durationMinutes?: number;
  totalScore?: number;
  shuffleQuestions?: boolean;
  ownerName?: string;
  department?: string;
  examType?: string;
  securityLevel?: string;
  approver?: string;
  academicYear?: string;
  semester?: string;
  faculty?: string;
  examCode?: string;
  examDate?: string;
  document?: { id: string; filename: string } | null;
  createdAt: string;
};

export const generateExam = (payload: {
  title: string; subject: string; questionCount?: number; questionIds?: string[];
  document?: { id: string; filename: string };
  questionTypes?: { multipleChoice: number; essay: number };
  difficultyDistribution?: { easy: number; medium: number; hard: number };
  durationMinutes?: number; totalScore?: number; shuffleQuestions?: boolean;
  ownerName?: string; department?: string; examType?: string;
  securityLevel?: string; approver?: string; academicYear?: string;
  semester?: string; faculty?: string; examCode?: string;
  examDate?: string; status?: string; workflowStatus?: string;
  rubric?: unknown;
}) => request<ExamSummary & {
  questions: ExamQuestion[];
  blueprint: { targetTotal: number; actualTotal: number; targetMC: number; actualMC: number; targetEssay: number; actualEssay: number };
  warnings: Array<{ code: string; message: string }>;
  message: string;
}>('/exams/generate', { method: 'POST', body: JSON.stringify(payload) });

export const updateExam = (id: string, payload: Record<string, unknown>) =>
  request(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteExam = (id: string) => request<void>(`/exams/${id}`, { method: 'DELETE' });

export const createExamVariants = (id: string, count: number) =>
  request<{
    examId: string;
    variantCount: number;
    variants: Array<{
      code: string;
      examId: string;
      examTitle: string;
      questions: Array<{ id: string; text: string; choices: string[]; answer_index: number; type: string }>;
      answerKey: Array<{ position: number; questionId: string; type: string; answer: number | null; answerLabel: string | null }>;
      meta: Record<string, unknown>;
    }>;
    message: string;
  }>(`/exams/${id}/variants`, {
    method: 'POST', body: JSON.stringify({ count }),
  });

export const validateExam = (id: string) =>
  request<{
    examId: string;
    valid: boolean;
    errors: Array<{ code: string; field: string; message: string; required?: number; actual?: number }>;
    summary: { totalQuestions: number; multipleChoice: number; essay: number; totalScore: number; durationMinutes: number; workflowStatus: string };
  }>(`/exams/${id}/validate`, { method: 'POST' });

export type ExamRoom = {
  id: string; examId: string; name: string;
  startsAt?: string | null; endsAt?: string | null; status?: string;
  accessCode: string; examTitle?: string; examIds?: string[];
  exams?: Array<{ id: string; title: string }>;
  attemptCount?: number;
};

export const createExamRoom = (payload: { examIds: string[]; name: string; startsAt?: string | null; endsAt?: string | null }) =>
  request<ExamRoom>('/exam-rooms', { method: 'POST', body: JSON.stringify(payload) });

export const getExamRooms = () => request<{ data: ExamRoom[]; total: number }>('/exam-rooms');

export const updateExamRoomStatus = (id: string, status: 'active' | 'closed') =>
  request<ExamRoom>(`/exam-rooms/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export type ExamRoomMonitorAttempt = {
  id: string;
  student: { id: string; fullName: string; email: string };
  exam: { id: string; title: string };
  status: 'in_progress' | 'submitted';
  startedAt: string;
  lastActivityAt: string;
  tabSwitchCount: number;
  recentTabSwitches: string[];
  deadlineAt: string;
  submittedAt: string | null;
  currentQuestion: number;
  totalQuestions: number;
  answeredCount: number;
  progressPercent: number;
  answers: Record<string, string | number>;
  markedQuestions: string[];
  score: number | null;
  feedback: string | null;
  questions: ExamAttemptQuestion[];
};

export const getExamRoomMonitor = (id: string) =>
  request<{
    room: Omit<ExamRoom, 'accessCode'> & { exams: Array<{ id: string; title: string }> };
    attempts: ExamRoomMonitorAttempt[];
    total: number;
  }>(`/exam-rooms/${id}/attempts`);

export type ExamRoomGradingQuestion = {
  id: string;
  text: string;
  type: 'multipleChoice' | 'essay';
  choices: string[];
  answer_index: number | null;
  answerText?: string;
  rubric?: EssayRubric | null;
};

export type ExamRoomGradingAttempt = {
  id: string;
  submissionId: string;
  exam_id: string;
  exam_title: string;
  totalScore: number;
  student_name: string;
  student_email: string;
  answers: Record<string, string | number>;
  status: 'submitted' | 'graded';
  submitted_at: string;
  score?: number;
  feedback: string;
  questions: ExamRoomGradingQuestion[];
};

export const getExamRoomGrading = (id: string) =>
  request<{
    room: { id: string; name: string };
    attempts: ExamRoomGradingAttempt[];
    total: number;
  }>(`/exam-rooms/${id}/grading`);

export const gradeExamAttempt = (id: string, payload: { score: number; feedback?: string }) =>
  request<{ score: number; feedback: string | null; graded_at: string }>(
    `/exam-rooms/attempts/${id}/grade`, { method: 'POST', body: JSON.stringify(payload) },
  );

export type ExamAttemptQuestion = Omit<ExamQuestion, 'answer' | 'answerText' | 'sourceEvidence'> & {
  type: 'multipleChoice' | 'essay';
};
export type ExamAttempt = {
  id: string;
  roomId: string;
  status: 'in_progress' | 'submitted';
  startedAt: string;
  submittedAt?: string | null;
  deadlineAt: string;
  answers: Record<string, string | number>;
  markedQuestions: string[];
  currentQuestion: number;
  tabSwitchCount: number;
  submissionId: string | null;
  score: number | null;
  feedback: string | null;
  exam: { id: string; title: string; subject: string; totalScore: number };
  room: { id: string; name: string; code: string };
  questions: ExamAttemptQuestion[];
};

export const startExamAttempt = (code: string) =>
  request<{ attempt: ExamAttempt }>(`/exam-rooms/${encodeURIComponent(code)}/start`, { method: 'POST' });

export const saveExamAttempt = (
  id: string,
  payload: { answers: Record<string, string | number>; markedQuestions: string[]; currentQuestion: number },
) => request<{ saved: boolean; savedAt: string }>(`/exam-rooms/attempts/${id}/answers`, {
  method: 'PUT', body: JSON.stringify(payload),
});

export const logExamTabSwitch = (id: string) =>
  request<{ tabSwitchCount: number; occurredAt: string }>(`/exam-rooms/attempts/${id}/tab-switch`, {
    method: 'POST',
  });

export const submitExamAttempt = (
  id: string,
  payload: { answers: Record<string, string | number>; markedQuestions: string[]; currentQuestion: number },
) =>
  request<{ submitted: boolean; submissionId: string; score: number | null; totalScore: number | null; message: string }>(
    `/exam-rooms/attempts/${id}/submit`, { method: 'POST', body: JSON.stringify(payload) },
  );

export const getMyExamAttempts = () =>
  request<{ data: Array<{ id: string; room_id: string; exam_id: string; started_at: string; submitted_at: string | null; submission_id: string | null; room_name: string; access_code: string; exam_title: string; score: number | null; feedback: string | null }>; total: number }>('/exam-rooms/my-attempts');

export const getExams = (params?: { status?: string; subject?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.subject) q.set('subject', params.subject);
  return request<{ data: ExamSummary[]; total: number }>(`/exams${q.size ? `?${q}` : ''}`);
};

export const getExam = (id: string) =>
  request<ExamSummary & { questions: ExamQuestion[] }>(`/exams/${id}`);
