import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import worker from './index.js';

const TOKEN = 'usage-token-must-never-leak';
const ENV = { FINMIND_TOKEN: TOKEN };
const USAGE_PATH = '/api/finmind/usage';
const ALLOWED_ORIGIN = 'https://s9726229-hash.github.io';

let fetchCalls = [];
let originalFetch;

function request({ origin, method = 'GET', query = '' } = {}) {
  return new Request(`https://worker.test${USAGE_PATH}${query}`, {
    method,
    headers: origin ? { Origin: origin } : {},
  });
}

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

/** FinMind 的 user_info 實際回傳形狀。 */
const okUpstream = () =>
  new Response(
    JSON.stringify({ msg: 'success', status: 200, user_count: 137, api_request_limit: 600 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

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

describe('用量查詢', () => {
  it('回傳已用次數與上限', async () => {
    const response = await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { used: 137, limit: 600 });
  });

  it('以 Bearer 標頭帶上 token，且打的是 user_info 端點', async () => {
    await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://api.web.finmindtrade.com/v2/user_info');
    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  });

  /** 與資料閘道同一條規矩：不轉述上游本體，避免夾帶 token 或內部訊息。 */
  it('回應只有兩個數字，不含上游原文', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            msg: `internal note ${TOKEN}`,
            status: 200,
            user_count: 5,
            api_request_limit: 600,
            secret_field: 'should not appear',
          }),
          { status: 200 },
        ),
    );

    const response = await worker.fetch(request(), ENV, { waitUntil() {} });
    const text = await response.text();

    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes('secret_field'), false);
    assert.deepEqual(JSON.parse(text), { used: 5, limit: 600 });
  });

  it('沒有設定 token 時回 503 並區分未設定與空白', async () => {
    const missing = await worker.fetch(request(), {}, { waitUntil() {} });
    const blank = await worker.fetch(request(), { FINMIND_TOKEN: '   ' }, { waitUntil() {} });

    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).detail, 'missing');
    assert.equal(blank.status, 503);
    assert.equal((await blank.json()).detail, 'blank');
  });

  it('上游 HTTP 錯誤回 502 並附狀態碼', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));

    const response = await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(response.status, 502);
    assert.equal((await response.json()).upstreamStatus, 500);
  });

  /** FinMind 會以 HTTP 200 夾帶錯誤狀態，只看 HTTP 狀態會把錯誤當成資料。 */
  it('HTTP 200 但本體宣告非 200 時視為錯誤', async () => {
    stubFetch(() => new Response(JSON.stringify({ msg: '請提供 token', status: 400 }), { status: 200 }));

    const response = await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(response.status, 502);
    assert.equal((await response.json()).upstreamStatus, 400);
  });

  it('缺少欄位或欄位不是數字時回 502，不回傳 null 或 NaN', async () => {
    for (const payload of [
      { msg: 'success', status: 200 },
      { msg: 'success', status: 200, user_count: 'many', api_request_limit: 600 },
      { msg: 'success', status: 200, user_count: 10 },
    ]) {
      stubFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
      const response = await worker.fetch(request(), ENV, { waitUntil() {} });
      assert.equal(response.status, 502, JSON.stringify(payload));
    }
  });

  it('回應無法解析為 JSON 時回 502', async () => {
    stubFetch(() => new Response('<html>maintenance</html>', { status: 200 }));

    const response = await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(response.status, 502);
  });

  /** 用量查詢本身是否計入額度未知，因此快取以保護額度為前提。 */
  it('短時間內重複查詢不會重複呼叫上游', async () => {
    await worker.fetch(request(), ENV, { waitUntil() {} });
    await worker.fetch(request(), ENV, { waitUntil() {} });

    assert.equal(fetchCalls.length, 1);
  });

  it('允許的來源取得 CORS 標頭', async () => {
    const response = await worker.fetch(request({ origin: ALLOWED_ORIGIN }), ENV, {
      waitUntil() {},
    });

    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  });

  it('未允許的來源拿不到 CORS 標頭', async () => {
    const response = await worker.fetch(request({ origin: 'https://evil.test' }), ENV, {
      waitUntil() {},
    });

    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('非 GET 方法回 405', async () => {
    const response = await worker.fetch(request({ method: 'POST' }), ENV, { waitUntil() {} });

    assert.equal(response.status, 405);
  });

  it('OPTIONS 預檢回 204', async () => {
    const response = await worker.fetch(
      request({ method: 'OPTIONS', origin: ALLOWED_ORIGIN }),
      ENV,
      { waitUntil() {} },
    );

    assert.equal(response.status, 204);
  });

  it('帶了查詢參數就拒絕，這支端點不接受任何參數', async () => {
    const response = await worker.fetch(request({ query: '?dataset=TaiwanStockPrice' }), ENV, {
      waitUntil() {},
    });

    assert.equal(response.status, 400);
    assert.equal(fetchCalls.length, 0);
  });
});
