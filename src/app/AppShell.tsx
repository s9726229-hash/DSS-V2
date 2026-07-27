import { useCallback, useEffect, useState } from 'react';
import { AnalysisPage } from '../features/analysis/AnalysisPage';
import { DataCenterPage } from '../features/data-center/DataCenterPage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { readInventory, type Inventory } from '../storage/inventory';
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

function StatusBar({ inventory }: { inventory: Inventory | null }) {
  const priceReady = inventory !== null && inventory.marketCache.count > 0;
  const tradeDate = inventory?.transactions.lastDate ?? null;

  return (
    <div className="statusbar" role="status">
      <StatusReading
        label="價格資料"
        value={priceReady ? '已同步' : '未就緒'}
        ready={priceReady}
      />
      <StatusReading
        label="法人資料"
        value={priceReady ? '已同步' : '未就緒'}
        ready={priceReady}
      />
      <StatusReading label="盤中價格" value="未啟用" ready={false} />
      <StatusReading
        label="交易資料至"
        value={tradeDate ?? '未匯入'}
        ready={tradeDate !== null}
      />
      <button className="statusbar__sync" type="button" disabled>
        同步市場資料
      </button>
    </div>
  );
}

export function AppShell() {
  const [page, setPage] = useState<PageId>('today');
  const [inventory, setInventory] = useState<Inventory | null>(null);

  const refreshInventory = useCallback(() => {
    void readInventory().then(setInventory);
  }, []);

  useEffect(refreshInventory, [refreshInventory]);

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
        <StatusBar inventory={inventory} />
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
