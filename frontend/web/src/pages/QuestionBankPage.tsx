import { useEffect, useState } from 'react';
import {
  getQuestions, createQuestion, updateQuestion, deleteQuestion,
  getQuestionSubjects, type Question
} from '../services/api';

type DifficultyLevel = 'easy' | 'medium' | 'hard';
type QuestionFormType = 'multipleChoice' | 'essay';

const DIFFICULTY_LABELS: Record<string, string> = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
const DIFFICULTY_COLORS: Record<string, string> = { easy: 'green', medium: 'orange', hard: 'red' };
const TYPE_LABELS: Record<string, string> = { multipleChoice: 'Trắc nghiệm', essay: 'Tự luận' };

const emptyForm: { content: string; subject: string; difficulty: DifficultyLevel; type: QuestionFormType; choices: string[]; answer: number } = {
  content: '', subject: '', difficulty: 'medium', type: 'essay',
  choices: ['', '', '', ''], answer: 0,
};

export default function QuestionBankPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<{ content: string; subject: string; difficulty: DifficultyLevel; type: QuestionFormType; choices: string[]; answer: number }>({ ...emptyForm });
  const [filters, setFilters] = useState({ subject: '', difficulty: '', type: '', search: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const res = await getQuestions({ ...filters, page, limit: LIMIT });
      setQuestions(res.data);
      setTotal(res.total);
    } catch { setQuestions([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    getQuestionSubjects().then(r => setSubjects(r.data)).catch(() => {});
  }, []);

  useEffect(() => { fetchQuestions(); }, [filters, page]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (q: Question) => {
    setEditId(q.id);
    setForm({
      content: q.text || q.content || '',
      subject: q.subject,
      difficulty: q.difficulty as DifficultyLevel,
      type: (q.type === 'multipleChoice' ? 'multipleChoice' : 'essay') as QuestionFormType,
      choices: (q.choices && q.choices.length >= 4) ? [...q.choices] : ['', '', '', ''],
      answer: q.answer ?? q.answer_index ?? 0,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.content.trim() || !form.subject.trim()) {
      setMessage('Vui lòng nhập nội dung câu hỏi và môn học.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        text: form.content.trim(),
        content: form.content.trim(),
        subject: form.subject.trim(),
        difficulty: form.difficulty,
        type: form.type,
        choices: form.type === 'multipleChoice' ? form.choices.filter(c => c.trim()) : [],
        answer: form.type === 'multipleChoice' ? form.answer : 0,
      };
      if (editId) {
        await updateQuestion(editId, payload);
        setMessage('Đã cập nhật câu hỏi thành công.');
      } else {
        await createQuestion(payload);
        setMessage('Đã tạo câu hỏi mới thành công.');
      }
      setShowForm(false);
      setEditId(null);
      fetchQuestions();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi lưu câu hỏi.');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string, text: string) => {
    if (!confirm(`Xóa câu hỏi: "${text.slice(0, 60)}..."?`)) return;
    try {
      await deleteQuestion(id);
      setMessage('Đã xóa câu hỏi.');
      fetchQuestions();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi xóa.');
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">QUESTION BANK / NGÂN HÀNG CÂU HỎI</p>
          <h2>Quản lý ngân hàng câu hỏi</h2>
          <p className="muted-copy">Tạo, chỉnh sửa và quản lý toàn bộ câu hỏi theo môn học và độ khó.</p>
        </div>
        <button className="button-primary" onClick={openCreate}>+ Thêm câu hỏi</button>
      </div>

      {message && (
        <div className="alert-banner" onClick={() => setMessage('')} style={{ cursor: 'pointer' }}>
          {message} <span style={{ opacity: 0.6 }}>(click để đóng)</span>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card blue"><div className="stat-icon">QB</div><div className="stat-value">{total}</div><div className="stat-label">Tổng câu hỏi</div></div>
        <div className="stat-card green"><div className="stat-icon">MC</div><div className="stat-value">{questions.filter(q => q.type === 'multipleChoice').length}</div><div className="stat-label">Trắc nghiệm</div></div>
        <div className="stat-card orange"><div className="stat-icon">ES</div><div className="stat-value">{questions.filter(q => q.type !== 'multipleChoice').length}</div><div className="stat-label">Tự luận</div></div>
        <div className="stat-card red"><div className="stat-icon">SB</div><div className="stat-value">{subjects.length}</div><div className="stat-label">Môn học</div></div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <input
            className="form-input" placeholder="🔍 Tìm câu hỏi..."
            value={filters.search}
            onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
          />
          <select className="form-input" value={filters.subject}
            onChange={e => { setFilters(f => ({ ...f, subject: e.target.value })); setPage(1); }}>
            <option value="">Tất cả môn học</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-input" value={filters.difficulty}
            onChange={e => { setFilters(f => ({ ...f, difficulty: e.target.value })); setPage(1); }}>
            <option value="">Tất cả độ khó</option>
            <option value="easy">Dễ</option>
            <option value="medium">Trung bình</option>
            <option value="hard">Khó</option>
          </select>
          <select className="form-input" value={filters.type}
            onChange={e => { setFilters(f => ({ ...f, type: e.target.value })); setPage(1); }}>
            <option value="">Tất cả loại</option>
            <option value="multipleChoice">Trắc nghiệm</option>
            <option value="essay">Tự luận</option>
          </select>
        </div>
      </div>

      {/* Question List */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>Đang tải câu hỏi...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {questions.length === 0 && (
            <div className="empty-library">Chưa có câu hỏi nào. Nhấn "+ Thêm câu hỏi" để bắt đầu.</div>
          )}
          {questions.map((q, idx) => (
            <div key={q.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ color: '#9ca3af', fontSize: '12px', minWidth: '30px', paddingTop: '2px' }}>
                  {(page - 1) * LIMIT + idx + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span className={`status-pill ${DIFFICULTY_COLORS[q.difficulty] || 'blue'}`}>
                      {DIFFICULTY_LABELS[q.difficulty] || q.difficulty}
                    </span>
                    <span className="status-pill blue">{TYPE_LABELS[q.type || 'essay'] || q.type}</span>
                    <span className="exam-id">{q.subject}</span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '6px' }}>
                    {q.text || q.content}
                  </p>
                  {q.type === 'multipleChoice' && q.choices && q.choices.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {q.choices.map((c, ci) => (
                        <span key={ci} style={{ color: ci === (q.answer ?? 0) ? 'var(--primary)' : 'inherit', fontWeight: ci === (q.answer ?? 0) ? 600 : 400 }}>
                          {['A', 'B', 'C', 'D'][ci]}. {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {q.creator_name && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                      Tạo bởi: {q.creator_name}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button className="button-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => openEdit(q)}>Sửa</button>
                  <button className="button-danger" style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleDelete(q.id, q.text || q.content || '')}>Xóa</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px' }}>
          <button className="button-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Trước</button>
          <span style={{ padding: '8px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>
            {page} / {totalPages}
          </span>
          <button className="button-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Sau ›</button>
        </div>
      )}

      {/* Modal Form */}
      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal-card">
            <div className="modal-header">
              <h3>{editId ? 'Chỉnh sửa câu hỏi' : 'Thêm câu hỏi mới'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="field-label">Nội dung câu hỏi *</label>
              <textarea className="form-input" rows={3}
                placeholder="Nhập nội dung câu hỏi..."
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '12px' }}>
                <div>
                  <label className="field-label">Môn học *</label>
                  <input className="form-input" placeholder="VD: Kiến trúc cơ sở"
                    value={form.subject}
                    onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                </div>
                <div>
                  <label className="field-label">Độ khó</label>
                  <select className="form-input" value={form.difficulty}
                    onChange={e => setForm(f => ({ ...f, difficulty: e.target.value as DifficultyLevel }))}>
                    <option value="easy">Dễ</option>
                    <option value="medium">Trung bình</option>
                    <option value="hard">Khó</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Loại câu hỏi</label>
                  <select className="form-input" value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as QuestionFormType }))}>
                    <option value="essay">Tự luận</option>
                    <option value="multipleChoice">Trắc nghiệm</option>
                  </select>
                </div>
              </div>
              {form.type === 'multipleChoice' && (
                <div style={{ marginTop: '12px' }}>
                  <label className="field-label">Các phương án (đánh dấu đáp án đúng)</label>
                  {form.choices.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                      <input type="radio" name="answer" checked={form.answer === i}
                        onChange={() => setForm(f => ({ ...f, answer: i }))} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', width: '20px', color: 'var(--text-secondary)' }}>
                        {['A', 'B', 'C', 'D'][i]}.
                      </span>
                      <input className="form-input" style={{ flex: 1 }}
                        placeholder={`Phương án ${['A', 'B', 'C', 'D'][i]}`}
                        value={c}
                        onChange={e => setForm(f => ({
                          ...f, choices: f.choices.map((v, j) => j === i ? e.target.value : v)
                        }))} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="button-secondary" onClick={() => setShowForm(false)}>Hủy</button>
              <button className="button-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Đang lưu...' : editId ? 'Cập nhật' : 'Thêm câu hỏi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
