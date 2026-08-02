import { fetchDataset } from '../market/finmindClient';
import type { AdjustmentEventRow, FinMindDataset, InstitutionalRow, PriceRow } from '../market/types';
import { writeCachedDataset } from '../storage/marketCache';
import type { PositionEvent } from './positions';

const DAY_MS = 24 * 60 * 60 * 1000;

/** MA60 需要建立部位前 60 個交易日，約 90 個日曆日；取 120 日留餘裕。 */
const PRICE_LOOKBACK_DAYS = 120;

/** ETF 驗證窗為建立部位後 60 個交易日，約 90 個日曆日；取 100 日留餘裕。 */
const PRICE_LOOKAHEAD_DAYS = 100;

/** Worker 對價格與法人資料的日期區間上限。 */
const PRICE_MAX_RANGE_DAYS = 400;
const CHIP_MAX_RANGE_DAYS = 45;

/**
 * 流向要拿進場日與前 5 個交易日比，共需 6 個交易日。
 * 取 21 個日曆日：14 天碰到連假會縮到只剩五、六個交易日，那些樣本就算不出流向。
 */
const CHIP_LOOKBACK_DAYS = 21;

export type BackfillRequest = {
  dataset: FinMindDataset;
  stockId: string;
  startDate: string;
  endDate: string;
};

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function shift(date: string, days: number): number {
  return Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
}

/**
 * 規劃回補請求。
 *
 * 價格每檔一段連續區間；法人依建立部位日期切成不超過 45 天的區段，
 * 相近的建立部位共用同一段，避免對沒有交易的期間發出無用請求。
 */
export function planBackfill(entries: readonly PositionEvent[], now: Date): BackfillRequest[] {
  const byStock = new Map<string, string[]>();

  for (const entry of entries) {
    const dates = byStock.get(entry.stockId) ?? [];
    dates.push(entry.tradeDate);
    byStock.set(entry.stockId, dates);
  }

  const today = Date.parse(`${isoDate(now.getTime())}T00:00:00Z`);
  const requests: BackfillRequest[] = [];

  for (const [stockId, unsorted] of byStock) {
    const dates = [...unsorted].sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];

    // 價格：一段涵蓋全部建立部位的連續區間，並受 Worker 上限限制
    const priceEnd = Math.min(today, shift(latest, PRICE_LOOKAHEAD_DAYS));
    const priceStart = Math.max(
      shift(earliest, -PRICE_LOOKBACK_DAYS),
      priceEnd - PRICE_MAX_RANGE_DAYS * DAY_MS,
    );

    requests.push({
      dataset: 'TaiwanStockPrice',
      stockId,
      startDate: isoDate(priceStart),
      endDate: isoDate(priceEnd),
    });

    // 還原事件：與價格同區間，用於標示未還原造成的失真
    for (const dataset of ['TaiwanStockDividendResult', 'TaiwanStockSplitPrice'] as const) {
      requests.push({
        dataset,
        stockId,
        startDate: isoDate(priceStart),
        endDate: isoDate(priceEnd),
      });
    }

    /*
     * 法人與融資：以建立部位日期為中心切段，相近者合併。
     * 兩者的期間需求一樣（進場日與前 5 個交易日），所以共用同一組區段；
     * 但它們是兩個資料集，每一段都要各發一次請求。
     */
    for (const chunk of chunkChipRanges(dates, today)) {
      requests.push({ dataset: 'TaiwanStockInstitutionalInvestorsBuySell', stockId, ...chunk });
      requests.push({ dataset: 'TaiwanStockMarginPurchaseShortSale', stockId, ...chunk });
    }
  }

  return requests;
}

function chunkChipRanges(
  sortedDates: readonly string[],
  today: number,
): { startDate: string; endDate: string }[] {
  const chunks: { startDate: string; endDate: string }[] = [];
  let start: number | null = null;
  let end = 0;

  for (const date of sortedDates) {
    const from = shift(date, -CHIP_LOOKBACK_DAYS);
    const to = Math.min(today, shift(date, 1));

    if (start === null) {
      start = from;
      end = to;
      continue;
    }

    // 併入現有區段，前提是併入後仍不超過 Worker 上限
    if (to - start <= CHIP_MAX_RANGE_DAYS * DAY_MS) {
      end = Math.max(end, to);
      continue;
    }

    chunks.push({ startDate: isoDate(start), endDate: isoDate(end) });
    start = from;
    end = to;
  }

  if (start !== null) {
    chunks.push({ startDate: isoDate(start), endDate: isoDate(end) });
  }

  return chunks;
}

export type BackfillFailure = {
  stockId: string;
  dataset: string;
  message: string;
};

export type BackfillSummary = {
  completed: number;
  total: number;
  failures: BackfillFailure[];
};

export type BackfillOptions = {
  now?: Date;
  onProgress?: (completed: number, total: number) => void;
};

/**
 * 執行回補。逐筆依序請求，避免一次打出大量請求觸發上游限流；
 * 單一請求失敗不中斷其他請求。
 */
export async function backfillResearchData(
  entries: readonly PositionEvent[],
  { now = new Date(), onProgress }: BackfillOptions = {},
): Promise<BackfillSummary> {
  const requests = planBackfill(entries, now);
  const retrievedAt = now.toISOString();
  const failures: BackfillFailure[] = [];
  let completed = 0;

  for (const request of requests) {
    const result = await fetchDataset<PriceRow | InstitutionalRow | AdjustmentEventRow>(
      request.dataset,
      request.stockId,
      { startDate: request.startDate, endDate: request.endDate },
    );

    if (result.ok) {
      await writeCachedDataset({
        dataset: request.dataset,
        stockId: request.stockId,
        rows: result.rows,
        tradeDate: null,
        retrievedAt,
      });
    } else {
      failures.push({
        stockId: request.stockId,
        dataset: request.dataset,
        message: result.message,
      });
    }

    completed += 1;
    onProgress?.(completed, requests.length);
  }

  return { completed, total: requests.length, failures };
}
