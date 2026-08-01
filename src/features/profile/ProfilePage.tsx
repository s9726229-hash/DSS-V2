import { useEffect, useState } from 'react';
import {
  isProfileEmpty,
  readEntry,
  type Profile,
  type ProfileBoundary,
} from '../../profile/profile';
import { readProfile } from '../../profile/profileStore';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT, RESEARCH_METRICS } from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import { ASSET_LABEL, EVIDENCE_LABEL } from '../research/evidence';
import { percent } from '../research/format';
import './ProfilePage.css';

const ASSET_CLASSES: AssetClass[] = ['stock', 'etf'];

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

function BoundaryCell({ boundary, unit }: { boundary: ProfileBoundary | null; unit: string }) {
  if (boundary === null) {
    return <span className="conditions__unset">未設定</span>;
  }

  return (
    <>
      <span className="num conditions__value">{percent(boundary.value, unit)}</span>
      <Provenance boundary={boundary} />
    </>
  );
}

function ConditionsTable({ profile, assetClass }: { profile: Profile; assetClass: AssetClass }) {
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

          return (
            <tr key={metric}>
              <td>
                <span className="conditions__metric">{METRIC_LABEL[metric]}</span>
                <span className="conditions__bands">
                  ≤ 下界為{bandLabel(metric, 'pullback')}．≥ 上界為{bandLabel(metric, 'overheated')}
                </span>
              </td>
              <td>
                <BoundaryCell boundary={entry.lower} unit={unit} />
              </td>
              <td>
                <BoundaryCell boundary={entry.upper} unit={unit} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readProfile().then((next) => {
      if (!cancelled) setProfile(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (profile === null) {
    return <p className="research__loading">讀取中…</p>;
  }

  const empty = isProfileEmpty(profile);

  return (
    <div className="profile">
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
          </p>
        )}
      </section>

      <section className="profile__section" aria-label="判定條件">
        <h2 className="profile__section-title">判定條件</h2>
        <p className="profile__note">
          個股與 ETF 分開，兩者不共用門檻。v1 不提供單一標的覆寫。
        </p>

        {ASSET_CLASSES.map((assetClass) => (
          <div className="profile__asset" key={assetClass}>
            <h3 className="profile__asset-title">{ASSET_LABEL[assetClass]}</h3>
            <ConditionsTable profile={profile} assetClass={assetClass} />
          </div>
        ))}
      </section>
    </div>
  );
}
