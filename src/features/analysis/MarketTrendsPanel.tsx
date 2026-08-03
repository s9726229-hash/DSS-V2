import type { ChipResult, DailyNet } from '../../dss/chip';
import type { TrendSeries } from '../../dss/trend';
import { FLOW_BASELINE_DAYS } from '../../dss/flow';
import { FlowChart } from '../FlowChart';
import { INVESTOR_LABEL } from '../dssLabels';
import { recentTradingDays } from './chipTrend';
import { TechnicalTrendChart } from './TechnicalTrendChart';

function ChipTrend({ label, series, measure = '買賣超' }: { label: string; series: readonly DailyNet[]; measure?: string }) {
  return <section className="market-trends__flow" aria-label={`${label}走勢`}><h4>{label}</h4><FlowChart series={recentTradingDays(series)} baselineDays={FLOW_BASELINE_DAYS} label={label} measure={measure} /></section>;
}

/** 右欄只負責呈現二十日的實際路徑；今日判讀與原始數字留在左欄。 */
export function MarketTrendsPanel({ trend, chip, margin }: { trend: TrendSeries; chip: ChipResult; margin: readonly DailyNet[] }) {
  return (
    <section className="market-trends" aria-label="20 日走勢">
      <h3 className="market-trends__title micro">近 20 日走勢</h3>
      <TechnicalTrendChart series={trend} />
      {chip.ok ? <><ChipTrend label={INVESTOR_LABEL.foreign} series={chip.snapshot.foreign.series} /><ChipTrend label={INVESTOR_LABEL.trust} series={chip.snapshot.trust.series} /></> : <p className="market-trends__pending">法人資料不足，暫無外資與投信走勢。</p>}
      <ChipTrend label={INVESTOR_LABEL.margin} series={margin} measure="餘額增減" />
    </section>
  );
}
