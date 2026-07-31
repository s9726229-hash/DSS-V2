import { METRIC_LABEL, METRIC_UNIT, RESEARCH_METRICS } from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import type { WalkForwardResult } from '../../research/walkForward';
import type { ResearchRunRecord } from '../../storage/types';
import { ASSET_LABEL, BAND_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from './evidence';
import { percent } from './format';

const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];

/** 顯示為當地時間；紀錄本身以 ISO 保存，排序不受顯示格式影響。 */
function timestamp(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 最新一個檢查點的門檻，與研究結果頁區間顯示的值一致。 */
function latestThresholds(result: WalkForwardResult): { p25: number | null; p75: number | null } {
  const last = result.checkpoints[result.checkpoints.length - 1];
  return { p25: last?.p25 ?? null, p75: last?.p75 ?? null };
}

function Row({
  result,
  metricLabel,
  assetClass,
  unit,
}: {
  result: WalkForwardResult;
  metricLabel: string;
  assetClass: AssetClass;
  unit: string;
}) {
  const { p25, p75 } = latestThresholds(result);

  return (
    <tr>
      <td>{metricLabel}</td>
      <td>{ASSET_LABEL[assetClass]}</td>
      <td className="num">{result.checkpoints.length}</td>
      <td className="num">{percent(p25, unit)}</td>
      <td className="num">{percent(p75, unit)}</td>
      {result.bands.map((band) => (
        <td key={band.band}>
          {/* 淘汰原因完整保存在紀錄裡，這裡以 title 帶出，避免表格被長句撐爆 */}
          <span className={`badge badge--${EVIDENCE_TONE[band.evidence]}`} title={band.reason}>
            {EVIDENCE_LABEL[band.evidence]}
          </span>
        </td>
      ))}
    </tr>
  );
}

export function ResearchHistory({ runs }: { runs: ResearchRunRecord[] | null }) {
  if (runs === null) {
    return <p className="research__empty-line">讀取中…</p>;
  }

  if (runs.length === 0) {
    return (
      <p className="research__empty">
        還沒有任何搜尋紀錄。有可分析的建立部位之後，每次結果變動都會自動留下一筆。
      </p>
    );
  }

  return (
    <div className="history">
      <p className="history__lede">
        每次候選搜尋的完整結果，包含各檢查點門檻與每個區間的合格／淘汰原因。
        結果與上一次完全相同時不另存一筆，因此每一列都代表一次真正的變動。
        滑過證據等級可看到判定原因。
      </p>

      {runs.map((run) => (
        <section className="history__run" key={run.id} aria-label={`搜尋紀錄 ${run.executedAt}`}>
          <header className="history__head">
            <h3 className="history__time num">{timestamp(run.executedAt)}</h3>
            <span className="history__counts num">
              建立部位 {run.entryCount}．技術面 {run.technicalCount}．籌碼面 {run.chipCount}．
              完整樣本 {run.completeCount}
            </span>
          </header>

          <div className="history__scroll">
            <table className="checkpoints history__table">
              <thead>
                <tr>
                  <th>指標</th>
                  <th>類別</th>
                  <th>檢查點</th>
                  <th>P25</th>
                  <th>P75</th>
                  {(['pullback', 'normal', 'overheated'] as const).map((band) => (
                    <th key={band}>{BAND_LABEL[band]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESEARCH_METRICS.flatMap((metric) =>
                  ASSET_CLASSES.map((assetClass) => (
                    <Row
                      key={`${metric}-${assetClass}`}
                      result={run.results[metric][assetClass]}
                      metricLabel={METRIC_LABEL[metric]}
                      assetClass={assetClass}
                      unit={METRIC_UNIT[metric]}
                    />
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
