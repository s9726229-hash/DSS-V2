import { describe, expect, it } from 'vitest';
import type { InstitutionalRow, PriceRow } from '../market/types';
import { classifyAsset, buildEntrySnapshot } from './snapshot';
import type { PositionEvent } from './positions';

function dates(count: number, from = '2025-10-01'): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

function priceRows(closes: number[], from = '2025-10-01'): PriceRow[] {
  return dates(closes.length, from).map((date, index) => ({
    date,
    stock_id: '2330',
    open: closes[index],
    max: closes[index],
    min: closes[index],
    close: closes[index],
    Trading_Volume: 1_000_000,
  }));
}

function chipRows(priceData: PriceRow[], foreignNet: number, trustNet: number): InstitutionalRow[] {
  return priceData.flatMap((row) => [
    {
      date: row.date,
      stock_id: '2330',
      name: 'Foreign_Investor',
      buy: foreignNet > 0 ? foreignNet : 0,
      sell: foreignNet < 0 ? -foreignNet : 0,
    },
    {
      date: row.date,
      stock_id: '2330',
      name: 'Investment_Trust',
      buy: trustNet > 0 ? trustNet : 0,
      sell: trustNet < 0 ? -trustNet : 0,
    },
  ]);
}

function entry(tradeDate: string, stockId = '2330'): PositionEvent {
  return {
    transactionId: 'tx-1',
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

describe('classifyAsset', () => {
  it('00 開頭視為 ETF', () => {
    for (const id of ['0050', '0056', '00878', '00940', '00631L']) {
      expect(classifyAsset(id)).toBe('etf');
    }
  });

  it('四位數代號視為個股', () => {
    for (const id of ['2330', '1101', '5381', '9999']) {
      expect(classifyAsset(id)).toBe('stock');
    }
  });
});

describe('buildEntrySnapshot 的前視偏誤防護', () => {
  const closes = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 30 }, () => 999)];
  const prices = priceRows(closes);
  const entryDate = prices[59].date;

  it('均線只使用建立部位當日及以前的資料', () => {
    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.technical.ok).toBe(true);
    if (!snapshot.technical.ok) return;

    // 當日之後的 999 若被納入，MA 會遠高於 100
    expect(snapshot.technical.snapshot.ma5).toBeCloseTo(100, 6);
    expect(snapshot.technical.snapshot.ma20).toBeCloseTo(100, 6);
    expect(snapshot.technical.snapshot.ma60).toBeCloseTo(100, 6);
    expect(snapshot.technical.snapshot.close).toBe(100);
  });

  it('快照日期就是建立部位當日', () => {
    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.technical.ok).toBe(true);
    if (!snapshot.technical.ok) return;
    expect(snapshot.technical.snapshot.tradeDate).toBe(entryDate);
  });

  it('籌碼只使用建立部位當日及以前的法人資料', () => {
    const institutional = [
      ...chipRows(prices.slice(0, 60), 100, 100),
      ...chipRows(prices.slice(60), 999_999, -999_999),
    ];

    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional,
      dividends: [],
      splits: [],
    });

    expect(snapshot.chip.ok).toBe(true);
    if (!snapshot.chip.ok) return;
    expect(snapshot.chip.snapshot.foreign.fiveDayNet).toBe(500);
    expect(snapshot.chip.snapshot.lastDate).toBe(entryDate);
  });

  it('還原只套用建立部位當日以前的事件', () => {
    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [
        { date: prices[70].date, stock_id: '2330', before_price: 100, after_price: 90 },
      ],
      splits: [],
    });

    expect(snapshot.appliedAdjustments).toEqual([]);
  });
});

describe('buildEntrySnapshot 的價格還原', () => {
  it('先還原再計算均線，使分割不產生假乖離', () => {
    // 前 60 日為分割前的高價，最後一日為分割後的價格
    const before = Array.from({ length: 60 }, () => 400);
    const prices = priceRows([...before, 100]);
    const entryDate = prices[60].date;

    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [{ date: entryDate, stock_id: '2330', before_price: 400, after_price: 100 }],
    });

    expect(snapshot.technical.ok).toBe(true);
    if (!snapshot.technical.ok) return;

    // 未還原時 MA20 會是 400 附近、Bias20 約 -75%
    expect(snapshot.technical.snapshot.ma20).toBeCloseTo(100, 6);
    expect(snapshot.technical.snapshot.bias20).toBeCloseTo(0, 6);
    expect(snapshot.appliedAdjustments).toHaveLength(1);
    expect(snapshot.appliedAdjustments[0].kind).toBe('split');
  });

  it('沒有還原事件時不列出任何套用紀錄', () => {
    const prices = priceRows(Array.from({ length: 70 }, () => 100));

    const snapshot = buildEntrySnapshot({
      entry: entry(prices[65].date),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.appliedAdjustments).toEqual([]);
  });
});

describe('buildEntrySnapshot 的資料完整性', () => {
  it('建立部位當日之前不足 60 筆價格時不產生技術結果', () => {
    const prices = priceRows(Array.from({ length: 80 }, () => 100));
    const entryDate = prices[40].date;

    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.technical.ok).toBe(false);
    expect(snapshot.dataQuality.priceRows).toBe(41);
    expect(snapshot.dataQuality.canAnalyseTechnical).toBe(false);
  });

  it('法人不足五個交易日時不產生籌碼結果', () => {
    const prices = priceRows(Array.from({ length: 70 }, () => 100));
    const entryDate = prices[65].date;

    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices.slice(63, 66), 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.chip.ok).toBe(false);
    expect(snapshot.dataQuality.canAnalyseChip).toBe(false);
  });

  it('回報建立部位當日可用的資料筆數', () => {
    const prices = priceRows(Array.from({ length: 90 }, () => 100));
    const entryDate = prices[70].date;

    const snapshot = buildEntrySnapshot({
      entry: entry(entryDate),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.dataQuality.priceRows).toBe(71);
    expect(snapshot.dataQuality.foreignRows).toBe(71);
    expect(snapshot.dataQuality.trustRows).toBe(71);
  });

  it('完全沒有資料時不拋出例外，並標示無法分析', () => {
    const snapshot = buildEntrySnapshot({
      entry: entry('2026-03-02'),
      prices: [],
      institutional: [],
      dividends: [],
      splits: [],
    });

    expect(snapshot.technical.ok).toBe(false);
    expect(snapshot.chip.ok).toBe(false);
    expect(snapshot.dataQuality.canAnalyseTechnical).toBe(false);
  });
});

describe('buildEntrySnapshot 保留的樣本資訊', () => {
  it('保留建立部位本身與資產分類', () => {
    const prices = priceRows(Array.from({ length: 70 }, () => 100));
    const snapshot = buildEntrySnapshot({
      entry: entry(prices[65].date, '0050'),
      prices,
      institutional: chipRows(prices, 100, 100),
      dividends: [],
      splits: [],
    });

    expect(snapshot.entry.stockId).toBe('0050');
    expect(snapshot.assetClass).toBe('etf');
  });
});
