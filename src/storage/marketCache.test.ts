import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_NAME } from './database';
import { coversRange, readCachedDataset, writeCachedDataset } from './marketCache';

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

  it('不同期間的資料會合併，較早的歷史不被較新的請求洗掉', async () => {
    // 研究用的歷史區間與日常同步的近期區間必須共存
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2025-10-01' }, { date: '2025-10-02' }],
      tradeDate: '2025-10-02',
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24' }],
      tradeDate: '2026-07-24',
      retrievedAt: '2026-07-28T03:00:00.000Z',
    });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached?.payload).toEqual([
      { date: '2025-10-01' },
      { date: '2025-10-02' },
      { date: '2026-07-24' },
    ]);
    expect(cached?.tradeDate).toBe('2026-07-24');
  });

  it('同一天的資料以較新的請求為準，讓上游更正得以生效', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24', close: 100 }],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '0050',
      rows: [{ date: '2026-07-24', close: 105 }],
      tradeDate: '2026-07-24',
      retrievedAt: '2026-07-28T03:00:00.000Z',
    });

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached?.payload).toEqual([{ date: '2026-07-24', close: 105 }]);
  });

  it('法人資料同一天有多列時全部保留，不會互相覆蓋', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
      stockId: '0050',
      rows: [
        { date: '2026-07-24', name: 'Foreign_Investor', buy: 10, sell: 5 },
        { date: '2026-07-24', name: 'Investment_Trust', buy: 3, sell: 1 },
      ],
      tradeDate: '2026-07-24',
      retrievedAt: NOW,
    });

    const cached = await readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', '0050');

    expect(cached?.payload).toHaveLength(2);
  });

  it('合併後仍以最新的交易日為準', async () => {
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
      rows: [{ date: '2025-10-01' }],
      tradeDate: '2025-10-01',
      retrievedAt: '2026-07-28T03:00:00.000Z',
    });

    expect((await readCachedDataset('TaiwanStockPrice', '0050'))?.tradeDate).toBe('2026-07-24');
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

  it('成功的空回應仍會記錄已查詢範圍', async () => {
    await writeCachedDataset({
      dataset: 'TaiwanStockSplitPrice',
      stockId: '2330',
      rows: [],
      tradeDate: null,
      retrievedAt: NOW,
      coverage: { startDate: '2025-01-01', endDate: '2025-12-31' },
    });

    const cached = await readCachedDataset('TaiwanStockSplitPrice', '2330');

    expect(cached?.coverage).toEqual([{ startDate: '2025-01-01', endDate: '2025-12-31' }]);
    expect(coversRange(cached, '2025-03-01', '2025-08-31')).toBe(true);
  });

  it('合併重疊與相鄰的已查詢範圍', async () => {
    for (const coverage of [
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      { startDate: '2025-02-01', endDate: '2025-02-28' },
      { startDate: '2025-02-15', endDate: '2025-03-31' },
    ]) {
      await writeCachedDataset({
        dataset: 'TaiwanStockPrice',
        stockId: '0050',
        rows: [],
        tradeDate: null,
        retrievedAt: NOW,
        coverage,
      });
    }

    const cached = await readCachedDataset('TaiwanStockPrice', '0050');

    expect(cached?.coverage).toEqual([{ startDate: '2025-01-01', endDate: '2025-03-31' }]);
    expect(coversRange(cached, '2025-01-15', '2025-03-15')).toBe(true);
    expect(coversRange(cached, '2024-12-31', '2025-03-15')).toBe(false);
  });
});

describe('readCachedDataset', () => {
  it('沒有快取時回傳 null', async () => {
    expect(await readCachedDataset('TaiwanStockPrice', '9999')).toBeNull();
  });
});

describe('coversRange', () => {
  it('舊版快取沒有 coverage 時不視為已查詢', () => {
    expect(coversRange(null, '2025-01-01', '2025-01-31')).toBe(false);
    expect(
      coversRange(
        {
          id: 'TaiwanStockPrice:0050',
          dataset: 'TaiwanStockPrice',
          stockId: '0050',
          tradeDate: '2025-01-31',
          retrievedAt: NOW,
          payload: [],
        },
        '2025-01-01',
        '2025-01-31',
      ),
    ).toBe(false);
  });
});
