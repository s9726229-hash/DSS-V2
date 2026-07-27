import { useEffect, useState } from 'react';
import type { ChipResult } from '../../dss/chip';
import { computeChipSnapshot } from '../../dss/chip';
import type { TechnicalResult } from '../../dss/technical';
import { computeTechnicalSnapshot } from '../../dss/technical';
import type { InstitutionalRow, PriceRow } from '../../market/types';
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
};

async function analyseStock(stockId: string, stockName: string): Promise<StockAnalysis> {
  const [priceCache, institutionalCache] = await Promise.all([
    readCachedDataset('TaiwanStockPrice', stockId),
    readCachedDataset('TaiwanStockInstitutionalInvestorsBuySell', stockId),
  ]);

  const prices = (priceCache?.payload ?? []) as PriceRow[];
  const institutional = (institutionalCache?.payload ?? []) as InstitutionalRow[];

  return {
    stockId,
    stockName,
    priceDate: priceCache?.tradeDate || null,
    technical: computeTechnicalSnapshot(prices),
    chip: computeChipSnapshot({ institutional, prices }),
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

          <div className="stock__panels">
            <TechnicalPanel result={analysis.technical} />
            <ChipPanel result={analysis.chip} />
          </div>
        </section>
      ))}
    </div>
  );
}
