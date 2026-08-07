import { useCallback, useEffect, useState } from 'react';
import { backfillResearchData } from '../../research/backfill';
import { loadResearchLedger, prepareResearchLedgerData } from '../../research/loadLedger';
import { selectLedgerEvents } from '../../research/positionLedger';
import {
  METRIC_LABEL,
  METRIC_UNIT,
  researchMetricsFor,
  runResearch,
  type ResearchScenario,
  type ScenarioResearchMetric,
  type ResearchReport,
  type ResearchSample,
} from '../../research/runResearch';
import { readResearchRuns, saveResearchRun } from '../../research/runStore';
import type { AssetClass } from '../../research/snapshot';
import { buildTransactionLog, type TransactionLogRow } from '../../research/transactionLog';
import type { BandResult, WalkForwardResult } from '../../research/walkForward';
import type { ResearchRunRecord } from '../../storage/types';
import { DriftLine } from './DriftLine';
import { bandLabel } from '../../research/bandLabels';
import { readProfile, writeProfile } from '../../profile/profileStore';
import { emptyProfile, type Profile } from '../../profile/profile';
import { analyseHoldings, type StockAnalysis } from '../../dss/analyseHoldings';
import { ApplyCandidate, type PendingCandidate } from './ApplyCandidate';
import { ASSET_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from './evidence';
import { percent } from './format';
import { ResearchHistory } from './ResearchHistory';
import { TransactionLog } from './TransactionLog';
import './ResearchPage.css';

type View = 'result' | 'log' | 'history';

const VIEW_LABEL: Record<View, string> = {
  result: '研究結果',
  log: '交易歷史',
  history: '搜尋紀錄',
};

const SCENARIO_LABEL: Record<ResearchScenario, string> = {
  establish: '建立部位',
  'add-on': '加碼研究',
  reentry: '再進場研究',
};

const LEDGER_ISSUE_LABEL: Record<string, string> = {
  'opening-position-unknown': '期初部位不明',
  'same-day-opposite-sides': '同日反向交易',
  'scheduled-investment': '定期定額',
  'trade-method-unknown': '交易方式不明',
  'non-cash-position': '非現股部位',
  'day-trade': '現沖',
  'split-data-missing': '拆股資料缺漏',
};

/** 沒有任何檢查點時兩端都是 null，此時要明說沒有門檻，而非印出「≤ —」。 */
function rangeText(range: BandResult['range'], unit: string): string {
  if (range.min === null && range.max === null) {
    return '尚無可用門檻';
  }
  if (range.min === null) {
    return `≤ ${percent(range.max, unit)}`;
  }
  if (range.max === null) {
    return `≥ ${percent(range.min, unit)}`;
  }
  return `${percent(range.min, unit)} ～ ${percent(range.max, unit)}`;
}

/**
 * 條件分布。每筆建立部位一個刻度，直接看見樣本量與集中程度，
 * 而不是只給一條看不出依據的平滑曲線。
 */
function Distribution({
  samples,
  unit,
}: {
  samples: ResearchSample[];
  unit: string;
}) {
  const values = samples
    .map((row) => row.metricValue)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return <p className="research__empty-line">此分類沒有可用的指標值。</p>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return (
    <div className="dist">
      <div className="dist__track">
        {samples.map((row, index) =>
          row.metricValue === null ? null : (
            <span
              key={`${row.stockId}-${row.entryDate}-${index}`}
              className={row.complete ? 'dist__tick' : 'dist__tick dist__tick--pending'}
              style={{ left: `${((row.metricValue - min) / span) * 100}%` }}
              title={`${row.stockId} ${row.entryDate}　${row.metricValue.toFixed(2)}${unit}`}
            />
          ),
        )}
      </div>
      <div className="dist__scale">
        <span className="num">{min.toFixed(2)}{unit}</span>
        <span className="dist__count">{values.length} 筆</span>
        <span className="num">{max.toFixed(2)}{unit}</span>
      </div>
    </div>
  );
}

function Checkpoints({ result, unit }: { result: WalkForwardResult; unit: string }) {
  if (result.checkpoints.length === 0) {
    return <p className="research__empty-line">樣本不足以形成任何時間檢查點。</p>;
  }

  return (
    <table className="checkpoints">
      <thead>
        <tr>
          <th>訓練截止日</th>
          <th>訓練</th>
          <th>驗證</th>
          <th>P25</th>
          <th>P75</th>
        </tr>
      </thead>
      <tbody>
        {result.checkpoints.map((checkpoint) => (
          <tr key={checkpoint.trainingCutoff}>
            <td className="num">{checkpoint.trainingCutoff}</td>
            <td className="num">{checkpoint.trainingCount}</td>
            <td className="num">{checkpoint.validationCount}</td>
            <td className="num">{percent(checkpoint.p25, unit)}</td>
            <td className="num">{percent(checkpoint.p75, unit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Band({
  band,
  unit,
  metric,
  onApply,
}: {
  band: BandResult;
  unit: string;
  metric: ScenarioResearchMetric;
  onApply?: (band: BandResult) => void;
}) {
  const tone = EVIDENCE_TONE[band.evidence];
  const label = bandLabel(metric, band.band);
  // 沒有門檻就沒有東西可以寫進 Profile
  const applicable = band.range.min !== null || band.range.max !== null;

  return (
    <article className="band" aria-label={label}>
      <header className="band__head">
        <h4 className="band__title">{label}</h4>
        <span className={`badge badge--${tone}`}>{EVIDENCE_LABEL[band.evidence]}</span>
      </header>

      <p className="band__range num">
        {rangeText(band.range, unit)}
        {band.range.min === null && band.range.max === null ? null : (
          <>
            {' '}
            <span className="band__range-note">最新檢查點</span>
          </>
        )}
      </p>

      <dl className="band__stats">
        <div>
          <dt>完整事件</dt>
          <dd className="num">{band.completeCount}</dd>
        </div>
        <div>
          <dt>非重疊</dt>
          <dd className="num">{band.nonOverlappingCount}</dd>
        </div>
        <div>
          <dt>翻轉</dt>
          <dd className="num">{band.flippedCount}</dd>
        </div>
        <div>
          <dt>中位數</dt>
          <dd className="num">{percent(band.median, '%')}</dd>
        </div>
        <div>
          <dt>穩定中位數</dt>
          <dd className="num">{percent(band.stableMedian, '%')}</dd>
        </div>
        <div>
          <dt>平均</dt>
          <dd className="num">{percent(band.mean, '%')}</dd>
        </div>
        <div>
          <dt>最差</dt>
          <dd className="num">{percent(band.worst, '%')}</dd>
        </div>
        <div>
          <dt>正負</dt>
          <dd className="num">
            {band.positiveCount} / {band.negativeCount}
          </dd>
        </div>
      </dl>

      <p className="band__reason">{band.reason}</p>

      {onApply === undefined ? <p className="band__reason">此為加碼專用研究指標，尚不可套用到通用 Profile。</p> : <button
        type="button"
        className="band__apply"
        disabled={!applicable}
        title={applicable ? undefined : '這個區間還沒有可用門檻'}
        onClick={() => onApply(band)}
      >
        加入 Profile 候選
      </button>}
    </article>
  );
}

function AssetSection({
  assetClass,
  result,
  samples,
  unit,
  metric,
  onApply,
}: {
  assetClass: AssetClass;
  result: WalkForwardResult;
  samples: ResearchSample[];
  unit: string;
  metric: ScenarioResearchMetric;
  onApply?: (assetClass: AssetClass, band: BandResult) => void;
}) {
  const scoped = samples.filter((row) => row.assetClass === assetClass);

  return (
    <section className="asset" aria-label={ASSET_LABEL[assetClass]}>
      <header className="asset__head">
        <h3 className="asset__title">{ASSET_LABEL[assetClass]}</h3>
        <span className="asset__baseline num">
          同類基準中位數 {percent(result.baseline.median, '%')}．完整樣本{' '}
          {result.baseline.completeCount}
        </span>
      </header>

      <h4 className="asset__label micro">條件分布</h4>
      <Distribution samples={scoped} unit={unit} />

      <h4 className="asset__label micro">候選門檻</h4>
      <Checkpoints result={result} unit={unit} />
      <DriftLine drift={result.drift} unit={unit} />

      <h4 className="asset__label micro">
        驗證結果（{assetClass === 'etf' ? 'ETF 買進後 60 個交易日' : '個股買進後 20 個交易日'}）
      </h4>
      <div className="bands">
        {result.bands.map((band) => (
          <Band
            key={band.band}
            band={band}
            unit={unit}
            metric={metric}
            onApply={onApply === undefined ? undefined : (applied) => onApply(assetClass, applied)}
          />
        ))}
      </div>
    </section>
  );
}

export function ResearchPage() {
  const [view, setView] = useState<View>('result');
  const [scenario, setScenario] = useState<ResearchScenario>('establish');
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [runs, setRuns] = useState<ResearchRunRecord[] | null>(null);
  const [log, setLog] = useState<TransactionLogRow[]>([]);
  const [profile, setProfile] = useState<Profile>(emptyProfile());
  const [holdings, setHoldings] = useState<StockAnalysis[] | null>(null);
  const [pending, setPending] = useState<PendingCandidate | null>(null);
  const [metric, setMetric] = useState<ScenarioResearchMetric>('bias20');
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  /**
   * 每次研究結束就保存一次候選搜尋（規格步驟 4）。
   * 內容與上一筆相同時 saveResearchRun 會自行略過，重新整理頁面不會灌爆紀錄。
   */
  const refresh = useCallback(() => {
    void (async () => {
      const next = await runResearch(scenario);
      setReport(next);
      setLog(buildTransactionLog(await loadResearchLedger()));
      setProfile(await readProfile());
      await saveResearchRun(next, new Date().toISOString());
      setRuns(await readResearchRuns());
    })();
  }, [scenario]);

  useEffect(refresh, [refresh]);

  // 庫存狀態只為了「套用後會變動哪些標的」的預覽而讀，與研究結果無關
  useEffect(() => {
    let cancelled = false;
    void analyseHoldings().then((results) => {
      if (!cancelled) setHoldings(results);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 最新一次搜尋紀錄，套用時記下候選是從哪一批研究來的。 */
  const latestRunId = runs !== null && runs.length > 0 ? runs[0].id : null;

  const confirmApply = useCallback((next: Profile) => {
    setPending(null);
    void (async () => {
      await writeProfile(next);
      setProfile(next);
    })();
  }, []);

  const backfill = useCallback(() => {
    setBackfilling(true);
    setProgress({ done: 0, total: 0 });

    void (async () => {
      await prepareResearchLedgerData();
      const entries = selectLedgerEvents(await loadResearchLedger(), scenario);
      await backfillResearchData(entries, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setBackfilling(false);
      refresh();
    })();
  }, [refresh, scenario]);

  if (report === null) {
    return <p className="research__loading">讀取中…</p>;
  }

  return (
    <div className="research">
      {pending === null ? null : (
        <ApplyCandidate
          candidate={pending}
          profile={profile}
          analyses={holdings}
          onCancel={() => setPending(null)}
          onConfirm={confirmApply}
        />
      )}

      <header className="research__head">
        <h1 className="research__title">歷史研究</h1>
        <p className="research__lede">
          用過去交易資料檢查哪些條件值得繼續追蹤。分析 2026 年起的建立部位在買進當日的條件，以及買進後的實際結果。
          2025 年資料只作查閱，不納入候選。加碼、再進場與現沖不列入本輪分析
          {report.reentryCount > 0 ? `（另有 ${report.reentryCount} 筆再進場已保留紀錄）` : null}。
        </p>
      </header>

      <nav className="tabs" aria-label="研究情境" role="tablist">
        {(Object.keys(SCENARIO_LABEL) as ResearchScenario[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={id === scenario} className={id === scenario ? 'tabs__item tabs__item--active' : 'tabs__item'} aria-current={id === scenario ? 'page' : undefined} onClick={() => setScenario(id)}>
            {SCENARIO_LABEL[id]}
          </button>
        ))}
      </nav>

      <section className="research__inventory" aria-label="研究樣本">
        <div className="gauge">
          <p className="gauge__label micro">建立部位</p>
          <p className="gauge__value">
            <span className="num">{report.entryCount}</span>
            <span className="gauge__unit">筆</span>
          </p>
        </div>
        <div className={report.technicalCount > 0 ? 'gauge' : 'gauge gauge--pending'}>
          <p className="gauge__label micro">技術面可分析</p>
          <p className="gauge__value">
            <span className="num">{report.technicalCount}</span>
            <span className="gauge__unit">筆</span>
          </p>
        </div>
        <div className={report.chipCount > 0 ? 'gauge' : 'gauge gauge--pending'}>
          <p className="gauge__label micro">籌碼面可分析</p>
          <p className="gauge__value">
            <span className="num">{report.chipCount}</span>
            <span className="gauge__unit">筆</span>
          </p>
        </div>
        <div className={report.completeCount > 0 ? 'gauge' : 'gauge gauge--pending'}>
          <p className="gauge__label micro">觀察窗完整</p>
          <p className="gauge__value">
            <span className="num">{report.completeCount}</span>
            <span className="gauge__unit">筆</span>
          </p>
        </div>
        <div className="research__actions">
          <button type="button" className="btn" disabled={backfilling} onClick={backfill}>
            {backfilling
              ? `回補中… ${progress.done}/${progress.total}`
              : '回補歷史資料'}
          </button>
        </div>
      </section>

      <details className="research__quality">
        <summary>
          排除原因（
          {Object.values(report.ledgerQuality.excludedByCode).reduce((sum, count) => sum + count, 0)}）
        </summary>
        <ul>
          {Object.entries(report.ledgerQuality.excludedByCode)
            .filter(([, count]) => count > 0)
            .map(([code, count]) => (
              <li key={code}>{LEDGER_ISSUE_LABEL[code] ?? code}：{count} 筆</li>
            ))}
        </ul>
      </details>

      <nav className="tabs" aria-label="研究檢視">
        {(['result', 'log', 'history'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={id === view ? 'tabs__item tabs__item--active' : 'tabs__item'}
            aria-current={id === view ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            {VIEW_LABEL[id]}
          </button>
        ))}
      </nav>

      {view === 'log' ? <TransactionLog rows={log} /> : null}

      {view === 'history' ? <ResearchHistory runs={runs} /> : null}

      {view === 'result' ? (
        <>
          {report.entryCount === 0 ? (
            <p className="research__empty">
              研究期間內沒有建立部位。請先到<strong>資料中心</strong>匯入交易明細。
            </p>
          ) : null}

          {report.missingStocks.length > 0 ? (
            <p className="research__missing">
              有 {report.missingStocks.length} 檔尚未回補價格資料，這些建立部位無法分析。
              請按「回補歷史資料」。
            </p>
          ) : null}

          <nav className="tabs" aria-label="研究指標" role="tablist">
            {researchMetricsFor(scenario).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === metric}
                className={id === metric ? 'tabs__item tabs__item--active' : 'tabs__item'}
                aria-current={id === metric ? 'page' : undefined}
                onClick={() => setMetric(id)}
              >
                {METRIC_LABEL[id]}
              </button>
            ))}
          </nav>

          {(['stock', 'etf'] as const).map((assetClass) => (
            <AssetSection
              key={assetClass}
              assetClass={assetClass}
              result={report.results[metric]![assetClass]}
              samples={report.samples[metric] ?? []}
              unit={METRIC_UNIT[metric]}
              metric={metric}
              onApply={(applied, band) => setPending({ scenario, metric, assetClass: applied, band, runId: latestRunId })}
            />
          ))}

          <p className="research__footnote">
            候選區間由系統依歷史資料產生，尚未套用到任何判定。是否採用由你決定，
            且採用後仍可修改或回復。本頁不產生買賣建議。
          </p>
        </>
      ) : null}
    </div>
  );
}
