import { useEffect, useState } from 'react';
import { getExams, type ExamSummary, updateExam } from '../services/api';

const statusMeta: Record<string, { label: string; className: string }> = {
  draft: { label: 'Bản nháp', className: 'status-pill draft' },
  review: { label: 'Chờ duyệt', className: 'status-pill review' },
  approved: { label: 'Đã duyệt', className: 'status-pill approved' },
  published: { label: 'Đã phát hành', className: 'status-pill published' },
};

export default function ApprovalPage() {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getExams()
      .then((result) => setExams(result.data))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (id: string, nextStatus: 'draft' | 'review' | 'approved' | 'published') => {
    await updateExam(id, { status: nextStatus, workflowStatus: nextStatus });
    setExams((current) => current.map((exam) => exam.id === id ? { ...exam, status: nextStatus, workflowStatus: nextStatus } : exam));
  };

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">APPROVAL / DUYỆT ĐỀ</p>
          <h2>Phê duyệt và phát hành đề thi</h2>
          <p className="muted-copy">Theo dõi tiến độ review, xác thực đề thi và phát hành theo chuẩn doanh nghiệp.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card red">
          <div className="stat-icon">DR</div>
          <div className="stat-value">{exams.filter((exam) => (exam.workflowStatus || exam.status) === 'draft').length}</div>
          <div className="stat-label">Bản nháp</div>
          <div className="stat-sub">Đang chuẩn bị</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">RV</div>
          <div className="stat-value">{exams.filter((exam) => (exam.workflowStatus || exam.status) === 'review').length}</div>
          <div className="stat-label">Chờ duyệt</div>
          <div className="stat-sub">Cần xem xét</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">AP</div>
          <div className="stat-value">{exams.filter((exam) => (exam.workflowStatus || exam.status) === 'approved').length}</div>
          <div className="stat-label">Đã duyệt</div>
          <div className="stat-sub">Sẵn sàng phát hành</div>
        </div>
      </div>

      {loading ? (
        <div className="card">Đang tải danh sách đề...</div>
      ) : (
        <div className="exam-library-grid">
          {exams.map((exam) => {
            const currentStatus = (exam.workflowStatus || exam.status || 'draft') as 'draft' | 'review' | 'approved' | 'published';
            const meta = statusMeta[currentStatus] || statusMeta.draft;

            return (
              <article className="exam-library-card" key={exam.id}>
                <div className="exam-card-top">
                  <span className={meta.className}>{meta.label}</span>
                  <span className="exam-id">{exam.id}</span>
                </div>

                <h4>{exam.title}</h4>
                <p>
                  {exam.subject} · {exam.examType || 'Giữa kỳ'} · {exam.department || 'Ban kiểm định'}
                </p>
                <p>
                  Người phụ trách: {exam.ownerName || 'Chưa cập nhật'} · Phê duyệt: {exam.approver || 'Chưa chỉ định'}
                </p>

                <div className="detail-summary">
                  <span><b>{exam.questionIds.length}</b> câu</span>
                  <span><b>{exam.totalScore ?? 10}</b> điểm</span>
                  <span><b>{exam.durationMinutes ?? 45}</b> phút</span>
                </div>

                <div className="exam-card-actions">
                  {currentStatus === 'draft' && (
                    <button className="button-primary" onClick={() => updateStatus(exam.id, 'review')}>Gửi duyệt</button>
                  )}
                  {currentStatus === 'review' && (
                    <button className="button-secondary" onClick={() => updateStatus(exam.id, 'approved')}>Phê duyệt</button>
                  )}
                  {currentStatus === 'approved' && (
                    <button className="button-primary" onClick={() => updateStatus(exam.id, 'published')}>Phát hành</button>
                  )}
                  {currentStatus === 'published' && (
                    <button className="button-secondary" onClick={() => updateStatus(exam.id, 'draft')}>Khôi phục</button>
                  )}
                </div>
              </article>
            );
          })}

          {!exams.length && (
            <div className="empty-library">Chưa có đề thi nào trong quy trình phê duyệt.</div>
          )}
        </div>
      )}
    </section>
  );
}
