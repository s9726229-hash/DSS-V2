import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedTransaction } from '../import/types';
import { DATABASE_NAME } from '../storage/database';
import { writeCachedDataset } from '../storage/marketCache';
import { importTransactions } from '../storage/portfolio';
import { loadResearchLedger, prepareResearchLedgerData } from './loadLedger';

const NOW = new Date('2026-08-08T00:00:00.000Z');

function trade(stockId: string, tradeDate: string): ImportedTransaction {
  return {
    tradeDate,
    stockId,
    stockName: `測試 ${stockId}`,
    side: 'buy',
    tradeMethod: '普通',
    tradeType: '現股',
    quantity: 1000,
    price: 100,
    fees: 0,
    tax: 0,
    settlementDate: null,
    brokerReference: null,
  };
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
  await importTransactions(
    [trade('2330', '2025-01-02'), trade('2330', '2026-03-02'), trade('0050', '2026-01-05')],
    NOW.toISOString(),
  );
  await writeCachedDataset({
    dataset: 'TaiwanStockSplitPrice',
    stockId: '2330',
    rows: [],
    tradeDate: null,
    retrievedAt: NOW.toISOString(),
    coverage: { startDate: '2025-01-02', endDate: '2026-03-02' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadResearchLedger', () => {
  it('只有拆股查詢範圍未驗證的股票標記缺漏', async () => {
    const ledger = await loadResearchLedger();

    expect(ledger.stockStatus.get('2330')).toBe('reliable');
    expect(ledger.stockStatus.get('0050')).toBe('split-missing');
    expect(ledger.excludedByCode['split-data-missing']).toBe(1);
  });
});

describe('prepareResearchLedgerData', () => {
  it('成功取得空拆股結果後也會讓帳本成為可靠狀態', async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        calls.push(new URL(String(input)));
        return new Response(JSON.stringify({ status: 200, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const result = await prepareResearchLedgerData({ now: NOW });
    const ledger = await loadResearchLedger();

    expect(result.failures).toEqual([]);
    expect(calls.every((url) => url.searchParams.get('dataset') === 'TaiwanStockSplitPrice')).toBe(
      true,
    );
    expect(calls.every((url) => {
      const days =
        (Date.parse(url.searchParams.get('end_date')!) -
          Date.parse(url.searchParams.get('start_date')!)) /
        86_400_000;
      return days <= 400;
    })).toBe(true);
    expect(ledger.stockStatus.get('0050')).toBe('reliable');
  });

  it('失敗的拆股請求不會被標記為已驗證', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'rate limited', upstreamStatus: 402 }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const result = await prepareResearchLedgerData({ now: NOW });

    expect(result.failures.map((failure) => failure.stockId)).toContain('0050');
    expect((await loadResearchLedger()).stockStatus.get('0050')).toBe('split-missing');
  });
});
