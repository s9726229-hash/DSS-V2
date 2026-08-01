import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyseHoldings, type StockAnalysis } from '../../dss/analyseHoldings';
import {
  boundaryConflict,
  clearBoundary,
  hasUnverifiedBoundary,
  isProfileEmpty,
  readEntry,
  setManualBoundary,
  type BoundarySide,
  type Profile,
  type ProfileBoundary,
} from '../../profile/profile';
import { readProfile, writeProfile } from '../../profile/profileStore';
import { bandLabel } from '../../research/bandLabels';
import {
  METRIC_LABEL,
  METRIC_UNIT,
  RESEARCH_METRICS,
  type ResearchMetric,
} from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import { ASSET_LABEL, EVIDENCE_LABEL } from '../research/evidence';
import { ProfileChangePreview } from './ProfileChangePreview';
import './ProfilePage.css';

const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];
const SIDES: BoundarySide[] = ['lower', 'upper'];

function when(iso: string): string {
  return iso.slice(0, 10);
}

/** 一個邊界的來源說明。看得到數字是怎麼來的，才有辦法回頭質疑它。 */
function Provenance({ boundary }: { boundary: ProfileBoundary }) {
  return (
    <span className="origin">
      {boundary.origin === 'manual' ? (
        <span className="origin__tag origin__tag--manual">自訂／未驗證</span>
      ) : (
        <span className="origin__tag">
          {boundary.sourceEvidence === null ? '候選' : EVIDENCE_LABEL[boundary.sourceEvidence]}
        </span>
      )}
      {boundary.appliedDespiteWeakEvidence ? (
        <span className="origin__tag origin__tag--override">證據不足仍套用</span>
      ) : null}
      <span className="origin__meta num">
        {when(boundary.updatedAt)}
        {boundary.sourceRunId === null ? '' : `．來源批次 ${when(boundary.sourceRunId.slice(4))}`}
      </span>
    </span>
  );
}

function BoundaryEditor({
  boundary,
  unit,
  onChange,
  onClear,
}: {
  boundary: ProfileBoundary | null;
  unit: string;
  onChange: (value: number) => void;
  onClear: () => void;
}) {
  // 編輯中保留原始輸入字串，否則打到負號或小數點就會被數字轉換吃掉
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (boundary === null ? '' : String(boundary.value));

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
    <div className="editor">
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
      ) : (
        <Provenance boundary={boundary} />
      )}
    </div>
  );
}

function ConditionsTable({
  profile,
  assetClass,
  onSet,
  onClear,
}: {
  profile: Profile;
  assetClass: AssetClass;
  onSet: (metric: ResearchMetric, side: BoundarySide, value: number) => void;
  onClear: (metric: ResearchMetric, side: BoundarySide) => void;
}) {
  return (
    <table className="checkpoints conditions">
      <thead>
        <tr>
          <th>指標</th>
          <th>下界</th>
          <th>上界</th>
        </tr>
      </thead>
      <tbody>
        {RESEARCH_METRICS.map((metric) => {
          const entry = readEntry(profile, assetClass, metric);
          const unit = METRIC_UNIT[metric];
          const conflict = boundaryConflict(entry);

          return (
            <tr key={metric} className={conflict ? 'conditions__row--conflict' : undefined}>
              <td>
                <span className="conditions__metric">{METRIC_LABEL[metric]}</span>
                <span className="conditions__bands">
                  ≤ 下界為{bandLabel(metric, 'pullback')}．≥ 上界為{bandLabel(metric, 'overheated')}
                </span>
                {conflict ? (
                  <span className="conditions__conflict">下界必須低於上界，否則中間區永遠是空的</span>
                ) : null}
              </td>
              {SIDES.map((side) => (
                <td key={side}>
                  <BoundaryEditor
                    boundary={entry[side]}
                    unit={unit}
                    onChange={(value) => onSet(metric, side, value)}
                    onClear={() => onClear(metric, side)}
                  />
                </td>
              ))}
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
      RESEARCH_METRICS.map((metric) => boundaryConflict(readEntry(draft, assetClass, metric))),
    ).filter(Boolean).length;
  }, [draft]);

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

  const empty = isProfileEmpty(saved);

  return (
    <div className="profile">
      {confirming ? (
        <div className="apply" role="dialog" aria-modal="true" aria-label="儲存判定條件">
          <div className="apply__panel">
            <h3 className="apply__title">儲存判定條件</h3>

            <h4 className="apply__section micro">儲存後庫存的變化</h4>
            <ProfileChangePreview analyses={holdings} current={saved} next={draft} />

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
        <h1 className="profile__title">Profile</h1>
        <p className="profile__lede">
          判讀庫存與觀察標的時使用的門檻。門檻只影響現在的判讀，
          不會改動交易紀錄、研究樣本或歷史快照，也不代表未來報酬。
        </p>
      </header>

      <section className="profile__section" aria-label="候選參數">
        <h2 className="profile__section-title">候選參數</h2>
        {empty ? (
          <p className="research__empty">
            還沒有套用任何候選門檻。到<strong>歷史交易研究</strong>
            選一個區間，按「加入 Profile 候選」。
          </p>
        ) : (
          <p className="profile__note">
            下方每個門檻都標示了來源：從哪一批研究來的、當時的證據等級，
            以及是否在證據不足的情況下仍被套用。
            {hasUnverifiedBoundary(saved)
              ? '　目前有手動設定的門檻，它們沒有經過驗證。'
              : ''}
          </p>
        )}
      </section>

      <section className="profile__section" aria-label="判定條件">
        <h2 className="profile__section-title">判定條件</h2>
        <p className="profile__note">
          個股與 ETF 分開，兩者不共用門檻。直接改數字即可，清空欄位代表取消該門檻。
          v1 不提供單一標的覆寫。
        </p>

        {ASSET_CLASSES.map((assetClass) => (
          <div className="profile__asset" key={assetClass}>
            <h3 className="profile__asset-title">{ASSET_LABEL[assetClass]}</h3>
            <ConditionsTable
              profile={draft}
              assetClass={assetClass}
              onSet={(metric, side, value) =>
                setDraft((current) =>
                  current === null
                    ? current
                    : setManualBoundary(current, {
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
                  current === null ? current : clearBoundary(current, { assetClass, metric, side }),
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
