const express = require('express');
const OKXAPI = require('../utils/okxApi');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const okxApi = new OKXAPI();

// 파일 기반 잔고 기록 저장소
const BALANCE_HISTORY_FILE = path.join(__dirname, '../data/balanceHistory.json');

// 데이터 디렉토리 생성
const dataDir = path.dirname(BALANCE_HISTORY_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 파일에서 데이터 로드
const loadBalanceHistory = () => {
  try {
    if (fs.existsSync(BALANCE_HISTORY_FILE)) {
      const data = fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8');
      const parsedData = JSON.parse(data);
      return Array.isArray(parsedData) ? parsedData : [];
    }
  } catch (error) {
    console.error('잔고 기록 파일 로드 실패:', error);
  }
  
  return [];
};

// 파일에 데이터 저장
const saveBalanceHistory = (data) => {
  try {
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('잔고 기록 파일 저장 실패:', error);
  }
};

let balanceHistory = loadBalanceHistory();

// 잔고 조회
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

// 포지션 조회
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

// 주문 내역 조회
router.get('/orders', async (req, res) => {
  try {
    const response = await okxApi.getOrdersHistoryArchive(200);
    const allOrders = response.data || [];
    
    const targetDate = new Date('2025-11-04T13:52:00');
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
    
    const existingIndex = balanceHistory.findIndex(
      r => r.timestamp === record.timestamp
    );
    
    if (existingIndex >= 0) {
      balanceHistory[existingIndex] = record;
    } else {
      balanceHistory.push(record);
    }
    
    balanceHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    saveBalanceHistory(balanceHistory);
    
    res.json({ 
      success: true, 
      count: balanceHistory.length,
      message: `잔고 기록 저장 완료 (총 ${balanceHistory.length}개)`,
      latestBalance: record.balance
    });
  } catch (error) {
    console.error('잔고 기록 저장 실패:', error);
    res.status(500).json({ 
      error: '잔고 기록 저장 실패',
      details: error.message 
    });
  }
});

// 잔고 기록 조회
router.get('/balance/history', async (req, res) => {
  try {
    const { after, limit } = req.query;
    let filteredHistory = balanceHistory;
    
    if (after) {
      const afterDate = new Date(after);
      filteredHistory = balanceHistory.filter(record => 
        new Date(record.timestamp) >= afterDate
      );
    }
    
    if (limit && parseInt(limit) > 0) {
      filteredHistory = filteredHistory.slice(-parseInt(limit));
    }
    
    res.json({ 
      data: filteredHistory,
      totalCount: balanceHistory.length,
      filteredCount: filteredHistory.length,
      dateRange: {
        start: balanceHistory.length > 0 ? balanceHistory[0].timestamp : null,
        end: balanceHistory.length > 0 ? balanceHistory[balanceHistory.length - 1].timestamp : null
      }
    });
  } catch (error) {
    console.error('잔고 기록 조회 실패:', error);
    res.status(500).json({ 
      error: '잔고 기록 조회 실패',
      details: error.message 
    });
  }
});

// ✅ 수정된 포지션 히스토리 조회 - 레버리지 데이터 포함
router.get('/positions-history', async (req, res) => {
  try {
    const { instType, limit = 100, after } = req.query;
    
    let endpoint = '/api/v5/account/positions-history';
    const params = [];
    
    if (limit) {
      params.push(`limit=${Math.min(limit, 500)}`);
    }
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (after) {
      params.push(`after=${after}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    const response = await okxApi.makeRequest('GET', endpoint);
    
    const targetTimestamp = new Date('2025-11-04T13:52:00').getTime();
    const filteredData = response.data ? response.data.filter((history) => {
      const closeTime = parseInt(history.uTime || history.cTime || '0');
      return closeTime >= targetTimestamp;
    }) : [];
    
    // ✅ 레버리지 데이터 포함하도록 수정
    const formattedHistory = filteredData.map((item) => ({
      instId: item.instId || 'N/A',
      posSide: item.posSide || 'unknown',
      openTime: item.cTime,
      closeTime: item.uTime,
      openAvgPx: item.openAvgPx || '0',
      closeAvgPx: item.closeAvgPx || '0',
      realizedPnl: item.realizedPnl || '0',
      sz: item.closeTotalPos || item.pos || '0',
      lever: item.lever || '1', // ✅ 레버리지 데이터 추가
      margin: item.margin || '0' // ✅ 마진 데이터도 추가
    }));
    
    console.log(`✅ 포지션 히스토리: ${formattedHistory.length}개 로드 (레버리지 포함)`);
    
    res.json({
      ...response,
      data: formattedHistory,
      totalCount: formattedHistory.length
    });
  } catch (error) {
    console.error('포지션 히스토리 조회 실패:', error);
    res.status(500).json({ 
      error: '포지션 히스토리 조회 실패',
      details: error.message 
    });
  }
});

// 체결 내역 조회
router.get('/fills', async (req, res) => {
  try {
    const { instType, instId, limit = 200, after } = req.query;
    
    const response = await okxApi.getFills(instType, instId, limit, after);
    
    const targetTimestamp = new Date('2025-11-04T13:52:00').getTime();
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
    
    res.json({
      ...response,
      data: convertedHistory,
      totalCount: convertedHistory.length
    });
  } catch (error) {
    console.error('체결 내역 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '체결 내역 조회 실패',
      details: error.response?.data || error.message 
    });
  }
});

// 계좌 자산 변동 내역
router.get('/bills', async (req, res) => {
  try {
    const { ccy, type, after, limit = 500 } = req.query;
    
    const response = await okxApi.getBills(ccy, type, after, limit);
    
    const targetTimestamp = new Date('2025-11-04T13:52:00').getTime();
    const filteredData = response.data ? response.data.filter((bill) => {
      const billTime = parseInt(bill.ts || '0');
      return billTime >= targetTimestamp;
    }) : [];
    
    res.json({
      ...response,
      data: filteredData,
      totalCount: filteredData.length
    });
  } catch (error) {
    console.error('자산 변동 내역 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '자산 변동 내역 조회 실패',
      details: error.response?.data || error.message 
    });
  }
});

// 건강 상태 확인
router.get('/health', async (req, res) => {
  try {
    const balance = await okxApi.getBalance();
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      apiConnected: true,
      hasBalanceData: !!balance.data?.[0],
      historyCount: balanceHistory.length,
      historyFile: BALANCE_HISTORY_FILE,
      dataRange: {
        start: balanceHistory.length > 0 ? balanceHistory[0].timestamp : 'No data',
        end: balanceHistory.length > 0 ? balanceHistory[balanceHistory.length - 1].timestamp : 'No data'
      }
    });
  } catch (error) {
    console.error('건강 상태 확인 실패:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      apiConnected: false,
      error: error.message,
      historyCount: balanceHistory.length
    });
  }
});

// 데이터 통계
router.get('/stats', async (req, res) => {
  try {
    const balanceResponse = await okxApi.getBalance();
    const positionsResponse = await okxApi.getPositions();
    
    res.json({
      balance: {
        totalRecords: balanceHistory.length,
        dateRange: {
          start: balanceHistory.length > 0 ? balanceHistory[0].timestamp : null,
          end: balanceHistory.length > 0 ? balanceHistory[balanceHistory.length - 1].timestamp : null
        },
        currentBalance: balanceResponse.data?.[0]?.totalEq || 0
      },
      positions: {
        active: positionsResponse.data?.length || 0
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        historyFile: BALANCE_HISTORY_FILE
      }
    });
  } catch (error) {
    console.error('통계 조회 실패:', error);
    res.status(500).json({ 
      error: '통계 조회 실패',
      details: error.message 
    });
  }
});

// 데이터 동기화
router.post('/balance/sync', async (req, res) => {
  try {
    console.log('데이터 동기화 시작...');
    
    const currentBalance = await okxApi.getBalance();
    const currentTotalEq = currentBalance.data?.[0]?.totalEq ? parseFloat(currentBalance.data[0].totalEq) : 0;
    
    const billsResponse = await okxApi.getBills('', '', null, 500);
    const fillsResponse = await okxApi.getFills('', '', 200);
    
    let reconstructedHistory = [];
    const initialDeposit = 464.97;
    let runningBalance = initialDeposit;
    
    if (billsResponse.data && billsResponse.data.length > 0) {
      console.log(`자산 변동 내역 ${billsResponse.data.length}개 처리 중...`);
      
      const relevantBills = billsResponse.data
        .filter(bill => {
          const billTime = parseInt(bill.ts || '0');
          return billTime >= new Date('2025-11-04T13:52:00').getTime();
        })
        .sort((a, b) => parseInt(a.ts) - parseInt(b.ts));
      
      relevantBills.forEach((bill, index) => {
        const balanceChange = parseFloat(bill.balChg || '0');
        const balance = parseFloat(bill.bal || '0');
        
        if (balanceChange !== 0 || balance > 0) {
          runningBalance = balance > 0 ? balance : runningBalance + balanceChange;
          
          reconstructedHistory.push({
            balance: runningBalance,
            timestamp: new Date(parseInt(bill.ts)).toISOString(),
            date: new Date(parseInt(bill.ts)).toLocaleDateString('ko-KR'),
            time: new Date(parseInt(bill.ts)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            source: 'bill',
            billId: bill.billId
          });
        }
      });
      
      console.log(`자산 변동 내역으로 ${reconstructedHistory.length}개 기록 생성`);
    }
    
    if (fillsResponse.data && fillsResponse.data.length > 0) {
      console.log(`체결 내역 ${fillsResponse.data.length}개 처리 중...`);
      
      const relevantFills = fillsResponse.data
        .filter(fill => {
          const fillTime = parseInt(fill.uTime || fill.cTime || '0');
          return fillTime >= new Date('2025-11-04T13:52:00').getTime();
        })
        .sort((a, b) => parseInt(a.uTime || a.cTime) - parseInt(b.uTime || b.cTime));
      
      relevantFills.forEach(fill => {
        const fillTime = parseInt(fill.uTime || fill.cTime);
        const pnl = parseFloat(fill.pnl || '0');
        const fee = parseFloat(fill.fee || '0');
        
        if (pnl !== 0 || fee !== 0) {
          const existingRecord = reconstructedHistory.find(record => 
            new Date(record.timestamp).getTime() === fillTime
          );
          
          if (!existingRecord) {
            reconstructedHistory.push({
              balance: currentTotalEq,
              timestamp: new Date(fillTime).toISOString(),
              date: new Date(fillTime).toLocaleDateString('ko-KR'),
              time: new Date(fillTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
              source: 'fill',
              tradeId: fill.tradeId,
              estimatedPnl: pnl
            });
          }
        }
      });
      
      console.log(`체결 내역으로 ${relevantFills.length}개 기록 추가 처리`);
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
    saveBalanceHistory(balanceHistory);
    
    console.log(`데이터 동기화 완료: 총 ${uniqueHistory.length}개 기록`);
    
    res.json({
      success: true,
      message: `데이터 동기화 완료 (${uniqueHistory.length}개 기록)`,
      stats: {
        totalRecords: uniqueHistory.length,
        fromBills: uniqueHistory.filter(r => r.source === 'bill').length,
        fromFills: uniqueHistory.filter(r => r.source === 'fill').length,
        dateRange: {
          start: uniqueHistory.length > 0 ? uniqueHistory[0].timestamp : null,
          end: uniqueHistory.length > 0 ? uniqueHistory[uniqueHistory.length - 1].timestamp : null
        },
        currentBalance: currentTotalEq
      }
    });
    
  } catch (error) {
    console.error('데이터 동기화 실패:', error);
    res.status(500).json({
      success: false,
      error: '데이터 동기화 실패',
      details: error.message
    });
  }
});

// 데이터 초기화
router.post('/balance/reset', async (req, res) => {
  try {
    balanceHistory = [];
    saveBalanceHistory(balanceHistory);
    
    res.json({
      success: true,
      message: '모든 잔고 기록이 삭제되었습니다.',
      count: 0
    });
  } catch (error) {
    console.error('데이터 초기화 실패:', error);
    res.status(500).json({
      success: false,
      error: '데이터 초기화 실패',
      details: error.message
    });
  }
});

module.exports = router;