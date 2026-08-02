import type { MarginRow } from '../market/types';
import type { DailyNet } from './chip';
import { DEFAULT_FLOW_THRESHOLDS, type FlowThresholds } from './flow';

/** FinMind 的融資餘額以張為單位，法人以股為單位。共用計算前一律換算成股。 */
const SHARES_PER_LOT = 1000;

/**
 * 融資的中性門檻。
 *
 * 不能沿用法人的 500 張：實測庫存的融資日變化中位數，台積電 398 張、
 * 欣興 512 張、小型股不到 100 張，用法人的門檻會把大多數日子誤判成中性。
 * 50 張是依那次抽樣訂的，仍是可調參數，不是研究出來的門檻。
 */
export const MARGIN_FLOW_THRESHOLDS: FlowThresholds = {
  ...DEFAULT_FLOW_THRESHOLDS,
  neutralFloor: 50 * SHARES_PER_LOT,
};

/**
 * 融資餘額的每日增減。
 *
 * 融資給的是餘額不是流量，要看方向就得自己相減。用今日餘額減前日餘額，
 * 而不是 買進−賣出−現金償還——兩者實測相等，但前者少三個欄位可能缺漏。
 *
 * 回傳值換算成股，與法人序列同一個單位，才能餵進同一支 computeFlow。
 */
export function marginDailyChange(rows: readonly MarginRow[]): DailyNet[] {
  const byDate = new Map<string, number>();

  for (const row of rows) {
    const change = row.MarginPurchaseTodayBalance - row.MarginPurchaseYesterdayBalance;

    if (!Number.isFinite(change)) continue;

    byDate.set(row.date, change * SHARES_PER_LOT);
  }

  return [...byDate.entries()]
    .map(([date, net]) => ({ date, net }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
