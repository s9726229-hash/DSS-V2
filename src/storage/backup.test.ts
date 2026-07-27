import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportedTransaction } from '../import/types';
import { createBackup, createLightweightBackup, restoreBackup } from './backup';
import { DATABASE_NAME, openDssDatabase } from './database';
import { importHoldingsSnapshot, importTransactions, readTransactions } from './portfolio';
import type { BackupPayload, MarketCacheRecord } from './types';

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

async function seedSetting(key: string, value: unknown): Promise<void> {
  const db = await openDssDatabase();
  await db.put('settings', { key, value });
  db.close();
}

async function seedMarketCache(): Promise<MarketCacheRecord> {
  const record: MarketCacheRecord = {
    id: 'TaiwanStockPriceAdj:2330:2026-07-24',
    dataset: 'TaiwanStockPriceAdj',
    stockId: '2330',
    tradeDate: '2026-07-24',
    retrievedAt: IMPORTED_AT,
    payload: [{ date: '2026-07-24', close: 1145 }],
  };

  const db = await openDssDatabase();
  await db.put('marketCache', record);
  db.close();

  return record;
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('createBackup', () => {
  it('完整備份包含交易、庫存快照、設定與市場快取', async () => {
    await importTransactions([tx()], IMPORTED_AT);
    await importHoldingsSnapshot(
      [
        {
          stockId: '0050',
          stockName: '元大台灣50',
          tradeType: '現股',
          quantity: 5999,
          costPrice: 101.1542,
          currentPrice: 105.8,
        },
      ],
      '2026-07-27',
      IMPORTED_AT,
    );
    await seedSetting('theme', 'dark');
    await seedMarketCache();

    const backup = await createBackup();

    expect(backup.version).toBe(1);
    expect(backup.transactions).toHaveLength(1);
    expect(backup.holdingsSnapshots).toHaveLength(1);
    expect(backup.settings).toEqual([{ key: 'theme', value: 'dark' }]);
    expect(backup.marketCache).toHaveLength(1);
  });

  it('備份檔不得包含任何 token 或密鑰設定', async () => {
    await seedSetting('theme', 'dark');
    await seedSetting('finmindToken', 'should-never-be-exported');
    await seedSetting('apiSecret', 'should-never-be-exported');

    const backup = await createBackup();

    expect(backup.settings).toEqual([{ key: 'theme', value: 'dark' }]);
    expect(JSON.stringify(backup)).not.toContain('should-never-be-exported');
  });
});

describe('createLightweightBackup', () => {
  it('輕量備份不含市場快取，但保留交易與設定', async () => {
    await importTransactions([tx()], IMPORTED_AT);
    await seedSetting('theme', 'dark');
    await seedMarketCache();

    const backup = await createLightweightBackup();

    expect(backup.transactions).toHaveLength(1);
    expect(backup.settings).toHaveLength(1);
    expect('marketCache' in backup).toBe(false);
  });
});

describe('restoreBackup', () => {
  it('還原完整備份後可讀回交易資料', async () => {
    await importTransactions([tx(), tx({ stockId: '0050' })], IMPORTED_AT);
    const backup = await createBackup();
    await deleteDB(DATABASE_NAME);

    const result = await restoreBackup(backup);

    expect(result.ok).toBe(true);
    expect(await readTransactions()).toHaveLength(2);
  });

  it('還原會取代既有資料，不與舊資料混合', async () => {
    await importTransactions([tx()], IMPORTED_AT);
    const backup = await createBackup();

    await importTransactions([tx({ tradeDate: '2026-05-05' })], IMPORTED_AT);
    expect(await readTransactions()).toHaveLength(2);

    await restoreBackup(backup);

    expect(await readTransactions()).toHaveLength(1);
  });

  it('還原輕量備份時保留既有的市場快取', async () => {
    await importTransactions([tx()], IMPORTED_AT);
    await seedMarketCache();
    const lightweight = await createLightweightBackup();

    await restoreBackup(lightweight);

    const db = await openDssDatabase();
    const cache = await db.getAll('marketCache');
    db.close();
    expect(cache).toHaveLength(1);
  });

  it('拒絕版本不符的備份檔並說明原因', async () => {
    const result = await restoreBackup({ ...({} as BackupPayload), version: 99 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('版本');
  });

  it('拒絕結構不正確的檔案並說明原因', async () => {
    const result = await restoreBackup({ version: 1, transactions: '不是陣列' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('格式');
  });

  it('拒絕非物件的輸入', async () => {
    expect((await restoreBackup(null)).ok).toBe(false);
    expect((await restoreBackup('文字')).ok).toBe(false);
  });
});
