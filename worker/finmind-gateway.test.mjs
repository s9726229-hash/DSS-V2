import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import worker from './index.js';

const TOKEN = 'test-token-must-never-leak';
const ENV = { FINMIND_TOKEN: TOKEN };
const PRICE_QUERY =
  'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2026-01-01&end_date=2026-01-05';
const CHIP_QUERY =
  'dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=2330&start_date=2026-01-01&end_date=2026-01-05';

const ALLOWED_ORIGIN = 'https://s9726229-hash.github.io';
const LOCAL_ORIGIN = 'http://127.0.0.1:5173';

let fetchCalls = [];
let originalFetch;

function request(query, { origin, method = 'GET', path = '/api/finmind/data' } = {}) {
  return new Request(`https://worker.test${path}${query ? `?${query}` : ''}`, {
    method,
    headers: origin ? { Origin: origin } : {},
  });
}

/** 回傳一個可重複讀取的假快取，模擬 Cloudflare Cache API。 */
function installFakeCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        const cached = store.get(key.url);
        return cached ? cached.clone() : undefined;
      },
      async put(key, response) {
        store.set(key.url, response.clone());
      },
    },
  };
  return store;
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

const okUpstream = () =>
  new Response(JSON.stringify({ msg: 'success', data: [{ date: '2026-01-02', close: 100 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  installFakeCache();
  stubFetch(okUpstream);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.caches;
});

describe('合法請求', () => {
  it('價格資料回傳 FinMind 的 JSON', async () => {
    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.msg, 'success');
  });

  it('法人資料回傳 FinMind 的 JSON', async () => {
    const response = await worker.fetch(request(CHIP_QUERY), ENV, { waitUntil() {} });

    assert.equal(response.status, 200);
  });

  it('以 Authorization 標頭帶 token，且 token 不出現在上游網址', async () => {
    await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!fetchCalls[0].url.includes(TOKEN), 'token 不可出現在上游 URL');
  });

  it('回應內容與標頭都不含 token', async () => {
    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    const text = await response.text();
    assert.ok(!text.includes(TOKEN));
    assert.ok(!JSON.stringify([...response.headers]).includes(TOKEN));
  });
});

describe('參數驗證', () => {
  const rejected = [
    [
      '未知資料集',
      'dataset=TaiwanStockDayTrading&data_id=0050&start_date=2026-01-01&end_date=2026-01-05',
    ],
    ['股號含小寫', 'dataset=TaiwanStockPriceAdj&data_id=abcd&start_date=2026-01-01&end_date=2026-01-05'],
    ['股號過短', 'dataset=TaiwanStockPriceAdj&data_id=005&start_date=2026-01-01&end_date=2026-01-05'],
    ['股號過長', 'dataset=TaiwanStockPriceAdj&data_id=0050123&start_date=2026-01-01&end_date=2026-01-05'],
    ['日期格式錯誤', 'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2026/01/01&end_date=2026-01-05'],
    ['日期不存在', 'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2026-02-30&end_date=2026-03-05'],
    ['開始晚於結束', 'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2026-01-06&end_date=2026-01-05'],
    ['價格區間超過 400 天', 'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2024-01-01&end_date=2026-01-05'],
    ['法人區間超過 45 天', 'dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=0050&start_date=2025-11-01&end_date=2026-01-05'],
    ['缺少參數', 'dataset=TaiwanStockPriceAdj&data_id=0050'],
    ['多餘參數', `${PRICE_QUERY}&token=abc`],
    ['重複參數', `${PRICE_QUERY}&data_id=2330`],
  ];

  for (const [name, query] of rejected) {
    it(`拒絕${name}並回傳 400`, async () => {
      const response = await worker.fetch(request(query), ENV, { waitUntil() {} });

      assert.equal(response.status, 400);
      assert.equal(fetchCalls.length, 0, '不應呼叫上游');
    });
  }

  it('接受價格、除息分割、基本資料與融資餘額', async () => {
    for (const dataset of [
      'TaiwanStockPrice',
      'TaiwanStockPriceAdj',
      'TaiwanStockDividendResult',
      'TaiwanStockSplitPrice',
      'TaiwanStockInfo',
      'TaiwanStockMarginPurchaseShortSale',
    ]) {
      const response = await worker.fetch(
        request(`dataset=${dataset}&data_id=0050&start_date=2026-01-01&end_date=2026-01-05`),
        ENV,
        { waitUntil() {} },
      );
      assert.equal(response.status, 200, `${dataset} 應被接受`);
    }
  });

  it('接受英數混合的 ETF 代號', async () => {
    for (const id of ['00631L', '00981A']) {
      const response = await worker.fetch(
        request(`dataset=TaiwanStockPriceAdj&data_id=${id}&start_date=2026-01-01&end_date=2026-01-05`),
        ENV,
        { waitUntil() {} },
      );
      assert.equal(response.status, 200, `${id} 應被接受`);
    }
  });
});

describe('設定與上游錯誤', () => {
  it('未設定 Secret 時回傳 503 並說明原因', async () => {
    const response = await worker.fetch(request(PRICE_QUERY), {}, { waitUntil() {} });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, 'FinMind service is not configured');
    assert.equal(body.detail, 'missing');
    assert.equal(fetchCalls.length, 0);
  });

  it('Secret 設成空字串時明確指出是空值，而非誤導成未設定', async () => {
    // 貼上失敗時 wrangler 會存入空字串，兩者都會 503 但成因不同
    for (const value of ['', '   ', '\n']) {
      const response = await worker.fetch(
        request(PRICE_QUERY),
        { FINMIND_TOKEN: value },
        { waitUntil() {} },
      );
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.detail, 'blank');
    }
  });

  it('503 的內容不含 token 值', async () => {
    const response = await worker.fetch(
      request(PRICE_QUERY),
      { FINMIND_TOKEN: '   ' },
      { waitUntil() {} },
    );

    assert.ok(!(await response.text()).includes('   '));
  });

  it('token 前後有空白時會去除，不因此判定為無效', async () => {
    await worker.fetch(request(PRICE_QUERY), { FINMIND_TOKEN: ` ${TOKEN} ` }, { waitUntil() {} });

    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  });

  it('上游連線失敗時回傳 502 且不洩漏內部細節', async () => {
    stubFetch(() => {
      throw new Error(`connect failed to api.finmindtrade.com with ${TOKEN}`);
    });

    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });
    const text = await response.text();

    assert.equal(response.status, 502);
    assert.ok(text.includes('FinMind upstream error'));
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes('api.finmindtrade.com'));
  });

  it('上游回傳非 2xx 時回傳 502', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    assert.equal(response.status, 502);
  });

  it('回報上游狀態碼，讓前端能分辨權限不足與限流', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ msg: 'Your level is free.', status: 400 }), { status: 400 }),
    );

    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.upstreamStatus, 400);
  });

  it('上游以 HTTP 200 夾帶錯誤內容時仍視為失敗，不可當成資料回傳', async () => {
    // FinMind 對部分錯誤會回 HTTP 200，但內容的 status 欄位不是 200
    stubFetch(
      () =>
        new Response(JSON.stringify({ msg: 'Your level is free.', status: 400 }), { status: 200 }),
    );

    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    assert.equal(response.status, 502);
    assert.equal((await response.json()).upstreamStatus, 400);
  });

  it('上游錯誤不寫入快取，避免錯誤被保留四小時', async () => {
    const ctx = { waitUntil(promise) { return promise; } };
    stubFetch(() => new Response('boom', { status: 500 }));

    await worker.fetch(request(PRICE_QUERY), ENV, ctx);
    stubFetch(okUpstream);
    const second = await worker.fetch(request(PRICE_QUERY), ENV, ctx);

    assert.equal(second.status, 200);
  });
});

describe('CORS', () => {
  it('允許的來源會取得對應的 Access-Control-Allow-Origin', async () => {
    for (const origin of [LOCAL_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5174', ALLOWED_ORIGIN]) {
      const response = await worker.fetch(request(PRICE_QUERY, { origin }), ENV, {
        waitUntil() {},
      });
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    }
  });

  it('未允許的來源不會取得 Access-Control-Allow-Origin', async () => {
    const response = await worker.fetch(
      request(PRICE_QUERY, { origin: 'https://evil.example.com' }),
      ENV,
      { waitUntil() {} },
    );

    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('沒有 Origin 的請求（例如 curl）仍可取得資料', async () => {
    const response = await worker.fetch(request(PRICE_QUERY), ENV, { waitUntil() {} });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('標記 Vary: Origin，避免快取跨來源共用標頭', async () => {
    const response = await worker.fetch(request(PRICE_QUERY, { origin: ALLOWED_ORIGIN }), ENV, {
      waitUntil() {},
    });

    assert.match(response.headers.get('Vary') ?? '', /Origin/);
  });

  it('OPTIONS 預檢對允許的來源回傳 204', async () => {
    const response = await worker.fetch(
      request(PRICE_QUERY, { origin: ALLOWED_ORIGIN, method: 'OPTIONS' }),
      ENV,
      { waitUntil() {} },
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  });
});

describe('快取', () => {
  it('相同查詢第二次不再呼叫上游', async () => {
    const ctx = { waitUntil(promise) { return promise; } };

    await worker.fetch(request(PRICE_QUERY), ENV, ctx);
    await worker.fetch(request(PRICE_QUERY), ENV, ctx);

    assert.equal(fetchCalls.length, 1);
  });

  it('不同查詢會各自呼叫上游', async () => {
    const ctx = { waitUntil(promise) { return promise; } };

    await worker.fetch(request(PRICE_QUERY), ENV, ctx);
    await worker.fetch(request(CHIP_QUERY), ENV, ctx);

    assert.equal(fetchCalls.length, 2);
  });

  it('快取命中時不會沿用前一個來源的 CORS 標頭', async () => {
    const ctx = { waitUntil(promise) { return promise; } };

    await worker.fetch(request(PRICE_QUERY, { origin: ALLOWED_ORIGIN }), ENV, ctx);
    const second = await worker.fetch(request(PRICE_QUERY, { origin: LOCAL_ORIGIN }), ENV, ctx);

    assert.equal(second.headers.get('Access-Control-Allow-Origin'), LOCAL_ORIGIN);
  });

  it('快取命中時不會把 CORS 標頭給未允許的來源', async () => {
    const ctx = { waitUntil(promise) { return promise; } };

    await worker.fetch(request(PRICE_QUERY, { origin: ALLOWED_ORIGIN }), ENV, ctx);
    const second = await worker.fetch(
      request(PRICE_QUERY, { origin: 'https://evil.example.com' }),
      ENV,
      ctx,
    );

    assert.equal(second.headers.get('Access-Control-Allow-Origin'), null);
  });
});

describe('路由', () => {
  it('未知路徑回傳 404', async () => {
    const response = await worker.fetch(request(PRICE_QUERY, { path: '/api/anything' }), ENV, {
      waitUntil() {},
    });

    assert.equal(response.status, 404);
    assert.equal(fetchCalls.length, 0);
  });

  it('非 GET 方法回傳 405', async () => {
    const response = await worker.fetch(request(PRICE_QUERY, { method: 'POST' }), ENV, {
      waitUntil() {},
    });

    assert.equal(response.status, 405);
    assert.equal(fetchCalls.length, 0);
  });
});
