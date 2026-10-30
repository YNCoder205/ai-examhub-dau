const express = require('express');
const {
  login,
  register,
  getMe,
  updateProfile,
  changePassword,
  googleStart,
  googleCallback,
} = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/register — Tạo tài khoản mới
router.post('/register', register);

// POST /api/auth/login — Đăng nhập
router.post('/login', login);

// GET /api/auth/me — Lấy thông tin user hiện tại (cần token)
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/password', authenticate, changePassword);
router.get('/google', googleStart);
router.get('/google/callback', googleCallback);

module.exports = router;
