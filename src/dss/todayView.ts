import { readProfile } from '../profile/profileStore';
import { loadResearchLedger } from '../research/loadLedger';
import type { PositionLedgerState, StockLedgerStatus } from '../research/positionLedger';
import type { ResearchScenario } from '../research/runResearch';
import { readHoldingsSnapshot } from '../storage/portfolio';
import { groupByTopic, type TopicGroup } from '../watchlist/watchlist';
import { readWatchlist } from '../watchlist/watchlistStore';
import { analyseStock, type StockAnalysis } from './analyseHoldings';
import {
  buildHoldingCard,
  buildWatchCard,
  type HoldingCard,
  type WatchCard,
} from './holdingCard';

export type TodayView = {
  holdings: HoldingCard[];
  watches: WatchCard[];
  /** 觀察清單依題材分組，順序即顯示順序。 */
  groups: TopicGroup[];
};

export function resolveTodayScenario({
  hasHolding,
  status,
  state,
}: {
  hasHolding: boolean;
  status: StockLedgerStatus | undefined;
  state: PositionLedgerState | undefined;
}): ResearchScenario | null {
  if (status !== undefined && status !== 'reliable') return null;
  if (hasHolding) return status === 'reliable' && state?.shares ? 'add-on' : null;
  return state?.everHeld ? 'reentry' : 'establish';
}

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
  const [holdings, ledger, profile, watchlist] = await Promise.all([
    readHoldingsSnapshot(),
    loadResearchLedger(),
    readProfile(),
    readWatchlist(),
  ]);

  const entryDates = new Map<string, string>();
  for (const event of ledger.events) {
    if (event.scenario !== 'establish' && event.scenario !== 'reentry') continue;
    if ((entryDates.get(event.stockId) ?? '') < event.tradeDate) entryDates.set(event.stockId, event.tradeDate);
  }
  const heldIds = new Set(holdings.map((holding) => holding.stockId));

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
        scenario: resolveTodayScenario({
          hasHolding: true,
          status: ledger.stockStatus.get(holding.stockId),
          state: ledger.currentPositions.get(holding.stockId),
        }),
        addOnCostBasis:
          ledger.stockStatus.get(holding.stockId) === 'reliable'
            ? ledger.currentPositions.get(holding.stockId)?.averageCost ?? null
            : null,
        entryDate: entryDates.get(holding.stockId) ?? null,
      }),
    ),
    watches: watchlist.entries.map((entry) =>
      buildWatchCard({
        entry,
        analysis: analysisOf(entry.stockId),
        profile,
        scenario: resolveTodayScenario({
          hasHolding: heldIds.has(entry.stockId),
          status: ledger.stockStatus.get(entry.stockId),
          state: ledger.currentPositions.get(entry.stockId),
        }),
      }),
    ),
    groups: groupByTopic(watchlist),
  };
}
