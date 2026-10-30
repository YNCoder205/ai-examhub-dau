const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { JWT_SECRET } = require('../middlewares/authMiddleware');

const ALLOWED_ROLES = ['admin', 'teacher', 'student'];
const fallbackUsers = [
  { id: 'user-teacher-demo', email: 'teacher@dau.edu.vn', password_hash: bcrypt.hashSync('Teacher123!', 12), full_name: 'Giảng viên DAU', role: 'teacher' },
  { id: 'user-admin-demo', email: 'admin@dau.edu.vn', password_hash: bcrypt.hashSync('Admin123!', 12), full_name: 'Quản trị hệ thống', role: 'admin' },
  { id: 'user-student-demo', email: 'student@sv.dau.edu.vn', password_hash: bcrypt.hashSync('Student123!', 12), full_name: 'Sinh viên DAU', role: 'student' },
];

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const MAX_AVATAR_LENGTH = 700_000;
const isValidAvatar = (avatar) => avatar === null
  || (typeof avatar === 'string'
    && avatar.length <= MAX_AVATAR_LENGTH
    && (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar)
      || /^https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9/_=-]+$/.test(avatar)));
const GOOGLE_STATE_COOKIE = 'examhub_google_oauth_state';

function getFrontendUrl() {
  const frontendUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(frontendUrl.protocol) || frontendUrl.username || frontendUrl.password) {
    throw new Error('FRONTEND_URL must be an HTTP(S) URL without credentials.');
  }
  frontendUrl.hash = '';
  return frontendUrl;
}

function clearGoogleStateCookie(res) {
  res.append('Set-Cookie', `${GOOGLE_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function redirectGoogleError(res, error) {
  try {
    const frontendUrl = getFrontendUrl();
    frontendUrl.hash = new URLSearchParams({ google_error: error }).toString();
    return res.redirect(303, frontendUrl.toString());
  } catch (configError) {
    console.error('Google OAuth frontend URL error:', configError);
    return res.status(500).json({ message: 'Cấu hình đăng nhập Google chưa hợp lệ.' });
  }
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function googleStart(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirectGoogleError(res, 'google_not_configured');

  let redirectUri;
  try {
    redirectUri = process.env.GOOGLE_REDIRECT_URI
      || `${process.env.API_PUBLIC_URL || 'http://localhost:3000'}/api/auth/google/callback`;
    const parsedRedirectUri = new URL(redirectUri);
    if (!['http:', 'https:'].includes(parsedRedirectUri.protocol)) throw new Error('Invalid redirect URI protocol.');
  } catch (error) {
    console.error('Google OAuth redirect URI error:', error);
    return redirectGoogleError(res, 'google_configuration_error');
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();

  res.append(
    'Set-Cookie',
    `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=300${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, authorizationUrl.toString());
}

async function googleCallback(req, res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const savedState = readCookie(req, GOOGLE_STATE_COOKIE);
  clearGoogleStateCookie(res);
  const receivedState = typeof req.query.state === 'string' ? req.query.state : '';
  if (!savedState || !receivedState
    || savedState.length !== receivedState.length
    || !crypto.timingSafeEqual(Buffer.from(savedState), Buffer.from(receivedState))) {
    return redirectGoogleError(res, 'google_state_invalid');
  }
  if (req.query.error) return redirectGoogleError(res, 'google_cancelled');

  const { code } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (typeof code !== 'string' || !clientId || !clientSecret) {
    return redirectGoogleError(res, 'google_login_failed');
  }

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI
      || `${process.env.API_PUBLIC_URL || 'http://localhost:3000'}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
      console.error('Google OAuth token exchange failed:', tokenBody.error || tokenResponse.status);
      return redirectGoogleError(res, 'google_login_failed');
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const googleProfile = await profileResponse.json();
    if (!profileResponse.ok || googleProfile.email_verified !== true
      || typeof googleProfile.email !== 'string' || typeof googleProfile.sub !== 'string') {
      console.error('Google OAuth user profile validation failed:', profileResponse.status);
      return redirectGoogleError(res, 'google_email_unverified');
    }

    const normalizedEmail = googleProfile.email.trim().toLowerCase();
    const displayName = typeof googleProfile.name === 'string' && googleProfile.name.trim()
      ? googleProfile.name.trim().slice(0, 255)
      : normalizedEmail.split('@')[0];
    const googleAvatar = typeof googleProfile.picture === 'string'
      && /^https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9/_=-]+$/.test(googleProfile.picture)
      ? googleProfile.picture
      : null;

    let userResult = await query(
      'SELECT id, email, full_name, role, avatar_url, phone FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (!userResult.rows.length) {
      const randomPassword = crypto.randomBytes(48).toString('base64url');
      const passwordHash = await bcrypt.hash(randomPassword, 12);
      try {
        userResult = await query(
          `INSERT INTO users (email, password_hash, full_name, role, avatar_url)
           VALUES ($1, $2, $3, 'student', $4)
           RETURNING id, email, full_name, role, avatar_url, phone`,
          [normalizedEmail, passwordHash, displayName, googleAvatar]
        );
      } catch (error) {
        if (error.code !== '23505') throw error;
        userResult = await query(
          'SELECT id, email, full_name, role, avatar_url, phone FROM users WHERE email = $1',
          [normalizedEmail]
        );
        if (!userResult.rows.length) throw error;
      }
    } else if (!userResult.rows[0].avatar_url && googleAvatar) {
      userResult = await query(
        `UPDATE users SET avatar_url = $1 WHERE id = $2
         RETURNING id, email, full_name, role, avatar_url, phone`,
        [googleAvatar, userResult.rows[0].id]
      );
    }

    const user = userResult.rows[0];
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const frontendUrl = getFrontendUrl();
    frontendUrl.hash = new URLSearchParams({
      google_token: token,
      google_user: JSON.stringify({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url || null,
        phone: user.phone || '',
      }),
    }).toString();
    return res.redirect(303, frontendUrl.toString());
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return redirectGoogleError(res, 'google_login_failed');
  }
}

function getFallbackUser(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return fallbackUsers.find((user) => user.email === normalizedEmail) || null;
}

function createAuthToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, email, full_name, role } }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email và mật khẩu là bắt buộc.' });
    }

    let user = null;
    try {
      const result = await query('SELECT id, email, password_hash, full_name, role, avatar_url, phone FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      user = result.rows[0] || null;
    } catch (dbError) {
      user = getFallbackUser(email);
    }

    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      avatar_url: user.avatar_url || null,
      phone: user.phone || '',
    };

    const token = createAuthToken(payload);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url || null,
        phone: user.phone || '',
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ khi đăng nhập.' });
  }
}

/**
 * GET /api/auth/me
 * Headers: Authorization: Bearer <token>
 * Returns: { user: { id, email, full_name, role } }
 */
async function register(req, res) {
  try {
    const { email, password, full_name, role = 'student' } = req.body || {};

    if (!email || !password || !full_name) {
      return res.status(400).json({ message: 'Email, mật khẩu và họ tên là bắt buộc.' });
    }
    if (role === 'admin' || role === 'teacher') {
      return res.status(403).json({ message: 'Tài khoản quản trị viên và giảng viên phải được tạo bởi quản trị viên.' });
    }
    if (req.body.avatar_url !== undefined && !isValidAvatar(req.body.avatar_url)) {
      return res.status(400).json({ message: 'Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.' });
    }
    if (req.body.phone !== undefined && (typeof req.body.phone !== 'string' || req.body.phone.length > 30)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }

    const normalizedRole = ALLOWED_ROLES.includes(role) ? role : 'student';
    const normalizedEmail = String(email).trim().toLowerCase();

    try {
      const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ message: 'Email đã tồn tại trong hệ thống.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await query(
        'INSERT INTO users (email, password_hash, full_name, role, avatar_url, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, full_name, role, avatar_url, phone',
        [normalizedEmail, passwordHash, String(full_name).trim(), normalizedRole, req.body.avatar_url || null, String(req.body.phone || '').trim()]
      );

      const user = result.rows[0];
      return res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          avatar_url: user.avatar_url,
          phone: user.phone || '',
        },
      });
    } catch (dbError) {
      if (getFallbackUser(normalizedEmail)) {
        return res.status(409).json({ message: 'Email đã tồn tại trong hệ thống.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const registeredUser = {
        id: `user-${Date.now()}`,
        email: normalizedEmail,
        password_hash: passwordHash,
        full_name: String(full_name).trim(),
        role: normalizedRole,
        avatar_url: req.body.avatar_url || null,
        phone: String(req.body.phone || '').trim(),
      };
      fallbackUsers.push(registeredUser);
      return res.status(201).json({
        user: {
          id: registeredUser.id,
          email: registeredUser.email,
          full_name: registeredUser.full_name,
          role: registeredUser.role,
          avatar_url: registeredUser.avatar_url,
          phone: registeredUser.phone,
        },
      });
    }
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ khi đăng ký tài khoản.' });
  }
}

async function getMe(req, res) {
  try {
    let user = null;
    try {
      const result = await query('SELECT id, email, full_name, role, avatar_url, phone, created_at FROM users WHERE id = $1', [req.user.id]);
      user = result.rows[0] || null;
    } catch (dbError) {
      user = fallbackUsers.find((item) => item.id === req.user.id) || null;
    }

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }

    return res.json({
      token: createAuthToken(user),
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url || null,
        phone: user.phone || '',
        created_at: user.created_at || new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('GetMe error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { full_name, email, phone, avatar_url } = req.body || {};
    if (typeof full_name !== 'string' || !full_name.trim()) {
      return res.status(400).json({ message: 'Họ và tên không được để trống.' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 30)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }
    if (avatar_url !== undefined && !isValidAvatar(avatar_url)) {
      return res.status(400).json({ message: 'Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.' });
    }

    const result = await query(
      `UPDATE users
       SET full_name = $1, email = $2, phone = $3,
           avatar_url = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END
       WHERE id = $6
       RETURNING id, email, full_name, role, avatar_url, phone, created_at`,
      [full_name.trim(), email.trim().toLowerCase(), String(phone || '').trim(), avatar_url !== undefined, avatar_url ?? null, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    return res.json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Email này đã được tài khoản khác sử dụng.' });
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Không thể cập nhật thông tin cá nhân.' });
  }
}

async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body || {};
    if (typeof current_password !== 'string' || !current_password
      || typeof new_password !== 'string' || new_password.length < 8) {
      return res.status(400).json({ message: 'Nhập mật khẩu hiện tại và mật khẩu mới tối thiểu 8 ký tự.' });
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    if (!await bcrypt.compare(current_password, result.rows[0].password_hash)) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không chính xác.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.id]);
    return res.json({ message: 'Đã đổi mật khẩu thành công.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ message: 'Không thể đổi mật khẩu.' });
  }
}

module.exports = {
  login,
  register,
  getMe,
  updateProfile,
  changePassword,
  googleStart,
  googleCallback,
};
