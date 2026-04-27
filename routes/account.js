const express = require('express');
const OKXAPI = require('../utils/okxApi');
const router = express.Router();
const mongoose = require('mongoose');

const okxApi = new OKXAPI();

// --- 📂 MongoDB 스키마 및 모델 정의 ---

// 1. 잔고 히스토리 스키마
const BalanceHistorySchema = new mongoose.Schema({
  balance: Number,
  timestamp: { type: String, unique: true },
  date: String,
  time: String,
  source: String
});
const BalanceHistory = mongoose.models.BalanceHistory || mongoose.model('BalanceHistory', BalanceHistorySchema);

// 2. 입출금(Cashflow) 스키마
const CashflowSchema = new mongoose.Schema({
  amount: Number,
  type: String, // 'deposit' or 'withdrawal'
  date: String,
  note: String,
  timestamp: { type: Date, default: Date.now }
});
const Cashflow = mongoose.models.Cashflow || mongoose.model('Cashflow', CashflowSchema);

// --- 1. 기본 조회 API (OKX API 연동) ---

router.get('/balance', async (req, res) => {
  try {
    const balance = await okxApi.getBalance();
    res.json(balance);
  } catch (error) {
    res.status(500).json({ error: '잔고 조회 실패', details: error.message });
  }
});

router.get('/positions', async (req, res) => {
  try {
    const positions = await okxApi.getPositions();
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: '포지션 조회 실패', details: error.message });
  }
});

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
    res.status(500).json({ error: '주문 내역 조회 실패', details: error.message });
  }
});

// --- 2. 잔고 히스토리 관리 API (DB 연동) ---

router.post('/balance/history', async (req, res) => {
  try {
    const { balance, timestamp } = req.body;
    const record = {
      balance: parseFloat(balance),
      timestamp: timestamp || new Date().toISOString(),
      date: new Date().toLocaleDateString('ko-KR'),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    await BalanceHistory.findOneAndUpdate(
      { timestamp: record.timestamp },
      record,
      { upsert: true, new: true }
    );

    res.json({ success: true, message: '잔고 기록 저장 완료' });
  } catch (error) {
    res.status(500).json({ error: '잔고 기록 저장 실패', details: error.message });
  }
});

router.get('/balance/history', async (req, res) => {
  try {
    const { after, limit } = req.query;
    let query = {};
    
    if (after) {
      query.timestamp = { $gte: new Date(after).toISOString() };
    }
    
    let dbQuery = BalanceHistory.find(query).sort({ timestamp: 1 });
    if (limit) dbQuery = dbQuery.limit(parseInt(limit));
    
    const history = await dbQuery;
    res.json({ data: history, totalCount: await BalanceHistory.countDocuments() });
  } catch (error) {
    res.status(500).json({ error: '잔고 기록 조회 실패', details: error.message });
  }
});

// --- 3. 포지션 및 자산 상세 조회 ---

router.get('/positions-history', async (req, res) => {
  try {
    const { instType, limit = 100, after } = req.query;
    let endpoint = `/api/v5/account/positions-history?limit=${Math.min(limit, 500)}`;
    if (instType) endpoint += `&instType=${instType}`;
    if (after) endpoint += `&after=${after}`;

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

    res.json({ ...response, data: formattedHistory });
  } catch (error) {
    res.status(500).json({ error: '포지션 히스토리 조회 실패', details: error.message });
  }
});

// --- 4. 🆕 입출금(Cashflow) 관리 API (DB 연동) ---

router.get('/cashflow', async (req, res) => {
  try {
    const history = await Cashflow.find().sort({ date: -1 });
    const totalDeposit = history.filter(c => c.type === 'deposit').reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalWithdrawal = history.filter(c => c.type === 'withdrawal').reduce((sum, c) => sum + (c.amount || 0), 0);

    res.json({
      success: true,
      data: history,
      totalDeposit,
      totalWithdrawal,
      netDeposit: totalDeposit - totalWithdrawal
    });
  } catch (error) {
    res.status(500).json({ error: '입출금 조회 실패', details: error.message });
  }
});

router.post('/cashflow', async (req, res) => {
  try {
    const { amount, type, date, note } = req.body;
    if (!amount || !type || !date) return res.status(400).json({ error: '필수 항목 누락' });

    const newRecord = new Cashflow({
      amount: parseFloat(amount),
      type,
      date,
      note: note || ''
    });
    await newRecord.save();
    res.json({ success: true, data: newRecord });
  } catch (error) {
    res.status(500).json({ error: '입출금 저장 실패', details: error.message });
  }
});

router.delete('/cashflow/:id', async (req, res) => {
  try {
    await Cashflow.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: '삭제 완료' });
  } catch (error) {
    res.status(500).json({ error: '삭제 실패', details: error.message });
  }
});

// --- 5. 시스템 및 동기화 API ---

router.get('/health', async (req, res) => {
  try {
    const balance = await okxApi.getBalance();
    res.json({
      status: 'OK',
      dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      apiConnected: true
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
});

router.post('/balance/sync', async (req, res) => {
  try {
    const currentBalance = await okxApi.getBalance();
    const currentTotalEq = currentBalance.data?.[0]?.totalEq ? parseFloat(currentBalance.data[0].totalEq) : 0;
    const billsResponse = await okxApi.getBills('', '', null, 500);
    
    if (billsResponse.data) {
      const relevantBills = billsResponse.data
        .filter(bill => parseInt(bill.ts) >= new Date('2026-02-20T00:00:00').getTime());
      
      for (const bill of relevantBills) {
        await BalanceHistory.findOneAndUpdate(
          { timestamp: new Date(parseInt(bill.ts)).toISOString() },
          {
            balance: parseFloat(bill.bal || '0'),
            timestamp: new Date(parseInt(bill.ts)).toISOString(),
            date: new Date(parseInt(bill.ts)).toLocaleDateString('ko-KR'),
            time: new Date(parseInt(bill.ts)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            source: 'bill'
          },
          { upsert: true }
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/balance/reset', async (req, res) => {
  try {
    await BalanceHistory.deleteMany({});
    res.json({ success: true, message: '초기화 완료' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
