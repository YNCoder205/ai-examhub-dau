import { useEffect, useState } from 'react';
import { getUsers, createUser, createUsersBulk, updateUser, deleteUser, deleteFilteredUsers, type UniversityUserFields, type User } from '../services/api';
import AvatarPicker from '../components/AvatarPicker';

const ROLE_LABELS: Record<string, string> = { admin: 'Quản trị viên', teacher: 'Giảng viên', student: 'Sinh viên' };
const ROLE_COLORS: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

type BulkAccount = { email: string; full_name: string; role: 'admin' | 'teacher' | 'student'; password: string; phone: string } & UniversityUserFields;
const CSV_COLUMNS = ['email', 'full_name', 'role', 'password', 'phone', 'institutional_id', 'faculty', 'department', 'cohort', 'class_name'];
const CSV_HEADER_ALIASES: Record<string, keyof BulkAccount> = {
  email: 'email',
  'e mail': 'email',
  'thu dien tu': 'email',
  full_name: 'full_name',
  'ho ten day du': 'full_name',
  ten: 'full_name',
  fullname: 'full_name',
  name: 'full_name',
  'ho va ten': 'full_name',
  'ho ten': 'full_name',
  'ten day du': 'full_name',
  role: 'role',
  'vai tro': 'role',
  quyen: 'role',
  password: 'password',
  'mat khau': 'password',
  'mat khau khoi tao': 'password',
  phone: 'phone',
  phone_number: 'phone',
  phonenumber: 'phone',
  'so dien thoai': 'phone',
  dienthoai: 'phone',
  sdt: 'phone',
  institutional_id: 'institutional_id',
  student_id: 'institutional_id',
  studentid: 'institutional_id',
  student_code: 'institutional_id',
  studentcode: 'institutional_id',
  'ma so': 'institutional_id',
  'ma sinh vien': 'institutional_id',
  'ma sv': 'institutional_id',
  mssv: 'institutional_id',
  'ma vien chuc': 'institutional_id',
  faculty: 'faculty',
  khoa: 'faculty',
  truong: 'faculty',
  department: 'department',
  'don vi': 'department',
  'bo mon': 'department',
  'nganh bo mon': 'department',
  nganh: 'department',
  cohort: 'cohort',
  'khoa hoc': 'cohort',
  'nien khoa': 'cohort',

  'nam tuyen sinh': 'cohort',
  class: 'class_name',
  class_name: 'class_name',
  lop: 'class_name',
  'lop hanh chinh': 'class_name',
};
const CSV_ROLE_ALIASES: Record<string, BulkAccount['role']> = {
  admin: 'admin',
  administrator: 'admin',
  'quan tri': 'admin',
  'quan tri vien': 'admin',
  teacher: 'teacher',
  lecturer: 'teacher',
  instructor: 'teacher',
  'giang vien': 'teacher',
  student: 'student',
  sinhvien: 'student',
  'sinh vien': 'student',
};
const emptyForm = {
  email: '', password: '', full_name: '', role: 'student', phone: '', avatar_url: null as string | null,
  institutional_id: '', faculty: '', department: '', cohort: '', class_name: '',
};

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('Tệp CSV có dấu ngoặc kép chưa đóng.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseAccountsCsv(text: string): BulkAccount[] {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) throw new Error('CSV cần có dòng tiêu đề và ít nhất một tài khoản.');
  const normalizeHeader = (header: string) => header.trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const rawHeaders = rows[0].map(normalizeHeader);
  const headers: string[] = rawHeaders.map((header) => CSV_HEADER_ALIASES[header] || header);
  const required = ['email', 'full_name'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Thiếu cột bắt buộc: ${missing.join(', ')}.`);
  const allowed = new Set(CSV_COLUMNS);
  const unknown = headers.filter((header) => !allowed.has(header));
  if (unknown.length) throw new Error(`Cột không được hỗ trợ: ${[...new Set(unknown)].join(', ')}.`);
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`Tên cột bị lặp: ${[...new Set(duplicateHeaders)].join(', ')}.`);
  const indexes = new Map<string, number>(headers.map((header, index) => [header, index]));
  return rows.slice(1).map((cells, rowIndex) => {
    if (cells.length > headers.length) {
      throw new Error(`Dòng ${rowIndex + 2}: có nhiều ô hơn tiêu đề. Nếu nội dung có dấu phẩy hoặc chấm phẩy, hãy đặt nội dung trong dấu ngoặc kép.`);
    }
    const value = (key: string) => cells[indexes.get(key) ?? -1] || '';
    const roleValue = normalizeHeader(value('role'));
    const role = roleValue ? CSV_ROLE_ALIASES[roleValue] : 'student';
    if (!role) {
      throw new Error(`Dòng ${rowIndex + 2}: role phải là admin, teacher hoặc student.`);
    }
    return {
      email: value('email'),
      full_name: value('full_name'),
      role: role as BulkAccount['role'],
      password: value('password'),
      phone: value('phone'),
      institutional_id: value('institutional_id') || null,
      faculty: value('faculty') || null,
      department: value('department') || null,
      cohort: value('cohort') || null,
      class_name: value('class_name') || null,
    };
  });
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [roleCounts, setRoleCounts] = useState({ admin: 0, teacher: 0, student: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkUsers, setBulkUsers] = useState<BulkAccount[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [filters, setFilters] = useState({ role: '', search: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const fetchUsers = async (activeFilters = filters, activePage = page) => {
    setLoading(true);
    try {
      const res = await getUsers({ ...activeFilters, page: activePage, limit: LIMIT });
      setUsers(res.data);
      setTotal(res.total);
      setRoleCounts(res.roleCounts);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Không thể tải danh sách người dùng.');
      setUsers([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, [filters, page]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (u: User) => {
    setEditId(u.id);
    setForm({
      ...emptyForm,
      email: u.email,
      password: '',
      full_name: u.full_name,
      role: u.role,
      phone: u.phone || '',
      avatar_url: u.avatar_url || null,
      institutional_id: u.institutional_id || '',
      faculty: u.faculty || '',
      department: u.department || '',
      cohort: u.cohort || '',
      class_name: u.class_name || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { setMessage('Vui lòng nhập họ tên.'); return; }
    if (!form.email.trim() || (!editId && !form.password.trim())) {
      setMessage(editId ? 'Vui lòng nhập email.' : 'Vui lòng nhập email và mật khẩu.');
      return;
    }
    if (!editId && form.password.trim().length < 8) {
      setMessage('Mật khẩu cần có ít nhất 8 ký tự.');
      return;
    }
    setSaving(true);
    try {
      const isCreating = !editId;
      if (editId) {
        const payload: Partial<{ email: string; full_name: string; role: string; password: string; phone: string; avatar_url: string | null } & UniversityUserFields> = {
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
          phone: form.phone.trim(),
          avatar_url: form.avatar_url,
          institutional_id: form.institutional_id.trim() || null,
          faculty: form.faculty.trim() || null,
          department: form.department.trim() || null,
          cohort: form.cohort.trim() || null,
          class_name: form.class_name.trim() || null,
        };
        if (form.password.trim()) payload.password = form.password.trim();
        await updateUser(editId, payload);
        setMessage('Đã cập nhật tài khoản thành công.');
      } else {
        await createUser({
          email: form.email.trim(),
          password: form.password.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
          phone: form.phone.trim(),
          avatar_url: form.avatar_url,
          institutional_id: form.institutional_id.trim() || null,
          faculty: form.faculty.trim() || null,
          department: form.department.trim() || null,
          cohort: form.cohort.trim() || null,
          class_name: form.class_name.trim() || null,
        });
        setMessage('Đã tạo tài khoản mới thành công.');
      }
      setShowForm(false);
      setEditId(null);
      if (isCreating) {
        const clearedFilters = { role: '', search: '' };
        setFilters(clearedFilters);
        setPage(1);
        await fetchUsers(clearedFilters, 1);
      } else {
        await fetchUsers();
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi lưu tài khoản.');
    } finally { setSaving(false); }
  };

  const downloadCsvTemplate = () => {
    const csv = `${CSV_COLUMNS.join(',')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'examhub-users-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadInitialCredentials = (credentials: Array<{ email: string; full_name: string; initial_password: string }>) => {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [
      ['email', 'full_name', 'initial_password'].join(','),
      ...credentials.map((item) => [item.email, item.full_name, item.initial_password].map(escapeCsv).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'examhub-initial-credentials.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Tệp CSV không được vượt quá 2 MB.');
      const usersToImport = parseAccountsCsv(await file.text());
      if (usersToImport.length > 500) throw new Error('Mỗi lần chỉ nhập tối đa 500 tài khoản.');
      setBulkUsers(usersToImport);
      setBulkFileName(file.name);
      setBulkError('');
      setMessage('');
    } catch (err: unknown) {
      setBulkUsers([]);
      setBulkFileName('');
      setBulkError(err instanceof Error ? err.message : 'Không đọc được tệp CSV.');
    }
  };

  const handleBulkCreate = async () => {
    setBulkError('');
    setSaving(true);
    try {
      const result = await createUsersBulk(bulkUsers);
      const summary = `Đã tạo ${result.createdCount} tài khoản${result.skippedCount ? `; bỏ qua ${result.skippedCount} tài khoản trùng email/mã số` : ''}.`;
      const credentialNotice = result.credentials.length
        ? ' Mật khẩu khởi tạo được tải xuống trong tệp riêng; hãy bảo mật tệp này và chuyển cho người dùng qua kênh an toàn.'
        : '';
      setMessage(`${summary}${credentialNotice}`);
      if (result.credentials.length) downloadInitialCredentials(result.credentials);
      setBulkUsers([]);
      setBulkFileName('');
      setBulkError('');
      setShowBulkForm(false);
      const clearedFilters = { role: '', search: '' };
      setFilters(clearedFilters);
      setPage(1);
      await fetchUsers(clearedFilters, 1);
      if (result.skippedCount) {
        const samples = result.skipped.slice(0, 5).map((item) => `${item.email}: ${item.reason}`).join(' ');
        setMessage(`${summary}${samples ? ` Chi tiết: ${samples}${result.skippedCount > 5 ? ` Và ${result.skippedCount - 5} tài khoản khác.` : ''}` : ''}${credentialNotice}`);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Không thể tạo danh sách tài khoản.';
      setBulkError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Xóa tài khoản "${name}"? Thao tác này không thể hoàn tác.`)) return;
    try {
      await deleteUser(id);
      setMessage('Đã xóa tài khoản.');
      fetchUsers();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi xóa.');
    }
  };

  const handleDeleteFiltered = async () => {
    const search = filters.search.trim();
    if (!filters.role && !search) {
      setMessage('Hãy chọn vai trò hoặc nhập từ khóa trước khi xóa hàng loạt.');
      return;
    }
    const filterDescription = [
      filters.role ? `vai trò "${ROLE_LABELS[filters.role]}"` : '',
      search ? `từ khóa "${search}"` : '',
    ].filter(Boolean).join(' và ');
    const confirmation = `Xóa tất cả ${total} tài khoản khớp ${filterDescription}? Tác vụ này áp dụng trên mọi trang, không chỉ trang hiện tại. Tài khoản admin đang đăng nhập được giữ lại. Dữ liệu lớp/thành viên, lượt thi và thông báo liên quan có thể bị xóa theo.`;
    if (!window.confirm(confirmation)) return;
    if (window.prompt(`Để xác nhận, nhập XOA ${total}:`) !== `XOA ${total}`) {
      setMessage('Đã hủy thao tác xóa hàng loạt.');
      return;
    }

    setSaving(true);
    try {
      const result = await deleteFilteredUsers({ role: filters.role, search });
      setMessage(`Đã xóa ${result.deletedCount} tài khoản khớp bộ lọc. Tài khoản đang đăng nhập được giữ lại.`);
      if (page === 1) await fetchUsers();
      else setPage(1);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi xóa tài khoản theo bộ lọc.');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">USERS / QUẢN LÝ NGƯỜI DÙNG</p>
          <h2>Quản lý tài khoản hệ thống</h2>
          <p className="muted-copy">Tạo tài khoản mới hoặc cấp, thay đổi quyền quản trị viên, giảng viên và sinh viên.</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button className="button-secondary" onClick={() => { setBulkUsers([]); setBulkFileName(''); setBulkError(''); setShowBulkForm(true); }}>Nhập danh sách CSV</button>
          <button className="button-primary" onClick={openCreate}>+ Thêm tài khoản</button>
        </div>
      </div>

      {message && (
        <div className="alert-banner" onClick={() => setMessage('')} style={{ cursor: 'pointer', marginBottom: '16px' }}>
          {message} <span style={{ opacity: 0.6 }}>(click để đóng)</span>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card blue"><div className="stat-icon">US</div><div className="stat-value">{total}</div><div className="stat-label">Tổng tài khoản</div></div>
        <div className="stat-card red"><div className="stat-icon">AD</div><div className="stat-value">{roleCounts.admin}</div><div className="stat-label">Quản trị viên</div></div>
        <div className="stat-card orange"><div className="stat-icon">TC</div><div className="stat-value">{roleCounts.teacher}</div><div className="stat-label">Giảng viên</div></div>
        <div className="stat-card green"><div className="stat-icon">SV</div><div className="stat-value">{roleCounts.student}</div><div className="stat-label">Sinh viên</div></div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
          <input className="form-input" placeholder="🔍 Tìm theo tên hoặc email..."
            value={filters.search}
            onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }} />
          <select className="form-input" value={filters.role}
            onChange={e => { setFilters(f => ({ ...f, role: e.target.value })); setPage(1); }}>
            <option value="">Tất cả vai trò</option>
            <option value="admin">Quản trị viên</option>
            <option value="teacher">Giảng viên</option>
            <option value="student">Sinh viên</option>
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button
            className="button-danger"
            onClick={handleDeleteFiltered}
            disabled={loading || saving || total === 0 || (!filters.role && !filters.search.trim())}
            title="Xóa toàn bộ tài khoản khớp bộ lọc trên mọi trang"
          >
            {saving ? 'Đang xử lý...' : `Xóa tất cả ${total} kết quả lọc`}
          </button>
        </div>
      </div>

      {/* User List */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>Đang tải danh sách tài khoản...</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Ngày tạo</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  Không có tài khoản nào.
                </td></tr>
              )}
              {users.map((u, idx) => (
                <tr key={u.id}>
                  <td>{(page - 1) * LIMIT + idx + 1}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="user-avatar" style={{ width: '32px', height: '32px', fontSize: '13px' }}>
                        {u.avatar_url ? <img src={u.avatar_url} alt="" /> : u.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 500 }}>{u.full_name}</span>
                    </div>
                    {(u.institutional_id || u.class_name || u.cohort) && (
                      <div style={{ margin: '4px 0 0 42px', color: 'var(--text-muted)', fontSize: '11px' }}>
                        {[u.institutional_id, u.class_name, u.cohort].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{u.email}</td>
                  <td>
                    <span className={`status-pill ${ROLE_COLORS[u.role] || 'blue'}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="button-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={() => openEdit(u)}>Sửa</button>
                      <button className="button-danger" style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={() => handleDelete(u.id, u.full_name)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal-card">
            <div className="modal-header">
              <h3>{editId ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản mới'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <AvatarPicker name={form.full_name} value={form.avatar_url} onChange={(avatar_url) => setForm(f => ({ ...f, avatar_url }))} />
              <label className="field-label">Họ và tên *</label>
              <input className="form-input" placeholder="Nguyễn Văn A"
                value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Số điện thoại</label>
              <input className="form-input" type="tel" maxLength={30} placeholder="0905 123 456"
                value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Mã số sinh viên / viên chức</label>
              <input className="form-input" maxLength={64} placeholder="MSSV hoặc mã viên chức"
                value={form.institutional_id} onChange={e => setForm(f => ({ ...f, institutional_id: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Khoa / trường thành viên</label>
              <input className="form-input" maxLength={255} placeholder="Khoa Kiến trúc"
                value={form.faculty} onChange={e => setForm(f => ({ ...f, faculty: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Ngành / bộ môn / đơn vị</label>
              <input className="form-input" maxLength={255} placeholder="Ngành Kiến trúc"
                value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Khóa / năm tuyển sinh</label>
              <input className="form-input" maxLength={64} placeholder="2026 hoặc K26"
                value={form.cohort} onChange={e => setForm(f => ({ ...f, cohort: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Lớp</label>
              <input className="form-input" maxLength={128} placeholder="26KT1"
                value={form.class_name} onChange={e => setForm(f => ({ ...f, class_name: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Email *</label>
              <input className="form-input" type="email" placeholder="email@dau.edu.vn"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>
                {editId ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu *'}
              </label>
              <input className="form-input" type="password" placeholder="Nhập mật khẩu"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />

              <label className="field-label" style={{ marginTop: '12px' }}>Vai trò / quyền truy cập</label>
              <select className="form-input" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="student">Sinh viên</option>
                <option value="teacher">Giảng viên</option>
                <option value="admin">Quản trị viên</option>
              </select>
            </div>
            <div className="modal-footer">
              <button className="button-secondary" onClick={() => setShowForm(false)}>Hủy</button>
              <button className="button-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Đang lưu...' : editId ? 'Cập nhật' : 'Tạo tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) setShowBulkForm(false); }}>
          <div className="modal-card">
            <div className="modal-header">
              <h3>Nhập tài khoản hàng loạt</h3>
              <button className="modal-close" onClick={() => setShowBulkForm(false)} disabled={saving}>✕</button>
            </div>
            <div className="modal-body">
              <p className="muted-copy">
                Tải mẫu CSV, điền thông tin rồi nhập lại. Cột bắt buộc: email, full_name.
                Có thể dùng tiêu đề tiếng Việt hoặc tiếng Anh; hỗ trợ CSV dấu phẩy hoặc chấm phẩy.
                Nếu không có cột role, hệ thống mặc định là sinh viên. Có thể bỏ trống mật khẩu để hệ thống tạo ngẫu nhiên và tải tệp mật khẩu khởi tạo sau khi nhập. Mã số không được trùng.
              </p>
              <button className="button-secondary" type="button" onClick={downloadCsvTemplate}>Tải mẫu CSV</button>
              <label className="field-label" htmlFor="bulk-users-csv" style={{ marginTop: '16px' }}>Tệp CSV (tối đa 500 tài khoản)</label>
              <input id="bulk-users-csv" className="form-input" type="file" accept=".csv,text/csv"
                onChange={e => handleCsvFile(e.target.files?.[0])} disabled={saving} />
              {bulkFileName && <p className="muted-copy" style={{ marginTop: '8px' }}>{bulkFileName} · {bulkUsers.length} tài khoản</p>}
              {bulkError && (
                <div className="form-error" role="alert" style={{ display: 'block', marginTop: '12px' }}>
                  {bulkError}
                </div>
              )}
              {bulkUsers.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: '12px', maxHeight: '240px' }}>
                  <table className="data-table">
                    <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Mã số</th></tr></thead>
                    <tbody>
                      {bulkUsers.slice(0, 10).map((account, index) => (
                        <tr key={`${account.email}-${index}`}>
                          <td>{account.full_name}</td><td>{account.email}</td>
                          <td>{ROLE_LABELS[account.role]}</td><td>{account.institutional_id || '—'}</td>
                        </tr>
                      ))}
                      {bulkUsers.length > 10 && <tr><td colSpan={4}>… và {bulkUsers.length - 10} tài khoản khác</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted-copy" style={{ marginTop: '12px' }}>
                Tài khoản có email hoặc mã số đã tồn tại sẽ được bỏ qua; các tài khoản hợp lệ khác vẫn được tạo.
                Tệp chỉ được gửi để xử lý và không lưu lại trên máy chủ.
              </p>
            </div>
            <div className="modal-footer">
              <button className="button-secondary" onClick={() => setShowBulkForm(false)} disabled={saving}>Hủy</button>
              <button className="button-primary" onClick={handleBulkCreate} disabled={saving || bulkUsers.length === 0}>
                {saving ? 'Đang tạo...' : `Tạo ${bulkUsers.length} tài khoản`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
