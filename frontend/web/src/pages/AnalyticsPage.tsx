import { useEffect, useState } from 'react';
import { getFullAnalytics, type DashboardAnalytics } from '../services/api';

function BarChart({ data, max, color }: { data: { label: string; value: number }[]; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map(item => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
            <span style={{ fontWeight: 600 }}>{item.value}</span>
          </div>
          <div style={{ height: '6px', background: '#f0f2f8', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${max > 0 ? (item.value / max) * 100 : 0}%`,
              background: color,
              borderRadius: '3px',
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>Chưa có dữ liệu</div>;

  const r = 38, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
      <svg viewBox="0 0 100 100" width="100" height="100" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0f2f8" strokeWidth="10" />
        {segments.map((seg, i) => {
          const dash = (seg.value / total) * circumference;
          const gap = circumference - dash;
          const circle = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth="10"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{seg.label}</span>
            <span style={{ fontWeight: 600 }}>{seg.value}</span>
            <span style={{ color: 'var(--text-muted)' }}>({total > 0 ? Math.round(seg.value / total * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getFullAnalytics();
      setAnalytics(data);
      setLastUpdated(new Date());
    } catch {
      setAnalytics(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <section className="workspace-page">
        <div className="workspace-heading"><div><h2>Đang tải dữ liệu phân tích...</h2></div></div>
        <div className="card" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Đang kết nối cơ sở dữ liệu...
        </div>
      </section>
    );
  }

  const qByDiff = analytics?.questionsByDifficulty;
  const examByStatus = analytics?.examsByStatus;
  const userByRole = analytics?.usersByRole;
  const subByStatus = analytics?.submissionsByStatus;

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">ANALYTICS / PHÂN TÍCH DỮ LIỆU</p>
          <h2>Thống kê hệ thống</h2>
          <p className="muted-copy">
            Dữ liệu thời gian thực từ cơ sở dữ liệu PostgreSQL.
            {lastUpdated && ` Cập nhật lúc ${lastUpdated.toLocaleTimeString('vi-VN')}.`}
          </p>
        </div>
        <button className="button-primary" onClick={fetchData}>↻ Làm mới</button>
      </div>

      {/* Main stats */}
      <div className="stats-grid" style={{ marginBottom: '24px' }}>
        <div className="stat-card red">
          <div className="stat-icon">QB</div>
          <div className="stat-value">{analytics?.totalQuestions ?? 0}</div>
          <div className="stat-label">Câu hỏi</div>
          <div className="stat-sub">Ngân hàng câu hỏi</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">EX</div>
          <div className="stat-value">{analytics?.totalExams ?? 0}</div>
          <div className="stat-label">Đề thi</div>
          <div className="stat-sub">Tổng số đề</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">US</div>
          <div className="stat-value">{analytics?.totalUsers ?? 0}</div>
          <div className="stat-label">Người dùng</div>
          <div className="stat-sub">Đăng ký trong hệ thống</div>
        </div>
        <div className="stat-card orange">
          <div className="stat-icon">GP</div>
          <div className="stat-value">{analytics?.gradedPapers ?? 0}</div>
          <div className="stat-label">Bài đã chấm</div>
          <div className="stat-sub">Điểm TB: {analytics?.averageScore ?? 0}/10</div>
        </div>
      </div>

      {/* Charts grid */}
      <div className="content-grid">
        {/* Questions by difficulty */}
        <div className="card animate-card">
          <div className="card-header">
            <div>
              <div className="card-title">Câu hỏi theo độ khó</div>
              <div className="card-title-sub">Phân phối ngân hàng câu hỏi</div>
            </div>
            <span className="card-badge badge-green">{analytics?.totalQuestions ?? 0} câu</span>
          </div>
          <DonutChart segments={[
            { label: 'Dễ', value: qByDiff?.easy ?? 0, color: '#2ecc71' },
            { label: 'Trung bình', value: qByDiff?.medium ?? 0, color: '#f39c12' },
            { label: 'Khó', value: qByDiff?.hard ?? 0, color: '#e74c3c' },
          ]} />
        </div>

        {/* Exams by status */}
        <div className="card animate-card">
          <div className="card-header">
            <div>
              <div className="card-title">Đề thi theo trạng thái</div>
              <div className="card-title-sub">Quy trình phê duyệt</div>
            </div>
            <span className="card-badge badge-blue">{analytics?.totalExams ?? 0} đề</span>
          </div>
          <BarChart
            data={[
              { label: 'Bản nháp', value: examByStatus?.draft ?? 0 },
              { label: 'Chờ duyệt', value: examByStatus?.review ?? 0 },
              { label: 'Đã duyệt', value: examByStatus?.approved ?? 0 },
              { label: 'Đã phát hành', value: examByStatus?.published ?? 0 },
            ]}
            max={analytics?.totalExams || 1}
            color="linear-gradient(90deg, #3498db, #2980b9)"
          />
        </div>

        {/* Users by role */}
        <div className="card animate-card">
          <div className="card-header">
            <div>
              <div className="card-title">Người dùng theo vai trò</div>
              <div className="card-title-sub">Phân bổ tài khoản</div>
            </div>
            <span className="card-badge badge-green">{analytics?.totalUsers ?? 0} TK</span>
          </div>
          <DonutChart segments={[
            { label: 'Quản trị viên', value: userByRole?.admin ?? 0, color: '#e74c3c' },
            { label: 'Giảng viên', value: userByRole?.teacher ?? 0, color: '#3498db' },
            { label: 'Sinh viên', value: userByRole?.student ?? 0, color: '#2ecc71' },
          ]} />
        </div>

        {/* Submissions by status */}
        <div className="card animate-card">
          <div className="card-header">
            <div>
              <div className="card-title">Bài nộp theo trạng thái</div>
              <div className="card-title-sub">Tiến độ chấm bài</div>
            </div>
            <span className="card-badge badge-blue">
              {(subByStatus?.submitted ?? 0) + (subByStatus?.grading ?? 0) + (subByStatus?.graded ?? 0)} bài
            </span>
          </div>
          <BarChart
            data={[
              { label: 'Chờ chấm', value: subByStatus?.submitted ?? 0 },
              { label: 'Đang chấm', value: subByStatus?.grading ?? 0 },
              { label: 'Đã chấm', value: subByStatus?.graded ?? 0 },
            ]}
            max={Math.max((subByStatus?.submitted ?? 0) + (subByStatus?.grading ?? 0) + (subByStatus?.graded ?? 0), 1)}
            color="#2ecc71"
          />
        </div>
      </div>

      {/* Average score card */}
      {(analytics?.averageScore ?? 0) > 0 && (
        <div className="card" style={{ marginTop: '20px' }}>
          <div className="card-header">
            <div>
              <div className="card-title">Điểm trung bình hệ thống</div>
              <div className="card-title-sub">Tổng hợp từ {analytics?.gradedPapers ?? 0} bài đã chấm</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              fontSize: '48px', fontWeight: 800, color: 'var(--primary)',
              lineHeight: 1, padding: '0 16px',
            }}>
              {analytics?.averageScore ?? 0}
            </div>
            <div style={{ flex: 1 }}>
              <div className="progress-bar-container">
                <div className="progress-label">
                  <span>Tỷ lệ đạt (≥5 điểm)</span>
                  <span>{Math.round(((analytics?.averageScore ?? 0) / 10) * 100)}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill primary" style={{ width: `${Math.round(((analytics?.averageScore ?? 0) / 10) * 100)}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
