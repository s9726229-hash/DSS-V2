import { describe, expect, it } from 'vitest';
import { computeTechnicalSnapshot, MINIMUM_PRICE_ROWS } from './technical';
import type { PriceRow } from '../market/types';

/** 產生連續交易日的價格列；close 由 closes 指定。 */
function priceRows(closes: number[]): PriceRow[] {
  return closes.map((close, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    stock_id: '2330',
    open: close,
    max: close,
    min: close,
    close,
    Trading_Volume: 1_000_000,
  }));
}

/** 60 筆固定價格，方便在尾端加上要測的走勢。 */
function flatHistory(value: number, count = 60): number[] {
  return Array.from({ length: count }, () => value);
}

describe('資料完整性保護', () => {
  it('少於 60 筆價格資料時不產生技術結果', () => {
    const result = computeTechnicalSnapshot(priceRows(flatHistory(100, 59)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-price-data');
    expect(result.available).toBe(59);
    expect(result.required).toBe(MINIMUM_PRICE_ROWS);
  });

  it('剛好 60 筆時可產生結果', () => {
    expect(computeTechnicalSnapshot(priceRows(flatHistory(100, 60))).ok).toBe(true);
  });

  it('沒有任何價格資料時回報資料不足', () => {
    const result = computeTechnicalSnapshot([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.available).toBe(0);
  });
});

describe('移動平均與乖離', () => {
  it('計算 5、20、60 日移動平均', () => {
    // 前 55 筆為 100，最後 5 筆為 110
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 55), ...flatHistory(110, 5)]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.ma5).toBeCloseTo(110, 6);
    expect(result.snapshot.ma20).toBeCloseTo((100 * 15 + 110 * 5) / 20, 6);
    expect(result.snapshot.ma60).toBeCloseTo((100 * 55 + 110 * 5) / 60, 6);
  });

  it('Bias20 為收盤相對 MA20 的百分比乖離', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 120]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = ((120 - result.snapshot.ma20) / result.snapshot.ma20) * 100;
    expect(result.snapshot.bias20).toBeCloseTo(expected, 6);
  });

  it('收盤等於 MA20 時 Bias20 為零', () => {
    const result = computeTechnicalSnapshot(priceRows(flatHistory(100)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.bias20).toBeCloseTo(0, 10);
  });

  it('回報最後一個交易日與收盤價', () => {
    const rows = priceRows(flatHistory(100));
    const result = computeTechnicalSnapshot(rows);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.tradeDate).toBe(rows[rows.length - 1].date);
    expect(result.snapshot.close).toBe(100);
  });

  it('未依日期排序的輸入會先排序再計算', () => {
    const rows = priceRows([...flatHistory(100, 59), 130]);
    const shuffled = [rows[rows.length - 1], ...rows.slice(0, -1)];

    const result = computeTechnicalSnapshot(shuffled);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.close).toBe(130);
  });
});

describe('月線狀態', () => {
  it('收盤由下方穿越 MA20 為 recovery', () => {
    // 長期在 MA20 下方，最後一日拉高越過
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 90, 90, 90, 90, 90, 90, 90, 90, 90, 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.monthlyLineState).toBe('recovery');
  });

  it('穿越後仍站在 MA20 上方為 confirmed', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 200, 200, 200, 200, 200, 200, 200, 200, 200, 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.monthlyLineState).toBe('confirmed');
  });

  it('收盤位於 MA20 下方為 lost', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 200, 200, 200, 200, 200, 200, 200, 200, 200, 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.monthlyLineState).toBe('lost');
  });
});

describe('週線／月線／季線位置', () => {
  it('收盤高於三條均線時皆為站上', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.maPositions).toEqual({
      weekly: 'above',
      monthly: 'above',
      quarterly: 'above',
    });
  });

  it('收盤低於三條均線時皆為跌破', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.maPositions).toEqual({
      weekly: 'below',
      monthly: 'below',
      quarterly: 'below',
    });
  });

  it('三條均線可各自不同：跌破週線但仍站上月線與季線', () => {
    // 長期上升後最後一日小幅回落，僅跌破最短的週線
    const rising = Array.from({ length: 59 }, (_, index) => 100 + index);
    const result = computeTechnicalSnapshot(priceRows([...rising, 150]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.maPositions.weekly).toBe('below');
    expect(result.snapshot.maPositions.monthly).toBe('above');
    expect(result.snapshot.maPositions.quarterly).toBe('above');
  });

  it('月線位置與月線狀態一致', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.maPositions.monthly).toBe('below');
    expect(result.snapshot.monthlyLineState).toBe('lost');
  });
});

describe('風險提醒', () => {
  it('收盤跌回 MA20 下方時提出回檔觀察', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 200, 200, 200, 200, 200, 200, 200, 200, 200, 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.alerts).toContain('pullback-watch');
  });

  it('連續兩個交易日收盤低於 MA60 時提出趨勢轉弱', () => {
    // 需 61 筆才算得出前一日的 MA60
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 50, 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.alerts).toContain('trend-weakening');
  });

  it('資料剛好 60 筆而無法確認前一日 MA60 時，不宣稱趨勢轉弱', () => {
    // 前一日的 MA60 無法計算，寧可不發警示也不做沒有根據的判斷
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 58), 50, 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.alerts).not.toContain('trend-weakening');
  });

  it('僅一日跌破 MA60 尚不視為趨勢轉弱', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 59), 50]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.alerts).not.toContain('trend-weakening');
  });

  it('站穩 MA20 上方時不產生任何風險提醒', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 200, 200, 200, 200, 200, 200, 200, 200, 200, 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.alerts).toEqual([]);
  });
});

describe('回穩判定', () => {
  it('前日在 MA20 之下、當日站上為回檔後回穩觀察', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 90, 90, 90, 90, 90, 90, 90, 90, 90, 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.recoveryState).toBe('watching');
  });

  it('再隔一日仍在 MA20 上方才算回檔後回穩', () => {
    const result = computeTechnicalSnapshot(priceRows([...flatHistory(100, 50), 90, 90, 90, 90, 90, 90, 90, 90, 200, 200]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.recoveryState).toBe('confirmed');
  });

  it('沒有發生穿越時無回穩狀態', () => {
    const result = computeTechnicalSnapshot(priceRows(flatHistory(100)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.recoveryState).toBeNull();
  });
});
