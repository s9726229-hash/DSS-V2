import { describe, expect, it } from 'vitest';
import type { StoredTransaction } from '../storage/types';
import { identifyPositionEvents, selectEntries } from './positions';
import { RESEARCH_FROM_DATE } from './runResearch';
import { buildTransactionLog, summarizeTransactionLog } from './transactionLog';

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: `id-${Math.random()}`,
    tradeDate: '2026-03-02',
    stockId: '2330',
    stockName: '台積電',
    side: 'buy',
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

/** 首次建立部位 → 賣光 → 再進場 → 加碼 → 現沖，五種分類各一。 */
function everyKind(): StoredTransaction[] {
  return [
    tx({ id: 'a', tradeDate: '2026-02-02' }),
    tx({ id: 'b', tradeDate: '2026-02-10', side: 'sell' }),
    tx({ id: 'c', tradeDate: '2026-03-02' }),
    tx({ id: 'd', tradeDate: '2026-03-09' }),
    tx({ id: 'e', tradeDate: '2026-03-16', tradeType: '現沖' }),
  ];
}

describe('交易歷史', () => {
  it('五種分類各自標記', () => {
    const rows = buildTransactionLog(everyKind());
    const byId = new Map(rows.map((row) => [row.transactionId, row.kind]));

    expect(byId.get('a')).toBe('entry');
    expect(byId.get('b')).toBe('exit');
    expect(byId.get('c')).toBe('reentry');
    expect(byId.get('d')).toBe('add-on');
    expect(byId.get('e')).toBe('day-trade');
  });

  it('現沖的分類蓋過買賣別，不會顯示成加碼', () => {
    const rows = buildTransactionLog([tx({ id: 'only', tradeType: '現沖' })]);

    expect(rows[0].kind).toBe('day-trade');
    expect(rows[0].side).toBe('buy');
  });

  it('賣出列的買賣別是賣', () => {
    const rows = buildTransactionLog([tx({ id: 'x' }), tx({ id: 'y', side: 'sell' })]);

    expect(rows.find((row) => row.transactionId === 'y')?.side).toBe('sell');
  });

  it('只有研究期間內的首次建立部位列入本輪', () => {
    const rows = buildTransactionLog(everyKind());
    const included = rows.filter((row) => row.includedInResearch);

    expect(included.map((row) => row.transactionId)).toEqual(['a']);
  });

  it('未列入的每一列都說明原因', () => {
    const rows = buildTransactionLog(everyKind());
    const reasons = new Map(rows.map((row) => [row.transactionId, row.exclusionReason]));

    expect(reasons.get('a')).toBeNull();
    expect(reasons.get('b')).toBe('exit');
    expect(reasons.get('c')).toBe('reentry');
    expect(reasons.get('d')).toBe('add-on');
    expect(reasons.get('e')).toBe('day-trade');
  });

  it('研究期間之前的建立部位標為不在研究期間', () => {
    const rows = buildTransactionLog([tx({ id: 'old', tradeDate: '2025-11-03' })]);

    expect(rows[0]).toMatchObject({
      kind: 'entry',
      includedInResearch: false,
      exclusionReason: 'before-research-window',
    });
  });

  /**
   * 這一條是整個模組的重點：列入與否只能由 selectEntries 決定。
   * 若哪天有人在這裡重寫一份判斷式，頁面就會再次與引擎分岔。
   */
  it('列入本輪的集合與 selectEntries 完全一致', () => {
    const transactions = [
      ...everyKind(),
      tx({ id: 'f', tradeDate: '2025-12-01', stockId: '2454', stockName: '聯發科' }),
      tx({ id: 'g', tradeDate: '2026-04-01', stockId: '2454', stockName: '聯發科' }),
      tx({ id: 'h', tradeDate: '2026-04-20', stockId: '0050', stockName: '元大台灣50' }),
    ];

    const fromLog = buildTransactionLog(transactions)
      .filter((row) => row.includedInResearch)
      .map((row) => row.transactionId)
      .sort();

    const fromEngine = selectEntries(identifyPositionEvents(transactions))
      .filter((entry) => entry.tradeDate >= RESEARCH_FROM_DATE)
      .map((entry) => entry.transactionId)
      .sort();

    expect(fromLog).toEqual(fromEngine);
  });

  it('日期由新到舊，同一天維持原本先後', () => {
    const rows = buildTransactionLog([
      tx({ id: 'first', tradeDate: '2026-03-02' }),
      tx({ id: 'second', tradeDate: '2026-03-02' }),
      tx({ id: 'later', tradeDate: '2026-04-01' }),
    ]);

    expect(rows.map((row) => row.transactionId)).toEqual(['later', 'first', 'second']);
  });

  it('保留股數、價格與當下持股供核對', () => {
    const rows = buildTransactionLog([
      tx({ id: 'one', quantity: 2000, price: 123.5 }),
      tx({ id: 'two', tradeDate: '2026-03-05', quantity: 1000 }),
    ]);

    expect(rows.find((row) => row.transactionId === 'one')).toMatchObject({
      quantity: 2000,
      price: 123.5,
      positionAfter: 2000,
    });
    expect(rows.find((row) => row.transactionId === 'two')?.positionAfter).toBe(3000);
  });

  it('沒有交易時回傳空陣列', () => {
    expect(buildTransactionLog([])).toEqual([]);
  });
});

describe('交易歷史統計', () => {
  it('各分類筆數加總等於總筆數', () => {
    const summary = summarizeTransactionLog(buildTransactionLog(everyKind()));
    const kindTotal = Object.values(summary.byKind).reduce((sum, count) => sum + count, 0);

    expect(summary.total).toBe(5);
    expect(kindTotal).toBe(summary.total);
  });

  it('分別數出五種分類與列入本輪的筆數', () => {
    const summary = summarizeTransactionLog(buildTransactionLog(everyKind()));

    expect(summary.byKind).toEqual({
      entry: 1,
      reentry: 1,
      'add-on': 1,
      exit: 1,
      'day-trade': 1,
    });
    expect(summary.included).toBe(1);
  });

  it('沒有交易時所有計數都是零', () => {
    const summary = summarizeTransactionLog([]);

    expect(summary.total).toBe(0);
    expect(summary.included).toBe(0);
    expect(summary.byKind.entry).toBe(0);
  });
});
