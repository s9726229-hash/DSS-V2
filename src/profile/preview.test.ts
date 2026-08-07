import { describe, expect, it } from 'vitest';
import type { StockAnalysis } from '../dss/analyseHoldings';
import { applyCandidate, applyScenarioCandidate, emptyProfile, type Profile } from './profile';
import { metricValue, previewProfileChange } from './preview';

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

function analysis(overrides: {
  stockId: string;
  stockName?: string;
  bias20?: number;
  foreign?: number;
  trust?: number;
  technicalOk?: boolean;
  chipOk?: boolean;
}): StockAnalysis {
  const {
    stockId,
    stockName = '測試股',
    bias20 = 5,
    foreign = 0.3,
    trust = 0.1,
    technicalOk = true,
    chipOk = true,
  } = overrides;

  return {
    stockId,
    stockName,
    priceDate: '2026-07-31',
    appliedAdjustments: [],
    margin: [],
    trend: { points: [], min: 0, max: 1, drawable: false },
    technical: technicalOk
      ? ({ ok: true, snapshot: { bias20 } } as unknown as StockAnalysis['technical'])
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
            foreign: { strength: foreign, series: flowSeries(foreign) },
            trust: { strength: trust, series: flowSeries(trust) },
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
    runId: 'run:test',
    evidence: 'worth-tracking',
    despiteWeakEvidence: false,
    at: '2026-08-01T00:00:00.000Z',
  });
}

describe('指標取值', () => {
  it('技術面可用時取得 20MA 乖離', () => {
    expect(metricValue(analysis({ stockId: '2330', bias20: 7.5 }), 'bias20')).toBe(7.5);
  });

  it('籌碼面可用時外資與投信各自取值，不合併', () => {
    const row = analysis({ stockId: '2330', foreign: 0.8, trust: -0.2 });

    expect(metricValue(row, 'foreignFlow')).toBe(0.8);
    expect(metricValue(row, 'trustFlow')).toBe(-0.2);
  });

  it('資料不足時回傳 null，不以零代替', () => {
    expect(metricValue(analysis({ stockId: '2330', technicalOk: false }), 'bias20')).toBeNull();
    expect(
      metricValue(analysis({ stockId: '2330', chipOk: false }), 'foreignFlow'),
    ).toBeNull();
  });
});

describe('套用預覽', () => {
  it('情境預覽列保留 scenario 且不讀取通用 Profile', () => {
    const next = applyScenarioCandidate(emptyProfile(), {
      scenario: 'establish', assetClass: 'stock', metric: 'bias20', band: 'normal',
      range: { min: -1, max: 10 }, runId: 'run:test', evidence: 'worth-tracking',
      despiteWeakEvidence: false, at: '2026-08-08T00:00:00.000Z',
    });
    const rows = previewProfileChange({
      analyses: [analysis({ stockId: '2330', bias20: 5 })],
      current: emptyProfile(), next, scenario: 'establish',
    });
    expect(rows[0]).toMatchObject({ scenario: 'establish', metric: 'bias20' });
  });
  it('只列出歸屬真的會變的標的', () => {
    const holdings = [
      analysis({ stockId: '2330', bias20: 20 }),
      analysis({ stockId: '2454', bias20: 5 }),
    ];

    // 由 -1.5～15.78 收緊為 -1.5～10：2330 原本就偏熱、2454 仍在中間，兩者都不變
    const rows = previewProfileChange({
      analyses: holdings,
      current: profileWith(-1.5, 15.78),
      next: profileWith(-1.5, 10),
    });

    expect(rows).toEqual([]);
  });

  it('門檻改變導致歸屬改變時列出前後', () => {
    const holdings = [analysis({ stockId: '2330', stockName: '台積電', bias20: 12 })];

    const rows = previewProfileChange({
      analyses: holdings,
      current: profileWith(-1.5, 15.78),
      next: profileWith(-1.5, 10),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stockId: '2330',
      stockName: '台積電',
      metric: 'bias20',
      value: 12,
      before: 'normal',
      after: 'overheated',
    });
  });

  /** 第一次套用時所有標的都從未分類變成有分類，這本身就是要讓使用者看見的變更。 */
  it('從沒有門檻到有門檻，未分類轉為已分類也算變更', () => {
    const rows = previewProfileChange({
      analyses: [analysis({ stockId: '2330', bias20: 5 })],
      current: emptyProfile(),
      next: profileWith(-1.5, 15.78),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ before: null, after: 'normal' });
  });

  it('指標值取不到的標的不列入預覽', () => {
    const rows = previewProfileChange({
      analyses: [analysis({ stockId: '2330', technicalOk: false })],
      current: emptyProfile(),
      next: profileWith(-1.5, 15.78),
    });

    expect(rows).toEqual([]);
  });

  it('ETF 用 ETF 的門檻，不會套到個股門檻上', () => {
    const rows = previewProfileChange({
      analyses: [analysis({ stockId: '0050', stockName: '元大台灣50', bias20: 5 })],
      current: emptyProfile(),
      next: profileWith(-1.5, 15.78),
    });

    // 0050 是 ETF，個股門檻不適用，因此沒有任何變更
    expect(rows).toEqual([]);
  });

  it('沒有庫存時回傳空陣列', () => {
    expect(
      previewProfileChange({
        analyses: [],
        current: emptyProfile(),
        next: profileWith(-1.5, 15.78),
      }),
    ).toEqual([]);
  });

  it('三個指標分別檢查，同一檔可能同時出現多列', () => {
    const withChip = applyCandidate(profileWith(-1.5, 15.78), {
      assetClass: 'stock',
      metric: 'foreignFlow',
      band: 'normal',
      range: { min: 0, max: 0.5 },
      runId: 'run:test',
      evidence: 'worth-tracking',
      despiteWeakEvidence: false,
      at: '2026-08-01T00:00:00.000Z',
    });

    const rows = previewProfileChange({
      analyses: [analysis({ stockId: '2330', bias20: 5, foreign: 0.3 })],
      current: emptyProfile(),
      next: withChip,
    });

    expect(rows.map((row) => row.metric).sort()).toEqual(['bias20', 'foreignFlow']);
  });
});
