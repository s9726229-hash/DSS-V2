import { readProfile } from '../profile/profileStore';
import { identifyPositionEvents } from '../research/positions';
import { readHoldingsSnapshot, readTransactions } from '../storage/portfolio';
import { analyseStock } from './analyseHoldings';
import { buildHoldingCard, latestEntryDates, type HoldingCard } from './holdingCard';

/**
 * 今日 DSS 的持股卡。
 *
 * 只讀本機快取與本機資料，不發出任何網路請求——同步是資料狀態列的獨立動作，
 * 開啟這一頁不應該消耗 FinMind 額度。
 */
export async function loadHoldingCards(): Promise<HoldingCard[]> {
  const [holdings, transactions, profile] = await Promise.all([
    readHoldingsSnapshot(),
    readTransactions(),
    readProfile(),
  ]);

  const entryDates = latestEntryDates(identifyPositionEvents(transactions));

  return Promise.all(
    holdings.map(async (holding) =>
      buildHoldingCard({
        holding,
        analysis: await analyseStock(holding.stockId, holding.stockName),
        profile,
        entryDate: entryDates.get(holding.stockId) ?? null,
      }),
    ),
  );
}
