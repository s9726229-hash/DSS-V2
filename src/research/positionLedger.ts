import type { AdjustmentEventRow } from '../market/types';
import type { StoredTransaction } from '../storage/types';
import type { ResearchScenario } from './runResearch';

export type LedgerIssueCode =
  | 'opening-position-unknown'
  | 'same-day-opposite-sides'
  | 'scheduled-investment'
  | 'trade-method-unknown'
  | 'non-cash-position'
  | 'day-trade'
  | 'split-data-missing';

export type SplitHistory =
  | { status: 'available'; rows: AdjustmentEventRow[] }
  | { status: 'missing'; rows: [] };

export type SplitHistoryByStock = Map<string, SplitHistory>;

export type LedgerEvent = {
  transactionIds: string[];
  tradeDate: string;
  stockId: string;
  stockName: string;
  scenario: ResearchScenario | null;
  quantity: number;
  executionPrice: number;
  positionBefore: number | null;
  positionAfter: number | null;
  averageCostBefore: number | null;
  relativeCostPercent: number | null;
  includeInScenarioResearch: boolean;
  relativeCostAvailable: boolean;
  issues: LedgerIssueCode[];
};

export type PositionLedgerState = {
  shares: number;
  averageCost: number | null;
  costReliable: boolean;
  everHeld: boolean;
};

export type StockLedgerStatus =
  | 'reliable'
  | 'opening-unknown'
  | 'cost-ambiguous'
  | 'split-missing';

export type ResearchLedger = {
  events: LedgerEvent[];
  excludedByCode: Record<LedgerIssueCode, number>;
  stockStatus: Map<string, StockLedgerStatus>;
  currentPositions: Map<string, PositionLedgerState>;
};

export type BuildResearchLedgerInput = {
  transactions: readonly StoredTransaction[];
  splitsByStock: SplitHistoryByStock;
};

const ISSUE_CODES: LedgerIssueCode[] = [
  'opening-position-unknown',
  'same-day-opposite-sides',
  'scheduled-investment',
  'trade-method-unknown',
  'non-cash-position',
  'day-trade',
  'split-data-missing',
];

function emptyIssueCounts(): Record<LedgerIssueCode, number> {
  return Object.fromEntries(ISSUE_CODES.map((code) => [code, 0])) as Record<
    LedgerIssueCode,
    number
  >;
}

function isDayTrade(row: StoredTransaction): boolean {
  return row.tradeType.includes('現沖');
}

function isCashPosition(row: StoredTransaction): boolean {
  return row.tradeType === '現股';
}

function methodIssue(row: StoredTransaction): LedgerIssueCode | null {
  const method = row.tradeMethod?.trim();
  if (method === '普通') return null;
  if (method?.includes('定期定額')) return 'scheduled-investment';
  return 'trade-method-unknown';
}

function uniqueIssues(issues: readonly (LedgerIssueCode | null)[]): LedgerIssueCode[] {
  return [...new Set(issues.filter((issue): issue is LedgerIssueCode => issue !== null))];
}

function weightedPrice(rows: readonly StoredTransaction[]): number {
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (quantity === 0) return 0;
  return rows.reduce((sum, row) => sum + row.quantity * row.price, 0) / quantity;
}

function scenarioForBuy(state: PositionLedgerState): ResearchScenario {
  if (state.shares > 0) return 'add-on';
  return state.everHeld ? 'reentry' : 'establish';
}

function makeEvent(
  rows: readonly StoredTransaction[],
  values: Omit<
    LedgerEvent,
    'transactionIds' | 'tradeDate' | 'stockId' | 'stockName' | 'quantity' | 'executionPrice'
  >,
): LedgerEvent {
  const first = rows[0];
  return {
    transactionIds: rows.map((row) => row.id),
    tradeDate: first.tradeDate,
    stockId: first.stockId,
    stockName: first.stockName,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    executionPrice: weightedPrice(rows),
    ...values,
  };
}

function groupByDate(rows: readonly StoredTransaction[]): Map<string, StoredTransaction[]> {
  const grouped = new Map<string, StoredTransaction[]>();
  for (const row of rows) {
    const group = grouped.get(row.tradeDate) ?? [];
    group.push(row);
    grouped.set(row.tradeDate, group);
  }
  return grouped;
}

function applySplit(state: PositionLedgerState, row: AdjustmentEventRow): void {
  if (state.shares === 0 || row.before_price <= 0 || row.after_price <= 0) return;
  const factor = row.after_price / row.before_price;
  state.shares /= factor;
  if (state.averageCost !== null) state.averageCost *= factor;
}

function openingPositionUnknown(rows: readonly StoredTransaction[]): boolean {
  const cash = rows.filter(isCashPosition);
  if (cash.length === 0) return false;
  const firstDate = cash.reduce(
    (earliest, row) => (row.tradeDate < earliest ? row.tradeDate : earliest),
    cash[0].tradeDate,
  );
  const firstDay = cash.filter((row) => row.tradeDate === firstDate);
  return firstDay.every((row) => row.side === 'sell');
}

function blockedEvent(
  rows: readonly StoredTransaction[],
  issue: LedgerIssueCode,
): LedgerEvent {
  return makeEvent(rows, {
    scenario: null,
    positionBefore: null,
    positionAfter: null,
    averageCostBefore: null,
    relativeCostPercent: null,
    includeInScenarioResearch: false,
    relativeCostAvailable: false,
    issues: [issue],
  });
}

function processNonCash(
  rows: readonly StoredTransaction[],
  state: PositionLedgerState,
): LedgerEvent[] {
  return rows.map((row) =>
    makeEvent([row], {
      scenario: null,
      positionBefore: state.shares,
      positionAfter: state.shares,
      averageCostBefore: state.costReliable ? state.averageCost : null,
      relativeCostPercent: null,
      includeInScenarioResearch: false,
      relativeCostAvailable: false,
      issues: [isDayTrade(row) ? 'day-trade' : 'non-cash-position'],
    }),
  );
}

function processOppositeDay(
  rows: readonly StoredTransaction[],
  state: PositionLedgerState,
  splitMissing: boolean,
): LedgerEvent {
  const positionBefore = state.shares;
  const bought = rows
    .filter((row) => row.side === 'buy')
    .reduce((sum, row) => sum + row.quantity, 0);
  const sold = rows
    .filter((row) => row.side === 'sell')
    .reduce((sum, row) => sum + row.quantity, 0);
  state.shares = Math.max(0, state.shares + bought - sold);
  state.everHeld ||= state.shares > 0 || positionBefore > 0;
  state.averageCost = null;
  state.costReliable = state.shares === 0;

  return makeEvent(rows, {
    scenario: null,
    positionBefore,
    positionAfter: state.shares,
    averageCostBefore: null,
    relativeCostPercent: null,
    includeInScenarioResearch: false,
    relativeCostAvailable: false,
    issues: uniqueIssues([
      'same-day-opposite-sides',
      ...rows.map(methodIssue),
      splitMissing ? 'split-data-missing' : null,
    ]),
  });
}

function processCashDirection(
  rows: readonly StoredTransaction[],
  state: PositionLedgerState,
  splitMissing: boolean,
): LedgerEvent {
  const first = rows[0];
  const positionBefore = state.shares;
  const averageCostBefore = state.costReliable ? state.averageCost : null;
  const issues = uniqueIssues([
    ...rows.map(methodIssue),
    splitMissing ? 'split-data-missing' : null,
  ]);

  if (first.side === 'sell') {
    state.shares = Math.max(0, state.shares - rows.reduce((sum, row) => sum + row.quantity, 0));
    if (state.shares === 0) {
      state.averageCost = null;
      state.costReliable = true;
    }
    return makeEvent(rows, {
      scenario: null,
      positionBefore,
      positionAfter: state.shares,
      averageCostBefore,
      relativeCostPercent: null,
      includeInScenarioResearch: false,
      relativeCostAvailable: false,
      issues,
    });
  }

  const scenario = scenarioForBuy(state);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const executionPrice = weightedPrice(rows);
  const relativeCostAvailable =
    scenario === 'add-on' && state.costReliable && averageCostBefore !== null;
  const relativeCostPercent = relativeCostAvailable
    ? ((executionPrice - averageCostBefore) / averageCostBefore) * 100
    : null;

  if (state.shares === 0) {
    state.averageCost = executionPrice;
    state.costReliable = true;
  } else if (state.costReliable && state.averageCost !== null) {
    state.averageCost =
      (state.averageCost * state.shares + executionPrice * quantity) / (state.shares + quantity);
  } else {
    state.averageCost = null;
  }
  state.shares += quantity;
  state.everHeld = true;

  return makeEvent(rows, {
    scenario,
    positionBefore,
    positionAfter: state.shares,
    averageCostBefore,
    relativeCostPercent,
    includeInScenarioResearch: issues.length === 0,
    relativeCostAvailable,
    issues,
  });
}

function buildStockLedger(
  rows: readonly StoredTransaction[],
  splitHistory: SplitHistory | undefined,
): { events: LedgerEvent[]; state: PositionLedgerState; status: StockLedgerStatus } {
  const state: PositionLedgerState = {
    shares: 0,
    averageCost: null,
    costReliable: true,
    everHeld: false,
  };
  const sorted = [...rows].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const byDate = groupByDate(sorted);
  const splitMissing = !splitHistory || splitHistory.status === 'missing';

  if (openingPositionUnknown(sorted)) {
    return {
      events: [...byDate.values()].map((group) => blockedEvent(group, 'opening-position-unknown')),
      state: { ...state, costReliable: false },
      status: 'opening-unknown',
    };
  }

  const splitsByDate = new Map<string, AdjustmentEventRow[]>();
  if (splitHistory?.status === 'available') {
    for (const split of splitHistory.rows) {
      const group = splitsByDate.get(split.date) ?? [];
      group.push(split);
      splitsByDate.set(split.date, group);
    }
  }

  const dates = [...new Set([...byDate.keys(), ...splitsByDate.keys()])].sort();
  const events: LedgerEvent[] = [];
  for (const date of dates) {
    for (const split of splitsByDate.get(date) ?? []) applySplit(state, split);
    const dayRows = byDate.get(date) ?? [];
    if (dayRows.length === 0) continue;

    const cash = dayRows.filter(isCashPosition);
    events.push(...processNonCash(dayRows.filter((row) => !isCashPosition(row)), state));
    if (cash.length === 0) continue;

    const sides = new Set(cash.map((row) => row.side));
    if (sides.size > 1) {
      events.push(processOppositeDay(cash, state, splitMissing));
    } else {
      events.push(processCashDirection(cash, state, splitMissing));
    }
  }

  const status = splitMissing ? 'split-missing' : state.costReliable ? 'reliable' : 'cost-ambiguous';
  if (splitMissing) state.costReliable = false;
  return { events, state, status };
}

export function buildResearchLedger({
  transactions,
  splitsByStock,
}: BuildResearchLedgerInput): ResearchLedger {
  const rowsByStock = new Map<string, StoredTransaction[]>();
  for (const row of transactions) {
    const rows = rowsByStock.get(row.stockId) ?? [];
    rows.push(row);
    rowsByStock.set(row.stockId, rows);
  }

  const events: LedgerEvent[] = [];
  const stockStatus: ResearchLedger['stockStatus'] = new Map();
  const currentPositions: ResearchLedger['currentPositions'] = new Map();
  for (const [stockId, rows] of rowsByStock) {
    const stock = buildStockLedger(rows, splitsByStock.get(stockId));
    events.push(...stock.events);
    stockStatus.set(stockId, stock.status);
    currentPositions.set(stockId, stock.state);
  }
  events.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const excludedByCode = emptyIssueCounts();
  for (const event of events) {
    for (const issue of event.issues) excludedByCode[issue] += 1;
  }

  return { events, excludedByCode, stockStatus, currentPositions };
}

export function selectLedgerEvents(
  ledger: ResearchLedger,
  scenario: ResearchScenario,
): LedgerEvent[] {
  return ledger.events.filter(
    (event) => event.scenario === scenario && event.includeInScenarioResearch,
  );
}
