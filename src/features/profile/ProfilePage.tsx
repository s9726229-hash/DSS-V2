import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyseHoldings, type StockAnalysis } from '../../dss/analyseHoldings';
import {
  boundaryConflict,
  clearScenarioBoundary,
  isScenarioProfileEmpty,
  readScenarioEntry,
  setScenarioManualBoundary,
  type BoundarySide,
  type Profile,
  type ProfileBoundary,
} from '../../profile/profile';
import { readProfile, writeProfile } from '../../profile/profileStore';
import { bandLabel } from '../../research/bandLabels';
import {
  METRIC_LABEL,
  METRIC_UNIT,
  researchMetricsFor,
  type ResearchScenario,
  type ScenarioResearchMetric,
} from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import { ASSET_LABEL, EVIDENCE_LABEL } from '../research/evidence';
import { ProfileChangePreview } from './ProfileChangePreview';
import './ProfilePage.css';

const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];
const SIDES: BoundarySide[] = ['lower', 'upper'];
const SCENARIO_LABEL: Record<ResearchScenario, string> = {
  establish: '建立部位', 'add-on': '加碼', reentry: '再進場',
};

function formatBoundary(value: number): string {
  return value.toFixed(2);
}

function reviewCounts(profile: Profile, scenario: ResearchScenario) {
  let insufficientData = 0;
  let appliedDespiteWeakEvidence = 0;

  for (const assetClass of ASSET_CLASSES) {
    for (const metric of researchMetricsFor(scenario)) {
      const entry = readScenarioEntry(profile, scenario, assetClass, metric);
      for (const side of SIDES) {
        const boundary = entry[side];
        if (boundary?.sourceEvidence === 'insufficient-data') insufficientData += 1;
        if (boundary?.appliedDespiteWeakEvidence) appliedDespiteWeakEvidence += 1;
      }
    }
  }

  return { insufficientData, appliedDespiteWeakEvidence };
}

/** 表格只放圖示；完整意思集中在表格上方，避免每格重複長文字。 */
function Provenance({ boundary }: { boundary: ProfileBoundary }) {
  return (
    <span className="origin">
      {boundary.origin === 'manual' ? <span className="origin__mark" title="自訂門檻，未驗證" aria-label="自訂門檻，未驗證">✎</span> : null}
      {boundary.origin === 'candidate' && boundary.sourceEvidence !== 'worth-tracking' ? <span className="origin__mark" title={boundary.sourceEvidence === null ? '研究證據未足' : EVIDENCE_LABEL[boundary.sourceEvidence]} aria-label={boundary.sourceEvidence === null ? '研究證據未足' : EVIDENCE_LABEL[boundary.sourceEvidence]}>◷</span> : null}
      {boundary.appliedDespiteWeakEvidence ? (
        <span className="origin__mark" title="證據不足仍套用" aria-label="證據不足仍套用">!</span>
      ) : null}
    </span>
  );
}

function BoundaryEditor({
  boundary,
  unit,
  zone,
  onChange,
  onClear,
}: {
  boundary: ProfileBoundary | null;
  unit: string;
  zone: string;
  onChange: (value: number) => void;
  onClear: () => void;
}) {
  // 編輯中保留原始輸入字串，否則打到負號或小數點就會被數字轉換吃掉
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (boundary === null ? '' : formatBoundary(boundary.value));
  const needsReview = boundary !== null &&
    (boundary.origin === 'manual' || boundary.sourceEvidence !== 'worth-tracking');

  const commit = (raw: string) => {
    setDraft(null);
    const trimmed = raw.trim();

    if (trimmed === '') {
      onClear();
      return;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed !== boundary?.value) onChange(parsed);
  };

  return (
    <div className={needsReview ? 'editor editor--review' : 'editor'}>
      <div className="editor__meta">
        <span className="editor__zone">{zone}</span>
        {boundary === null ? null : <Provenance boundary={boundary} />}
      </div>
      <label className="editor__field">
        <input
          className="editor__input num"
          type="text"
          inputMode="decimal"
          value={shown}
          placeholder="未設定"
          aria-label="門檻值"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraft(null);
          }}
        />
        <span className="editor__unit">{unit === '' ? '（強度）' : unit}</span>
      </label>

      {boundary === null ? (
        <span className="conditions__unset">未設定</span>
      ) : null}
    </div>
  );
}

function ConditionsTable({
  profile,
  scenario,
  assetClass,
  onSet,
  onClear,
}: {
  profile: Profile;
  scenario: ResearchScenario;
  assetClass: AssetClass;
  onSet: (metric: ScenarioResearchMetric, side: BoundarySide, value: number) => void;
  onClear: (metric: ScenarioResearchMetric, side: BoundarySide) => void;
}) {
  return (
    <table className="checkpoints conditions">
      <colgroup>
        <col className="conditions__metric-col" />
        <col className="conditions__boundary-col" />
        <col className="conditions__normal-col" />
        <col className="conditions__boundary-col" />
      </colgroup>
      <thead>
        <tr>
          <th>指標</th>
          <th>下界</th>
          <th>一般</th>
          <th>上界</th>
        </tr>
      </thead>
      <tbody>
        {researchMetricsFor(scenario).map((metric) => {
          const entry = readScenarioEntry(profile, scenario, assetClass, metric);
          const unit = METRIC_UNIT[metric];
          const conflict = boundaryConflict(entry);

          return (
            <tr key={metric} className={conflict ? 'conditions__row--conflict' : undefined}>
              <td>
                <span className="conditions__metric">{METRIC_LABEL[metric]}</span>
                {conflict ? (
                  <span className="conditions__conflict">下界必須低於上界，否則中間區永遠是空的</span>
                ) : null}
              </td>
              <td className="conditions__boundary-cell">
                <BoundaryEditor
                  boundary={entry.lower}
                  unit={unit}
                  zone={bandLabel(metric, 'pullback')}
                  onChange={(value) => onSet(metric, 'lower', value)}
                  onClear={() => onClear(metric, 'lower')}
                />
              </td>
              <td className="conditions__normal-cell">
                <span className="conditions__normal">{bandLabel(metric, 'normal')}</span>
              </td>
              <td className="conditions__boundary-cell conditions__boundary-cell--upper">
                <BoundaryEditor
                  boundary={entry.upper}
                  unit={unit}
                  zone={bandLabel(metric, 'overheated')}
                  onChange={(value) => onSet(metric, 'upper', value)}
                  onClear={() => onClear(metric, 'upper')}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ProfilePage() {
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [holdings, setHoldings] = useState<StockAnalysis[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [scenario, setScenario] = useState<ResearchScenario>('establish');

  useEffect(() => {
    let cancelled = false;
    void readProfile().then((next) => {
      if (cancelled) return;
      setSaved(next);
      setDraft(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 庫存狀態只為了預覽而讀
  useEffect(() => {
    let cancelled = false;
    void analyseHoldings().then((results) => {
      if (!cancelled) setHoldings(results);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft],
  );

  const conflicts = useMemo(() => {
    if (draft === null) return 0;
    return ASSET_CLASSES.flatMap((assetClass) =>
      researchMetricsFor(scenario).map((metric) => boundaryConflict(readScenarioEntry(draft, scenario, assetClass, metric))),
    ).filter(Boolean).length;
  }, [draft, scenario]);

  const save = useCallback(() => {
    if (draft === null) return;
    setConfirming(false);
    void (async () => {
      await writeProfile(draft);
      setSaved(draft);
    })();
  }, [draft]);

  if (saved === null || draft === null) {
    return <p className="research__loading">讀取中…</p>;
  }

  const empty = isScenarioProfileEmpty(saved, scenario);
  const review = reviewCounts(draft, scenario);

  return (
    <div className="profile">
      {confirming ? (
        <div className="apply" role="dialog" aria-modal="true" aria-label="儲存判定條件">
          <div className="apply__panel">
            <h3 className="apply__title">儲存判定條件</h3>

            <h4 className="apply__section micro">儲存後庫存的變化</h4>
            <ProfileChangePreview analyses={holdings} current={saved} next={draft} scenario={scenario} />

            <p className="apply__note">
              手動調整的門檻會標示為「自訂／未驗證」——它沒有經過 walk-forward 驗證，
              只是你指定的數字。Profile 只影響目前的判讀，不會改動交易紀錄、研究樣本
              或歷史快照，也不代表未來報酬。
            </p>

            <div className="apply__actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button type="button" className="btn btn--primary" onClick={save}>
                儲存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="profile__head">
        <h1 className="profile__title">目前規則</h1>
        <p className="profile__lede">
          個股與 ETF 的目前判讀門檻；只影響今天的判讀，不改動交易、研究或歷史資料，也不代表未來報酬。
        </p>
      </header>

      <nav className="tabs" aria-label="Profile 情境" role="tablist">
        {(Object.keys(SCENARIO_LABEL) as ResearchScenario[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={scenario === id}
            className={scenario === id ? 'tabs__item tabs__item--active' : 'tabs__item'}
            onClick={() => setScenario(id)}>{SCENARIO_LABEL[id]}</button>
        ))}
      </nav>

      {review.insufficientData > 0 || review.appliedDespiteWeakEvidence > 0 ? (
        <aside className="profile__review" role="note" aria-label="需要複核的規則">
          <strong>複核圖示</strong>
          <span><i className="profile__legend-box" aria-hidden="true" />橘框代表需要複核</span>
          <span><b aria-hidden="true">◷</b>研究證據未足</span>
          <span><b aria-hidden="true">!</b>仍套用</span>
          <span><b aria-hidden="true">✎</b>自訂、未驗證</span>
        </aside>
      ) : null}

      <section className="profile__section" aria-label="候選參數">
        <h2 className="profile__section-title">候選參數</h2>
        {empty ? (
          <p className="research__empty">
            還沒有套用任何候選門檻。到<strong>歷史交易研究</strong>
            選一個區間，按「加入 Profile 候選」。
          </p>
        ) : (
          <p className="profile__note">
            每個門檻都保留來源與證據等級；橘框代表需要複核。
            情境規則與 V1 通用規則分開保存。
          </p>
        )}
      </section>

      <section className="profile__section" aria-label="判定條件">
        <h2 className="profile__section-title">判定條件</h2>
        <p className="profile__note">
          個股與 ETF 各自判定；直接改數字，清空即取消門檻。
        </p>

        {ASSET_CLASSES.map((assetClass) => (
          <div className="profile__asset" key={assetClass}>
            <h3 className="profile__asset-title">{ASSET_LABEL[assetClass]}</h3>
            <ConditionsTable
              profile={draft}
              scenario={scenario}
              assetClass={assetClass}
              onSet={(metric, side, value) =>
                setDraft((current) =>
                  current === null
                    ? current
                    : setScenarioManualBoundary(current, {
                        scenario,
                        assetClass,
                        metric,
                        side,
                        value,
                        at: new Date().toISOString(),
                      }),
                )
              }
              onClear={(metric, side) =>
                setDraft((current) =>
                  current === null ? current : clearScenarioBoundary(current, { scenario, assetClass, metric, side }),
                )
              }
            />
          </div>
        ))}
      </section>

      {dirty ? (
        <div className="profile__bar" role="status">
          <span className="profile__bar-text">
            有尚未儲存的調整。
            {conflicts > 0 ? `　${conflicts} 個指標的下界不低於上界，請先修正。` : ''}
          </span>
          <button type="button" className="btn" onClick={() => setDraft(saved)}>
            捨棄
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={conflicts > 0}
            onClick={() => setConfirming(true)}
          >
            預覽並儲存
          </button>
        </div>
      ) : null}
    </div>
  );
}
