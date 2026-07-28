import { useEffect, useState } from 'react';
import type { DistortionReport } from '../../dss/adjustment';
import { detectDistortion } from '../../dss/adjustment';
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
  distortion: DistortionReport;
};

const EVENT_LABEL: Record<'dividend' | 'split', string> = {
  dividend: '除權息',
  split: '分割',
};

/**
 * 目前使用未還原價，除權息與分割會讓均線出現帳面跳空。
 * 明確標示受影響的個股，避免失真的數字被當成真實走勢。
 */
function DistortionNotice({ report }: { report: DistortionReport }) {
  if (!report.distorted) return null;

  return (
    <div className="distortion">
      <span className="distortion__title">價格未還原，技術指標可能失真</span>
      <ul className="distortion__events">
        {report.events.map((event) => (
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
      <p className="distortion__note">
        上列事件落在均線計算窗口內，帳面跳空並非真實漲跌。
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

  const prices = (priceCache?.payload ?? []) as PriceRow[];
  const institutional = (institutionalCache?.payload ?? []) as InstitutionalRow[];

  return {
    stockId,
    stockName,
    priceDate: priceCache?.tradeDate || null,
    technical: computeTechnicalSnapshot(prices),
    chip: computeChipSnapshot({ institutional, prices }),
    distortion: detectDistortion({
      prices,
      dividends: (dividendCache?.payload ?? []) as AdjustmentEventRow[],
      splits: (splitCache?.payload ?? []) as AdjustmentEventRow[],
    }),
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

          <DistortionNotice report={analysis.distortion} />

          <div className="stock__panels">
            <TechnicalPanel result={analysis.technical} />
            <ChipPanel result={analysis.chip} />
          </div>
        </section>
      ))}
    </div>
  );
}
