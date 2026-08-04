import { useMemo, useState } from 'react';
import type { StockAnalysis } from '../../dss/analyseHoldings';
import { applyResearchCandidates, readEntry, type Profile } from '../../profile/profile';
import type { ResearchCandidate } from '../../profile/researchCandidates';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT } from '../../research/runResearch';
import { ASSET_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from '../research/evidence';
import { percent } from '../research/format';
import { ProfileChangePreview } from './ProfileChangePreview';

function candidateLabel(candidate: ResearchCandidate): string {
  return `${ASSET_LABEL[candidate.assetClass]} ${METRIC_LABEL[candidate.metric]} ${bandLabel(candidate.metric, candidate.band)}`;
}

function boundaryText(candidate: ResearchCandidate): string {
  const unit = METRIC_UNIT[candidate.metric];
  const { min, max } = candidate.range;

  if (candidate.band === 'pullback') return `下界 ${percent(max, unit)}`;
  if (candidate.band === 'overheated') return `上界 ${percent(min, unit)}`;
  return `下界 ${percent(min, unit)}．上界 ${percent(max, unit)}`;
}

function overwriteText(profile: Profile, candidate: ResearchCandidate): string {
  const unit = METRIC_UNIT[candidate.metric];
  const entry = readEntry(profile, candidate.assetClass, candidate.metric);
  const value = (current: number | null, next: number | null) =>
    `${current === null ? '未設定' : percent(current, unit)} → ${percent(next, unit)}`;

  if (candidate.band === 'pullback') {
    return `下界 ${value(entry.lower?.value ?? null, candidate.range.max)}`;
  }
  if (candidate.band === 'overheated') {
    return `上界 ${value(entry.upper?.value ?? null, candidate.range.min)}`;
  }
  return [
    `下界 ${value(entry.lower?.value ?? null, candidate.range.min)}`,
    `上界 ${value(entry.upper?.value ?? null, candidate.range.max)}`,
  ].join('；');
}

function sourceDate(executedAt: string): string {
  return new Date(executedAt).toISOString().slice(0, 10);
}

export function ApplyResearchCandidates({
  candidates,
  profile,
  analyses,
  onCancel,
  onConfirm,
}: {
  candidates: readonly ResearchCandidate[];
  profile: Profile;
  analyses: StockAnalysis[] | null;
  onCancel: () => void;
  onConfirm: (next: Profile) => void;
}) {
  const [acknowledgedIds, setAcknowledgedIds] = useState<ReadonlySet<string>>(new Set());
  const weakCandidates = candidates.filter((candidate) => candidate.evidence !== 'worth-tracking');
  const blocked = weakCandidates.some((candidate) => !acknowledgedIds.has(candidate.id));
  const next = useMemo(
    () => applyResearchCandidates(profile, candidates, new Date().toISOString()),
    [profile, candidates],
  );

  return (
    <div className="apply" role="dialog" aria-modal="true" aria-label="確認套用已選規則">
      <div className="apply__panel apply-research__panel">
        <h3 className="apply__title">確認套用 {candidates.length} 個研究候選</h3>

        <ul className="apply-research__candidates">
          {candidates.map((candidate) => {
            const label = candidateLabel(candidate);
            const weak = candidate.evidence !== 'worth-tracking';

            return (
              <li key={candidate.id} className="apply-research__candidate">
                <h4 className="apply-research__candidate-title">{label}</h4>
                <dl className="apply__facts">
                  <div>
                    <dt>研究日期</dt>
                    <dd className="num">{sourceDate(candidate.executedAt)}</dd>
                  </div>
                  <div>
                    <dt>候選門檻</dt>
                    <dd className="num">{boundaryText(candidate)}</dd>
                  </div>
                  <div>
                    <dt>目前規則變更</dt>
                    <dd className="num">{overwriteText(profile, candidate)}</dd>
                  </div>
                  <div>
                    <dt>證據等級</dt>
                    <dd>
                      <span className={`badge badge--${EVIDENCE_TONE[candidate.evidence]}`}>
                        {EVIDENCE_LABEL[candidate.evidence]}
                      </span>
                    </dd>
                  </div>
                </dl>
                <p className="apply__reason">{candidate.reason}</p>

                {weak ? (
                  <label className="apply__ack">
                    <input
                      type="checkbox"
                      aria-label={`我仍要套用 ${label}`}
                      checked={acknowledgedIds.has(candidate.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setAcknowledgedIds((current) => {
                          const updated = new Set(current);
                          if (checked) updated.add(candidate.id);
                          else updated.delete(candidate.id);
                          return updated;
                        });
                      }}
                    />
                    我仍要套用「{label}」。Profile 上會永久標記「證據不足仍套用」。
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>

        <h4 className="apply__section micro">套用後庫存的變化</h4>
        <ProfileChangePreview analyses={analyses} current={profile} next={next} />

        <p className="apply__note">
          只會寫入上方選定的候選規則；不會改動交易紀錄、研究樣本或歷史快照，也不代表未來報酬。
        </p>

        <div className="apply__actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={blocked}
            onClick={() => onConfirm(next)}
          >
            套用
          </button>
        </div>
      </div>
    </div>
  );
}
