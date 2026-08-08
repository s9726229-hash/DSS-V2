import { describe, expect, it } from 'vitest';
import { applyCandidate, emptyProfile, type Profile } from '../profile/profile';
import type { HoldingSnapshotRecord } from '../storage/types';
import type { StockAnalysis } from './analyseHoldings';
import {
  buildHoldingCard,
  dataCompleteness,
  heldDays,
  latestEntryDates,
  plannedRelativeCost,
  positionResult,
} from './holdingCard';

describe('預計加碼價', () => {
  it('以可靠帳本均價計算且缺值不猜測', () => {
    expect(plannedRelativeCost(90, 100)).toBe(-10);
    expect(plannedRelativeCost(90, null)).toBeNull();
    expect(plannedRelativeCost(null, 100)).toBeNull();
  });
});

/**
 * 產生一組每日淨額，讓流向軸剛好等於指定的值。
 *
 * 前五日固定，今日 = 目標比值 × 前五日平均，於是
 * 今日 ÷ |前五日平均| 就是目標值。基準取一萬張，確保穩穩高於中性門檻。
 */
const FLOW_BASE = 10_000 * 1000;

function flowSeries(signedRatio: number) {
  const dates = [
    '2026-07-24',
    '2026-07-25',
    '2026-07-28',
    '2026-07-29',
    '2026-07-30',
    '2026-07-31',
  ];

  return dates.map((date, index) => ({
    date,
    net: index < 5 ? FLOW_BASE : signedRatio * FLOW_BASE,
  }));
}

function holding(overrides: Partial<HoldingSnapshotRecord> = {}): HoldingSnapshotRecord {
  return {
    id: 'h-1',
    snapshotDate: '2026-07-31',
    stockId: '2330',
    stockName: '測試股',
    tradeType: '現股',
    quantity: 1000,
    costPrice: 100,
    currentPrice: 110,
    importedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function analysis(overrides: {
  stockId?: string;
  marketClose?: number | null;
  bias20?: number;
  technicalOk?: boolean;
  chipOk?: boolean;
} = {}): StockAnalysis {
  const {
    stockId = '2330', marketClose = null, bias20 = 5, technicalOk = true, chipOk = true,
  } = overrides;

  return {
    stockId,
    stockName: '測試股',
    priceDate: '2026-07-31',
    marketClose,
    appliedAdjustments: [],
    margin: [],
    trend: { points: [], min: 0, max: 1, drawable: false },
    technical: technicalOk
      ? ({
          ok: true,
          snapshot: { tradeDate: '2026-07-31', close: 210, ma20: 200, bias20 },
        } as unknown as StockAnalysis['technical'])
      : ({
          ok: false,
          reason: 'insufficient-price-data',
          available: 10,
          required: 60,
        } as StockAnalysis['technical']),
    chip: chipOk
      ? ({
          ok: true,
          snapshot: {
            lastDate: '2026-07-31',
            foreign: { strength: 0.4, series: flowSeries(0.4) },
            trust: { strength: -0.1, series: flowSeries(-0.1) },
          },
        } as unknown as StockAnalysis['chip'])
      : ({
          ok: false,
          reason: 'insufficient-institutional-data',
          lastAvailableDate: null,
        } as StockAnalysis['chip']),
  };
}

function profileWith(min: number, max: number): Profile {
  return applyCandidate(emptyProfile(), {
    assetClass: 'stock',
    metric: 'bias20',
    band: 'normal',
    range: { min, max },
    runId: 'run:2026-08-01T00:00:00.000Z',
    evidence: 'worth-tracking',
    despiteWeakEvidence: false,
    at: '2026-08-01T00:00:00.000Z',
  });
}

describe('持股損益', () => {
  /**
   * 券商的成本價與現價都是未還原的原始價，同一個尺度。
   * 若拿我們還原後的收盤價去算損益，兩個尺度會混在一起——
   * 除權息或分割過的股票會算出離譜的數字。
   */
  it('用券商快照自己的成本與現價計算，不混入還原後的價格', () => {
    const result = positionResult(holding({ quantity: 2000, costPrice: 50, currentPrice: 60 }));

    expect(result).toEqual({
      cost: 100000,
      marketValue: 120000,
      unrealized: 20000,
      returnPercent: 20,
    });
  });

  it('虧損時金額與報酬率都是負的', () => {
    const result = positionResult(holding({ quantity: 1000, costPrice: 100, currentPrice: 80 }));

    expect(result.unrealized).toBe(-20000);
    expect(result.returnPercent).toBe(-20);
  });

  it('成本價為零時不計算報酬率，回傳 null 而非無限大', () => {
    expect(positionResult(holding({ costPrice: 0 })).returnPercent).toBeNull();
  });
});

describe('持有天數', () => {
  it('由最近一次建立部位算到資料日期', () => {
    expect(heldDays('2026-07-01', '2026-07-31')).toBe(30);
  });

  it('同一天進場算零天', () => {
    expect(heldDays('2026-07-31', '2026-07-31')).toBe(0);
  });

  it('沒有建立部位紀錄時回傳 null，不猜', () => {
    expect(heldDays(null, '2026-07-31')).toBeNull();
    expect(heldDays('2026-07-01', null)).toBeNull();
  });
});

describe('目前部位的起始日', () => {
  const events = (rows: { stockId: string; tradeDate: string; kind: string; isReentry?: boolean }[]) =>
    rows.map((row) => ({ ...row, isReentry: row.isReentry ?? false })) as never;

  it('取最近一次建立部位', () => {
    const latest = latestEntryDates(
      events([
        { stockId: '2330', tradeDate: '2026-01-05', kind: 'entry' },
        { stockId: '2330', tradeDate: '2026-05-20', kind: 'entry', isReentry: true },
      ]),
    );

    expect(latest.get('2330')).toBe('2026-05-20');
  });

  /** 與研究樣本相反：賣光後再買就是新的一批，持有天數必須從那天算起。 */
  it('再進場要算進來，不能沿用研究的排除規則', () => {
    const latest = latestEntryDates(
      events([
        { stockId: '2330', tradeDate: '2025-03-01', kind: 'entry' },
        { stockId: '2330', tradeDate: '2026-07-01', kind: 'entry', isReentry: true },
      ]),
    );

    expect(latest.get('2330')).toBe('2026-07-01');
  });

  it('加碼與賣出不算部位起點', () => {
    const latest = latestEntryDates(
      events([
        { stockId: '2330', tradeDate: '2026-01-05', kind: 'entry' },
        { stockId: '2330', tradeDate: '2026-06-01', kind: 'add-on' },
        { stockId: '2330', tradeDate: '2026-06-10', kind: 'exit' },
      ]),
    );

    expect(latest.get('2330')).toBe('2026-01-05');
  });

  it('沒有交易紀錄的股票查不到起始日', () => {
    expect(latestEntryDates(events([])).get('2330')).toBeUndefined();
  });
});

describe('資料完整度', () => {
  it('技術與籌碼都可用時為完整', () => {
    expect(dataCompleteness(analysis())).toBe('complete');
  });

  it('只有一邊可用時為部分', () => {
    expect(dataCompleteness(analysis({ chipOk: false }))).toBe('partial');
    expect(dataCompleteness(analysis({ technicalOk: false }))).toBe('partial');
  });

  it('兩邊都不可用時為不足', () => {
    expect(dataCompleteness(analysis({ technicalOk: false, chipOk: false }))).toBe('none');
  });
});

describe('持股卡', () => {
  it('市場收盤價可用時優先用來估算現值與報酬率', () => {
    const card = buildHoldingCard({
      holding: holding({ costPrice: 100, currentPrice: 110 }),
      analysis: analysis({ marketClose: 120 }),
      profile: emptyProfile(),
      entryDate: null,
    });

    expect(card).toMatchObject({
      currentPrice: 120,
      snapshotPrice: 110,
      currentPriceSource: 'market',
      position: {
        marketValue: 120000,
        unrealized: 20000,
        returnPercent: 20,
      },
    });
  });

  it('市場收盤價缺少時明確退回券商快照價', () => {
    const card = buildHoldingCard({
      holding: holding({ costPrice: 100, currentPrice: 110 }),
      analysis: analysis({ marketClose: null }),
      profile: emptyProfile(),
      entryDate: null,
    });

    expect(card).toMatchObject({
      currentPrice: 110,
      snapshotPrice: 110,
      currentPriceSource: 'snapshot',
      position: { returnPercent: 10 },
    });
  });

  it('帶入識別、價格、損益與資料完整度', () => {
    const card = buildHoldingCard({
      holding: holding(),
      analysis: analysis(),
      profile: emptyProfile(),
      entryDate: '2026-07-01',
    });

    expect(card).toMatchObject({
      stockId: '2330',
      stockName: '測試股',
      assetClass: 'stock',
      snapshotDate: '2026-07-31',
      quantity: 1000,
      heldDays: 30,
      completeness: 'complete',
    });
    expect(card.position.unrealized).toBe(10000);
  });

  it('依 Profile 判定每個指標的區間，並附上門檻來源', () => {
    const card = buildHoldingCard({
      holding: holding(),
      analysis: analysis({ bias20: 5 }),
      profile: profileWith(-1.5, 15.78),
      entryDate: null,
    });

    const bias = card.bands.find((row) => row.metric === 'bias20');

    expect(bias).toMatchObject({ band: 'normal', value: 5, unverified: false });
    expect(bias?.evidence).toBe('worth-tracking');
  });

  /** Profile 是空的時候不能假裝有判定，卡片要誠實顯示未分類。 */
  it('沒有門檻時區間為 null', () => {
    const card = buildHoldingCard({
      holding: holding(),
      analysis: analysis(),
      profile: emptyProfile(),
      entryDate: null,
    });

    expect(card.bands.every((row) => row.band === null)).toBe(true);
  });

  it('手動門檻標為未驗證', () => {
    const manual: Profile = {
      version: 1,
      entries: {
        'stock:bias20': {
          lower: {
            value: 0,
            origin: 'manual',
            sourceRunId: null,
            sourceEvidence: null,
            appliedDespiteWeakEvidence: false,
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
          upper: {
            value: 10,
            origin: 'candidate',
            sourceRunId: 'run:x',
            sourceEvidence: 'worth-tracking',
            appliedDespiteWeakEvidence: false,
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      },
    };

    const card = buildHoldingCard({
      holding: holding(),
      analysis: analysis({ bias20: 5 }),
      profile: manual,
      entryDate: null,
    });

    expect(card.bands.find((row) => row.metric === 'bias20')).toMatchObject({
      band: 'normal',
      unverified: true,
    });
  });

  it('ETF 用 ETF 的門檻', () => {
    const card = buildHoldingCard({
      holding: holding({ stockId: '0050' }),
      analysis: analysis({ stockId: '0050', bias20: 5 }),
      profile: profileWith(-1.5, 15.78),
      entryDate: null,
    });

    expect(card.assetClass).toBe('etf');
    // 個股門檻不該套到 ETF 上
    expect(card.bands.find((row) => row.metric === 'bias20')?.band).toBeNull();
  });

  it('指標值取不到時區間為 null，且不顯示數值', () => {
    const card = buildHoldingCard({
      holding: holding(),
      analysis: analysis({ technicalOk: false }),
      profile: profileWith(-1.5, 15.78),
      entryDate: null,
    });

    expect(card.bands.find((row) => row.metric === 'bias20')).toMatchObject({
      value: null,
      band: null,
    });
  });
});
