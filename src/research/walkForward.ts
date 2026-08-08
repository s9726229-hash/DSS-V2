import { bandLabel } from './bandLabels';
import { computeBaseline, type Baseline } from './outcome';
import type { ScenarioResearchMetric } from './runResearch';
import type { AssetClass } from './snapshot';

/** 規格的證據門檻：0–4 資料不足、5–9 初步觀察、10 以上才可能值得追蹤。 */
const INSUFFICIENT_DATA_MAX = 4;
const PRELIMINARY_MAX = 9;
const MINIMUM_CHECKPOINTS = 2;

/** 訓練期至少要有這麼多樣本，否則分位數沒有意義。 */
const MINIMUM_TRAINING = 5;

export type MetricSample = {
  entryDate: string;
  assetClass: AssetClass;
  /** 研究指標值：Bias20、外資強度或投信強度。缺漏時不計入。 */
  metricValue: number | null;
  /** 驗證窗報酬；觀察窗未完整時為 null。 */
  returnPercent: number | null;
  complete: boolean;
  overlapsPrevious: boolean;
};

export type BandId = 'pullback' | 'normal' | 'overheated';

/**
 * 證據等級。
 * - insufficient-data：完整驗證事件 0–4 筆
 * - preliminary：5–9 筆，僅為初步觀察
 * - worth-tracking：10 筆以上、跨 2 個以上檢查點，且中位數不低於同類基準
 * - insufficient-evidence：樣本足夠但未通過比較，不建議套用
 * - threshold-unstable：排除跨檢查點改變歸屬的樣本後結果不足或反轉，門檻尚未收斂
 * - overlap-sensitive：排除重疊樣本後結果不足或反轉，暫不推薦套用
 */
export type EvidenceLevel =
  | 'insufficient-data'
  | 'preliminary'
  | 'worth-tracking'
  | 'insufficient-evidence'
  | 'threshold-unstable'
  | 'overlap-sensitive';

export type BandResult = {
  band: BandId;
  range: { min: number | null; max: number | null };
  completeCount: number;
  nonOverlappingCount: number;
  median: number | null;
  mean: number | null;
  worst: number | null;
  positiveCount: number;
  negativeCount: number;
  /** 有驗證樣本落入此區間的檢查點數。 */
  checkpointsCovered: number;
  baselineMedian: number | null;
  /** 僅用非重疊樣本重算的中位數，供敏感度檢查。 */
  nonOverlappingMedian: number | null;
  /** 本區間的樣本中，歸屬會隨門檻改變的筆數。 */
  flippedCount: number;
  /** 排除翻轉樣本後的筆數。 */
  stableCount: number;
  /** 僅用未翻轉樣本重算的中位數，供門檻穩定度檢查。 */
  stableMedian: number | null;
  /** 排除翻轉與重疊樣本後，兩者皆清的筆數，供聯合門檻判定使用。 */
  cleanCount: number;
  evidence: EvidenceLevel;
  reason: string;
};

export type CheckpointRecord = {
  trainingCutoff: string;
  trainingCount: number;
  validationCount: number;
  p25: number | null;
  p75: number | null;
};

export type DriftRange = {
  low: number;
  high: number;
  span: number;
};

/**
 * 門檻在檢查點之間的漂移。
 * 可用檢查點不足 2 個時無從判斷漂移，回傳 null 而非 0，
 * 以免「沒有漂移」與「無法判斷」被混為一談。
 */
export type ThresholdDrift = {
  p25: DriftRange | null;
  p75: DriftRange | null;
};

export type WalkForwardResult = {
  assetClass: AssetClass;
  checkpoints: CheckpointRecord[];
  drift: ThresholdDrift;
  bands: BandResult[];
  baseline: Baseline;
};

function percentile(sortedValues: readonly number[], fraction: number): number | null {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.floor((sortedValues.length - 1) * fraction)];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function driftOf(values: readonly (number | null)[]): DriftRange | null {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length < 2) return null;

  const low = Math.min(...usable);
  const high = Math.max(...usable);
  return { low, high, span: high - low };
}

function bandOf(value: number, p25: number, p75: number): BandId {
  if (value <= p25) return 'pullback';
  if (value >= p75) return 'overheated';
  return 'normal';
}

const BAND_ORDER: BandId[] = ['pullback', 'normal', 'overheated'];

/**
 * expanding walk-forward 驗證。
 *
 * 每個檢查點只用截止日以前的樣本計算 P25／P75，再以截止日之後的樣本驗證，
 * 避免用已知結果回頭決定門檻。樣本可能在不同檢查點落入不同區間，
 * 此時兩邊都會計入——那本身就代表門檻不穩定，不該被隱藏。
 */
export function runWalkForward({
  samples,
  assetClass,
  metric,
  fractions = [0.4, 0.6, 0.8],
}: {
  samples: readonly MetricSample[];
  assetClass: AssetClass;
  /** 只用來決定判定原因裡的區間名稱；統計本身與指標無關。 */
  metric: ScenarioResearchMetric;
  fractions?: readonly number[];
}): WalkForwardResult {
  const usable = samples
    .filter((row) => row.assetClass === assetClass && row.metricValue !== null)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const baseline = computeBaseline(samples, assetClass);

  const checkpoints: CheckpointRecord[] = [];
  // 每個區間累積「哪些樣本曾在驗證期落入此區間」與「來自哪些檢查點」
  const hits = new Map<BandId, { samples: Set<MetricSample>; checkpoints: Set<number> }>(
    BAND_ORDER.map((band) => [band, { samples: new Set(), checkpoints: new Set() }]),
  );
  const ranges = new Map<BandId, { min: number | null; max: number | null }>();
  // 只收集「實際套用過分類」的門檻（P25 與 P75 皆非 null 且不相等）。
  // expanding walk-forward 的驗證集是巢狀的，只被最早檢查點驗證過的樣本
  // 在後續檢查點會變成訓練資料、不會再進入 hits——若翻轉判定只看驗證期實際發生過的
  // 歸屬，這批樣本恆被當成穩定。這裡改用「每一組門檻都重新分類一次」，
  // 讓翻轉判定涵蓋所有非退化檢查點，不論樣本實際被驗證過幾次。
  const thresholds: { p25: number; p75: number }[] = [];

  fractions.forEach((fraction, checkpointIndex) => {
    const trainingSize = Math.floor(usable.length * fraction);

    if (trainingSize < MINIMUM_TRAINING || trainingSize >= usable.length) {
      return;
    }

    const training = usable.slice(0, trainingSize);
    const validation = usable.slice(trainingSize);
    const trainingValues = training
      .map((row) => row.metricValue as number)
      .sort((a, b) => a - b);

    const p25 = percentile(trainingValues, 0.25);
    const p75 = percentile(trainingValues, 0.75);

    checkpoints.push({
      trainingCutoff: training[training.length - 1].entryDate,
      trainingCount: training.length,
      validationCount: validation.length,
      p25,
      p75,
    });

    // P25 與 P75 相同時分布退化，三個區間沒有意義，
    // 若照常切會把全部樣本倒進單一區間並產生看似有結論的結果
    if (p25 === null || p75 === null || p25 === p75) return;

    thresholds.push({ p25, p75 });

    ranges.set('pullback', { min: null, max: p25 });
    ranges.set('normal', { min: p25, max: p75 });
    ranges.set('overheated', { min: p75, max: null });

    for (const row of validation) {
      if (!row.complete || row.returnPercent === null) continue;

      const band = bandOf(row.metricValue as number, p25, p75);
      const hit = hits.get(band) as { samples: Set<MetricSample>; checkpoints: Set<number> };
      hit.samples.add(row);
      hit.checkpoints.add(checkpointIndex);
    }
  });

  // 翻轉判定：用「所有非退化檢查點的門檻」重新分類每一筆曾被驗證過的樣本，
  // 只要有一組門檻算出的區間跟其他組不同，就是翻轉樣本。
  const flipped = new Set<MetricSample>();
  for (const hit of hits.values()) {
    for (const row of hit.samples) {
      if (flipped.has(row)) continue;
      const value = row.metricValue as number;
      const bandsAssigned = new Set(thresholds.map((t) => bandOf(value, t.p25, t.p75)));
      if (bandsAssigned.size > 1) flipped.add(row);
    }
  }

  const bands = BAND_ORDER.map((band) =>
    summarizeBand({
      band,
      metric,
      hit: hits.get(band) as { samples: Set<MetricSample>; checkpoints: Set<number> },
      range: ranges.get(band),
      baseline,
      flipped,
    }),
  );

  const drift: ThresholdDrift = {
    p25: driftOf(thresholds.map((t) => t.p25)),
    p75: driftOf(thresholds.map((t) => t.p75)),
  };

  return { assetClass, checkpoints, drift, bands, baseline };
}

function summarizeBand({
  band,
  metric,
  hit,
  range,
  baseline,
  flipped,
}: {
  band: BandId;
  metric: ScenarioResearchMetric;
  hit: { samples: Set<MetricSample>; checkpoints: Set<number> };
  range: { min: number | null; max: number | null } | undefined;
  baseline: Baseline;
  /** 在所有非退化檢查點的門檻下，區間歸屬並非恆定的樣本。 */
  flipped: ReadonlySet<MetricSample>;
}): BandResult {
  const rows = [...hit.samples];
  const returns = rows.map((row) => row.returnPercent as number);
  const nonOverlapping = rows.filter((row) => !row.overlapsPrevious);
  const nonOverlappingReturns = nonOverlapping.map((row) => row.returnPercent as number);
  // 不在翻轉集合中的樣本，其歸屬在所有非退化檢查點的門檻下皆一致
  const stable = rows.filter((row) => !flipped.has(row));
  const stableReturns = stable.map((row) => row.returnPercent as number);
  // 既未翻轉、又非重疊——兩種質疑都排除後仍站得住的樣本
  const clean = rows.filter((row) => !flipped.has(row) && !row.overlapsPrevious);

  const completeCount = rows.length;
  const stableCount = stable.length;
  const flippedCount = completeCount - stableCount;
  const cleanCount = clean.length;
  const bandMedian = median(returns);
  const nonOverlappingMedian = median(nonOverlappingReturns);
  const stableMedian = median(stableReturns);
  const checkpointsCovered = hit.checkpoints.size;

  const { evidence, reason } = judge({
    completeCount,
    checkpointsCovered,
    bandMedian,
    nonOverlappingMedian,
    nonOverlappingCount: nonOverlapping.length,
    stableMedian,
    stableCount,
    flippedCount,
    cleanCount,
    baselineMedian: baseline.median,
    label: bandLabel(metric, band),
  });

  return {
    band,
    range: range ?? { min: null, max: null },
    completeCount,
    nonOverlappingCount: nonOverlapping.length,
    median: bandMedian,
    mean: returns.length === 0 ? null : returns.reduce((sum, v) => sum + v, 0) / returns.length,
    worst: returns.length === 0 ? null : Math.min(...returns),
    positiveCount: returns.filter((value) => value > 0).length,
    negativeCount: returns.filter((value) => value < 0).length,
    checkpointsCovered,
    baselineMedian: baseline.median,
    nonOverlappingMedian,
    flippedCount,
    stableCount,
    stableMedian,
    cleanCount,
    evidence,
    reason,
  };
}

function judge({
  completeCount,
  checkpointsCovered,
  bandMedian,
  nonOverlappingMedian,
  nonOverlappingCount,
  stableMedian,
  stableCount,
  flippedCount,
  cleanCount,
  baselineMedian,
  label,
}: {
  completeCount: number;
  checkpointsCovered: number;
  bandMedian: number | null;
  nonOverlappingMedian: number | null;
  nonOverlappingCount: number;
  stableMedian: number | null;
  stableCount: number;
  flippedCount: number;
  cleanCount: number;
  baselineMedian: number | null;
  label: string;
}): { evidence: EvidenceLevel; reason: string } {
  if (completeCount <= INSUFFICIENT_DATA_MAX) {
    return {
      evidence: 'insufficient-data',
      reason: `${label}只有 ${completeCount} 筆完整驗證事件，未達 5 筆，資料不足。`,
    };
  }

  if (completeCount <= PRELIMINARY_MAX) {
    return {
      evidence: 'preliminary',
      reason: `${label}有 ${completeCount} 筆完整驗證事件，屬初步觀察，尚不足以採納。`,
    };
  }

  if (checkpointsCovered < MINIMUM_CHECKPOINTS) {
    return {
      evidence: 'insufficient-evidence',
      reason: `${label}僅在 ${checkpointsCovered} 個檢查點取得驗證樣本，未跨 ${MINIMUM_CHECKPOINTS} 個時間點。`,
    };
  }

  if (bandMedian === null || baselineMedian === null) {
    return { evidence: 'insufficient-evidence', reason: `${label}缺少可比較的基準。` };
  }

  if (bandMedian < baselineMedian) {
    return {
      evidence: 'insufficient-evidence',
      reason: `${label}中位數 ${bandMedian.toFixed(2)}% 低於同類基準 ${baselineMedian.toFixed(2)}%，未顯示差異。`,
    };
  }

  // 穩定度敏感度檢查：排除區間歸屬會隨檢查點改變的樣本後，結論若消失，
  // 代表這個區間是靠一個尚未收斂的門檻切出來的
  if (stableCount <= INSUFFICIENT_DATA_MAX) {
    return {
      evidence: 'threshold-unstable',
      reason: `${label}排除 ${flippedCount} 筆歸屬會隨門檻改變的樣本後僅剩 ${stableCount} 筆，門檻尚未收斂，暫不推薦套用。`,
    };
  }

  if (stableMedian === null || stableMedian < baselineMedian) {
    return {
      evidence: 'threshold-unstable',
      reason: `${label}排除 ${flippedCount} 筆歸屬會隨門檻改變的樣本後中位數降至 ${stableMedian?.toFixed(2) ?? '無'}%，低於同類基準 ${baselineMedian.toFixed(2)}%，門檻尚未收斂，暫不推薦套用。`,
    };
  }

  // 敏感度檢查：排除重疊樣本後若不足或反轉，代表結果由重疊事件撐起
  if (nonOverlappingCount <= INSUFFICIENT_DATA_MAX) {
    return {
      evidence: 'overlap-sensitive',
      reason: `${label}排除重疊樣本後僅剩 ${nonOverlappingCount} 筆，重疊敏感，暫不推薦套用。`,
    };
  }

  if (nonOverlappingMedian === null || nonOverlappingMedian < baselineMedian) {
    return {
      evidence: 'overlap-sensitive',
      reason: `${label}排除重疊樣本後中位數降至 ${nonOverlappingMedian?.toFixed(2) ?? '無'}%，低於基準，重疊敏感，暫不推薦套用。`,
    };
  }

  // 聯合門檻：翻轉與重疊各自檢查可能各自通過，但排除的未必是同一批樣本。
  // 若「既未翻轉、又非重疊」的樣本所剩無幾，代表結論是靠兩種質疑彼此互補撐住的，
  // 歸給排除數較大的那一方。
  if (cleanCount <= INSUFFICIENT_DATA_MAX) {
    const overlapCount = completeCount - nonOverlappingCount;
    return {
      evidence: flippedCount > overlapCount ? 'threshold-unstable' : 'overlap-sensitive',
      reason: `${label}排除翻轉與重疊樣本後只剩 ${cleanCount} 筆兩者皆清的樣本，證據互相重疊，暫不推薦套用。`,
    };
  }

  return {
    evidence: 'worth-tracking',
    reason: `${label}有 ${completeCount} 筆完整驗證事件、跨 ${checkpointsCovered} 個檢查點，中位數 ${bandMedian.toFixed(2)}% 不低於同類基準 ${baselineMedian.toFixed(2)}%，值得繼續追蹤。`,
  };
}
