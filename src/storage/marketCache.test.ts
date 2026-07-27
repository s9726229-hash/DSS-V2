import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_NAME } from './database';
import { readCachedDataset, writeCachedDataset } from './marketCache';

const NOW = '2026-07-28T02:00:00.000Z';

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('writeCachedDataset', () => {
  it('保存原始回應與資料來源、交易日與擷取時間', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24', close: 105 }],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached).toMatchObject({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });
    expect(cached?.payload).toEqual([{ date: '2026-07-24', close: 105 }]);
  });

  it('同一股票的不同資料集各自保存', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24' }],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
      stockId: '0050',
      rows: [{ date: '2026-07-23' }],
      tradeDate: '2026-07-23',
      retrievedAt: NOW,
    });

    expect((await readCachedDataset('TaiwanStockPrice', '0050'))?.tradeDate).toBe('2026-07-24');
    expect(
      (await readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', '0050'))?.tradeDate,
    ).toBe('2026-07-23');
  });

  it('重新同步同一資料集會覆蓋為較新的內容', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24' }],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-25' }],
      tradeDate: '2026-07-25',
      retrievedAt: '2026-07-28T03:00:00.000Z',
    });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached?.tradeDate).toBe('2026-07-25');
    expect(cached?.payload).toEqual([{ date: '2026-07-25' }]);
  });

  it('空資料不覆寫既有的有效快取', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24' }],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });

    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [],
      tradeDate: null,
      retrievedAt: '2026-07-28T03:00:00.000Z',
    });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached?.payload).toEqual([{ date: '2026-07-24' }]);
    expect(cached?.tradeDate).toBe('2026-07-24');
  });

  it('沒有既有快取時，空資料仍會記錄以保留擷取時間', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockSplitPrice',
      stockId: '2330',
      rows: [],
      tradeDate: null,
      retrievedAt: NOW,
    });

    const cached = await readCachedDataset('TaiwanStockSplitPrice', '2330');

    expect(cached?.payload).toEqual([]);
    expect(cached?.retrievedAt).toBe(NOW);
  });
});

describe('readCachedDataset', () => {
  it('沒有快取時回傳 null', async () => {
    expect(await readCachedDataset('TaiwanStockPrice', '9999')).toBeNull();
  });
});
