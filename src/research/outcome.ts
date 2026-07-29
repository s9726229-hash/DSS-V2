import type { PriceRow } from '../market/types';
import type { AssetClass } from './snapshot';

/** 規格明訂的正式驗證窗：個股買進後 20 個交易日、ETF 60 個交易日。 */
export const VALIDATION_WINDOW: Record<AssetClass, number> = {
  stock: 20,
  etf: 60,
};

/** 單筆事後診斷的觀察天數。規格明訂此結果不參與參數採納。 */
export const DIAGNOSTIC_DAYS = 5;

export type DailyClose = {
  date: string;
  close: number;
};

/**
 * 買進後 5 日診斷。
 * 規格明訂這只是單筆時點診斷，不得用於候選參數的採納或門檻選擇。
 */
export type PostEntryDiagnostic = {
  closes: DailyClose[];
  lowestClose: DailyClose | null;
  /** 最低收盤相對買進日收盤的報酬率。 */
  lowestReturnPercent: number | null;
  /** 是否取滿 5 個交易日。 */
  complete: boolean;
};

export type ValidationOutcome = {
  windowDays: number;
  endDate: string | null;
  endClose: number | null;
  returnPercent: number | null;
  /** 觀察窗是否已完整走完且有資料。 */
  complete: boolean;
  /** 是否與同標的前一次建立部位的觀察窗重疊。 */
  overlapsPrevious: boolean;
};

export type EntryOutcome = {
  diagnostic: PostEntryDiagnostic;
  validation: ValidationOutcome;
};

function sortByDate(prices: readonly PriceRow[]): PriceRow[] {
  return [...prices].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 建立部位後的結果。
 *
 * 報酬一律以還原後的收盤價對收盤價計算，不使用券商的實際成交價：
 * 成交價是未還原的原始價，與還原後的序列不在同一尺度上，混用會算出錯誤報酬。
 * 實際成交價仍保留在交易紀錄中，供檢視個人損益之用。
 */
export function computeEntryOutcome({
  entryDate,
  assetClass,
  prices,
  previousEntryDate,
}: {
  entryDate: string;
  assetClass: AssetClass;
  prices: readonly PriceRow[];
  /** 同標的前一次建立部位的日期；沒有則為 null。 */
  previousEntryDate: string | null;
}): EntryOutcome {
  const sorted = sortByDate(prices);
  const windowDays = VALIDATION_WINDOW[assetClass];
  const entryIndex = sorted.findIndex((row) => row.date === entryDate);

  const empty: EntryOutcome = {
    diagnostic: { closes: [], lowestClose: null, lowestReturnPercent: null, complete: false },
    validation: {
      windowDays,
      endDate: null,
      endClose: null,
      returnPercent: null,
      complete: false,
      overlapsPrevious: false,
    },
  };

  if (entryIndex === -1) {
    return empty;
  }

  const entryClose = sorted[entryIndex].close;

  const following = sorted
    .slice(entryIndex + 1, entryIndex + 1 + DIAGNOSTIC_DAYS)
    .map((row) => ({ date: row.date, close: row.close }));

  const lowestClose = following.reduce<DailyClose | null>(
    (lowest, day) => (lowest === null || day.close < lowest.close ? day : lowest),
    null,
  );

  const validationRow = sorted[entryIndex + windowDays];
  const complete = validationRow !== undefined;

  return {
    diagnostic: {
      closes: following,
      lowestClose,
      lowestReturnPercent:
        lowestClose === null ? null : ((lowestClose.close - entryClose) / entryClose) * 100,
      complete: following.length === DIAGNOSTIC_DAYS,
    },
    validation: {
      windowDays,
      endDate: complete ? validationRow.date : null,
      endClose: complete ? validationRow.close : null,
      returnPercent: complete ? ((validationRow.close - entryClose) / entryClose) * 100 : null,
      complete,
      overlapsPrevious: overlaps(sorted, entryIndex, previousEntryDate, windowDays),
    },
  };
}

/** 前一次建立部位的觀察窗若尚未結束，兩筆樣本並非彼此獨立。 */
function overlaps(
  sorted: readonly PriceRow[],
  entryIndex: number,
  previousEntryDate: string | null,
  windowDays: number,
): boolean {
  if (previousEntryDate === null) {
    return false;
  }

  const previousIndex = sorted.findIndex((row) => row.date === previousEntryDate);

  if (previousIndex === -1) {
    return false;
  }

  return previousIndex + windowDays > entryIndex;
}

export type BaselineInput = {
  assetClass: AssetClass;
  returnPercent: number | null;
  complete: boolean;
  overlapsPrevious: boolean;
};

/**
 * 個人基準線：同類別所有建立部位的實際結果分布。
 * 候選條件必須與此比較，否則無法判斷條件本身是否帶來差異。
 */
export type Baseline = {
  completeCount: number;
  nonOverlappingCount: number;
  median: number | null;
  mean: number | null;
  worst: number | null;
  positiveCount: number;
  negativeCount: number;
};

function median(values: readonly number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

export function computeBaseline(
  outcomes: readonly BaselineInput[],
  assetClass: AssetClass,
): Baseline {
  // 只計入觀察窗完整的樣本；未走完的窗沒有可比較的結果
  const usable = outcomes.filter(
    (outcome) =>
      outcome.assetClass === assetClass && outcome.complete && outcome.returnPercent !== null,
  );

  if (usable.length === 0) {
    return {
      completeCount: 0,
      nonOverlappingCount: 0,
      median: null,
      mean: null,
      worst: null,
      positiveCount: 0,
      negativeCount: 0,
    };
  }

  const returns = usable.map((outcome) => outcome.returnPercent as number).sort((a, b) => a - b);

  return {
    completeCount: usable.length,
    nonOverlappingCount: usable.filter((outcome) => !outcome.overlapsPrevious).length,
    median: median(returns),
    mean: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    worst: returns[0],
    positiveCount: returns.filter((value) => value > 0).length,
    negativeCount: returns.filter((value) => value < 0).length,
  };
}
