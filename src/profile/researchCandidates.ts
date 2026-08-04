import { RESEARCH_METRICS, type ResearchMetric } from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { BandId, BandResult, EvidenceLevel } from '../research/walkForward';
import type { ResearchRunRecord } from '../storage/types';

export type ResearchCandidate = {
  id: string;
  runId: string;
  executedAt: string;
  metric: ResearchMetric;
  assetClass: AssetClass;
  band: BandId;
  range: BandResult['range'];
  evidence: EvidenceLevel;
  reason: string;
};

export type ResearchCandidateSource = {
  runId: string;
  executedAt: string;
  entryCount: number;
  completeCount: number;
  candidates: ResearchCandidate[];
  missingMetrics: ResearchMetric[];
};

export function canApplyBand(band: BandResult): boolean {
  if (band.band === 'pullback') return band.range.max !== null;
  if (band.band === 'overheated') return band.range.min !== null;
  return band.range.min !== null && band.range.max !== null;
}

export function researchCandidateSource(run: ResearchRunRecord): ResearchCandidateSource {
  const missingMetrics = RESEARCH_METRICS.filter((metric) => run.results[metric] === undefined);
  const candidates = RESEARCH_METRICS.flatMap((metric) => {
    const byAsset = run.results[metric];
    if (byAsset === undefined) return [];

    return (['stock', 'etf'] as const).flatMap((assetClass) =>
      byAsset[assetClass].bands.filter(canApplyBand).map((band) => ({
        id: `${run.id}:${metric}:${assetClass}:${band.band}`,
        runId: run.id,
        executedAt: run.executedAt,
        metric,
        assetClass,
        band: band.band,
        range: band.range,
        evidence: band.evidence,
        reason: band.reason,
      })),
    );
  });

  return {
    runId: run.id,
    executedAt: run.executedAt,
    entryCount: run.entryCount,
    completeCount: run.completeCount,
    candidates,
    missingMetrics,
  };
}
