import { useEffect, useMemo, useState } from 'react';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT } from '../../research/runResearch';
import { profileKey, type ProfileKey } from '../../profile/profile';
import type { ResearchCandidate, ResearchCandidateSource } from '../../profile/researchCandidates';
import { ASSET_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from '../research/evidence';

function rangeText(candidate: ResearchCandidate): string {
  const { min, max } = candidate.range;
  const unit = METRIC_UNIT[candidate.metric];
  const value = (boundary: number | null) =>
    boundary === null ? '—' : `${boundary.toFixed(2)}${unit}`;

  if (min === null) return `≤ ${value(max)}`;
  if (max === null) return `≥ ${value(min)}`;
  return `${value(min)} ～ ${value(max)}`;
}

function runDate(executedAt: string): string {
  return new Date(executedAt).toISOString().slice(0, 10);
}

export function ResearchCandidatePicker({
  sources,
  onReview,
}: {
  sources: readonly ResearchCandidateSource[];
  onReview: (candidates: ResearchCandidate[]) => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedByKey, setSelectedByKey] = useState<Partial<Record<ProfileKey, string>>>({});

  useEffect(() => {
    setSelectedRunId((current) =>
      current !== null && sources.some((source) => source.runId === current)
        ? current
        : (sources[0]?.runId ?? null),
    );
  }, [sources]);

  const selectedSource =
    sources.find((source) => source.runId === selectedRunId) ?? sources[0] ?? null;

  const selectedCandidates = useMemo(
    () =>
      selectedSource === null
        ? []
        : selectedSource.candidates.filter(
            (candidate) =>
              selectedByKey[profileKey(candidate.assetClass, candidate.metric)] === candidate.id,
          ),
    [selectedByKey, selectedSource],
  );

  function selectCandidate(candidate: ResearchCandidate) {
    const key = profileKey(candidate.assetClass, candidate.metric);
    setSelectedByKey((current) => {
      if (current[key] === candidate.id) {
        const { [key]: _removed, ...remaining } = current;
        return remaining;
      }

      return { ...current, [key]: candidate.id };
    });
  }

  return (
    <section className="profile__section research-picker" aria-labelledby="research-picker-title">
      <h2 id="research-picker-title" className="profile__section-title">從研究加入</h2>
      <p className="profile__note">
        選擇一筆已儲存的研究，再挑每個資產類別與指標的一個候選區間。尚未套用到目前規則。
      </p>

      <label className="research-picker__source">
        <span>研究來源</span>
        <select
          aria-label="研究來源"
          value={selectedRunId ?? selectedSource?.runId ?? ''}
          disabled={sources.length === 0}
          onChange={(event) => {
            setSelectedRunId(event.target.value || null);
            setSelectedByKey({});
          }}
        >
          {sources.length === 0 ? <option value="">尚無研究紀錄</option> : null}
          {sources.map((source) => (
            <option key={source.runId} value={source.runId}>
              {runDate(source.executedAt)}　建立部位 {source.entryCount} 筆／完整 {source.completeCount} 筆
            </option>
          ))}
        </select>
      </label>

      {selectedSource === null ? null : (
        <p className="research-picker__date">
          研究日期：<strong>{runDate(selectedSource.executedAt)}</strong>
        </p>
      )}

      {selectedSource === null ? (
        <p className="research__empty-line">尚無可選的研究紀錄。請先到歷史研究完成一次搜尋。</p>
      ) : (
        <>
          {selectedSource.missingMetrics.length > 0 ? (
            <p className="research-picker__unavailable" role="note">
              此舊版研究紀錄缺少：{selectedSource.missingMetrics.map((metric) => METRIC_LABEL[metric]).join('、')}；
              這些指標無法選擇。
            </p>
          ) : null}

          {selectedSource.candidates.length === 0 ? (
            <p className="research__empty-line">這筆研究沒有可寫入目前規則的候選區間。</p>
          ) : (
            <table className="checkpoints research-picker__table">
              <thead>
                <tr>
                  <th>選擇</th>
                  <th>資產類別</th>
                  <th>指標</th>
                  <th>區間</th>
                  <th>門檻</th>
                  <th>證據</th>
                </tr>
              </thead>
              <tbody>
                {selectedSource.candidates.map((candidate) => {
                  const key = profileKey(candidate.assetClass, candidate.metric);
                  const label = `${ASSET_LABEL[candidate.assetClass]} ${METRIC_LABEL[candidate.metric]} ${bandLabel(candidate.metric, candidate.band)}`;
                  return (
                    <tr key={candidate.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={label}
                          checked={selectedByKey[key] === candidate.id}
                          onChange={() => selectCandidate(candidate)}
                        />
                      </td>
                      <td>{ASSET_LABEL[candidate.assetClass]}</td>
                      <td>{METRIC_LABEL[candidate.metric]}</td>
                      <td>{bandLabel(candidate.metric, candidate.band)}</td>
                      <td className="num">{rangeText(candidate)}</td>
                      <td>
                        <span className={`badge badge--${EVIDENCE_TONE[candidate.evidence]}`}>
                          {EVIDENCE_LABEL[candidate.evidence]}
                        </span>
                        <span className="research-picker__reason">{candidate.reason}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      <div className="research-picker__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={selectedCandidates.length === 0}
          onClick={() => onReview(selectedCandidates)}
        >
          套用已選規則
        </button>
      </div>
    </section>
  );
}
