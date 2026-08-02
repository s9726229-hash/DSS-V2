import type { StockAnalysis } from '../dss/analyseHoldings';
import { flowAxis } from '../dss/flow';
import { RESEARCH_METRICS, type ResearchMetric } from '../research/runResearch';
import { classifyAsset, type AssetClass } from '../research/snapshot';
import type { BandId } from '../research/walkForward';
import { classifyByProfile, readEntry, type Profile } from './profile';

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
  metric: ResearchMetric;
  value: number;
  before: BandId | null;
  after: BandId | null;
};

/** 取出單一指標的目前值；資料不足時回 null，不以零代替。 */
export function metricValue(analysis: StockAnalysis, metric: ResearchMetric): number | null {
  if (metric === 'bias20') {
    return analysis.technical.ok ? analysis.technical.snapshot.bias20 : null;
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
}: {
  analyses: readonly StockAnalysis[];
  current: Profile;
  next: Profile;
}): ProfilePreviewRow[] {
  const rows: ProfilePreviewRow[] = [];

  for (const analysis of analyses) {
    const assetClass = classifyAsset(analysis.stockId);

    for (const metric of RESEARCH_METRICS) {
      const value = metricValue(analysis, metric);
      if (value === null) continue;

      const before = classifyByProfile(value, readEntry(current, assetClass, metric));
      const after = classifyByProfile(value, readEntry(next, assetClass, metric));

      if (before === after) continue;

      rows.push({
        stockId: analysis.stockId,
        stockName: analysis.stockName,
        assetClass,
        metric,
        value,
        before,
        after,
      });
    }
  }

  return rows;
}
