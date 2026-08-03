import type { Inventory } from '../../storage/inventory';
import { BackupPanel } from './BackupPanel';
import { ImportPanel } from './ImportPanel';
import { InventoryReadout } from './InventoryReadout';
import './DataCenterPage.css';

export function DataCenterPage({
  inventory,
  onDataChanged,
}: {
  inventory: Inventory | null;
  onDataChanged: () => void;
}) {
  return (
    <div className="datacenter">
      <header className="datacenter__head">
        <h1 className="datacenter__title">資料中心</h1>
        <p className="datacenter__lede">
          匯入、同步與備份你的本機資料。所有資料只存在這台電腦，不會上傳。
        </p>
      </header>

      <InventoryReadout inventory={inventory} />

      <section className="datacenter__section">
        <h2 className="datacenter__section-title">匯入</h2>
        <div className="datacenter__imports">
          <ImportPanel kind="transactions" onDataChanged={onDataChanged} />
          <ImportPanel kind="holdings" onDataChanged={onDataChanged} />
        </div>
      </section>

      <section className="datacenter__section">
        <BackupPanel onDataChanged={onDataChanged} />
      </section>
    </div>
  );
}
