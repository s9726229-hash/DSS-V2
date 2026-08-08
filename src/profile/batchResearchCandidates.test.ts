import { describe, expect, it } from 'vitest';
import type {
  ResearchMetric,
  ResearchScenario,
  ScenarioResearchMetric,
} from '../research/runResearch';
import { researchMetricsFor } from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { BandResult, EvidenceLevel, WalkForwardResult } from '../research/walkForward';
import type { ResearchRunRecord } from '../storage/types';
import {
  applyScenarioCandidate,
  emptyProfile,
  readScenarioEntry,
  setScenarioManualBoundary,
  type Profile,
} from './profile';
import { buildBatchResearchImport } from './batchResearchCandidates';

const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];

function band(
  range: { min: number | null; max: number | null } = { min: -2, max: 3 },
  evidence: EvidenceLevel = 'worth-tracking',
): BandResult {
  return {
    band: 'normal',
    range,
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
    flippedCount: 0,
    stableCount: 12,
    stableMedian: 2,
    cleanCount: 10,
    evidence,
    reason: '虛構研究說明。',
  };
}

function result(assetClass: AssetClass, normal = band()): WalkForwardResult {
  return {
    assetClass,
    checkpoints: [],
    drift: { p25: null, p75: null },
    bands: [
      { ...band({ min: null, max: -2 }), band: 'pullback' },
      normal,
      { ...band({ min: 3, max: null }), band: 'overheated' },
    ],
    baseline: {
      completeCount: 12,
      nonOverlappingCount: 10,
      median: 0,
      mean: 0,
      worst: -10,
      positiveCount: 6,
      negativeCount: 6,
    },
  };
}

function makeRun({
  id,
  executedAt,
  scenario,
  evidence = 'worth-tracking',
}: {
  id: string;
  executedAt: string;
  scenario?: ResearchScenario;
  evidence?: EvidenceLevel;
}): ResearchRunRecord {
  const results: Partial<
    Record<ScenarioResearchMetric, Record<AssetClass, WalkForwardResult>>
  > = {};
  const scenarioMetrics = researchMetricsFor(scenario ?? 'establish');

  for (const metric of scenarioMetrics) {
    results[metric] = {
      stock: result('stock', band({ min: -2, max: 3 }, evidence)),
      etf: result('etf', band({ min: -1, max: 4 }, evidence)),
    };
  }

  return {
    id,
    executedAt,
    signature: id,
    ...(scenario === undefined ? {} : { scenario }),
    eventCount: 18,
    entryCount: 18,
    technicalCount: 17,
    chipCount: 16,
    completeCount: 15,
    results: results as Record<ResearchMetric, Record<AssetClass, WalkForwardResult>>,
  };
}

function withExistingRules(): Profile {
  let profile = setScenarioManualBoundary(emptyProfile(), {
    scenario: 'establish',
    assetClass: 'stock',
    metric: 'bias20',
    side: 'lower',
    value: -9,
    at: '2026-08-01T00:00:00.000Z',
  });
  profile = setScenarioManualBoundary(profile, {
    scenario: 'establish',
    assetClass: 'stock',
    metric: 'bias20',
    side: 'upper',
    value: 9,
    at: '2026-08-01T00:00:00.000Z',
  });
  return applyScenarioCandidate(profile, {
    scenario: 'reentry',
    assetClass: 'etf',
    metric: 'trustFlow',
    band: 'normal',
    range: { min: -8, max: 8 },
    runId: 'run:old',
    evidence: 'worth-tracking',
    despiteWeakEvidence: false,
    at: '2026-08-01T00:00:00.000Z',
  });
}

describe('buildBatchResearchImport', () => {
  it('每個情境只取最新紀錄的 normal band，最多產生 26 組候選', () => {
    const olderEstablish = makeRun({
      id: 'run:establish-old',
      executedAt: '2026-08-01T00:00:00.000Z',
      scenario: 'establish',
    });
    const latestEstablish = makeRun({
      id: 'run:establish-new',
      executedAt: '2026-08-04T00:00:00.000Z',
      scenario: 'establish',
    });
    const latestAddOn = makeRun({
      id: 'run:add-on',
      executedAt: '2026-08-03T00:00:00.000Z',
      scenario: 'add-on',
    });
    const latestReentry = makeRun({
      id: 'run:reentry',
      executedAt: '2026-08-02T00:00:00.000Z',
      scenario: 'reentry',
    });

    const batch = buildBatchResearchImport(
      [olderEstablish, latestReentry, latestEstablish, latestAddOn],
      emptyProfile(),
      '2026-08-08T00:00:00.000Z',
    );

    expect(batch.scenarios.establish.run?.id).toBe(latestEstablish.id);
    expect(batch.scenarios.establish.changes).toHaveLength(8);
    expect(batch.scenarios['add-on'].changes).toHaveLength(10);
    expect(batch.scenarios.reentry.changes).toHaveLength(8);
    expect(batch.changes).toHaveLength(26);
    expect(batch.changes.every((change) => change.band.band === 'normal')).toBe(true);
  });

  it('舊紀錄缺少 scenario 時只屬於建立部位', () => {
    const legacy = makeRun({
      id: 'run:legacy',
      executedAt: '2026-08-05T00:00:00.000Z',
    });

    const batch = buildBatchResearchImport(
      [legacy],
      emptyProfile(),
      '2026-08-08T00:00:00.000Z',
    );

    expect(batch.scenarios.establish.run?.id).toBe('run:legacy');
    expect(batch.scenarios['add-on'].run).toBeNull();
    expect(batch.scenarios.reentry.run).toBeNull();
  });

  it('可用候選覆蓋手動與舊研究規則，弱證據會永久標記', () => {
    const runs = [
      makeRun({
        id: 'run:weak-establish',
        executedAt: '2026-08-05T00:00:00.000Z',
        scenario: 'establish',
        evidence: 'preliminary',
      }),
      makeRun({
        id: 'run:reentry',
        executedAt: '2026-08-05T00:00:00.000Z',
        scenario: 'reentry',
      }),
    ];

    const batch = buildBatchResearchImport(
      runs,
      withExistingRules(),
      '2026-08-08T00:00:00.000Z',
    );
    const manualChange = batch.changes.find(
      (change) =>
        change.scenario === 'establish'
        && change.assetClass === 'stock'
        && change.metric === 'bias20',
    );
    const oldCandidateChange = batch.changes.find(
      (change) =>
        change.scenario === 'reentry'
        && change.assetClass === 'etf'
        && change.metric === 'trustFlow',
    );
    const next = readScenarioEntry(batch.nextProfile, 'establish', 'stock', 'bias20');

    expect(manualChange).toMatchObject({ kind: 'overwritten', replacesManual: true });
    expect(oldCandidateChange).toMatchObject({ kind: 'overwritten', replacesManual: false });
    expect(next.lower).toMatchObject({
      value: -2,
      sourceRunId: 'run:weak-establish',
      sourceEvidence: 'preliminary',
      appliedDespiteWeakEvidence: true,
    });
    expect(next.upper?.appliedDespiteWeakEvidence).toBe(true);
    expect(batch.hasWeakEvidence).toBe(true);
  });

  it.each([
    ['缺少結果', undefined],
    ['缺少 normal band', result('stock', { ...band(), band: 'pullback' })],
    ['缺少下界', result('stock', band({ min: null, max: 3 }))],
    ['下界不是有限數字', result('stock', band({ min: Number.NaN, max: 3 }))],
    ['上界不是有限數字', result('stock', band({ min: -2, max: Number.POSITIVE_INFINITY }))],
  ])('%s 時保留原值', (_label, replacement) => {
    const run = makeRun({
      id: 'run:partial',
      executedAt: '2026-08-05T00:00:00.000Z',
      scenario: 'establish',
    });
    const results = run.results as Partial<
      Record<ScenarioResearchMetric, Partial<Record<AssetClass, WalkForwardResult>>>
    >;
    if (replacement === undefined) delete results.bias20?.stock;
    else if (results.bias20) results.bias20.stock = replacement;
    const profile = withExistingRules();
    const before = readScenarioEntry(profile, 'establish', 'stock', 'bias20');

    const batch = buildBatchResearchImport(
      [run],
      profile,
      '2026-08-08T00:00:00.000Z',
    );

    expect(readScenarioEntry(batch.nextProfile, 'establish', 'stock', 'bias20')).toEqual(before);
    expect(batch.preserved).toContainEqual({
      scenario: 'establish',
      assetClass: 'stock',
      metric: 'bias20',
      previous: before,
    });
  });
});
