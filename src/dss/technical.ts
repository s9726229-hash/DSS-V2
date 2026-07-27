import type { PriceRow } from '../market/types';

/** 規格要求：少於 60 筆價格資料不產生技術結果。 */
export const MINIMUM_PRICE_ROWS = 60;

/**
 * 月線狀態。
 * - recovery：收盤由 MA20 下方穿越至上方
 * - confirmed：穿越後仍站在 MA20 上方
 * - lost：收盤位於 MA20 下方
 */
export type MonthlyLineState = 'recovery' | 'confirmed' | 'lost';

/**
 * 回穩判定。穿越當日僅為「觀察」，需下一交易日仍在 MA20 上方才算回穩。
 * 未發生穿越時為 null。
 */
export type RecoveryState = 'watching' | 'confirmed' | null;

/**
 * 風險提醒。僅提示重新檢視持倉，不是賣出指令。
 * - pullback-watch：收盤跌回 MA20 下方
 * - trend-weakening：連續 2 個交易日收盤在 MA60 下方
 */
export type TechnicalAlert = 'pullback-watch' | 'trend-weakening';

export type TechnicalSnapshot = {
  tradeDate: string;
  close: number;
  ma5: number;
  ma20: number;
  ma60: number;
  /** (收盤 − MA20) / MA20 × 100% */
  bias20: number;
  monthlyLineState: MonthlyLineState;
  recoveryState: RecoveryState;
  alerts: TechnicalAlert[];
};

export type TechnicalResult =
  | { ok: true; snapshot: TechnicalSnapshot }
  | { ok: false; reason: 'insufficient-price-data'; available: number; required: number };

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 取截至 index（含）為止的 period 日均線；資料不足時回傳 null。 */
function movingAverageAt(closes: number[], index: number, period: number): number | null {
  if (index + 1 < period) {
    return null;
  }

  return average(closes.slice(index + 1 - period, index + 1));
}

export function computeTechnicalSnapshot(rows: readonly PriceRow[]): TechnicalResult {
  if (rows.length < MINIMUM_PRICE_ROWS) {
    return {
      ok: false,
      reason: 'insufficient-price-data',
      available: rows.length,
      required: MINIMUM_PRICE_ROWS,
    };
  }

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((row) => row.close);
  const last = sorted.length - 1;

  const ma5 = movingAverageAt(closes, last, 5) as number;
  const ma20 = movingAverageAt(closes, last, 20) as number;
  const ma60 = movingAverageAt(closes, last, 60) as number;
  const close = closes[last];

  const previousMa20 = movingAverageAt(closes, last - 1, 20);
  const previousClose = closes[last - 1];
  const aboveNow = close > ma20;
  const abovePrevious = previousMa20 === null ? false : previousClose > previousMa20;

  let monthlyLineState: MonthlyLineState;
  if (!aboveNow) {
    monthlyLineState = 'lost';
  } else if (abovePrevious) {
    monthlyLineState = 'confirmed';
  } else {
    monthlyLineState = 'recovery';
  }

  const alerts: TechnicalAlert[] = [];

  if (!aboveNow) {
    alerts.push('pullback-watch');
  }

  const previousMa60 = movingAverageAt(closes, last - 1, 60);
  const belowMa60Now = close < ma60;
  const belowMa60Previous = previousMa60 === null ? false : previousClose < previousMa60;

  if (belowMa60Now && belowMa60Previous) {
    alerts.push('trend-weakening');
  }

  return {
    ok: true,
    snapshot: {
      tradeDate: sorted[last].date,
      close,
      ma5,
      ma20,
      ma60,
      bias20: ((close - ma20) / ma20) * 100,
      monthlyLineState,
      recoveryState: resolveRecoveryState(closes, last),
      alerts,
    },
  };
}

/**
 * 穿越當日為 watching；穿越後的下一個交易日仍在 MA20 上方為 confirmed。
 * 只檢視最近兩個交易日是否構成上述情形。
 */
function resolveRecoveryState(closes: number[], last: number): RecoveryState {
  const isAbove = (index: number): boolean | null => {
    const ma = movingAverageAt(closes, index, 20);
    return ma === null ? null : closes[index] > ma;
  };

  const now = isAbove(last);
  const previous = isAbove(last - 1);
  const beforePrevious = isAbove(last - 2);

  if (now !== true) {
    return null;
  }

  if (previous === false) {
    return 'watching';
  }

  if (previous === true && beforePrevious === false) {
    return 'confirmed';
  }

  return null;
}
