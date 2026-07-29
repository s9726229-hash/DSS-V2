import { adjustPrices, type DistortionEvent } from '../dss/adjustment';
import { computeChipSnapshot, type ChipResult } from '../dss/chip';
import { computeTechnicalSnapshot, type TechnicalResult } from '../dss/technical';
import type { AdjustmentEventRow, InstitutionalRow, PriceRow } from '../market/types';
import type { PositionEvent } from './positions';

/**
 * 資產分類。台股 ETF 代號一律以 00 開頭（0050、00878、00631L），
 * 一般個股為不以 00 開頭的四位數代號。
 * 規格 v1 只分 ETF 與個股，上市／上櫃不另外拆分。
 */
export type AssetClass = 'etf' | 'stock';

export function classifyAsset(stockId: string): AssetClass {
  return stockId.startsWith('00') ? 'etf' : 'stock';
}

export type EntryDataQuality = {
  priceRows: number;
  foreignRows: number;
  trustRows: number;
  canAnalyseTechnical: boolean;
  canAnalyseChip: boolean;
};

export type EntrySnapshot = {
  entry: PositionEvent;
  assetClass: AssetClass;
  technical: TechnicalResult;
  chip: ChipResult;
  /** 建立部位當日以前實際套用的還原事件，供研究頁說明資料來源。 */
  appliedAdjustments: DistortionEvent[];
  dataQuality: EntryDataQuality;
};

const FOREIGN_INVESTOR = 'Foreign_Investor';
const INVESTMENT_TRUST = 'Investment_Trust';

/** 只保留建立部位當日及以前的資料。 */
function upTo<TRow extends { date: string }>(rows: readonly TRow[], date: string): TRow[] {
  return rows.filter((row) => row.date <= date);
}

/**
 * 建立部位當日的研究快照。
 *
 * 所有輸入一律先截斷至建立部位當日，避免用到當時還不存在的資料。
 * 這是整份研究能否成立的前提：若混入之後的資料，
 * 算出來的條件會有前視偏誤，看起來有效但實際無法複製。
 */
export function buildEntrySnapshot({
  entry,
  prices,
  institutional,
  dividends,
  splits,
}: {
  entry: PositionEvent;
  prices: readonly PriceRow[];
  institutional: readonly InstitutionalRow[];
  dividends: readonly AdjustmentEventRow[];
  splits: readonly AdjustmentEventRow[];
}): EntrySnapshot {
  const date = entry.tradeDate;
  const rawUpTo = upTo(prices, date);
  const institutionalUpTo = upTo(institutional, date);

  // 先還原再計算：未還原的跳空會讓均線與乖離失真，
  // 而百分位數統計無法忽略這種數值
  const { prices: pricesUpTo, appliedEvents } = adjustPrices({
    prices: rawUpTo,
    dividends: upTo(dividends, date),
    splits: upTo(splits, date),
  });

  const technical = computeTechnicalSnapshot(pricesUpTo);
  const chip = computeChipSnapshot({ institutional: institutionalUpTo, prices: pricesUpTo });

  return {
    entry,
    assetClass: classifyAsset(entry.stockId),
    technical,
    chip,
    appliedAdjustments: appliedEvents,
    dataQuality: {
      priceRows: pricesUpTo.length,
      foreignRows: institutionalUpTo.filter((row) => row.name === FOREIGN_INVESTOR).length,
      trustRows: institutionalUpTo.filter((row) => row.name === INVESTMENT_TRUST).length,
      canAnalyseTechnical: technical.ok,
      canAnalyseChip: chip.ok,
    },
  };
}
