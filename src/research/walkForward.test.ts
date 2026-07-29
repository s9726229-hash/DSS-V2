import { describe, expect, it } from 'vitest';
import { runWalkForward, type MetricSample } from './walkForward';

function sample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    entryDate: '2026-01-05',
    assetClass: 'stock',
    metricValue: 0,
    returnPercent: 0,
    complete: true,
    overlapsPrevious: false,
    ...overrides,
  };
}

/** 產生 n 筆依序排列的樣本，指標值與報酬可由函式決定。 */
function series(
  count: number,
  metric: (index: number) => number,
  ret: (index: number) => number,
  overrides: Partial<MetricSample> = {},
): MetricSample[] {
  const start = Date.parse('2026-01-05T00:00:00Z');
  return Array.from({ length: count }, (_, index) =>
    sample({
      entryDate: new Date(start + index * 5 * 86_400_000).toISOString().slice(0, 10),
      metricValue: metric(index),
      returnPercent: ret(index),
      ...overrides,
    }),
  );
}

describe('檢查點與分位數', () => {
  it('分位數只用訓練期資料計算', () => {
    // 訓練期指標值為 0~9，驗證期為 100 以上；分位數不應被驗證期影響
    const samples = series(20, (index) => (index < 10 ? index : 100 + index), () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].p75).toBeLessThan(100);
  });

  it('記錄訓練截止日與訓練、驗證事件數供事後查核', () => {
    const samples = series(20, (index) => index, () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const checkpoint = result.checkpoints[0];

    expect(checkpoint.trainingCutoff).toBe(samples[9].entryDate);
    expect(checkpoint.trainingCount).toBe(10);
    expect(checkpoint.validationCount).toBe(10);
  });

  it('訓練期樣本不足時不產生該檢查點', () => {
    const samples = series(4, (index) => index, () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.checkpoints).toHaveLength(0);
  });

  it('依資產類別分開，不混用 ETF 與個股', () => {
    const samples = [
      ...series(20, (index) => index, () => 5),
      ...series(20, () => 999, () => 99, { assetClass: 'etf' }),
    ];

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.checkpoints[0].p75).toBeLessThan(999);
  });
});

describe('三個候選區間', () => {
  it('以 P25 與 P75 切出回檔下界、合理區與偏熱上界', () => {
    const samples = series(40, (index) => index, () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const ids = result.bands.map((band) => band.band);

    expect(ids).toEqual(['pullback', 'normal', 'overheated']);
    expect(result.bands[0].range.max).toBe(result.checkpoints[0].p25);
    expect(result.bands[2].range.min).toBe(result.checkpoints[0].p75);
  });

  it('驗證樣本依指標值落入對應區間', () => {
    // 指標值循環 0 / 50 / 100，報酬依區間不同
    const samples = series(
      60,
      (index) => [0, 50, 100][index % 3],
      (index) => [(-10), 5, 20][index % 3],
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const pullback = result.bands.find((band) => band.band === 'pullback');
    const overheated = result.bands.find((band) => band.band === 'overheated');

    expect(pullback?.median).toBeLessThan(0);
    expect(overheated?.median).toBeGreaterThan(0);
  });
});

describe('證據等級', () => {
  it('完整驗證事件 0 至 4 筆標示為資料不足', () => {
    const samples = series(14, (index) => index, () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const scarce = result.bands.find((band) => band.completeCount <= 4);

    expect(scarce?.evidence).toBe('insufficient-data');
  });

  it('5 至 9 筆標示為初步觀察', () => {
    // 指標循環 0~9，P25 約 2、P75 約 7，合理區約佔四成
    const samples = series(50, (index) => index % 10, (index) => (index % 10 >= 3 && index % 10 <= 5 ? 20 : 0));

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.completeCount).toBeGreaterThanOrEqual(5);
    expect(normal?.completeCount).toBeLessThanOrEqual(9);
    expect(normal?.evidence).toBe('preliminary');
  });

  it('10 筆以上且跨 2 個檢查點、中位數不低於基準才可標示值得繼續追蹤', () => {
    // 合理區報酬 20%，其餘 0%，整體基準中位數為 0
    const samples = series(80, (index) => index % 10, (index) =>
      index % 10 >= 3 && index % 10 <= 6 ? 20 : 0,
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.4, 0.6, 0.8] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.completeCount).toBeGreaterThanOrEqual(10);
    expect(normal?.checkpointsCovered).toBeGreaterThanOrEqual(2);
    expect(normal?.evidence).toBe('worth-tracking');
  });

  it('只跨 1 個檢查點時不可標示值得繼續追蹤', () => {
    const samples = series(80, (index) => index % 10, (index) =>
      index % 10 >= 3 && index % 10 <= 6 ? 20 : 0,
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.checkpointsCovered).toBe(1);
    expect(normal?.evidence).toBe('insufficient-evidence');
    expect(normal?.reason).toContain('檢查點');
  });

  it('中位數低於同類基準時標示證據不足', () => {
    // 偏熱區（指標最高的三成）報酬為負，明顯低於整體基準
    const samples = series(80, (index) => index % 10, (index) =>
      index % 10 >= 7 ? -30 : 20,
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.4, 0.6, 0.8] });
    const overheated = result.bands.find((band) => band.band === 'overheated');

    expect(overheated?.evidence).toBe('insufficient-evidence');
    expect(overheated?.reason).toContain('基準');
  });

  it('未走完觀察窗的樣本不計入驗證結果', () => {
    const samples = series(40, () => 50, () => 15, { complete: false });

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.bands.every((band) => band.completeCount === 0)).toBe(true);
  });
});

describe('重疊敏感度', () => {
  it('排除重疊樣本後結果反轉時標示重疊敏感', () => {
    // 合理區中，重疊樣本報酬 40%、非重疊樣本 -10%，整體被重疊樣本撐起
    const samples = series(80, (index) => index % 10, (index) => {
      const inNormal = index % 10 >= 3 && index % 10 <= 6;
      if (!inNormal) return 0;
      return index % 2 === 0 ? 40 : -10;
    }).map((row, index) => ({ ...row, overlapsPrevious: index % 2 === 0 }));

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.4, 0.6, 0.8] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.evidence).toBe('overlap-sensitive');
    expect(normal?.reason).toContain('重疊');
  });

  it('回報非重疊樣本數供檢視', () => {
    const samples = series(60, (index) => index % 10, () => 15).map((row, index) => ({
      ...row,
      overlapsPrevious: index % 2 === 0,
    }));

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.completeCount).toBeGreaterThan(0);
    expect(normal?.nonOverlappingCount).toBeLessThan(normal?.completeCount ?? 0);
  });
});

describe('輸出的完整性', () => {
  it('每個區間都附上淘汰或合格的原因', () => {
    const samples = series(40, (index) => index, () => 5);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.bands.every((band) => band.reason.length > 0)).toBe(true);
  });

  it('附上同類基準供對照', () => {
    const samples = series(40, (index) => index % 10, () => 12);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.baseline.median).toBeCloseTo(12, 6);
    expect(result.bands.every((band) => band.baselineMedian === result.baseline.median)).toBe(true);
  });

  it('沒有任何樣本時回傳空結果而非拋出例外', () => {
    const result = runWalkForward({ samples: [], assetClass: 'etf', fractions: [0.5] });

    expect(result.checkpoints).toEqual([]);
    expect(result.baseline.median).toBeNull();
  });

  it('指標值缺漏的樣本不計入', () => {
    const samples = series(40, () => 50, () => 15).map((row, index) =>
      index < 20 ? { ...row, metricValue: null } : row,
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const total = result.bands.reduce((sum, band) => sum + band.completeCount, 0);

    expect(total).toBeLessThan(20);
  });
});
