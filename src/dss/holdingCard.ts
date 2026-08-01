import { classifyByProfile, readEntry, type Profile } from '../profile/profile';
import { metricValue } from '../profile/preview';
import { RESEARCH_METRICS, type ResearchMetric } from '../research/runResearch';
import { classifyAsset, type AssetClass } from '../research/snapshot';
import type { BandId, EvidenceLevel } from '../research/walkForward';
import type { PositionEvent } from '../research/positions';
import type { HoldingSnapshotRecord } from '../storage/types';
import type { StockAnalysis } from './analyseHoldings';

/** 技術與籌碼各自是否算得出來。圖卡不得用圖形隱藏資料不足。 */
export type DataCompleteness = 'complete' | 'partial' | 'none';

export type PositionResult = {
  cost: number;
  marketValue: number;
  unrealized: number;
  /** 成本為零時無法計算，回傳 null 而非無限大。 */
  returnPercent: number | null;
};

export type CardBand = {
  metric: ResearchMetric;
  value: number | null;
  band: BandId | null;
  /** 判定所依據的門檻是手動設定、未經驗證的。 */
  unverified: boolean;
  /** 候選門檻套用當下的證據等級；手動門檻為 null。 */
  evidence: EvidenceLevel | null;
};

/**
 * 持股卡與觀察卡共用的部分。
 *
 * 規格：同一標的共用同一份資料與計算結果。兩種卡各算一次的話，
 * 同一檔在兩處會顯示不同的判定。
 */
export type CardCore = {
  stockId: string;
  stockName: string;
  assetClass: AssetClass;
  priceDate: string | null;
  completeness: DataCompleteness;
  bands: CardBand[];
  analysis: StockAnalysis;
};

export type WatchCard = CardCore & {
  addedAt: string;
  topics: string[];
};

export type HoldingCard = CardCore & {
  tradeType: string;
  /** 庫存快照日期，與市場資料日期是兩回事，兩者都要顯示。 */
  snapshotDate: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
  position: PositionResult;
  heldDays: number | null;
};

/**
 * 未實現損益。
 *
 * 一律使用券商快照自己的成本價與現價——兩者都是未還原的原始價，屬於同一個尺度。
 * 我們計算技術指標時用的是還原後的價格，拿它來算損益會把兩個尺度混在一起，
 * 除權息或分割過的股票會算出離譜的數字。
 */
export function positionResult(holding: HoldingSnapshotRecord): PositionResult {
  const cost = holding.costPrice * holding.quantity;
  const marketValue = holding.currentPrice * holding.quantity;

  return {
    cost,
    marketValue,
    unrealized: marketValue - cost,
    /*
     * 寫成差額除以成本，而不是比值減一。
     * 後者在常見價位就會出現 19.999999999999996 這種浮點殘差，
     * 讓資料層帶著顯示才看得出來的噪訊。
     */
    returnPercent:
      holding.costPrice === 0
        ? null
        : ((holding.currentPrice - holding.costPrice) / holding.costPrice) * 100,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 由最近一次建立部位算到資料日期。任一端缺漏就不猜。 */
export function heldDays(entryDate: string | null, asOf: string | null): number | null {
  if (entryDate === null || asOf === null) return null;

  const from = Date.parse(entryDate);
  const to = Date.parse(asOf);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;

  return Math.round((to - from) / DAY_MS);
}

/**
 * 每檔目前這個部位是哪一天開始的。
 *
 * 這裡**必須**把再進場算進來，與研究樣本的規則相反：研究要問「首次建立部位的
 * 條件如何」，所以排除再進場；持有天數要問「現在手上這批是何時買的」，
 * 賣光後再買就是新的一批。若沿用研究的排除規則，再進場過的股票會顯示
 * 一個早就結束的部位的天數。
 */
export function latestEntryDates(events: readonly PositionEvent[]): Map<string, string> {
  const latest = new Map<string, string>();

  for (const event of events) {
    if (event.kind !== 'entry') continue;

    const known = latest.get(event.stockId);
    if (known === undefined || event.tradeDate > known) {
      latest.set(event.stockId, event.tradeDate);
    }
  }

  return latest;
}

export function dataCompleteness(analysis: StockAnalysis): DataCompleteness {
  const usable = [analysis.technical.ok, analysis.chip.ok].filter(Boolean).length;

  if (usable === 2) return 'complete';
  return usable === 1 ? 'partial' : 'none';
}

function cardBand(
  analysis: StockAnalysis,
  metric: ResearchMetric,
  profile: Profile,
  assetClass: AssetClass,
): CardBand {
  const value = metricValue(analysis, metric);
  const entry = readEntry(profile, assetClass, metric);
  const band = classifyByProfile(value, entry);

  // 判定只要用到任一手動門檻，就不能宣稱這個結論經過驗證
  const boundaries = [entry.lower, entry.upper].filter((side) => side !== null);
  const unverified = boundaries.some((side) => side.origin === 'manual');
  const evidence = entry.lower?.sourceEvidence ?? entry.upper?.sourceEvidence ?? null;

  return { metric, value, band, unverified, evidence };
}

export function buildCardCore({
  stockId,
  stockName,
  analysis,
  profile,
}: {
  stockId: string;
  stockName: string;
  analysis: StockAnalysis;
  profile: Profile;
}): CardCore {
  const assetClass = classifyAsset(stockId);

  return {
    stockId,
    stockName,
    assetClass,
    priceDate: analysis.priceDate,
    completeness: dataCompleteness(analysis),
    bands: RESEARCH_METRICS.map((metric) => cardBand(analysis, metric, profile, assetClass)),
    analysis,
  };
}

export function buildWatchCard({
  entry,
  analysis,
  profile,
}: {
  entry: { stockId: string; stockName: string; addedAt: string; topics: string[] };
  analysis: StockAnalysis;
  profile: Profile;
}): WatchCard {
  return {
    ...buildCardCore({
      stockId: entry.stockId,
      stockName: entry.stockName,
      analysis,
      profile,
    }),
    addedAt: entry.addedAt,
    topics: entry.topics,
  };
}

export function buildHoldingCard({
  holding,
  analysis,
  profile,
  entryDate,
}: {
  holding: HoldingSnapshotRecord;
  analysis: StockAnalysis;
  profile: Profile;
  /** 最近一次建立部位的日期；沒有對應交易紀錄時為 null。 */
  entryDate: string | null;
}): HoldingCard {
  return {
    ...buildCardCore({
      stockId: holding.stockId,
      stockName: holding.stockName,
      analysis,
      profile,
    }),
    tradeType: holding.tradeType,
    snapshotDate: holding.snapshotDate,
    quantity: holding.quantity,
    costPrice: holding.costPrice,
    currentPrice: holding.currentPrice,
    position: positionResult(holding),
    heldDays: heldDays(entryDate, analysis.priceDate),
  };
}
