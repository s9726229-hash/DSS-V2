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

    if (rows.length === 0) {
      const existing = await db.get('marketCache', id);

      if (existing && Array.isArray(existing.payload) && existing.payload.length > 0) {
        return;
      }
    }

    await db.put('marketCache', {
      id,
      dataset,
      stockId,
      tradeDate: tradeDate ?? '',
      retrievedAt,
      payload: rows,
    } satisfies MarketCacheRecord);
  } finally {
    db.close();
  }
}
