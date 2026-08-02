import { adjustPrices } from '../dss/adjustment';
import type { AdjustmentEventRow, InstitutionalRow, PriceRow } from '../market/types';
import { readCachedDataset } from '../storage/marketCache';
import { readTransactions } from '../storage/portfolio';
import { computeEntryOutcome } from './outcome';
import { identifyPositionEvents, selectEntries, type PositionEvent } from './positions';
import { buildEntrySnapshot, classifyAsset, type AssetClass } from './snapshot';
import { runWalkForward, type MetricSample, type WalkForwardResult } from './walkForward';

/** 規格 v1 的三個研究分頁。 */
export type ResearchMetric = 'bias20' | 'foreignStrength' | 'trustStrength';

export const RESEARCH_METRICS: ResearchMetric[] = ['bias20', 'foreignStrength', 'trustStrength'];

export const METRIC_LABEL: Record<ResearchMetric, string> = {
  bias20: '20MA 乖離率',
  foreignStrength: '外資及陸資強度',
  trustStrength: '投信強度',
};

/**
 * 強度的單位其實就是「天」：5 日淨額（股）÷ 5 日平均量（股／日）＝ 日。
 * 以前印成沒有單位的小數，看起來像個抽象分數，這裡把單位補回去。
 */
export const METRIC_UNIT: Record<ResearchMetric, string> = {
  bias20: '%',
  foreignStrength: ' 天量',
  trustStrength: ' 天量',
};

/**
 * 規格：2025 年資料只作歷史交易查閱，不納入 v1 候選或樣本外驗證。
 */
export const RESEARCH_FROM_DATE = '2026-01-01';

export type ResearchSample = MetricSample & {
  stockId: string;
  stockName: string;
};

export type ResearchReport = {
  /** 研究期間內的建立部位總數。 */
  entryCount: number;
  /** 研究期間內已保留紀錄、但依規格不列入本輪的再進場筆數。 */
  reentryCount: number;
  /** 其中技術面可分析的筆數。 */
  technicalCount: number;
  /** 其中籌碼面可分析的筆數。 */
  chipCount: number;
  /** 觀察窗已完整的筆數。 */
  completeCount: number;
  /** 尚未回補價格資料的股票代號。 */
  missingStocks: string[];
  samples: Record<ResearchMetric, ResearchSample[]>;
  results: Record<ResearchMetric, Record<AssetClass, WalkForwardResult>>;
};

async function loadStockData(stockId: string) {
  const [price, chip, dividend, split] = await Promise.all([
    readCachedDataset('TaiwanStockPrice', stockId),
    readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
    readCachedDataset('TaiwanStockDividendResult', stockId),
    readCachedDataset('TaiwanStockSplitPrice', stockId),
  ]);

  return {
    rawPrices: (price?.payload ?? []) as PriceRow[],
    institutional: (chip?.payload ?? []) as InstitutionalRow[],
    dividends: (dividend?.payload ?? []) as AdjustmentEventRow[],
    splits: (split?.payload ?? []) as AdjustmentEventRow[],
  };
}

/** 取出研究期間內的建立部位（不含再進場）。 */
export async function loadResearchEntries(from = RESEARCH_FROM_DATE): Promise<PositionEvent[]> {
  const transactions = await readTransactions();
  return selectEntries(identifyPositionEvents(transactions)).filter(
    (entry) => entry.tradeDate >= from,
  );
}

/**
 * 研究期間內被排除的再進場筆數。
 *
 * 規格要求再進場「保留紀錄，但不混入第一輪提取」，
 * 所以樣本數的落差要能在頁面上交代，不能靜靜消失。
 */
export async function countResearchReentries(from = RESEARCH_FROM_DATE): Promise<number> {
  const transactions = await readTransactions();
  return selectEntries(identifyPositionEvents(transactions), { includeReentries: true }).filter(
    (entry) => entry.isReentry && entry.tradeDate >= from,
  ).length;
}

/**
 * 執行研究。
 *
 * 只讀本機快取，不發出網路請求：資料回補是獨立的動作，
 * 這樣開啟研究頁時能立即看到既有結果，而不是每次都等待數十秒。
 */
export async function runResearch(from = RESEARCH_FROM_DATE): Promise<ResearchReport> {
  const entries = await loadResearchEntries(from);
  const reentryCount = await countResearchReentries(from);

  const samples: Record<ResearchMetric, ResearchSample[]> = {
    bias20: [],
    foreignStrength: [],
    trustStrength: [],
  };

  const previous = new Map<string, string>();
  const missingStocks = new Set<string>();
  let technicalCount = 0;
  let chipCount = 0;
  let completeCount = 0;

  for (const entry of entries) {
    const { rawPrices, institutional, dividends, splits } = await loadStockData(entry.stockId);

    if (rawPrices.length === 0) {
      missingStocks.add(entry.stockId);
    }

    const snapshot = buildEntrySnapshot({
      entry,
      prices: rawPrices,
      institutional,
      dividends,
      splits,
    });

    const outcome = computeEntryOutcome({
      entryDate: entry.tradeDate,
      assetClass: snapshot.assetClass,
      prices: adjustPrices({ prices: rawPrices, dividends, splits }).prices,
      previousEntryDate: previous.get(entry.stockId) ?? null,
    });
    previous.set(entry.stockId, entry.tradeDate);

    if (snapshot.technical.ok) technicalCount += 1;
    if (snapshot.chip.ok) chipCount += 1;
    if (outcome.validation.complete) completeCount += 1;

    const base = {
      entryDate: entry.tradeDate,
      stockId: entry.stockId,
      stockName: entry.stockName,
      assetClass: classifyAsset(entry.stockId),
      returnPercent: outcome.validation.returnPercent,
      complete: outcome.validation.complete,
      overlapsPrevious: outcome.validation.overlapsPrevious,
    };

    samples.bias20.push({
      ...base,
      metricValue: snapshot.technical.ok ? snapshot.technical.snapshot.bias20 : null,
    });
    samples.foreignStrength.push({
      ...base,
      metricValue: snapshot.chip.ok ? snapshot.chip.snapshot.foreign.strength : null,
    });
    samples.trustStrength.push({
      ...base,
      metricValue: snapshot.chip.ok ? snapshot.chip.snapshot.trust.strength : null,
    });
  }

  const results = Object.fromEntries(
    RESEARCH_METRICS.map((metric) => [
      metric,
      {
        stock: runWalkForward({ samples: samples[metric], assetClass: 'stock', metric }),
        etf: runWalkForward({ samples: samples[metric], assetClass: 'etf', metric }),
      },
    ]),
  ) as ResearchReport['results'];

  return {
    entryCount: entries.length,
    reentryCount,
    technicalCount,
    chipCount,
    completeCount,
    missingStocks: [...missingStocks],
    samples,
    results,
  };
}
