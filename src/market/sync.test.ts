import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { addWatch, emptyWatchlist } from '../watchlist/watchlist';
import { readWatchlist, writeWatchlist } from '../watchlist/watchlistStore';
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

describe('庫存與觀察清單都是空的時候', () => {
  it('不發出任何網路請求', async () => {
    const calls = stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(calls).toHaveLength(0);
    expect(result.skippedReason).toBe('nothing-to-sync');
    expect(result.results).toEqual([]);
  });
});

describe('只有觀察清單、沒有庫存時', () => {
  /**
   * 規格原本寫「沒有庫存時不可發出請求」，那時還沒有觀察清單。
   * 觀察股同樣需要價格與法人資料，否則卡片永遠是資料不足；
   * 真正該守的是「沒有任何要看的標的就不要連網」。
   */
  it('仍會同步觀察中的股票', async () => {
    await writeWatchlist(
      addWatch(emptyWatchlist(), { stockId: '2454', stockName: '聯發科', at: NOW.toISOString() }),
    );
    stubFetch();

    const result = await syncHoldings({ now: NOW });

    expect(result.skippedReason).toBeNull();
    expect(result.results.map((row) => row.stockId)).toEqual(['2454']);
  });
});

describe('觀察標的的名稱', () => {
  const at = NOW.toISOString();

  /** 名稱等於代號代表使用者加入時留空。 */
  async function watching(stockId: string, stockName: string) {
    await writeWatchlist(addWatch(emptyWatchlist(), { stockId, stockName, at }));
  }

  it('只有代號時向 TaiwanStockInfo 補回名稱', async () => {
    await watching('2330', '2330');
    stubFetch((dataset) =>
      successBody(
        dataset === 'TaiwanStockInfo' ? [{ stock_id: '2330', stock_name: '台積電' }] : [PRICE_ROW],
      ),
    );

    const result = await syncHoldings({ now: NOW });

    expect(result.namedCount).toBe(1);
    expect((await readWatchlist()).entries[0].stockName).toBe('台積電');
  });

  it('已經有名稱時完全不問，不浪費額度', async () => {
    await watching('2454', '聯發科');
    const calls = stubFetch();

    await syncHoldings({ now: NOW });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockInfo')).toHaveLength(0);
  });

  /*
   * 斷線或限流時如果標成查無此代號，使用者會看到自己明明打對的代號被指為打錯，
   * 而且從此不再重試。只有真的問到回應才判定。
   */
  it('查詢失敗時不標記查無此代號，下次同步會再試', async () => {
    await watching('2330', '2330');
    stubFetch((dataset) =>
      dataset === 'TaiwanStockInfo'
        ? new Response(JSON.stringify({ error: 'rate limited', upstreamStatus: 402 }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          })
        : successBody([PRICE_ROW]),
    );

    const result = await syncHoldings({ now: NOW });
    const entry = (await readWatchlist()).entries[0];

    expect(result.namedCount).toBe(0);
    expect(entry.nameNotFound).toBeUndefined();
    expect(entry.stockName).toBe('2330');
  });

  it('確實查無此代號時記下來，之後不再重複詢問', async () => {
    await watching('9999', '9999');
    const calls = stubFetch((dataset) => successBody(dataset === 'TaiwanStockInfo' ? [] : [PRICE_ROW]));

    await syncHoldings({ now: NOW });

    expect((await readWatchlist()).entries[0].nameNotFound).toBe(true);

    await syncHoldings({ now: NOW, force: true });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockInfo')).toHaveLength(1);
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

  it('庫存與觀察清單重疊的股票只同步一次', async () => {
    await writeWatchlist(
      addWatch(
        addWatch(emptyWatchlist(), { stockId: '2330', stockName: '台積電', at: NOW.toISOString() }),
        { stockId: '2454', stockName: '聯發科', at: NOW.toISOString() },
      ),
    );
    stubFetch();

    const result = await syncHoldings({ now: NOW });
    const ids = result.results.map((row) => row.stockId);

    expect(ids).toEqual(['0050', '2330', '2454']);
    expect(ids.filter((id) => id === '2330')).toHaveLength(1);
  });

  it('每檔各取價格與法人兩個資料集', async () => {
    const calls = stubFetch();

    await syncHoldings({ now: NOW });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockPrice')).toHaveLength(2);
    expect(calls.filter((call) => call.dataset === 'TaiwanStockInstitutionalInvestorsBuySell')).toHaveLength(2);
  });

  it('價格請求近一年、法人請求近 45 天', async () => {
    const calls = stubFetch();

    await syncHoldings({ now: NOW });

    const price = new URL(calls.find((call) => call.dataset === 'TaiwanStockPrice')!.url);
    const chip = new URL(calls.find((call) => call.dataset !== 'TaiwanStockPrice')!.url);

    expect(price.searchParams.get('end_date')).toBe('2026-07-28');
    expect(price.searchParams.get('start_date')).toBe('2025-07-28');
    // 方向判斷要拿今日與前五日比，走勢圖還要更長，因此取閘道允許的上限
    expect(chip.searchParams.get('start_date')).toBe('2026-06-13');
  });

  it('把原始回應寫入市場快取', async () => {
    stubFetch();

    await syncHoldings({ now: NOW });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');
    expect(cached?.payload).toEqual([PRICE_ROW]);
    expect(cached?.tradeDate).toBe('2026-07-24');
    expect(cached?.coverage).toEqual([
      { startDate: '2025-07-28', endDate: '2026-07-28' },
    ]);
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

  it('四小時內已抓過的個股直接跳過，不重複請求', async () => {
    stubFetch();
    await syncHoldings({ now: NOW });

    const calls = stubFetch();
    const result = await syncHoldings({ now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });

    expect(calls).toHaveLength(0);
    expect(result.results.every((row) => row.ok && row.skipped)).toBe(true);
    expect(result.skippedCount).toBe(2);
  });

  it('超過四小時後會重新抓取', async () => {
    stubFetch();
    await syncHoldings({ now: NOW });

    const calls = stubFetch();
    await syncHoldings({ now: new Date(NOW.getTime() + 5 * 60 * 60 * 1000) });

    expect(calls.length).toBeGreaterThan(0);
  });

  it('強制重新抓取時忽略新鮮度', async () => {
    stubFetch();
    await syncHoldings({ now: NOW });

    const calls = stubFetch();
    const result = await syncHoldings({ now: NOW, force: true });

    expect(calls.filter((call) => call.dataset === 'TaiwanStockPrice')).toHaveLength(2);
    expect(result.skippedCount).toBe(0);
  });

  it('先前失敗而沒有快取的個股不會被當成已是最新', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: 'FinMind upstream error', upstreamStatus: 429 }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await syncHoldings({ now: NOW });

    const calls = stubFetch();
    await syncHoldings({ now: new Date(NOW.getTime() + 60_000) });

    expect(calls.length).toBeGreaterThan(0);
  });

  it('逐檔完成時回報進度', async () => {
    stubFetch();
    const progress: string[] = [];

    await syncHoldings({ now: NOW, onProgress: (stockId) => progress.push(stockId) });

    expect(progress).toEqual(['0050', '2330']);
  });
});
