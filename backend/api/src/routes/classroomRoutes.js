const crypto = require('node:crypto');
const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

function isGoogleMeetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meet.google.com';
  } catch {
    return false;
  }
}

async function getClassroom(classroomId, user) {
  const accessFilter = user.role === 'admin'
    ? ''
    : user.role === 'teacher'
      ? 'AND c.created_by = $2'
      : 'AND EXISTS (SELECT 1 FROM classroom_members access_member WHERE access_member.classroom_id = c.id AND access_member.student_id = $2)';
  const params = user.role === 'admin' ? [classroomId] : [classroomId, user.id];
  const result = await query(
    `SELECT c.id, c.name, c.description, c.mode, c.meet_url AS "meetUrl",
            c.access_code AS "accessCode", c.status, c.admissions_open AS "admissionsOpen",
            c.created_at AS "createdAt", c.started_at AS "startedAt", c.ended_at AS "endedAt",
            teacher.id AS "teacherId", teacher.full_name AS "teacherName",
            teacher.avatar_url AS "teacherAvatar",
            COALESCE(jsonb_agg(
              jsonb_build_object(
                'id', student.id,
                'fullName', student.full_name,
                'email', student.email,
                'avatarUrl', student.avatar_url,
                'joinedAt', member.joined_at
              ) ORDER BY member.joined_at
            ) FILTER (WHERE student.id IS NOT NULL), '[]'::jsonb) AS audience
     FROM classroom_rooms c
     JOIN users teacher ON teacher.id = c.created_by
     LEFT JOIN classroom_members member ON member.classroom_id = c.id
     LEFT JOIN users student ON student.id = member.student_id
     WHERE c.id = $1 ${accessFilter}
     GROUP BY c.id, teacher.id`,
    params
  );
  return result.rows[0] || null;
}

router.get('/', authenticate, requireRole('teacher', 'admin', 'student'), async (req, res) => {
  try {
    const params = [req.user.id];
    let accessFilter;
    if (req.user.role === 'admin') {
      params.length = 0;
      accessFilter = '';
    } else if (req.user.role === 'teacher') {
      accessFilter = 'WHERE c.created_by = $1';
    } else {
      accessFilter = 'JOIN classroom_members mine ON mine.classroom_id = c.id AND mine.student_id = $1';
    }

    const result = await query(
      `SELECT c.id, c.name, c.description, c.mode, c.meet_url AS "meetUrl",
              c.access_code AS "accessCode", c.status, c.admissions_open AS "admissionsOpen",
              c.created_at AS "createdAt", c.started_at AS "startedAt", c.ended_at AS "endedAt",
              teacher.id AS "teacherId", teacher.full_name AS "teacherName",
              teacher.avatar_url AS "teacherAvatar",
              COUNT(member.student_id)::int AS "audienceCount",
              COALESCE(jsonb_agg(
                jsonb_build_object(
                  'id', student.id,
                  'fullName', student.full_name,
                  'email', student.email,
                  'avatarUrl', student.avatar_url,
                  'joinedAt', member.joined_at
                ) ORDER BY member.joined_at
              ) FILTER (WHERE student.id IS NOT NULL), '[]'::jsonb) AS audience
       FROM classroom_rooms c
       ${req.user.role === 'student' ? accessFilter : ''}
       JOIN users teacher ON teacher.id = c.created_by
       LEFT JOIN classroom_members member ON member.classroom_id = c.id
       LEFT JOIN users student ON student.id = member.student_id
       ${req.user.role !== 'student' ? accessFilter : ''}
       GROUP BY c.id, teacher.id
       ORDER BY c.created_at DESC`,
      params
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('List classrooms error:', error);
    res.status(500).json({ message: 'Không thể tải danh sách lớp học.' });
  }
});

router.post('/', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, description = '', mode = 'google_meet' } = req.body || {};
    const meetUrl = typeof req.body?.meetUrl === 'string' ? req.body.meetUrl.trim() : '';
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) {
      return res.status(400).json({ message: 'Tên lớp học là bắt buộc và tối đa 160 ký tự.' });
    }
    if (typeof description !== 'string' || description.length > 2000) {
      return res.status(400).json({ message: 'Mô tả lớp học không được vượt quá 2.000 ký tự.' });
    }
    if (!['google_meet', 'direct'].includes(mode)) {
      return res.status(400).json({ message: 'Chọn một trong hai kiểu: Google Meet hoặc lớp trực tiếp.' });
    }
    if (mode === 'google_meet' && !isGoogleMeetUrl(meetUrl)) {
      return res.status(400).json({ message: 'Nhập liên kết Google Meet hợp lệ (https://meet.google.com/...).' });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const accessCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      try {
        const result = await query(
          `INSERT INTO classroom_rooms (name, description, mode, meet_url, access_code, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [name.trim(), description.trim(), mode, mode === 'google_meet' ? meetUrl : null, accessCode, req.user.id]
        );
        const classroom = await getClassroom(result.rows[0].id, req.user);
        return res.status(201).json({ classroom });
      } catch (error) {
        if (error.code !== '23505' || attempt === 4) throw error;
      }
    }
    return res.status(500).json({ message: 'Không thể tạo mã lớp học. Vui lòng thử lại.' });
  } catch (error) {
    console.error('Create classroom error:', error);
    res.status(500).json({ message: 'Không thể tạo lớp học.' });
  }
});

router.post('/join', authenticate, requireRole('student'), async (req, res) => {
  try {
    const accessCode = typeof req.body?.accessCode === 'string' ? req.body.accessCode.trim().toUpperCase() : '';
    if (!/^[A-F0-9]{8}$/.test(accessCode)) {
      return res.status(400).json({ message: 'Mã lớp học phải gồm 8 ký tự chữ hoặc số.' });
    }
    const found = await query(
      `SELECT c.id, c.status, c.admissions_open,
              EXISTS (
                SELECT 1 FROM classroom_members member
                WHERE member.classroom_id = c.id AND member.student_id = $2
              ) AS is_member
       FROM classroom_rooms c
       WHERE c.access_code = $1`,
      [accessCode, req.user.id]
    );
    if (!found.rows.length) return res.status(404).json({ message: 'Không tìm thấy lớp học với mã này.' });
    if (found.rows[0].status === 'ended' || (!found.rows[0].admissions_open && !found.rows[0].is_member)) {
      return res.status(409).json({ message: found.rows[0].status === 'ended'
        ? 'Buổi học đã kết thúc, không thể tham gia.'
        : 'Giảng viên đang tạm dừng nhận sinh viên mới.' });
    }

    await query(
      `INSERT INTO classroom_members (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO NOTHING`,
      [found.rows[0].id, req.user.id]
    );
    const classroom = await getClassroom(found.rows[0].id, req.user);
    res.json({ classroom });
  } catch (error) {
    console.error('Join classroom error:', error);
    res.status(500).json({ message: 'Không thể tham gia lớp học.' });
  }
});

router.get('/:id', authenticate, requireRole('teacher', 'admin', 'student'), async (req, res) => {
  try {
    const classroom = await getClassroom(req.params.id, req.user);
    if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học hoặc bạn không có quyền truy cập.' });
    res.json({ classroom });
  } catch (error) {
    console.error('Get classroom error:', error);
    res.status(500).json({ message: 'Không thể tải thông tin lớp học.' });
  }
});

router.patch('/:id/status', authenticate, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { status, admissionsOpen } = req.body || {};
    if (status !== undefined && !['scheduled', 'live', 'ended'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái buổi học không hợp lệ.' });
    }
    if (admissionsOpen !== undefined && typeof admissionsOpen !== 'boolean') {
      return res.status(400).json({ message: 'Trạng thái nhận sinh viên phải là true hoặc false.' });
    }
    if (status === undefined && admissionsOpen === undefined) {
      return res.status(400).json({ message: 'Cần cung cấp trạng thái buổi học hoặc trạng thái nhận sinh viên.' });
    }
    const ownerFilter = req.user.role === 'admin' ? '' : 'AND created_by = $4';
    const params = [
      status ?? null,
      admissionsOpen ?? null,
      req.params.id,
      ...(req.user.role === 'admin' ? [] : [req.user.id]),
    ];
    const updated = await query(
      `UPDATE classroom_rooms
       SET status = COALESCE($1, status),
           admissions_open = COALESCE($2, admissions_open),
           started_at = CASE WHEN $1 = 'live' THEN now() ELSE started_at END,
           ended_at = CASE WHEN $1 = 'ended' THEN now() WHEN $1 = 'live' THEN NULL ELSE ended_at END
       WHERE id = $3 ${ownerFilter}
       RETURNING id`,
      params
    );
    if (!updated.rows.length) return res.status(404).json({ message: 'Không tìm thấy lớp học hoặc bạn không có quyền cập nhật.' });
    const classroom = await getClassroom(req.params.id, req.user);
    res.json({ classroom });
  } catch (error) {
    console.error('Update classroom status error:', error);
    res.status(500).json({ message: 'Không thể cập nhật trạng thái lớp học.' });
  }
});

module.exports = router;
