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
  
  // ✅ 초기 데이터 없이 빈 배열 반환
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

// 주문 내역 조회 - ✅ 데이터 제한 없이 모든 주문 가져오기
router.get('/orders', async (req, res) => {
  try {
    // ✅ 더 많은 데이터를 가져오기 위해 limit 증가
    const response = await okxApi.getOrdersHistoryArchive(200);
    const allOrders = response.data || [];
    
    // ✅ 2025-11-04 13:52:00 이후의 모든 주문 필터링 (제한 없음)
    const targetDate = new Date('2025-11-04T13:52:00');
    const filteredOrders = allOrders.filter((order) => {
      if (!order.cTime) return false;
      const orderDate = new Date(parseInt(order.cTime));
      return orderDate >= targetDate;
    }).sort((a, b) => parseInt(b.cTime) - parseInt(a.cTime));
    
    // ✅ 모든 데이터 반환 (제한 없음)
    res.json({ data: filteredOrders });
  } catch (error) {
    console.error('주문 내역 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '주문 내역 조회 실패',
      details: error.response?.data || error.message
    });
  }
});

// 잔고 기록 저장 - ✅ 실제 데이터만 저장
router.post('/balance/history', async (req, res) => {
  try {
    const { balance, timestamp } = req.body;
    
    // ✅ 실제 잔고 데이터만 저장
    const record = {
      balance: parseFloat(balance),
      timestamp: timestamp || new Date().toISOString(),
      date: new Date().toLocaleDateString('ko-KR'),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };
    
    // ✅ 중복 데이터 체크 (동일한 타임스탬프가 있으면 업데이트)
    const existingIndex = balanceHistory.findIndex(
      r => r.timestamp === record.timestamp
    );
    
    if (existingIndex >= 0) {
      balanceHistory[existingIndex] = record;
    } else {
      balanceHistory.push(record);
    }
    
    // ✅ 시간순 정렬 (오래된 데이터부터)
    balanceHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // ✅ 파일에 저장 (데이터 제한 없음)
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

// 잔고 기록 조회 - ✅ 모든 데이터 반환
router.get('/balance/history', async (req, res) => {
  try {
    const { after, limit } = req.query;
    let filteredHistory = balanceHistory;
    
    // ✅ 날짜 필터링 (선택사항)
    if (after) {
      const afterDate = new Date(after);
      filteredHistory = balanceHistory.filter(record => 
        new Date(record.timestamp) >= afterDate
      );
    }
    
    // ✅ 제한 적용 (선택사항, 기본값은 모든 데이터)
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

// 포지션 히스토리 조회 - ✅ 모든 데이터 가져오기
router.get('/positions-history', async (req, res) => {
  try {
    const { instType, limit = 100, after } = req.query;
    
    let endpoint = '/api/v5/account/positions-history';
    const params = [];
    
    // ✅ 더 많은 데이터 요청
    if (limit) {
      params.push(`limit=${Math.min(limit, 500)}`); // 최대 500개까지
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
    
    // ✅ 2025-11-04 13:52:00 이후 모든 데이터 필터링
    const targetTimestamp = new Date('2025-11-04T13:52:00').getTime();
    const filteredData = response.data ? response.data.filter((history) => {
      const closeTime = parseInt(history.closeTime || history.uTime || '0');
      return closeTime >= targetTimestamp;
    }) : [];
    
    res.json({
      ...response,
      data: filteredData,
      totalCount: filteredData.length
    });
  } catch (error) {
    console.error('포지션 히스토리 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '포지션 히스토리 조회 실패',
      details: error.response?.data || error.message 
    });
  }
});

// 체결 내역 조회 - ✅ 모든 데이터 가져오기
router.get('/fills', async (req, res) => {
  try {
    const { instType, instId, limit = 200, after } = req.query;
    
    const response = await okxApi.getFills(instType, instId, limit, after);
    
    // ✅ 2025-11-04 13:52:00 이후 모든 데이터 필터링
    const targetTimestamp = new Date('2025-11-04T13:52:00').getTime();
    const filteredData = response.data ? response.data.filter((fill) => {
      const fillTime = parseInt(fill.uTime || fill.cTime || '0');
      return fillTime >= targetTimestamp;
    }) : [];
    
    res.json({
      ...response,
      data: filteredData,
      totalCount: filteredData.length
    });
  } catch (error) {
    console.error('체결 내역 조회 실패:', error.response?.data || error.message);
    res.status(500).json({ 
      error: '체결 내역 조회 실패',
      details: error.response?.data || error.message 
    });
  }
});

// 계좌 자산 변동 내역 - ✅ 추가: 모든 자산 변동 내역 가져오기
router.get('/bills', async (req, res) => {
  try {
    const { ccy, type, after, limit = 500 } = req.query;
    
    const response = await okxApi.getBills(ccy, type, after, limit);
    
    // ✅ 2025-11-04 13:52:00 이후 모든 데이터 필터링
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

// 데이터 통계 - ✅ 추가: 데이터 현황 확인용
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

// ✅ 데이터 초기화를 위한 임시 라우트 - 실제 OKX 데이터로 동기화
router.post('/balance/sync', async (req, res) => {
  try {
    console.log('데이터 동기화 시작...');
    
    // 1. 현재 잔고 가져오기
    const currentBalance = await okxApi.getBalance();
    const currentTotalEq = currentBalance.data?.[0]?.totalEq ? parseFloat(currentBalance.data[0].totalEq) : 0;
    
    // 2. 자산 변동 내역 가져오기 (최대 500개)
    const billsResponse = await okxApi.getBills('', '', null, 500);
    
    // 3. 체결 내역 가져오기 (거래 내역)
    const fillsResponse = await okxApi.getFills('', '', 200);
    
    let reconstructedHistory = [];
    
    // 초기 입금액 설정 (11월 4일 기준)
    const initialDeposit = 464.97;
    let runningBalance = initialDeposit;
    
    // 4. 자산 변동 내역으로 잔고 기록 재구성
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
        
        // 잔고 변화가 있거나, 실제 잔고 데이터가 있을 때만 기록
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
    
    // 5. 체결 내역으로 추가 데이터 보완
    if (fillsResponse.data && fillsResponse.data.length > 0) {
      console.log(`체결 내역 ${fillsResponse.data.length}개 처리 중...`);
      
      const relevantFills = fillsResponse.data
        .filter(fill => {
          const fillTime = parseInt(fill.uTime || fill.cTime || '0');
          return fillTime >= new Date('2025-11-04T13:52:00').getTime();
        })
        .sort((a, b) => parseInt(a.uTime || a.cTime) - parseInt(b.uTime || b.cTime));
      
      // 체결 내역으로 잔고 변화 추정 (간단한 추정)
      relevantFills.forEach(fill => {
        const fillTime = parseInt(fill.uTime || fill.cTime);
        const pnl = parseFloat(fill.pnl || '0');
        const fee = parseFloat(fill.fee || '0');
        
        if (pnl !== 0 || fee !== 0) {
          // 해당 시간대의 기록이 이미 있는지 확인
          const existingRecord = reconstructedHistory.find(record => 
            new Date(record.timestamp).getTime() === fillTime
          );
          
          if (!existingRecord) {
            // 정확한 잔고는 알 수 없으므로 현재 잔고로 대체
            reconstructedHistory.push({
              balance: currentTotalEq, // 정확한 값은 알 수 없으므로 현재 값 사용
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
    
    // 6. 현재 잔고 추가 (가장 최근 데이터)
    const now = new Date();
    reconstructedHistory.push({
      balance: currentTotalEq,
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('ko-KR'),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      source: 'current'
    });
    
    // 7. 중복 제거 및 시간순 정렬
    const uniqueHistory = reconstructedHistory.filter((record, index, self) =>
      index === self.findIndex(r => r.timestamp === record.timestamp)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // 8. 데이터 저장
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

// ✅ 데이터 초기화 (기존 기록 삭제)
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