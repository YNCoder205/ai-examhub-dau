import { useEffect, useRef, useState } from 'react';
import { analyzeExamDocument, createExamRoom, createExamVariants, deleteExam, generateExam, getExam, getExams, hasAuthToken, type ExamSummary, updateExam, uploadExamDocument } from '../services/api';

type CognitiveLevel = 'understanding' | 'application';
type RubricCriterion = { name: string; weight: number; levels: Array<{ name: string; points: number; descriptor: string }> };
type EssayRubric = { type: 'analytic'; scale: Array<{ name: string; multiplier: number }>; criteria: RubricCriterion[] };
type Question = { id: string; text: string; subject: string; difficulty: string; type?: 'multipleChoice' | 'essay'; choices?: string[]; answer?: number; answerText?: string; sourceEvidence?: string; cognitiveLevel?: CognitiveLevel | null; rubric?: EssayRubric | null };

const isMultipleChoiceQuestion = (question: Question) => question.type === 'multipleChoice' || (Array.isArray(question.choices) && question.choices.length >= 2);

const selectFromPoolByDifficulty = (
  pool: Question[],
  targetCount: number,
  targetDifficulty: Record<'easy' | 'medium' | 'hard', number>
): Question[] => {
  if (targetCount <= 0 || !pool.length) return [];
  const totalWeight = (targetDifficulty.easy || 0) + (targetDifficulty.medium || 0) + (targetDifficulty.hard || 0) || 100;

  const targetEasy = Math.round(targetCount * (targetDifficulty.easy || 0) / totalWeight);
  const targetHard = Math.round(targetCount * (targetDifficulty.hard || 0) / totalWeight);
  const targetMedium = Math.max(0, targetCount - targetEasy - targetHard);

  const easyList = pool.filter((q) => q.difficulty === 'easy');
  const mediumList = pool.filter((q) => q.difficulty === 'medium' || !['easy', 'hard'].includes(q.difficulty));
  const hardList = pool.filter((q) => q.difficulty === 'hard');

  const picked: Question[] = [
    ...easyList.slice(0, targetEasy),
    ...mediumList.slice(0, targetMedium),
    ...hardList.slice(0, targetHard),
  ];

  const pickedIds = new Set(picked.map((q) => q.id));
  if (picked.length < targetCount) {
    const remaining = pool.filter((q) => !pickedIds.has(q.id));
    picked.push(...remaining.slice(0, targetCount - picked.length));
  }

  return picked.slice(0, targetCount);
};

const buildQuestionSelection = (
  source: Question[],
  targetMultipleChoice: number,
  targetEssay: number,
  targetDifficulty: Record<'easy' | 'medium' | 'hard', number>,
  cognitiveDistribution: Record<CognitiveLevel, number>,
) => {
  const totalTarget = Math.max(0, Number(targetMultipleChoice || 0) + Number(targetEssay || 0));
  if (!source.length || totalTarget === 0) return [];

  const mcPool = source.filter((question) => isMultipleChoiceQuestion(question));
  const essayPool = source.filter((question) => !isMultipleChoiceQuestion(question));

  const targetMc = Math.max(0, Number(targetMultipleChoice || 0));
  const targetEs = Math.max(0, Number(targetEssay || 0));

  const selectedMc = selectFromPoolByDifficulty(mcPool, targetMc, targetDifficulty);
  const selectedEs = [
    ...selectFromPoolByDifficulty(
      essayPool.filter((question) => question.cognitiveLevel === 'understanding'),
      Math.min(targetEs, cognitiveDistribution.understanding),
      targetDifficulty,
    ),
    ...selectFromPoolByDifficulty(
      essayPool.filter((question) => question.cognitiveLevel === 'application'),
      Math.min(targetEs, cognitiveDistribution.application),
      targetDifficulty,
    ),
  ];

  const combined = [...selectedMc, ...selectedEs];

  return combined.slice(0, totalTarget).map((question) => question.id);
};

const sampleQuestions: Question[] = [
  { id: 'q-001', text: 'Trong kiến trúc, công năng của mặt bằng là gì?', subject: 'Kiến trúc cơ sở', difficulty: 'easy', type: 'multipleChoice', choices: ['Tổ chức không gian', 'Trang trí mặt đứng', 'Tính toán kết cấu', 'Lập dự toán'], answer: 0 },
  { id: 'q-002', text: 'Phân tích các yếu tố ảnh hưởng trực tiếp đến chiếu sáng tự nhiên trong công trình.', subject: 'Môi trường', difficulty: 'medium', type: 'essay', choices: [] },
  { id: 'q-003', text: 'Tỷ lệ bản vẽ được dùng để làm gì?', subject: 'Đồ họa kiến trúc', difficulty: 'easy', type: 'multipleChoice', choices: ['Biểu diễn kích thước thu nhỏ', 'Xác định tải trọng', 'Đo độ ẩm', 'Tính giá vật liệu'], answer: 0 },
];

const getChoiceLabel = (index: number) => ['A', 'B', 'C', 'D', 'E', 'F'][index] ?? String(index + 1);

const getAnswerText = (question: Question) => {
  if (!question.choices?.length) return question.answerText ? `Đáp án tham khảo: ${question.answerText}` : 'Chưa có đáp án tham khảo';
  const answerIndex = Number(question.answer ?? 0);
  const answerChoice = question.choices[answerIndex] ?? '—';
  const answerLabel = `Đáp án ${getChoiceLabel(answerIndex)}: ${answerChoice}`;
  return question.answerText && question.answerText.trim().toLocaleLowerCase('vi-VN') !== answerChoice.trim().toLocaleLowerCase('vi-VN')
    ? `${answerLabel}. ${question.answerText}`
    : answerLabel;
};

const locateSourceEvidence = (content: string, evidence: string) => {
  const escapedEvidence = evidence.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!content || !escapedEvidence) return null;

  const match = new RegExp(escapedEvidence, 'i').exec(content);
  if (!match || match.index === undefined) return null;

  const start = match.index;
  const end = start + match[0].length;
  return {
    before: content.slice(0, start),
    highlight: content.slice(start, end),
    after: content.slice(end),
    line: content.slice(0, start).split(/\r?\n/).length,
  };
};

export default function ExamBuilderPage() {
  const [title, setTitle] = useState('Đề kiểm tra Kiến trúc cơ sở');
  const [subject, setSubject] = useState('Kiến trúc cơ sở');
  const [faculty, setFaculty] = useState('Khoa Kiến trúc');
  const [academicYear, setAcademicYear] = useState('2024-2025');
  const [semester, setSemester] = useState('1');
  const [examCode, setExamCode] = useState('101');
  const [examDate, setExamDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<string[]>([]);
  const [document, setDocument] = useState<{ id: string; filename: string; size: number; mimeType: string } | null>(null);
  const [sourceFile, setSourceFile] = useState<{ documentId: string; file: File } | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(null);
  const [multipleChoice, setMultipleChoice] = useState(2);
  const [essay, setEssay] = useState(1);
  const [essayCognitiveDistribution, setEssayCognitiveDistribution] = useState<Record<CognitiveLevel, number>>({ understanding: 1, application: 0 });
  const [difficulty, setDifficulty] = useState({ easy: 30, medium: 50, hard: 20 });
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [totalScore, setTotalScore] = useState(10);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [ownerName, setOwnerName] = useState('Nguyễn Văn Thái');
  const [department, setDepartment] = useState('Bộ môn Công nghệ thông tin');
  const [examType, setExamType] = useState('Giữa kỳ');
  const [securityLevel, setSecurityLevel] = useState<'internal' | 'restricted' | 'confidential'>('restricted');
  const [approver, setApprover] = useState('PGS. Nguyễn Đức Y');
  const [workflowStatus, setWorkflowStatus] = useState<'draft' | 'review' | 'approved' | 'published'>('draft');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [examId, setExamId] = useState<string | null>(null);
  const [lastCreatedExamId, setLastCreatedExamId] = useState<string | null>(null);
  const [variantCount, setVariantCount] = useState(4);
  const [variantCodes, setVariantCodes] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [aiCandidates, setAiCandidates] = useState<Question[]>([]);
  const [analysisConfidence, setAnalysisConfidence] = useState<number | null>(null);
  const [onlineRoomId, setOnlineRoomId] = useState<string | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [isDeletingAllExams, setIsDeletingAllExams] = useState(false);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getExam>> | null>(null);
  const [sourceQuestionId, setSourceQuestionId] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [extractedContent, setExtractedContent] = useState<string>('');
  const [isDocumentPreviewOpen, setIsDocumentPreviewOpen] = useState(false);
  const sourceHighlightRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sourceFile) {
      setSourceFileUrl(null);
      return;
    }

    const url = URL.createObjectURL(sourceFile.file);
    setSourceFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  useEffect(() => { getExams().then((result) => setExams(result.data)).catch(() => undefined); }, []);
  useEffect(() => {
    if (sourceQuestionId) sourceHighlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [sourceQuestionId]);
  useEffect(() => {
    if (!aiCandidates.length) return;
    const nextSelected = buildQuestionSelection(aiCandidates, multipleChoice, essay, difficulty, essayCognitiveDistribution);
    setSelected((current) => {
      const currentKey = current.join('|');
      const nextKey = nextSelected.join('|');
      return currentKey === nextKey ? current : nextSelected;
    });
  }, [aiCandidates, difficulty, essay, essayCognitiveDistribution, multipleChoice]);

  const totalQuestionCount = multipleChoice + essay;
  const activeSourceQuestion = detail?.questions.find((question) => question.id === sourceQuestionId) ?? null;
  const activeSourceEvidence = activeSourceQuestion?.sourceEvidence?.trim() || '';
  const hasMatchingDocument = Boolean(detail?.document?.id && sourceFile?.documentId === detail.document.id && extractedContent);
  const sourceLocation = locateSourceEvidence(hasMatchingDocument ? extractedContent : '', activeSourceEvidence);
  const isPdf = hasMatchingDocument && Boolean(sourceFile && (sourceFile.file.type === 'application/pdf' || sourceFile.file.name.toLowerCase().endsWith('.pdf')));

  const detectSubjectFromDocumentName = (filename: string, fallback = subject) => {
    const clean = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return clean || fallback;
  };

  const changeEssayCount = (count: number) => {
    const nextCount = Math.max(0, count);
    setEssay(nextCount);
    setEssayCognitiveDistribution((current) => {
      const currentTotal = current.understanding + current.application;
      if (!nextCount) return { understanding: 0, application: 0 };
      if (!currentTotal) return { understanding: nextCount, application: 0 };
      const understanding = Math.round(nextCount * current.understanding / currentTotal);
      return { understanding, application: nextCount - understanding };
    });
  };

  const changeEssayCognitiveCount = (level: CognitiveLevel, count: number) => {
    const nextDistribution = { ...essayCognitiveDistribution, [level]: Math.max(0, count) };
    setEssayCognitiveDistribution(nextDistribution);
    setEssay(nextDistribution.understanding + nextDistribution.application);
  };

  const toggleQuestion = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const handleDocument = async (file: File | undefined) => {
    if (!file) return;
    if (!hasAuthToken()) {
      setMessage('Vui lòng đăng nhập bằng tài khoản giảng viên để tải và phân tích tài liệu.');
      return;
    }
    const allowedExtensions = /\.(pdf|docx?|txt)$/i;
    if (!allowedExtensions.test(file.name)) {
      setMessage('Định dạng chưa được hỗ trợ. Vui lòng chọn PDF, DOC, DOCX hoặc TXT.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage('Tài liệu vượt quá giới hạn 20 MB. Vui lòng chọn tệp nhỏ hơn.');
      return;
    }

    setIsAnalyzing(true);
    setMessage('AI đang đọc và phân tích cấu trúc tài liệu...');
    setDocument(null);
    setSourceFile(null);
    setExtractedContent('');
    setAiCandidates([]);
    setSelected([]);
    setAnalysisConfidence(null);
    setIsDocumentPreviewOpen(false);
    try {
      const uploaded = await uploadExamDocument(file);
      const inferredSubject = detectSubjectFromDocumentName(uploaded.filename || file.name, subject);

      if (uploaded.documentMetadata) {
        if (uploaded.documentMetadata.subjectName) {
          setSubject(uploaded.documentMetadata.subjectName);
          setTitle(`Đề thi ${uploaded.documentMetadata.examType || 'kết thúc học phần'} - ${uploaded.documentMetadata.subjectName}`);
        } else if (!subject.trim()) {
          setSubject(inferredSubject);
          setTitle(`Đề thi ${examType} - ${inferredSubject}`);
        }
        if (uploaded.documentMetadata.faculty) {
          setFaculty(uploaded.documentMetadata.faculty);
        }
        if (uploaded.documentMetadata.academicYear) {
          setAcademicYear(uploaded.documentMetadata.academicYear);
        }
        if (uploaded.documentMetadata.semester) {
          setSemester(uploaded.documentMetadata.semester);
        }
        if (uploaded.documentMetadata.examType) {
          setExamType(uploaded.documentMetadata.examType);
        }
      } else if (!subject.trim()) {
        setSubject(inferredSubject);
        setTitle(`Đề thi ${examType} - ${inferredSubject}`);
      }

      setDocument({ id: uploaded.id, filename: uploaded.filename, size: uploaded.size || file.size, mimeType: uploaded.mimeType || file.type });
      setSourceFile({ documentId: uploaded.id, file });

      const extractedText = uploaded.extractedText?.trim() || (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') ? await file.text() : '');
      setExtractedContent(extractedText || '');
      if (!extractedText.trim()) {
        setMessage(`Đã tải "${uploaded.filename}" nhưng chưa đọc được nội dung. Hãy kiểm tra tệp có văn bản/OCR và thử lại.`);
        return;
      }

      const activeSubject = uploaded.documentMetadata?.subjectName || subject.trim() || inferredSubject;
      const analysis = await analyzeExamDocument({
        documentId: uploaded.id,
        subject: activeSubject,
        requestedCount: Math.max(30, totalQuestionCount * 2),
        content: extractedText || '',
        questionTypes: { multipleChoice, essay },
        difficultyDistribution: difficulty,
        cognitiveDistribution: essayCognitiveDistribution,
      });
      setAiCandidates(analysis.candidates);
      const nextSelected = buildQuestionSelection(analysis.candidates, multipleChoice, essay, difficulty, essayCognitiveDistribution);
      setSelected(nextSelected);
      setAnalysisConfidence(analysis.confidence);
      setIsDocumentPreviewOpen(true);
      setMessage(analysis.candidates.length
        ? `Đã đọc ${extractedText.length.toLocaleString('vi-VN')} ký tự từ "${uploaded.filename}". ${analysis.summary}`
        : `Đã đọc tài liệu nhưng chưa nhận diện được câu hỏi. Hãy kiểm tra nội dung trước khi tạo đề.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định.';
      setMessage(`Không thể đọc hoặc phân tích tài liệu: ${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  };
  const createExam = async () => {
    // ── Step 0: validate form fields ──
    if (!title.trim()) { setMessage('❌ Thiếu tên đề thi.'); return; }
    if (!subject.trim()) { setMessage('❌ Thiếu môn học.'); return; }
    if (!ownerName.trim()) { setMessage('❌ Thiếu tên người phụ trách.'); return; }
    if (!department.trim()) { setMessage('❌ Thiếu đơn vị/bộ môn.'); return; }
    if (multipleChoice + essay === 0) { setMessage('❌ Phải có ít nhất 1 câu hỏi.'); return; }
    if (essayCognitiveDistribution.understanding + essayCognitiveDistribution.application !== essay) {
      setMessage('❌ Phân bổ câu tự luận thông hiểu và vận dụng phải bằng tổng số câu tự luận.');
      return;
    }
    if (totalScore <= 0) { setMessage('❌ Tổng điểm phải lớn hơn 0.'); return; }
    if (durationMinutes <= 0) { setMessage('❌ Thời gian làm bài phải lớn hơn 0 phút.'); return; }
    const diffTotal = difficulty.easy + difficulty.medium + difficulty.hard;
    if (diffTotal !== 100) { setMessage(`❌ Tỷ lệ độ khó phải cộng lại bằng 100% (hiện: ${diffTotal}%).`); return; }
    if (document && (!extractedContent.trim() || !aiCandidates.length)) {
      setMessage('❌ Tài liệu chưa có nội dung/câu hỏi đã phân tích. Hãy tải lại hoặc chọn nguồn câu hỏi khác.');
      return;
    }

    setIsCreating(true);

    try {
      // ── Step 1: re-analyze document if needed ──
      let candidatesToUse = aiCandidates;
      let selectedToUse = selected;
      const selectionMatchesMatrix = (questions: Question[], ids: string[]) => {
        const chosen = questions.filter((question) => ids.includes(question.id));
        const chosenEssay = chosen.filter((question) => !isMultipleChoiceQuestion(question));
        return chosen.length === multipleChoice + essay
          && chosen.filter(isMultipleChoiceQuestion).length === multipleChoice
          && chosenEssay.filter((question) => question.cognitiveLevel === 'understanding').length === essayCognitiveDistribution.understanding
          && chosenEssay.filter((question) => question.cognitiveLevel === 'application').length === essayCognitiveDistribution.application;
      };
      if (!selectionMatchesMatrix(candidatesToUse, selectedToUse)) {
        selectedToUse = buildQuestionSelection(candidatesToUse, multipleChoice, essay, difficulty, essayCognitiveDistribution);
      }
      if (document && extractedContent && !selectionMatchesMatrix(candidatesToUse, selectedToUse)) {
        setMessage('⏳ Bước 1/5 — Đang phân tích lại tài liệu để đủ câu hỏi...');
        const reanalysis = await analyzeExamDocument({
          documentId: document.id,
          subject,
          requestedCount: Math.max(50, (multipleChoice + essay) * 3),
          content: extractedContent,
          questionTypes: { multipleChoice, essay },
          difficultyDistribution: difficulty,
          cognitiveDistribution: essayCognitiveDistribution,
        });
        candidatesToUse = reanalysis.candidates;
        setAiCandidates(reanalysis.candidates);
        selectedToUse = buildQuestionSelection(reanalysis.candidates, multipleChoice, essay, difficulty, essayCognitiveDistribution);
        setSelected(selectedToUse);
      }
      if (document && !selectionMatchesMatrix(candidatesToUse, selectedToUse)) {
        setMessage('❌ Tài liệu chưa tạo đủ câu hỏi theo ma trận tự luận đã chọn. Hãy đổi số câu/mức tư duy hoặc tải tài liệu phù hợp hơn.');
        return;
      }

      // ── Step 2: determine questionIds to send ──
      // Only send IDs that look like real UUIDs (from DB), not in-memory "q-001" style
      setMessage('⏳ Bước 2/5 — Đang xác định câu hỏi theo ma trận...');
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validDbIds = selectedToUse.filter(id => uuidPattern.test(id));
      // If AI candidates have DB UUIDs, use those; otherwise let backend pick from subject pool
      const questionIdsToSend = validDbIds.length >= multipleChoice + essay ? validDbIds : undefined;
      if (document && !questionIdsToSend) {
        setMessage(`❌ Tài liệu chỉ tạo được ${validDbIds.length}/${multipleChoice + essay} câu hỏi lưu trong ngân hàng. Không tạo đề từ câu hỏi ngoài tài liệu.`);
        return;
      }

      const finalStatus: 'draft' | 'review' | 'approved' | 'published' =
        workflowStatus === 'published' ? 'published' :
        workflowStatus === 'approved' ? 'approved' :
        workflowStatus === 'review' ? 'review' : 'draft';

      // ── Step 3: call backend generate ──
      setMessage('⏳ Bước 3/5 — Đang tạo đề thi và lưu vào cơ sở dữ liệu...');
      const exam = await generateExam({
        title: title.trim(),
        subject: subject.trim(),
        questionIds: questionIdsToSend,
        questionTypes: { multipleChoice, essay },
        difficultyDistribution: difficulty,
        durationMinutes,
        totalScore,
        shuffleQuestions,
        ownerName: ownerName.trim(),
        department: department.trim(),
        examType,
        securityLevel,
        approver: approver.trim(),
        academicYear,
        semester,
        faculty,
        examCode,
        examDate,
        status: finalStatus,
        workflowStatus: finalStatus,
        document: document ? { id: document.id, filename: document.filename } : undefined,
      });

      setExamId(exam.id);
      setLastCreatedExamId(exam.id);

      // ── Step 4: show blueprint / warnings ──
      setMessage('⏳ Bước 4/5 — Đang kiểm tra và đọc lại dữ liệu từ DB...');
      const blueprint = exam.blueprint;
      const warnings = exam.warnings || [];

      // ── Step 5: reload exam detail and library ──
      try {
        const createdDetail = await getExam(exam.id);
        setDetail(createdDetail);
        setAiCandidates(createdDetail.questions as Question[]);
        setSelected(createdDetail.questions.map(q => q.id));
      } catch {
        /* detail load failure is non-critical */
      }
      try {
        const list = await getExams();
        setExams(list.data);
      } catch { /* ignore */ }

      // ── Step 5: compose success message ──
      const statusMsg =
        finalStatus === 'published' ? '🟢 Đã phát hành đề thi.' :
        finalStatus === 'approved'  ? '✅ Đề thi đã phê duyệt — sẵn sàng phát hành.' :
        finalStatus === 'review'    ? '🔵 Đã gửi kiểm duyệt nội bộ.' :
        '📋 Đã lưu bản nháp vào cơ sở dữ liệu.';

      const blueprintMsg = blueprint
        ? ` Đề có ${blueprint.actualTotal} câu (${blueprint.actualMC} TN + ${blueprint.actualEssay} TL).`
        : ` Đề có ${exam.questions?.length ?? 0} câu.`;

      const warningMsg = warnings.length
        ? ` ⚠️ ${warnings[0].message}`
        : '';

      setMessage(`✅ Bước 5/5 — ${statusMsg}${blueprintMsg}${warningMsg}`);

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi không xác định.';
      // Do NOT create a local fake exam — report the real error
      setMessage(`❌ Tạo đề thất bại: ${errMsg} — Kiểm tra kết nối backend và ngân hàng câu hỏi.`);
    } finally {
      setIsCreating(false);
    }
  };

  const editExam = async () => {
    if (!examId) return createExam();
    const finalStatus = workflowStatus === 'published' ? 'published' : workflowStatus === 'approved' ? 'approved' : workflowStatus === 'review' ? 'review' : 'draft';
    await updateExam(examId, {
      title: title.trim(),
      subject: subject.trim(),
      questionTypes: { multipleChoice, essay },
      difficultyDistribution: difficulty,
      durationMinutes,
      totalScore,
      shuffleQuestions,
      ownerName: ownerName.trim(),
      department: department.trim(),
      examType,
      securityLevel,
      approver: approver.trim(),
      academicYear,
      semester,
      faculty,
      examCode,
      examDate,
      status: finalStatus,
      workflowStatus: finalStatus,
    });
    setExams((current) => current.map((exam) => exam.id === examId ? {
      ...exam,
      title: title.trim(),
      subject: subject.trim(),
      questionTypes: { multipleChoice, essay },
      difficultyDistribution: difficulty,
      durationMinutes,
      totalScore,
      shuffleQuestions,
      ownerName: ownerName.trim(),
      department: department.trim(),
      examType,
      securityLevel,
      approver: approver.trim(),
      academicYear,
      semester,
      faculty,
      examCode,
      examDate,
      status: finalStatus,
      workflowStatus: finalStatus,
    } : exam));
    setIsEditing(false);
    setMessage('Đã cập nhật đề thi theo chuẩn đại học DAU.');
  };
  const removeExam = async () => {
    if (!examId || !window.confirm('Bạn có chắc muốn xóa đề thi này?')) return;
    await deleteExam(examId);
    setExamId(null);
    setVariantCodes([]);
    setExams((current) => current.filter((exam) => exam.id !== examId));
    setMessage('Đã xóa đề thi. Bạn có thể tạo đề mới.');
  };
  const publishExam = async (id: string) => {
    await updateExam(id, { status: 'published', workflowStatus: 'published' });
    setExams((current) => current.map((exam) => exam.id === id ? { ...exam, status: 'published', workflowStatus: 'published' } : exam));
    setMessage('Đề thi đã được phát hành.');
  };
  const openDetail = async (id: string) => {
    setSourceQuestionId(null);
    if (id.startsWith('local-exam-')) {
      const localExam = exams.find((exam) => exam.id === id);
      if (localExam) {
        const localPool = aiCandidates.length ? aiCandidates : selected.length ? sampleQuestions.filter((question) => selected.includes(question.id)) : sampleQuestions;
        setDetail({
          ...localExam,
          questions: localPool.filter((question) => localExam.questionIds.includes(question.id)).map((question) => ({ ...question, choices: question.choices || [], answer: question.answer || 0 })),
        });
      }
      return;
    }
    try {
      setDetail(await getExam(id));
    } catch {
      setMessage('Không thể tải nội dung đề. Vui lòng kiểm tra kết nối API.');
    }
  };
  const loadIntoEditor = (exam: ExamSummary) => {
    setExamId(exam.id);
    setTitle(exam.title);
    setSubject(exam.subject);
    setFaculty(exam.faculty || 'Khoa Kiến trúc');
    setAcademicYear(exam.academicYear || '2024-2025');
    setSemester(exam.semester || '1');
    setExamCode(exam.examCode || '101');
    setExamDate(exam.examDate || new Date().toISOString().slice(0, 10));
    setMultipleChoice(exam.questionTypes?.multipleChoice || 0);
    setEssay(exam.questionTypes?.essay || 0);
    setEssayCognitiveDistribution({ understanding: exam.questionTypes?.essay || 0, application: 0 });
    setDifficulty(exam.difficultyDistribution || difficulty);
    setDurationMinutes(exam.durationMinutes ?? 45);
    setTotalScore(exam.totalScore ?? 10);
    setShuffleQuestions(exam.shuffleQuestions ?? true);
    setOwnerName(exam.ownerName || ownerName);
    setDepartment(exam.department || department);
    setExamType(exam.examType || examType);
    setSecurityLevel((exam.securityLevel as 'internal' | 'restricted' | 'confidential') || securityLevel);
    setApprover(exam.approver || approver);
    setIsEditing(true);
    setDetail(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMessage(`Đang chỉnh sửa đề thi: "${exam.title}". Hãy điều chỉnh ma trận và bấm "Lưu thay đổi".`);
  };

  const handleDeleteExam = async (id: string, examTitle: string) => {
    if (isDeletingAllExams) return;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa đề thi "${examTitle}"?`)) return;
    try {
      await deleteExam(id);
      setExams((current) => current.filter((e) => e.id !== id));
      if (examId === id) {
        setExamId(null);
        setIsEditing(false);
        setVariantCodes([]);
      }
      if (detail?.id === id) {
        setDetail(null);
      }
      setMessage(`Đã xóa đề thi "${examTitle}" thành công.`);
    } catch {
      setMessage('Không thể xóa đề thi. Vui lòng kiểm tra lại kết nối.');
    }
  };

  const handleDeleteAllExams = async () => {
    if (!exams.length || isDeletingAllExams) return;
    const examCount = exams.length;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa toàn bộ ${examCount} đề thi trong thư viện? Thao tác này không thể hoàn tác.`)) return;

    setIsDeletingAllExams(true);
    setMessage(`Đang xóa ${examCount} đề thi...`);
    const deletedIds: string[] = [];
    const failedTitles: string[] = [];
    try {
      for (const exam of exams) {
        try {
          await deleteExam(exam.id);
          deletedIds.push(exam.id);
        } catch {
          failedTitles.push(exam.title);
        }
      }

      if (deletedIds.length) {
        const deletedIdSet = new Set(deletedIds);
        setExams((current) => current.filter((exam) => !deletedIdSet.has(exam.id)));
        if (examId && deletedIdSet.has(examId)) {
          setExamId(null);
          setIsEditing(false);
          setVariantCodes([]);
        }
        if (detail && deletedIdSet.has(detail.id)) {
          setDetail(null);
          setSourceQuestionId(null);
        }
      }

      if (failedTitles.length) {
        setMessage(`Đã xóa ${deletedIds.length}/${examCount} đề. Không xóa được: ${failedTitles.join(', ')}.`);
      } else {
        setMessage(`Đã xóa toàn bộ ${deletedIds.length} đề thi.`);
      }
    } finally {
      setIsDeletingAllExams(false);
    }
  };
  const makeVariants = async () => {
    if (!examId || examId.startsWith('local-exam-')) {
      setMessage('❌ Phải lưu đề thi vào cơ sở dữ liệu trước khi tạo mã đề.');
      return;
    }
    try {
      setMessage('⏳ Đang tạo mã đề và ánh xạ lại đáp án...');
      const result = await createExamVariants(examId, variantCount);
      setVariantCodes(result.variants.map(v => v.code));
      const answerSummary = result.variants.map(v => {
        const mcAnswers = v.answerKey.filter(k => k.type === 'multipleChoice' && k.answerLabel);
        return `${v.code}: [${mcAnswers.map(k => `C${k.position}→${k.answerLabel}`).join(', ')}]`;
      }).join(' | ');
      setMessage(`✅ ${result.message} Đáp án mỗi mã đề: ${answerSummary}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi không xác định.';
      setMessage(`❌ Tạo mã đề thất bại: ${errMsg}`);
    }
  };



  const printExam = () => {
    const printableQuestions = detail?.questions && detail.questions.length > 0
      ? detail.questions
      : aiCandidates.length > 0 && selected.length > 0
      ? aiCandidates.filter((question) => selected.includes(question.id))
      : aiCandidates.length > 0
      ? aiCandidates
      : sampleQuestions;

    if (!printableQuestions.length) {
      setMessage('Chưa có câu hỏi nào để in. Hãy tạo đề hoặc tải tài liệu lên trước.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1000,height=900');
    if (!printWindow) {
      setMessage('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép pop-up rồi thử lại.');
      return;
    }

    const mcQuestions = printableQuestions.filter(isMultipleChoiceQuestion);
    const essayQuestions = printableQuestions.filter((q) => !isMultipleChoiceQuestion(q));

    let mcScoreTotal = 0;
    let essayScoreTotal = 0;
    if (mcQuestions.length > 0 && essayQuestions.length > 0) {
      mcScoreTotal = Math.round((totalScore * mcQuestions.length / printableQuestions.length) * 2) / 2 || 6;
      essayScoreTotal = Math.round((totalScore - mcScoreTotal) * 10) / 10;
    } else if (mcQuestions.length > 0) {
      mcScoreTotal = totalScore;
      essayScoreTotal = 0;
    } else {
      mcScoreTotal = 0;
      essayScoreTotal = totalScore;
    }

    const mcPerPoint = mcQuestions.length ? (mcScoreTotal / mcQuestions.length).toFixed(2) : '0';
    const essayPerPoint = essayQuestions.length ? (essayScoreTotal / essayQuestions.length).toFixed(2) : '0';

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} - Trường ĐH Kiến Trúc Đà Nẵng</title>
  <style>
    @media print {
      @page {
        size: A4 portrait;
        margin: 14mm 15mm 14mm 15mm;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 13pt;
      line-height: 1.32;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 16px 20px;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6px;
    }
    .header-table td {
      vertical-align: top;
    }
    .header-left {
      width: 44%;
      text-align: center;
      border-right: 1px solid #000;
      padding-right: 10px;
    }
    .header-right {
      width: 56%;
      text-align: center;
      padding-left: 10px;
    }
    .univ-sub { font-size: 10.5pt; text-transform: uppercase; font-weight: normal; }
    .univ-name { font-size: 11.5pt; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
    .faculty-name { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
    .dept-name { font-size: 10.5pt; margin-top: 2px; }
    .divider-line { width: 70px; height: 1px; background: #000; margin: 4px auto; }
    .exam-title-main { font-size: 13pt; font-weight: bold; text-transform: uppercase; }
    .exam-year { font-size: 11.5pt; font-weight: bold; margin-top: 2px; }
    .exam-meta-line { font-size: 11pt; margin-top: 3px; }
    .exam-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border: 1px solid #000;
      padding: 4px 10px;
      margin: 8px 0;
      font-size: 11pt;
    }
    .code-box {
      font-size: 14pt;
      font-weight: bold;
      border: 2px solid #000;
      padding: 1px 10px;
      margin-left: 6px;
      display: inline-block;
    }
    .student-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000;
      margin-bottom: 12px;
      font-size: 11pt;
    }
    .student-table td {
      border: 1px solid #000;
      padding: 5px 8px;
    }
    .section-header {
      font-weight: bold;
      font-size: 12.5pt;
      text-transform: uppercase;
      margin: 12px 0 4px 0;
    }
    .section-desc {
      font-style: italic;
      font-size: 11pt;
      margin-bottom: 8px;
    }
    .answer-sheet-table {
      width: 100%;
      border-collapse: collapse;
      text-align: center;
      font-size: 10.5pt;
      margin-bottom: 12px;
    }
    .answer-sheet-table td {
      border: 1px solid #000;
      padding: 3px 2px;
    }
    .question-block {
      margin-bottom: 9px;
      page-break-inside: avoid;
    }
    .question-prompt {
      font-size: 12pt;
      line-height: 1.35;
    }
    .choices-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 3px 20px;
      margin-top: 3px;
      padding-left: 14px;
      font-size: 11.5pt;
    }
    .choices-single-line {
      display: flex;
      gap: 24px;
      margin-top: 3px;
      padding-left: 14px;
      font-size: 11.5pt;
    }
    .end-note {
      text-align: center;
      font-weight: bold;
      font-size: 11.5pt;
      margin-top: 18px;
    }
    .signatures-table {
      width: 100%;
      border-collapse: collapse;
      text-align: center;
      margin-top: 18px;
      font-size: 11pt;
      page-break-inside: avoid;
    }
    .page-break {
      page-break-before: always;
      margin-top: 24px;
      padding-top: 14px;
    }
  </style>
</head>
<body>
  <!-- HEADER ĐỀ THI CHUẨN ĐẠI HỌC KIẾN TRÚC ĐÀ NẴNG -->
  <table class="header-table">
    <tr>
      <td class="header-left">
        <div class="univ-sub">BỘ GIÁO DỤC VÀ ĐÀO TẠO</div>
        <div class="univ-name">TRƯỜNG ĐẠI HỌC KIẾN TRÚC ĐÀ NẴNG</div>
        <div class="faculty-name">${faculty.toUpperCase()}</div>
        <div class="dept-name">BỘ MÔN: ${(department || 'KIẾN TRÚC').toUpperCase()}</div>
        <div class="divider-line"></div>
      </td>
      <td class="header-right">
        <div class="exam-title-main">ĐỀ THI ${examType.toUpperCase()} - HỌC KỲ ${semester}</div>
        <div class="exam-year">NĂM HỌC ${academicYear}</div>
        <div class="exam-meta-line"><strong>Môn thi:</strong> ${subject}</div>
        <div class="exam-meta-line">Thời gian làm bài: <strong>${durationMinutes} phút</strong> <em>(Không kể phát đề)</em></div>
        <div class="exam-meta-line"><em>(Thí sinh không được sử dụng tài liệu)</em></div>
      </td>
    </tr>
  </table>

  <!-- THANH THÔNG TIN MÃ ĐỀ & ĐIỂM -->
  <div class="exam-bar">
    <div><strong>MÃ ĐỀ THI: <span class="code-box">${examCode}</span></strong></div>
    <div>Ngày thi: <strong>${new Date(examDate).toLocaleDateString('vi-VN')}</strong></div>
    <div>Tổng điểm: <strong>${totalScore} điểm</strong></div>
  </div>

  <!-- KHUNG THÔNG TIN THÍ SINH & ĐIỂM CHẤM -->
  <table class="student-table">
    <tr>
      <td style="width:62%; vertical-align:top;">
        <div style="margin-bottom:6px;">Họ và tên thí sinh: ....................................................................................</div>
        <div style="margin-bottom:6px;">Mã số sinh viên (MSSV): ................................. Lớp: ................................</div>
        <div>Phòng thi: .................................................... SBD: ................................</div>
      </td>
      <td style="width:38%; text-align:center; padding:0; vertical-align:top;">
        <table style="width:100%; height:100%; border-collapse:collapse; text-align:center;">
          <tr style="background:#f5f5f5;">
            <td colspan="2" style="border:none; border-bottom:1px solid #000; font-weight:bold; font-size:10.5pt; padding:3px;">ĐIỂM BÀI THI</td>
          </tr>
          <tr>
            <td style="border:none; border-right:1px solid #000; width:50%; font-size:10pt; padding:4px;">Bằng số:<br><br><br></td>
            <td style="border:none; width:50%; font-size:10pt; padding:4px;">Bằng chữ:<br><br><br></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- NỘI DUNG CÂU HỎI -->
  ${mcQuestions.length > 0 ? `
    <div>
      <div class="section-header">PHẦN I: TRẮC NGHIỆM KHÁCH QUAN (${mcQuestions.length} câu - ${mcScoreTotal} điểm)</div>
      <div class="section-desc">(Thí sinh chọn phương án trả lời đúng nhất và điền vào BẢNG TRẢ LỜI TRẮC NGHIỆM dưới đây)</div>

      <!-- BẢNG TRẢ LỜI TRẮC NGHIỆM CHUẨN ĐẠI HỌC -->
      <table class="answer-sheet-table">
        <tr style="background:#f2f2f2; font-weight:bold;">
          <td style="width:50px;">Câu</td>
          ${mcQuestions.slice(0, 20).map((_, i) => `<td>${i + 1}</td>`).join('')}
        </tr>
        <tr>
          <td style="font-weight:bold;">Đ.Án</td>
          ${mcQuestions.slice(0, 20).map(() => `<td>&nbsp;</td>`).join('')}
        </tr>
        ${mcQuestions.length > 20 ? `
        <tr style="background:#f2f2f2; font-weight:bold;">
          <td style="width:50px;">Câu</td>
          ${mcQuestions.slice(20, 40).map((_, i) => `<td>${i + 21}</td>`).join('')}
        </tr>
        <tr>
          <td style="font-weight:bold;">Đ.Án</td>
          ${mcQuestions.slice(20, 40).map(() => `<td>&nbsp;</td>`).join('')}
        </tr>
        ` : ''}
      </table>

      <!-- DANH SÁCH CÂU HỎI TRẮC NGHIỆM -->
      <div>
        ${mcQuestions.map((q, idx) => `
          <div class="question-block">
            <div class="question-prompt"><strong>Câu ${idx + 1}:</strong> ${q.text}</div>
            ${q.choices && q.choices.length ? `
              <div class="${q.choices.every(c => (c || '').length < 25) ? 'choices-single-line' : 'choices-row'}">
                ${q.choices.map((c, cIdx) => `<div><strong>${getChoiceLabel(cIdx)}.</strong> ${c}</div>`).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}

  ${essayQuestions.length > 0 ? `
    <div style="margin-top:14px;">
      <div class="section-header">PHẦN II: TỰ LUẬN (${essayQuestions.length} câu - ${essayScoreTotal} điểm)</div>
      <div>
        ${essayQuestions.map((q, idx) => `
          <div class="question-block" style="margin-bottom:12px;">
            <div class="question-prompt">
              <strong>Câu ${mcQuestions.length + idx + 1} (${essayPerPoint} điểm):</strong> ${q.text}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}

  <!-- CHÂN ĐỀ THI -->
  <div class="end-note">----------------------------------- HẾT -----------------------------------</div>
  <div style="text-align:center; font-style:italic; font-size:10.5pt; margin-top:2px;">
    (Cán bộ coi thi không giải thích gì thêm. Thí sinh nộp lại đề thi cùng bài làm)
  </div>

  <table class="signatures-table">
    <tr>
      <td style="width:50%; vertical-align:top;">
        <div style="font-weight:bold;">TRƯỞNG BỘ MÔN DUYỆT ĐỀ</div>
        <div style="font-size:10.5pt; font-style:italic;">(Ký và ghi rõ họ tên)</div>
        <div style="height:55px;"></div>
        <div style="font-weight:bold;">${approver}</div>
      </td>
      <td style="width:50%; vertical-align:top;">
        <div style="font-weight:bold;">CÁN BỘ RA ĐỀ THI</div>
        <div style="font-size:10.5pt; font-style:italic;">(Ký và ghi rõ họ tên)</div>
        <div style="height:55px;"></div>
        <div style="font-weight:bold;">${ownerName}</div>
      </td>
    </tr>
  </table>

  <!-- TRANG 2: ĐÁP ÁN & HƯỚNG DẪN CHẤM CHI TIẾT -->
  <div class="page-break">
    <div style="text-align:center; margin-bottom:14px;">
      <div style="font-size:11.5pt; font-weight:bold; text-transform:uppercase;">TRƯỜNG ĐẠI HỌC KIẾN TRÚC ĐÀ NẴNG</div>
      <div style="font-size:11pt; text-transform:uppercase; margin-top:2px;">${faculty.toUpperCase()} - BỘ MÔN ${(department || 'KIẾN TRÚC').toUpperCase()}</div>
      <div style="font-size:14pt; font-weight:bold; text-transform:uppercase; margin-top:6px;">HƯỚNG DẪN CHẤM VÀ ĐÁP ÁN ĐỀ THI</div>
      <div style="font-size:11.5pt; margin-top:3px;">
        Môn: <strong>${subject}</strong> &emsp;|&emsp; Mã đề: <strong>${examCode}</strong> &emsp;|&emsp; Học kỳ: <strong>${semester}</strong> (${academicYear})
      </div>
      <div style="font-size:10.5pt; font-style:italic; color:#444; margin-top:2px;">
        (Tài liệu bảo mật - Dùng cho cán bộ chấm thi)
      </div>
      <div class="divider-line" style="width:100px;"></div>
    </div>

    ${mcQuestions.length > 0 ? `
      <div style="margin-bottom:18px;">
        <div style="font-weight:bold; font-size:12pt; margin-bottom:6px;">
          I. ĐÁP ÁN PHẦN TRẮC NGHIỆM (${mcScoreTotal} điểm - Mỗi câu đúng được ${mcPerPoint} điểm):
        </div>
        <table class="answer-sheet-table" style="font-size:11.5pt;">
          <tr style="background:#eaf2f8; font-weight:bold;">
            <td style="width:60px;">Câu</td>
            ${mcQuestions.slice(0, 20).map((_, i) => `<td>${i + 1}</td>`).join('')}
          </tr>
          <tr style="font-weight:bold; color:#0b5394;">
            <td style="background:#f9f9f9;">Đáp án</td>
            ${mcQuestions.slice(0, 20).map((q) => `<td>${getChoiceLabel(Number(q.answer ?? 0))}</td>`).join('')}
          </tr>
          ${mcQuestions.length > 20 ? `
          <tr style="background:#eaf2f8; font-weight:bold;">
            <td style="width:60px;">Câu</td>
            ${mcQuestions.slice(20, 40).map((_, i) => `<td>${i + 21}</td>`).join('')}
          </tr>
          <tr style="font-weight:bold; color:#0b5394;">
            <td style="background:#f9f9f9;">Đáp án</td>
            ${mcQuestions.slice(20, 40).map((q) => `<td>${getChoiceLabel(Number(q.answer ?? 0))}</td>`).join('')}
          </tr>
          ` : ''}
        </table>
      </div>
    ` : ''}

    ${essayQuestions.length > 0 ? `
      <div style="margin-bottom:18px;">
        <div style="font-weight:bold; font-size:12pt; margin-bottom:6px;">
          II. HƯỚNG DẪN CHẤM VÀ BIỂU ĐIỂM TỰ LUẬN (${essayScoreTotal} điểm):
        </div>
        <table style="width:100%; border-collapse:collapse; border:1px solid #000; font-size:11pt;">
          <thead>
            <tr style="background:#f2f2f2; text-align:center;">
              <th style="border:1px solid #000; padding:6px; width:70px;">Câu</th>
              <th style="border:1px solid #000; padding:6px;">Nội dung yêu cầu & Tiêu chí đánh giá</th>
              <th style="border:1px solid #000; padding:6px; width:80px;">Biểu điểm</th>
            </tr>
          </thead>
          <tbody>
            ${essayQuestions.map((q, idx) => {
              const rubricHtml = q.rubric?.criteria?.length
                ? q.rubric.criteria.map((criterion) => {
                  const maxPoints = Number(essayPerPoint) * criterion.weight / 100;
                  const levels = criterion.levels.map((level) =>
                    `<div style="margin-left:12px;">${level.name}: ${level.descriptor} <em>(${(maxPoints * level.points / criterion.weight).toFixed(2)} đ)</em></div>`
                  ).join('');
                  return `<div style="margin:5px 0;"><strong>${criterion.name}</strong> — tối đa ${maxPoints.toFixed(2)} đ${levels}</div>`;
                }).join('')
                : `• Nêu rõ định nghĩa, bản chất và các nguyên lý cốt lõi theo giáo trình: <em>${(Number(essayPerPoint) * 0.4).toFixed(2)} đ</em><br>• Phân tích sâu, lập luận chặt chẽ, dẫn chứng liên hệ thực tế: <em>${(Number(essayPerPoint) * 0.4).toFixed(2)} đ</em><br>• Trình bày logic, sử dụng thuật ngữ chuẩn: <em>${(Number(essayPerPoint) * 0.2).toFixed(2)} đ</em>`;
              const cognitiveLabel = q.cognitiveLevel === 'application'
                ? 'Vận dụng'
                : q.cognitiveLevel === 'understanding' ? 'Thông hiểu' : 'Chưa phân loại';
              return `
                <tr>
                  <td style="border:1px solid #000; padding:8px; text-align:center; font-weight:bold; vertical-align:top;">
                    Câu ${mcQuestions.length + idx + 1}
                  </td>
                  <td style="border:1px solid #000; padding:8px; vertical-align:top;">
                    <div style="font-weight:bold; margin-bottom:4px;">${q.text}</div>
                    <div style="font-size:10pt; color:#555; margin-bottom:5px;">Mức tư duy: ${cognitiveLabel} · ${q.rubric ? 'Rubric phân tích 4 mức' : 'Hướng dẫn chấm tham khảo'}</div>
                    <div style="color:#222; line-height:1.45;">${rubricHtml}</div>
                  </td>
                  <td style="border:1px solid #000; padding:8px; text-align:center; font-weight:bold; vertical-align:top;">
                    ${essayPerPoint}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <table class="signatures-table" style="margin-top:28px;">
      <tr>
        <td style="width:50%; vertical-align:top;">
          <div style="font-weight:bold;">DUYỆT ĐÁP ÁN - TRƯỞNG BỘ MÔN</div>
          <div style="font-size:10.5pt; font-style:italic;">(Ký và ghi rõ họ tên)</div>
          <div style="height:55px;"></div>
          <div style="font-weight:bold;">${approver}</div>
        </td>
        <td style="width:50%; vertical-align:top;">
          <div style="font-weight:bold;">NGƯỜI LẬP ĐÁP ÁN & BIỂU ĐIỂM</div>
          <div style="font-size:10.5pt; font-style:italic;">(Ký và ghi rõ họ tên)</div>
          <div style="height:55px;"></div>
          <div style="font-weight:bold;">${ownerName}</div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 350);
  };

  const publishToOnlineExam = async () => {
    if (!examId) {
      setMessage('Hãy lưu đề thi trước khi đưa vào thi trực tuyến.');
      return;
    }
    const roomName = `${title.trim() || 'Đề thi'} - ${new Date().toLocaleDateString('vi-VN')}`;
    const start = new Date().toISOString();
    const end = new Date(Date.now() + Math.max(durationMinutes, 15) * 60 * 1000).toISOString();
    try {
      const room = await createExamRoom({ examIds: [examId], name: roomName, startsAt: start, endsAt: end });
      setOnlineRoomId(room.accessCode);
      setMessage(`Đã tạo phòng thi "${room.name}". Gửi mã ${room.accessCode} cho sinh viên.`);
    } catch (error) {
      setMessage(`Không thể tạo phòng thi: ${error instanceof Error ? error.message : 'Lỗi không xác định.'}`);
    }
  };

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">AI EXAM GENERATOR · DAU STANDARD</p>
          <h2>{isEditing ? 'Chỉnh sửa đề thi' : 'Tạo đề thi mới - mở ra cánh cổng tương lai'}</h2>
          <p className="muted-copy">Đồng nhất dữ liệu từ giáo trình/tài liệu tải lên và tạo đề thi chuẩn Trường ĐH Kiến Trúc Đà Nẵng.</p>
        </div>
        <div className="heading-actions">
          <button className="button-secondary" onClick={printExam} disabled={isCreating || isAnalyzing}>In đề chuẩn DAU</button>
          <button className="button-secondary" onClick={publishToOnlineExam} disabled={isCreating || isAnalyzing}>Thi trực tuyến</button>
          <button className="button-secondary" onClick={() => setIsEditing(true)} disabled={!examId || isCreating}>Sửa đề</button>
          {isEditing && (
            <button className="button-secondary" onClick={() => { setIsEditing(false); setExamId(null); setMessage('Đã thoát chế độ chỉnh sửa.'); }}>Hủy sửa</button>
          )}
          <button className="button-primary" onClick={isEditing ? editExam : createExam} disabled={isCreating || isAnalyzing}>{isCreating ? 'Đang tạo đề...' : isEditing ? 'Lưu thay đổi' : 'Tạo đề thi'}</button>
        </div>
      </div>
      {message && (
        <div className="success-banner">
          {message}
          {analysisConfidence !== null && <span className="confidence-badge">Độ tin cậy AI {Math.round(analysisConfidence * 100)}%</span>}
          {lastCreatedExamId && <button className="text-button" onClick={() => openDetail(lastCreatedExamId)}>Xem nội dung đề</button>}
          {onlineRoomId && <button className="text-button" onClick={() => setMessage(`Mã tham gia phòng thi: ${onlineRoomId}`)}>Mã phòng: {onlineRoomId}</button>}
        </div>
      )}
      <div className="builder-layout">
        <div className="builder-panel form-panel">
          <div className="panel-title"><span>01</span><div><h3>Nguồn tài liệu & thông tin đề thi</h3><p>Đồng nhất dữ liệu từ tài liệu đến đề thi chuẩn DAU</p></div></div>
          <label className="document-dropzone" htmlFor="exam-document">
            <span className="upload-icon" aria-hidden="true">↑</span>
            <strong>{isAnalyzing ? 'Đang đọc và phân tích cấu trúc tài liệu...' : document ? document.filename : 'Tải tài liệu lên'}</strong>
            <small>{document ? `${(document.size / 1024 / 1024).toFixed(2)} MB · ${extractedContent.length.toLocaleString('vi-VN')} ký tự đã đọc` : 'PDF, DOC, DOCX hoặc TXT · tối đa 20 MB'}</small>
            <input id="exam-document" type="file" accept=".pdf,.doc,.docx,.txt" disabled={isAnalyzing} onChange={(event) => { void handleDocument(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          {extractedContent && <div className="document-preview">
            <div className="document-preview-heading"><strong>Nội dung đã trích xuất</strong><button type="button" className="text-button" aria-expanded={isDocumentPreviewOpen} onClick={() => setIsDocumentPreviewOpen((open) => !open)}>{isDocumentPreviewOpen ? 'Thu gọn' : 'Xem trước'}</button></div>
            {isDocumentPreviewOpen && <pre>{extractedContent.slice(0, 2400)}{extractedContent.length > 2400 ? '\n\n… Nội dung xem trước đã được rút gọn.' : ''}</pre>}
          </div>}
          <label className="field-label" htmlFor="exam-title">Tên đề thi</label>
          <input id="exam-title" className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          <label className="field-label" htmlFor="exam-subject">Môn học</label>
          <input
            id="exam-subject"
            className="form-input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Nhập tên môn học..."
          />

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="faculty">Khoa / Viện</label>
              <input id="faculty" className="form-input" value={faculty} onChange={(event) => setFaculty(event.target.value)} placeholder="Ví dụ: Khoa Kiến trúc..." />
            </div>
            <div>
              <label className="field-label" htmlFor="department">Bộ môn</label>
              <input id="department" className="form-input" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Ví dụ: Bộ môn Kiến trúc..." />
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="academic-year">Năm học</label>
              <input id="academic-year" className="form-input" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2024-2025" />
            </div>
            <div>
              <label className="field-label" htmlFor="semester">Học kỳ</label>
              <select id="semester" className="form-input" value={semester} onChange={(event) => setSemester(event.target.value)}>
                <option value="1">Học kỳ 1</option>
                <option value="2">Học kỳ 2</option>
                <option value="Hè">Học kỳ Hè</option>
              </select>
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="exam-code">Mã đề thi</label>
              <input id="exam-code" className="form-input" value={examCode} onChange={(event) => setExamCode(event.target.value)} placeholder="101" />
            </div>
            <div>
              <label className="field-label" htmlFor="exam-date">Ngày thi</label>
              <input id="exam-date" type="date" className="form-input" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="owner-name">Cán bộ ra đề</label>
              <input id="owner-name" className="form-input" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="approver">Trưởng bộ môn duyệt</label>
              <input id="approver" className="form-input" value={approver} onChange={(event) => setApprover(event.target.value)} />
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="exam-type">Loại kỳ thi</label>
              <select id="exam-type" className="form-input" value={examType} onChange={(event) => setExamType(event.target.value)}>
                <option>Giữa kỳ</option>
                <option>Cuối kỳ</option>
                <option>Đánh giá năng lực</option>
                <option>Thử nghiệm</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="security-level">Mức bảo mật</label>
              <select id="security-level" className="form-input" value={securityLevel} onChange={(event) => setSecurityLevel(event.target.value as 'internal' | 'restricted' | 'confidential')}>
                <option value="internal">Nội bộ</option>
                <option value="restricted">Hạn chế</option>
                <option value="confidential">Bí mật</option>
              </select>
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label">Thời lượng</label>
              <div className="input-with-unit"><input className="form-input" type="number" min="15" step="5" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) || 15)} /><span>phút</span></div>
            </div>
            <div>
              <label className="field-label">Thang điểm</label>
              <div className="input-with-unit"><input className="form-input" type="number" min="1" step="1" value={totalScore} onChange={(event) => setTotalScore(Number(event.target.value) || 10)} /><span>điểm</span></div>
            </div>
          </div>

          <div className="form-two-col">
            <div>
              <label className="field-label" htmlFor="workflow-status">Trạng thái</label>
              <select id="workflow-status" className="form-input" value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as 'draft' | 'review' | 'approved' | 'published')}>
                <option value="draft">Bản nháp</option>
                <option value="review">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
                <option value="published">Đã phát hành</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', paddingTop: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" checked={shuffleQuestions} onChange={(event) => setShuffleQuestions(event.target.checked)} />
                <span>Trộn câu hỏi và mã đề</span>
              </label>
            </div>
          </div>
        </div>
        <div className="builder-panel question-panel">
          <div className="panel-title"><span>02</span><div><h3>Ma trận đề thi</h3><p>AI sẽ phân bổ câu hỏi theo cấu hình</p></div><span className="ai-badge">AI</span></div>
          <div className="matrix-section">
            <div className="matrix-title"><strong>Loại câu hỏi</strong><span>{multipleChoice + essay} câu</span></div>
            <div className="matrix-row"><span><b>Trắc nghiệm</b><small>4 lựa chọn · chấm tự động</small></span><input className="matrix-number" type="number" min="0" value={multipleChoice} onChange={(event) => setMultipleChoice(Math.max(0, Number(event.target.value)))} /></div>
            <div className="matrix-row"><span><b>Tự luận</b><small>AI tạo câu hỏi theo mức tư duy và kèm Rubric 4 mức</small></span><input className="matrix-number" type="number" min="0" value={essay} onChange={(event) => changeEssayCount(Number(event.target.value))} /></div>
            {essay > 0 && <div className="essay-cognitive-selection">
              <div className="matrix-title"><strong>Mức tư duy tự luận</strong><span>{essayCognitiveDistribution.understanding + essayCognitiveDistribution.application}/{essay} câu</span></div>
              <div className="matrix-row"><span><b>Thông hiểu</b><small>Giải thích, phân tích, so sánh</small></span><input aria-label="Số câu tự luận thông hiểu" className="matrix-number" type="number" min="0" max={essay} value={essayCognitiveDistribution.understanding} onChange={(event) => changeEssayCognitiveCount('understanding', Number(event.target.value))} /></div>
              <div className="matrix-row"><span><b>Vận dụng</b><small>Phân tích tình huống, áp dụng kiến thức, đề xuất giải pháp</small></span><input aria-label="Số câu tự luận vận dụng" className="matrix-number" type="number" min="0" max={essay} value={essayCognitiveDistribution.application} onChange={(event) => changeEssayCognitiveCount('application', Number(event.target.value))} /></div>
              <small className="rubric-help">Mỗi câu có Rubric phân tích 4 mức: Tốt, Đạt, Đang phát triển, Chưa đạt; tiêu chí và trọng số thay đổi theo mức tư duy.</small>
            </div>}
          </div>
          <div className="matrix-section">
            <div className="matrix-title"><strong>Phân bổ độ khó</strong><span>{difficulty.easy + difficulty.medium + difficulty.hard}%</span></div>
            {([['easy', 'Dễ', '#2ecc71'], ['medium', 'Trung bình', '#f39c12'], ['hard', 'Khó', '#e74c3c']] as const).map(([key, label, color]) => <div className="difficulty-control" key={key}><span className="difficulty-label"><i style={{ background: color }} />{label}</span><input type="range" min="0" max="100" value={difficulty[key]} onChange={(event) => setDifficulty({ ...difficulty, [key]: Number(event.target.value) })} /><strong>{difficulty[key]}%</strong></div>)}
          </div>
          <div className="ai-note"><span><b>AI đề xuất:</b> Cấu hình cân bằng cho bài kiểm tra {durationMinutes} phút, ưu tiên kiến thức nền tảng và một phần câu hỏi vận dụng.</span></div>
          <div className="question-bank-preview">
            <div className="matrix-title"><strong>Câu hỏi AI nhận diện</strong><span>{selected.length} đã chọn · {aiCandidates.filter((question) => question.type === 'multipleChoice' || question.choices?.length).length} TN · {aiCandidates.filter((question) => question.type === 'essay' || !question.choices?.length).length} TL</span></div>
            {aiCandidates.map((question) => <label className={`question-row ${selected.includes(question.id) ? 'selected' : ''}`} key={question.id}><input type="checkbox" checked={selected.includes(question.id)} onChange={() => toggleQuestion(question.id)} /><span className="question-number">{question.id.replace('q-', '')}</span><span className="question-copy"><strong>{question.text}</strong><small>{question.type === 'multipleChoice' || question.choices?.length ? `Trắc nghiệm · ${question.choices?.length || 0} lựa chọn` : `Tự luận · ${question.cognitiveLevel === 'application' ? 'Vận dụng' : 'Thông hiểu'} · Rubric ${question.rubric ? '4 mức' : 'chưa có'}`} · {question.subject}</small></span><span className={`difficulty ${question.difficulty}`}>{question.difficulty}</span></label>)}
          </div>
          <div className="variant-builder"><div className="matrix-title"><strong>Đa dạng mã đề</strong><span>{variantCodes.length ? variantCodes.join(' · ') : 'Chưa tạo'}</span></div><div className="variant-actions"><div className="input-with-unit"><input className="matrix-number" type="number" min="1" max="20" value={variantCount} onChange={(event) => setVariantCount(Math.min(20, Math.max(1, Number(event.target.value))))} /><span>mã đề</span></div><button className="button-secondary" onClick={makeVariants}>⤨ Tạo mã đề & đảo đáp án</button></div><small className="variant-help">Mỗi mã tự động đảo thứ tự câu hỏi và đáp án trắc nghiệm.</small></div>
        </div>
      </div>
      <section className="exam-library">
        <div className="library-heading">
          <div><p className="eyebrow">EXAM LIBRARY / 03</p><h3>Thư viện đề đã tạo</h3><p className="muted-copy">Theo dõi và mở nội dung chi tiết của mọi đề thi.</p></div>
          <div className="library-controls">
            <div className="library-filters">{(['all', 'draft', 'published'] as const).map((filter) => <button className={libraryFilter === filter ? 'active' : ''} key={filter} onClick={() => setLibraryFilter(filter)}>{filter === 'all' ? 'Tất cả' : filter === 'draft' ? 'Bản nháp' : 'Đã phát hành'}</button>)}</div>
            <button className="button-danger" onClick={handleDeleteAllExams} disabled={!exams.length || isDeletingAllExams}>
              {isDeletingAllExams ? 'Đang xóa...' : `Xóa tất cả (${exams.length})`}
            </button>
          </div>
        </div>
        <div className="exam-library-grid">{exams.filter((exam) => libraryFilter === 'all' || exam.status === libraryFilter).map((exam) => <article className="exam-library-card" key={exam.id}><div className="exam-card-top"><span className={`status-pill ${exam.status}`}>{exam.status === 'published' ? 'Đã phát hành' : 'Bản nháp'}</span><span className="exam-id">{exam.id}</span></div><h4>{exam.title}</h4><p>{exam.subject} · {exam.questionIds.length} câu · {new Date(exam.createdAt).toLocaleDateString('vi-VN')}</p><div className="exam-card-actions"><button className="button-secondary" onClick={() => openDetail(exam.id)}>Xem nội dung đề</button><button className="button-secondary" onClick={() => loadIntoEditor(exam)}>Sửa</button><button className="button-danger" onClick={() => handleDeleteExam(exam.id, exam.title)} disabled={isDeletingAllExams}>Xóa</button>{exam.status === 'draft' && <button className="text-button" onClick={() => publishExam(exam.id)}>Phát hành</button>}</div></article>)}{!exams.length && <div className="empty-library">Chưa có đề thi nào. Hãy cấu hình ma trận và bấm “Tạo đề thi”.</div>}</div>
      </section>
      {detail && <div className="exam-detail-modal" role="dialog" aria-modal="true" aria-label={`Nội dung đề thi ${detail.title}`}>
        <div className={`exam-detail-card ${sourceQuestionId ? 'has-source' : ''}`}>
          <div className="detail-header">
            <div><p className="eyebrow">EXAM DETAIL · {detail.id}</p><h3>{detail.title}</h3><p>{detail.subject} · {detail.questions.length} câu hỏi</p></div>
            <button className="icon-button" aria-label="Đóng nội dung đề" onClick={() => { setDetail(null); setSourceQuestionId(null); }}>×</button>
          </div>
          <div className="detail-body">
            <div className="detail-exam-pane">
              <div className="detail-summary"><span><b>{detail.questionTypes?.multipleChoice || 0}</b> Trắc nghiệm</span><span><b>{detail.questionTypes?.essay || 0}</b> Tự luận</span><span><b>{detail.difficultyDistribution?.easy || 0}%</b> Câu dễ</span></div>
              <div className="detail-questions">{detail.questions.map((question, index) => {
                const sourceIsOpen = sourceQuestionId === question.id;
                return (
                  <div className="detail-question" key={question.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div className="detail-question-content">
                      <strong>{question.text}</strong>
                      <small>
                        {question.subject} · {question.difficulty}
                        {question.cognitiveLevel && ` · ${question.cognitiveLevel === 'application' ? 'Vận dụng' : 'Thông hiểu'}`}
                      </small>
                      {question.choices?.length > 0 && <ol>{question.choices.map((choice) => <li key={choice}>{choice}</li>)}</ol>}
                      <div className="answer-badge">{getAnswerText(question)}</div>
                      {question.rubric?.criteria?.length ? (
                        <section className="essay-rubric-detail" aria-label="Rubric chấm câu tự luận">
                          <strong>Rubric chấm điểm · 4 mức</strong>
                          {question.rubric.criteria.map((criterion) => (
                            <div className="essay-rubric-criterion" key={criterion.name}>
                              <b>{criterion.name} ({criterion.weight}%)</b>
                              <ul>
                                {criterion.levels.map((level) => (
                                  <li key={level.name}><strong>{level.name}</strong> — {level.descriptor}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </section>
                      ) : null}
                      <button type="button" className="source-button" aria-expanded={sourceIsOpen} onClick={() => setSourceQuestionId(sourceIsOpen ? null : question.id)}>{sourceIsOpen ? 'Ẩn tài liệu nguồn' : '↗ Truy xuất nguồn'}</button>
                    </div>
                  </div>
                );
              })}</div>
            </div>
            {sourceQuestionId && <aside className="source-shared-panel" aria-label="Tài liệu nguồn của câu hỏi">
              <div className="source-shared-heading">
                <div>
                  <strong className="source-document-title">{detail.document?.filename || document?.filename || 'Tài liệu nguồn'}</strong>
                  <small>Nguồn trích dẫn · Câu {detail.questions.findIndex((question) => question.id === sourceQuestionId) + 1}</small>
                </div>
                <button type="button" className="text-button" onClick={() => setSourceQuestionId(null)}>Đóng</button>
              </div>
              {isPdf && sourceFileUrl
                ? <iframe className="source-document-frame" src={`${sourceFileUrl}#search=${encodeURIComponent(activeSourceEvidence)}&phrase=true`} title={`Tài liệu nguồn ${detail.document?.filename || ''}`} />
                : sourceLocation
                  ? <pre className="source-document-text">{sourceLocation.before}<mark ref={sourceHighlightRef}>{sourceLocation.highlight}</mark>{sourceLocation.after}</pre>
                  : hasMatchingDocument
                    ? <pre className="source-document-text">{extractedContent}</pre>
                    : activeSourceEvidence
                      ? <p className="source-unavailable"><mark>{activeSourceEvidence}</mark><br />Chưa có toàn văn tài liệu trong phiên này. Hãy tải lại tài liệu để xem đoạn trích trong toàn văn.</p>
                      : <p className="source-unavailable">Câu hỏi này chưa lưu thông tin đoạn trích nguồn.</p>}
            </aside>}
          </div>
        </div>
      </div>}
    </section>
  );
}
