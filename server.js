const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어
app.use(cors());
app.use(express.json());

// 기존 코드 아래에 추가 - 여기가 중요!
const accountRoutes = require('./routes/account');
app.use('/api/account', accountRoutes);

// 기본 라우트
app.get('/', (req, res) => {
  res.json({ message: 'OKX Tracker API 서버 실행중!' });
});

// 상태 확인
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행중: http://localhost:3001`);
});