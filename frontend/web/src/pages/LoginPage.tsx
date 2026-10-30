import React, { useState } from 'react';
import { GOOGLE_AUTH_URL, login as apiLogin, saveAuth, type User } from '../services/api';

export type LoginPageProps = {
  onSuccess: (user: User) => void;
  onBack: () => void;
  googleError?: string;
  initialError?: string;
};

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured: 'Đăng nhập Google chưa được cấu hình. Vui lòng liên hệ quản trị viên.',
  google_configuration_error: 'Cấu hình đăng nhập Google không hợp lệ.',
  google_state_invalid: 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
  google_cancelled: 'Bạn đã hủy đăng nhập Google.',
  google_email_unverified: 'Google chưa xác minh địa chỉ email của tài khoản.',
  google_login_failed: 'Không thể đăng nhập bằng Google. Vui lòng thử lại.',
};

export default function LoginPage({ onSuccess, onBack, googleError, initialError }: LoginPageProps) {
  const [email, setEmail] = useState('teacher@dau.edu.vn');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'teacher' | 'student' | 'admin'>('teacher');
  const [error, setError] = useState(initialError || (googleError ? GOOGLE_ERRORS[googleError] || GOOGLE_ERRORS.google_login_failed : ''));
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Vui lòng nhập email hợp lệ.');
      return;
    }
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiLogin(email.trim(), password);
      saveAuth(res.token, res.user);
      onSuccess(res.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Đăng nhập thất bại.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) handleLogin();
  };

  const demoAccounts: Array<{ role: 'teacher' | 'student' | 'admin'; email: string; label: string }> = [
    { role: 'teacher', email: 'teacher@dau.edu.vn', label: 'Giảng viên' },
    { role: 'student', email: 'student@sv.dau.edu.vn', label: 'Sinh viên' },
    { role: 'admin', email: 'admin@dau.edu.vn', label: 'Quản trị' },
  ];

  return (
    <section className="auth-page">
      <div className="auth-visual">
        <div className="auth-kicker">DAU · DIGITAL ASSESSMENT</div>
        <h2>Biến mỗi kỳ thi thành một trải nghiệm sáng suốt hơn.</h2>
        <p>Một không gian thống nhất để tạo đề, tổ chức thi và chấm điểm bằng dữ liệu.</p>
        <div className="auth-stat-row">
          <div><strong>06</strong><span>AI modules</span></div>
          <div><strong>24/7</strong><span>Ready to assess</span></div>
        </div>
      </div>
      <div className="auth-card">
        <button className="back-link" onClick={onBack}>← Trang chủ</button>
        <div className="auth-brand-mark">✦</div>
        <p className="eyebrow">WELCOME BACK</p>
        <h1>Đăng nhập vào ExamHub</h1>
        <p className="auth-description">Sử dụng tài khoản giảng viên hoặc sinh viên để tiếp tục.</p>

        <label className="field-label" htmlFor="login-role">Vai trò</label>
        <select
          id="login-role"
          className="form-input"
          value={role}
          onChange={(e) => {
            const nextRole = e.target.value as 'teacher' | 'student' | 'admin';
            setRole(nextRole);
            const found = demoAccounts.find((account) => account.role === nextRole);
            if (found) {
              setEmail(found.email);
              setPassword('');
            }
          }}
          disabled={loading}
        >
          <option value="teacher">Giảng viên</option>
          <option value="student">Sinh viên</option>
          <option value="admin">Quản trị viên</option>
        </select>

        <label className="field-label" htmlFor="login-email" style={{ marginTop: '12px' }}>Email</label>
        <input
          id="login-email"
          className="form-input"
          type="email"
          placeholder="email@dau.edu.vn"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <p className="google-login-hint">Nhập mật khẩu hiện tại của tài khoản. Nếu mật khẩu vừa được đổi trong pgAdmin, hãy nhập mật khẩu mới tại đây.</p>

        <label className="field-label" htmlFor="login-password" style={{ marginTop: '12px' }}>Mật khẩu</label>
        <input
          id="login-password"
          className="form-input"
          type="password"
          placeholder="Nhập mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />

        {error && <p className="form-error">{error}</p>}

        <button
          className="login-submit-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? '⏳ Đang đăng nhập...' : '🔑 Đăng nhập'}
        </button>

        <div className="auth-divider"><span>Hoặc tiếp tục với</span></div>
        <a className="google-login-btn" href={GOOGLE_AUTH_URL}>
          <span className="google-login-mark" aria-hidden="true">G</span>
          <span>Đăng nhập bằng Google</span>
        </a>
        <p className="google-login-hint">Tài khoản mới sẽ được tạo với quyền sinh viên. Tài khoản hiện có giữ nguyên vai trò.</p>

        <div className="auth-divider"><span>Tài khoản mẫu</span></div>
        <div className="demo-accounts">
          {demoAccounts.map((account) => (
            <div key={account.role} className="demo-account" onClick={() => {
              setRole(account.role);
              setEmail(account.email);
              setPassword('');
            }}>
              <span className={`role-badge ${account.role === 'teacher' ? 'teacher' : account.role === 'admin' ? 'admin' : 'student'}`}>
                {account.label}
              </span>
              <span>{account.email}</span>
            </div>
          ))}
        </div>

        <p className="auth-footnote">Bằng việc tiếp tục, bạn đồng ý với quy định sử dụng hệ thống khảo thí DAU.</p>
      </div>
    </section>
  );
}
