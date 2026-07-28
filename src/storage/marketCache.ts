import { openDssDatabase } from './database';
import type { MarketCacheRecord } from './types';

/**
 * 市場快取保存的是 FinMind 的原始回應，不是計算後的結果。
 * 這樣日後調整技術指標或還原邏輯時，不必重新呼叫 API。
 */
export type CacheWrite = {
  dataset: string;
  stockId: string;
  rows: unknown[];
  /** 該資料集最新的交易日；沒有資料時為 null。 */
  tradeDate: string | null;
  retrievedAt: string;
};

function cacheId(dataset: string, stockId: string): string {
  return `${dataset}:${stockId}`;
}

export async function readCachedDataset(
  dataset: string,
  stockId: string,
): Promise<MarketCacheRecord | null> {
  const db = await openDssDatabase();

  try {
    return (await db.get('marketCache', cacheId(dataset, stockId))) ?? null;
  } finally {
    db.close();
  }
}

type DatedRow = { date?: unknown; name?: unknown };

/**
 * 合併鍵。價格類每日一列，法人類同一天會有多列（外資、投信、自營商），
 * 因此需連同身分一起作為鍵，否則同日的法人列會互相覆蓋。
 */
function rowKey(row: unknown): string {
  const { date, name } = (row ?? {}) as DatedRow;
  return `${String(date ?? '')}|${String(name ?? '')}`;
}

function dateOf(row: unknown): string {
  return String(((row ?? {}) as DatedRow).date ?? '');
}

/**
 * 合併新舊資料列。
 *
 * 日常同步取近一年、歷史研究取更早的區間，兩者寫入同一筆快取；
 * 若採取代式寫入，後到的請求會把另一段期間的資料洗掉。
 * 同一鍵以較新的請求為準，讓上游的資料更正得以生效。
 */
function mergeRows(existing: unknown[], incoming: readonly unknown[]): unknown[] {
  const merged = new Map<string, unknown>();

  for (const row of existing) {
    merged.set(rowKey(row), row);
  }
  for (const row of incoming) {
    merged.set(rowKey(row), row);
  }

  return [...merged.values()].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
}

/**
 * 寫入快取。
 *
 * 空回應不覆寫既有的有效快取：FinMind 偶爾會回傳空陣列（例如尚未更新），
 * 若直接覆蓋會把已取得的資料弄丟，畫面會誤判為「無資料」。
 */
export async function writeCachedDataset({
  dataset,
  stockId,
  rows,
  tradeDate,
  retrievedAt,
}: CacheWrite): Promise<void> {
  const db = await openDssDatabase();

  try {
    const id = cacheId(dataset, stockId);
    const existing = await db.get('marketCache', id);
    const existingRows = Array.isArray(existing?.payload) ? (existing.payload as unknown[]) : [];

    if (rows.length === 0 && existingRows.length > 0) {
      return;
    }

    const payload = mergeRows(existingRows, rows);
    const latestDate = payload.reduce<string>((latest, row) => {
      const date = dateOf(row);
      return date > latest ? date : latest;
    }, '');

    await db.put('marketCache', {
      id,
      dataset,
      stockId,
      tradeDate: latestDate || (tradeDate ?? ''),
      retrievedAt,
      payload,
    } satisfies MarketCacheRecord);
  } finally {
    db.close();
  }
}
