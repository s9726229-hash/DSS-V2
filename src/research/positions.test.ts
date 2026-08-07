import { describe, expect, it } from 'vitest';
import type { StoredTransaction } from '../storage/types';
import { identifyPositionEvents, selectEntries, selectResearchEvents } from './positions';

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
    price: 1100,
    fees: 1567,
    tax: 0,
    settlementDate: null,
    brokerReference: null,
    importedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('建立部位辨識', () => {
  it('持股為零時的買進是建立部位', () => {
    const events = identifyPositionEvents([tx()]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'entry', isReentry: false, stockId: '2330' });
  });

  it('已有持股時的買進是加碼', () => {
    const events = identifyPositionEvents([tx(), tx({ tradeDate: '2026-03-05' })]);

    expect(events.map((event) => event.kind)).toEqual(['entry', 'add-on']);
  });

  it('賣光後再買進標記為再進場，仍屬建立部位', () => {
    const events = identifyPositionEvents([
      tx(),
      tx({ tradeDate: '2026-03-10', side: 'sell' }),
      tx({ tradeDate: '2026-04-01' }),
    ]);

    expect(events.map((event) => event.kind)).toEqual(['entry', 'exit', 'entry']);
    expect(events[2]).toMatchObject({ kind: 'entry', isReentry: true });
  });

  it('部分賣出後再買進是加碼，不是再進場', () => {
    const events = identifyPositionEvents([
      tx({ quantity: 1000 }),
      tx({ tradeDate: '2026-03-10', side: 'sell', quantity: 400 }),
      tx({ tradeDate: '2026-04-01', quantity: 500 }),
    ]);

    expect(events[2].kind).toBe('add-on');
  });

  it('現沖不計入部位，也不產生建立部位', () => {
    const events = identifyPositionEvents([
      tx({ tradeType: '現沖' }),
      tx({ tradeType: '現沖', side: 'sell' }),
    ]);

    expect(events.filter((event) => event.kind === 'entry')).toHaveLength(0);
  });

  it('現沖不會讓後續的現股買進被誤判為加碼', () => {
    const events = identifyPositionEvents([
      tx({ tradeType: '現沖' }),
      tx({ tradeDate: '2026-03-05' }),
    ]);

    expect(events.find((event) => event.tradeType === '現股')?.kind).toBe('entry');
  });

  it('不同股票各自獨立追蹤部位', () => {
    const events = identifyPositionEvents([tx(), tx({ stockId: '0050', stockName: '元大台灣50' })]);

    expect(events.every((event) => event.kind === 'entry')).toBe(true);
  });

  it('未依日期排序的輸入會先排序再判定', () => {
    const later = tx({ tradeDate: '2026-03-05' });
    const earlier = tx({ tradeDate: '2026-03-02' });

    const events = identifyPositionEvents([later, earlier]);

    expect(events[0].tradeDate).toBe('2026-03-02');
    expect(events[0].kind).toBe('entry');
    expect(events[1].kind).toBe('add-on');
  });

  it('保留建立部位當日的價格、股數與交易類別', () => {
    const events = identifyPositionEvents([tx({ price: 1234.5, quantity: 2000 })]);

    expect(events[0]).toMatchObject({
      price: 1234.5,
      quantity: 2000,
      tradeType: '現股',
      stockName: '台積電',
    });
  });

  it('記錄建立部位當下的累計持股，供日後檢視', () => {
    const events = identifyPositionEvents([
      tx({ quantity: 1000 }),
      tx({ tradeDate: '2026-03-05', quantity: 500 }),
    ]);

    expect(events[0].positionAfter).toBe(1000);
    expect(events[1].positionAfter).toBe(1500);
  });

  it('賣超過持股時持股歸零而非變成負數', () => {
    const events = identifyPositionEvents([
      tx({ quantity: 1000 }),
      tx({ tradeDate: '2026-03-10', side: 'sell', quantity: 3000 }),
      tx({ tradeDate: '2026-04-01', quantity: 500 }),
    ]);

    expect(events[1].positionAfter).toBe(0);
    expect(events[2].kind).toBe('entry');
  });

  it('同一天多筆買進在相容層維持逐筆，只有第一筆是建立部位', () => {
    const events = identifyPositionEvents([
      tx({ tradeDate: '2026-03-02', quantity: 1000 }),
      tx({ tradeDate: '2026-03-02', quantity: 1000 }),
    ]);

    expect(events.map((event) => event.kind)).toEqual(['entry', 'add-on']);
  });
});

describe('研究樣本篩選', () => {
  /** 首次建立部位 → 賣光 → 再進場 → 加碼，涵蓋所有分類。 */
  function mixedEvents() {
    return identifyPositionEvents([
      tx({ tradeDate: '2026-03-02' }),
      tx({ tradeDate: '2026-03-10', side: 'sell' }),
      tx({ tradeDate: '2026-04-01' }),
      tx({ tradeDate: '2026-04-08' }),
      tx({ tradeDate: '2026-04-15', tradeType: '現沖' }),
    ]);
  }

  it('預設排除再進場，只留首次建立部位', () => {
    const entries = selectEntries(mixedEvents());

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tradeDate: '2026-03-02', isReentry: false });
  });

  it('明確要求時才納入再進場', () => {
    const entries = selectEntries(mixedEvents(), { includeReentries: true });

    expect(entries.map((entry) => entry.tradeDate)).toEqual(['2026-03-02', '2026-04-01']);
  });

  it('加碼、賣出與現沖一律不是研究樣本', () => {
    const entries = selectEntries(mixedEvents(), { includeReentries: true });

    expect(entries.every((entry) => entry.kind === 'entry')).toBe(true);
    expect(entries.some((entry) => entry.tradeType === '現沖')).toBe(false);
  });

  it('不同股票的首次建立部位各自保留', () => {
    const entries = selectEntries(
      identifyPositionEvents([tx(), tx({ stockId: '0050', stockName: '元大台灣50' })]),
    );

    expect(entries.map((entry) => entry.stockId)).toEqual(['2330', '0050']);
  });

  it('加碼研究合併同一標的同日的多筆買進，並保留加碼前均價', () => {
    const events = identifyPositionEvents([
      tx({ tradeDate: '2026-03-02', quantity: 1000, price: 100 }),
      tx({ tradeDate: '2026-03-05', quantity: 500, price: 110 }),
      tx({ tradeDate: '2026-03-05', quantity: 1000, price: 120 }),
    ]);

    const addOns = selectResearchEvents(events, 'add-on');

    expect(addOns).toHaveLength(1);
    expect(addOns[0]).toMatchObject({
      quantity: 1500,
      price: 116.66666666666667,
      positionBefore: 1000,
      averageCostBefore: 100,
      positionAfter: 2500,
    });
  });

  it('再進場研究只取清零後再次建立的事件', () => {
    const events = identifyPositionEvents([
      tx({ tradeDate: '2026-03-02' }),
      tx({ tradeDate: '2026-03-10', side: 'sell' }),
      tx({ tradeDate: '2026-04-01' }),
      tx({ tradeDate: '2026-04-08' }),
    ]);

    expect(selectResearchEvents(events, 'reentry').map((event) => event.tradeDate)).toEqual([
      '2026-04-01',
    ]);
  });
});
