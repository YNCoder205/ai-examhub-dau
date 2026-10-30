# AI EXAMHUB DAU

Hệ thống AI tạo đề, tổ chức thi, chấm thi và quản lý lớp học theo chuẩn Rubric.

## Thành phần
- Frontend Web: React + TypeScript + Vite
- Mobile: React Native / Flutter (tùy chọn)
- Backend: Node.js + Express
- AI Services: Python
- Database: PostgreSQL
- ML Models: OCR, Embedding, Question Generation, Grading, Translation
- DevOps: Docker, Nginx, Kubernetes, Monitoring

## Cấu trúc chính
- frontend/web: giao diện web
- backend/api: API backend
- database: schema và migration
- ai-services: các service AI
- devops: Docker/Kubernetes/monitoring
- storage: uploads, results, temp

## Chạy local

### 1) Backend
```bash
cd backend/api
cp .env.example .env
npm install
npm run dev
```

### 2) Frontend
```bash
cd frontend/web
cp .env.example .env
npm install
npm run dev -- --host 0.0.0.0
```

### 3) Chạy full stack bằng Docker
```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend: http://localhost:3000/api
- PostgreSQL: localhost:5432

## Dùng trong dev
- Backend đọc biến môi trường từ backend/api/.env
- Frontend đọc biến môi trường từ frontend/web/.env
- Giao diện web kết nối tới backend bằng VITE_API_URL

## Lưu ý
- Không commit file .env thực tế, chỉ duy trì file .env.example
- Khi triển khai thực tế, thay JWT_SECRET và các khóa API bằng secret thực.
