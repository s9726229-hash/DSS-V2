import { describe, expect, it } from 'vitest';
import type { StoredTransaction } from '../storage/types';
import { buildResearchLedger } from './positionLedger';
import { buildTransactionLog, summarizeTransactionLog } from './transactionLog';

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: `id-${Math.random()}`,
    tradeDate: '2026-03-02',
    stockId: '2330',
    stockName: '台積電',
    side: 'buy',
    tradeMethod: '普通',
    tradeType: '現股',
    quantity: 1000,
    price: 500,
    fees: 0,
    tax: 0,
    settlementDate: null,
    brokerReference: null,
    importedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function log(transactions: StoredTransaction[], missing = false) {
  const ledger = buildResearchLedger({
    transactions,
    splitsByStock: new Map(
      [...new Set(transactions.map((row) => row.stockId))].map((stockId) => [
        stockId,
        missing ? { status: 'missing' as const, rows: [] } : { status: 'available' as const, rows: [] },
      ]),
    ),
  });
  return buildTransactionLog(ledger);
}

describe('帳本交易歷史', () => {
  it('建立、加碼、賣出與再進場沿用帳本分類', () => {
    const rows = log([
      tx({ id: 'a' }),
      tx({ id: 'b', tradeDate: '2026-03-03' }),
      tx({ id: 'c', tradeDate: '2026-03-04', side: 'sell', quantity: 2000 }),
      tx({ id: 'd', tradeDate: '2026-03-05' }),
    ]);
    const kinds = new Map(rows.map((row) => [row.transactionId, row.kind]));
    expect(kinds).toEqual(new Map([['d', 'reentry'], ['c', 'exit'], ['b', 'add-on'], ['a', 'entry']]));
  });

  it('期初部位不明直接顯示帳本排除原因', () => {
    const rows = log([tx({ id: 'sell', side: 'sell' }), tx({ id: 'buy', tradeDate: '2026-03-03' })]);
    expect(rows.every((row) => row.includedInResearch === false)).toBe(true);
    expect(rows.every((row) => row.exclusionReason === 'opening-position-unknown')).toBe(true);
  });

  it('拆股資料缺漏不會被列入研究', () => {
    expect(log([tx({ id: 'a' })], true)[0]).toMatchObject({
      includedInResearch: false,
      exclusionReason: 'split-data-missing',
    });
  });

  it('同日同方向交易顯示合併後事件', () => {
    expect(log([tx({ id: 'a', quantity: 100 }), tx({ id: 'b', quantity: 300 })])[0]).toMatchObject({
      transactionId: 'a,b',
      quantity: 400,
    });
  });

  it('摘要加總與列入數正確', () => {
    const summary = summarizeTransactionLog(log([tx({ id: 'a' }), tx({ id: 'b', tradeDate: '2026-03-03' })]));
    expect(summary.total).toBe(2);
    expect(summary.included).toBe(2);
    expect(Object.values(summary.byKind).reduce((sum, value) => sum + value, 0)).toBe(2);
  });
});
