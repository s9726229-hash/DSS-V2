import { useCallback, useEffect, useState } from 'react';
import { AnalysisPage } from '../features/analysis/AnalysisPage';
import { DataCenterPage } from '../features/data-center/DataCenterPage';
import { GuidePage } from '../features/guide/GuidePage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { TodayPage } from '../features/today/TodayPage';
import { ResearchPage } from '../features/research/ResearchPage';
import { syncHoldings } from '../market/sync';
import { fetchFinMindUsage, type UsageResult } from '../market/usageClient';
import { readInventory, type Inventory } from '../storage/inventory';
import { watchedStockIds } from '../watchlist/watchlist';
import { readWatchlist } from '../watchlist/watchlistStore';
import { readHoldingsSnapshot } from '../storage/portfolio';
import './AppShell.css';

const PAGES = [
  { id: 'today', label: '今日總覽' },
  { id: 'analysis', label: '完整分析' },
  { id: 'guide', label: '判讀說明' },
  { id: 'research', label: '歷史研究' },
  { id: 'profile', label: '目前規則' },
  { id: 'data', label: '資料中心' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

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

/** 用量接近上限時轉為待注意色，讓人在還來得及的時候看到。 */
const USAGE_ATTENTION_RATIO = 0.8;

function UsageReading({ usage }: { usage: UsageController }) {
  const { state, refresh } = usage;

  const { value, attention } =
    state === 'idle'
      ? { value: '點此查詢', attention: false }
      : state === 'loading'
        ? { value: '查詢中…', attention: false }
        : state.ok
          ? {
              value: `${state.used}/${state.limit}`,
              attention: state.used >= state.limit * USAGE_ATTENTION_RATIO,
            }
          : { value: '查詢失敗', attention: true };

  return (
    <button
      type="button"
      className="reading statusbar__usage"
      onClick={refresh}
      disabled={state === 'loading'}
      title="FinMind 每小時的請求次數。查詢用量本身不會動到你的資料，但點一次就是一次請求。"
    >
      <span className="reading__label">FinMind 用量</span>
      <span className={attention ? 'reading__value reading__value--pending' : 'reading__value num'}>
        {value}
      </span>
    </button>
  );
}

function StatusBar({
  inventory,
  sync,
  usage,
  watchCount,
}: {
  inventory: Inventory | null;
  sync: SyncController;
  usage: UsageController;
  /** 觀察標的數；只有庫存與觀察都空的時候才不能同步。 */
  watchCount: number;
}) {
  const marketDate = inventory?.marketCache.lastRetrievedAt?.slice(0, 10) ?? null;
  const tradeDate = inventory?.transactions.lastDate ?? null;
  const syncable = (inventory?.holdings.count ?? 0) > 0 || watchCount > 0;

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
      <UsageReading usage={usage} />
      {sync.message ? <span className="statusbar__message">{sync.message}</span> : null}
      {sync.allSkipped && !sync.running ? (
        <button className="statusbar__force" type="button" onClick={() => sync.start(true)}>
          強制重新抓取
        </button>
      ) : null}
      <button
        className="statusbar__sync"
        type="button"
        disabled={sync.running || !syncable}
        title={syncable ? undefined : '沒有庫存也沒有觀察標的時不會發出網路請求'}
        onClick={() => sync.start()}
      >
        {sync.running ? `同步中… ${sync.done}/${sync.total}` : '同步市場資料'}
      </button>
    </div>
  );
}

type UsageState = 'idle' | 'loading' | UsageResult;

type UsageController = {
  state: UsageState;
  refresh: () => void;
};

/**
 * FinMind 用量。
 *
 * 刻意不在開啟頁面時自動查詢：這支查詢本身算不算進每小時 600 次額度
 * 並未見於文件，因此只在同步完成後與使用者主動點擊時才發出。
 */
function useUsage(): UsageController {
  const [state, setState] = useState<UsageState>('idle');

  const refresh = useCallback(() => {
    setState('loading');
    void fetchFinMindUsage().then(setState);
  }, []);

  return { state, refresh };
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
        // 進度分母要涵蓋觀察股，否則同步觀察標的時進度會超過 100%
        const [holdings, watchlist] = await Promise.all([
          readHoldingsSnapshot(),
          readWatchlist(),
        ]);
        setTotal(new Set([...holdings.map((h) => h.stockId), ...watchedStockIds(watchlist)]).size);

        const summary = await syncHoldings({
          force,
          onProgress: () => setDone((count) => count + 1),
        });

        if (summary.skippedReason === 'nothing-to-sync') {
          setMessage('沒有庫存也沒有觀察標的，未發出任何請求');
        } else {
          const failed = summary.results.filter((result) => !result.ok).length;
          const updated = summary.results.length - failed - summary.skippedCount;
          const parts = [
            updated > 0 ? `${updated} 檔已更新` : null,
            summary.skippedCount > 0 ? `${summary.skippedCount} 檔已是最新` : null,
            failed > 0 ? `${failed} 檔失敗` : null,
            summary.namedCount > 0 ? `${summary.namedCount} 檔補上名稱` : null,
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
  const [watchCount, setWatchCount] = useState(0);

  const usage = useUsage();

  const refreshInventory = useCallback(() => {
    void readInventory().then(setInventory);
    void readWatchlist().then((list) => setWatchCount(watchedStockIds(list).length));
  }, []);

  useEffect(refreshInventory, [refreshInventory]);

  /**
   * 同步完成後遞增，讓今日 DSS 重算。
   *
   * 少了這條線，狀態列會寫著「N 檔已更新」，卡片卻仍停在同步前的資料不足，
   * 看起來就像同步沒有拿到任何東西。
   */
  const [dataVersion, setDataVersion] = useState(0);

  /** 同步剛用掉一批額度，這時候的用量數字才有意義。 */
  const onSyncFinished = useCallback(() => {
    refreshInventory();
    usage.refresh();
    setDataVersion((version) => version + 1);
  }, [refreshInventory, usage]);

  const sync = useSync(onSyncFinished);

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
        <StatusBar inventory={inventory} sync={sync} usage={usage} watchCount={watchCount} />
        <main className="content">
          {page === 'data' ? (
            <DataCenterPage inventory={inventory} onDataChanged={refreshInventory} />
          ) : page === 'analysis' ? (
            <AnalysisPage />
          ) : page === 'guide' ? (
            <GuidePage />
          ) : page === 'research' ? (
            <ResearchPage />
          ) : page === 'profile' ? (
            <ProfilePage />
          ) : page === 'today' ? (
            <TodayPage dataVersion={dataVersion} onWatchlistChanged={refreshInventory} />
          ) : null}
        </main>
      </div>
    </div>
  );
}
