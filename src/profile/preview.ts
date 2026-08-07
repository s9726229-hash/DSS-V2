import type { StockAnalysis } from '../dss/analyseHoldings';
import { computeFlow, flowAxis } from '../dss/flow';
import { MARGIN_FLOW_THRESHOLDS } from '../dss/margin';
import { RESEARCH_METRICS, researchMetricsFor, type ResearchMetric, type ResearchScenario, type ScenarioResearchMetric } from '../research/runResearch';
import { classifyAsset, type AssetClass } from '../research/snapshot';
import type { BandId } from '../research/walkForward';
import { classifyByProfile, readEntry, readScenarioEntry, type Profile } from './profile';

/**
 * 規格：Profile 儲存前必須預覽哪些庫存標的的狀態可能變更。
 *
 * 只回報「歸屬真的改變」的列。門檻動了但某檔仍落在同一區，
 * 對使用者而言就是沒變，列出來只會淹沒真正的變更。
 */
export type ProfilePreviewRow = {
  stockId: string;
  stockName: string;
  assetClass: AssetClass;
  metric: ScenarioResearchMetric;
  scenario: ResearchScenario | null;
  value: number;
  before: BandId | null;
  after: BandId | null;
};

/** 取出單一指標的目前值；資料不足時回 null，不以零代替。 */
export function metricValue(analysis: StockAnalysis, metric: ScenarioResearchMetric): number | null {
  if (metric === 'relativeCost') return null;
  if (metric === 'bias20') {
    return analysis.technical.ok ? analysis.technical.snapshot.bias20 : null;
  }

  if (metric === 'marginFlow') {
    return computeFlow(analysis.margin, MARGIN_FLOW_THRESHOLDS)?.signedRatio ?? null;
  }

  if (!analysis.chip.ok) return null;

  return flowAxis(
    metric === 'foreignFlow' ? analysis.chip.snapshot.foreign : analysis.chip.snapshot.trust,
  );
}

export function previewProfileChange({
  analyses,
  current,
  next,
  scenario = null,
}: {
  analyses: readonly StockAnalysis[];
  current: Profile;
  next: Profile;
  scenario?: ResearchScenario | null;
}): ProfilePreviewRow[] {
  const rows: ProfilePreviewRow[] = [];

  for (const analysis of analyses) {
    const assetClass = classifyAsset(analysis.stockId);

    for (const metric of scenario === null ? RESEARCH_METRICS : researchMetricsFor(scenario)) {
      const value = metricValue(analysis, metric);
      if (value === null) continue;

      const beforeEntry = scenario === null
        ? readEntry(current, assetClass, metric as ResearchMetric)
        : readScenarioEntry(current, scenario, assetClass, metric);
      const afterEntry = scenario === null
        ? readEntry(next, assetClass, metric as ResearchMetric)
        : readScenarioEntry(next, scenario, assetClass, metric);
      const before = classifyByProfile(value, beforeEntry);
      const after = classifyByProfile(value, afterEntry);

      if (before === after) continue;

      rows.push({
        stockId: analysis.stockId,
        stockName: analysis.stockName,
        assetClass,
        metric,
        scenario,
        value,
        before,
        after,
      });
    }
  }

  return rows;
}
