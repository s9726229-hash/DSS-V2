import type { DailyNet } from '../dss/chip';
import { lots } from './dssLabels';

const BAR_WIDTH = 7;
const GAP = 3;
const HEIGHT = 22;
const HALF = HEIGHT / 2;

/** 純視覺元素不重複播報數字，因此柱子本身不帶標題，由 aria-label 一次講完。 */
function toneOf(net: number): string {
  if (net > 0) return 'chipbars__bar chipbars__bar--up';
  if (net < 0) return 'chipbars__bar chipbars__bar--down';
  return 'chipbars__bar chipbars__bar--flat';
}

/**
 * 每日買賣超的迷你長條。
 *
 * 只看 5 日合計分不出「連續買五天」和「賣四天、最後一天翻多」，
 * 而那兩件事在籌碼上是完全不同的意思。這五根柱子就是為了那個差別。
 *
 * 台股慣例紅漲綠跌：買超向上為紅，賣超向下為綠。高度只表示相對大小，
 * 以視窗內最大絕對值為滿格——跨個股不可比，因此絕對數字仍要看旁邊的文字。
 */
export function ChipBars({ daily, label }: { daily: readonly DailyNet[]; label: string }) {
  // 規格：不得只用圖形隱藏資料不足。沒有逐日資料就不畫，不用空圖假裝有內容
  if (daily.length === 0) return null;

  const scale = Math.max(...daily.map((day) => Math.abs(day.net)));
  const width = daily.length * BAR_WIDTH + (daily.length - 1) * GAP;

  return (
    <svg
      className="chipbars"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label={`${label}每日買賣超，由舊到新：${daily
        .map((day) => `${day.date} ${lots(day.net)}`)
        .join('、')}`}
    >
      <line className="chipbars__zero" x1={0} y1={HALF} x2={width} y2={HALF} />
      {daily.map((day, index) => {
        // 五天全部持平時 scale 是 0，畫一條貼齊零線的細痕，不去除以零
        const height = scale === 0 ? 1 : Math.max(1, (Math.abs(day.net) / scale) * (HALF - 1));

        return (
          <rect
            key={day.date}
            className={toneOf(day.net)}
            x={index * (BAR_WIDTH + GAP)}
            y={day.net >= 0 ? HALF - height : HALF}
            width={BAR_WIDTH}
            height={height}
          />
        );
      })}
    </svg>
  );
}
