# API

# API

Các endpoint chính:

- `POST /api/auth/login` — đăng nhập và lấy token.
- `GET /api/auth/google` — bắt đầu đăng nhập Google OAuth, chỉ yêu cầu email và hồ sơ cơ bản.
- `GET /api/auth/google/callback` — xác minh phản hồi OAuth và đưa người dùng về ứng dụng.
- `PUT /api/auth/profile` — cập nhật họ tên, email, số điện thoại và ảnh đại diện của tài khoản đang đăng nhập.
- `PUT /api/auth/password` — đổi mật khẩu sau khi xác nhận mật khẩu hiện tại; mật khẩu mới tối thiểu 8 ký tự.
- `POST /api/users` — quản trị viên tạo tài khoản với ảnh đại diện và số điện thoại tùy chọn.
- `GET /api/questions` — tra cứu ngân hàng câu hỏi.
- `POST /api/exams/generate` — tạo và lưu đề thi.
- `POST /api/exam-rooms` — giảng viên tạo phòng thi từ `examIds`; mỗi sinh viên được phân ngẫu nhiên một đề trong danh sách và giữ nguyên đề đó khi vào lại phòng.
- `GET /api/exam-rooms` — danh sách phòng do giảng viên tạo.
- `PATCH /api/exam-rooms/:id/status` — mở lại hoặc đóng phòng thi.
- `GET /api/exam-rooms/:id/attempts` — giảng viên giám sát tiến độ và câu trả lời từng sinh viên (tự cập nhật trên giao diện mỗi 5 giây).
- `POST /api/exam-rooms/:code/start` — sinh viên vào phòng hoặc tiếp tục bài đang làm.
- `PUT /api/exam-rooms/attempts/:id/answers` — lưu câu trả lời, câu đánh dấu và vị trí hiện tại.
- `POST /api/exam-rooms/attempts/:id/submit` — nộp bài và tự chấm đề trắc nghiệm.
- `GET /api/exam-rooms/my-attempts` — lịch sử dự thi và kết quả của sinh viên đang đăng nhập.

Để bật Google OAuth, cấu hình `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `API_PUBLIC_URL` và `FRONTEND_URL` trong môi trường backend. Đăng ký chính xác URI callback trong Google Cloud Console. Tài khoản Google mới được tạo với vai trò sinh viên; email Google đã xác minh khớp với tài khoản hiện hữu sẽ đăng nhập vào tài khoản đó và giữ nguyên vai trò.

Thi trực tuyến cần migration [`007_online_exam_rooms.sql`](../../database/migrations/007_online_exam_rooms.sql). Hồ sơ tài khoản cần migration [`008_user_profiles.sql`](../../database/migrations/008_user_profiles.sql). API cũng tự bổ sung các bảng/cột này khi khởi động.
