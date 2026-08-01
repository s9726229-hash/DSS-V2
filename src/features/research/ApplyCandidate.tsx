import { useMemo, useState } from 'react';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT, type ResearchMetric } from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import type { BandResult } from '../../research/walkForward';
import type { StockAnalysis } from '../../dss/analyseHoldings';
import { applyCandidate, type Profile } from '../../profile/profile';
import { previewProfileChange } from '../../profile/preview';
import { ASSET_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from './evidence';
import { percent } from './format';

export type PendingCandidate = {
  metric: ResearchMetric;
  assetClass: AssetClass;
  band: BandResult;
  runId: string | null;
};

function boundaryText(candidate: PendingCandidate): string {
  const unit = METRIC_UNIT[candidate.metric];
  const { min, max } = candidate.band.range;

  if (candidate.band.band === 'pullback') return `下界 ${percent(max, unit)}`;
  if (candidate.band.band === 'overheated') return `上界 ${percent(min, unit)}`;
  return `下界 ${percent(min, unit)}．上界 ${percent(max, unit)}`;
}

export function ApplyCandidate({
  candidate,
  profile,
  analyses,
  onCancel,
  onConfirm,
}: {
  candidate: PendingCandidate;
  profile: Profile;
  /** 目前庫存的計算結果；尚未載入時為 null。 */
  analyses: StockAnalysis[] | null;
  onCancel: () => void;
  onConfirm: (next: Profile) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  const weakEvidence = candidate.band.evidence !== 'worth-tracking';

  const next = useMemo(
    () =>
      applyCandidate(profile, {
        assetClass: candidate.assetClass,
        metric: candidate.metric,
        band: candidate.band.band,
        range: candidate.band.range,
        runId: candidate.runId,
        evidence: candidate.band.evidence,
        despiteWeakEvidence: weakEvidence,
        at: new Date().toISOString(),
      }),
    [profile, candidate, weakEvidence],
  );

  const changes = useMemo(
    () => (analyses === null ? [] : previewProfileChange({ analyses, current: profile, next })),
    [analyses, profile, next],
  );

  const blocked = weakEvidence && !acknowledged;

  return (
    <div className="apply" role="dialog" aria-modal="true" aria-label="套用候選門檻">
      <div className="apply__panel">
        <h3 className="apply__title">
          套用「{bandLabel(candidate.metric, candidate.band.band)}」到{' '}
          {ASSET_LABEL[candidate.assetClass]} Profile
        </h3>

        <dl className="apply__facts">
          <div>
            <dt>指標</dt>
            <dd>{METRIC_LABEL[candidate.metric]}</dd>
          </div>
          <div>
            <dt>寫入</dt>
            <dd className="num">{boundaryText(candidate)}</dd>
          </div>
          <div>
            <dt>證據等級</dt>
            <dd>
              <span className={`badge badge--${EVIDENCE_TONE[candidate.band.evidence]}`}>
                {EVIDENCE_LABEL[candidate.band.evidence]}
              </span>
            </dd>
          </div>
        </dl>

        <p className="apply__reason">{candidate.band.reason}</p>

        <h4 className="apply__section micro">套用後庫存的變化</h4>
        {analyses === null ? (
          <p className="apply__empty">正在讀取庫存資料…</p>
        ) : changes.length === 0 ? (
          <p className="apply__empty">
            目前庫存沒有任何標的的區間歸屬會因此改變。
          </p>
        ) : (
          <ul className="apply__changes">
            {changes.map((row) => (
              <li key={`${row.stockId}-${row.metric}`}>
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
          </ul>
        )}

        {weakEvidence ? (
          <label className="apply__ack">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            這個區間沒有通過驗證，我仍要套用。Profile 上會永久標記「證據不足仍套用」。
          </label>
        ) : null}

        <p className="apply__note">
          Profile 只影響目前庫存與觀察清單的判讀，不會改動交易紀錄、研究樣本或歷史快照，
          也不代表未來報酬。隨時可以改回來。
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
