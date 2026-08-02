import type { DailyNet } from '../dss/chip';
import { lots } from './dssLabels';

const HEIGHT = 34;
const HALF = HEIGHT / 2;
const BAR_GAP = 1;

/**
 * 每日淨買賣超走勢。
 *
 * 規格要求：直接畫每日淨額，正數在零軸上方、負數在下方，不先累加，
 * 也不拿淨額去除以成交量——那會變成另一個指標，看不出連續買賣與轉向。
 * 另外疊一條前五日平均線，讓「今日相對近期」這件事在圖上就看得到。
 *
 * 高度以視窗內最大絕對值為滿格，所以跨個股不可比；絕對數字要看旁邊的文字。
 */
export function FlowChart({
  series,
  baselineDays,
  label,
}: {
  series: readonly DailyNet[];
  /** 均線的取樣天數；不足這個天數的前段不畫線，不用短期均值假裝成同一條。 */
  baselineDays: number;
  label: string;
}) {
  // 規格：不得只用圖形隱藏資料不足
  if (series.length < 2) {
    return <p className="flowchart__empty">法人資料不足 2 日，無法繪製走勢</p>;
  }

  const width = series.length * 8;
  const step = width / series.length;
  const barWidth = Math.max(1, step - BAR_GAP);
  const scale = Math.max(...series.map((day) => Math.abs(day.net)), 1);
  const y = (value: number) => HALF - (value / scale) * (HALF - 1);

  /*
   * 均線只畫在真的算得出來的那一段：第 N 點的值需要它自己與前 N-1 天，
   * 前面不足的日子留白，不用天數不同的平均混成同一條線。
   */
  const averages = series.map((_, index) => {
    if (index + 1 < baselineDays) return null;
    const window = series.slice(index + 1 - baselineDays, index + 1);
    return window.reduce((sum, day) => sum + day.net, 0) / baselineDays;
  });

  const first = averages.findIndex((value) => value !== null);
  const averagePath =
    first === -1
      ? null
      : averages
          .slice(first)
          .map(
            (value, offset) =>
              `${offset === 0 ? 'M' : 'L'}${((first + offset) * step + step / 2).toFixed(2)},${y(
                value as number,
              ).toFixed(2)}`,
          )
          .join(' ');

  const last = series[series.length - 1];

  return (
    <svg
      className="flowchart"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      preserveAspectRatio="none"
      /*
       * 寬度隨天數成長，但有上限：只有幾天資料時若撐滿整欄，
       * 長條會被拉成一塊塊色塊，看起來像壞掉而不是圖表。
       */
      style={{ maxWidth: `${series.length * 14}px` }}
      aria-label={`${label}最近 ${series.length} 個交易日每日買賣超，最新一日 ${last.date} ${lots(
        last.net,
      )}`}
    >
      <line className="flowchart__zero" x1={0} y1={HALF} x2={width} y2={HALF} />
      {series.map((day, index) => {
        const top = day.net >= 0 ? y(day.net) : HALF;
        const height = Math.max(1, Math.abs(y(day.net) - HALF));

        return (
          <rect
            key={day.date}
            className={
              day.net > 0
                ? 'flowchart__bar flowchart__bar--up'
                : day.net < 0
                  ? 'flowchart__bar flowchart__bar--down'
                  : 'flowchart__bar flowchart__bar--flat'
            }
            x={index * step}
            y={top}
            width={barWidth}
            height={height}
          />
        );
      })}
      {averagePath === null ? null : <path className="flowchart__average" d={averagePath} />}
    </svg>
  );
}
