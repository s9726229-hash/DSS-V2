import type { AdjustmentEventRow, InstitutionalRow, PriceRow } from '../market/types';
import { readCachedDataset } from '../storage/marketCache';
import { readHoldingsSnapshot } from '../storage/portfolio';
import { adjustPrices, type DistortionEvent } from './adjustment';
import { computeChipSnapshot, type ChipResult } from './chip';
import { computeTechnicalSnapshot, type TechnicalResult } from './technical';

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
  technical: TechnicalResult;
  chip: ChipResult;
  appliedAdjustments: DistortionEvent[];
};

export async function analyseStock(stockId: string, stockName: string): Promise<StockAnalysis> {
  const [priceCache, institutionalCache, dividendCache, splitCache] = await Promise.all([
    readCachedDataset('TaiwanStockPrice', stockId),
    readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
    readCachedDataset('TaiwanStockDividendResult', stockId),
    readCachedDataset('TaiwanStockSplitPrice', stockId),
  ]);

  const raw = (priceCache?.payload ?? []) as PriceRow[];
  const institutional = (institutionalCache?.payload ?? []) as InstitutionalRow[];

  // 先還原再計算，均線與乖離才不會被除權息與分割的帳面跳空拉偏
  const { prices, appliedEvents } = adjustPrices({
    prices: raw,
    dividends: (dividendCache?.payload ?? []) as AdjustmentEventRow[],
    splits: (splitCache?.payload ?? []) as AdjustmentEventRow[],
  });

  return {
    stockId,
    stockName,
    priceDate: priceCache?.tradeDate || null,
    technical: computeTechnicalSnapshot(prices),
    chip: computeChipSnapshot({ institutional, prices }),
    appliedAdjustments: appliedEvents,
  };
}

/** 最新一份庫存快照裡每一檔的狀態。沒有庫存時回傳空陣列，且不讀取任何市場資料。 */
export async function analyseHoldings(): Promise<StockAnalysis[]> {
  const holdings = await readHoldingsSnapshot();

  return Promise.all(holdings.map((holding) => analyseStock(holding.stockId, holding.stockName)));
}
