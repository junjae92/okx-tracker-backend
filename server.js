const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // 1. DB 연결을 위해 추가
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- 🔗 2. MongoDB Atlas 연결 설정 ---
// Render의 Environment에 등록한 MONGO_URI를 가져옵니다.
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ 에러: MONGO_URI 환경변수가 설정되지 않았습니다.');
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas 연결 성공!'))
  .catch(err => console.error('❌ MongoDB 연결 실패:', err));

// 미들웨어
app.use(cors());
app.use(express.json());

// 라우터 연결
const accountRoutes = require('./routes/account');
app.use('/api/account', accountRoutes);

// 기본 라우트 (DB 상태를 확인할 수 있게 수정)
app.get('/', (req, res) => {
  res.json({ 
    message: 'OKX Tracker API 서버 실행중',
    dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// 상태 확인 API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString() 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행중: http://localhost:${PORT}`);
});
