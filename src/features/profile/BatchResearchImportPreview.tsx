import { useState } from 'react';
import type {
  BatchCandidateChange,
  BatchResearchImport,
  BatchScenarioImport,
} from '../../profile/batchResearchCandidates';
import type { ProfileEntry } from '../../profile/profile';
import {
  METRIC_LABEL,
  METRIC_UNIT,
  type ResearchScenario,
} from '../../research/runResearch';
import { ASSET_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE } from '../research/evidence';

const SCENARIOS: ResearchScenario[] = ['establish', 'add-on', 'reentry'];
const SCENARIO_LABEL: Record<ResearchScenario, string> = {
  establish: '建立部位',
  'add-on': '加碼',
  reentry: '再進場',
};

function entryText(entry: ProfileEntry, unit: string): string {
  if (entry.lower === null && entry.upper === null) return '未設定';
  const lower = entry.lower === null ? '未設定' : entry.lower.value.toFixed(2);
  const upper = entry.upper === null ? '未設定' : entry.upper.value.toFixed(2);
  return `${lower} ～ ${upper}${unit}`;
}

function ChangeRow({ change }: { change: BatchCandidateChange }) {
  const unit = METRIC_UNIT[change.metric];

  return (
    <li className={change.replacesManual ? 'batch-import__change batch-import__change--manual' : 'batch-import__change'}>
      <div className="batch-import__change-head">
        <strong>{ASSET_LABEL[change.assetClass]}／{METRIC_LABEL[change.metric]}</strong>
        <span className={`badge badge--${EVIDENCE_TONE[change.band.evidence]}`}>
          {EVIDENCE_LABEL[change.band.evidence]}
        </span>
        {change.replacesManual ? <span className="batch-import__manual">覆蓋手動規則</span> : null}
      </div>
      <div className="batch-import__values">
        <span>原值：<span className="num">{entryText(change.previous, unit)}</span></span>
        <span>新值：<span className="num">{entryText(change.next, unit)}</span></span>
      </div>
      <p className="batch-import__reason">{change.band.reason}</p>
    </li>
  );
}

function ScenarioSection({ group }: { group: BatchScenarioImport }) {
  const added = group.changes.filter((change) => change.kind === 'added').length;
  const overwritten = group.changes.length - added;

  return (
    <section className="batch-import__scenario" aria-labelledby={`batch-${group.scenario}`}>
      <div className="batch-import__scenario-head">
        <h4 id={`batch-${group.scenario}`}>{SCENARIO_LABEL[group.scenario]}</h4>
        {group.run === null ? (
          <span className="batch-import__run batch-import__run--missing">沒有研究紀錄</span>
        ) : (
          <span className="batch-import__run">
            {group.run.executedAt.slice(0, 10)}．{group.run.eventCount ?? group.run.entryCount} 筆事件．
            {group.run.completeCount} 筆完整樣本
          </span>
        )}
      </div>

      <div className="batch-import__counts" aria-label={`${SCENARIO_LABEL[group.scenario]} 變更摘要`}>
        <span>新增 {added}</span>
        <span>覆蓋 {overwritten}</span>
        <span>保留 {group.preserved.length}</span>
      </div>

      {group.changes.length === 0 ? (
        <p className="batch-import__empty">這個情境沒有可帶入的新候選。</p>
      ) : (
        <ul className="batch-import__changes">
          {group.changes.map((change) => (
            <ChangeRow
              key={`${change.scenario}:${change.assetClass}:${change.metric}`}
              change={change}
            />
          ))}
        </ul>
      )}

      {group.preserved.length > 0 ? (
        <details className="batch-import__preserved">
          <summary>無新候選，保留 {group.preserved.length} 組現有規則</summary>
          <ul>
            {group.preserved.map((item) => (
              <li key={`${item.scenario}:${item.assetClass}:${item.metric}`}>
                {ASSET_LABEL[item.assetClass]}／{METRIC_LABEL[item.metric]}：
                <span className="num">{entryText(item.previous, METRIC_UNIT[item.metric])}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function BatchResearchImportPreview({
  batch,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  batch: BatchResearchImport;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = saving || (batch.hasWeakEvidence && !acknowledged);

  return (
    <div className="apply" role="dialog" aria-modal="true" aria-label="批次帶入研究參數">
      <div className="apply__panel batch-import__panel">
        <h3 className="apply__title">從最新研究一次帶入</h3>
        <p className="batch-import__intro">
          共有 {batch.changes.length} 組參數可套用。有新候選時會覆蓋現值；沒有新候選的格子會保留。
        </p>

        <div className="batch-import__scenarios">
          {SCENARIOS.map((scenario) => (
            <ScenarioSection key={scenario} group={batch.scenarios[scenario]} />
          ))}
        </div>

        {batch.hasWeakEvidence ? (
          <label className="apply__ack">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={saving}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            我知道這批參數包含未通過驗證的候選，仍要整批套用。
          </label>
        ) : null}

        {error === null ? null : <p className="batch-import__error" role="alert">{error}</p>}

        <p className="apply__note">
          這次只會更新已儲存的 Profile，不會重跑研究、同步市場資料或改動交易紀錄。
        </p>

        <div className="apply__actions">
          <button type="button" className="btn" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn--primary" disabled={blocked} onClick={onConfirm}>
            {saving ? '套用中…' : '整批套用'}
          </button>
        </div>
      </div>
    </div>
  );
}
