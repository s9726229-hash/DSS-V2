import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { readCachedDataset } from '../storage/marketCache';
import { importHoldingsSnapshot } from '../storage/portfolio';
import { syncHoldings } from './sync';

const NOW = new Date('2026-07-28T02:00:00.000Z');

function holding(stockId: string, stockName = '測試') {
  return { stockId, stockName, tradeType: '現股', quantity: 1000, costPrice: 100, currentPrice: 105 };
}

function successBody(data: unknown[]) {
  return new Response(JSON.stringify({ msg: 'success', status: 200, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PRICE_ROW = { date: '2026-07-24', stock_id: '0050', open: 1, max: 1, min: 1, close: 1, Trading_Volume: 100 };
const CHIP_ROW = { date: '2026-07-24', stock_id: '0050', name: 'Foreign_Investor', buy: 10, sell: 5 };

/** 依 dataset 回應不同內容，並記錄所有請求。 */
function stubFetch(handler?: (dataset: string, stockId: string) => Response) {
  const calls: { dataset: string; stockId: string; url: string }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input));
      const dataset = url.searchParams.get('dataset') as string;
      const stockId = url.searchParams.get('data_id') as string;
      calls.push({ dataset, stockId, url: String(input) });

      if (handler) return handler(dataset, stockId);
      return successBody(dataset === 'TaiwanStockPrice' ? [PRICE_ROW] : [CHIP_ROW]);
    }),
  );

  return calls;
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('沒有庫存時', () => {
  it('不發出任何網路請求', async () => {
    const calls = stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(calls).toHaveLength(0);
    expect(result.skippedReason).toBe('no-holdings');
    expect(result.results).toEqual([]);
  });
});

describe('有庫存時', () => {
  beforeEach(async () => {
    await importHoldingsSnapshot(
      [holding('0050', '元大台灣50'), holding('2330', '台積電')],
      '2026-07-28',
      NOW.toISOString(),
    );
  });

  it('每檔各取價格與法人兩個資料集', async () => {
    const calls = stubFetch();

    await syncHoldings({ now: NOW });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockPrice')).toHaveLength(2);
    expect(calls.filter((call) => call.dataset === 'TaiwanStockInstitutionalInvestorsBuySell')).toHaveLength(2);
  });

  it('價格請求近一年、法人請求近 20 天', async () => {
    const calls = stubFetch();

    await syncHoldings({ now: NOW });

    const price = new URL(calls.find((call) => call.dataset === 'TaiwanStockPrice')!.url);
    const chip = new URL(calls.find((call) => call.dataset !== 'TaiwanStockPrice')!.url);

    expect(price.searchParams.get('end_date')).toBe('2026-07-28');
    expect(price.searchParams.get('start_date')).toBe('2025-07-28');
    expect(chip.searchParams.get('start_date')).toBe('2026-07-08');
  });

  it('把原始回應寫入市場快取', async () => {
    stubFetch();

    await syncHoldings({ now: NOW });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');
    expect(cached?.payload).toEqual([PRICE_ROW]);
    expect(cached?.tradeDate).toBe('2026-07-24');
  });

  it('逐檔回報結果', async () => {
    stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ stockId: '0050', stockName: '元大台灣50', ok: true });
  });

  it('單一股票失敗不影響其他股票', async () => {
    stubFetch((dataset, stockId) => {
      if (stockId === '0050') {
        return new Response(JSON.stringify({ error: 'FinMind upstream error', upstreamStatus: 429 }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return successBody(dataset === 'TaiwanStockPrice' ? [PRICE_ROW] : [CHIP_ROW]);
    });

    const result = await syncHoldings({ now: NOW });

    const failed = result.results.find((row) => row.stockId === '0050');
    const succeeded = result.results.find((row) => row.stockId === '2330');

    expect(failed?.ok).toBe(false);
    expect(succeeded?.ok).toBe(true);
    expect(await readCachedDataset('TaiwanStockPrice', '2330')).not.toBeNull();
  });

  it('失敗時回報可讀的原因', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: 'FinMind service is not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const result = await syncHoldings({ now: NOW });

    expect(result.results[0].ok).toBe(false);
    if (result.results[0].ok) return;
    expect(result.results[0].message).toContain('憑證');
  });

  it('價格成功但法人失敗時仍保留價格結果，並註明法人未取得', async () => {
    stubFetch((dataset) => {
      if (dataset === 'TaiwanStockPrice') return successBody([PRICE_ROW]);
      return new Response(JSON.stringify({ error: 'FinMind upstream error', upstreamStatus: 429 }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await syncHoldings({ now: NOW });

    expect(await readCachedDataset('TaiwanStockPrice', '0050')).not.toBeNull();
    expect(result.results[0].ok).toBe(false);
    if (result.results[0].ok) return;
    expect(result.results[0].message).toContain('法人');
  });

  it('同一股票在快照中重複出現時只同步一次', async () => {
    await importHoldingsSnapshot(
      [holding('0050'), holding('0050'), holding('2330')],
      '2026-07-28',
      NOW.toISOString(),
    );
    const calls = stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockPrice')).toHaveLength(2);
    expect(result.results).toHaveLength(2);
  });

  it('回報本次同步時間', async () => {
    stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(result.syncedAt).toBe(NOW.toISOString());
  });

  it('逐檔完成時回報進度', async () => {
    stubFetch();
    const progress: string[] = [];

    await syncHoldings({ now: NOW, onProgress: (stockId) => progress.push(stockId) });

    expect(progress).toEqual(['0050', '2330']);
  });
});
