import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { readCachedDataset } from '../storage/marketCache';
import { backfillResearchData, planBackfill } from './backfill';
import type { PositionEvent } from './positions';

const NOW = new Date('2026-07-28T02:00:00.000Z');

function entry(stockId: string, tradeDate: string): PositionEvent {
  return {
    transactionId: `${stockId}-${tradeDate}`,
    tradeDate,
    stockId,
    stockName: '測試',
    tradeType: '現股',
    kind: 'entry',
    isReentry: false,
    quantity: 1000,
    price: 100,
    positionAfter: 1000,
  };
}

function stubFetch() {
  const calls: { dataset: string; stockId: string; start: string; end: string }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input));
      calls.push({
        dataset: url.searchParams.get('dataset') as string,
        stockId: url.searchParams.get('data_id') as string,
        start: url.searchParams.get('start_date') as string,
        end: url.searchParams.get('end_date') as string,
      });

      return new Response(
        JSON.stringify({ msg: 'success', status: 200, data: [{ date: '2026-01-02', close: 1 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
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

describe('planBackfill', () => {
  it('沒有建立部位時不產生任何請求計畫', () => {
    expect(planBackfill([], NOW)).toEqual([]);
  });

  it('價格區間往前涵蓋均線所需資料，往後涵蓋驗證窗', () => {
    const plan = planBackfill([entry('2330', '2026-03-02')], NOW);
    const price = plan.find((item) => item.dataset === 'TaiwanStockPrice');

    expect(price?.startDate).toBe('2025-11-02');
    expect(price?.endDate).toBe('2026-06-10');
  });

  it('價格結束日不超過今天', () => {
    const plan = planBackfill([entry('2330', '2026-07-15')], NOW);
    const price = plan.find((item) => item.dataset === 'TaiwanStockPrice');

    expect(price?.endDate).toBe('2026-07-28');
  });

  it('同一股票多筆建立部位合併為一段價格區間', () => {
    const plan = planBackfill(
      [entry('2330', '2026-01-02'), entry('2330', '2026-05-02')],
      NOW,
    );
    const prices = plan.filter((item) => item.dataset === 'TaiwanStockPrice');

    expect(prices).toHaveLength(1);
    expect(prices[0].startDate).toBe('2025-09-04');
  });

  it('價格區間不超過 Worker 的 400 天上限', () => {
    const plan = planBackfill(
      [entry('2330', '2026-01-02'), entry('2330', '2026-07-15')],
      NOW,
    );

    for (const item of plan) {
      const days = (Date.parse(item.endDate) - Date.parse(item.startDate)) / 86_400_000;
      expect(days).toBeLessThanOrEqual(400);
    }
  });

  it('法人資料依建立部位日期切成不超過 45 天的區段', () => {
    const plan = planBackfill(
      [entry('2330', '2026-01-02'), entry('2330', '2026-07-15')],
      NOW,
    );
    const chips = plan.filter(
      (item) => item.dataset === 'TaiwanStockInstitutionalInvestorsBuySell',
    );

    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chips) {
      const days = (Date.parse(chunk.endDate) - Date.parse(chunk.startDate)) / 86_400_000;
      expect(days).toBeLessThanOrEqual(45);
    }
  });

  it('相近的建立部位共用同一段法人區間，不重複請求', () => {
    const plan = planBackfill(
      [entry('2330', '2026-03-02'), entry('2330', '2026-03-10')],
      NOW,
    );
    const chips = plan.filter(
      (item) => item.dataset === 'TaiwanStockInstitutionalInvestorsBuySell',
    );

    expect(chips).toHaveLength(1);
  });

  it('法人區間往前涵蓋五日籌碼所需的交易日', () => {
    const plan = planBackfill([entry('2330', '2026-03-02')], NOW);
    const chip = plan.find(
      (item) => item.dataset === 'TaiwanStockInstitutionalInvestorsBuySell',
    );

    expect(Date.parse(chip!.startDate)).toBeLessThan(Date.parse('2026-03-02'));
  });

  it('不同股票各自規劃', () => {
    const plan = planBackfill([entry('2330', '2026-03-02'), entry('0050', '2026-03-02')], NOW);

    expect(new Set(plan.map((item) => item.stockId))).toEqual(new Set(['2330', '0050']));
  });
});

describe('backfillResearchData', () => {
  it('依計畫請求並寫入快取', async () => {
    const calls = stubFetch();

    const result = await backfillResearchData([entry('2330', '2026-03-02')], { now: NOW });

    expect(calls.length).toBeGreaterThan(0);
    expect(await readCachedDataset('TaiwanStockPrice', '2330')).not.toBeNull();
    expect(result.failures).toEqual([]);
  });

  it('沒有建立部位時不發出任何請求', async () => {
    const calls = stubFetch();

    const result = await backfillResearchData([], { now: NOW });

    expect(calls).toHaveLength(0);
    expect(result.completed).toBe(0);
  });

  it('單一請求失敗不中斷其他請求，並回報失敗項目', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(String(input));
        if (url.searchParams.get('data_id') === '2330') {
          return new Response(
            JSON.stringify({ error: 'FinMind upstream error', upstreamStatus: 429 }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ msg: 'success', status: 200, data: [{ date: '2026-01-02' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const result = await backfillResearchData(
      [entry('2330', '2026-03-02'), entry('0050', '2026-03-02')],
      { now: NOW },
    );

    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.every((failure) => failure.stockId === '2330')).toBe(true);
    expect(await readCachedDataset('TaiwanStockPrice', '0050')).not.toBeNull();
  });

  it('回報進度供畫面顯示', async () => {
    stubFetch();
    const progress: number[] = [];

    await backfillResearchData([entry('2330', '2026-03-02')], {
      now: NOW,
      onProgress: (done, total) => progress.push(done / total),
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
