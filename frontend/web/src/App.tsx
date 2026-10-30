import React, { useEffect, useState } from 'react';
import {
  changeMyPassword, getDashboardAnalytics, getExams, getFullAnalytics, getMe, saveUserProfile, updateMyProfile,
  type DashboardAnalytics, type ExamSummary, type User,
  getSavedUser, clearAuth, saveAuth,
} from './services/api';
import AvatarPicker from './components/AvatarPicker';
import LoginPage from './pages/LoginPage';
import ExamBuilderPage from './pages/ExamBuilderPage';
import GradingPage from './pages/GradingPage';
import ApprovalPage from './pages/ApprovalPage';
import QuestionBankPage from './pages/QuestionBankPage';
import UsersPage from './pages/UsersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import OnlineExamPage from './pages/OnlineExamPage';
import ClassroomPage from './pages/ClassroomPage';

type NavView = 'home' | 'exam-builder' | 'grading' | 'account'
  | 'approval' | 'question-bank' | 'users' | 'analytics' | 'online-exam' | 'classroom';
type View = NavView | 'login';

/* ── Sidebar items ── */
const buildNavItems = (role?: string) => {
  const all = [
    { icon: 'H',  en: 'Home',             vn: 'Trang Chủ',          view: 'home'          as NavView },
    { icon: 'QB', en: 'Question Bank',     vn: 'Ngân Hàng Câu Hỏi', view: 'question-bank' as NavView, roles: ['teacher', 'admin'] },
    { icon: 'AI', en: 'AI Exam Builder',   vn: 'Tạo Đề AI',          view: 'exam-builder'  as NavView, roles: ['teacher', 'admin'] },
    { icon: 'ON', en: 'Online Exam',        vn: 'Thi Trực Tuyến',     view: 'online-exam'   as NavView },
    { icon: 'CL', en: 'Classroom',           vn: 'Lớp Học Trực Tuyến', view: 'classroom'     as NavView },
    { icon: 'AP', en: 'Approval',          vn: 'Duyệt Đề',           view: 'approval'      as NavView, roles: ['teacher', 'admin'] },
    { icon: 'RG', en: 'Grading',           vn: 'Chấm Điểm',          view: 'grading'       as NavView, roles: ['teacher', 'admin'] },
    { icon: 'AN', en: 'Analytics',         vn: 'Phân Tích',          view: 'analytics'     as NavView, roles: ['teacher', 'admin'] },
    { icon: 'US', en: 'Users',             vn: 'Người Dùng',         view: 'users'         as NavView, roles: ['admin'] },
    { icon: 'AC', en: 'Account',           vn: 'Tài Khoản',          view: 'account'       as NavView },
  ];
  return all.filter(item => !item.roles || !role || item.roles.includes(role));
};

/* ── Donut chart mini ── */
function DonutChart({ pct, color }: { pct: number; color: string }) {
  const r = 38, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  return (
    <div className="donut-chart">
      <svg viewBox="0 0 100 100" width="100" height="100" className="donut-svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0f2f8" strokeWidth="10" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
      </svg>
      <div className="donut-center"><span className="donut-value">{pct}%</span></div>
    </div>
  );
}

/* ── Teacher workspace ── */
function TeacherWorkspace({ onNavigate }: { onNavigate: (v: NavView) => void }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  useEffect(() => { getExams().then(({ data }) => setExams(data)).catch(() => setExams([])); }, []);

  const count = (s: string) => exams.filter(e => (e.workflowStatus || e.status) === s).length;
  const actions: Array<{ id: NavView; title: string; subtitle: string; icon: string }> = [
    { id: 'question-bank', title: 'Ngân hàng câu hỏi', subtitle: 'Tạo và quản lý câu hỏi theo môn học', icon: 'QB' },
    { id: 'exam-builder',  title: 'Tạo đề AI',          subtitle: 'Từ file upload và ngân hàng câu hỏi', icon: 'AI' },
    { id: 'online-exam',   title: 'Thi trực tuyến',     subtitle: 'Tạo phòng thi và mã tham gia', icon: 'ON' },
    { id: 'classroom',     title: 'Lớp học trực tuyến', subtitle: 'Tạo giảng đường và mời sinh viên', icon: 'CL' },
    { id: 'approval',      title: 'Duyệt đề',            subtitle: 'Phê duyệt và phát hành theo quy trình', icon: 'AP' },
    { id: 'grading',       title: 'Chấm điểm',           subtitle: 'Rubric + AI feedback', icon: 'RG' },
    { id: 'analytics',     title: 'Phân tích',           subtitle: 'Thống kê và báo cáo chi tiết', icon: 'AN' },
    { id: 'account',       title: 'Tài khoản',           subtitle: 'Phân quyền và thông tin cá nhân', icon: 'AC' },
  ];

  return (
    <div className="card animate-card" style={{ animationDelay: '0.15s', marginBottom: '20px' }}>
      <div className="card-header">
        <div>
          <div className="card-title">Workspace giảng viên</div>
          <div className="card-title-sub">Toàn bộ thao tác dành cho người tạo đề và đánh giá</div>
        </div>
        <span className="card-badge badge-blue">GV</span>
      </div>
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card red"><div className="stat-icon">DR</div><div className="stat-value">{count('draft')}</div><div className="stat-label">Bản nháp</div></div>
        <div className="stat-card blue"><div className="stat-icon">RV</div><div className="stat-value">{count('review')}</div><div className="stat-label">Chờ duyệt</div></div>
        <div className="stat-card green"><div className="stat-icon">AP</div><div className="stat-value">{count('approved')}</div><div className="stat-label">Đã duyệt</div></div>
        <div className="stat-card orange"><div className="stat-icon">PB</div><div className="stat-value">{count('published')}</div><div className="stat-label">Đã phát hành</div></div>
      </div>
      <div className="features-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
        {actions.map(action => (
          <button key={action.id} className="feature-card" onClick={() => onNavigate(action.id)}
            style={{ textAlign: 'left', padding: '18px' }}>
            <div className="feature-icon">{action.icon}</div>
            <div className="feature-name">{action.title}</div>
            <div className="feature-desc">{action.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Admin workspace ── */
function AdminWorkspace({ onNavigate }: { onNavigate: (v: NavView) => void }) {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getFullAnalytics().then(setAnalytics).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Không thể tải thống kê quản trị.');
    });
  }, []);
  const actions: Array<{ id: NavView; title: string; subtitle: string; icon: string }> = [
    { id: 'users',         title: 'Quản lý người dùng', subtitle: 'Tạo, phân quyền tài khoản', icon: 'US' },
    { id: 'question-bank', title: 'Ngân hàng câu hỏi',  subtitle: 'CRUD câu hỏi toàn hệ thống', icon: 'QB' },
    { id: 'exam-builder',  title: 'Tạo đề AI',           subtitle: 'Tạo và quản lý đề thi', icon: 'AI' },
    { id: 'online-exam',   title: 'Thi trực tuyến',     subtitle: 'Tạo phòng thi và mã tham gia', icon: 'ON' },
    { id: 'classroom',     title: 'Lớp học trực tuyến', subtitle: 'Quản lý các giảng đường trực tuyến', icon: 'CL' },
    { id: 'approval',      title: 'Duyệt đề',             subtitle: 'Quản lý quy trình phê duyệt', icon: 'AP' },
    { id: 'grading',       title: 'Chấm điểm',            subtitle: 'Chấm bài theo rubric', icon: 'RG' },
    { id: 'analytics',     title: 'Phân tích hệ thống',  subtitle: 'Thống kê toàn diện từ CSDL', icon: 'AN' },
  ];

  return (
    <div className="card animate-card" style={{ animationDelay: '0.15s', marginBottom: '20px' }}>
      <div className="card-header">
        <div>
          <div className="card-title">Workspace quản trị viên</div>
          <div className="card-title-sub">Toàn quyền quản lý hệ thống AI ExamHub DAU</div>
        </div>
        <span className="card-badge badge-red">ADMIN</span>
      </div>
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card red"><div className="stat-icon">US</div><div className="stat-value">{analytics?.totalUsers ?? '—'}</div><div className="stat-label">Tài khoản</div></div>
        <div className="stat-card blue"><div className="stat-icon">EX</div><div className="stat-value">{analytics?.totalExams ?? '—'}</div><div className="stat-label">Đề thi</div></div>
        <div className="stat-card green"><div className="stat-icon">ON</div><div className="stat-value">{analytics?.totalRooms ?? '—'}</div><div className="stat-label">Phòng thi</div></div>
        <div className="stat-card orange"><div className="stat-icon">RG</div><div className="stat-value">{analytics?.submissionsByStatus?.submitted ?? '—'}</div><div className="stat-label">Bài chờ chấm</div></div>
      </div>
      {error && <div className="alert-banner" role="alert">{error}</div>}
      <div className="features-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
        {actions.map(action => (
          <button key={action.id} className="feature-card" onClick={() => onNavigate(action.id)}
            style={{ textAlign: 'left', padding: '18px' }}>
            <div className="feature-icon">{action.icon}</div>
            <div className="feature-name">{action.title}</div>
            <div className="feature-desc">{action.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Student workspace ── */
function StudentWorkspace({ user, onNavigate }: { user: User; onNavigate: (view: NavView) => void }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  useEffect(() => { getExams().then(({ data }) => setExams(data)).catch(() => setExams([])); }, []);

  const published = exams.filter(e => (e.workflowStatus || e.status) === 'published').length;

  return (
    <div className="card animate-card" style={{ animationDelay: '0.15s', marginBottom: '20px' }}>
      <div className="card-header">
        <div>
          <div className="card-title">Workspace sinh viên</div>
          <div className="card-title-sub">Thông tin bài thi, tiến độ và đề đang mở</div>
        </div>
        <span className="card-badge badge-green">SV</span>
      </div>
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card blue"><div className="stat-icon">EX</div><div className="stat-value">{exams.length}</div><div className="stat-label">Tổng đề</div></div>
        <div className="stat-card green"><div className="stat-icon">PB</div><div className="stat-value">{published}</div><div className="stat-label">Đề mở</div><div className="stat-sub">Có thể làm bài</div></div>
        <div className="stat-card orange"><div className="stat-icon">U</div>
          <div className="stat-value" style={{ fontSize: '16px' }}>{user.full_name.split(' ').slice(-1)[0]?.slice(0, 4).toUpperCase()}</div>
          <div className="stat-label">Tài khoản</div><div className="stat-sub">{user.email}</div>
        </div>
      </div>
      <div className="exam-library-grid">
        {exams.slice(0, 4).map(exam => (
          <article className="exam-library-card" key={exam.id}>
            <div className="exam-card-top">
              <span className={`status-pill ${(exam.workflowStatus || exam.status) === 'published' ? 'published' : 'review'}`}>
                {(exam.workflowStatus || exam.status) === 'published' ? 'Mở thi' : 'Chờ duyệt'}
              </span>
              <span className="exam-id">{exam.id.slice(0, 8)}</span>
            </div>
            <h4>{exam.title}</h4>
            <p>{exam.subject} · {exam.examType || 'Giữa kỳ'}</p>
            <div className="detail-summary">
              <span><b>{exam.questionIds.length}</b> câu</span>
              <span><b>{exam.totalScore ?? 10}</b> điểm</span>
              <span><b>{exam.durationMinutes ?? 45}</b> phút</span>
            </div>
          </article>
        ))}
        {exams.length === 0 && <div className="empty-library">Chưa có đề thi nào được phát hành.</div>}
      </div>
      <button className="button-primary" style={{ marginTop: '16px' }} onClick={() => onNavigate('online-exam')}>Vào phòng thi bằng mã</button>
      <button className="button-secondary" style={{ margin: '16px 0 0 10px' }} onClick={() => onNavigate('classroom')}>Vào lớp học bằng mã</button>
    </div>
  );
}

/* ── Account page ── */
function AccountPage({ user, onUserUpdated }: { user: User | null; onUserUpdated: (user: User) => void }) {
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar_url || null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!user) return null;
  const roleLabel = user.role === 'admin' ? 'Quản trị hệ thống' : user.role === 'teacher' ? 'Giảng viên/Người tạo đề' : 'Sinh viên';

  const handleProfileSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    setMessage('');
    try {
      const { user: updatedUser } = await updateMyProfile({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        avatar_url: avatar,
      });
      saveUserProfile(updatedUser);
      onUserUpdated(updatedUser);
      setMessage('Đã cập nhật thông tin cá nhân.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể cập nhật thông tin cá nhân.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword.length < 8) {
      setError('Mật khẩu mới cần có ít nhất 8 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận chưa khớp.');
      return;
    }
    setSavingPassword(true);
    try {
      const result = await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      setMessage(result.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (passwordError: unknown) {
      setError(passwordError instanceof Error ? passwordError.message : 'Không thể đổi mật khẩu.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">ACCOUNT / TÀI KHOẢN</p>
          <h2>Quản lý tài khoản</h2>
          <p className="muted-copy">Cập nhật hồ sơ cá nhân, ảnh đại diện và bảo mật tài khoản.</p>
        </div>
      </div>
      {message && <div className="success-banner" role="status">{message}</div>}
      {error && <div className="alert-banner" role="alert">{error}</div>}
      <div className="account-profile-grid">
        <form className="card account-form-card" onSubmit={(event) => void handleProfileSave(event)}>
          <div className="card-header">
            <div><div className="card-title">Thông tin cá nhân</div><div className="card-title-sub">Thông tin hiển thị trong hệ thống</div></div>
          </div>
          <div className="account-form-content">
            <AvatarPicker name={fullName} value={avatar} onChange={setAvatar} />
            <label className="field-label" htmlFor="account-full-name">Họ và tên *</label>
            <input id="account-full-name" className="form-input" required maxLength={255} value={fullName} onChange={(event) => setFullName(event.target.value)} />
            <label className="field-label" htmlFor="account-email">Email *</label>
            <input id="account-email" className="form-input" type="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
            <label className="field-label" htmlFor="account-phone">Số điện thoại</label>
            <input id="account-phone" className="form-input" type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Nhập số điện thoại" />
            <button className="button-primary" type="submit" disabled={savingProfile}>
              {savingProfile ? 'Đang lưu...' : 'Lưu thông tin'}
            </button>
          </div>
        </form>

        <form className="card account-form-card" onSubmit={(event) => void handlePasswordChange(event)}>
          <div className="card-header">
            <div><div className="card-title">Đổi mật khẩu</div><div className="card-title-sub">Xác nhận mật khẩu hiện tại để tiếp tục</div></div>
          </div>
          <div className="account-form-content">
            <label className="field-label" htmlFor="account-current-password">Mật khẩu hiện tại *</label>
            <input id="account-current-password" className="form-input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            <label className="field-label" htmlFor="account-new-password">Mật khẩu mới *</label>
            <input id="account-new-password" className="form-input" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <label className="field-label" htmlFor="account-confirm-password">Xác nhận mật khẩu mới *</label>
            <input id="account-confirm-password" className="form-input" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            <button className="button-primary" type="submit" disabled={savingPassword}>
              {savingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
            </button>
            <p className="account-security-note">Mật khẩu mới cần có ít nhất 8 ký tự. Không chia sẻ mật khẩu với người khác.</p>
          </div>
        </form>
      </div>
      <div className="stats-grid account-summary-grid">
        <div className="stat-card blue"><div className="stat-icon">AC</div><div className="stat-value" style={{ fontSize: '16px' }}>{user.full_name}</div><div className="stat-label">Tên tài khoản</div><div className="stat-sub">{roleLabel}</div></div>
        <div className="stat-card green"><div className="stat-icon">PR</div><div className="stat-value">{user.role.toUpperCase()}</div><div className="stat-label">Phân quyền</div></div>
        <div className="stat-card orange"><div className="stat-icon">EM</div><div className="stat-value" style={{ fontSize: '13px' }}>{user.email}</div><div className="stat-label">Email</div></div>
      </div>
      <div className="content-grid account-permissions">
        <div className="card">
          <div style={{ display: 'grid', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div><strong style={{ color: 'var(--text-primary)' }}>Họ và tên:</strong> {user.full_name}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Email:</strong> {user.email}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Số điện thoại:</strong> {user.phone || 'Chưa cập nhật'}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Vai trò:</strong> {roleLabel}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>ID tài khoản:</strong> <code style={{ fontSize: '11px', background: '#f0f2f8', padding: '2px 6px', borderRadius: '4px' }}>{user.id}</code></div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div><div className="card-title">Phân quyền hệ thống</div><div className="card-title-sub">Quyền truy cập theo vai trò</div></div>
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {[
              { label: 'Xem đề thi', allowed: true },
              { label: 'Tạo câu hỏi', allowed: user.role === 'teacher' || user.role === 'admin' },
              { label: 'Tạo đề thi', allowed: user.role === 'teacher' || user.role === 'admin' },
              { label: 'Duyệt đề thi', allowed: user.role === 'teacher' || user.role === 'admin' },
              { label: 'Chấm điểm', allowed: user.role === 'teacher' || user.role === 'admin' },
              { label: 'Xem phân tích', allowed: user.role === 'teacher' || user.role === 'admin' },
              { label: 'Quản lý người dùng', allowed: user.role === 'admin' },
            ].map(p => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{p.label}</span>
                <span style={{ color: p.allowed ? '#27ae60' : 'var(--text-muted)', fontWeight: 600 }}>
                  {p.allowed ? '✓ Được phép' : '✗ Không có quyền'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════
   MAIN APP
════════════════════════════════════ */
export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lang, setLang] = useState<'en' | 'vn'>('vn');
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [view, setView] = useState<View>('home');
  const [user, setUser] = useState<User | null>(() => getSavedUser());
  const [authReady, setAuthReady] = useState(() => !getSavedUser());
  const [googleError, setGoogleError] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!window.location.hash) return;
    const callback = new URLSearchParams(window.location.hash.slice(1));
    const token = callback.get('google_token');
    const rawUser = callback.get('google_user');
    const error = callback.get('google_error');
    if (!token && !rawUser && !error) return;

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (error) {
      setGoogleError(error);
      setView('login');
      return;
    }

    try {
      const googleUser = JSON.parse(rawUser || '') as User;
      if (!token || !googleUser.id || !googleUser.email || !googleUser.full_name
        || !['admin', 'teacher', 'student'].includes(googleUser.role)) {
        throw new Error('Invalid Google sign-in response.');
      }
      saveAuth(token, googleUser);
      setUser(googleUser);
      setAuthReady(true);
      setGoogleError('');
      setView('home');
    } catch {
      setGoogleError('google_login_failed');
      setView('login');
    }
  }, []);

  useEffect(() => {
    getDashboardAnalytics().then(setAnalytics).catch(() => setAnalytics(null));
  }, []);

  useEffect(() => {
    if (!user) {
      setAuthReady(true);
      return;
    }
    let active = true;
    setAuthReady(false);
    getMe()
      .then(({ token, user: nextUser }) => {
        if (active) {
          saveAuth(token, nextUser);
          setUser(nextUser);
          setAuthReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        clearAuth();
        setUser(null);
        setAuthReady(true);
        setAuthError(err instanceof Error ? err.message : 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.');
        setView('login');
      });
    return () => { active = false; };
  }, [user?.id]);

  const handleLogout = () => { clearAuth(); setUser(null); setAuthReady(true); setAuthError(''); setView('home'); };
  const handleLoginSuccess = (loggedInUser: User) => { setAuthError(''); setAuthReady(false); setUser(loggedInUser); setView('home'); };
  const canAccessView = (target: NavView) => {
    if (!user) return target === 'home';
    if (user.role === 'admin') return true;
    if (user.role === 'teacher') return ['home', 'exam-builder', 'online-exam', 'classroom', 'grading', 'approval', 'account', 'question-bank', 'analytics'].includes(target);
    return ['home', 'account', 'online-exam', 'classroom'].includes(target);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':   return { label: 'Quản trị viên', className: 'role-badge admin' };
      case 'teacher': return { label: 'Giảng viên',    className: 'role-badge teacher' };
      case 'student': return { label: 'Sinh viên',     className: 'role-badge student' };
      default:        return { label: role,             className: 'role-badge' };
    }
  };

  const t = (en: string, vn: string) => lang === 'en' ? en : vn;
  const navItems = buildNavItems(user?.role);

  return (
      <div className="app-container visible">
        {/* ── SIDEBAR ── */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <img src="/dau-university-logo.png" alt="Logo Trường Đại học Kiến trúc Đà Nẵng" />
            </div>
            <div className="sidebar-brand">
              <h2>AI EXAMHUB</h2>
              <p>Trường ĐH Kiến Trúc ĐN</p>
            </div>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-section-label">{t('Navigation', 'Điều Hướng')}</div>
            {navItems.map((item, i) => {
              const isActive = item.view === view;
              return (
                <div key={i} className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    if (!canAccessView(item.view)) { if (!user) setView('login'); return; }
                    setView(item.view);
                  }}>
                  <span className="nav-icon">{item.icon}</span>
                  <div className="nav-label">
                    <span className="nav-label-main">{item.en}</span>
                    <span className="nav-label-sub">{item.vn}</span>
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            {user ? (
              <div className="nav-item login-btn" onClick={handleLogout}>
                <span className="nav-icon">OUT</span>
                <span className="nav-label"><span className="nav-label-main">{t('Logout', 'Đăng Xuất')}</span></span>
              </div>
            ) : (
              <div className="nav-item login-btn" onClick={() => setView('login')}>
                <span className="nav-icon">IN</span>
                <span className="nav-label"><span className="nav-label-main">{t('Login', 'Đăng Nhập')}</span></span>
              </div>
            )}
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <div className="main-content">
          {/* TOPBAR */}
          <header className="topbar">
            <button className="sidebar-toggle-btn" onClick={() => setSidebarCollapsed(c => !c)}>
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
            <div className="topbar-title">
              <h1>AI EXAMHUB – DA NANG UNIVERSITY OF ARCHITECTURE (DAU)</h1>
              <p>TRUNG TÂM KHẢO THÍ AI – TRƯỜNG ĐẠI HỌC KIẾN TRÚC ĐÀ NẴNG</p>
            </div>
            {user && (
              <div className="topbar-user-info">
                <div className="user-avatar">
                  {user.avatar_url
                    ? <img src={user.avatar_url} alt="" />
                    : user.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="user-details">
                  <span className="user-name">{user.full_name}</span>
                  <span className={getRoleBadge(user.role).className}>{getRoleBadge(user.role).label}</span>
                </div>
                <button className="logout-btn" onClick={handleLogout} title="Đăng xuất">OUT</button>
              </div>
            )}
            <div className="lang-switcher" onClick={() => setLang(l => l === 'en' ? 'vn' : 'en')}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)' }}>{t('Bilingual', 'Song Ngữ')}</div>
              <div className="toggle-switch" />
              <div className="lang-badge">
                <span>{lang === 'vn' ? '🇻🇳' : '🇬🇧'}</span>
                <span style={{ color: 'rgba(255,255,255,0.8)' }}>EN / VN</span>
              </div>
            </div>
          </header>

          {/* PAGE CONTENT */}
          <main className="page-content">
            {/* ── Views ── */}
            {view === 'login' && <LoginPage onBack={() => setView('home')} onSuccess={handleLoginSuccess} googleError={googleError} initialError={authError} />}
            {view === 'exam-builder' && <ExamBuilderPage />}
            {view === 'online-exam' && (user
              ? authReady
                ? <OnlineExamPage user={user} />
                : <div className="alert-banner" role="status">Đang xác minh phiên đăng nhập trước khi vào phòng thi...</div>
              : <LoginPage onBack={() => setView('home')} onSuccess={handleLoginSuccess} googleError={googleError} />)}
            {view === 'classroom' && (user ? <ClassroomPage user={user} /> : <LoginPage onBack={() => setView('home')} onSuccess={handleLoginSuccess} googleError={googleError} />)}
            {view === 'grading' && <GradingPage />}
            {view === 'approval' && <ApprovalPage />}
            {view === 'question-bank' && <QuestionBankPage />}
            {view === 'analytics' && <AnalyticsPage />}
            {view === 'users' && (user?.role === 'admin' ? <UsersPage /> : (
              <div className="login-prompt-banner animate-card">
                <div className="login-prompt-text"><h3>🔒 Chỉ quản trị viên mới có quyền truy cập trang này.</h3></div>
              </div>
            ))}
            {view === 'account' && (user ? <AccountPage user={user} onUserUpdated={setUser} /> : (
              <div className="login-prompt-banner animate-card">
                <div className="login-prompt-text"><h3>🔒 Vui lòng đăng nhập để xem tài khoản</h3></div>
                <div className="login-prompt-actions"><button className="btn-primary" onClick={() => setView('login')}>Đăng Nhập</button></div>
              </div>
            ))}

            {view === 'home' && (
              <div className="home-dashboard">
                {/* Welcome / login prompt */}
                {user ? (
                  <div className="welcome-banner animate-card" style={{ animationDelay: '0.1s' }}>
                    <div className="login-prompt-text">
                      <h3>{t(`Welcome back, ${user.full_name}!`, `Chào mừng trở lại, ${user.full_name}!`)}</h3>
                      <p>{user.role === 'admin'
                        ? t('Full admin access to AI ExamHub DAU.', 'Bạn có toàn quyền quản trị hệ thống.')
                        : user.role === 'teacher'
                        ? t('Create exams, grade papers, manage classrooms.', 'Bạn có thể tạo đề thi, chấm điểm và quản lý lớp học.')
                        : t('You can take exams and view your results.', 'Bạn có thể làm bài thi và xem kết quả.')}
                      </p>
                    </div>
                    <div className="login-prompt-actions">
                      <span className={getRoleBadge(user.role).className} style={{ fontSize: '14px', padding: '6px 16px' }}>
                        {getRoleBadge(user.role).label}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="login-prompt-banner animate-card" style={{ animationDelay: '0.1s' }}>
                    <div className="login-prompt-text">
                      <h3>{t('Please sign in to access all features', 'Đăng nhập để sử dụng đầy đủ tính năng')}</h3>
                      <p>{t('Login to create exams, grade papers, and manage classrooms.', 'Đăng nhập để tạo đề thi, chấm điểm và quản lý lớp học.')}</p>
                    </div>
                    <div className="login-prompt-actions">
                      <button className="btn-primary" onClick={() => setView('login')}>{t('Login', 'Đăng Nhập')}</button>
                    </div>
                  </div>
                )}

                {/* Hero banner */}
                <div className="hero-banner animate-card" style={{ animationDelay: '0.2s' }}>
                  <div className="hero-content">
                    <h2>{t('AI-Powered Exam Hub', 'Trung Tâm Khảo Thí AI')}</h2>
                    <p>{t(
                      'Generate exams, grade with Rubric & AI — all in one platform.',
                      'Tạo đề thi, ngân hàng câu hỏi, chấm điểm Rubric & AI — tất cả trên một nền tảng.'
                    )}</p>
                    <div className="hero-cta" onClick={() => user ? setView('exam-builder') : setView('login')}>
                      {t('START NOW', 'BẮT ĐẦU NGAY')}
                    </div>
                  </div>
                  <div className="hero-ai-graphic">
                    <div className="hero-ai-circles">
                      <div className="ai-circle" /><div className="ai-circle" /><div className="ai-circle" />
                      <div className="ai-center">AI</div>
                    </div>
                  </div>
                </div>

                {/* Workspace by role */}
                {user && user.role === 'admin' && <AdminWorkspace onNavigate={v => setView(v)} />}
                {user && user.role === 'teacher' && <TeacherWorkspace onNavigate={v => setView(v)} />}
                {user && user.role === 'student' && <StudentWorkspace user={user} onNavigate={v => setView(v)} />}

                {/* Stats từ CSDL thực */}
                <div className="stats-grid">
                  {[
                    { icon: 'QB', value: analytics?.totalQuestions ?? '--', label: t('Question Bank', 'Ngân Hàng Câu Hỏi'), sub: t('Available questions', 'Câu hỏi trong CSDL'), color: 'red' },
                    { icon: 'EX', value: analytics?.totalExams ?? '--',     label: t('Total Exams', 'Tổng Đề Thi'),         sub: t('All exams in system', 'Tổng đề thi trong hệ thống'), color: 'blue' },
                    { icon: 'US', value: analytics?.totalUsers ?? '--',     label: t('Users', 'Người Dùng'),                sub: t('Registered accounts', 'Tài khoản đã đăng ký'), color: 'green' },
                    { icon: 'GP', value: analytics?.gradedPapers ?? '--',   label: t('Graded Papers', 'Bài Đã Chấm'),       sub: `Điểm TB: ${analytics?.averageScore ?? '--'}/10`, color: 'orange' },
                  ].map((s, i) => (
                    <div key={i} className={`stat-card ${s.color} animate-card`} style={{ animationDelay: `${0.3 + i * 0.08}s` }}>
                      <div className="stat-icon">{s.icon}</div>
                      <div className="stat-value">{s.value}</div>
                      <div className="stat-label">{s.label}</div>
                      <div className="stat-sub">{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Info cards */}
                <div className="content-grid">
                  <div className="card animate-card" style={{ animationDelay: '0.55s' }}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">{t('Question Bank Status', 'Trạng Thái Ngân Hàng Câu Hỏi')}</div>
                        <div className="card-title-sub">Phân phối theo độ khó</div>
                      </div>
                      <span className="card-badge badge-green">{analytics?.totalQuestions ?? 0} câu</span>
                    </div>
                    <DonutChart pct={100} color="#c0392b" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {[
                        { label: t('Easy', 'Dễ'), c: '#2ecc71' },
                        { label: t('Medium', 'Trung bình'), c: '#f39c12' },
                        { label: t('Hard', 'Khó'), c: '#e74c3c' },
                      ].map((item, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.c, display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card animate-card" style={{ animationDelay: '0.63s' }}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">{t('Exam Workflow', 'Quy Trình Đề Thi')}</div>
                        <div className="card-title-sub">Trạng thái các đề thi hiện tại</div>
                      </div>
                      <span className="card-badge badge-blue">{analytics?.totalExams ?? 0} đề</span>
                    </div>
                    {[
                      { label: 'Bản nháp', value: (analytics as any)?.examsByStatus?.draft ?? 0, c: 'var(--text-muted)' },
                      { label: 'Chờ duyệt', value: (analytics as any)?.examsByStatus?.review ?? 0, c: '#3498db' },
                      { label: 'Đã duyệt', value: (analytics as any)?.examsByStatus?.approved ?? 0, c: '#2ecc71' },
                      { label: 'Đã phát hành', value: (analytics as any)?.examsByStatus?.published ?? 0, c: 'var(--primary)' },
                    ].map((item, i) => (
                      <div key={i} className="progress-bar-container">
                        <div className="progress-label"><span>{item.label}</span><span>{item.value}</span></div>
                        <div className="progress-track">
                          <div className="progress-fill primary" style={{ width: `${analytics?.totalExams ? (item.value / analytics.totalExams) * 100 : 0}%`, background: item.c }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="card animate-card" style={{ animationDelay: '0.71s' }}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">{t('About DAU', 'Về Trường')}</div>
                        <div className="card-title-sub">Da Nang University of Architecture</div>
                      </div>
                      <img className="dau-about-logo" src="/dau-university-logo.png" alt="Logo Trường Đại học Kiến trúc Đà Nẵng" />
                    </div>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      {t(
                        'AI ExamHub DAU is an AI-powered platform for creating exams, managing question banks, grading with Rubric & AI — built for Da Nang University of Architecture.',
                        'AI ExamHub DAU là nền tảng ứng dụng AI để tạo đề thi, quản lý ngân hàng câu hỏi, chấm điểm Rubric & AI — xây dựng cho Trường Đại Học Kiến Trúc Đà Nẵng.'
                      )}
                    </p>
                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                      {[
                        { icon: 'QB', label: 'Ngân hàng câu hỏi', view: 'question-bank' as NavView },
                        { icon: 'AI', label: 'Tạo đề AI', view: 'exam-builder' as NavView },
                        { icon: 'RG', label: 'Chấm Rubric', view: 'grading' as NavView },
                        { icon: 'AN', label: 'Phân tích', view: 'analytics' as NavView },
                      ].map(btn => (
                        <button key={btn.view}
                          onClick={() => user ? setView(btn.view) : setView('login')}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: 'var(--bg-main)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', transition: 'all 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(192,57,43,0.08)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-main)')}
                        >
                          <span style={{ fontWeight: 700, fontSize: '10px' }}>{btn.icon}</span>
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="card animate-card" style={{ animationDelay: '0.79s' }}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">Kết nối CSDL</div>
                        <div className="card-title-sub">PostgreSQL · pg_examhub_dau</div>
                      </div>
                      <span className="card-badge badge-green">LIVE</span>
                    </div>
                    <div style={{ display: 'grid', gap: '8px', fontSize: '13px' }}>
                      {[
                        { label: 'users', icon: 'US', value: (analytics as any)?.usersByRole?.total ?? '--' },
                        { label: 'questions', icon: 'QB', value: analytics?.totalQuestions ?? '--' },
                        { label: 'exams', icon: 'EX', value: analytics?.totalExams ?? '--' },
                        { label: 'results', icon: 'GP', value: analytics?.gradedPapers ?? '--' },
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '12px' }}>
                            <b style={{ color: '#3498db', marginRight: '6px' }}>{row.icon}</b>
                            public.{row.label}
                          </span>
                          <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{row.value} rows</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
  );
}
