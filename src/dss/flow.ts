import type { DailyNet, InvestorChip } from './chip';

/** 基準取前 5 個交易日，加上今日共需 6 筆。 */
export const FLOW_BASELINE_DAYS = 5;

export type FlowDirection = 'buy' | 'sell' | 'neutral';

/**
 * 方向變化。
 *
 * 先判方向、再比力道，而不是直接把今日除以近期平均：
 * 方向反轉時相除只會得到一個負數，看不出「買轉賣」這件事。
 */
export type FlowChange =
  | 'buy-up'
  | 'buy-down'
  | 'buy-flat'
  | 'sell-up'
  | 'sell-down'
  | 'sell-flat'
  | 'buy-to-sell'
  | 'sell-to-buy'
  | 'to-neutral'
  | 'neutral-to-buy'
  | 'neutral-to-sell'
  | 'neutral-stay';

/** 力道相對近期平均的強弱；方向沒有基準可比時為 null。 */
export type FlowStrength = 'weaker' | 'similar' | 'stronger' | 'much-stronger';

export type FlowThresholds = {
  /** 中性帶：今日絕對值低於「前五日平均絕對值 × 這個比例」即視為沒有明確方向。 */
  neutralRatio: number;
  /**
   * 中性帶的固定下限（股）。
   *
   * 只用比例的話，前五日平均接近零時中性帶會窄到幾乎不存在，
   * 幾十張的買賣超也會被講成明確方向。兩者取較大的那個。
   */
  neutralFloor: number;
  /** 低於此比例為明顯減弱。 */
  flatLow: number;
  /** 到此比例為止都算與近期相當。 */
  flatHigh: number;
  /** 到此比例為止算增加，超過則為大幅增加。 */
  strongHigh: number;
};

/**
 * 預設門檻。
 *
 * 這些是市場慣例值，不是從歷史資料研究出來的——畫面必須標明這一點。
 * 全部集中在這個物件，之後要接 Profile 或 walk-forward 都不必動判斷流程。
 */
export const DEFAULT_FLOW_THRESHOLDS: FlowThresholds = {
  neutralRatio: 0.1,
  neutralFloor: 500 * 1000,
  flatLow: 0.8,
  flatHigh: 1.2,
  strongHigh: 1.5,
};

export type FlowResult = {
  /** 最新一個交易日的淨額（股）。 */
  today: number;
  /** 前五日平均淨額（股），不含今日。 */
  baseline: number;
  todayDirection: FlowDirection;
  baselineDirection: FlowDirection;
  change: FlowChange;
  /** 今日絕對值 ÷ 前五日平均絕對值；基準沒有方向時為 null。 */
  ratio: number | null;
  /**
   * 今日淨額 ÷ 前五日平均絕對值，保留正負號。
   *
   * 顯示一律用 `change` 那句話——帶正負號的除法講不出「買轉賣」。
   * 但研究需要的是一條可排序的連續軸：負值是今天在賣、正值是今天在買，
   * 絕對值是相對近期的規模。這個欄位只給研究與 Profile 判定用。
   */
  signedRatio: number | null;
  strength: FlowStrength | null;
  /**
   * 實際參與判斷的那 6 天（前五日＋今日），由舊到新。
   *
   * 這不是走勢圖要畫的東西——圖要畫完整歷史，判斷只看最後這一段。
   * 兩者混用會讓走勢圖永遠只有 6 根長條。
   */
  window: readonly DailyNet[];
};

function directionOf(net: number, threshold: number): FlowDirection {
  if (Math.abs(net) < threshold) return 'neutral';
  return net > 0 ? 'buy' : 'sell';
}

function strengthOf(ratio: number, { flatLow, flatHigh, strongHigh }: FlowThresholds): FlowStrength {
  if (ratio < flatLow) return 'weaker';
  if (ratio <= flatHigh) return 'similar';
  if (ratio <= strongHigh) return 'stronger';
  return 'much-stronger';
}

/** 同方向時只有強弱之分；持平帶與力道分級共用同一組邊界，兩者才不會互相打架。 */
function sameDirectionChange(
  direction: 'buy' | 'sell',
  strength: FlowStrength,
): FlowChange {
  if (strength === 'weaker') return direction === 'buy' ? 'buy-down' : 'sell-down';
  if (strength === 'similar') return direction === 'buy' ? 'buy-flat' : 'sell-flat';
  return direction === 'buy' ? 'buy-up' : 'sell-up';
}

/**
 * 今日相對近期的買賣方向與力道。
 *
 * 只吃一組每日淨額，與資料來源無關——外資、投信、之後的融資共用這一支，
 * 任何身分別的欄位名稱都不該出現在這裡。
 *
 * 資料不足 6 個交易日時回 null：拿三天當「近期平均」跟拿五天是兩件事，
 * 畫面不該分不出來，寧可說沒有結果。
 */
export function computeFlow(
  daily: readonly DailyNet[],
  thresholds: FlowThresholds = DEFAULT_FLOW_THRESHOLDS,
): FlowResult | null {
  if (daily.length < FLOW_BASELINE_DAYS + 1) return null;

  const window = daily.slice(-(FLOW_BASELINE_DAYS + 1));
  const today = window[window.length - 1].net;
  const baseline =
    window.slice(0, FLOW_BASELINE_DAYS).reduce((sum, day) => sum + day.net, 0) /
    FLOW_BASELINE_DAYS;

  /*
   * 基準自己的中性判定只用固定下限：拿「基準的一成」去衡量基準本身是循環的，
   * 永遠不會成立。
   */
  const baselineDirection = directionOf(baseline, thresholds.neutralFloor);
  const todayDirection = directionOf(
    today,
    Math.max(Math.abs(baseline) * thresholds.neutralRatio, thresholds.neutralFloor),
  );

  // 基準沒有方向時，「幾倍」沒有意義，也不能除以零
  const signedRatio = baselineDirection === 'neutral' ? null : today / Math.abs(baseline);
  const ratio = signedRatio === null ? null : Math.abs(signedRatio);
  const strength = ratio === null ? null : strengthOf(ratio, thresholds);

  const change = ((): FlowChange => {
    if (baselineDirection === 'neutral') {
      if (todayDirection === 'buy') return 'neutral-to-buy';
      if (todayDirection === 'sell') return 'neutral-to-sell';
      return 'neutral-stay';
    }
    if (todayDirection === 'neutral') return 'to-neutral';
    if (todayDirection !== baselineDirection) {
      return baselineDirection === 'buy' ? 'buy-to-sell' : 'sell-to-buy';
    }
    return sameDirectionChange(todayDirection, strength as FlowStrength);
  })();

  return {
    today,
    baseline,
    todayDirection,
    baselineDirection,
    change,
    ratio,
    signedRatio,
    strength,
    window,
  };
}

/**
 * 研究與 Profile 判定用的那條軸。
 *
 * 顯示走的是 `computeFlow` 的 `change` 那句話；這裡回傳的是同一次計算的
 * 帶號比值，讓 walk-forward 有一個可排序的連續數值。資料不足或近期沒有
 * 明確方向時回 null——不足就是不足，不以 0 代替。
 */
export function flowAxis(
  chip: InvestorChip,
  thresholds: FlowThresholds = DEFAULT_FLOW_THRESHOLDS,
): number | null {
  return computeFlow(chip.series, thresholds)?.signedRatio ?? null;
}
