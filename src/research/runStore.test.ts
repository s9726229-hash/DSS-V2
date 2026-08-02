import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import type { ResearchReport } from './runResearch';
import { readResearchRuns, researchRunSignature, saveResearchRun } from './runStore';
import type { BandResult, WalkForwardResult } from './walkForward';

/* 全部使用虛構數值：本專案為公開儲存庫，不放真實交易的統計結果。 */
function band(overrides: Partial<BandResult> = {}): BandResult {
  return {
    band: 'pullback',
    range: { min: null, max: 0.5 },
    completeCount: 12,
    nonOverlappingCount: 10,
    median: 2,
    mean: 1.5,
    worst: -8,
    positiveCount: 7,
    negativeCount: 5,
    checkpointsCovered: 2,
    baselineMedian: -0.5,
    nonOverlappingMedian: 2,
    flippedCount: 2,
    stableCount: 10,
    stableMedian: 2,
    cleanCount: 9,
    evidence: 'worth-tracking',
    reason: '回檔下界有 12 筆完整驗證事件，值得繼續追蹤。',
    ...overrides,
  };
}

function walkForward(overrides: Partial<WalkForwardResult> = {}): WalkForwardResult {
  return {
    assetClass: 'stock',
    checkpoints: [
      {
        trainingCutoff: '2026-02-02',
        trainingCount: 8,
        validationCount: 12,
        p25: 0.5,
        p75: 6,
      },
    ],
    drift: { p25: { low: 0.5, high: 1.5, span: 1 }, p75: null },
    bands: [band()],
    baseline: {
      completeCount: 20,
      nonOverlappingCount: 16,
      median: -0.5,
      mean: -0.2,
      worst: -10,
      positiveCount: 9,
      negativeCount: 11,
    },
    ...overrides,
  };
}

function report(overrides: Partial<ResearchReport> = {}): ResearchReport {
  const results = {
    stock: walkForward(),
    etf: walkForward({ assetClass: 'etf' }),
  };

  return {
    entryCount: 20,
    reentryCount: 3,
    technicalCount: 19,
    chipCount: 18,
    completeCount: 16,
    missingStocks: [],
    samples: { bias20: [], foreignFlow: [], trustFlow: [], marginFlow: [] },
    results: {
      bias20: results,
      foreignFlow: results,
      trustFlow: results,
      marginFlow: results,
    },
    ...overrides,
  };
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('候選搜尋保存', () => {
  it('保存整份結果，不只留下勝出的門檻', async () => {
    const result = await saveResearchRun(report(), '2026-08-01T00:00:00.000Z');

    expect(result.saved).toBe(true);

    const [stored] = await readResearchRuns();
    const stock = stored.results.bias20.stock;

    expect(stock.checkpoints[0].trainingCutoff).toBe('2026-02-02');
    expect(stock.checkpoints[0].p25).toBe(0.5);
    expect(stock.checkpoints[0].p75).toBe(6);
    expect(stock.checkpoints[0].trainingCount).toBe(8);
    expect(stock.checkpoints[0].validationCount).toBe(12);
    expect(stock.bands[0].completeCount).toBe(12);
    expect(stock.bands[0].nonOverlappingCount).toBe(10);
    expect(stock.bands[0].reason).toMatch(/值得繼續追蹤/);
    expect(stored.entryCount).toBe(20);
  });

  it('內容相同時不重複寫入', async () => {
    await saveResearchRun(report(), '2026-08-01T00:00:00.000Z');
    const second = await saveResearchRun(report(), '2026-08-01T00:05:00.000Z');

    expect(second).toEqual({ saved: false, reason: 'unchanged' });
    expect(await readResearchRuns()).toHaveLength(1);
  });

  it('結果改變時寫入新的一筆，保留舊紀錄', async () => {
    await saveResearchRun(report(), '2026-08-01T00:00:00.000Z');

    const drifted = report({ entryCount: 21 });
    const second = await saveResearchRun(drifted, '2026-08-02T00:00:00.000Z');

    expect(second.saved).toBe(true);

    const runs = await readResearchRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].entryCount).toBe(21);
    expect(runs[1].entryCount).toBe(20);
  });

  it('淘汰原因改變也算不同結果，不會被當成重複', async () => {
    await saveResearchRun(report(), '2026-08-01T00:00:00.000Z');

    const downgraded = report();
    downgraded.results.bias20.stock.bands[0] = band({
      evidence: 'threshold-unstable',
      reason: '回檔下界排除 8 筆歸屬會隨門檻改變的樣本後僅剩 4 筆，門檻尚未收斂。',
    });

    const second = await saveResearchRun(downgraded, '2026-08-02T00:00:00.000Z');

    expect(second.saved).toBe(true);
    expect((await readResearchRuns())[0].results.bias20.stock.bands[0].evidence).toBe(
      'threshold-unstable',
    );
  });

  it('連續呼叫不會因為競態而寫入兩筆相同紀錄', async () => {
    await Promise.all([
      saveResearchRun(report(), '2026-08-01T00:00:00.000Z'),
      saveResearchRun(report(), '2026-08-01T00:00:01.000Z'),
    ]);

    expect(await readResearchRuns()).toHaveLength(1);
  });

  it('沒有任何建立部位時不留下紀錄', async () => {
    const empty = await saveResearchRun(report({ entryCount: 0 }), '2026-08-01T00:00:00.000Z');

    expect(empty).toEqual({ saved: false, reason: 'no-entries' });
    expect(await readResearchRuns()).toHaveLength(0);
  });

  it('簽章不含執行時間，重跑同樣資料得到同一個簽章', () => {
    expect(researchRunSignature(report())).toBe(researchRunSignature(report()));
  });
});
