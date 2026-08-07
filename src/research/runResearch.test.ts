import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredTransaction } from '../storage/types';
import { DATABASE_NAME } from '../storage/database';
import { writeCachedDataset } from '../storage/marketCache';
import { buildResearchLedger, type ResearchLedger } from './positionLedger';
import { loadResearchEvents, researchMetricsFor, runResearch } from './runResearch';

const { loadResearchLedger } = vi.hoisted(() => ({
  loadResearchLedger: vi.fn<() => Promise<ResearchLedger>>(),
}));

vi.mock('./loadLedger', () => ({ loadResearchLedger }));

function trade(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: 'trade',
    importedAt: '2026-08-06T00:00:00.000Z',
    tradeDate: '2026-03-02',
    stockId: '2330',
    stockName: '測試公司',
    tradeMethod: '普通',
    tradeType: '現股',
    side: 'buy',
    quantity: 1000,
    price: 100,
    fees: 0,
    tax: 0,
    settlementDate: null,
    brokerReference: null,
    ...overrides,
  };
}

function ledger(transactions: StoredTransaction[]): ResearchLedger {
  return buildResearchLedger({
    transactions,
    splitsByStock: new Map(
      [...new Set(transactions.map((row) => row.stockId))].map((stockId) => [
        stockId,
        { status: 'available' as const, rows: [] },
      ]),
    ),
  });
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
  loadResearchLedger.mockReset();
});

describe('V2 研究情境指標', () => {
  it('只在加碼研究提供相對均價', () => {
    expect(researchMetricsFor('establish')).not.toContain('relativeCost');
    expect(researchMetricsFor('reentry')).not.toContain('relativeCost');
    expect(researchMetricsFor('add-on')).toContain('relativeCost');
  });
});

describe('V2 研究情境事件', () => {
  it('建立、加碼與再進場事件彼此不重複且排除研究期間前事件', async () => {
    loadResearchLedger.mockResolvedValue(
      ledger([
        trade({ id: 'old', tradeDate: '2025-12-30', stockId: '0050' }),
        trade({ id: 'establish', tradeDate: '2026-03-02' }),
        trade({ id: 'add-on', tradeDate: '2026-03-05', price: 90 }),
        trade({ id: 'exit', tradeDate: '2026-03-10', side: 'sell', quantity: 2000 }),
        trade({ id: 'reentry', tradeDate: '2026-04-01', price: 120 }),
      ]),
    );

    const establish = await loadResearchEvents('establish');
    const addOn = await loadResearchEvents('add-on');
    const reentry = await loadResearchEvents('reentry');
    const ids = [establish, addOn, reentry].map((events) =>
      events.flatMap((event) => event.transactionIds),
    );

    expect(ids).toEqual([['establish'], ['add-on'], ['reentry']]);
    expect(new Set(ids.flat()).size).toBe(3);
  });

  it('加碼使用帳本相對成本並保存排除品質摘要', async () => {
    loadResearchLedger.mockResolvedValue(
      ledger([
        trade({ id: 'establish', tradeDate: '2026-03-02', price: 100 }),
        trade({ id: 'add-on', tradeDate: '2026-03-05', price: 90 }),
        trade({ id: 'unknown-open', stockId: '0050', tradeDate: '2026-03-01', side: 'sell' }),
      ]),
    );

    const report = await runResearch('add-on');

    expect(report.samples.relativeCost).toMatchObject([
      { entryDate: '2026-03-05', stockId: '2330', metricValue: -10, complete: false },
    ]);
    expect(report.ledgerQuality.excludedByCode['opening-position-unknown']).toBe(1);
    expect(report.results.relativeCost?.stock.baseline).toBeDefined();
  });

  it('R1 後續結果使用還原後事件日收盤價，不使用成交價', async () => {
    loadResearchLedger.mockResolvedValue(
      ledger([
        trade({ id: 'establish', tradeDate: '2026-03-01', price: 100 }),
        trade({ id: 'add-on', tradeDate: '2026-03-02', price: 90 }),
      ]),
    );
    const prices = Array.from({ length: 21 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 2, 2 + index)).toISOString().slice(0, 10);
      const close = index === 0 ? 100 : 50;
      return { date, stock_id: '2330', open: close, max: close, min: close, close, Trading_Volume: 1 };
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '2330',
      rows: prices,
      tradeDate: prices.at(-1)!.date,
      retrievedAt: '2026-08-08T00:00:00.000Z',
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockDividendResult',
      stockId: '2330',
      rows: [
        { date: '2026-03-03', stock_id: '2330', before_price: 100, after_price: 50 },
      ],
      tradeDate: '2026-03-03',
      retrievedAt: '2026-08-08T00:00:00.000Z',
    });

    const report = await runResearch('add-on');

    expect(report.samples.relativeCost?.[0]).toMatchObject({ complete: true, returnPercent: 0 });
  });
});
