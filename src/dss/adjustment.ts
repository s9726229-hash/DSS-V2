import type { AdjustmentEventRow, PriceRow } from '../market/types';

/**
 * MA60 需要 60 個交易日，因此只要還原事件落在最近 60 個交易日內，
 * 均線與 Bias20 就會受到影響。
 */
export const MA_WINDOW_TRADING_DAYS = 60;

export type DistortionEvent = {
  date: string;
  kind: 'dividend' | 'split';
  /** 事件造成的價格跳空幅度（負值代表帳面下跌）。 */
  impactPercent: number;
};

export type DistortionReport = {
  distorted: boolean;
  events: DistortionEvent[];
};

/**
 * 目前使用未還原價，除權息與分割會在價格序列留下帳面跳空，
 * 讓均線與 Bias20 失真。此處找出落在均線窗口內的事件，
 * 使畫面能明確標示，而不是讓錯誤數字靜默出現。
 */
export function detectDistortion({
  prices,
  dividends,
  splits,
}: {
  prices: readonly PriceRow[];
  dividends: readonly AdjustmentEventRow[];
  splits: readonly AdjustmentEventRow[];
}): DistortionReport {
  if (prices.length === 0) {
    return { distorted: false, events: [] };
  }

  const tradingDates = prices.map((row) => row.date).sort();
  const windowStart = tradingDates[Math.max(0, tradingDates.length - MA_WINDOW_TRADING_DAYS)];

  const toEvent = (kind: DistortionEvent['kind']) => (row: AdjustmentEventRow) => ({
    date: row.date,
    kind,
    impactPercent: (row.after_price / row.before_price - 1) * 100,
  });

  const isUsable = (row: AdjustmentEventRow): boolean =>
    row.date >= windowStart &&
    Number.isFinite(row.before_price) &&
    Number.isFinite(row.after_price) &&
    row.before_price > 0;

  const events = [
    ...dividends.filter(isUsable).map(toEvent('dividend')),
    ...splits.filter(isUsable).map(toEvent('split')),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return { distorted: events.length > 0, events };
}
