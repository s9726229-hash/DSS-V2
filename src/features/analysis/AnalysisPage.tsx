import { useEffect, useState } from 'react';
import type { DistortionEvent } from '../../dss/adjustment';
import { analyseHoldings, type StockAnalysis } from '../../dss/analyseHoldings';
import { ChipPanel } from './ChipPanel';
import { TechnicalPanel } from './TechnicalPanel';
import './AnalysisPage.css';

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

              <AdjustmentNotice events={analysis.appliedAdjustments} />

              <div className="stock__panels">
                <TechnicalPanel result={analysis.technical} />
                <ChipPanel result={analysis.chip} margin={analysis.margin} />
              </div>
            </section>
          ))}
      </>
    </div>
  );
}
