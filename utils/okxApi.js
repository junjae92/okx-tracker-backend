const CryptoJS = require('crypto-js');
const axios = require('axios');

class OKXAPI {
  constructor() {
    this.baseURL = 'https://www.okx.com';
    this.apiKey = process.env.OKX_API_KEY;
    this.secretKey = process.env.OKX_SECRET_KEY;
    this.passphrase = process.env.OKX_PASSPHRASE;
    
    // 공용 API용 axios 인스턴스 (타임아웃 15초)
    this.publicApi = axios.create({
      baseURL: this.baseURL,
      timeout: 15000
    });

    // 인증된 API용 axios 인스턴스 (타임아웃 25초)
    this.authedApi = axios.create({
      timeout: 25000
    });

    console.log('✅ OKXAPI 초기화 완료');
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
      console.error('❌ 서명 생성 실패:', error);
      throw new Error('서명 생성 중 오류 발생');
    }
  }

  // API 요청 공통 함수 (재시도 로직 포함)
  async makeRequest(method, endpoint, body = null, retries = 3) {
    // API 키 검증
    if (!this.apiKey || !this.secretKey || !this.passphrase) {
      throw new Error('API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.');
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
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
            'Content-Type': 'application/json'
          },
          timeout: 25000 // 25초 타임아웃
        };

        if (body) {
          config.data = body;
        }

        console.log(`🔍 API 요청: ${method} ${endpoint} (시도 ${attempt + 1}/${retries + 1})`);

        const response = await this.authedApi(config);
        
        console.log(`✅ API 응답 성공: ${endpoint}`);
        return response.data;

      } catch (error) {
        console.error(`❌ API 요청 실패 (시도 ${attempt + 1}/${retries + 1}): ${endpoint}`);
        
        if (error.response) {
          // API 응답 에러 (4xx, 5xx)
          const errorMsg = error.response.data?.msg || error.message;
          console.error(`   상태 코드: ${error.response.status}, 메시지: ${errorMsg}`);
          
          // 파라미터 에러나 인증 에러는 재시도 의미 없음
          if (error.response.status === 400 || error.response.status === 401) {
            throw new Error(`API 오류: ${errorMsg}`);
          }
          
          // 마지막 시도에서도 실패하면 에러 throw
          if (attempt === retries) {
            throw new Error(`API 오류: ${errorMsg}`);
          }
        } else if (error.code === 'ECONNABORTED') {
          // 타임아웃 에러
          console.error('   ⏰ 타임아웃 발생');
          if (attempt === retries) {
            throw new Error('API 요청 시간 초과');
          }
        } else if (error.request) {
          // 네트워크 에러
          console.error('   🌐 네트워크 연결 실패');
          if (attempt === retries) {
            throw new Error('네트워크 연결에 실패했습니다');
          }
        } else {
          // 기타 에러
          console.error('   💥 에러:', error.message);
          throw error;
        }

        // 재시도 전 대기 (1초, 2초, 4초)
        const backoffTime = Math.min(1000 * Math.pow(2, attempt), 4000);
        console.log(`   ⏳ ${backoffTime}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }

  // 잔고 조회
  async getBalance(ccy = '') {
    try {
      let endpoint = '/api/v5/account/balance';
      if (ccy) {
        endpoint += `?ccy=${ccy}`;
      }
      return await this.makeRequest('GET', endpoint);
    } catch (error) {
      console.error('💥 잔고 조회 실패:', error.message);
      throw error;
    }
  }

  // 포지션 조회
  async getPositions(instType = '', instId = '') {
    try {
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
    } catch (error) {
      console.error('💥 포지션 조회 실패:', error.message);
      throw error;
    }
  }

  // 체결 내역 조회
  async getFills(instType = '', instId = '', limit = 20) {
    try {
      let endpoint = `/api/v5/trade/fills?limit=${limit}`;
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
    } catch (error) {
      console.error('💥 체결 내역 조회 실패:', error.message);
      throw error;
    }
  }

  // 주문 내역 조회
  async getOrderHistory(instType = '', instId = '', limit = 20) {
    try {
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
    } catch (error) {
      console.error('💥 주문 내역 조회 실패:', error.message);
      throw error;
    }
  }

  // 포지션 히스토리 조회 - 여기서만 limit 50으로 고정!
  async getPositionsHistory(instType = '') {
    try {
      let endpoint = `/api/v5/account/positions-history?limit=50`;
      const params = [];
      
      if (instType) {
        params.push(`instType=${instType}`);
      }
      
      if (params.length > 0) {
        endpoint += '?' + params.join('&');
      }
      
      console.log(`🔍 포지션 히스토리 요청: ${endpoint}`);
      return await this.makeRequest('GET', endpoint);
    } catch (error) {
      console.error('💥 포지션 히스토리 조회 실패:', error.message);
      throw error;
    }
  }

  // 계정 자산 변동 내역
  async getBills(ccy = '', type = '', after = null, limit = 100) {
    try {
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
    } catch (error) {
      console.error('💥 자산 변동 내역 조회 실패:', error.message);
      throw error;
    }
  }

  // 계정 구성 정보
  async getAccountConfig() {
    try {
      return await this.makeRequest('GET', '/api/v5/account/config');
    } catch (error) {
      console.error('💥 계정 구성 조회 실패:', error.message);
      throw error;
    }
  }

  // 거래 수수료율 조회
  async getTradeFee(instType = '', instId = '') {
    try {
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
    } catch (error) {
      console.error('💥 수수료율 조회 실패:', error.message);
      throw error;
    }
  }

  // 계정 요약 정보 (에러 발생해도 부분적으로 처리)
  async getAccountSummary() {
    try {
      // 모든 API 호출을 병렬로 실행하지만 개별 에러 처리
      const [balancePromise, positionsPromise, fillsPromise, positionsHistoryPromise] = [
        this.getBalance().catch(err => ({ 
          data: null, 
          error: err.message,
          success: false 
        })),
        this.getPositions().catch(err => ({ 
          data: [], 
          error: err.message,
          success: false 
        })),
        this.getFills().catch(err => ({ 
          data: [], 
          error: err.message,
          success: false 
        })),
        this.getPositionsHistory().catch(err => ({ 
          data: [], 
          error: err.message,
          success: false 
        }))
      ];

      const [balanceResult, positionsResult, fillsResult, positionsHistoryResult] = await Promise.all([
        balancePromise,
        positionsPromise,
        fillsPromise,
        positionsHistoryPromise
      ]);

      // 부분 성공도 허용하는 응답
      return {
        success: true,
        balance: balanceResult.success !== false ? balanceResult.data?.[0] : null,
        positions: positionsResult.success !== false ? positionsResult.data : [],
        fills: fillsResult.success !== false ? fillsResult.data : [],
        positionsHistory: positionsHistoryResult.success !== false ? positionsHistoryResult.data : [],
        timestamp: new Date().toISOString(),
        partialErrors: {
          balance: balanceResult.error,
          positions: positionsResult.error,
          fills: fillsResult.error,
          positionsHistory: positionsHistoryResult.error
        }
      };

    } catch (error) {
      console.error('💥 계정 요약 조회 실패:', error);
      return {
        success: false,
        error: error.message,
        balance: null,
        positions: [],
        fills: [],
        positionsHistory: [],
        timestamp: new Date().toISOString()
      };
    }
  }

  // 공용 API 호출 (타임아웃 10초)
  async publicRequest(endpoint, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        console.log(`🔍 공용 API 요청: ${endpoint} (시도 ${attempt + 1}/${retries + 1})`);
        const response = await this.publicApi.get(endpoint);
        return response.data;
      } catch (error) {
        console.error(`❌ 공용 API 요청 실패 (시도 ${attempt + 1}/${retries + 1}):`, error.message);
        
        if (attempt === retries) {
          throw error;
        }
        
        const backoffTime = 1000 * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }

  // 티커 정보 조회
  async getTicker(instId) {
    try {
      const endpoint = `/api/v5/market/ticker?instId=${instId}`;
      return await this.publicRequest(endpoint);
    } catch (error) {
      console.error('💥 티커 정보 조회 실패:', error.message);
      throw error;
    }
  }

  // 최근 거래 내역
  async getTrades(instId, limit = 100) {
    try {
      const endpoint = `/api/v5/market/trades?instId=${instId}&limit=${limit}`;
      return await this.publicRequest(endpoint);
    } catch (error) {
      console.error('💥 거래 내역 조회 실패:', error.message);
      throw error;
    }
  }

  // 캔들스틱 데이터
  async getCandles(instId, bar = '1m', limit = 100) {
    try {
      const endpoint = `/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
      return await this.publicRequest(endpoint);
    } catch (error) {
      console.error('💥 캔들스틱 데이터 조회 실패:', error.message);
      throw error;
    }
  }

  // API 상태 확인
  async checkAPIStatus() {
    try {
      console.log('🔗 API 연결 상태 확인 중...');
      const result = await this.getBalance();
      
      return {
        connected: true,
        hasData: !!result.data,
        timestamp: new Date().toISOString(),
        message: 'OKX API 연결 정상'
      };
    } catch (error) {
      console.error('🔗 API 연결 상태 확인 실패:', error.message);
      return {
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        message: 'OKX API 연결 실패'
      };
    }
  }
}

module.exports = OKXAPI;
