import { useEffect, useState } from 'react';
import type { DistortionEvent } from '../../dss/adjustment';
import { adjustPrices } from '../../dss/adjustment';
import type { ChipResult } from '../../dss/chip';
import { computeChipSnapshot } from '../../dss/chip';
import type { TechnicalResult } from '../../dss/technical';
import { computeTechnicalSnapshot } from '../../dss/technical';
import type { AdjustmentEventRow, InstitutionalRow, PriceRow } from '../../market/types';
import { readCachedDataset } from '../../storage/marketCache';
import { readHoldingsSnapshot } from '../../storage/portfolio';
import { ChipPanel } from './ChipPanel';
import { TechnicalPanel } from './TechnicalPanel';
import './AnalysisPage.css';

export type StockAnalysis = {
  stockId: string;
  stockName: string;
  priceDate: string | null;
  technical: TechnicalResult;
  chip: ChipResult;
  appliedAdjustments: DistortionEvent[];
};

const EVENT_LABEL: Record<'dividend' | 'split', string> = {
  dividend: '除權息',
  split: '分割',
};

/**
 * 已套用的還原事件。
 *
 * 配息與分割會讓股價帳面下跌但資產未減少，若不還原，均線與乖離率會失真。
 * 此處以中性語氣說明已做了什麼調整，而非警告——數字現在是正確的，
 * 但使用者仍應知道畫面上的歷史價格與券商對帳單不會逐筆相符。
 */
function AdjustmentNotice({ events }: { events: DistortionEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="adjustment">
      <span className="adjustment__title">已還原權息與分割</span>
      <ul className="adjustment__events">
        {events.map((event) => (
          <li key={`${event.kind}-${event.date}`}>
            <span className="num">{event.date}</span>
            <span>{EVENT_LABEL[event.kind]}</span>
            <span className="num">
              {event.impactPercent >= 0 ? '+' : ''}
              {event.impactPercent.toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="adjustment__note">
        均線與乖離率已排除上列帳面跳空。歷史價格經過換算，與券商對帳單的成交價不會逐筆相同。
      </p>
    </div>
  );
}

async function analyseStock(stockId: string, stockName: string): Promise<StockAnalysis> {
  const [priceCache, institutionalCache, dividendCache, splitCache] = await Promise.all([
    readCachedDataset('TaiwanStockPrice', stockId),
    readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
    readCachedDataset('TaiwanStockDividendResult', stockId),
    readCachedDataset('TaiwanStockSplitPrice', stockId),
  ]);

  const raw = (priceCache?.payload ?? []) as PriceRow[];
  const institutional = (institutionalCache?.payload ?? []) as InstitutionalRow[];

  // 先還原再計算，均線與乖離才不會被除權息與分割的帳面跳空拉偏
  const { prices, appliedEvents } = adjustPrices({
    prices: raw,
    dividends: (dividendCache?.payload ?? []) as AdjustmentEventRow[],
    splits: (splitCache?.payload ?? []) as AdjustmentEventRow[],
  });

  return {
    stockId,
    stockName,
    priceDate: priceCache?.tradeDate || null,
    technical: computeTechnicalSnapshot(prices),
    chip: computeChipSnapshot({ institutional, prices }),
    appliedAdjustments: appliedEvents,
  };
}

export function AnalysisPage() {
  const [analyses, setAnalyses] = useState<StockAnalysis[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const holdings = await readHoldingsSnapshot();
      const results = await Promise.all(
        holdings.map((holding) => analyseStock(holding.stockId, holding.stockName)),
      );

      if (!cancelled) setAnalyses(results);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="analysis">
      <header className="analysis__head">
        <h1 className="analysis__title">技術分析</h1>
        <p className="analysis__lede">
          依最近一個交易日的收盤資料計算。技術面與籌碼面各自獨立呈現，不合併為單一評分，也不產生買賣建議。
        </p>
      </header>

      {analyses === null ? <p className="analysis__loading">讀取中…</p> : null}

      {analyses !== null && analyses.length === 0 ? (
        <p className="analysis__empty">
          尚未匯入庫存。請先到<strong>資料中心</strong>匯入庫存報表，再同步市場資料。
        </p>
      ) : null}

      {analyses?.map((analysis) => (
        <section className="stock" key={analysis.stockId} aria-label={`${analysis.stockId} 分析`}>
          <header className="stock__head">
            <h2 className="stock__id num">{analysis.stockId}</h2>
            <span className="stock__name">{analysis.stockName}</span>
            <span className="stock__date num">
              {analysis.priceDate ? `資料日 ${analysis.priceDate}` : '尚未同步'}
            </span>
          </header>

          <AdjustmentNotice events={analysis.appliedAdjustments} />

          <div className="stock__panels">
            <TechnicalPanel result={analysis.technical} />
            <ChipPanel result={analysis.chip} />
          </div>
        </section>
      ))}
    </div>
  );
}
