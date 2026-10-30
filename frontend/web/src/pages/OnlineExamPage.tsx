import { useEffect, useRef, useState } from 'react';
import {
  getExamRooms,
  getExamRoomMonitor,
  getExams,
  getMyExamAttempts,
  logExamTabSwitch,
  saveExamAttempt,
  startExamAttempt,
  submitExamAttempt,
  updateExamRoomStatus,
  createExamRoom,
  type ExamAttempt,
  type ExamRoom,
  type ExamRoomMonitorAttempt,
  type ExamSummary,
  type User,
} from '../services/api';

type StudentAttemptHistory = Awaited<ReturnType<typeof getMyExamAttempts>>['data'];

const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function TeacherRooms() {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [roomName, setRoomName] = useState('');
  const [startsAt, setStartsAt] = useState(localDateTime(new Date()));
  const [endsAt, setEndsAt] = useState(localDateTime(new Date(Date.now() + 60 * 60_000)));
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [monitorAttempts, setMonitorAttempts] = useState<ExamRoomMonitorAttempt[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [monitorRoom, setMonitorRoom] = useState<Awaited<ReturnType<typeof getExamRoomMonitor>>['room'] | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorUpdatedAt, setMonitorUpdatedAt] = useState<Date | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [examResult, roomResult] = await Promise.all([getExams(), getExamRooms()]);
      setExams(examResult.data);
      setRooms(roomResult.data);
      setSelectedExamIds((current) => current.length || !examResult.data.length ? current : [examResult.data[0].id]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu phòng thi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const refreshMonitor = async (roomId: string, quiet = false) => {
    if (!quiet) setMonitorLoading(true);
    try {
      const result = await getExamRoomMonitor(roomId);
      setMonitorRoom(result.room);
      setMonitorAttempts(result.attempts);
      setMonitorUpdatedAt(new Date());
      setSelectedStudentId((current) => current && result.attempts.some((attempt) => attempt.student.id === current)
        ? current
        : result.attempts[0]?.student.id || null);
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : 'Không thể tải tiến độ phòng thi.');
    } finally {
      if (!quiet) setMonitorLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedRoomId) return undefined;
    void refreshMonitor(selectedRoomId);
    const timer = window.setInterval(() => { void refreshMonitor(selectedRoomId, true); }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedRoomId]);

  const createRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedExams = exams.filter((item) => selectedExamIds.includes(item.id));
    if (!selectedExams.length) {
      setMessage('Vui lòng chọn ít nhất một đề thi đã lưu.');
      return;
    }
    setCreating(true);
    setMessage('');
    try {
      const room = await createExamRoom({
        examIds: selectedExams.map((exam) => exam.id),
        name: roomName.trim() || `${selectedExams.length > 1 ? 'Phòng thi' : selectedExams[0].title} · ${new Date().toLocaleDateString('vi-VN')}`,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
      setRooms((current) => [room, ...current]);
      setSelectedRoomId(room.id);
      setSelectedStudentId(null);
      setRoomName('');
      setMessage(`Đã tạo phòng thi. Mã tham gia: ${room.accessCode}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tạo phòng thi.');
    } finally {
      setCreating(false);
    }
  };

  const setRoomStatus = async (room: ExamRoom) => {
    try {
      const updated = await updateExamRoomStatus(room.id, room.status === 'closed' ? 'active' : 'closed');
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, ...updated } : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể cập nhật phòng thi.');
    }
  };

  const copyRoomCode = async (accessCode: string) => {
    try {
      await navigator.clipboard.writeText(accessCode);
      setMessage(`Đã sao chép mã phòng ${accessCode}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Không thể sao chép mã phòng: ${error.message}` : 'Không thể sao chép mã phòng.');
    }
  };

  return (
    <section className="workspace-page online-exam-page">
      <div className="workspace-heading">
        <div><p className="eyebrow">ONLINE EXAM / GIẢNG VIÊN</p><h2>Tổ chức thi trực tuyến</h2><p className="muted-copy">Chọn đề đã tạo, đặt lịch và gửi mã phòng cho sinh viên.</p></div>
      </div>
      {message && <div className="alert-banner online-message" role="status">{message}</div>}
      <div className="online-teacher-grid">
        <form className="builder-panel online-room-form" onSubmit={(event) => void createRoom(event)}>
          <div className="list-heading"><div><h3>Tạo phòng thi</h3><p>Chọn nhiều đề; mỗi sinh viên được random một đề riêng.</p></div></div>
          <fieldset className="exam-room-paper-picker">
            <legend className="field-label">Các đề có thể phân cho sinh viên ({selectedExamIds.length} đã chọn)</legend>
            {exams.map((exam) => <label className="exam-room-paper-option" key={exam.id}>
              <input type="checkbox" checked={selectedExamIds.includes(exam.id)} onChange={() => setSelectedExamIds((current) => current.includes(exam.id) ? current.filter((id) => id !== exam.id) : [...current, exam.id])} />
              <span><strong>{exam.title}</strong><small>{exam.subject} · {exam.questionIds.length} câu · {exam.durationMinutes || 45} phút</small></span>
            </label>)}
          </fieldset>
          <label className="field-label" htmlFor="online-room-name">Tên phòng</label>
          <input id="online-room-name" className="form-input" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Có thể để trống để lấy tên đề" />
          <div className="online-date-grid">
            <div><label className="field-label" htmlFor="online-start">Bắt đầu</label><input id="online-start" className="form-input" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
            <div><label className="field-label" htmlFor="online-end">Kết thúc nhận bài</label><input id="online-end" className="form-input" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></div>
          </div>
          <button className="button-primary online-create-button" type="submit" disabled={creating || !selectedExamIds.length}>{creating ? 'Đang tạo...' : 'Tạo phòng và mã tham gia'}</button>
          {!exams.length && !loading && <p className="source-unavailable">Chưa có đề thi. Hãy tạo và lưu đề trước.</p>}
        </form>

        <div className="builder-panel online-room-list">
          <div className="list-heading"><div><h3>Phòng thi của bạn</h3><p>{rooms.length} phòng đã tạo</p></div><button className="button-secondary" type="button" onClick={() => void refresh()}>Làm mới</button></div>
          {loading ? <p className="muted-copy">Đang tải phòng thi...</p> : rooms.length ? rooms.map((room) => (
            <article className="online-room-card" key={room.id}>
              <div className="online-room-card-heading">
                <div><strong>{room.name}</strong><small>{room.exams?.map((exam) => exam.title).join(' · ') || room.examTitle || 'Đề thi'} · {room.attemptCount || 0} lượt dự thi</small></div>
                <span className={`status-pill ${room.status === 'closed' ? 'draft' : 'published'}`}>{room.status === 'closed' ? 'Đã đóng' : room.status === 'scheduled' ? 'Đã lên lịch' : 'Đang mở'}</span>
              </div>
              <button className="room-code" type="button" aria-label={`Sao chép mã phòng ${room.accessCode}`} onClick={() => void copyRoomCode(room.accessCode)}>{room.accessCode} <small>Sao chép</small></button>
              <div className="online-room-card-footer">
                <small>{room.startsAt ? new Date(room.startsAt).toLocaleString('vi-VN') : 'Mở ngay'}{room.endsAt ? ` – ${new Date(room.endsAt).toLocaleString('vi-VN')}` : ''}</small>
                <div className="online-room-actions">
                  <button className="button-secondary" type="button" aria-pressed={selectedRoomId === room.id} onClick={() => { setSelectedRoomId((current) => current === room.id ? null : room.id); setSelectedStudentId(null); }}>{selectedRoomId === room.id ? 'Đang giám sát' : 'Giám sát'}</button>
                  <button className={room.status === 'closed' ? 'button-secondary' : 'button-danger'} type="button" onClick={() => void setRoomStatus(room)}>{room.status === 'closed' ? 'Mở lại' : 'Đóng phòng'}</button>
                </div>
              </div>
            </article>
          )) : <div className="empty-library">Chưa tạo phòng thi nào.</div>}
        </div>
      </div>
      {selectedRoomId && <section className="builder-panel room-monitor-panel" aria-live="polite">
        <div className="room-monitor-header">
          <div>
            <p className="eyebrow">LIVE MONITOR · {monitorRoom?.status === 'closed' ? 'PHÒNG ĐÃ ĐÓNG' : 'ĐANG CẬP NHẬT'}</p>
            <h3>{monitorRoom?.name || 'Đang tải phòng thi...'}</h3>
            <p>{monitorRoom?.exams?.map((exam) => exam.title).join(' · ') || 'Theo dõi sinh viên và tiến độ làm bài'}</p>
          </div>
          <div className="room-monitor-controls">
            <small>{monitorUpdatedAt ? `Cập nhật ${monitorUpdatedAt.toLocaleTimeString('vi-VN')}` : 'Đang đồng bộ...'}</small>
            <button type="button" className="button-secondary" disabled={monitorLoading} onClick={() => void refreshMonitor(selectedRoomId)}>{monitorLoading ? 'Đang tải...' : 'Cập nhật ngay'}</button>
            <button type="button" className="icon-button" aria-label="Đóng giám sát phòng" onClick={() => { setSelectedRoomId(null); setMonitorRoom(null); setMonitorAttempts([]); }}>×</button>
          </div>
        </div>
        <div className="monitor-summary">
          <span><b>{monitorAttempts.length}</b> Đã vào phòng</span>
          <span><b>{monitorAttempts.filter((attempt) => attempt.status === 'in_progress').length}</b> Đang làm</span>
          <span><b>{monitorAttempts.filter((attempt) => attempt.status === 'submitted').length}</b> Đã nộp</span>
          <span><b>{monitorAttempts.filter((attempt) => attempt.status === 'in_progress' && attempt.answeredCount === attempt.totalQuestions).length}</b> Đã trả lời đủ</span>
          <span><b>{monitorAttempts.reduce((total, attempt) => total + attempt.tabSwitchCount, 0)}</b> Lần chuyển tab được ghi nhận</span>
        </div>
        <div className="room-monitor-layout">
          <div className="monitor-student-list">
            {monitorAttempts.length ? monitorAttempts.map((attempt) => (
              <button type="button" key={attempt.id} className={`monitor-student-row ${selectedStudentId === attempt.student.id ? 'active' : ''}`} onClick={() => setSelectedStudentId(attempt.student.id)}>
                <span className="student-avatar">{attempt.student.fullName.charAt(0).toUpperCase()}</span>
                <span className="monitor-student-copy">
                  <strong>{attempt.student.fullName}</strong>
                  <small>{attempt.student.email}</small>
                  <span className="monitor-progress-track"><i style={{ width: `${attempt.progressPercent}%` }} /></span>
                  <small>{attempt.answeredCount}/{attempt.totalQuestions} câu · {attempt.status === 'submitted' ? 'Đã nộp' : `Câu ${Math.min(attempt.currentQuestion + 1, attempt.totalQuestions)}`}</small>
                  {attempt.tabSwitchCount > 0 && <small role="status">⚠ {attempt.tabSwitchCount} lần chuyển tab</small>}
                </span>
                <span className={`monitor-status-dot ${attempt.status}`} aria-label={attempt.status === 'submitted' ? 'Đã nộp bài' : 'Đang làm bài'} />
              </button>
            )) : <div className="empty-library">{monitorLoading ? 'Đang tải danh sách thí sinh...' : 'Chưa có sinh viên vào phòng. Danh sách sẽ tự cập nhật.'}</div>}
          </div>
          {(() => {
            const attempt = monitorAttempts.find((item) => item.student.id === selectedStudentId);
            return attempt ? <article className="monitor-student-detail">
              <header className="monitor-detail-header">
                <div><p className="eyebrow">CHI TIẾT BÀI LÀM · {attempt.exam.title}</p><h4>{attempt.student.fullName}</h4><small>{attempt.student.email}</small></div>
                <span className={`status-pill ${attempt.status === 'submitted' ? 'published' : 'draft'}`}>{attempt.status === 'submitted' ? 'Đã nộp bài' : 'Đang làm bài'}</span>
              </header>
              <div className="monitor-detail-stats">
                <span><b>{attempt.answeredCount}/{attempt.totalQuestions}</b> câu đã trả lời</span>
                <span><b>{attempt.progressPercent}%</b> tiến độ</span>
                <span><b>{new Date(attempt.lastActivityAt).toLocaleTimeString('vi-VN')}</b> hoạt động gần nhất</span>
                <span><b>{attempt.tabSwitchCount}</b> lần chuyển tab</span>
              </div>
              {attempt.tabSwitchCount > 0 && <p className="alert-banner" role="status">
                Lần gần nhất: {new Date(attempt.recentTabSwitches[0]).toLocaleString('vi-VN')}
              </p>}
              <div className="monitor-question-list">{attempt.questions.map((question, index) => {
                const answer = attempt.answers[question.id];
                const hasAnswer = answer !== undefined && answer !== '';
                const answerText = question.type === 'multipleChoice' && typeof answer === 'number'
                  ? question.choices[answer] || 'Lựa chọn không hợp lệ'
                  : typeof answer === 'string' ? answer : '';
                return <section className={`monitor-question-item ${index === attempt.currentQuestion && attempt.status === 'in_progress' ? 'current' : ''}`} key={question.id}>
                  <div className="monitor-question-title"><strong>Câu {index + 1}</strong><span className={hasAnswer ? 'answered' : 'unanswered'}>{hasAnswer ? 'Đã trả lời' : 'Chưa trả lời'}{attempt.markedQuestions.includes(question.id) ? ' · Đánh dấu xem lại' : ''}</span></div>
                  <p>{question.text}</p>
                  {hasAnswer ? <div className="monitor-answer-content"><b>Câu trả lời:</b> {answerText}</div> : <div className="monitor-answer-empty">Chưa có câu trả lời</div>}
                </section>;
              })}</div>
            </article> : <div className="monitor-detail-placeholder">Chọn sinh viên để xem câu trả lời và tiến độ từng câu.</div>;
          })()}
        </div>
      </section>}
    </section>
  );
}

function StudentExam() {
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [history, setHistory] = useState<StudentAttemptHistory>([]);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [markedQuestions, setMarkedQuestions] = useState<string[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const submitLock = useRef(false);

  const refreshHistory = async () => {
    try {
      const result = await getMyExamAttempts();
      setHistory(result.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử thi.');
    }
  };

  useEffect(() => { void refreshHistory(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;
    setSaving('saving');
    const timer = window.setTimeout(() => {
      void saveExamAttempt(attempt.id, { answers, markedQuestions, currentQuestion })
        .then(() => {
          setSaving('saved');
          setSaveError('');
        })
        .catch((error: unknown) => {
          setSaving('error');
          setSaveError(error instanceof Error ? error.message : 'Vui lòng kiểm tra kết nối và thử lại.');
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [attempt?.id, attempt?.status, answers, currentQuestion, markedQuestions]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      void saveExamAttempt(attempt.id, { answers, markedQuestions, currentQuestion })
        .then(() => {
          setSaving('saved');
          setSaveError('');
        })
        .catch((error: unknown) => {
          setSaving('error');
          setSaveError(error instanceof Error ? error.message : 'Vui lòng kiểm tra kết nối và thử lại.');
        });
      void logExamTabSwitch(attempt.id)
        .then(({ tabSwitchCount }) => {
          setAttempt((current) => current?.id === attempt.id ? { ...current, tabSwitchCount } : current);
          setMessage(`Cảnh báo: hệ thống đã ghi nhận ${tabSwitchCount} lần bạn rời khỏi tab bài thi. Bạn vẫn có thể tiếp tục làm bài.`);
        })
        .catch((error: unknown) => {
          setMessage(error instanceof Error
            ? `Không thể ghi nhận sự kiện chuyển tab: ${error.message}`
            : 'Không thể ghi nhận sự kiện chuyển tab. Vui lòng kiểm tra kết nối.');
        });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [attempt?.id, attempt?.status, answers, currentQuestion, markedQuestions]);

  const finishAttempt = async (automatic = false) => {
    if (!attempt || attempt.status !== 'in_progress' || submitLock.current) return;
    if (!automatic && !window.confirm('Bạn chắc chắn muốn nộp bài? Sau khi nộp sẽ không thể chỉnh sửa câu trả lời.')) return;
    submitLock.current = true;
    setSubmitting(true);
    setMessage(automatic ? 'Đã hết giờ. Hệ thống đang tự động nộp bài...' : 'Đang nộp bài...');
    try {
      const result = await submitExamAttempt(attempt.id, { answers, markedQuestions, currentQuestion });
      setAttempt((current) => current ? { ...current, status: 'submitted', submittedAt: new Date().toISOString(), score: result.score, feedback: result.message } : current);
      setMessage(result.message);
      await refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể nộp bài. Vui lòng thử lại.');
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (attempt?.status === 'in_progress' && new Date(attempt.deadlineAt).getTime() <= now) {
      void finishAttempt(true);
    }
  }, [attempt?.id, attempt?.status, attempt?.deadlineAt, now]);

  const joinRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await startExamAttempt(code.trim());
      const next = response.attempt;
      setAttempt(next);
      setAnswers(next.answers || {});
      setMarkedQuestions(next.markedQuestions || []);
      setCurrentQuestion(next.currentQuestion || 0);
      submitLock.current = next.status === 'submitted';
      setMessage(next.status === 'submitted' ? 'Bạn đã hoàn thành bài thi này.' : 'Bài thi đã sẵn sàng. Chúc bạn làm bài tốt!');
      await refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể vào phòng thi.');
    } finally {
      setLoading(false);
    }
  };

  const resumeAttempt = async (accessCode: string) => {
    setLoading(true);
    try {
      const { attempt: resumed } = await startExamAttempt(accessCode);
      setCode(accessCode);
      setAttempt(resumed);
      setAnswers(resumed.answers || {});
      setMarkedQuestions(resumed.markedQuestions || []);
      setCurrentQuestion(resumed.currentQuestion || 0);
      submitLock.current = resumed.status === 'submitted';
      setMessage(resumed.status === 'submitted' ? 'Bạn đã hoàn thành bài thi này.' : 'Đã khôi phục bài thi và câu trả lời đã lưu.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể khôi phục bài thi.');
    } finally {
      setLoading(false);
    }
  };

  const activeQuestion = attempt?.questions[currentQuestion];
  const secondsLeft = attempt ? Math.max(0, Math.ceil((new Date(attempt.deadlineAt).getTime() - now) / 1000)) : 0;
  const answeredCount = attempt?.questions.filter((question) => answers[question.id] !== undefined && answers[question.id] !== '').length || 0;

  return (
    <section className="workspace-page online-exam-page">
      <div className="workspace-heading"><div><p className="eyebrow">ONLINE EXAM / SINH VIÊN</p><h2>Phòng thi trực tuyến</h2><p className="muted-copy">Nhập mã phòng do giảng viên cung cấp để vào thi hoặc tiếp tục bài đang làm.</p></div></div>
      {message && <div className="alert-banner online-message" role="status">{message}</div>}
      {!attempt && <form className="builder-panel student-join-form" onSubmit={(event) => void joinRoom(event)}>
        <div><h3>Vào phòng thi</h3><p>Đăng nhập bằng tài khoản sinh viên trước khi bắt đầu.</p></div>
        <div className="student-join-controls">
          <label className="sr-only" htmlFor="exam-room-code">Mã phòng thi</label>
          <input id="exam-room-code" className="form-input room-code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ví dụ: 3A8F12BC" maxLength={8} required />
          <button className="button-primary" type="submit" disabled={loading || code.trim().length < 8}>{loading ? 'Đang vào phòng...' : 'Vào thi'}</button>
        </div>
      </form>}

      {attempt && <section className="online-exam-workspace builder-panel">
        <header className="student-exam-header">
          <div><p className="eyebrow">{attempt.exam.subject} · {attempt.room.name}</p><h3>{attempt.exam.title}</h3><small>{attempt.questions.length} câu · Tổng điểm {attempt.exam.totalScore}</small></div>
          {attempt.status === 'in_progress' && <div className={`exam-countdown ${secondsLeft < 300 ? 'urgent' : ''}`} aria-live="polite"><small>Thời gian còn lại</small><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</strong></div>}
        </header>

        {attempt.status === 'submitted' ? <div className="exam-result-panel">
          <span className="exam-result-icon">✓</span><h3>Đã nộp bài</h3>
          {attempt.score !== null ? <p>Kết quả: <strong>{attempt.score}/{attempt.exam.totalScore} điểm</strong></p> : <p>Bài thi đã được ghi nhận. Phần tự luận đang chờ giảng viên chấm.</p>}
          {attempt.feedback && <small>{attempt.feedback}</small>}
          <button className="button-secondary" type="button" onClick={() => { setAttempt(null); setMessage(''); void refreshHistory(); }}>Quay lại lịch sử thi</button>
        </div> : activeQuestion ? <>
          <div className="exam-progress-row"><span>Đã trả lời {answeredCount}/{attempt.questions.length} · Đã ghi nhận {attempt.tabSwitchCount} lần chuyển tab</span><span className={`autosave-state ${saving}`} title={saveError}>{saving === 'saving' ? 'Đang lưu...' : saving === 'saved' ? 'Đã tự lưu' : saving === 'error' ? `Lỗi lưu: ${saveError || 'kiểm tra kết nối'}` : 'Tự động lưu'}</span></div>
          <p className="alert-banner" role="note">Rời khỏi tab bài thi sẽ được ghi nhận và hiển thị với giảng viên. Bài thi không bị tự động nộp.</p>
          <div className="exam-taking-layout">
            <aside className="exam-question-navigation" aria-label="Điều hướng câu hỏi">
              <strong>Danh sách câu hỏi</strong>
              <div className="exam-question-number-grid">{attempt.questions.map((question, index) => (
                <button key={question.id} type="button" className={`${index === currentQuestion ? 'current' : ''} ${answers[question.id] !== undefined && answers[question.id] !== '' ? 'answered' : ''} ${markedQuestions.includes(question.id) ? 'marked' : ''}`} aria-label={`Câu ${index + 1}${markedQuestions.includes(question.id) ? ', đã đánh dấu xem lại' : ''}`} onClick={() => setCurrentQuestion(index)}>{index + 1}</button>
              ))}</div>
              <div className="exam-nav-legend"><span>Đã trả lời</span><span>Đánh dấu xem lại</span></div>
            </aside>
            <article className="exam-current-question">
              <div className="exam-current-heading"><span>Câu {currentQuestion + 1}/{attempt.questions.length}</span><button type="button" className={`review-question-button ${markedQuestions.includes(activeQuestion.id) ? 'active' : ''}`} onClick={() => setMarkedQuestions((current) => current.includes(activeQuestion.id) ? current.filter((id) => id !== activeQuestion.id) : [...current, activeQuestion.id])}>{markedQuestions.includes(activeQuestion.id) ? '★ Đã đánh dấu' : '☆ Đánh dấu xem lại'}</button></div>
              <h4>{activeQuestion.text}</h4>
              {activeQuestion.type === 'multipleChoice' ? <div className="exam-answer-options">{activeQuestion.choices.map((choice, index) => (
                <label key={`${activeQuestion.id}-${index}`} className={`exam-answer-option ${answers[activeQuestion.id] === index ? 'selected' : ''}`}>
                  <input type="radio" name={`answer-${activeQuestion.id}`} checked={answers[activeQuestion.id] === index} onChange={() => setAnswers((current) => ({ ...current, [activeQuestion.id]: index }))} />
                  <span>{String.fromCharCode(65 + index)}</span><strong>{choice}</strong>
                </label>
              ))}</div> : <textarea className="form-input essay-answer-input" value={String(answers[activeQuestion.id] ?? '')} onChange={(event) => setAnswers((current) => ({ ...current, [activeQuestion.id]: event.target.value }))} placeholder="Nhập câu trả lời của bạn..." />}
              <footer className="exam-question-actions"><button type="button" className="button-secondary" onClick={() => setCurrentQuestion((index) => Math.max(0, index - 1))} disabled={currentQuestion === 0}>← Câu trước</button><button type="button" className="button-primary" onClick={() => setCurrentQuestion((index) => Math.min(attempt.questions.length - 1, index + 1))} disabled={currentQuestion === attempt.questions.length - 1}>Câu tiếp →</button></footer>
            </article>
          </div>
          <div className="exam-submit-footer"><span>{saving === 'error' ? `Không thể lưu câu trả lời gần nhất: ${saveError || 'hãy kiểm tra kết nối'}. Bạn vẫn có thể nộp bài để gửi câu trả lời hiện tại.` : 'Câu trả lời được tự động lưu trên máy chủ.'}</span><button className="button-primary" type="button" onClick={() => void finishAttempt()} disabled={submitting}>{submitting ? 'Đang nộp...' : 'Nộp bài thi'}</button></div>
        </> : null}
      </section>}

      <section className="builder-panel student-history">
        <div className="list-heading"><div><h3>Lịch sử dự thi</h3><p>Các bài thi đã bắt đầu bằng tài khoản của bạn.</p></div><button className="button-secondary" type="button" onClick={() => void refreshHistory()}>Làm mới</button></div>
        {history.length ? history.map((item) => (
          <article className="student-history-row" key={item.id}>
            <div><strong>{item.exam_title}</strong><small>{item.room_name} · {new Date(item.started_at).toLocaleString('vi-VN')}</small></div>
            <span className={`status-pill ${item.submitted_at ? 'published' : 'draft'}`}>{item.submitted_at ? item.score !== null ? `${item.score} điểm` : 'Đã nộp · chờ chấm' : 'Đang làm'}</span>
            {!item.submitted_at && <button className="text-button" type="button" disabled={loading} onClick={() => void resumeAttempt(item.access_code)}>Tiếp tục</button>}
          </article>
        )) : <p className="muted-copy">Chưa có bài thi nào.</p>}
      </section>
    </section>
  );
}

export default function OnlineExamPage({ user }: { user: User }) {
  return user.role === 'student' ? <StudentExam /> : <TeacherRooms />;
}
