import { useMemo } from 'react';
import type { StockAnalysis } from '../../dss/analyseHoldings';
import { previewProfileChange } from '../../profile/preview';
import type { Profile } from '../../profile/profile';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_UNIT } from '../../research/runResearch';
import { percent } from '../research/format';

/**
 * 規格：Profile 儲存前必須預覽哪些庫存標的的狀態會變。
 *
 * 套用候選與手動調整都走這裡，兩條路徑各寫一份的話，
 * 其中一條遲早會漏掉某種變更而讓使用者以為沒事。
 */
export function ProfileChangePreview({
  analyses,
  current,
  next,
}: {
  /** 尚未載入完成時為 null。 */
  analyses: StockAnalysis[] | null;
  current: Profile;
  next: Profile;
}) {
  const changes = useMemo(
    () => (analyses === null ? [] : previewProfileChange({ analyses, current, next })),
    [analyses, current, next],
  );

  if (analyses === null) {
    return <p className="apply__empty">正在讀取庫存資料…</p>;
  }

  if (analyses.length === 0) {
    return <p className="apply__empty">目前沒有庫存可以比對。</p>;
  }

  if (changes.length === 0) {
    return <p className="apply__empty">目前庫存沒有任何標的的區間歸屬會因此改變。</p>;
  }

  return (
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
  );
}
