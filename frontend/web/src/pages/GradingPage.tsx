import { useEffect, useState } from 'react';
import {
  getExamRoomGrading,
  getExamRooms,
  getSubmissions,
  gradeExamAttempt,
  gradeSubmission,
  type ExamRoom,
  type ExamRoomGradingQuestion,
  type Submission,
} from '../services/api';

const STATUS_META: Record<string, { label: string; color: string }> = {
  submitted: { label: 'Chờ chấm', color: 'orange' },
  grading: { label: 'Đang chấm', color: 'blue' },
  graded: { label: 'Đã chấm', color: 'green' },
};

type GradingRecord = Submission & {
  totalScore?: number;
  questions?: ExamRoomGradingQuestion[];
};

export default function GradingPage() {
  const [submissions, setSubmissions] = useState<GradingRecord[]>([]);
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [score, setScore] = useState<number>(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    getExamRooms()
      .then(({ data }) => setRooms(data))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách phòng thi.'));
  }, []);

  const fetchSubs = async () => {
    setLoading(true);
    setMessage('');
    try {
      let records: GradingRecord[];
      let responseTotal: number;
      if (selectedRoomId) {
        const result = await getExamRoomGrading(selectedRoomId);
        records = result.attempts.map((attempt) => ({
          id: attempt.id,
          exam_id: attempt.exam_id,
          student_id: undefined,
          student_name: attempt.student_name,
          student_email: attempt.student_email,
          exam_title: attempt.exam_title,
          answers: attempt.answers,
          status: attempt.status,
          submitted_at: attempt.submitted_at,
          score: attempt.score,
          feedback: attempt.feedback,
          totalScore: attempt.totalScore,
          questions: attempt.questions,
        }));
        responseTotal = records.length;
      } else {
        const result = await getSubmissions({ status: statusFilter || undefined, limit: 50 });
        records = result.data;
        responseTotal = result.total;
      }
      const filtered = selectedRoomId && statusFilter
        ? records.filter((submission) => submission.status === statusFilter)
        : records;
      setSubmissions(filtered);
      setTotal(selectedRoomId ? filtered.length : responseTotal);
      setActiveId(filtered[0]?.id || null);
      setScore(filtered[0]?.score ?? 0);
      setFeedback(filtered[0]?.feedback ?? '');
    } catch (error: unknown) {
      setSubmissions([]);
      setTotal(0);
      setActiveId(null);
      setMessage(error instanceof Error ? error.message : 'Không thể tải bài thi cần chấm.');
    }
    finally { setLoading(false); }
  };

  useEffect(() => { void fetchSubs(); }, [statusFilter, selectedRoomId]);

  const active = submissions.find(s => s.id === activeId) || submissions[0];
  const maxScore = active?.totalScore ?? 10;

  const handleGrade = async () => {
    if (!activeId) return;
    if (!Number.isFinite(score) || score < 0 || score > maxScore) {
      setMessage(`Điểm phải từ 0 đến ${maxScore}.`);
      return;
    }
    setSaving(true);
    try {
      if (selectedRoomId) await gradeExamAttempt(activeId, { score, feedback });
      else await gradeSubmission(activeId, { score, feedback });
      setMessage('Đã lưu kết quả chấm thành công!');
      setSubmissions(prev => prev.map(s =>
        s.id === activeId ? { ...s, status: 'graded', score, feedback } : s
      ));
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi lưu kết quả.');
    } finally { setSaving(false); }
  };

  const gradedCount = submissions.filter(s => s.status === 'graded').length;
  const pendingCount = submissions.filter(s => s.status === 'submitted').length;
  const scoredSubmissions = submissions.filter((submission) => typeof submission.score === 'number');
  const avgScore = scoredSubmissions
    .reduce((sum, submission) => sum + (submission.score ?? 0) / scoredSubmissions.length, 0);

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">RUBRIC GRADING / CHẤM ĐIỂM</p>
          <h2>Chấm thi thông minh</h2>
          <p className="muted-copy">Kết hợp tiêu chí Rubric và phản hồi AI để đánh giá nhất quán hơn.</p>
        </div>
        <button className="button-primary" onClick={fetchSubs}>↻ Làm mới</button>
      </div>

      {message && (
        <div className="alert-banner" onClick={() => setMessage('')} style={{ cursor: 'pointer', marginBottom: '16px' }}>
          {message}
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card blue"><div className="stat-icon">AL</div><div className="stat-value">{total}</div><div className="stat-label">Tổng bài nộp</div></div>
        <div className="stat-card orange"><div className="stat-icon">PD</div><div className="stat-value">{pendingCount}</div><div className="stat-label">Chờ chấm</div></div>
        <div className="stat-card green"><div className="stat-icon">GD</div><div className="stat-value">{gradedCount}</div><div className="stat-label">Đã chấm</div></div>
        <div className="stat-card red"><div className="stat-icon">AV</div><div className="stat-value">{avgScore.toFixed(1)}</div><div className="stat-label">Điểm TB</div></div>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
        <select
          className="form-input"
          style={{ maxWidth: '360px' }}
          value={selectedRoomId}
          onChange={e => setSelectedRoomId(e.target.value)}
          aria-label="Chọn phòng thi để chấm"
        >
          <option value="">Bài nộp ngoài phòng thi trực tuyến</option>
          {rooms.map(room => (
            <option key={room.id} value={room.id}>{room.name} · {room.attemptCount ?? 0} lượt thi</option>
          ))}
        </select>
        <select className="form-input" style={{ maxWidth: '200px' }} value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="submitted">Chờ chấm</option>
          <option value="grading">Đang chấm</option>
          <option value="graded">Đã chấm</option>
        </select>
      </div>

      <div className="grading-layout">
        {/* Submission list */}
        <div className="submission-list builder-panel">
          <div className="list-heading">
            <div><h3>Bài nộp</h3><p>{submissions.length} bài trong phiên hiện tại</p></div>
          </div>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Đang tải...</div>
          ) : submissions.length === 0 ? (
            <div className="empty-library">Chưa có bài nộp nào.</div>
          ) : (
            submissions.map(sub => (
              <button
                key={sub.id}
                className={`submission-row ${activeId === sub.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(sub.id);
                  setScore(sub.score ?? 0);
                  setFeedback(sub.feedback ?? '');
                }}
              >
                <span className="student-avatar">
                  {(sub.student_name || 'SV').charAt(0).toUpperCase()}
                </span>
                <span className="submission-copy">
                  <strong>{sub.student_name || 'Sinh viên'}</strong>
                  <small>{sub.id.slice(0, 8)} · {sub.exam_title || 'Bài thi'}</small>
                </span>
                <span className={`submission-status ${sub.status === 'graded' ? 'done' : ''}`}>
                  <span className={`status-pill ${STATUS_META[sub.status]?.color || 'orange'}`} style={{ fontSize: '10px' }}>
                    {STATUS_META[sub.status]?.label || sub.status}
                  </span>
                  {typeof sub.score === 'number' && <b>{sub.score}/{sub.totalScore ?? 10}</b>}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Preview */}
        <div className="grading-canvas builder-panel">
          <div className="canvas-heading">
            <div>
              <span className="mini-label">ĐANG XEM</span>
              <h3>{active?.student_name || 'Chọn bài để chấm'}</h3>
              <p>{active?.id?.slice(0, 8) || '—'} · {active?.exam_title || 'Bài thi'}</p>
            </div>
          </div>
          <div className="paper-preview">
            <div className="paper-top">
              <span>AI EXAMHUB DAU</span>
              <span>PHIẾU TRẢ LỜI</span>
            </div>
            {active ? (
              <div style={{ padding: '16px' }}>
                <h4 style={{ marginBottom: '8px' }}>{active.exam_title || 'Bài thi'}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Sinh viên: <strong>{active.student_name || '—'}</strong> · Email: {active.student_email || '—'}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Nộp lúc: {active.submitted_at ? new Date(active.submitted_at).toLocaleString('vi-VN') : '—'}
                </p>
                {typeof active.score === 'number' && (
                  <div className="alert-banner" style={{ marginBottom: '12px' }}>
                    ✓ Đã chấm: <strong>{active.score}/{maxScore} điểm</strong>
                    {active.feedback && <p style={{ marginTop: '4px', fontSize: '12px' }}>{active.feedback}</p>}
                  </div>
                )}
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  <strong>Trạng thái:</strong> {STATUS_META[active.status]?.label || active.status}
                </div>
                {active.questions?.map((question, index) => {
                  const answer = active.answers[question.id];
                  const isAnswered = answer !== undefined && answer !== '';
                  const studentAnswer = question.type === 'multipleChoice' && typeof answer === 'number'
                    ? question.choices[answer] ?? 'Lựa chọn không hợp lệ'
                    : isAnswered ? String(answer) : 'Chưa trả lời';
                  const expectedAnswer = question.type === 'multipleChoice' && question.answer_index !== null
                    ? question.choices[question.answer_index] ?? '—'
                    : question.answerText || '';
                  return (
                    <article key={question.id} className="grading-answer-card">
                      <strong>Câu {index + 1}. {question.text}</strong>
                      <p><b>Bài làm:</b> {studentAnswer}</p>
                      {expectedAnswer && <p><b>Đáp án tham khảo:</b> {expectedAnswer}</p>}
                      {question.type === 'essay' && question.rubric?.criteria.length ? (
                        <div className="essay-rubric-detail">
                          <strong>Tiêu chí chấm</strong>
                          {question.rubric.criteria.map(criterion => (
                            <div className="essay-rubric-criterion" key={criterion.name}>
                              <b>{criterion.name} ({criterion.weight}%)</b>
                              <ul>{criterion.levels.map(level => (
                                <li key={level.name}>{level.name} · {level.points} điểm: {level.descriptor}</li>
                              ))}</ul>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Chọn một bài nộp để xem chi tiết
              </div>
            )}
          </div>
        </div>

        {/* Rubric Panel */}
        <div className="rubric-panel builder-panel">
          <div className="list-heading">
            <div><h3>Chấm điểm</h3><p>Nhập điểm và nhận xét</p></div>
            <span className="ai-badge">✦ Rubric</span>
          </div>

          {active ? (
            <>
              <div style={{ padding: '0 0 12px' }}>
                <label className="field-label">Điểm số (0–{maxScore}) *</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  max={maxScore}
                  step={selectedRoomId ? '0.01' : '0.5'}
                  value={score}
                  onChange={e => setScore(Number(e.target.value))}
                />
              </div>

              <div className="score-total">
                <span>ĐIỂM CHẤM</span>
                <strong>{score} <small>/ {maxScore}</small></strong>
              </div>

              <input
                className="rubric-slider"
                type="range"
                min="0"
                max={maxScore}
                step={selectedRoomId ? '0.01' : '0.5'}
                value={score}
                onChange={e => setScore(Number(e.target.value))}
              />

              <label className="field-label" htmlFor="feedback" style={{ marginTop: '12px' }}>Nhận xét</label>
              <textarea
                id="feedback"
                className="form-input feedback-input"
                placeholder="Nhập nhận xét cho sinh viên..."
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                rows={4}
              />

              <button
                className="button-primary full-button"
                style={{ marginTop: '16px' }}
                onClick={handleGrade}
                disabled={saving}
              >
                {saving ? 'Đang lưu...' : '✓ Lưu kết quả chấm'}
              </button>
            </>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Chọn bài nộp để chấm điểm
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
