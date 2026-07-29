import { describe, expect, it } from 'vitest';
import { adjustPrices, detectDistortion, MA_WINDOW_TRADING_DAYS } from './adjustment';
import type { AdjustmentEventRow, PriceRow } from '../market/types';

function prices(count: number, from = '2026-05-01'): PriceRow[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    stock_id: '0050',
    open: 100,
    max: 100,
    min: 100,
    close: 100,
    Trading_Volume: 1_000_000,
  }));
}

function event(date: string, before: number, after: number): AdjustmentEventRow {
  return { date, stock_id: '0050', before_price: before, after_price: after };
}

describe('detectDistortion', () => {
  it('沒有任何事件時不標示失真', () => {
    const result = detectDistortion({ prices: prices(70), dividends: [], splits: [] });

    expect(result.distorted).toBe(false);
    expect(result.events).toEqual([]);
  });

  it('除息落在均線窗口內時標示失真並算出影響幅度', () => {
    const priceRows = prices(70);
    const inside = priceRows[priceRows.length - 5].date;

    const result = detectDistortion({
      prices: priceRows,
      dividends: [event(inside, 99.2, 98.6)],
      splits: [],
    });

    expect(result.distorted).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('dividend');
    expect(result.events[0].impactPercent).toBeCloseTo(-0.605, 2);
  });

  it('分割落在窗口內時標示為分割，影響幅度遠大於除息', () => {
    const priceRows = prices(70);
    const inside = priceRows[priceRows.length - 10].date;

    const result = detectDistortion({
      prices: priceRows,
      dividends: [],
      splits: [event(inside, 188.65, 47.16)],
    });

    expect(result.distorted).toBe(true);
    expect(result.events[0].kind).toBe('split');
    expect(result.events[0].impactPercent).toBeCloseTo(-75, 0);
  });

  it('事件早於均線窗口時不標示失真', () => {
    const priceRows = prices(120);
    const outside = priceRows[0].date;

    const result = detectDistortion({
      prices: priceRows,
      dividends: [event(outside, 100, 99)],
      splits: [],
    });

    expect(result.distorted).toBe(false);
  });

  it('窗口以最近 60 個交易日為界', () => {
    const priceRows = prices(120);
    const boundary = priceRows[priceRows.length - MA_WINDOW_TRADING_DAYS].date;

    const result = detectDistortion({
      prices: priceRows,
      dividends: [event(boundary, 100, 99)],
      splits: [],
    });

    expect(result.distorted).toBe(true);
  });

  it('同時有除息與分割時全部列出，最近的排在前面', () => {
    const priceRows = prices(70);

    const result = detectDistortion({
      prices: priceRows,
      dividends: [event(priceRows[priceRows.length - 30].date, 100, 99)],
      splits: [event(priceRows[priceRows.length - 5].date, 200, 50)],
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].kind).toBe('split');
  });

  it('尚未取得價格資料時不做判斷', () => {
    const result = detectDistortion({ prices: [], dividends: [event('2026-07-21', 99, 98)], splits: [] });

    expect(result.distorted).toBe(false);
  });

  it('前後價缺漏或為零時略過該事件，不產生無意義的百分比', () => {
    const priceRows = prices(70);
    const inside = priceRows[priceRows.length - 5].date;

    const result = detectDistortion({
      prices: priceRows,
      dividends: [event(inside, 0, 98.6)],
      splits: [],
    });

    expect(result.distorted).toBe(false);
  });
});

describe('adjustPrices', () => {
  function series(closes: number[], from = '2026-05-01'): PriceRow[] {
    const start = new Date(`${from}T00:00:00Z`).getTime();
    return closes.map((close, index) => ({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      stock_id: '0050',
      open: close,
      max: close * 1.01,
      min: close * 0.99,
      close,
      Trading_Volume: 1_000_000,
    }));
  }

  it('沒有事件時價格原封不動', () => {
    const rows = series([100, 101, 102]);

    const result = adjustPrices({ prices: rows, dividends: [], splits: [] });

    expect(result.prices).toEqual(rows);
    expect(result.appliedEvents).toEqual([]);
  });

  it('事件當日之前的價格乘上還原係數，當日及之後不變', () => {
    const rows = series([100, 100, 100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[2].date, 100, 99)],
      splits: [],
    });

    expect(result.prices[0].close).toBeCloseTo(99, 6);
    expect(result.prices[1].close).toBeCloseTo(99, 6);
    expect(result.prices[2].close).toBe(100);
    expect(result.prices[3].close).toBe(100);
  });

  it('還原 0050 的 1 拆 4 分割，使序列連續', () => {
    // 分割前 188.65、分割後 47.57，還原後前段應落在後段的尺度上
    const rows = series([188.65, 47.57]);

    const result = adjustPrices({
      prices: rows,
      dividends: [],
      splits: [event(rows[1].date, 188.65, 47.16)],
    });

    expect(result.prices[0].close).toBeCloseTo(47.16, 2);
    expect(result.prices[1].close).toBe(47.57);
  });

  it('多個事件的係數連乘', () => {
    const rows = series([100, 100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[2].date, 100, 90)],
      splits: [event(rows[1].date, 100, 50)],
    });

    // 第一天在兩個事件之前：100 × 0.5 × 0.9
    expect(result.prices[0].close).toBeCloseTo(45, 6);
    // 第二天只在除息之前：100 × 0.9
    expect(result.prices[1].close).toBeCloseTo(90, 6);
    expect(result.prices[2].close).toBe(100);
  });

  it('開高低價與收盤價一併還原，維持同一尺度', () => {
    const rows = series([100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[1].date, 100, 50)],
      splits: [],
    });

    expect(result.prices[0].open).toBeCloseTo(50, 6);
    expect(result.prices[0].max).toBeCloseTo(50.5, 6);
    expect(result.prices[0].min).toBeCloseTo(49.5, 6);
  });

  it('成交量不還原，避免與價格混為一談', () => {
    const rows = series([100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[1].date, 100, 50)],
      splits: [],
    });

    expect(result.prices[0].Trading_Volume).toBe(1_000_000);
  });

  it('回報實際套用的事件供畫面說明', () => {
    const rows = series([100, 100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[2].date, 100, 99)],
      splits: [event(rows[1].date, 100, 50)],
    });

    expect(result.appliedEvents).toHaveLength(2);
    expect(result.appliedEvents[0]).toMatchObject({ kind: 'split' });
    expect(result.appliedEvents[1]).toMatchObject({ kind: 'dividend' });
  });

  it('前後價為零或缺漏的事件不套用，避免價格被歸零', () => {
    const rows = series([100, 100]);

    const result = adjustPrices({
      prices: rows,
      dividends: [event(rows[1].date, 0, 50)],
      splits: [],
    });

    expect(result.prices[0].close).toBe(100);
    expect(result.appliedEvents).toEqual([]);
  });

  it('早於價格序列的事件不影響任何一筆價格', () => {
    const rows = series([100, 100], '2026-05-10');

    const result = adjustPrices({
      prices: rows,
      dividends: [event('2026-01-01', 100, 50)],
      splits: [],
    });

    expect(result.prices.map((row) => row.close)).toEqual([100, 100]);
    expect(result.appliedEvents).toEqual([]);
  });

  it('未依日期排序的輸入會先排序再還原', () => {
    const rows = series([100, 100, 100]);
    const shuffled = [rows[2], rows[0], rows[1]];

    const result = adjustPrices({
      prices: shuffled,
      dividends: [event(rows[2].date, 100, 50)],
      splits: [],
    });

    expect(result.prices.map((row) => row.date)).toEqual(rows.map((row) => row.date));
    expect(result.prices[0].close).toBeCloseTo(50, 6);
    expect(result.prices[2].close).toBe(100);
  });
});
