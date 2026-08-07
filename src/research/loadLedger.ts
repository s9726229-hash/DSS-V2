import { fetchDataset } from '../market/finmindClient';
import type { AdjustmentEventRow } from '../market/types';
import { coversRange, readCachedDataset, writeCachedDataset } from '../storage/marketCache';
import { readTransactions } from '../storage/portfolio';
import type { StoredTransaction } from '../storage/types';
import {
  buildResearchLedger,
  type ResearchLedger,
  type SplitHistoryByStock,
} from './positionLedger';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 400;

type StockRange = { stockId: string; startDate: string; endDate: string };

function cashRanges(transactions: readonly StoredTransaction[]): StockRange[] {
  const dates = new Map<string, string[]>();
  for (const row of transactions) {
    if (row.tradeType !== '現股') continue;
    const stockDates = dates.get(row.stockId) ?? [];
    stockDates.push(row.tradeDate);
    dates.set(row.stockId, stockDates);
  }
  return [...dates].map(([stockId, stockDates]) => {
    stockDates.sort();
    return { stockId, startDate: stockDates[0], endDate: stockDates[stockDates.length - 1] };
  });
}

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function chunkRange(range: StockRange): StockRange[] {
  const chunks: StockRange[] = [];
  const final = Date.parse(`${range.endDate}T00:00:00Z`);
  let start = Date.parse(`${range.startDate}T00:00:00Z`);

  while (start <= final) {
    const end = Math.min(final, start + MAX_RANGE_DAYS * DAY_MS);
    chunks.push({ stockId: range.stockId, startDate: isoDate(start), endDate: isoDate(end) });
    start = end + DAY_MS;
  }
  return chunks;
}

async function splitHistories(
  transactions: readonly StoredTransaction[],
): Promise<SplitHistoryByStock> {
  const histories: SplitHistoryByStock = new Map();
  const ranges = new Map(cashRanges(transactions).map((range) => [range.stockId, range]));

  for (const stockId of new Set(transactions.map((row) => row.stockId))) {
    const range = ranges.get(stockId);
    if (!range) {
      histories.set(stockId, { status: 'available', rows: [] });
      continue;
    }
    const cached = await readCachedDataset('TaiwanStockSplitPrice', stockId);
    histories.set(
      stockId,
      coversRange(cached, range.startDate, range.endDate)
        ? { status: 'available', rows: (cached?.payload ?? []) as AdjustmentEventRow[] }
        : { status: 'missing', rows: [] },
    );
  }
  return histories;
}

export async function loadResearchLedger(): Promise<ResearchLedger> {
  const transactions = await readTransactions();
  return buildResearchLedger({
    transactions,
    splitsByStock: await splitHistories(transactions),
  });
}

export type LedgerPreparationFailure = {
  stockId: string;
  startDate: string;
  endDate: string;
  message: string;
};

export type LedgerPreparationResult = {
  completed: number;
  total: number;
  failures: LedgerPreparationFailure[];
};

export async function prepareResearchLedgerData({
  now = new Date(),
}: { now?: Date } = {}): Promise<LedgerPreparationResult> {
  const transactions = await readTransactions();
  const requests: StockRange[] = [];

  for (const range of cashRanges(transactions)) {
    const cached = await readCachedDataset('TaiwanStockSplitPrice', range.stockId);
    if (!coversRange(cached, range.startDate, range.endDate)) requests.push(...chunkRange(range));
  }

  const failures: LedgerPreparationFailure[] = [];
  let completed = 0;
  for (const request of requests) {
    const result = await fetchDataset<AdjustmentEventRow>(
      'TaiwanStockSplitPrice',
      request.stockId,
      request,
    );
    if (result.ok) {
      await writeCachedDataset({
        dataset: 'TaiwanStockSplitPrice',
        stockId: request.stockId,
        rows: result.rows,
        tradeDate: null,
        retrievedAt: now.toISOString(),
        coverage: { startDate: request.startDate, endDate: request.endDate },
      });
    } else {
      failures.push({ ...request, message: result.message });
    }
    completed += 1;
  }

  return { completed, total: requests.length, failures };
}
