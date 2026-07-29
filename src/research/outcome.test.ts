import { describe, expect, it } from 'vitest';
import type { PriceRow } from '../market/types';
import { computeBaseline, computeEntryOutcome, VALIDATION_WINDOW } from './outcome';

/** 產生連續交易日的價格序列（不含週末概念，逐日即為交易日）。 */
function series(closes: number[], from = '2026-01-05'): PriceRow[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return closes.map((close, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    stock_id: '2330',
    open: close,
    max: close,
    min: close,
    close,
    Trading_Volume: 1_000_000,
  }));
}

describe('買進後 5 日診斷', () => {
  const prices = series([100, 98, 95, 97, 92, 99, 105]);
  const entryDate = prices[0].date;

  it('取買進後第 1 至 5 個交易日的收盤', () => {
    const outcome = computeEntryOutcome({
      entryDate,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.diagnostic.closes.map((day) => day.close)).toEqual([98, 95, 97, 92, 99]);
  });

  it('找出 5 日內最低收盤與其日期', () => {
    const outcome = computeEntryOutcome({
      entryDate,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.diagnostic.lowestClose).toEqual({ date: prices[4].date, close: 92 });
    expect(outcome.diagnostic.lowestReturnPercent).toBeCloseTo(-8, 6);
  });

  it('不足 5 個交易日時標示為不完整，仍回報已有的部分', () => {
    const short = series([100, 98, 95]);
    const outcome = computeEntryOutcome({
      entryDate: short[0].date,
      assetClass: 'stock',
      prices: short,
      previousEntryDate: null,
    });

    expect(outcome.diagnostic.complete).toBe(false);
    expect(outcome.diagnostic.closes).toHaveLength(2);
  });

  it('買進當日不列入買進後的觀察', () => {
    const outcome = computeEntryOutcome({
      entryDate,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.diagnostic.closes.every((day) => day.date > entryDate)).toBe(true);
  });
});

describe('正式驗證窗', () => {
  it('個股取買進後第 20 個交易日', () => {
    const prices = series([...Array.from({ length: 21 }, () => 100), 130]);
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.windowDays).toBe(VALIDATION_WINDOW.stock);
    expect(outcome.validation.endDate).toBe(prices[20].date);
    expect(outcome.validation.complete).toBe(true);
  });

  it('ETF 取買進後第 60 個交易日', () => {
    const prices = series(Array.from({ length: 61 }, (_, index) => (index === 60 ? 120 : 100)));
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'etf',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.windowDays).toBe(VALIDATION_WINDOW.etf);
    expect(outcome.validation.returnPercent).toBeCloseTo(20, 6);
  });

  it('以還原後的收盤價對收盤價計算報酬', () => {
    const prices = series([...Array.from({ length: 20 }, () => 50), 60]);
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.returnPercent).toBeCloseTo(20, 6);
  });

  it('觀察窗尚未走完時標示為不完整，且不產生報酬', () => {
    const prices = series(Array.from({ length: 15 }, () => 100));
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.complete).toBe(false);
    expect(outcome.validation.returnPercent).toBeNull();
    expect(outcome.validation.endDate).toBeNull();
  });

  it('ETF 只有 20 日資料時視為不完整，不退而求其次用 20 日', () => {
    const prices = series(Array.from({ length: 25 }, () => 100));
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'etf',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.complete).toBe(false);
  });
});

describe('觀察窗重疊', () => {
  const prices = series(Array.from({ length: 40 }, () => 100));

  it('同標的前一次建立部位的觀察窗尚未結束時標示重疊', () => {
    const outcome = computeEntryOutcome({
      entryDate: prices[10].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: prices[0].date,
    });

    expect(outcome.validation.overlapsPrevious).toBe(true);
  });

  it('前一次觀察窗已結束時不算重疊', () => {
    const outcome = computeEntryOutcome({
      entryDate: prices[25].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: prices[0].date,
    });

    expect(outcome.validation.overlapsPrevious).toBe(false);
  });

  it('沒有前一次建立部位時不算重疊', () => {
    const outcome = computeEntryOutcome({
      entryDate: prices[0].date,
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.overlapsPrevious).toBe(false);
  });
});

describe('資料缺漏', () => {
  it('買進日不在價格序列中時不產生任何結果', () => {
    const prices = series(Array.from({ length: 30 }, () => 100));
    const outcome = computeEntryOutcome({
      entryDate: '2020-01-01',
      assetClass: 'stock',
      prices,
      previousEntryDate: null,
    });

    expect(outcome.validation.complete).toBe(false);
    expect(outcome.diagnostic.closes).toEqual([]);
  });

  it('完全沒有價格資料時不拋出例外', () => {
    const outcome = computeEntryOutcome({
      entryDate: '2026-03-02',
      assetClass: 'stock',
      prices: [],
      previousEntryDate: null,
    });

    expect(outcome.validation.returnPercent).toBeNull();
  });
});

describe('個人基準線', () => {
  const outcomes = [
    { assetClass: 'stock' as const, returnPercent: 10, complete: true, overlapsPrevious: false },
    { assetClass: 'stock' as const, returnPercent: -5, complete: true, overlapsPrevious: false },
    { assetClass: 'stock' as const, returnPercent: 30, complete: true, overlapsPrevious: true },
    { assetClass: 'etf' as const, returnPercent: 3, complete: true, overlapsPrevious: false },
    { assetClass: 'stock' as const, returnPercent: 999, complete: false, overlapsPrevious: false },
  ];

  it('只計入觀察窗完整的樣本', () => {
    const baseline = computeBaseline(outcomes, 'stock');

    expect(baseline.completeCount).toBe(3);
  });

  it('同時回報中位數與平均數', () => {
    const baseline = computeBaseline(outcomes, 'stock');

    expect(baseline.median).toBeCloseTo(10, 6);
    expect(baseline.mean).toBeCloseTo(35 / 3, 6);
  });

  it('回報最差單筆與正負筆數', () => {
    const baseline = computeBaseline(outcomes, 'stock');

    expect(baseline.worst).toBe(-5);
    expect(baseline.positiveCount).toBe(2);
    expect(baseline.negativeCount).toBe(1);
  });

  it('另計非重疊樣本數，供敏感度檢查', () => {
    const baseline = computeBaseline(outcomes, 'stock');

    expect(baseline.nonOverlappingCount).toBe(2);
  });

  it('依資產類別分開計算，不混用 ETF 與個股', () => {
    expect(computeBaseline(outcomes, 'etf').completeCount).toBe(1);
    expect(computeBaseline(outcomes, 'etf').median).toBeCloseTo(3, 6);
  });

  it('沒有完整樣本時各項為 null 而非零', () => {
    const baseline = computeBaseline(
      [{ assetClass: 'etf' as const, returnPercent: null, complete: false, overlapsPrevious: false }],
      'etf',
    );

    expect(baseline.completeCount).toBe(0);
    expect(baseline.median).toBeNull();
    expect(baseline.mean).toBeNull();
    expect(baseline.worst).toBeNull();
  });
});
