import { useMemo } from 'react';
import type { StockAnalysis } from '../../dss/analyseHoldings';
import { previewProfileChange } from '../../profile/preview';
import { readEntry, readScenarioEntry, type Profile } from '../../profile/profile';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT, RESEARCH_METRICS, researchMetricsFor } from '../../research/runResearch';
import type { ResearchScenario } from '../../research/runResearch';
import { percent } from '../research/format';

function BoundaryChanges({ current, next, scenario }: { current: Profile; next: Profile; scenario: ResearchScenario | null }) {
  const rows: string[] = [];
  for (const assetClass of ['stock', 'etf'] as const) {
    for (const metric of scenario === null ? RESEARCH_METRICS : researchMetricsFor(scenario)) {
      const before = scenario === null
        ? readEntry(current, assetClass, metric as (typeof RESEARCH_METRICS)[number])
        : readScenarioEntry(current, scenario, assetClass, metric);
      const after = scenario === null
        ? readEntry(next, assetClass, metric as (typeof RESEARCH_METRICS)[number])
        : readScenarioEntry(next, scenario, assetClass, metric);
      for (const side of ['lower', 'upper'] as const) {
        if (before[side]?.value === after[side]?.value) continue;
        rows.push(`${assetClass === 'stock' ? '個股' : 'ETF'} ${METRIC_LABEL[metric]} ${side === 'lower' ? '下界' : '上界'}：${before[side]?.value ?? '未設定'} → ${after[side]?.value ?? '未設定'}`);
      }
    }
  }
  return rows.length === 0 ? null : (
    <div><h5 className="micro">門檻變更</h5><ul className="apply__changes">{rows.map((row) => <li key={row}>{row}</li>)}</ul></div>
  );
}

/**
 * 規格：Profile 儲存前必須預覽哪些庫存標的的狀態會變。
 *
 * 套用候選與手動調整都走這裡，兩條路徑各寫一份的話，
 * 其中一條遲早會漏掉某種變更而讓使用者以為沒事。
 */
export function ProfileChangePreview({
  analyses,
  current,
  next,
  scenario = null,
}: {
  /** 尚未載入完成時為 null。 */
  analyses: StockAnalysis[] | null;
  current: Profile;
  next: Profile;
  scenario?: ResearchScenario | null;
}) {
  const changes = useMemo(
    () => (analyses === null ? [] : previewProfileChange({ analyses, current, next, scenario })),
    [analyses, current, next, scenario],
  );

  if (analyses === null) {
    return <><BoundaryChanges current={current} next={next} scenario={scenario} /><p className="apply__empty">正在讀取庫存資料…</p></>;
  }

  if (analyses.length === 0) {
    return <><BoundaryChanges current={current} next={next} scenario={scenario} /><p className="apply__empty">目前沒有庫存可以比對。</p></>;
  }

  if (changes.length === 0) {
    return <><BoundaryChanges current={current} next={next} scenario={scenario} /><p className="apply__empty">目前庫存沒有任何標的的區間歸屬會因此改變。</p></>;
  }

  return (
    <><BoundaryChanges current={current} next={next} scenario={scenario} /><ul className="apply__changes">
      {changes.map((row) => (
        <li key={`${row.scenario ?? 'generic'}-${row.stockId}-${row.metric}`}>
          <span className="num apply__change-id">{row.stockId}</span>
          <span className="apply__change-name">{row.stockName}</span>
          <span className="num">{percent(row.value, METRIC_UNIT[row.metric])}</span>
          <span className="apply__change-move">
            {row.before === null ? '未分類' : bandLabel(row.metric, row.before)}
            {' → '}
            {row.after === null ? '未分類' : bandLabel(row.metric, row.after)}
          </span>
        </li>
      ))}
    </ul></>
  );
}
