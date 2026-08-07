import { adjustPrices } from '../dss/adjustment';
import { computeFlow, flowAxis } from '../dss/flow';
import { MARGIN_FLOW_THRESHOLDS } from '../dss/margin';
import type {
  AdjustmentEventRow,
  InstitutionalRow,
  MarginRow,
  PriceRow,
} from '../market/types';
import { readCachedDataset } from '../storage/marketCache';
import { readTransactions } from '../storage/portfolio';
import { computeEntryOutcome } from './outcome';
import { loadResearchLedger } from './loadLedger';
import { selectLedgerEvents, type LedgerEvent, type LedgerIssueCode } from './positionLedger';
import {
  identifyPositionEvents,
  selectEntries,
  type PositionEvent,
  type ResearchEventKind,
} from './positions';
import { buildEntrySnapshot, classifyAsset, type AssetClass } from './snapshot';
import { runWalkForward, type MetricSample, type WalkForwardResult } from './walkForward';

/** 規格 v1 的三個研究分頁。 */
export type ResearchMetric = 'bias20' | 'foreignFlow' | 'trustFlow' | 'marginFlow';

/** V2 以實際決策情境切開研究樣本。 */
export type ResearchScenario = ResearchEventKind;

/** 加碼才有相對既有成本可研究；其他情境不可誤用這個欄位。 */
export type ScenarioResearchMetric = ResearchMetric | 'relativeCost';

const BASE_METRICS = [
  'bias20',
  'foreignFlow',
  'trustFlow',
  'marginFlow',
] as const;

export function researchMetricsFor(scenario: ResearchScenario): ScenarioResearchMetric[] {
  return scenario === 'add-on' ? [...BASE_METRICS, 'relativeCost'] : [...BASE_METRICS];
}

export const RESEARCH_METRICS: ResearchMetric[] = [...BASE_METRICS];

export const METRIC_LABEL: Record<ScenarioResearchMetric, string> = {
  bias20: '20MA 乖離率',
  foreignFlow: '外資流向',
  trustFlow: '投信流向',
  marginFlow: '融資流向',
  relativeCost: '相對均價',
};

/**
 * 流向是「今日淨額 ÷ 前五日平均絕對值」，所以單位是倍：
 * −1.43 倍代表今天在賣，量是近期平均的 1.43 倍。
 */
export const METRIC_UNIT: Record<ScenarioResearchMetric, string> = {
  bias20: '%',
  foreignFlow: ' 倍',
  trustFlow: ' 倍',
  marginFlow: ' 倍',
  relativeCost: '%',
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
  /** 本次只使用這個決策情境的事件。 */
  scenario: ResearchScenario;
  /** 研究期間內這個情境的事件數。 */
  eventCount: number;
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
  ledgerQuality: {
    excludedByCode: Record<LedgerIssueCode, number>;
    stockStatus: Record<string, string>;
  };
  samples: Record<ResearchMetric, ResearchSample[]> & Partial<Record<'relativeCost', ResearchSample[]>>;
  results: Record<ResearchMetric, Record<AssetClass, WalkForwardResult>> &
    Partial<Record<'relativeCost', Record<AssetClass, WalkForwardResult>>>;
};

async function loadStockData(stockId: string) {
  const [price, chip, dividend, split, margin] = await Promise.all([
    readCachedDataset('TaiwanStockPrice', stockId),
    readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
    readCachedDataset('TaiwanStockDividendResult', stockId),
    readCachedDataset('TaiwanStockSplitPrice', stockId),
    readCachedDataset('TaiwanStockMarginPurchaseShortSale', stockId),
  ]);

  return {
    rawPrices: (price?.payload ?? []) as PriceRow[],
    institutional: (chip?.payload ?? []) as InstitutionalRow[],
    margin: (margin?.payload ?? []) as MarginRow[],
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
 * V2 依決策情境取樣；建立部位、加碼、再進場絕不共用同一批研究事件。
 *
 * 市場資料回補與後續報酬計算都必須使用這個已合併的事件清單，避免同日拆單
 * 被當作多個樣本。
 */
export async function loadResearchEvents(
  scenario: ResearchScenario,
  from = RESEARCH_FROM_DATE,
): Promise<LedgerEvent[]> {
  const ledger = await loadResearchLedger();
  return selectLedgerEvents(ledger, scenario).filter(
    (event) => event.tradeDate >= from,
  );
}

/**
 * 研究期間內被排除的再進場筆數。
 *
 * 規格要求再進場「保留紀錄，但不混入第一輪提取」，
 * 所以樣本數的落差要能在頁面上交代，不能靜靜消失。
 */
export async function countResearchReentries(from = RESEARCH_FROM_DATE): Promise<number> {
  const ledger = await loadResearchLedger();
  return ledger.events.filter(
    (event) => event.scenario === 'reentry' && event.tradeDate >= from,
  ).length;
}

function asLegacySnapshotEvent(event: LedgerEvent): PositionEvent {
  return {
    transactionId: event.transactionIds.join(','),
    tradeDate: event.tradeDate,
    stockId: event.stockId,
    stockName: event.stockName,
    tradeType: '現股',
    kind: event.scenario === 'add-on' ? 'add-on' : 'entry',
    isReentry: event.scenario === 'reentry',
    quantity: event.quantity,
    price: event.executionPrice,
    positionBefore: event.positionBefore ?? 0,
    averageCostBefore: event.averageCostBefore,
    positionAfter: event.positionAfter ?? 0,
    includeInScenarioResearch: event.includeInScenarioResearch,
  };
}

/**
 * 執行研究。
 *
 * 只讀本機快取，不發出網路請求：資料回補是獨立的動作，
 * 這樣開啟研究頁時能立即看到既有結果，而不是每次都等待數十秒。
 */
export async function runResearch(
  scenario: ResearchScenario = 'establish',
  from = RESEARCH_FROM_DATE,
): Promise<ResearchReport> {
  const ledger = await loadResearchLedger();
  const entries = selectLedgerEvents(ledger, scenario).filter((event) => event.tradeDate >= from);
  const reentryCount =
    scenario === 'establish'
      ? ledger.events.filter(
          (event) => event.scenario === 'reentry' && event.tradeDate >= from,
        ).length
      : 0;

  const samples: Record<ResearchMetric, ResearchSample[]> = {
    bias20: [],
    foreignFlow: [],
    trustFlow: [],
    marginFlow: [],
  };

  const scenarioSamples: ResearchReport['samples'] = samples;
  if (scenario === 'add-on') scenarioSamples.relativeCost = [];

  const previous = new Map<string, string>();
  const missingStocks = new Set<string>();
  let technicalCount = 0;
  let chipCount = 0;
  let completeCount = 0;

  for (const entry of entries) {
    const { rawPrices, institutional, margin, dividends, splits } = await loadStockData(
      entry.stockId,
    );

    if (rawPrices.length === 0) {
      missingStocks.add(entry.stockId);
    }

    const snapshot = buildEntrySnapshot({
      entry: asLegacySnapshotEvent(entry),
      prices: rawPrices,
      institutional,
      margin,
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

    scenarioSamples.bias20.push({
      ...base,
      metricValue: snapshot.technical.ok ? snapshot.technical.snapshot.bias20 : null,
    });
    scenarioSamples.foreignFlow.push({
      ...base,
      metricValue: snapshot.chip.ok ? flowAxis(snapshot.chip.snapshot.foreign) : null,
    });
    scenarioSamples.trustFlow.push({
      ...base,
      metricValue: snapshot.chip.ok ? flowAxis(snapshot.chip.snapshot.trust) : null,
    });
    scenarioSamples.marginFlow.push({
      ...base,
      // 融資有自己的中性門檻：法人的 500 張會把多數融資變化誤判為中性
      metricValue: computeFlow(snapshot.margin, MARGIN_FLOW_THRESHOLDS)?.signedRatio ?? null,
    });

    if (scenario === 'add-on') {
      const relativeCost = entry.relativeCostAvailable ? entry.relativeCostPercent : null;
      scenarioSamples.relativeCost?.push({ ...base, metricValue: relativeCost });
    }
  }

  const results = Object.fromEntries(
    researchMetricsFor(scenario).map((metric) => [
      metric,
      {
        stock: runWalkForward({ samples: scenarioSamples[metric] ?? [], assetClass: 'stock', metric }),
        etf: runWalkForward({ samples: scenarioSamples[metric] ?? [], assetClass: 'etf', metric }),
      },
    ]),
  ) as ResearchReport['results'];

  return {
    scenario,
    eventCount: entries.length,
    entryCount: entries.length,
    reentryCount,
    technicalCount,
    chipCount,
    completeCount,
    missingStocks: [...missingStocks],
    ledgerQuality: {
      excludedByCode: ledger.excludedByCode,
      stockStatus: Object.fromEntries(ledger.stockStatus),
    },
    samples: scenarioSamples,
    results,
  };
}
