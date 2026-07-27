import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportedHolding, ImportedTransaction } from '../import/types';
import { DATABASE_NAME, openDssDatabase } from './database';
import { readInventory } from './inventory';
import { importHoldingsSnapshot, importTransactions } from './portfolio';

const IMPORTED_AT = '2026-07-27T12:00:00.000Z';

function tx(overrides: Partial<ImportedTransaction> = {}): ImportedTransaction {
  return {
    tradeDate: '2026-03-02',
    stockId: '2330',
    stockName: '台積電',
    side: 'buy',
    tradeType: '現股',
    quantity: 1000,
    price: 1100,
    fees: 1567,
    tax: 0,
    settlementDate: '2026-03-04',
    brokerReference: 'X00000001',
    ...overrides,
  };
}

function holding(overrides: Partial<ImportedHolding> = {}): ImportedHolding {
  return {
    stockId: '0050',
    stockName: '元大台灣50',
    tradeType: '現股',
    quantity: 5999,
    costPrice: 101.1542,
    currentPrice: 105.8,
    ...overrides,
  };
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('readInventory', () => {
  it('資料庫全空時，各項都標示為未就緒', async () => {
    const inventory = await readInventory();

    expect(inventory.transactions).toEqual({ count: 0, firstDate: null, lastDate: null });
    expect(inventory.holdings).toEqual({ count: 0, snapshotDate: null });
    expect(inventory.marketCache).toEqual({ count: 0, lastRetrievedAt: null });
  });

  it('回報交易筆數與涵蓋的日期範圍', async () => {
    await importTransactions(
      [tx({ tradeDate: '2025-01-02' }), tx({ tradeDate: '2026-07-22' }), tx()],
      IMPORTED_AT,
    );

    const inventory = await readInventory();

    expect(inventory.transactions).toEqual({
      count: 3,
      firstDate: '2025-01-02',
      lastDate: '2026-07-22',
    });
  });

  it('回報最新一份庫存快照的檔數與日期', async () => {
    await importHoldingsSnapshot([holding()], '2026-07-26', IMPORTED_AT);
    await importHoldingsSnapshot(
      [holding({ stockId: '2330' }), holding({ stockId: '2317' })],
      '2026-07-27',
      IMPORTED_AT,
    );

    const inventory = await readInventory();

    expect(inventory.holdings).toEqual({ count: 2, snapshotDate: '2026-07-27' });
  });

  it('回報市場快取筆數與最後取得時間', async () => {
    const db = await openDssDatabase();
    await db.put('marketCache', {
      id: 'TaiwanStockPriceAdj:2330:2026-07-24',
      dataset: 'TaiwanStockPriceAdj',
      stockId: '2330',
      tradeDate: '2026-07-24',
      retrievedAt: '2026-07-24T08:00:00.000Z',
      payload: [],
    });
    await db.put('marketCache', {
      id: 'TaiwanStockPriceAdj:0050:2026-07-25',
      dataset: 'TaiwanStockPriceAdj',
      stockId: '0050',
      tradeDate: '2026-07-25',
      retrievedAt: '2026-07-25T08:00:00.000Z',
      payload: [],
    });
    db.close();

    const inventory = await readInventory();

    expect(inventory.marketCache).toEqual({
      count: 2,
      lastRetrievedAt: '2026-07-25T08:00:00.000Z',
    });
  });
});
