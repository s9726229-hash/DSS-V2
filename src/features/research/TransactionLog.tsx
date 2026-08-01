import { useMemo, useState } from 'react';
import {
  summarizeTransactionLog,
  type ExclusionReason,
  type TransactionLogKind,
  type TransactionLogRow,
} from '../../research/transactionLog';

const KIND_LABEL: Record<TransactionLogKind, string> = {
  entry: '建立部位',
  reentry: '再進場',
  'add-on': '加碼',
  exit: '賣出',
  'day-trade': '現沖',
};

/**
 * 只有建立部位與再進場需要顏色：前者是本輪唯一的研究對象，
 * 後者是剛被排除、最需要被看見的一類。其餘維持中性，避免整張表都在閃。
 */
const KIND_TONE: Record<TransactionLogKind, string> = {
  entry: 'tag tag--entry',
  reentry: 'tag tag--reentry',
  'add-on': 'tag',
  exit: 'tag',
  'day-trade': 'tag',
};

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  reentry: '再進場不列入本輪',
  'add-on': '加碼不列入本輪',
  exit: '賣出不是進場樣本',
  'day-trade': '現沖不構成部位',
  'before-research-window': '不在研究期間',
};

function quantity(value: number): string {
  return value.toLocaleString('en-US');
}

function price(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 研究欄。分類欄已經說了是加碼還是現沖，這裡不重複同一句話：
 * 只有「研究期間外」是分類看不出來的，才寫成文字，其餘留破折號並附說明。
 */
function ResearchCell({ row }: { row: TransactionLogRow }) {
  if (row.includedInResearch) {
    return <span className="log__included">列入</span>;
  }

  if (row.exclusionReason === 'before-research-window') {
    return <span className="log__excluded">研究期間外</span>;
  }

  return (
    <span
      className="log__excluded"
      title={row.exclusionReason === null ? undefined : EXCLUSION_LABEL[row.exclusionReason]}
    >
      —
    </span>
  );
}

export function TransactionLog({ rows }: { rows: TransactionLogRow[] }) {
  const [onlySamples, setOnlySamples] = useState(false);
  const summary = useMemo(() => summarizeTransactionLog(rows), [rows]);
  const visible = useMemo(
    () => (onlySamples ? rows.filter((row) => row.includedInResearch) : rows),
    [rows, onlySamples],
  );

  if (rows.length === 0) {
    return (
      <p className="research__empty">
        尚未匯入任何交易明細。請先到<strong>資料中心</strong>匯入。
      </p>
    );
  }

  return (
    <div className="log">
      <p className="log__lede">
        匯入的每一筆交易，以及它在本輪研究裡的身分。
        建立部位是唯一被拿去推導門檻的一類，其餘只保留紀錄。
      </p>

      <div className="log__bar">
        <span className="log__tally num">
          共 {summary.total} 筆．建立部位 {summary.byKind.entry}（列入本輪 {summary.included}）．
          再進場 {summary.byKind.reentry}．加碼 {summary.byKind['add-on']}．
          賣出 {summary.byKind.exit}．現沖 {summary.byKind['day-trade']}
        </span>

        <label className="log__filter">
          <input
            type="checkbox"
            checked={onlySamples}
            onChange={(event) => setOnlySamples(event.target.checked)}
          />
          只看研究樣本
        </label>
      </div>

      <div className="log__scroll">
        <table className="checkpoints log__table">
          <thead>
            <tr>
              <th>日期</th>
              <th className="log__col-name">股票</th>
              <th>買賣</th>
              <th>類別</th>
              <th>股數</th>
              <th>價格</th>
              <th className="log__col-kind">分類</th>
              <th>當下持股</th>
              <th>研究</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.transactionId}>
                <td className="num">{row.tradeDate}</td>
                <td className="log__col-name">
                  <span className="num log__id">{row.stockId}</span> {row.stockName}
                </td>
                <td className={row.side === 'buy' ? 'log__buy' : 'log__sell'}>
                  {row.side === 'buy' ? '買' : '賣'}
                </td>
                <td>{row.tradeType}</td>
                <td className="num">{quantity(row.quantity)}</td>
                <td className="num">{price(row.price)}</td>
                <td className="log__col-kind">
                  <span className={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</span>
                </td>
                <td className="num">{quantity(row.positionAfter)}</td>
                <td>
                  <ResearchCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {onlySamples && visible.length === 0 ? (
        <p className="research__empty">研究期間內沒有列入本輪的建立部位。</p>
      ) : null}
    </div>
  );
}
