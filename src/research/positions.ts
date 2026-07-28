import type { StoredTransaction } from '../storage/types';

/**
 * 部位事件分類。
 *
 * - entry：持股為零時的買進，即建立部位
 * - add-on：已有持股時的買進，即加碼
 * - exit：賣出
 *
 * 規格要求第一輪研究只取建立部位，加碼與再進場須分開標記。
 * 但規格同時允許「同一股票多次建立部位，每筆都是獨立樣本」，
 * 對於「賣光後再買」該歸哪一類並未言明，因此此處一律視為 entry，
 * 另以 isReentry 標記，由研究頁決定是否納入。
 */
export type PositionEventKind = 'entry' | 'add-on' | 'exit';

export type PositionEvent = {
  transactionId: string;
  tradeDate: string;
  stockId: string;
  stockName: string;
  tradeType: string;
  kind: PositionEventKind;
  /** 此前曾持有並全數賣出後的再次建立部位。 */
  isReentry: boolean;
  quantity: number;
  price: number;
  /** 這筆交易之後該股票的累計持股。 */
  positionAfter: number;
};

/** 現沖當沖進出，不構成部位，也不列為建立部位樣本。 */
const DAY_TRADE_TYPE = '現沖';

type PositionState = {
  held: number;
  /** 是否曾經持有過，用來區分首次建立部位與再進場。 */
  everHeld: boolean;
};

export function identifyPositionEvents(
  transactions: readonly StoredTransaction[],
): PositionEvent[] {
  const sorted = [...transactions].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const state = new Map<string, PositionState>();
  const events: PositionEvent[] = [];

  for (const row of sorted) {
    const current = state.get(row.stockId) ?? { held: 0, everHeld: false };

    // 現沖不影響部位，但仍保留事件紀錄以免遺漏交易
    if (row.tradeType === DAY_TRADE_TYPE) {
      events.push({
        transactionId: row.id,
        tradeDate: row.tradeDate,
        stockId: row.stockId,
        stockName: row.stockName,
        tradeType: row.tradeType,
        kind: row.side === 'buy' ? 'add-on' : 'exit',
        isReentry: false,
        quantity: row.quantity,
        price: row.price,
        positionAfter: current.held,
      });
      continue;
    }

    let kind: PositionEventKind;
    let isReentry = false;
    let held: number;

    if (row.side === 'buy') {
      const isEntry = current.held === 0;
      kind = isEntry ? 'entry' : 'add-on';
      isReentry = isEntry && current.everHeld;
      held = current.held + row.quantity;
    } else {
      kind = 'exit';
      held = Math.max(0, current.held - row.quantity);
    }

    events.push({
      transactionId: row.id,
      tradeDate: row.tradeDate,
      stockId: row.stockId,
      stockName: row.stockName,
      tradeType: row.tradeType,
      kind,
      isReentry,
      quantity: row.quantity,
      price: row.price,
      positionAfter: held,
    });

    state.set(row.stockId, { held, everHeld: current.everHeld || held > 0 });
  }

  return events;
}

/** 只取建立部位；預設排除再進場，符合規格「第一輪只取建立部位」。 */
export function selectEntries(
  events: readonly PositionEvent[],
  { includeReentries = true }: { includeReentries?: boolean } = {},
): PositionEvent[] {
  return events.filter(
    (event) => event.kind === 'entry' && (includeReentries || !event.isReentry),
  );
}
