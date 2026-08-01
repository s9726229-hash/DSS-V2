import type { PriceRow } from '../market/types';

/** 迷你趨勢圖的視窗長度：一季左右的交易日，足以看出相對位置又不過度壓縮。 */
export const TREND_DAYS = 60;

const MA_PERIOD = 20;

export type TrendPoint = {
  date: string;
  close: number;
  /** 該日往前二十日的均線；不足二十日時為 null。 */
  ma20: number | null;
};

export type TrendSeries = {
  points: TrendPoint[];
  /** 縱軸下界，已涵蓋收盤與 MA20。 */
  min: number;
  max: number;
  /** 少於兩點畫不出趨勢，此時不應該畫線。 */
  drawable: boolean;
};

/**
 * 迷你趨勢圖的資料。
 *
 * 規格：小圖用於快速看收盤價與 MA20 的相對趨勢，且不得只用圖形隱藏資料不足。
 * 因此前十九日的 MA20 明確留 null，讓畫面知道那一段沒有均線可畫，
 * 而不是用收盤價頂替出一條看起來完整、實際上是假的線。
 */
export function buildTrendSeries(
  rows: readonly PriceRow[],
  days = TREND_DAYS,
): TrendSeries {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((row) => row.close);

  const from = Math.max(0, sorted.length - days);

  const points: TrendPoint[] = sorted.slice(from).map((row, offset) => {
    const index = from + offset;
    const start = index - MA_PERIOD + 1;

    return {
      date: row.date,
      close: row.close,
      ma20:
        start < 0
          ? null
          : closes.slice(start, index + 1).reduce((sum, value) => sum + value, 0) / MA_PERIOD,
    };
  });

  const values = points.flatMap((point) =>
    point.ma20 === null ? [point.close] : [point.close, point.ma20],
  );

  if (values.length === 0) {
    return { points, min: 0, max: 1, drawable: false };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    points,
    min,
    // 全部同價時上下界會相同，縱軸會塌成零高度而除以零
    max: max === min ? min + 1 : max,
    drawable: points.length >= 2,
  };
}
