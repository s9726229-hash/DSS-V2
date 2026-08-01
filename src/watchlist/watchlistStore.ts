import { openDssDatabase } from '../storage/database';
import { emptyWatchlist, type Watchlist } from './watchlist';

/**
 * 與 Profile 相同，存在既有的 settings 資料表。
 * 不必把資料庫版本往上升，也自動落在備份範圍內。
 */
export const WATCHLIST_SETTING_KEY = 'watchlist';

function isWatchlist(value: unknown): value is Watchlist {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Watchlist>;

  return (
    candidate.version === 1 && Array.isArray(candidate.topics) && Array.isArray(candidate.entries)
  );
}

export async function readWatchlist(): Promise<Watchlist> {
  const db = await openDssDatabase();

  try {
    const stored = await db.get('settings', WATCHLIST_SETTING_KEY);

    // 毀損或版本不符時回空清單，不讓壞資料變成看似真實的觀察標的
    return isWatchlist(stored?.value) ? stored.value : emptyWatchlist();
  } finally {
    db.close();
  }
}

export async function writeWatchlist(list: Watchlist): Promise<void> {
  const db = await openDssDatabase();

  try {
    await db.put('settings', { key: WATCHLIST_SETTING_KEY, value: list });
  } finally {
    db.close();
  }
}
