import type { TrendSeries } from '../../dss/trend';

const TREND_DAYS = 20;
const WIDTH = 360;
const HEIGHT = 116;

function linePath(values: readonly number[], min: number, max: number, top: number, height: number): string {
  const stepX = WIDTH / Math.max(1, values.length - 1);
  const y = (value: number) => top + height - ((value - min) / Math.max(1, max - min)) * height;
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * stepX).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
}

/** 完整分析右欄的價格圖：只呈現收盤與 MA20，籌碼另列以免混成同一尺度。 */
export function TechnicalTrendChart({ series }: { series: TrendSeries }) {
  const points = series.points.slice(-TREND_DAYS);
  if (points.length < 2) return <p className="technical-trend__empty">價格資料不足，無法繪製趨勢。</p>;

  const priceValues = points.flatMap((point) => point.ma20 === null ? [point.close] : [point.close, point.ma20]);
  const priceMin = Math.min(...priceValues);
  const priceMax = Math.max(...priceValues);
  const closePath = linePath(points.map((point) => point.close), priceMin, priceMax, 0, HEIGHT);
  const maPoints = points.filter((point) => point.ma20 !== null);
  const maPath = maPoints.length < 2 ? null : linePath(maPoints.map((point) => point.ma20 as number), priceMin, priceMax, 0, HEIGHT);

  return (
    <figure className="technical-trend" aria-label="近 20 日股價走勢">
      <figcaption className="technical-trend__head">
        <span>股價</span>
        <span className="technical-trend__legend"><i className="technical-trend__key technical-trend__key--close" /><span>收盤</span><i className="technical-trend__key technical-trend__key--ma" /><span>月線（MA20）</span></span>
      </figcaption>
      <svg className="technical-trend__chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="近 20 個交易日收盤與月線趨勢" preserveAspectRatio="none">
        <path className="technical-trend__grid" d={`M0 ${HEIGHT / 2}H${WIDTH}`} />
        {maPath === null ? null : <path className="technical-trend__ma" d={maPath} />}
        <path className="technical-trend__close" d={closePath} />
      </svg>
    </figure>
  );
}
