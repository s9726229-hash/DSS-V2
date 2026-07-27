import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportedHolding, ImportedTransaction } from '../import/types';
import { DATABASE_NAME, openDssDatabase } from './database';
import {
  importHoldingsSnapshot,
  importTransactions,
  planTransactionImport,
  readHoldingsSnapshot,
  readTransactions,
} from './portfolio';

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

describe('importTransactions', () => {
  it('首次匯入寫入全部交易', async () => {
    const result = await importTransactions([tx(), tx({ stockId: '0050' })], IMPORTED_AT);

    expect(result).toEqual({ inserted: 2, duplicateCount: 0 });
    expect(await readTransactions()).toHaveLength(2);
  });

  it('重複匯入同一份檔案不會新增任何資料', async () => {
    const rows = [tx(), tx({ stockId: '0050' })];
    await importTransactions(rows, IMPORTED_AT);

    const second = await importTransactions(rows, IMPORTED_AT);

    expect(second).toEqual({ inserted: 0, duplicateCount: 2 });
    expect(await readTransactions()).toHaveLength(2);
  });

  it('匯入涵蓋舊資料的完整歷史檔時只補進新增的部分', async () => {
    await importTransactions([tx()], IMPORTED_AT);

    const result = await importTransactions([tx(), tx({ tradeDate: '2026-03-05' })], IMPORTED_AT);

    expect(result).toEqual({ inserted: 1, duplicateCount: 1 });
    expect(await readTransactions()).toHaveLength(2);
  });

  it('委託書號被不同交易重複使用時，兩筆都必須保留', async () => {
    // 實際券商資料中委託書號會循環重複使用，不是唯一識別碼
    const recycledReference = 'X00000000';
    const first = tx({
      tradeDate: '2026-01-05',
      stockId: '9990',
      quantity: 2000,
      price: 21.11,
      brokerReference: recycledReference,
    });
    const second = tx({
      tradeDate: '2026-06-08',
      stockId: '9991',
      side: 'sell',
      quantity: 1000,
      price: 104,
      brokerReference: recycledReference,
    });

    const result = await importTransactions([first, second], IMPORTED_AT);

    expect(result.inserted).toBe(2);
    const stored = await readTransactions();
    expect(stored.map((row) => row.stockId).sort()).toEqual(['9990', '9991']);
  });

  it('同一天內容完全相同的分次成交必須全部保留', async () => {
    // 一筆委託分次成交，日期、股票、數量、價格皆相同
    const result = await importTransactions([tx(), tx(), tx()], IMPORTED_AT);

    expect(result.inserted).toBe(3);
    expect(await readTransactions()).toHaveLength(3);
  });

  it('分次成交在重複匯入時不會被重覆累加', async () => {
    await importTransactions([tx(), tx(), tx()], IMPORTED_AT);

    const second = await importTransactions([tx(), tx(), tx()], IMPORTED_AT);

    expect(second).toEqual({ inserted: 0, duplicateCount: 3 });
    expect(await readTransactions()).toHaveLength(3);
  });

  it('分次成交筆數增加時只補進差額', async () => {
    await importTransactions([tx(), tx()], IMPORTED_AT);

    const second = await importTransactions([tx(), tx(), tx()], IMPORTED_AT);

    expect(second).toEqual({ inserted: 1, duplicateCount: 2 });
    expect(await readTransactions()).toHaveLength(3);
  });

  it('同一筆交易在不同匯出檔的委託書號長度不同時，仍判定為重複', async () => {
    // 完整歷史檔匯出 X00000001，月份明細檔把同一筆截斷成較短的號碼
    await importTransactions([tx({ brokerReference: 'X00000001' })], IMPORTED_AT);

    const second = await importTransactions([tx({ brokerReference: 'X0000' })], IMPORTED_AT);

    expect(second).toEqual({ inserted: 0, duplicateCount: 1 });
    expect(await readTransactions()).toHaveLength(1);
  });

  it('保留交易類別，使現沖交易可與現股區分', async () => {
    await importTransactions([tx({ tradeType: '現沖' })], IMPORTED_AT);

    expect((await readTransactions())[0].tradeType).toBe('現沖');
  });
});

describe('planTransactionImport', () => {
  it('預覽時回報將新增與將略過的筆數，且不寫入資料庫', async () => {
    await importTransactions([tx()], IMPORTED_AT);

    const plan = await planTransactionImport([tx(), tx({ tradeDate: '2026-03-05' })]);

    expect(plan).toEqual({ newCount: 1, duplicateCount: 1 });
    expect(await readTransactions()).toHaveLength(1);
  });
});

describe('importHoldingsSnapshot', () => {
  it('寫入指定日期的庫存快照', async () => {
    await importHoldingsSnapshot([holding(), holding({ stockId: '2330' })], '2026-07-27', IMPORTED_AT);

    const stored = await readHoldingsSnapshot('2026-07-27');
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ snapshotDate: '2026-07-27', importedAt: IMPORTED_AT });
  });

  it('同日期再次匯入會整份取代，不殘留已賣出的個股', async () => {
    await importHoldingsSnapshot([holding(), holding({ stockId: '2330' })], '2026-07-27', IMPORTED_AT);

    await importHoldingsSnapshot([holding()], '2026-07-27', IMPORTED_AT);

    const stored = await readHoldingsSnapshot('2026-07-27');
    expect(stored).toHaveLength(1);
    expect(stored[0].stockId).toBe('0050');
  });

  it('不同日期的快照各自獨立保存', async () => {
    await importHoldingsSnapshot([holding()], '2026-07-26', IMPORTED_AT);
    await importHoldingsSnapshot([holding({ stockId: '2330' })], '2026-07-27', IMPORTED_AT);

    expect(await readHoldingsSnapshot('2026-07-26')).toHaveLength(1);
    expect(await readHoldingsSnapshot('2026-07-27')).toHaveLength(1);
  });
});

describe('readHoldingsSnapshot', () => {
  it('未指定日期時回傳最新一份快照', async () => {
    await importHoldingsSnapshot([holding()], '2026-07-26', IMPORTED_AT);
    await importHoldingsSnapshot(
      [holding({ stockId: '2330' }), holding({ stockId: '2317' })],
      '2026-07-27',
      IMPORTED_AT,
    );

    const latest = await readHoldingsSnapshot();

    expect(latest).toHaveLength(2);
    expect(latest.every((row) => row.snapshotDate === '2026-07-27')).toBe(true);
  });

  it('沒有任何快照時回傳空陣列', async () => {
    expect(await readHoldingsSnapshot()).toEqual([]);
  });
});

describe('資料庫結構', () => {
  it('建立四個資料表', async () => {
    const db = await openDssDatabase();
    const names = [...db.objectStoreNames].sort();
    db.close();

    expect(names).toEqual(['holdingsSnapshots', 'marketCache', 'settings', 'transactions']);
  });
});
