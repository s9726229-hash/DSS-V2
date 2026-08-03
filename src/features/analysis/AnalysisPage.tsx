import { useEffect, useState } from 'react';
import { analyseHoldings, type StockAnalysis } from '../../dss/analyseHoldings';
import { StockAnalysisDetail } from './StockAnalysisDetail';
import './AnalysisPage.css';

export function AnalysisPage() {
  const [analyses, setAnalyses] = useState<StockAnalysis[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const results = await analyseHoldings();

      if (!cancelled) setAnalyses(results);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="analysis">
      <header className="analysis__head">
        <h1 className="analysis__title">完整分析</h1>
        <p className="analysis__lede">
          逐檔查看原始數字、趨勢與計算依據。資料依最近一個交易日的收盤資料計算，不產生買賣建議。
        </p>
      </header>

      <>
          {analyses === null ? <p className="analysis__loading">讀取中…</p> : null}

          {analyses !== null && analyses.length === 0 ? (
            <p className="analysis__empty">
              尚未匯入庫存。請先到<strong>資料中心</strong>匯入庫存報表，再同步市場資料。
            </p>
          ) : null}

          {analyses?.map((analysis) => (
            <section
              className="stock"
              key={analysis.stockId}
              aria-label={`${analysis.stockId} 分析`}
            >
              <header className="stock__head">
                <h2 className="stock__id num">{analysis.stockId}</h2>
                <span className="stock__name">{analysis.stockName}</span>
                <span className="stock__date num">
                  {analysis.priceDate ? `資料日 ${analysis.priceDate}` : '尚未同步'}
                </span>
              </header>

              <StockAnalysisDetail analysis={analysis} />
            </section>
          ))}
      </>
    </div>
  );
}
