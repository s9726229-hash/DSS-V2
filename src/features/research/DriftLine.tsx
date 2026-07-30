import type { DriftRange, ThresholdDrift } from '../../research/walkForward';
import { percent } from './format';

// 兩端點不重複掛單位，只在幅度標一次，避免一行出現三個 %
function segment(label: string, range: DriftRange, unit: string): string {
  return `${label} ${percent(range.low, '')} ～ ${percent(range.high, '')}（幅度 ${range.span.toFixed(2)}${unit}）`;
}

/**
 * 門檻在檢查點之間走過的範圍。
 *
 * 每個區間顯示的門檻只是最新檢查點的值；沒有這一行就看不出門檻漂了多少，
 * 也就無從理解「門檻不穩定」是怎麼判出來的。
 */
export function DriftLine({ drift, unit }: { drift: ThresholdDrift; unit: string }) {
  const parts = [
    drift.p25 === null ? null : segment('P25', drift.p25, unit),
    drift.p75 === null ? null : segment('P75', drift.p75, unit),
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) return null;

  return <p className="checkpoints__drift num">{parts.join('．')}</p>;
}
