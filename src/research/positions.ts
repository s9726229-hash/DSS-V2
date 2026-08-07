import type { StoredTransaction } from '../storage/types';
import { buildResearchLedger, type LedgerEvent, type SplitHistoryByStock } from './positionLedger';

/** @deprecated 新功能請直接使用 positionLedger。 */
export type PositionEventKind = 'entry' | 'add-on' | 'exit';

/** @deprecated 新功能請直接使用 LedgerEvent。 */
export type PositionEvent = {
  transactionId: string;
  tradeDate: string;
  stockId: string;
  stockName: string;
  tradeType: string;
  kind: PositionEventKind;
  isReentry: boolean;
  quantity: number;
  price: number;
  positionBefore: number;
  averageCostBefore: number | null;
  positionAfter: number;
  /** 相容期內保留帳本的研究資格，避免舊篩選器納入不可靠事件。 */
  includeInScenarioResearch?: boolean;
};

export type ResearchEventKind = 'establish' | 'add-on' | 'reentry';

function availableEmptySplits(transactions: readonly StoredTransaction[]): SplitHistoryByStock {
  return new Map(
    [...new Set(transactions.map((row) => row.stockId))].map((stockId) => [
      stockId,
      { status: 'available' as const, rows: [] },
    ]),
  );
}

function expandLegacyEvent(
  event: LedgerEvent,
  rows: readonly StoredTransaction[],
): PositionEvent[] {
  let held = event.positionBefore ?? 0;
  let averageCost = event.averageCostBefore;

  return rows.map((row) => {
    const positionBefore = held;
    const averageCostBefore = held === 0 ? null : averageCost;
    const cash = row.tradeType === '現股';
    const isEntry = cash && row.side === 'buy' && held === 0;
    const kind: PositionEventKind = row.side === 'sell' ? 'exit' : isEntry ? 'entry' : 'add-on';

    if (cash && row.side === 'buy') {
      if (averageCost !== null && held > 0) {
        averageCost = (averageCost * held + row.price * row.quantity) / (held + row.quantity);
      } else if (held === 0) {
        averageCost = row.price;
      }
      held += row.quantity;
    } else if (cash && row.side === 'sell') {
      held = Math.max(0, held - row.quantity);
      if (held === 0) averageCost = null;
    }

    return {
      transactionId: row.id,
      tradeDate: row.tradeDate,
      stockId: row.stockId,
      stockName: row.stockName,
      tradeType: row.tradeType,
      kind,
      isReentry: isEntry && event.scenario === 'reentry',
      quantity: row.quantity,
      price: row.price,
      positionBefore,
      averageCostBefore,
      positionAfter: held,
      includeInScenarioResearch: event.includeInScenarioResearch,
    };
  });
}

/**
 * 舊版介面的薄相容層。分類、同日合併與成本計算全部委派給研究帳本，
 * 待舊呼叫端於後續切片搬完即可移除。
 */
export function identifyPositionEvents(
  transactions: readonly StoredTransaction[],
): PositionEvent[] {
  const byId = new Map(transactions.map((row) => [row.id, row]));
  const ledger = buildResearchLedger({
    transactions,
    splitsByStock: availableEmptySplits(transactions),
  });

  return ledger.events.flatMap((event) => {
    const rows = event.transactionIds
      .map((id) => byId.get(id))
      .filter((row): row is StoredTransaction => row !== undefined);
    return expandLegacyEvent(event, rows);
  });
}

export function selectEntries(
  events: readonly PositionEvent[],
  { includeReentries = false }: { includeReentries?: boolean } = {},
): PositionEvent[] {
  return events.filter(
    (event) =>
      event.kind === 'entry' &&
      (includeReentries || !event.isReentry),
  );
}

function matchesResearchKind(event: PositionEvent, kind: ResearchEventKind): boolean {
  if (kind === 'add-on') return event.kind === 'add-on';
  if (kind === 'reentry') return event.kind === 'entry' && event.isReentry;
  return event.kind === 'entry' && !event.isReentry;
}

/** @deprecated 新研究流程直接篩選帳本事件；此處保留 V1 的同日合併輸出。 */
export function selectResearchEvents(
  events: readonly PositionEvent[],
  kind: ResearchEventKind,
): PositionEvent[] {
  const grouped = new Map<string, PositionEvent[]>();
  for (const event of events) {
    if (!matchesResearchKind(event, kind)) continue;
    const key = `${event.stockId}:${event.tradeDate}`;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    const last = group[group.length - 1];
    const quantity = group.reduce((sum, event) => sum + event.quantity, 0);
    return {
      ...first,
      transactionId: group.map((event) => event.transactionId).join(','),
      quantity,
      price: group.reduce((sum, event) => sum + event.price * event.quantity, 0) / quantity,
      positionAfter: last.positionAfter,
    };
  });
}
