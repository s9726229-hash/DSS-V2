import type { TrendSeries } from '../../dss/trend';

const WIDTH = 168;
const HEIGHT = 44;

/**
 * 迷你趨勢圖：收盤與 MA20 的相對位置。
 *
 * 規格：不得只用圖形隱藏資料不足。因此點數不足時不畫線而是明說，
 * 且 MA20 只畫在真的算得出來的那一段——前十九日沒有均線，
 * 線就從第二十日才開始，不用收盤價補一條假的。
 */
export function Sparkline({ series }: { series: TrendSeries }) {
  if (!series.drawable) {
    return <p className="spark__empty">價格資料不足，無法繪製趨勢</p>;
  }

  const { points, min, max } = series;
  const stepX = WIDTH / Math.max(1, points.length - 1);
  const y = (value: number) => HEIGHT - ((value - min) / (max - min)) * HEIGHT;

  const closePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${(index * stepX).toFixed(2)},${y(point.close).toFixed(2)}`)
    .join(' ');

  // MA20 從第一個非 null 開始，中間不會再有斷點
  const maStart = points.findIndex((point) => point.ma20 !== null);
  const maPath =
    maStart === -1
      ? null
      : points
          .slice(maStart)
          .map(
            (point, offset) =>
              `${offset === 0 ? 'M' : 'L'}${((maStart + offset) * stepX).toFixed(2)},${y(point.ma20 as number).toFixed(2)}`,
          )
          .join(' ');

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`最近 ${points.length} 個交易日，收盤自 ${first.close} 到 ${last.close}${
        maPath === null ? '，資料不足二十日，沒有月線' : '，另有 20 日均線'
      }`}
      preserveAspectRatio="none"
    >
      {maPath === null ? null : <path className="spark__ma" d={maPath} />}
      <path className="spark__close" d={closePath} />
    </svg>
  );
}
