import type { DailyNet } from '../../dss/chip';

export const CHIP_TREND_DAYS = 20;

/** 完整分析只畫最近 20 個實際交易日；不補非交易日，也不改變資料排序。 */
export function recentTradingDays(
  series: readonly DailyNet[],
  days = CHIP_TREND_DAYS,
): readonly DailyNet[] {
  return series.slice(-days);
}
