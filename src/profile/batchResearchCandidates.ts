import {
  researchMetricsFor,
  type ResearchScenario,
  type ScenarioResearchMetric,
} from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { BandResult, WalkForwardResult } from '../research/walkForward';
import type { ResearchRunRecord } from '../storage/types';
import {
  applyScenarioCandidate,
  readScenarioEntry,
  type Profile,
  type ProfileEntry,
} from './profile';

const SCENARIOS: ResearchScenario[] = ['establish', 'add-on', 'reentry'];
const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];

export type BatchChangeKind = 'added' | 'overwritten';

export type BatchCandidateChange = {
  scenario: ResearchScenario;
  assetClass: AssetClass;
  metric: ScenarioResearchMetric;
  kind: BatchChangeKind;
  replacesManual: boolean;
  previous: ProfileEntry;
  next: ProfileEntry;
  band: BandResult;
  runId: string;
};

export type BatchPreservedRule = {
  scenario: ResearchScenario;
  assetClass: AssetClass;
  metric: ScenarioResearchMetric;
  previous: ProfileEntry;
};

export type BatchScenarioImport = {
  scenario: ResearchScenario;
  run: Pick<
    ResearchRunRecord,
    'id' | 'executedAt' | 'eventCount' | 'entryCount' | 'completeCount'
  > | null;
  changes: BatchCandidateChange[];
  preserved: BatchPreservedRule[];
};

export type BatchResearchImport = {
  scenarios: Record<ResearchScenario, BatchScenarioImport>;
  changes: BatchCandidateChange[];
  preserved: BatchPreservedRule[];
  hasWeakEvidence: boolean;
  nextProfile: Profile;
};

function latestRunFor(
  runs: ResearchRunRecord[],
  scenario: ResearchScenario,
): ResearchRunRecord | null {
  return [...runs]
    .sort((left, right) => right.executedAt.localeCompare(left.executedAt))
    .find((run) => (run.scenario ?? 'establish') === scenario) ?? null;
}

function resultFor(
  run: ResearchRunRecord | null,
  metric: ScenarioResearchMetric,
  assetClass: AssetClass,
): WalkForwardResult | undefined {
  const results = run?.results as Partial<
    Record<ScenarioResearchMetric, Partial<Record<AssetClass, WalkForwardResult>>>
  > | undefined;
  return results?.[metric]?.[assetClass];
}

function usableNormalBand(result: WalkForwardResult | undefined): BandResult | null {
  const band = result?.bands.find((item) => item.band === 'normal');
  if (
    band === undefined
    || !Number.isFinite(band.range.min)
    || !Number.isFinite(band.range.max)
  ) {
    return null;
  }
  return band;
}

export function buildBatchResearchImport(
  runs: ResearchRunRecord[],
  profile: Profile,
  appliedAt: string,
): BatchResearchImport {
  let nextProfile = profile;
  const scenarios = {} as Record<ResearchScenario, BatchScenarioImport>;
  const changes: BatchCandidateChange[] = [];
  const preserved: BatchPreservedRule[] = [];

  for (const scenario of SCENARIOS) {
    const run = latestRunFor(runs, scenario);
    const scenarioChanges: BatchCandidateChange[] = [];
    const scenarioPreserved: BatchPreservedRule[] = [];

    for (const assetClass of ASSET_CLASSES) {
      for (const metric of researchMetricsFor(scenario)) {
        const previous = readScenarioEntry(nextProfile, scenario, assetClass, metric);
        const band = usableNormalBand(resultFor(run, metric, assetClass));

        if (run === null || band === null) {
          const item = { scenario, assetClass, metric, previous };
          scenarioPreserved.push(item);
          preserved.push(item);
          continue;
        }

        nextProfile = applyScenarioCandidate(nextProfile, {
          scenario,
          assetClass,
          metric,
          band: 'normal',
          range: band.range,
          runId: run.id,
          evidence: band.evidence,
          despiteWeakEvidence: band.evidence !== 'worth-tracking',
          at: appliedAt,
        });

        const change: BatchCandidateChange = {
          scenario,
          assetClass,
          metric,
          kind: previous.lower === null && previous.upper === null ? 'added' : 'overwritten',
          replacesManual:
            previous.lower?.origin === 'manual' || previous.upper?.origin === 'manual',
          previous,
          next: readScenarioEntry(nextProfile, scenario, assetClass, metric),
          band,
          runId: run.id,
        };
        scenarioChanges.push(change);
        changes.push(change);
      }
    }

    scenarios[scenario] = {
      scenario,
      run: run === null
        ? null
        : {
            id: run.id,
            executedAt: run.executedAt,
            eventCount: run.eventCount,
            entryCount: run.entryCount,
            completeCount: run.completeCount,
          },
      changes: scenarioChanges,
      preserved: scenarioPreserved,
    };
  }

  return {
    scenarios,
    changes,
    preserved,
    hasWeakEvidence: changes.some((change) => change.band.evidence !== 'worth-tracking'),
    nextProfile,
  };
}
