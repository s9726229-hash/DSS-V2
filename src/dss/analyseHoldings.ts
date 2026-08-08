import type {
  AdjustmentEventRow,
  InstitutionalRow,
  MarginRow,
  PriceRow,
} from '../market/types';
import { readCachedDataset } from '../storage/marketCache';
import { readHoldingsSnapshot } from '../storage/portfolio';
import { adjustPrices, type DistortionEvent } from './adjustment';
import { computeChipSnapshot, type ChipResult, type DailyNet } from './chip';
import { marginDailyChange } from './margin';
import { computeTechnicalSnapshot, type TechnicalResult } from './technical';
import { buildTrendSeries, type TrendSeries } from './trend';

/**
 * 單一股票在最近一個交易日的技術與籌碼狀態。
 *
 * 技術分析頁與 Profile 的套用預覽都用這一份，
 * 兩邊若各算各的，畫面遲早會對不起來。
 */
export type StockAnalysis = {
  stockId: string;
  stockName: string;
  priceDate: string | null;
  /** 最新交易日的原始收盤價；持股損益不可使用還原後價格。 */
  marketClose: number | null;
  technical: TechnicalResult;
  chip: ChipResult;
  appliedAdjustments: DistortionEvent[];
  /** 融資餘額的每日增減（股），由舊到新。沒有資料時是空陣列。 */
  margin: DailyNet[];
  /** 迷你趨勢圖用的收盤與 MA20 序列，取還原後的價格。 */
  trend: TrendSeries;
};

export async function analyseStock(stockId: string, stockName: string): Promise<StockAnalysis> {
  const [priceCache, institutionalCache, dividendCache, splitCache, marginCache] =
    await Promise.all([
      readCachedDataset('TaiwanStockPrice', stockId),
      readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
      readCachedDataset('TaiwanStockDividendResult', stockId),
      readCachedDataset('TaiwanStockSplitPrice', stockId),
      readCachedDataset('TaiwanStockMarginPurchaseShortSale', stockId),
    ]);

  const raw = (priceCache?.payload ?? []) as PriceRow[];
  const institutional = (institutionalCache?.payload ?? []) as InstitutionalRow[];

  // 先還原再計算，均線與乖離才不會被除權息與分割的帳面跳空拉偏
  const { prices, appliedEvents } = adjustPrices({
    prices: raw,
    dividends: (dividendCache?.payload ?? []) as AdjustmentEventRow[],
    splits: (splitCache?.payload ?? []) as AdjustmentEventRow[],
  });

  const latestRaw = raw.reduce<PriceRow | null>(
    (latest, row) => (latest === null || row.date > latest.date ? row : latest),
    null,
  );

  return {
    stockId,
    stockName,
    priceDate: priceCache?.tradeDate || null,
    marketClose: latestRaw?.close ?? null,
    technical: computeTechnicalSnapshot(prices),
    chip: computeChipSnapshot({ institutional, prices }),
    appliedAdjustments: appliedEvents,
    margin: marginDailyChange((marginCache?.payload ?? []) as MarginRow[]),
    trend: buildTrendSeries(prices),
  };
}

/** 最新一份庫存快照裡每一檔的狀態。沒有庫存時回傳空陣列，且不讀取任何市場資料。 */
export async function analyseHoldings(): Promise<StockAnalysis[]> {
  const holdings = await readHoldingsSnapshot();

  return Promise.all(holdings.map((holding) => analyseStock(holding.stockId, holding.stockName)));
}
