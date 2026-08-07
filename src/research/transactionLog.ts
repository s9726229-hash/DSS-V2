import type { TransactionSide } from '../import/types';
import type { LedgerIssueCode, ResearchLedger } from './positionLedger';
import { RESEARCH_FROM_DATE } from './runResearch';

export type TransactionLogKind = 'entry' | 'reentry' | 'add-on' | 'exit' | 'day-trade';
export type ExclusionReason = LedgerIssueCode | 'exit' | 'before-research-window';

export type TransactionLogRow = {
  transactionId: string;
  tradeDate: string;
  stockId: string;
  stockName: string;
  tradeType: string;
  side: TransactionSide;
  kind: TransactionLogKind;
  quantity: number;
  price: number;
  positionAfter: number;
  includedInResearch: boolean;
  exclusionReason: ExclusionReason | null;
};

export type TransactionLogSummary = {
  total: number;
  included: number;
  byKind: Record<TransactionLogKind, number>;
};

export function buildTransactionLog(
  ledger: ResearchLedger,
  from = RESEARCH_FROM_DATE,
): TransactionLogRow[] {
  return ledger.events
    .map((event): TransactionLogRow => {
      const kind: TransactionLogKind = event.issues.includes('day-trade')
        ? 'day-trade'
        : event.scenario === 'establish'
          ? 'entry'
          : event.scenario === 'reentry'
            ? 'reentry'
            : event.scenario === 'add-on'
              ? 'add-on'
              : 'exit';
      const includedInResearch =
        event.includeInScenarioResearch && event.scenario !== null && event.tradeDate >= from;
      const exclusionReason = includedInResearch
        ? null
        : event.issues[0] ?? (event.tradeDate < from ? 'before-research-window' : 'exit');

      return {
        transactionId: event.transactionIds.join(','),
        tradeDate: event.tradeDate,
        stockId: event.stockId,
        stockName: event.stockName,
        tradeType: event.issues.includes('day-trade')
          ? '現沖'
          : event.issues.includes('non-cash-position')
            ? '非現股'
            : '現股',
        side: event.scenario === null ? 'sell' : 'buy',
        kind,
        quantity: event.quantity,
        price: event.executionPrice,
        positionAfter: event.positionAfter ?? 0,
        includedInResearch,
        exclusionReason,
      };
    })
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

export function summarizeTransactionLog(
  rows: readonly TransactionLogRow[],
): TransactionLogSummary {
  const byKind: Record<TransactionLogKind, number> = {
    entry: 0,
    reentry: 0,
    'add-on': 0,
    exit: 0,
    'day-trade': 0,
  };
  let included = 0;
  for (const row of rows) {
    byKind[row.kind] += 1;
    if (row.includedInResearch) included += 1;
  }
  return { total: rows.length, included, byKind };
}
