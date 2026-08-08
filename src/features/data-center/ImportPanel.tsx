import { useId, useState } from 'react';
import { decodeBrokerCsv } from '../../import/decode';
import { parseHoldingsCsv } from '../../import/holdingsCsv';
import { parseTransactionCsv } from '../../import/transactionCsv';
import type { ImportedHolding, ImportedTransaction, SkippedRow } from '../../import/types';
import {
  importHoldingsSnapshot,
  importTransactions,
  planTransactionImport,
} from '../../storage/portfolio';
import './ImportPanel.css';

export type ImportKind = 'transactions' | 'holdings';

type Rejected = { stage: 'rejected'; fileName: string; error: string };

type Ready = {
  stage: 'ready';
  fileName: string;
  rowCount: number;
  skipped: SkippedRow[];
  newCount: number;
  enrichedCount: number;
  duplicateCount: number;
  transactions?: ImportedTransaction[];
  holdings?: ImportedHolding[];
};

type Done = {
  stage: 'done';
  fileName: string;
  inserted: number;
  enriched: number;
  duplicateCount: number;
};

type PanelState = { stage: 'idle' } | Rejected | Ready | Done;

const COPY: Record<ImportKind, { title: string; description: string; unit: string; pick: string }> =
  {
    transactions: {
      title: '匯入交易明細',
      description: '券商匯出的成交明細。重匯相同檔案時，既有交易不會重複新增，並可補齊舊紀錄缺少的交易種類。',
      unit: '筆',
      pick: '選擇交易明細檔案',
    },
    holdings: {
      title: '匯入庫存',
      description: '券商匯出的庫存報表。寫入今天的快照，同一天再次匯入會整份取代。',
      unit: '檔',
      pick: '選擇庫存檔案',
    },
  };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Stage({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'attention' | 'plain';
}) {
  return (
    <div className="stage">
      <span className="stage__label micro">{label}</span>
      <span className={`stage__value stage__value--${tone}`}>{value}</span>
    </div>
  );
}

export function ImportPanel({
  kind,
  onDataChanged,
}: {
  kind: ImportKind;
  onDataChanged: () => void;
}) {
  const [state, setState] = useState<PanelState>({ stage: 'idle' });
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const copy = COPY[kind];

  async function handleFile(file: File | undefined) {
    if (!file) return;

    const csv = decodeBrokerCsv(await file.arrayBuffer());

    if (kind === 'transactions') {
      const parsed = parseTransactionCsv(csv);

      if (!parsed.ok) {
        setState({ stage: 'rejected', fileName: file.name, error: parsed.error });
        return;
      }

      const plan = await planTransactionImport(parsed.rows);
      setState({
        stage: 'ready',
        fileName: file.name,
        rowCount: parsed.rows.length,
        skipped: parsed.skipped,
        newCount: plan.newCount,
        enrichedCount: plan.enrichedCount,
        duplicateCount: plan.duplicateCount,
        transactions: parsed.rows,
      });
      return;
    }

    const parsed = parseHoldingsCsv(csv);

    if (!parsed.ok) {
      setState({ stage: 'rejected', fileName: file.name, error: parsed.error });
      return;
    }

    setState({
      stage: 'ready',
      fileName: file.name,
      rowCount: parsed.rows.length,
      skipped: parsed.skipped,
      newCount: parsed.rows.length,
      enrichedCount: 0,
      duplicateCount: 0,
      holdings: parsed.rows,
    });
  }

  async function handleConfirm() {
    if (state.stage !== 'ready') return;

    setBusy(true);
    const importedAt = new Date().toISOString();

    try {
      if (state.transactions) {
        const result = await importTransactions(state.transactions, importedAt);
        setState({
          stage: 'done',
          fileName: state.fileName,
          inserted: result.inserted,
          enriched: result.enriched,
          duplicateCount: result.duplicateCount,
        });
      } else if (state.holdings) {
        await importHoldingsSnapshot(state.holdings, today(), importedAt);
        setState({
          stage: 'done',
          fileName: state.fileName,
          inserted: state.holdings.length,
          enriched: 0,
          duplicateCount: 0,
        });
      }
      onDataChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="import" aria-label={copy.title}>
      <header className="import__head">
        <h3 className="import__title">{copy.title}</h3>
        <p className="import__description">{copy.description}</p>
      </header>

      <label className="import__pick" htmlFor={inputId}>
        選擇檔案
        <input
          id={inputId}
          aria-label={copy.pick}
          type="file"
          accept=".csv,.CSV"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>

      {state.stage === 'rejected' ? (
        <div className="import__result import__result--rejected">
          <p className="import__file num">{state.fileName}</p>
          <p className="import__error">{state.error}</p>
          <p className="import__hint">請確認匯出的是券商的完整報表，欄位標題未被修改。</p>
        </div>
      ) : null}

      {state.stage === 'ready' ? (
        <div className="import__result">
          <p className="import__file num">{state.fileName}</p>

          <div className="import__stages">
            <Stage label="欄位檢查" value="欄位齊備" tone="ok" />
            <Stage
              label="解析"
              value={
                state.skipped.length === 0
                  ? `可匯入 ${state.rowCount} ${copy.unit}`
                  : `可匯入 ${state.rowCount} ${copy.unit}．略過 ${state.skipped.length} 筆`
              }
              tone={state.skipped.length === 0 ? 'plain' : 'attention'}
            />
            <Stage
              label="比對"
              value={
                kind === 'transactions'
                  ? `新增 ${state.newCount} 筆．補齊 ${state.enrichedCount} 筆交易方式．已存在 ${state.duplicateCount} 筆`
                  : `快照日期 ${today()}`
              }
              tone="plain"
            />
          </div>

          {state.skipped.length > 0 ? (
            <ul className="import__skipped">
              {state.skipped.slice(0, 5).map((row) => (
                <li key={row.line}>
                  <span className="num">第 {row.line} 行</span>
                  <span>{row.reason}</span>
                </li>
              ))}
              {state.skipped.length > 5 ? (
                <li className="import__skipped-more">其餘 {state.skipped.length - 5} 筆同樣列出於匯入後</li>
              ) : null}
            </ul>
          ) : null}

          <div className="import__actions">
            <button type="button" className="btn" onClick={() => setState({ stage: 'idle' })}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || state.newCount + state.enrichedCount === 0}
              onClick={() => void handleConfirm()}
            >
              {state.newCount > 0
                ? `確認匯入 ${state.newCount} ${copy.unit}`
                : `確認補齊 ${state.enrichedCount} 筆`}
            </button>
          </div>
        </div>
      ) : null}

      {state.stage === 'done' ? (
        <div className="import__result import__result--done">
          <p className="import__file num">{state.fileName}</p>
          <p className="import__done">
            已寫入 {state.inserted} {copy.unit}
            {state.enriched > 0 ? `．已補齊 ${state.enriched} 筆交易方式` : ''}
            {state.duplicateCount > 0 ? `．略過 ${state.duplicateCount} 筆（已存在）` : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}
