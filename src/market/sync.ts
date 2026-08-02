import { readCachedDataset, writeCachedDataset } from '../storage/marketCache';
import { readHoldingsSnapshot } from '../storage/portfolio';
import { needsNameLookup, resolveWatchName } from '../watchlist/watchlist';
import { readWatchlist, writeWatchlist } from '../watchlist/watchlistStore';
import { fetchDataset, type DateRange } from './finmindClient';
import type { AdjustmentEventRow, InstitutionalRow, PriceRow, StockInfoRow } from './types';

/** 價格取近一年，足以計算 MA60 並保留餘裕。 */
const PRICE_LOOKBACK_DAYS = 365;

/** 法人只需最近 5 個交易日，取 20 個日曆日以涵蓋連假。 */
const INSTITUTIONAL_LOOKBACK_DAYS = 20;

/** 還原事件需涵蓋整段價格歷史，才能判斷均線窗口內是否有跳空。 */
const ADJUSTMENT_LOOKBACK_DAYS = 400;

const ADJUSTMENT_DATASETS = ['TaiwanStockDividendResult', 'TaiwanStockSplitPrice'] as const;

/** 基本資料與日期無關，但閘道一律要求區間，因此給最小的一天。 */
const STOCK_INFO_LOOKBACK_DAYS = 1;

/** 與 Worker 端快取 TTL 相同：這段時間內重抓只會拿到相同內容。 */
export const FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeEnding(end: Date, lookbackDays: number): DateRange {
  return {
    startDate: isoDate(new Date(end.getTime() - lookbackDays * DAY_MS)),
    endDate: isoDate(end),
  };
}

/** 取資料中最後一個交易日，供畫面標示資料新鮮度。 */
function latestDate(rows: readonly { date: string }[]): string | null {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.date > latest ? row.date : latest), rows[0].date);
}

export type StockSyncResult =
  | {
      stockId: string;
      stockName: string;
      ok: true;
      /** 因快取仍新鮮而未重新請求。 */
      skipped: boolean;
      priceDate: string | null;
      institutionalDate: string | null;
    }
  | { stockId: string; stockName: string; ok: false; message: string };

export type SyncSummary = {
  syncedAt: string;
  results: StockSyncResult[];
  /** 因快取新鮮而跳過的檔數。 */
  skippedCount: number;
  /** 未執行同步的原因；正常執行時為 null。 */
  skippedReason: 'nothing-to-sync' | null;
  /** 這次同步替觀察標的補回名稱的檔數。 */
  namedCount: number;
};

export type SyncOptions = {
  now?: Date;
  /** 忽略新鮮度，強制重新抓取。 */
  force?: boolean;
  onProgress?: (stockId: string) => void;
};

/**
 * 快取是否仍新鮮。窗口對齊 Worker 端的快取 TTL：
 * 在這段時間內重抓只會拿到相同的快取內容，純粹浪費請求。
 */
async function isFresh(stockId: string, now: Date): Promise<StockSyncResult | null> {
  const cached = await readCachedDataset('TaiwanStockPrice', stockId);

  if (!cached || now.getTime() - Date.parse(cached.retrievedAt) >= FRESHNESS_WINDOW_MS) {
    return null;
  }

  const institutional = await readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId);

  // 上次只成功一半時不算新鮮，仍需重抓
  if (!institutional) {
    return null;
  }

  return {
    stockId,
    stockName: '',
    ok: true,
    skipped: true,
    priceDate: cached.tradeDate || null,
    institutionalDate: institutional.tradeDate || null,
  };
}

async function syncStock(
  stockId: string,
  stockName: string,
  now: Date,
): Promise<StockSyncResult> {
  const retrievedAt = now.toISOString();

  const price = await fetchDataset<PriceRow>(
    'TaiwanStockPrice',
    stockId,
    rangeEnding(now, PRICE_LOOKBACK_DAYS),
  );

  if (!price.ok) {
    return { stockId, stockName, ok: false, message: `價格資料取得失敗：${price.message}` };
  }

  const priceDate = latestDate(price.rows);
  await writeCachedDataset({
    dataset: 'TaiwanStockPrice',
    stockId,
    rows: price.rows,
    tradeDate: priceDate,
    retrievedAt,
  });

  const institutional = await fetchDataset<InstitutionalRow>(
    'TaiwanStockInstitutionalInvestorsBuySell',
    stockId,
    rangeEnding(now, INSTITUTIONAL_LOOKBACK_DAYS),
  );

  // 價格已寫入快取，法人失敗不必回收；僅回報哪一段沒取到
  if (!institutional.ok) {
    return {
      stockId,
      stockName,
      ok: false,
      message: `法人資料取得失敗：${institutional.message}`,
    };
  }

  const institutionalDate = latestDate(institutional.rows);
  await writeCachedDataset({
    dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
    stockId,
    rows: institutional.rows,
    tradeDate: institutionalDate,
    retrievedAt,
  });

  await cacheAdjustmentEvents(stockId, now, retrievedAt);

  return { stockId, stockName, ok: true, skipped: false, priceDate, institutionalDate };
}

/**
 * 目前使用未還原價，但仍取回除權息與分割事件，用來標示哪些個股的
 * 均線會因帳面跳空而失真。日後改用還原價時，這些資料已在快取中，
 * 不需重新呼叫 API。取不到時不視為同步失敗——它只影響提示，不影響主要資料。
 */
async function cacheAdjustmentEvents(stockId: string, now: Date, retrievedAt: string): Promise<void> {
  const range = rangeEnding(now, ADJUSTMENT_LOOKBACK_DAYS);

  for (const dataset of ADJUSTMENT_DATASETS) {
    const result = await fetchDataset<AdjustmentEventRow>(dataset, stockId, range);

    if (result.ok) {
      await writeCachedDataset({
        dataset,
        stockId,
        rows: result.rows,
        tradeDate: latestDate(result.rows),
        retrievedAt,
      });
    }
  }
}

/**
 * 補回觀察標的的名稱。
 *
 * 價格資料只有 stock_id，中文名稱只能向 TaiwanStockInfo 問，因此這是額外的請求：
 * 只問「名稱還是代號」的那幾檔，已經有名稱的一次都不會再問。
 *
 * 回傳補到名稱的檔數。
 */
async function resolveWatchNames(now: Date): Promise<number> {
  const pending = (await readWatchlist()).entries.filter(needsNameLookup);
  if (pending.length === 0) return 0;

  const range = rangeEnding(now, STOCK_INFO_LOOKBACK_DAYS);
  const answers = new Map<string, string | null>();

  for (const entry of pending) {
    const result = await fetchDataset<StockInfoRow>('TaiwanStockInfo', entry.stockId, range);

    // 取不到就什麼都不做，下次同步再試；只有真的問到回應才判定查無此代號
    if (!result.ok) continue;

    const name = result.rows.find((row) => row.stock_id === entry.stockId)?.stock_name?.trim();
    answers.set(entry.stockId, name === undefined || name === '' ? null : name);
  }

  if (answers.size === 0) return 0;

  // 重新讀一次再寫：同步期間使用者可能改過題材，拿舊清單覆寫會把那些變更吃掉
  const latest = await readWatchlist();
  let next = latest;
  for (const [stockId, name] of answers) next = resolveWatchName(next, stockId, name);

  if (next !== latest) await writeWatchlist(next);

  return [...answers.values()].filter((name) => name !== null).length;
}

/**
 * 同步最新一份庫存快照與觀察清單中的個股。
 *
 * 規格原本寫的是「沒有庫存時不可發出任何市場資料網路請求」，那時還沒有觀察清單。
 * 觀察股同樣需要價格與法人資料，否則它們的卡片永遠是資料不足；
 * 該條規則真正要守的是「沒有任何要看的標的就不要連網」，因此改以兩者的聯集為準。
 *
 * 單一股票失敗不得阻擋其他股票。
 */
export async function syncHoldings({
  now = new Date(),
  force = false,
  onProgress,
}: SyncOptions = {}): Promise<SyncSummary> {
  const [holdings, watchlist] = await Promise.all([readHoldingsSnapshot(), readWatchlist()]);

  /*
   * 庫存與觀察清單的聯集，先庫存後觀察。
   * 兩邊都可能列到同一檔，重複的只留第一次——重抓一次不會壞，
   * 但會白白吃掉 FinMind 每小時的額度。
   */
  const unique = new Map<string, string>();
  for (const holding of holdings) {
    if (!unique.has(holding.stockId)) {
      unique.set(holding.stockId, holding.stockName);
    }
  }
  for (const entry of watchlist.entries) {
    if (!unique.has(entry.stockId)) {
      unique.set(entry.stockId, entry.stockName);
    }
  }

  if (unique.size === 0) {
    return {
      syncedAt: now.toISOString(),
      results: [],
      skippedCount: 0,
      skippedReason: 'nothing-to-sync',
      namedCount: 0,
    };
  }

  const results: StockSyncResult[] = [];

  // 逐檔依序處理，避免一次打出大量請求觸發上游限流
  for (const [stockId, stockName] of unique) {
    const fresh = force ? null : await isFresh(stockId, now);

    results.push(fresh ? { ...fresh, stockName } : await syncStock(stockId, stockName, now));
    onProgress?.(stockId);
  }

  return {
    syncedAt: now.toISOString(),
    results,
    skippedCount: results.filter((result) => result.ok && result.skipped).length,
    skippedReason: null,
    namedCount: await resolveWatchNames(now),
  };
}
