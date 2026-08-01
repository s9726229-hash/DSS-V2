import { describe, expect, it } from 'vitest';
import type { PriceRow } from '../market/types';
import { buildTrendSeries, TREND_DAYS } from './trend';

/** 日期必須真的遞增：字串排序下 2026-01-100 會排在 2026-01-99 前面。 */
function dateAt(index: number): string {
  const date = new Date(Date.UTC(2026, 0, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function rows(closes: number[]): PriceRow[] {
  return closes.map((close, index) => ({
    date: dateAt(index),
    stock_id: '2330',
    open: close,
    max: close,
    min: close,
    close,
    Trading_Volume: 1000,
  }));
}

/** 1..n 的收盤序列，方便手算均線。 */
function ramp(count: number): PriceRow[] {
  return rows(Array.from({ length: count }, (_, index) => index + 1));
}

describe('迷你趨勢序列', () => {
  it('只取最後一段，長度不超過視窗', () => {
    const series = buildTrendSeries(ramp(200));

    expect(series.points).toHaveLength(TREND_DAYS);
    expect(series.points[series.points.length - 1].close).toBe(200);
  });

  it('資料少於視窗時全部取用', () => {
    const series = buildTrendSeries(ramp(30));

    expect(series.points).toHaveLength(30);
  });

  it('MA20 是該日往前二十日的平均', () => {
    const series = buildTrendSeries(ramp(40));
    const last = series.points[series.points.length - 1];

    // 21..40 的平均
    expect(last.ma20).toBeCloseTo(30.5, 6);
  });

  /**
   * 規格：小圖不得只用圖形隱藏資料不足。
   * 前十九日算不出 MA20，就明確留 null，讓畫面知道那段不能畫線。
   */
  it('不足二十日的位置 MA20 為 null，不用收盤價頂替', () => {
    const series = buildTrendSeries(ramp(25));

    expect(series.points[0].ma20).toBeNull();
    expect(series.points[18].ma20).toBeNull();
    expect(series.points[19].ma20).not.toBeNull();
  });

  it('完全沒有資料時回報不可繪製', () => {
    const series = buildTrendSeries([]);

    expect(series.points).toEqual([]);
    expect(series.drawable).toBe(false);
  });

  it('只有一筆時仍不可繪製，一個點畫不出趨勢', () => {
    expect(buildTrendSeries(ramp(1)).drawable).toBe(false);
  });

  it('兩筆以上即可繪製收盤線', () => {
    expect(buildTrendSeries(ramp(2)).drawable).toBe(true);
  });

  it('回報這段期間的收盤高低點，供畫面決定縱軸', () => {
    const series = buildTrendSeries(rows([10, 30, 20]));

    expect(series.min).toBe(10);
    expect(series.max).toBe(30);
  });

  /** MA20 可能低於或高於期間收盤區間，縱軸要把它一起包進去才不會畫出界。 */
  it('縱軸範圍涵蓋 MA20', () => {
    const series = buildTrendSeries(ramp(40));

    expect(series.min).toBeLessThanOrEqual(series.points[19].ma20 as number);
    expect(series.max).toBeGreaterThanOrEqual(21);
  });

  it('全部同價時仍給出可用的範圍，不讓縱軸塌成零高度', () => {
    const series = buildTrendSeries(rows([50, 50, 50]));

    expect(series.max).toBeGreaterThan(series.min);
  });

  it('未依日期排序的輸入會先排序', () => {
    const unsorted = [...rows([1, 2, 3])].reverse();

    expect(buildTrendSeries(unsorted).points.map((point) => point.close)).toEqual([1, 2, 3]);
  });
});
