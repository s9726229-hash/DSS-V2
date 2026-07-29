import { computeBaseline, type Baseline } from './outcome';
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
 * - overlap-sensitive：排除重疊樣本後結果不足或反轉，暫不推薦套用
 */
export type EvidenceLevel =
  | 'insufficient-data'
  | 'preliminary'
  | 'worth-tracking'
  | 'insufficient-evidence'
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

export type WalkForwardResult = {
  assetClass: AssetClass;
  checkpoints: CheckpointRecord[];
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

function bandOf(value: number, p25: number, p75: number): BandId {
  if (value <= p25) return 'pullback';
  if (value >= p75) return 'overheated';
  return 'normal';
}

const BAND_ORDER: BandId[] = ['pullback', 'normal', 'overheated'];

const BAND_LABEL: Record<BandId, string> = {
  pullback: '回檔下界',
  normal: '合理區',
  overheated: '偏熱上界',
};

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
  fractions = [0.4, 0.6, 0.8],
}: {
  samples: readonly MetricSample[];
  assetClass: AssetClass;
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

  const bands = BAND_ORDER.map((band) =>
    summarizeBand(band, hits.get(band) as { samples: Set<MetricSample>; checkpoints: Set<number> }, ranges.get(band), baseline),
  );

  return { assetClass, checkpoints, bands, baseline };
}

function summarizeBand(
  band: BandId,
  hit: { samples: Set<MetricSample>; checkpoints: Set<number> },
  range: { min: number | null; max: number | null } | undefined,
  baseline: Baseline,
): BandResult {
  const rows = [...hit.samples];
  const returns = rows.map((row) => row.returnPercent as number);
  const nonOverlapping = rows.filter((row) => !row.overlapsPrevious);
  const nonOverlappingReturns = nonOverlapping.map((row) => row.returnPercent as number);

  const completeCount = rows.length;
  const bandMedian = median(returns);
  const nonOverlappingMedian = median(nonOverlappingReturns);
  const checkpointsCovered = hit.checkpoints.size;

  const { evidence, reason } = judge({
    completeCount,
    checkpointsCovered,
    bandMedian,
    nonOverlappingMedian,
    nonOverlappingCount: nonOverlapping.length,
    baselineMedian: baseline.median,
    label: BAND_LABEL[band],
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
  baselineMedian,
  label,
}: {
  completeCount: number;
  checkpointsCovered: number;
  bandMedian: number | null;
  nonOverlappingMedian: number | null;
  nonOverlappingCount: number;
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

  return {
    evidence: 'worth-tracking',
    reason: `${label}有 ${completeCount} 筆完整驗證事件、跨 ${checkpointsCovered} 個檢查點，中位數 ${bandMedian.toFixed(2)}% 不低於同類基準 ${baselineMedian.toFixed(2)}%，值得繼續追蹤。`,
  };
}
