import { useEffect, useRef, useState } from 'react';
import {
  createClassroom,
  getClassroom,
  getClassrooms,
  joinClassroom,
  updateClassroomStatus,
  type Classroom,
  type User,
} from '../services/api';

function AccountAvatar({ name, image, className = '' }: { name: string; image?: string | null; className?: string }) {
  return (
    <span className={`classroom-avatar ${className}`}>
      {image ? <img src={image} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export default function ClassroomPage({ user }: { user: User }) {
  const [rooms, setRooms] = useState<Classroom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Classroom | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classroomMode, setClassroomMode] = useState<Classroom['mode']>('google_meet');
  const [meetUrl, setMeetUrl] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareRoomIdRef = useRef<string | null>(null);
  const auditoriumRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isInstructor = user.role === 'teacher' || user.role === 'admin';
  const isRoomOwner = selectedRoom?.teacherId === user.id || user.role === 'admin';

  const refreshRooms = async () => {
    setLoading(true);
    try {
      const result = await getClassrooms();
      setRooms(result.data);
      setSelectedRoom((current) => current
        ? result.data.find((room) => room.id === current.id) || current
        : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách lớp học.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshRooms(); }, []);

  useEffect(() => {
    if (!selectedRoom) return undefined;
    const timer = window.setInterval(() => {
      void getClassroom(selectedRoom.id)
        .then(({ classroom }) => setSelectedRoom(classroom))
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không thể cập nhật danh sách khán giả.'));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selectedRoom?.id]);

  useEffect(() => {
    if (screenVideoRef.current) screenVideoRef.current.srcObject = screenStream;
  }, [screenStream, selectedRoom?.id]);

  useEffect(() => {
    if (screenStream && (screenShareRoomIdRef.current !== selectedRoom?.id || selectedRoom?.status !== 'live')) {
      screenStream.getTracks().forEach((track) => track.stop());
      screenShareRoomIdRef.current = null;
      setScreenStream(null);
    }
  }, [screenStream, selectedRoom?.id, selectedRoom?.status]);

  useEffect(() => () => screenStream?.getTracks().forEach((track) => track.stop()), [screenStream]);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === auditoriumRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const startScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMessage('Trình duyệt này không hỗ trợ chia sẻ màn hình. Hãy dùng phiên bản mới của Chrome, Edge hoặc Firefox qua HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenShareRoomIdRef.current = selectedRoom?.id || null;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        screenShareRoomIdRef.current = null;
        setScreenStream(null);
      }, { once: true });
      setScreenStream(stream);
      setMessage('Đang xem trước màn hình được chia sẻ trên thiết bị giảng viên. Sinh viên chưa xem được luồng này.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setMessage('Bạn đã hủy hoặc chưa cấp quyền chia sẻ màn hình.');
        return;
      }
      setMessage(error instanceof Error ? `Không thể bắt đầu chia sẻ màn hình: ${error.message}` : 'Không thể bắt đầu chia sẻ màn hình.');
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    screenShareRoomIdRef.current = null;
    setScreenStream(null);
  };

  const toggleFullscreen = async () => {
    const auditorium = auditoriumRef.current;
    if (!auditorium) return;
    try {
      if (document.fullscreenElement === auditorium) await document.exitFullscreen();
      else await auditorium.requestFullscreen();
    } catch (error) {
      setMessage(error instanceof Error ? `Không thể đổi chế độ toàn màn hình: ${error.message}` : 'Không thể đổi chế độ toàn màn hình.');
    }
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    try {
      const result = await createClassroom({
        name: name.trim(),
        description: description.trim(),
        mode: classroomMode,
        ...(classroomMode === 'google_meet' ? { meetUrl: meetUrl.trim() } : {}),
      });
      setRooms((current) => [result.classroom, ...current]);
      setSelectedRoom(result.classroom);
      setName('');
      setDescription('');
      setMeetUrl('');
      setClassroomMode('google_meet');
      setMessage(`Đã tạo lớp. Mã tham gia: ${result.classroom.accessCode}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tạo lớp học.');
    } finally {
      setWorking(false);
    }
  };

  const handleJoin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    try {
      const result = await joinClassroom(accessCode.trim());
      setSelectedRoom(result.classroom);
      setRooms((current) => [result.classroom, ...current.filter((room) => room.id !== result.classroom.id)]);
      setAccessCode('');
      setMessage(`Bạn đã vào lớp ${result.classroom.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tham gia lớp học.');
    } finally {
      setWorking(false);
    }
  };

  const handleRoomStatus = async () => {
    if (!selectedRoom) return;
    const nextStatus: Classroom['status'] = selectedRoom.status === 'live' ? 'ended' : 'live';
    if (nextStatus === 'ended' && !window.confirm('Kết thúc buổi học này? Danh sách sinh viên và mã lớp được giữ lại; bạn có thể bắt đầu lại sau.')) return;
    setWorking(true);
    try {
      const result = await updateClassroomStatus(selectedRoom.id, { status: nextStatus });
      setSelectedRoom(result.classroom);
      setRooms((current) => current.map((room) => room.id === result.classroom.id ? result.classroom : room));
      if (nextStatus === 'ended') stopScreenShare();
      setMessage(nextStatus === 'live' ? 'Buổi học đã bắt đầu.' : 'Đã kết thúc buổi học. Bạn có thể bắt đầu lại khi cần.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái lớp học.');
    } finally {
      setWorking(false);
    }
  };

  const toggleAdmissions = async () => {
    if (!selectedRoom) return;
    setWorking(true);
    try {
      const result = await updateClassroomStatus(selectedRoom.id, { admissionsOpen: !selectedRoom.admissionsOpen });
      setSelectedRoom(result.classroom);
      setRooms((current) => current.map((room) => room.id === result.classroom.id ? result.classroom : room));
      setMessage(result.classroom.admissionsOpen ? 'Đã mở nhận sinh viên mới.' : 'Đã tạm dừng nhận sinh viên mới.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể cập nhật quyền tham gia lớp.');
    } finally {
      setWorking(false);
    }
  };

  const copyAccessCode = async () => {
    if (!selectedRoom) return;
    try {
      await navigator.clipboard.writeText(selectedRoom.accessCode);
      setMessage(`Đã sao chép mã lớp ${selectedRoom.accessCode}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Không thể sao chép mã lớp: ${error.message}` : 'Không thể sao chép mã lớp.');
    }
  };

  const refreshSelectedRoom = async () => {
    if (!selectedRoom) return;
    try {
      const { classroom } = await getClassroom(selectedRoom.id);
      setSelectedRoom(classroom);
      setRooms((current) => current.map((room) => room.id === classroom.id ? classroom : room));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể cập nhật danh sách sinh viên.');
    }
  };

  const formatClassroomTime = (value: string | null) =>
    value ? new Date(value).toLocaleString('vi-VN') : '—';

  return (
    <section className="workspace-page classroom-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">DAU · CLASSROOM</p>
          <h2>Lớp học trực tuyến</h2>
          <p className="muted-copy">Không gian giảng đường với sân khấu trình chiếu và danh sách sinh viên tham dự.</p>
        </div>
      </header>

      {message && <div className="alert-banner classroom-message" role="status">{message}</div>}

      <div className="classroom-tools">
        {isInstructor ? (
          <form className="builder-panel classroom-create-form" onSubmit={(event) => void handleCreate(event)}>
            <div className="list-heading">
              <div><h3>Tạo lớp học</h3><p>Chọn hình thức học và tạo mã tham gia cho sinh viên.</p></div>
              <span className="classroom-tool-icon">＋</span>
            </div>
            <fieldset className="classroom-mode-picker">
              <legend className="field-label">Hình thức lớp học</legend>
              <label className={`classroom-mode-option ${classroomMode === 'google_meet' ? 'selected' : ''}`}>
                <input type="radio" name="classroom-mode" value="google_meet" checked={classroomMode === 'google_meet'} onChange={() => setClassroomMode('google_meet')} />
                <span><strong>Google Meet</strong><small>Dùng đường dẫn phòng họp có sẵn.</small></span>
              </label>
              <label className={`classroom-mode-option ${classroomMode === 'direct' ? 'selected' : ''}`}>
                <input type="radio" name="classroom-mode" value="direct" checked={classroomMode === 'direct'} onChange={() => setClassroomMode('direct')} />
                <span><strong>Classroom trực tiếp</strong><small>Tạo giảng đường và xem trước chia sẻ màn hình.</small></span>
              </label>
            </fieldset>
            <label className="field-label" htmlFor="classroom-name">Tên lớp</label>
            <input id="classroom-name" className="form-input" required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Lý thuyết kiến trúc — Buổi 01" />
            <label className="field-label" htmlFor="classroom-description">Mô tả buổi học</label>
            <textarea id="classroom-description" className="form-input classroom-description-input" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Chủ đề, nội dung hoặc ghi chú cho sinh viên..." />
            {classroomMode === 'google_meet' && <>
              <label className="field-label" htmlFor="classroom-meet-link">Liên kết Google Meet</label>
              <input id="classroom-meet-link" className="form-input" type="url" required value={meetUrl} onChange={(event) => setMeetUrl(event.target.value)} placeholder="https://meet.google.com/abc-defg-hij" />
            </>}
            <button className="button-primary" type="submit" disabled={working}>{working ? 'Đang tạo lớp...' : 'Tạo lớp và mã tham gia'}</button>
          </form>
        ) : (
          <form className="builder-panel classroom-join-form" onSubmit={(event) => void handleJoin(event)}>
            <div className="list-heading">
              <div><h3>Tham gia lớp</h3><p>Nhập mã 8 ký tự do giảng viên cung cấp.</p></div>
              <span className="classroom-tool-icon">↗</span>
            </div>
            <label className="field-label" htmlFor="classroom-access-code">Mã lớp học</label>
            <div className="classroom-join-controls">
              <input id="classroom-access-code" className="form-input classroom-code-input" required minLength={8} maxLength={8} value={accessCode} onChange={(event) => setAccessCode(event.target.value.toUpperCase())} placeholder="Ví dụ: A1B2C3D4" />
              <button className="button-primary" type="submit" disabled={working || accessCode.trim().length !== 8}>{working ? 'Đang vào lớp...' : 'Vào lớp'}</button>
            </div>
          </form>
        )}

        <section className="builder-panel classroom-room-list">
          <div className="list-heading">
            <div><h3>{isInstructor ? 'Lớp học của bạn' : 'Lớp học đã tham gia'}</h3><p>{rooms.length} lớp</p></div>
            <button className="button-secondary" type="button" disabled={loading} onClick={() => void refreshRooms()}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
          </div>
          {loading ? <p className="muted-copy">Đang tải danh sách lớp học...</p> : rooms.length ? (
            <div className="classroom-room-list-items">
              {rooms.map((room) => (
                <button className={`classroom-room-option ${selectedRoom?.id === room.id ? 'selected' : ''}`} type="button" key={room.id} onClick={() => setSelectedRoom(room)}>
                  <span className="classroom-room-symbol">▣</span>
                  <span className="classroom-room-copy">
                    <strong>{room.name}</strong>
                    <small>{room.mode === 'direct' ? 'Classroom trực tiếp' : 'Google Meet'} · {isInstructor ? `${room.audienceCount ?? room.audience.length} sinh viên` : room.teacherName}</small>
                  </span>
                  <span className={`status-pill ${room.status === 'live' ? 'published' : room.status === 'ended' ? 'draft' : 'review'}`}>{room.status === 'live' ? 'Đang diễn ra' : room.status === 'ended' ? 'Đã kết thúc' : 'Sắp bắt đầu'}</span>
                </button>
              ))}
            </div>
          ) : <div className="empty-library">{isInstructor ? 'Bạn chưa tạo lớp học nào.' : 'Bạn chưa tham gia lớp học nào.'}</div>}
        </section>
      </div>

      {selectedRoom && (
        <section className="classroom-auditorium" ref={auditoriumRef}>
          <header className="classroom-live-header">
            <div><span className={`classroom-live-indicator ${selectedRoom.status}`} />{selectedRoom.status === 'live' ? 'BUỔI HỌC ĐANG DIỄN RA' : selectedRoom.status === 'ended' ? 'BUỔI HỌC ĐÃ KẾT THÚC' : 'BUỔI HỌC SẮP BẮT ĐẦU'}</div>
            <div className="classroom-code-chip"><span>MÃ LỚP</span><strong>{selectedRoom.accessCode}</strong>{isInstructor && <button type="button" onClick={() => void copyAccessCode()} aria-label="Sao chép mã lớp">Sao chép</button>}</div>
          </header>

          {isRoomOwner && <div className="classroom-control-bar">
            <div className="classroom-session-state">
              <span className={`classroom-state-pill ${selectedRoom.status}`}>
                {selectedRoom.status === 'live' ? '● Đang diễn ra' : selectedRoom.status === 'ended' ? '✓ Đã kết thúc' : '◷ Sẵn sàng bắt đầu'}
              </span>
              <span className={`classroom-admission-state ${selectedRoom.status !== 'ended' && selectedRoom.admissionsOpen ? 'open' : 'paused'}`}>
                {selectedRoom.status === 'ended' ? 'Đã khóa tham gia mới' : selectedRoom.admissionsOpen ? 'Đang nhận sinh viên mới' : 'Tạm dừng nhận sinh viên mới'}
              </span>
              <span className="classroom-session-time">
                {selectedRoom.startedAt ? `Bắt đầu: ${formatClassroomTime(selectedRoom.startedAt)}` : `Tạo lúc: ${formatClassroomTime(selectedRoom.createdAt)}`}
                {selectedRoom.endedAt ? ` · Kết thúc: ${formatClassroomTime(selectedRoom.endedAt)}` : ''}
              </span>
            </div>
            <div className="classroom-control-actions">
              <button className="button-primary" type="button" disabled={working} onClick={() => void handleRoomStatus()}>
                {working ? 'Đang cập nhật...' : selectedRoom.status === 'live' ? 'Kết thúc buổi học' : selectedRoom.status === 'ended' ? 'Bắt đầu lại buổi học' : 'Bắt đầu buổi học'}
              </button>
              {selectedRoom.status !== 'ended' && <button className="button-secondary classroom-control-secondary" type="button" disabled={working} onClick={() => void toggleAdmissions()}>
                {selectedRoom.admissionsOpen ? 'Tạm dừng nhận sinh viên' : 'Mở nhận sinh viên'}
              </button>}
              {selectedRoom.mode === 'google_meet' && selectedRoom.meetUrl && <a className="button-secondary classroom-open-meet" href={selectedRoom.meetUrl} target="_blank" rel="noopener noreferrer">Mở Google Meet</a>}
              {selectedRoom.mode === 'direct' && selectedRoom.status === 'live' && <button className="button-secondary classroom-control-secondary" type="button" onClick={() => void (screenStream ? stopScreenShare() : startScreenShare())}>
                {screenStream ? 'Dừng chia sẻ' : 'Chia sẻ màn hình'}
              </button>}
              <button className="button-secondary classroom-control-secondary" type="button" onClick={() => void toggleFullscreen()}>
                {isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
              </button>
            </div>
          </div>}
          <div className="classroom-audience-tools">
            <span>{selectedRoom.mode === 'direct'
              ? 'Chế độ trực tiếp hiện hỗ trợ xem trước chia sẻ trên thiết bị giảng viên.'
              : 'Buổi học diễn ra trong Google Meet; nút mở phòng không tự động kết thúc cuộc gọi.'}</span>
            <button type="button" className="classroom-audience-refresh" onClick={() => void refreshSelectedRoom()}>Cập nhật danh sách</button>
          </div>

          <div className="classroom-screen-frame">
            <div className="classroom-screen">
              <div className="classroom-screen-topline"><span>DAU · GIẢNG ĐƯỜNG TRỰC TUYẾN</span><span>{selectedRoom.status === 'live' ? '● ĐANG DIỄN RA' : selectedRoom.status === 'ended' ? '✓ ĐÃ KẾT THÚC' : '◷ SẮP BẮT ĐẦU'}</span></div>
              {screenStream && isRoomOwner && selectedRoom.mode === 'direct'
                ? <video ref={screenVideoRef} className="classroom-screen-video" autoPlay muted playsInline aria-label="Xem trước màn hình đang chia sẻ" />
                : <div className="classroom-screen-content">
                <span className="classroom-screen-mark">DAU</span>
                <p className="eyebrow">{selectedRoom.mode === 'direct' ? 'CLASSROOM TRỰC TIẾP' : 'BUỔI HỌC TRỰC TUYẾN'}</p>
                <h3>{selectedRoom.name}</h3>
                <p>{selectedRoom.description || (selectedRoom.mode === 'direct' ? 'Giảng đường trực tuyến · Khu vực trình chiếu' : 'Phòng học kết nối qua Google Meet.')}</p>
                {selectedRoom.mode === 'google_meet' && selectedRoom.meetUrl && <a className="classroom-meet-button" href={selectedRoom.meetUrl} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">▶</span> Mở phòng Google Meet
                </a>}
                {selectedRoom.mode === 'direct'
                  ? <small className="classroom-screen-note">{isRoomOwner ? 'Bản hiện tại chỉ xem trước trên thiết bị giảng viên; sinh viên chưa nhận được luồng trực tiếp.' : 'Giảng đường đã sẵn sàng. Đang chờ tính năng phát luồng trực tiếp tới sinh viên.'}</small>
                  : <small className="classroom-screen-note">Chia sẻ màn hình và webcam được điều khiển trong Google Meet.</small>}
              </div>}
              <div className="classroom-screen-bottomline"><span>AI EXAMHUB CLASSROOM</span><span>{selectedRoom.audience.length} SINH VIÊN ĐÃ THAM GIA</span></div>
            </div>
          </div>

          <div className="classroom-lecturer">
            <span className="classroom-lecturer-beam" />
            <AccountAvatar name={selectedRoom.teacherName} image={selectedRoom.teacherAvatar} className="classroom-lecturer-avatar" />
            <span className="classroom-lecturer-name">{selectedRoom.teacherName}</span>
            <small>GIẢNG VIÊN</small>
          </div>

          <section className="classroom-audience">
            <div className="classroom-audience-heading">
              <div><p className="eyebrow">DANH SÁCH · SINH VIÊN</p><h3>Đã tham gia lớp <span>{selectedRoom.audience.length}</span></h3></div>
              {selectedRoom.mode === 'google_meet' && selectedRoom.meetUrl && <a className="button-secondary classroom-audience-meet-link" href={selectedRoom.meetUrl} target="_blank" rel="noopener noreferrer">Tham gia Google Meet</a>}
              {!isRoomOwner && <button className="button-secondary classroom-audience-meet-link" type="button" onClick={() => void toggleFullscreen()}>{isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}</button>}
            </div>
            {selectedRoom.audience.length ? (
              <div className="classroom-audience-grid">
                {selectedRoom.audience.map((student, index) => (
                  <article className="classroom-audience-member" key={student.id} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
                    <AccountAvatar name={student.fullName} image={student.avatarUrl} />
                    <strong title={student.fullName}>{student.fullName}</strong>
                    <small>{student.email}</small>
                  </article>
                ))}
              </div>
            ) : <p className="classroom-empty-audience">Chưa có sinh viên tham gia lớp. Chia sẻ mã để mời sinh viên vào giảng đường.</p>}
          </section>
        </section>
      )}
    </section>
  );
}
