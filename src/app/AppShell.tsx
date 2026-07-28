import { useCallback, useEffect, useState } from 'react';
import { AnalysisPage } from '../features/analysis/AnalysisPage';
import { DataCenterPage } from '../features/data-center/DataCenterPage';
import { GuidePage } from '../features/guide/GuidePage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { syncHoldings } from '../market/sync';
import { readInventory, type Inventory } from '../storage/inventory';
import { readHoldingsSnapshot } from '../storage/portfolio';
import './AppShell.css';

const PAGES = [
  { id: 'today', label: '今日 DSS' },
  { id: 'analysis', label: '技術分析' },
  { id: 'guide', label: '判讀說明' },
  { id: 'research', label: '歷史交易研究' },
  { id: 'profile', label: 'Profile' },
  { id: 'data', label: '資料中心' },
  { id: 'settings', label: '設定' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

const PLACEHOLDER_COPY: Record<Exclude<PageId, 'data' | 'analysis' | 'guide'>, string> = {
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
      {sync.allSkipped && !sync.running ? (
        <button className="statusbar__force" type="button" onClick={() => sync.start(true)}>
          強制重新抓取
        </button>
      ) : null}
      <button
        className="statusbar__sync"
        type="button"
        disabled={sync.running || !hasHoldings}
        title={hasHoldings ? undefined : '沒有庫存時不會發出網路請求'}
        onClick={() => sync.start()}
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
  /** 全部個股都因快取新鮮而跳過時，提供強制重新抓取的入口。 */
  allSkipped: boolean;
  start: (force?: boolean) => void;
};

/** 同步狀態與進度。沒有庫存時 syncHoldings 不會發出任何請求。 */
function useSync(onFinished: () => void): SyncController {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [allSkipped, setAllSkipped] = useState(false);

  const start = useCallback(
    (force = false) => {
      setRunning(true);
      setDone(0);
      setMessage(null);
      setAllSkipped(false);

      void (async () => {
        const holdings = await readHoldingsSnapshot();
        setTotal(holdings.length);

        const summary = await syncHoldings({
          force,
          onProgress: () => setDone((count) => count + 1),
        });

        if (summary.skippedReason === 'no-holdings') {
          setMessage('沒有庫存，未發出任何請求');
        } else {
          const failed = summary.results.filter((result) => !result.ok).length;
          const updated = summary.results.length - failed - summary.skippedCount;
          const parts = [
            updated > 0 ? `${updated} 檔已更新` : null,
            summary.skippedCount > 0 ? `${summary.skippedCount} 檔已是最新` : null,
            failed > 0 ? `${failed} 檔失敗` : null,
          ].filter(Boolean);

          setMessage(parts.join('．'));
          setAllSkipped(summary.skippedCount === summary.results.length && failed === 0);
        }

        setRunning(false);
        onFinished();
      })();
    },
    [onFinished],
  );

  return { running, done, total, message, allSkipped, start };
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
          ) : page === 'guide' ? (
            <GuidePage />
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
