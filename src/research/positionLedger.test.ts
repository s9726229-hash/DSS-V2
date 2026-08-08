import { describe, expect, it } from 'vitest';
import type { StoredTransaction } from '../storage/types';
import { buildResearchLedger, selectLedgerEvents, type SplitHistory } from './positionLedger';

let sequence = 0;

function tx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  sequence += 1;
  return {
    id: `tx-${sequence}`,
    tradeDate: '2026-01-02',
    stockId: '2330',
    stockName: '台積電',
    side: 'buy',
    tradeMethod: '普通',
    tradeType: '現股',
    quantity: 1000,
    price: 100,
    fees: 0,
    tax: 0,
    settlementDate: null,
    brokerReference: null,
    importedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function splits(status: SplitHistory['status'] = 'available'): Map<string, SplitHistory> {
  return new Map([
    ['2330', status === 'available' ? { status, rows: [] } : { status, rows: [] }],
  ]);
}

describe('buildResearchLedger', () => {
  it('以加碼前均價與實際成交價計算相對成本', () => {
    const ledger = buildResearchLedger({
      transactions: [
        tx({ fees: 9999 }),
        tx({ tradeDate: '2026-01-05', price: 90, quantity: 500, fees: 9999, tax: 9999 }),
      ],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'add-on')[0]).toMatchObject({
      scenario: 'add-on',
      positionBefore: 1000,
      averageCostBefore: 100,
      executionPrice: 90,
      relativeCostPercent: -10,
      includeInScenarioResearch: true,
      relativeCostAvailable: true,
    });
  });

  it('部分賣出後每股均價維持不變', () => {
    const ledger = buildResearchLedger({
      transactions: [
        tx(),
        tx({ tradeDate: '2026-01-05', side: 'sell', quantity: 400, price: 120 }),
        tx({ tradeDate: '2026-01-08', quantity: 100, price: 80 }),
      ],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'add-on')[0]).toMatchObject({
      positionBefore: 600,
      averageCostBefore: 100,
      relativeCostPercent: -20,
    });
  });

  it('完全賣出後再次買進是再進場', () => {
    const ledger = buildResearchLedger({
      transactions: [
        tx(),
        tx({ tradeDate: '2026-01-05', side: 'sell' }),
        tx({ tradeDate: '2026-01-08', price: 105 }),
      ],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'reentry')).toHaveLength(1);
    expect(selectLedgerEvents(ledger, 'reentry')[0]).toMatchObject({
      tradeDate: '2026-01-08',
      positionBefore: 0,
      scenario: 'reentry',
    });
  });

  it('把零部位時的盤中零股買進辨識為建立部位', () => {
    const ledger = buildResearchLedger({
      transactions: [tx({ quantity: 50, tradeMethod: '盤中零股' })],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'establish')[0]).toMatchObject({
      scenario: 'establish',
      quantity: 50,
      includeInScenarioResearch: true,
    });
  });

  it('讓盤中零股依持倉狀態參與加碼與再進場研究', () => {
    const ledger = buildResearchLedger({
      transactions: [
        tx({ tradeDate: '2026-01-02', quantity: 100, price: 100 }),
        tx({ tradeDate: '2026-01-03', quantity: 50, price: 90, tradeMethod: '盤中零股' }),
        tx({ tradeDate: '2026-01-04', side: 'sell', quantity: 150, price: 110 }),
        tx({ tradeDate: '2026-01-05', quantity: 20, price: 80, tradeMethod: '盤中零股' }),
      ],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'add-on')[0]).toMatchObject({
      scenario: 'add-on',
      relativeCostPercent: -10,
      includeInScenarioResearch: true,
    });
    expect(selectLedgerEvents(ledger, 'reentry')[0]).toMatchObject({
      scenario: 'reentry',
      quantity: 20,
      includeInScenarioResearch: true,
    });
  });

  it('同日同方向買進依股數加權合併', () => {
    const first = tx({ quantity: 100, price: 90 });
    const second = tx({ quantity: 300, price: 110 });
    const ledger = buildResearchLedger({ transactions: [first, second], splitsByStock: splits() });

    expect(selectLedgerEvents(ledger, 'establish')[0]).toMatchObject({
      transactionIds: [first.id, second.id],
      quantity: 400,
      executionPrice: 105,
      positionAfter: 400,
    });
  });

  it('拆股先調整股數與均價，總成本不變', () => {
    const ledger = buildResearchLedger({
      transactions: [tx({ quantity: 1000, price: 188 }), tx({ tradeDate: '2026-02-02', price: 45 })],
      splitsByStock: new Map([
        [
          '2330',
          {
            status: 'available',
            rows: [
              { date: '2026-02-02', stock_id: '2330', before_price: 188, after_price: 47 },
            ],
          },
        ],
      ]),
    });

    expect(selectLedgerEvents(ledger, 'add-on')[0]).toMatchObject({
      positionBefore: 4000,
      averageCostBefore: 47,
      positionAfter: 5000,
    });
    expect(ledger.currentPositions.get('2330')).toMatchObject({ shares: 5000 });
  });

  it('沒有股利交易輸入時，日期空檔不會改變交易成本', () => {
    const ledger = buildResearchLedger({
      transactions: [tx(), tx({ tradeDate: '2026-03-02', quantity: 100, price: 110 })],
      splitsByStock: splits(),
    });

    expect(selectLedgerEvents(ledger, 'add-on')[0].averageCostBefore).toBe(100);
  });

  it.each([
    ['定期定額', 'scheduled-investment'],
    [null, 'trade-method-unknown'],
    ['盤後零股', 'trade-method-unknown'],
  ] as const)('%s 會更新現股部位但不成為主動決策樣本', (tradeMethod, issue) => {
    const ledger = buildResearchLedger({
      transactions: [tx({ tradeMethod })],
      splitsByStock: splits(),
    });

    expect(ledger.currentPositions.get('2330')).toMatchObject({ shares: 1000, averageCost: 100 });
    expect(ledger.events[0]).toMatchObject({ includeInScenarioResearch: false, issues: [issue] });
  });

  it.each([
    ['融資', 'non-cash-position'],
    ['融券', 'non-cash-position'],
    ['現沖', 'day-trade'],
  ] as const)('%s 不更新現股帳本', (tradeType, issue) => {
    const ledger = buildResearchLedger({
      transactions: [tx({ tradeType })],
      splitsByStock: splits(),
    });

    expect(ledger.currentPositions.get('2330')).toMatchObject({ shares: 0, everHeld: false });
    expect(ledger.events[0]).toMatchObject({ scenario: null, issues: [issue] });
  });

  it('第一個現股交易日只有賣出時整檔標記期初部位不明', () => {
    const ledger = buildResearchLedger({
      transactions: [tx({ side: 'sell' }), tx({ tradeDate: '2026-01-05' })],
      splitsByStock: splits(),
    });

    expect(ledger.stockStatus.get('2330')).toBe('opening-unknown');
    expect(ledger.events.every((event) => event.issues.includes('opening-position-unknown'))).toBe(true);
    expect(selectLedgerEvents(ledger, 'establish')).toEqual([]);
  });

  it('同日反向交易壓制當日情境，保留股數並暫停相對成本直到清零', () => {
    const ledger = buildResearchLedger({
      transactions: [
        tx({ quantity: 1000 }),
        tx({ tradeDate: '2026-01-05', quantity: 500, price: 90 }),
        tx({ tradeDate: '2026-01-05', side: 'sell', quantity: 200, price: 110 }),
        tx({ tradeDate: '2026-01-08', quantity: 100, price: 95 }),
        tx({ tradeDate: '2026-01-10', side: 'sell', quantity: 1400 }),
        tx({ tradeDate: '2026-01-12', quantity: 100, price: 80 }),
      ],
      splitsByStock: splits(),
    });

    const oppositeDay = ledger.events.find((event) => event.tradeDate === '2026-01-05')!;
    const ambiguousAddOn = ledger.events.find((event) => event.tradeDate === '2026-01-08')!;
    const reentry = ledger.events.find((event) => event.tradeDate === '2026-01-12')!;
    expect(oppositeDay).toMatchObject({ scenario: null, positionAfter: 1300 });
    expect(oppositeDay.issues).toContain('same-day-opposite-sides');
    expect(ambiguousAddOn).toMatchObject({
      scenario: 'add-on',
      includeInScenarioResearch: true,
      relativeCostAvailable: false,
      relativeCostPercent: null,
    });
    expect(reentry).toMatchObject({ scenario: 'reentry', averageCostBefore: null });
    expect(ledger.stockStatus.get('2330')).toBe('reliable');
  });

  it('缺少已驗證拆股歷史時整檔標記 split-data-missing', () => {
    const ledger = buildResearchLedger({ transactions: [tx()], splitsByStock: splits('missing') });

    expect(ledger.stockStatus.get('2330')).toBe('split-missing');
    expect(ledger.events[0]).toMatchObject({ includeInScenarioResearch: false });
    expect(ledger.events[0].issues).toContain('split-data-missing');
  });
});
