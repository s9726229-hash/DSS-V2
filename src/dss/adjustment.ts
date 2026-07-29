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

/** 事件的還原係數；前後價缺漏或為零時視為不可用。 */
function factorOf(row: AdjustmentEventRow): number | null {
  if (
    !Number.isFinite(row.before_price) ||
    !Number.isFinite(row.after_price) ||
    row.before_price <= 0
  ) {
    return null;
  }

  return row.after_price / row.before_price;
}

export type AdjustedPrices = {
  prices: PriceRow[];
  appliedEvents: DistortionEvent[];
};

/**
 * 後向還原權息與分割。
 *
 * 除權息與分割會讓價格出現帳面跳空，但持有人的資產並未改變。
 * 若不還原，均線會被跳空拉低、乖離率失真；在參數提取時更嚴重——
 * 例如某檔在建立部位當日分割約 1 拆 24，未還原的 Bias20 會算出 −95%，
 * 而百分位數統計無法忽略這種數值。
 *
 * 作法：把每個事件之前的價格乘上其後所有事件係數的乘積
 * （係數 = 除權息／分割後參考價 ÷ 前一日收盤價），
 * 使整段序列落在最新的價格尺度上。成交量不調整。
 */
export function adjustPrices({
  prices,
  dividends,
  splits,
}: {
  prices: readonly PriceRow[];
  dividends: readonly AdjustmentEventRow[];
  splits: readonly AdjustmentEventRow[];
}): AdjustedPrices {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    return { prices: sorted, appliedEvents: [] };
  }

  const earliest = sorted[0].date;

  const usable = (rows: readonly AdjustmentEventRow[], kind: DistortionEvent['kind']) =>
    rows
      .map((row) => ({ row, factor: factorOf(row) }))
      .filter(({ row, factor }) => factor !== null && row.date > earliest)
      .map(({ row, factor }) => ({
        date: row.date,
        kind,
        factor: factor as number,
        impactPercent: ((factor as number) - 1) * 100,
      }));

  const events = [...usable(dividends, 'dividend'), ...usable(splits, 'split')].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  if (events.length === 0) {
    return { prices: sorted, appliedEvents: [] };
  }

  // 由最新往回累乘：每筆價格套用其後所有事件的係數
  const cumulativeAfter = new Map<string, number>();
  let cumulative = 1;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    cumulative *= events[index].factor;
    cumulativeAfter.set(events[index].date, cumulative);
  }

  const factorFor = (date: string): number => {
    for (const event of events) {
      if (event.date > date) {
        return cumulativeAfter.get(event.date) as number;
      }
    }
    return 1;
  };

  const adjusted = sorted.map((row) => {
    const factor = factorFor(row.date);

    if (factor === 1) {
      return row;
    }

    return {
      ...row,
      open: row.open * factor,
      max: row.max * factor,
      min: row.min * factor,
      close: row.close * factor,
    };
  });

  return {
    prices: adjusted,
    appliedEvents: events.map(({ date, kind, impactPercent }) => ({ date, kind, impactPercent })),
  };
}

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
