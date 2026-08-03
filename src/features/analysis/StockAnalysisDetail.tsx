import type { StockAnalysis } from '../../dss/analyseHoldings';
import type { DistortionEvent } from '../../dss/adjustment';
import { ChipPanel } from './ChipPanel';
import { TechnicalPanel } from './TechnicalPanel';

const EVENT_LABEL: Record<'dividend' | 'split', string> = { dividend: '除權息', split: '分割' };

function AdjustmentNotice({ events }: { events: DistortionEvent[] }) {
  if (events.length === 0) return null;
  return <details className="adjustment"><summary className="adjustment__title">已還原權息與分割</summary><ul className="adjustment__events">{events.map((event) => <li key={`${event.kind}-${event.date}`}><span className="num">{event.date}</span><span>{EVENT_LABEL[event.kind]}</span><span className="num">{event.impactPercent >= 0 ? '+' : ''}{event.impactPercent.toFixed(2)}%</span></li>)}</ul><p className="adjustment__note">均線與乖離率已排除上列帳面跳空。歷史價格經過換算，與券商對帳單的成交價不會逐筆相同。</p></details>;
}

/** 整頁與今日右側彈窗都使用這一份內容，避免兩處數字與趨勢不同步。 */
export function StockAnalysisDetail({ analysis }: { analysis: StockAnalysis }) {
  return <section className="analysis-detail" aria-label="完整分析內容"><AdjustmentNotice events={analysis.appliedAdjustments} /><div className="stock__panels"><TechnicalPanel result={analysis.technical} /><ChipPanel result={analysis.chip} margin={analysis.margin} /></div></section>;
}
