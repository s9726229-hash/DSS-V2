import { readProfile } from '../profile/profileStore';
import { identifyPositionEvents } from '../research/positions';
import { readHoldingsSnapshot, readTransactions } from '../storage/portfolio';
import { groupByTopic, type TopicGroup } from '../watchlist/watchlist';
import { readWatchlist } from '../watchlist/watchlistStore';
import { analyseStock, type StockAnalysis } from './analyseHoldings';
import {
  buildHoldingCard,
  buildWatchCard,
  latestEntryDates,
  type HoldingCard,
  type WatchCard,
} from './holdingCard';

export type TodayView = {
  holdings: HoldingCard[];
  watches: WatchCard[];
  /** 觀察清單依題材分組，順序即顯示順序。 */
  groups: TopicGroup[];
};

/**
 * 今日 DSS 的內容。
 *
 * 只讀本機快取與本機資料，不發出任何網路請求——同步是資料狀態列的獨立動作，
 * 開啟這一頁不應該消耗 FinMind 額度。
 *
 * 同一檔即使同時是庫存與觀察標的，也只計算一次：規格要求同一標的共用同一份
 * 資料與計算結果，各算各的會讓同一檔在兩處顯示不同判定。
 */
export async function loadTodayView(): Promise<TodayView> {
  const [holdings, transactions, profile, watchlist] = await Promise.all([
    readHoldingsSnapshot(),
    readTransactions(),
    readProfile(),
    readWatchlist(),
  ]);

  const entryDates = latestEntryDates(identifyPositionEvents(transactions));

  const names = new Map<string, string>();
  for (const holding of holdings) names.set(holding.stockId, holding.stockName);
  for (const entry of watchlist.entries) {
    if (!names.has(entry.stockId)) names.set(entry.stockId, entry.stockName);
  }

  const analyses = new Map<string, StockAnalysis>();
  for (const [stockId, stockName] of names) {
    analyses.set(stockId, await analyseStock(stockId, stockName));
  }

  // names 由庫存與觀察建成，因此這裡的取值一定命中
  const analysisOf = (stockId: string) => analyses.get(stockId) as StockAnalysis;

  return {
    holdings: holdings.map((holding) =>
      buildHoldingCard({
        holding,
        analysis: analysisOf(holding.stockId),
        profile,
        entryDate: entryDates.get(holding.stockId) ?? null,
      }),
    ),
    watches: watchlist.entries.map((entry) =>
      buildWatchCard({ entry, analysis: analysisOf(entry.stockId), profile }),
    ),
    groups: groupByTopic(watchlist),
  };
}
