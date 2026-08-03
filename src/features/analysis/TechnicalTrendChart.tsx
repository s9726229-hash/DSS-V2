import type { TrendSeries } from '../../dss/trend';

const TREND_DAYS = 20;
const WIDTH = 360;
const HEIGHT = 116;

/**
 * 一條線的路徑。
 *
 * 沒有值的日子留白並中斷線段，不把有值的日子抽出來重排——那會讓月線被拉開
 * 撐滿整張圖，看起來像二十天都算得出來（籌碼圖的均線也是同樣的處理方式）。
 *
 * 縮放用視窗內的實際價差，不設下限：價格是小數，十幾塊的股票整個月常常
 * 波動不到一元，硬拉成一元就會壓成一條貼底的平線。
 */
function linePath(values: readonly (number | null)[], min: number, max: number): string {
  const stepX = WIDTH / Math.max(1, values.length - 1);
  const span = max - min;
  // 全部同價時沒有可縮放的區間，畫在中線比壓在底部誠實
  const y = (value: number) => (span === 0 ? HEIGHT / 2 : HEIGHT - ((value - min) / span) * HEIGHT);

  let path = '';
  let command = 'M';

  values.forEach((value, index) => {
    if (value === null) {
      command = 'M';
      return;
    }

    path += `${command}${(index * stepX).toFixed(2)},${y(value).toFixed(2)}`;
    command = 'L';
  });

  return path;
}

/** 完整分析右欄的價格圖：只呈現收盤與 MA20，籌碼另列以免混成同一尺度。 */
export function TechnicalTrendChart({ series }: { series: TrendSeries }) {
  const points = series.points.slice(-TREND_DAYS);
  if (points.length < 2) return <p className="technical-trend__empty">價格資料不足，無法繪製趨勢。</p>;

  const priceValues = points.flatMap((point) => point.ma20 === null ? [point.close] : [point.close, point.ma20]);
  const priceMin = Math.min(...priceValues);
  const priceMax = Math.max(...priceValues);
  const closePath = linePath(points.map((point) => point.close), priceMin, priceMax);
  const maValues = points.map((point) => point.ma20);
  const maPath =
    maValues.filter((value) => value !== null).length < 2
      ? null
      : linePath(maValues, priceMin, priceMax);

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
