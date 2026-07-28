import { describe, expect, it } from 'vitest';
import { detectDistortion, MA_WINDOW_TRADING_DAYS } from './adjustment';
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
