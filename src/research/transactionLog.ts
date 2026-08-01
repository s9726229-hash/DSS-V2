import type { TransactionSide } from '../import/types';
import type { StoredTransaction } from '../storage/types';
import { identifyPositionEvents, selectEntries, type PositionEvent } from './positions';
import { RESEARCH_FROM_DATE } from './runResearch';

/**
 * 交易歷史的顯示分類。
 *
 * 比 PositionEvent 的三分類再細一層：再進場從建立部位裡拆出來，
 * 現沖獨立成一類，因為這兩者正是使用者最需要看清楚的排除原因。
 */
export type TransactionLogKind = 'entry' | 'reentry' | 'add-on' | 'exit' | 'day-trade';

/** 未列入本輪研究的原因。 */
export type ExclusionReason =
  | 'reentry'
  | 'add-on'
  | 'exit'
  | 'day-trade'
  | 'before-research-window';

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
  /** 這筆交易之後該股票的累計持股。 */
  positionAfter: number;
  includedInResearch: boolean;
  /** 已列入時為 null。 */
  exclusionReason: ExclusionReason | null;
};

export type TransactionLogSummary = {
  total: number;
  included: number;
  byKind: Record<TransactionLogKind, number>;
};

/** 現沖當沖進出不構成部位，分類上蓋過買賣別。 */
const DAY_TRADE_TYPE = '現沖';

function displayKind(event: PositionEvent): TransactionLogKind {
  if (event.tradeType === DAY_TRADE_TYPE) return 'day-trade';
  if (event.kind === 'exit') return 'exit';
  if (event.kind === 'add-on') return 'add-on';
  return event.isReentry ? 'reentry' : 'entry';
}

/** entry 與 add-on 都是買進，只有 exit 是賣出。 */
function sideOf(event: PositionEvent): TransactionSide {
  return event.kind === 'exit' ? 'sell' : 'buy';
}

function exclusionReason(
  kind: TransactionLogKind,
  tradeDate: string,
  from: string,
): ExclusionReason | null {
  if (kind !== 'entry') return kind;
  /*
   * 走到這裡代表是研究期間內、非再進場的建立部位卻沒被列入。
   * 目前不可能發生；真的發生時寧可留白，也不要編一個理由給使用者看。
   */
  return tradeDate < from ? 'before-research-window' : null;
}

/**
 * 把交易明細攤成可核對的一覽，標出每筆的分類與是否列入本輪研究。
 *
 * 「是否列入」一律由 selectEntries 決定後比對交易編號，不在這裡重寫判斷式——
 * 只要規則有第二份實作，這頁遲早會與研究結果分岔。
 */
export function buildTransactionLog(
  transactions: readonly StoredTransaction[],
  from = RESEARCH_FROM_DATE,
): TransactionLogRow[] {
  const events = identifyPositionEvents(transactions);
  const includedIds = new Set(
    selectEntries(events)
      .filter((entry) => entry.tradeDate >= from)
      .map((entry) => entry.transactionId),
  );

  const rows = events.map((event): TransactionLogRow => {
    const kind = displayKind(event);
    const includedInResearch = includedIds.has(event.transactionId);

    return {
      transactionId: event.transactionId,
      tradeDate: event.tradeDate,
      stockId: event.stockId,
      stockName: event.stockName,
      tradeType: event.tradeType,
      side: sideOf(event),
      kind,
      quantity: event.quantity,
      price: event.price,
      positionAfter: event.positionAfter,
      includedInResearch,
      exclusionReason: includedInResearch ? null : exclusionReason(kind, event.tradeDate, from),
    };
  });

  /*
   * identifyPositionEvents 依日期由舊到新排列。
   * 這裡改為由新到舊，而 Array.sort 是穩定排序，
   * 同一天的多筆交易因此保留原本的先後（建立部位在加碼之上）。
   */
  return rows.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
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
