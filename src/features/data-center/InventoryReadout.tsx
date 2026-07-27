import type { Inventory } from '../../storage/inventory';
import './InventoryReadout.css';

function Gauge({
  label,
  value,
  unit,
  detail,
  ready,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  ready: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={ready ? 'gauge' : 'gauge gauge--pending'}>
      <p className="gauge__label micro">{label}</p>
      <p className="gauge__value">
        <span className="num">{value}</span>
        {unit ? <span className="gauge__unit">{unit}</span> : null}
      </p>
      {children}
      <p className="gauge__detail">{detail}</p>
    </div>
  );
}

/**
 * 交易資料的日期跨度以一條實際的覆蓋條表示，
 * 讓「有多少資料」與「涵蓋多長時間」在同一個讀數上被看見。
 */
function CoverageBar({ firstDate, lastDate }: { firstDate: string; lastDate: string }) {
  const start = new Date(firstDate).getTime();
  const end = new Date(lastDate).getTime();
  const months = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44)));

  return (
    <div className="coverage" aria-hidden="true">
      <div className="coverage__track">
        <div className="coverage__fill" />
      </div>
      <span className="coverage__span num">{months} 個月</span>
    </div>
  );
}

export function InventoryReadout({ inventory }: { inventory: Inventory | null }) {
  const transactions = inventory?.transactions;
  const holdings = inventory?.holdings;
  const cache = inventory?.marketCache;

  const hasTransactions = (transactions?.count ?? 0) > 0;
  const hasHoldings = (holdings?.count ?? 0) > 0;
  const hasCache = (cache?.count ?? 0) > 0;

  return (
    <section className="readout" aria-label="本機存量">
      <Gauge
        label="交易紀錄"
        value={hasTransactions ? String(transactions?.count) : '—'}
        unit={hasTransactions ? '筆' : undefined}
        ready={hasTransactions}
        detail={
          hasTransactions && transactions?.firstDate && transactions.lastDate
            ? `${transactions.firstDate} → ${transactions.lastDate}`
            : '未匯入'
        }
      >
        {hasTransactions && transactions?.firstDate && transactions.lastDate ? (
          <CoverageBar firstDate={transactions.firstDate} lastDate={transactions.lastDate} />
        ) : null}
      </Gauge>

      <Gauge
        label="庫存快照"
        value={hasHoldings ? String(holdings?.count) : '—'}
        unit={hasHoldings ? '檔' : undefined}
        ready={hasHoldings}
        detail={hasHoldings ? `快照日 ${holdings?.snapshotDate}` : '未匯入'}
      />

      <Gauge
        label="市場快取"
        value={hasCache ? String(cache?.count) : '—'}
        unit={hasCache ? '筆' : undefined}
        ready={hasCache}
        detail={hasCache ? `最後取得 ${cache?.lastRetrievedAt?.slice(0, 10)}` : '尚未同步'}
      />
    </section>
  );
}
