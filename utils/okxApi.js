const CryptoJS = require('crypto-js');
const axios = require('axios');

class OKXAPI {
  constructor() {
    this.baseURL = 'https://www.okx.com';
    this.apiKey = process.env.OKX_API_KEY;
    this.secretKey = process.env.OKX_SECRET_KEY;
    this.passphrase = process.env.OKX_PASSPHRASE;
    
    // API 호출 제한을 위한 설정
    this.rateLimit = {
      remaining: 10,
      resetTime: null
    };
  }

  // 서명 생성 함수
  generateSignature(timestamp, method, requestPath, body = '') {
    try {
      const message = timestamp + method.toUpperCase() + requestPath + body;
      const signature = CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(message, this.secretKey)
      );
      return signature;
    } catch (error) {
      console.error('서명 생성 실패:', error);
      throw new Error('서명 생성 중 오류 발생');
    }
  }

  // API 요청 공통 함수
  async makeRequest(method, endpoint, body = null) {
    try {
      // API 키 검증
      if (!this.apiKey || !this.secretKey || !this.passphrase) {
        throw new Error('API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.');
      }

      const timestamp = new Date().toISOString();
      const signature = this.generateSignature(
        timestamp, 
        method.toUpperCase(), 
        endpoint, 
        body ? JSON.stringify(body) : ''
      );

      const config = {
        method: method.toLowerCase(),
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'OK-ACCESS-KEY': this.apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': timestamp,
          'OK-ACCESS-PASSPHRASE': this.passphrase,
          'Content-Type': 'application/json',
          'User-Agent': 'OKX-Tracker/1.0'
        },
        timeout: 10000 // 10초 타임아웃
      };

      if (body) {
        config.data = body;
      }

      const response = await axios(config);
      
      // rate limit 정보 업데이트
      if (response.headers['x-ratelimit-remaining']) {
        this.rateLimit.remaining = parseInt(response.headers['x-ratelimit-remaining']);
      }
      if (response.headers['x-ratelimit-reset']) {
        this.rateLimit.resetTime = new Date(parseInt(response.headers['x-ratelimit-reset']) * 1000);
      }

      // OKX API 응답 형식 검증
      if (response.data && response.data.code !== '0') {
        console.warn('OKX API 경고:', response.data.msg, `(코드: ${response.data.code})`);
      }

      return response.data;
    } catch (error) {
      console.error('OKX API 요청 실패:');
      
      if (error.response) {
        // API 응답 에러
        console.error('상태 코드:', error.response.status);
        console.error('에러 데이터:', error.response.data);
        console.error('에러 메시지:', error.response.data?.msg || error.message);
        
        const apiError = new Error(error.response.data?.msg || `API 요청 실패: ${error.response.status}`);
        apiError.status = error.response.status;
        apiError.code = error.response.data?.code;
        apiError.data = error.response.data;
        throw apiError;
      } else if (error.request) {
        // 네트워크 에러
        console.error('네트워크 에러:', error.message);
        throw new Error(`네트워크 연결 실패: ${error.message}`);
      } else {
        // 기타 에러
        console.error('에러:', error.message);
        throw error;
      }
    }
  }

  // 잔고 조회
  async getBalance(ccy = '') {
    let endpoint = '/api/v5/account/balance';
    if (ccy) {
      endpoint += `?ccy=${ccy}`;
    }
    return await this.makeRequest('GET', endpoint);
  }

  // 포지션 조회
  async getPositions(instType = '', instId = '') {
    let endpoint = '/api/v5/account/positions';
    const params = [];
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (instId) {
      params.push(`instId=${instId}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 주문 내역 조회
  async getOrderHistory(instType = '', instId = '', limit = 20) {
    let endpoint = `/api/v5/trade/orders-history?limit=${limit}`;
    const params = [`limit=${limit}`];
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (instId) {
      params.push(`instId=${instId}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 주문 아카이브 내역 (더 많은 과거 데이터)
  async getOrdersHistoryArchive(limit = 50, after = null) {
    let endpoint = `/api/v5/trade/orders-history-archive?limit=${limit}`;
    
    if (after) {
      endpoint += `&after=${after}`;
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 체결 내역 조회
  async getFills(instType = '', instId = '', limit = 50, after = null) {
    let endpoint = `/api/v5/trade/fills?limit=${limit}`;
    const params = [`limit=${limit}`];
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (instId) {
      params.push(`instId=${instId}`);
    }
    if (after) {
      params.push(`after=${after}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 계정 자산 변동 내역
  async getBills(ccy = '', type = '', after = null, limit = 100) {
    let endpoint = `/api/v5/account/bills?limit=${limit}`;
    const params = [`limit=${limit}`];
    
    if (ccy) {
      params.push(`ccy=${ccy}`);
    }
    if (type) {
      params.push(`type=${type}`);
    }
    if (after) {
      params.push(`after=${after}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 계정 구성 정보
  async getAccountConfig() {
    return await this.makeRequest('GET', '/api/v5/account/config');
  }

  // 거래 수수료율 조회
  async getTradeFee(instType = '', instId = '') {
    let endpoint = '/api/v5/account/trade-fee';
    const params = [];
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (instId) {
      params.push(`instId=${instId}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 최근 거래 내역 (공용 API - API 키 불필요)
  async getTrades(instId, limit = 100) {
    try {
      const endpoint = `/api/v5/market/trades?instId=${instId}&limit=${limit}`;
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('거래 내역 조회 실패:', error.message);
      throw error;
    }
  }

  // 티커 정보 조회 (공용 API - API 키 불필요)
  async getTicker(instId) {
    try {
      const endpoint = `/api/v5/market/ticker?instId=${instId}`;
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('티커 정보 조회 실패:', error.message);
      throw error;
    }
  }

  // 캔들스틱 데이터 (공용 API - API 키 불필요)
  async getCandles(instId, bar = '1m', limit = 100) {
    try {
      const endpoint = `/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('캔들스틱 데이터 조회 실패:', error.message);
      throw error;
    }
  }

  // API 상태 확인
  async checkAPIStatus() {
    try {
      const balance = await this.getBalance();
      return {
        connected: true,
        hasData: !!balance.data,
        rateLimit: this.rateLimit,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        rateLimit: this.rateLimit,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 계정 요약 정보 (여러 데이터를 한번에)
  async getAccountSummary() {
    try {
      const [balance, positions, fees] = await Promise.all([
        this.getBalance(),
        this.getPositions(),
        this.getTradeFee()
      ]);

      return {
        balance: balance.data?.[0] || null,
        positions: positions.data || [],
        feeRate: fees.data?.[0] || null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('계정 요약 조회 실패:', error);
      throw error;
    }
  }

  // 포지션 요약 계산
  calculatePositionSummary(positions) {
    if (!positions || !Array.isArray(positions)) {
      return {
        totalCount: 0,
        totalMargin: 0,
        totalUnrealizedPnl: 0,
        longCount: 0,
        shortCount: 0
      };
    }

    const summary = {
      totalCount: positions.length,
      totalMargin: 0,
      totalUnrealizedPnl: 0,
      longCount: 0,
      shortCount: 0,
      byInstrument: {}
    };

    positions.forEach(position => {
      const margin = parseFloat(position.margin || 0);
      const upl = parseFloat(position.upl || 0);
      
      summary.totalMargin += margin;
      summary.totalUnrealizedPnl += upl;

      if (position.posSide === 'long') {
        summary.longCount++;
      } else if (position.posSide === 'short') {
        summary.shortCount++;
      }

      // instrument별 집계
      const instId = position.instId;
      if (!summary.byInstrument[instId]) {
        summary.byInstrument[instId] = {
          count: 0,
          totalMargin: 0,
          totalUnrealizedPnl: 0
        };
      }

      summary.byInstrument[instId].count++;
      summary.byInstrument[instId].totalMargin += margin;
      summary.byInstrument[instId].totalUnrealizedPnl += upl;
    });

    return summary;
  }

  // 주문 내역 필터링 헬퍼 함수
  filterOrdersByDate(orders, startDate, endDate = new Date()) {
    if (!orders || !Array.isArray(orders)) return [];

    return orders.filter(order => {
      if (!order.cTime) return false;
      
      const orderTime = new Date(parseInt(order.cTime));
      return orderTime >= startDate && orderTime <= endDate;
    });
  }

  // 포지션 히스토리 조회
  async getPositionsHistory(instType = '', limit = 50, after = null) {
    let endpoint = `/api/v5/account/positions-history?limit=${limit}`;
    const params = [`limit=${limit}`];
    
    if (instType) {
      params.push(`instType=${instType}`);
    }
    if (after) {
      params.push(`after=${after}`);
    }
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 3개월 주문 아카이브
  async getOrdersHistoryArchive3M(limit = 100, after = null) {
    let endpoint = `/api/v5/trade/orders-history-archive?limit=${limit}`;
    
    if (after) {
      endpoint += `&after=${after}`;
    }
    
    return await this.makeRequest('GET', endpoint);
  }

  // 포지션 PnL 계산 헬퍼 함수
  calculatePositionPnl(position, currentPrice) {
    if (!position || !currentPrice) return null;

    const avgPx = parseFloat(position.avgPx || 0);
    const pos = parseFloat(position.pos || 0);
    
    if (avgPx === 0 || pos === 0) return null;

    let pnl = 0;
    if (position.posSide === 'long') {
      pnl = (currentPrice - avgPx) * pos;
    } else if (position.posSide === 'short') {
      pnl = (avgPx - currentPrice) * pos;
    }

    return {
      unrealizedPnl: pnl,
      unrealizedPnlPercentage: ((pnl / (avgPx * pos)) * 100) * parseFloat(position.lever || 1),
      currentPrice: currentPrice,
      entryPrice: avgPx
    };
  }
}

module.exports = OKXAPI;