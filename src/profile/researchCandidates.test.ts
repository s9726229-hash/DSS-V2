import { describe, expect, it } from 'vitest';
import type { ResearchMetric } from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { BandResult, WalkForwardResult } from '../research/walkForward';
import type { ResearchRunRecord } from '../storage/types';
import { researchCandidateSource } from './researchCandidates';

function band(overrides: Partial<BandResult> = {}): BandResult {
  return {
    band: 'pullback',
    range: { min: null, max: 1 },
    completeCount: 10,
    nonOverlappingCount: 8,
    median: 2,
    mean: 2,
    worst: -1,
    positiveCount: 7,
    negativeCount: 3,
    checkpointsCovered: 2,
    baselineMedian: 1,
    nonOverlappingMedian: 2,
    flippedCount: 0,
    stableCount: 10,
    stableMedian: 2,
    cleanCount: 8,
    evidence: 'worth-tracking',
    reason: 'Test evidence.',
    ...overrides,
  };
}

function walkForward(assetClass: AssetClass, bands: BandResult[]): WalkForwardResult {
  return {
    assetClass,
    checkpoints: [],
    drift: { p25: null, p75: null },
    bands,
    baseline: {
      completeCount: 10,
      nonOverlappingCount: 8,
      median: 1,
      mean: 1,
      worst: -1,
      positiveCount: 6,
      negativeCount: 4,
    },
  };
}

function runWithResults(results: Partial<ResearchRunRecord['results']>): ResearchRunRecord {
  return {
    id: 'run:2026-08-05T00:00:00.000Z',
    executedAt: '2026-08-05T00:00:00.000Z',
    signature: 'test-signature',
    entryCount: 12,
    technicalCount: 12,
    chipCount: 12,
    completeCount: 10,
    results: results as ResearchRunRecord['results'],
  };
}

function runWithPullbackNormalAndHotBands(): ResearchRunRecord {
  const bands = [
    band({ band: 'pullback', range: { min: null, max: -2 } }),
    band({ band: 'normal', range: { min: -2, max: 4 } }),
    band({ band: 'overheated', range: { min: 4, max: null } }),
  ];
  const emptyBands: BandResult[] = [];
  const results = Object.fromEntries(
    (['bias20', 'foreignFlow', 'trustFlow', 'marginFlow'] as ResearchMetric[]).map((metric) => [
      metric,
      {
        stock: walkForward('stock', metric === 'bias20' ? bands : emptyBands),
        etf: walkForward('etf', emptyBands),
      },
    ]),
  ) as ResearchRunRecord['results'];

  return runWithResults(results);
}

function runWithout(metricToOmit: ResearchMetric): ResearchRunRecord {
  const complete = runWithPullbackNormalAndHotBands();
  const { [metricToOmit]: _omitted, ...results } = complete.results;
  return runWithResults(results);
}

describe('researchCandidateSource', () => {
  it('only exposes bands whose required boundary exists', () => {
    const source = researchCandidateSource(runWithPullbackNormalAndHotBands());

    expect(source.candidates.map((candidate) => candidate.band)).toEqual([
      'pullback',
      'normal',
      'overheated',
    ]);
  });

  it('reports a metric omitted by an older record without exposing it as a candidate', () => {
    const source = researchCandidateSource(runWithout('marginFlow'));

    expect(source.missingMetrics).toEqual(['marginFlow']);
    expect(source.candidates.some((candidate) => candidate.metric === 'marginFlow')).toBe(false);
  });
});
