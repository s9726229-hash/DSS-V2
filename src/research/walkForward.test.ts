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

type TailRow = { metric: number; ret: number; overlaps?: boolean };

/**
 * 產生一組門檻會漂移的樣本。
 *
 * 前 30 筆指標值為 0～29，接著 15 筆為 50。搭配 DRIFT_FRACTIONS，兩個檢查點的
 * 訓練期分別是前 30 筆與前 45 筆，P25 由 7 上移到 11、P75 由 21 上移到 50。
 *
 * tail 是最後 15 筆驗證樣本，兩個檢查點都會驗證它們：
 * - 指標值 5：兩個檢查點都是回檔下界
 * - 指標值 9：第一個檢查點是合理區，第二個才落入回檔下界（翻轉樣本）
 * - 指標值 15：兩個檢查點都是合理區
 */
function drifting(tail: readonly TailRow[]): MetricSample[] {
  const rows: TailRow[] = [
    ...Array.from({ length: 30 }, (_, index) => ({ metric: index, ret: 0 })),
    ...Array.from({ length: 15 }, () => ({ metric: 50, ret: 0 })),
    ...tail,
  ];
  const start = Date.parse('2026-01-05T00:00:00Z');

  return rows.map((row, index) =>
    sample({
      entryDate: new Date(start + index * 5 * 86_400_000).toISOString().slice(0, 10),
      metricValue: row.metric,
      returnPercent: row.ret,
      overlapsPrevious: row.overlaps ?? false,
    }),
  );
}

/** drifting() 的 tail 簡寫：count 筆指標值 metric、報酬 ret 的樣本。 */
function tailRows(count: number, metric: number, ret: number, overlaps = false): TailRow[] {
  return Array.from({ length: count }, () => ({ metric, ret, overlaps }));
}

/** 兩個檢查點，訓練期為前 30 筆與前 45 筆。 */
const DRIFT_FRACTIONS = [0.5, 0.75];

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

describe('門檻穩定度', () => {
  it('同一筆樣本在不同檢查點落入不同區間時計為翻轉', () => {
    const samples = drifting([
      ...tailRows(4, 5, 0),
      ...tailRows(7, 9, 0),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });
    const pullback = result.bands.find((band) => band.band === 'pullback');
    const normal = result.bands.find((band) => band.band === 'normal');

    // 指標值 9 的 7 筆同時被計入兩個區間，兩邊都要標記為翻轉
    expect(pullback?.flippedCount).toBe(7);
    expect(normal?.flippedCount).toBe(7);
    expect(pullback?.stableCount).toBe(4);
    expect(normal?.stableCount).toBe(4);
  });

  it('排除翻轉樣本後不足 5 筆時標示門檻不穩定', () => {
    const samples = drifting([
      ...tailRows(4, 5, 20),
      ...tailRows(7, 9, 20),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });
    const pullback = result.bands.find((band) => band.band === 'pullback');

    expect(pullback?.completeCount).toBe(11);
    expect(pullback?.checkpointsCovered).toBe(2);
    expect(pullback?.median).toBe(20);
    expect(pullback?.stableCount).toBe(4);
    // 重疊檢查抓不到這種情況：11 筆全部非重疊，中位數也高於基準
    expect(pullback?.nonOverlappingCount).toBe(11);
    expect(pullback?.evidence).toBe('threshold-unstable');
    expect(pullback?.reason).toContain('門檻');
  });

  it('排除翻轉樣本後中位數跌破基準時標示門檻不穩定', () => {
    const samples = drifting([
      ...tailRows(6, 5, -10),
      ...tailRows(7, 9, 30),
      ...tailRows(2, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });
    const pullback = result.bands.find((band) => band.band === 'pullback');

    expect(pullback?.completeCount).toBe(13);
    expect(pullback?.stableCount).toBe(6);
    expect(pullback?.median).toBe(30);
    expect(pullback?.stableMedian).toBe(-10);
    expect(pullback?.evidence).toBe('threshold-unstable');
  });

  it('門檻沒有漂移時不會被誤判為不穩定', () => {
    // 指標值只取 0／50／100，任何訓練期大小算出的 P25 都是 0、P75 都是 100
    const samples = series(
      80,
      (index) => (index % 3) * 50,
      (index) => (index % 3 === 1 ? 20 : 0),
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.4, 0.6, 0.8] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.flippedCount).toBe(0);
    expect(normal?.stableCount).toBe(normal?.completeCount);
    expect(normal?.evidence).toBe('worth-tracking');
  });

  it('與重疊敏感同時成立時，優先顯示門檻不穩定', () => {
    const samples = drifting([
      ...tailRows(4, 5, 20),
      ...tailRows(7, 9, 20, true),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });
    const pullback = result.bands.find((band) => band.band === 'pullback');

    // 非重疊只剩 4 筆，重疊敏感也成立；但歸屬不確定比重疊更根本
    expect(pullback?.nonOverlappingCount).toBe(4);
    expect(pullback?.evidence).toBe('threshold-unstable');
  });

  it('只有一個檢查點時不會誤報門檻不穩定', () => {
    const samples = drifting([
      ...tailRows(4, 5, 20),
      ...tailRows(7, 9, 20),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });
    const normal = result.bands.find((band) => band.band === 'normal');

    expect(normal?.completeCount).toBe(11);
    expect(normal?.flippedCount).toBe(0);
    expect(normal?.evidence).toBe('insufficient-evidence');
    expect(normal?.reason).toContain('檢查點');
  });

  it('只被單一檢查點驗證過的樣本，若較晚門檻會改變其區間，仍要計為翻轉', () => {
    // 兩個檢查點：訓練期分別是前 30 筆（值 0~29，P25=7／P75=21）
    // 與前 45 筆（值 0~29 加上 15 筆值 9，P25=9／P75=18）。
    // 中間這 15 筆值 9 的樣本只在第一個檢查點的驗證期出現過（第二個檢查點時它們已變成訓練資料），
    // 但換成第二個檢查點的門檻會落入 pullback（9 ≤ 9），而非第一個檢查點分類的 normal（9 落在 7~21 之間）。
    // 舊寫法（assignments）只會記到一次歸屬，恆被當成穩定；這裡驗證新寫法必須把它算作翻轉。
    const start = Date.parse('2026-01-05T00:00:00Z');
    const values = [
      ...Array.from({ length: 30 }, (_, index) => index),
      ...Array.from({ length: 15 }, () => 9),
      ...Array.from({ length: 5 }, () => 100),
    ];
    const samples = values.map((value, index) =>
      sample({
        entryDate: new Date(start + index * 5 * 86_400_000).toISOString().slice(0, 10),
        metricValue: value,
        returnPercent: 0,
      }),
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.6, 0.9] });
    const normal = result.bands.find((band) => band.band === 'normal');
    const overheated = result.bands.find((band) => band.band === 'overheated');

    expect(result.checkpoints).toHaveLength(2);
    expect(normal?.completeCount).toBe(15);
    expect(normal?.flippedCount).toBe(15);
    expect(normal?.stableCount).toBe(0);
    // 值 100 的 5 筆在兩個檢查點的門檻下都落在 overheated，維持穩定
    expect(overheated?.stableCount).toBe(5);
  });

  it('回報各檢查點門檻的漂移範圍', () => {
    const samples = drifting([
      ...tailRows(4, 5, 0),
      ...tailRows(7, 9, 0),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });

    expect(result.drift.p25).toEqual({ low: 7, high: 11, span: 4 });
    expect(result.drift.p75).toEqual({ low: 21, high: 50, span: 29 });
  });

  it('檢查點不足兩個時不回報漂移', () => {
    const samples = drifting([
      ...tailRows(4, 5, 0),
      ...tailRows(7, 9, 0),
      ...tailRows(4, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5] });

    expect(result.drift.p25).toBeNull();
    expect(result.drift.p75).toBeNull();
  });

  it('漂移計算不得計入退化檢查點的門檻', () => {
    // 第一個檢查點訓練期（前 25 筆）全為同一個值，P25 === P75，屬於退化檢查點，
    // 從未實際套用來分類任何樣本。第二個檢查點訓練期併入 15 筆分散值後才不退化。
    // 可用檢查點只有 1 個，漂移應回傳 null，而不是把退化門檻也當一組漂移端點。
    const start = Date.parse('2026-01-05T00:00:00Z');
    const values = [
      ...Array.from({ length: 25 }, () => 10),
      ...Array.from({ length: 15 }, (_, index) => 100 + index),
      ...Array.from({ length: 10 }, () => 50),
    ];
    const samples = values.map((value, index) =>
      sample({
        entryDate: new Date(start + index * 5 * 86_400_000).toISOString().slice(0, 10),
        metricValue: value,
        returnPercent: 0,
      }),
    );

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: [0.5, 0.8] });

    expect(result.checkpoints).toHaveLength(2);
    expect(result.checkpoints[0].p25).toBe(result.checkpoints[0].p75);
    expect(result.drift.p25).toBeNull();
    expect(result.drift.p75).toBeNull();
  });
});

describe('聯合門檻（翻轉 × 重疊）', () => {
  it('翻轉與重疊各自通過但交集為空時，不得判為值得繼續追蹤', () => {
    // pullback 區間累積 12 筆成員：6 筆（值 5）在兩組門檻下都穩定落在 pullback，
    // 但全部標記重疊；另外 6 筆（值 9）在兩組門檻下會從 normal 翻轉到 pullback，
    // 但全部不重疊。stableCount=6、nonOverlappingCount=6 各自通過檢查，
    // 但穩定的那 6 筆恰好都重疊、不重疊的那 6 筆恰好都翻轉，兩者交集是空集合。
    const samples = drifting([
      ...tailRows(6, 5, 20, true),
      ...tailRows(6, 9, 20),
      ...tailRows(3, 15, 0),
    ]);

    const result = runWalkForward({ samples, assetClass: 'stock', fractions: DRIFT_FRACTIONS });
    const pullback = result.bands.find((band) => band.band === 'pullback');

    expect(pullback?.completeCount).toBe(12);
    expect(pullback?.stableCount).toBe(6);
    expect(pullback?.nonOverlappingCount).toBe(6);
    expect(pullback?.cleanCount).toBe(0);
    expect(pullback?.evidence).toBe('overlap-sensitive');
    expect(pullback?.reason).toContain('翻轉');
    expect(pullback?.reason).toContain('重疊');
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
