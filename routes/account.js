const express = require('express');
const OKXAPI = require('../utils/okxApi');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const okxApi = new OKXAPI();

// 📂 파일 경로 설정
const BALANCE_HISTORY_FILE = path.join(__dirname, '../data/balanceHistory.json');
const CASHFLOW_FILE = path.join(__dirname, '../data/cashflow.json');

// 데이터 디렉토리 생성
const dataDir = path.dirname(BALANCE_HISTORY_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- 헬퍼 함수: 데이터 로드/저장 ---

const loadData = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(data);
      return Array.isArray(parsedData) ? parsedData : [];
    }
  } catch (error) {
    console.error(`${filePath} 로드 실패:`, error);
  }
  return [];
};

const saveData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`${filePath} 저장 실패:`, error);
  }
};

// 초기 데이터 로드
let balanceHistory = loadData(BALANCE_HISTORY_FILE);
let cashflowHistory = loadData(CASHFLOW_FILE);

// --- 1. 기본 조회 API ---

// 실시간 잔고 조회
router.get('/balance', async (req, res) => {
  try {
    const balance = await okxApi.getBalance();
    res.json(balance);
  } catch (error) {
    console.error('잔고 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '잔고 조회 실패', 
      details: error.response?.data || error.message 
    });
  }
});

// 실시간 포지션 조회
router.get('/positions', async (req, res) => {
  try {
    const positions = await okxApi.getPositions();
    res.json(positions);
  } catch (error) {
    console.error('포지션 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '포지션 조회 실패', 
      details: error.response?.data || error.message 
    });
  }
});

// 주문 내역 조회 (아카이브)
router.get('/orders', async (req, res) => {
  try {
    const response = await okxApi.getOrdersHistoryArchive(200);
    const allOrders = response.data || [];
    
    const targetDate = new Date('2026-02-20T00:00:00');
    const filteredOrders = allOrders.filter((order) => {
      if (!order.cTime) return false;
      const orderDate = new Date(parseInt(order.cTime));
      return orderDate >= targetDate;
    }).sort((a, b) => parseInt(b.cTime) - parseInt(a.cTime));
    
    res.json({ data: filteredOrders });
  } catch (error) {
    console.error('주문 내역 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '주문 내역 조회 실패', 
      details: error.response?.data || error.message
    });
  }
});

// --- 2. 잔고 히스토리 관리 API ---

// 잔고 기록 저장
router.post('/balance/history', async (req, res) => {
  try {
    const { balance, timestamp } = req.body;
    
    const record = {
      balance: parseFloat(balance),
      timestamp: timestamp || new Date().toISOString(),
      date: new Date().toLocaleDateString('ko-KR'),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };
    
    const existingIndex = balanceHistory.findIndex(r => r.timestamp === record.timestamp);
    
    if (existingIndex >= 0) {
      balanceHistory[existingIndex] = record;
    } else {
      balanceHistory.push(record);
    }
    
    balanceHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    saveData(BALANCE_HISTORY_FILE, balanceHistory);
    
    res.json({ 
      success: true, 
      count: balanceHistory.length,
      message: `잔고 기록 저장 완료`,
      latestBalance: record.balance
    });
  } catch (error) {
    console.error('잔고 기록 저장 실패:', error);
    res.status(500).json({ error: '잔고 기록 저장 실패', details: error.message });
  }
});

// 잔고 기록 조회
router.get('/balance/history', async (req, res) => {
  try {
    const { after, limit } = req.query;
    let filteredHistory = balanceHistory;
    
    if (after) {
      const afterDate = new Date(after);
      filteredHistory = balanceHistory.filter(record => new Date(record.timestamp) >= afterDate);
    }
    
    if (limit && parseInt(limit) > 0) {
      filteredHistory = filteredHistory.slice(-parseInt(limit));
    }
    
    res.json({ 
      data: filteredHistory,
      totalCount: balanceHistory.length,
      filteredCount: filteredHistory.length
    });
  } catch (error) {
    res.status(500).json({ error: '잔고 기록 조회 실패', details: error.message });
  }
});

// --- 3. 포지션 및 자산 상세 조회 ---

// 포지션 히스토리 조회
router.get('/positions-history', async (req, res) => {
  try {
    const { instType, limit = 100, after } = req.query;
    let endpoint = '/api/v5/account/positions-history';
    const params = [];
    
    if (limit) params.push(`limit=${Math.min(limit, 500)}`);
    if (instType) params.push(`instType=${instType}`);
    if (after) params.push(`after=${after}`);
    
    if (params.length > 0) endpoint += '?' + params.join('&');
    
    const response = await okxApi.makeRequest('GET', endpoint);
    const targetTimestamp = new Date('2026-02-20T00:00:00').getTime();
    
    const filteredData = response.data ? response.data.filter((history) => {
      const closeTime = parseInt(history.uTime || history.cTime || '0');
      return closeTime >= targetTimestamp;
    }) : [];
    
    const formattedHistory = filteredData.map((item) => ({
      instId: item.instId || 'N/A',
      posSide: item.posSide || 'unknown',
      openTime: item.cTime,
      closeTime: item.uTime,
      openAvgPx: item.openAvgPx || '0',
      closeAvgPx: item.closeAvgPx || '0',
      realizedPnl: item.realizedPnl || '0',
      pnlRatio: item.pnlRatio || '0',
      sz: item.closeTotalPos || item.pos || '0',
      lever: item.lever || '1',
      margin: item.margin || '0'
    }));
    
    res.json({ ...response, data: formattedHistory, totalCount: formattedHistory.length });
  } catch (error) {
    res.status(500).json({ error: '포지션 히스토리 조회 실패', details: error.message });
  }
});

// 체결 내역 조회
router.get('/fills', async (req, res) => {
  try {
    const { instType, instId, limit = 200, after } = req.query;
    const response = await okxApi.getFills(instType, instId, limit, after);
    const targetTimestamp = new Date('2026-02-20T00:00:00').getTime();
    
    const filteredData = response.data ? response.data.filter((fill) => {
      const fillTime = parseInt(fill.uTime || fill.cTime || '0');
      return fillTime >= targetTimestamp;
    }) : [];
    
    const convertedHistory = filteredData.map((fill) => ({
      instId: fill.instId,
      posSide: fill.side === 'buy' ? 'long' : 'short',
      openTime: fill.cTime,
      closeTime: fill.uTime,
      openAvgPx: fill.fillPx,
      closeAvgPx: fill.fillPx,
      realizedPnl: fill.pnl || fill.fee || '0',
      sz: fill.fillSz,
      tradeId: fill.tradeId,
      orderId: fill.ordId
    }));
    
    res.json({ ...response, data: convertedHistory, totalCount: convertedHistory.length });
  } catch (error) {
    res.status(500).json({ error: '체결 내역 조회 실패', details: error.message });
  }
});

// 계좌 자산 변동 내역 (Bills)
router.get('/bills', async (req, res) => {
  try {
    const { ccy, type, after, limit = 500 } = req.query;
    const response = await okxApi.getBills(ccy, type, after, limit);
    const targetTimestamp = new Date('2026-02-20T00:00:00').getTime();
    
    const filteredData = response.data ? response.data.filter((bill) => {
      const billTime = parseInt(bill.ts || '0');
      return billTime >= targetTimestamp;
    }) : [];
    
    res.json({ ...response, data: filteredData, totalCount: filteredData.length });
  } catch (error) {
    res.status(500).json({ error: '자산 변동 내역 조회 실패', details: error.message });
  }
});

// --- 4. 🆕 입출금(Cashflow) 관리 API ---

// 입출금 내역 조회
router.get('/cashflow', (req, res) => {
  const totalDeposit = cashflowHistory.filter(c => c.type === 'deposit').reduce((sum, c) => sum + c.amount, 0);
  const totalWithdrawal = cashflowHistory.filter(c => c.type === 'withdrawal').reduce((sum, c) => sum + c.amount, 0);

  res.json({
    success: true,
    data: cashflowHistory,
    totalDeposit,
    totalWithdrawal,
    netDeposit: totalDeposit - totalWithdrawal
  });
});

// 입출금 내역 추가
router.post('/cashflow', (req, res) => {
  try {
    const { amount, type, date, note } = req.body;

    if (!amount || !type || !date) {
      return res.status(400).json({ error: '금액, 유형, 날짜는 필수 항목입니다.' });
    }

    const newRecord = {
      id: Date.now(),
      amount: parseFloat(amount),
      type, // 'deposit' or 'withdrawal'
      date,
      note: note || '',
      timestamp: new Date().toISOString()
    };

    cashflowHistory.push(newRecord);
    cashflowHistory.sort((a, b) => new Date(b.date) - new Date(a.date)); // 최신순 정렬
    saveData(CASHFLOW_FILE, cashflowHistory);

    res.json({ success: true, data: newRecord });
  } catch (error) {
    res.status(500).json({ error: '입출금 기록 저장 실패', details: error.message });
  }
});

// 입출금 내역 삭제
router.delete('/cashflow/:id', (req, res) => {
  const { id } = req.params;
  cashflowHistory = cashflowHistory.filter(c => c.id !== parseInt(id));
  saveData(CASHFLOW_FILE, cashflowHistory);
  res.json({ success: true, message: '기록이 삭제되었습니다.' });
});

// --- 5. 시스템 및 동기화 API ---

// 건강 상태 확인
router.get('/health', async (req, res) => {
  try {
    const balance = await okxApi.getBalance();
    res.json({
      status: 'OK',
      apiConnected: true,
      historyCount: balanceHistory.length,
      cashflowCount: cashflowHistory.length
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
});

// 데이터 동기화 (기존 로직 유지)
router.post('/balance/sync', async (req, res) => {
  try {
    const currentBalance = await okxApi.getBalance();
    const currentTotalEq = currentBalance.data?.[0]?.totalEq ? parseFloat(currentBalance.data[0].totalEq) : 0;
    
    const billsResponse = await okxApi.getBills('', '', null, 500);
    let reconstructedHistory = [];
    
    if (billsResponse.data) {
      const relevantBills = billsResponse.data
        .filter(bill => parseInt(bill.ts) >= new Date('2026-02-20T00:00:00').getTime())
        .sort((a, b) => parseInt(a.ts) - parseInt(b.ts));
      
      relevantBills.forEach(bill => {
        reconstructedHistory.push({
          balance: parseFloat(bill.bal || '0'),
          timestamp: new Date(parseInt(bill.ts)).toISOString(),
          date: new Date(parseInt(bill.ts)).toLocaleDateString('ko-KR'),
          time: new Date(parseInt(bill.ts)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          source: 'bill'
        });
      });
    }

    const now = new Date();
    reconstructedHistory.push({
      balance: currentTotalEq,
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('ko-KR'),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      source: 'current'
    });
    
    const uniqueHistory = reconstructedHistory.filter((record, index, self) =>
      index === self.findIndex(r => r.timestamp === record.timestamp)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    balanceHistory = uniqueHistory;
    saveData(BALANCE_HISTORY_FILE, balanceHistory);
    
    res.json({ success: true, count: uniqueHistory.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 데이터 초기화
router.post('/balance/reset', async (req, res) => {
  try {
    balanceHistory = [];
    saveData(BALANCE_HISTORY_FILE, balanceHistory);
    res.json({ success: true, message: '초기화 완료' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
