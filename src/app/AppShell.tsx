import { useCallback, useEffect, useState } from 'react';
import { AnalysisPage } from '../features/analysis/AnalysisPage';
import { DataCenterPage } from '../features/data-center/DataCenterPage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { syncHoldings } from '../market/sync';
import { readInventory, type Inventory } from '../storage/inventory';
import { readHoldingsSnapshot } from '../storage/portfolio';
import './AppShell.css';

const PAGES = [
  { id: 'today', label: '今日 DSS' },
  { id: 'analysis', label: '技術分析' },
  { id: 'research', label: '歷史交易研究' },
  { id: 'profile', label: 'Profile' },
  { id: 'data', label: '資料中心' },
  { id: 'settings', label: '設定' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

const PLACEHOLDER_COPY: Record<Exclude<PageId, 'data' | 'analysis'>, string> = {
  today: '同步市場資料後，這裡會列出庫存與觀察清單的技術與籌碼狀態。',
  research: '匯入交易明細後，這裡會分析建立部位的條件與後續表現。',
  profile: '完成歷史研究後，這裡會列出候選參數與判定條件。',
  settings: '偏好設定。所有設定只存在這台電腦。',
};

function StatusReading({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="reading">
      <span className="reading__label">{label}</span>
      <span className={ready ? 'reading__value num' : 'reading__value reading__value--pending'}>
        {value}
      </span>
    </div>
  );
}

function StatusBar({
  inventory,
  sync,
}: {
  inventory: Inventory | null;
  sync: SyncController;
}) {
  const marketDate = inventory?.marketCache.lastRetrievedAt?.slice(0, 10) ?? null;
  const tradeDate = inventory?.transactions.lastDate ?? null;
  const hasHoldings = (inventory?.holdings.count ?? 0) > 0;

  return (
    <div className="statusbar" role="status">
      <StatusReading
        label="市場資料"
        value={marketDate ?? '未就緒'}
        ready={marketDate !== null}
      />
      <StatusReading label="盤中價格" value="未啟用" ready={false} />
      <StatusReading
        label="交易資料至"
        value={tradeDate ?? '未匯入'}
        ready={tradeDate !== null}
      />
      {sync.message ? <span className="statusbar__message">{sync.message}</span> : null}
      <button
        className="statusbar__sync"
        type="button"
        disabled={sync.running || !hasHoldings}
        title={hasHoldings ? undefined : '沒有庫存時不會發出網路請求'}
        onClick={sync.start}
      >
        {sync.running ? `同步中… ${sync.done}/${sync.total}` : '同步市場資料'}
      </button>
    </div>
  );
}

type SyncController = {
  running: boolean;
  done: number;
  total: number;
  message: string | null;
  start: () => void;
};

/** 同步狀態與進度。沒有庫存時 syncHoldings 不會發出任何請求。 */
function useSync(onFinished: () => void): SyncController {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const start = useCallback(() => {
    setRunning(true);
    setDone(0);
    setMessage(null);

    void (async () => {
      const holdings = await readHoldingsSnapshot();
      setTotal(holdings.length);

      const summary = await syncHoldings({ onProgress: () => setDone((count) => count + 1) });

      if (summary.skippedReason === 'no-holdings') {
        setMessage('沒有庫存，未發出任何請求');
      } else {
        const failed = summary.results.filter((result) => !result.ok).length;
        setMessage(
          failed === 0
            ? `${summary.results.length} 檔已更新`
            : `${summary.results.length - failed} 檔已更新．${failed} 檔失敗`,
        );
      }

      setRunning(false);
      onFinished();
    })();
  }, [onFinished]);

  return { running, done, total, message, start };
}

export function AppShell() {
  const [page, setPage] = useState<PageId>('today');
  const [inventory, setInventory] = useState<Inventory | null>(null);

  const refreshInventory = useCallback(() => {
    void readInventory().then(setInventory);
  }, []);

  useEffect(refreshInventory, [refreshInventory]);

  const sync = useSync(refreshInventory);

  return (
    <div className="shell">
      <nav className="nav" aria-label="主要導覽">
        <div className="nav__mark">
          <span className="nav__mark-name">DSS</span>
          <span className="nav__mark-version">V2</span>
        </div>

        <ul className="nav__list">
          {PAGES.map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                className={id === page ? 'nav__item nav__item--active' : 'nav__item'}
                aria-current={id === page ? 'page' : undefined}
                onClick={() => setPage(id)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>

        <p className="nav__footnote">
          資料只存在這台電腦。
          <br />
          本工具提供研究資料，不提供買賣建議。
        </p>
      </nav>

      <div className="frame">
        <StatusBar inventory={inventory} sync={sync} />
        <main className="content">
          {page === 'data' ? (
            <DataCenterPage inventory={inventory} onDataChanged={refreshInventory} />
          ) : page === 'analysis' ? (
            <AnalysisPage />
          ) : (
            <PlaceholderPage
              title={PAGES.find((entry) => entry.id === page)?.label ?? ''}
              description={PLACEHOLDER_COPY[page]}
            />
          )}
        </main>
      </div>
    </div>
  );
}
