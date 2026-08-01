import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDatasetUrl, fetchDataset } from './finmindClient';

const RANGE = { startDate: '2026-01-01', endDate: '2026-01-05' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildDatasetUrl', () => {
  it('組出 Worker 的查詢網址', () => {
    const url = buildDatasetUrl('TaiwanStockPrice', '0050', RANGE);

    expect(url).toContain('/api/finmind/data');
    expect(url).toContain('dataset=TaiwanStockPrice');
    expect(url).toContain('data_id=0050');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-05');
  });

  it('網址不含任何憑證參數', () => {
    const url = buildDatasetUrl('TaiwanStockPrice', '0050', RANGE);

    expect(url).not.toMatch(/token|key|secret/i);
  });
});

describe('fetchDataset', () => {
  it('成功時回傳資料列', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ msg: 'success', status: 200, data: [{ date: '2026-01-02', close: 100 }] }),
      ),
    );

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });

  it('資料為空時仍算成功，但回傳空陣列', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ msg: 'success', status: 200, data: [] })),
    );

    const result = await fetchDataset('TaiwanStockSplitPrice', '2330', RANGE);

    expect(result).toEqual({ ok: true, rows: [] });
  });

  it('Worker 回 503 時說明尚未設定憑證', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'FinMind service is not configured' }, 503)),
    );

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-configured');
  });

  it('上游 400 時判定為帳號權限不足', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: 'FinMind upstream error', upstreamStatus: 400 }, 502),
      ),
    );

    const result = await fetchDataset('TaiwanStockPriceAdj', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('upstream-forbidden');
    expect(result.message).toContain('權限');
  });

  it('上游 429 時判定為請求次數受限', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: 'FinMind upstream error', upstreamStatus: 429 }, 502),
      ),
    );

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('upstream-rate-limited');
  });

  /** FinMind 額度用完回的是 402，不是 429；漏掉會顯示成服務故障，讓人去查錯地方。 */
  it('上游 402 時判定為請求次數受限', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: 'FinMind upstream error', upstreamStatus: 402 }, 502),
      ),
    );

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('upstream-rate-limited');
    expect(result.message).toContain('上限');
  });

  it('請求參數被 Worker 拒絕時回報 invalid-request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unknown dataset' }, 400)));

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-request');
  });

  it('連線失敗時回報 network-error 而非拋出例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network-error');
  });

  it('回應不是預期結構時回報 malformed-response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ unexpected: true })));

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed-response');
  });

  it('回應宣告的 status 不是 200 時不當成資料', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ msg: 'Your level is free.', status: 400, data: [] })),
    );

    const result = await fetchDataset('TaiwanStockPriceAdj', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('upstream-forbidden');
  });

  it('失敗訊息不含 Worker 內部網址', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)));

    const result = await fetchDataset('TaiwanStockPrice', '0050', RANGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain('workers.dev');
  });
});
