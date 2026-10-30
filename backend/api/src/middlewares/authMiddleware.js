const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'examhub-dev-secret-key-change-in-production';

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches `req.user` with { id, email, full_name, role }.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không tìm thấy token xác thực.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}

/**
 * Middleware factory: Restrict access to specific roles.
 * @param  {...string} roles  Allowed roles, e.g. 'admin', 'teacher', 'student'
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Chưa xác thực.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập tính năng này.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
