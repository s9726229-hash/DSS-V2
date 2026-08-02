import type { Continuity, JointChipState } from '../dss/chip';
import type { FlowChange, FlowStrength } from '../dss/flow';
import type { MonthlyLineState, RecoveryState, TechnicalAlert } from '../dss/technical';

/**
 * 技術與籌碼的顯示字串。
 *
 * 技術分析頁與今日 DSS 圖卡都用這一份。同一個狀態在兩頁寫成不同說法，
 * 使用者會以為那是兩件不同的事。
 */
export const MONTHLY_LINE_LABEL: Record<MonthlyLineState, string> = {
  recovery: '收復月線',
  confirmed: '站穩月線',
  lost: '跌破月線',
};

export const RECOVERY_LABEL: Record<Exclude<RecoveryState, null>, string> = {
  watching: '回檔後回穩觀察',
  confirmed: '回檔後回穩',
};

export const ALERT_LABEL: Record<TechnicalAlert, string> = {
  'pullback-watch': '回檔觀察',
  'trend-weakening': '趨勢轉弱',
};

export const JOINT_LABEL: Record<JointChipState, string> = {
  'both-accumulating': '外資與投信同買',
  'both-distributing': '外資與投信同賣',
  divergent: '外資與投信分歧',
  'no-consensus': '無共識',
};

/** 法人身分別的顯示名稱。改口徑要連同這裡一起改，別讓畫面與計算各講各的。 */
export const INVESTOR_LABEL = {
  foreign: '外資',
  trust: '投信',
} as const;

/**
 * 方向變化。
 *
 * 這是每天真正要讀的一句話，所以寫成完整敘述而不是代號：
 * 「買超增加」要看得出是延續，「買轉賣」要看得出是轉向。
 */
export const FLOW_CHANGE_LABEL: Record<FlowChange, string> = {
  'buy-up': '買超增加',
  'buy-down': '買超減少',
  'buy-flat': '買超持平',
  'sell-up': '賣超增加',
  'sell-down': '賣超減少',
  'sell-flat': '賣超持平',
  'buy-to-sell': '由買轉賣',
  'sell-to-buy': '由賣轉買',
  'to-neutral': '轉為中性',
  'neutral-to-buy': '中性轉買',
  'neutral-to-sell': '中性轉賣',
  'neutral-stay': '維持中性',
};

/**
 * 方向變化的色調。
 *
 * 台股慣例紅漲綠跌，但這裡表示的是法人的買賣方向，不是股價漲跌——
 * 買超側用紅、賣超側用綠，中性不上色。這只描述方向，不表示好壞。
 */
export const FLOW_CHANGE_TONE: Record<FlowChange, 'up' | 'down' | 'flat'> = {
  'buy-up': 'up',
  'buy-down': 'up',
  'buy-flat': 'up',
  'sell-up': 'down',
  'sell-down': 'down',
  'sell-flat': 'down',
  'buy-to-sell': 'down',
  'sell-to-buy': 'up',
  'to-neutral': 'flat',
  'neutral-to-buy': 'up',
  'neutral-to-sell': 'down',
  'neutral-stay': 'flat',
};

export const FLOW_STRENGTH_LABEL: Record<FlowStrength, string> = {
  weaker: '明顯減弱',
  similar: '與近期接近',
  stronger: '增加',
  'much-stronger': '大幅增加',
};

/** 力道比例。基準沒有方向時無從比較，寫明而不是填 0。 */
export function ratioText(ratio: number | null): string {
  if (ratio === null) return '近期無明確方向，無法比較';
  return `${ratio.toFixed(2)} 倍`;
}

/** 法人張數。股轉張，帶正負號。 */
export function lots(shares: number): string {
  const value = shares / 1000;
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)} 張`;
}

/**
 * 強度：5 日淨額 ÷ 5 日平均量，單位是「日」。
 * 0.36 天量＝這 5 天的淨額大約等於 0.36 個交易日的成交量。
 *
 * 小到第二位都進位成 0 時直接寫「約 0」：印成 -0.00 天量看起來像壞掉，
 * 而且那個負號讓四捨五入的殘渣看起來像有方向的資訊。
 */
export function strengthText(strength: number): string {
  if (Math.abs(strength) < 0.005) return '約 0 天量';

  return `${strength >= 0 ? '+' : ''}${strength.toFixed(2)} 天量`;
}

/**
 * 連續性。
 *
 * 只有一天時寫「連買 1 日」會與同行的 5 日淨額互相打架——淨額是五天合計，
 * 連續性只講最後一天，兩個期間並排看起來像自相矛盾。一天就直說是最新一日。
 */
export function continuityText({ direction, days }: Continuity): string {
  if (direction === 'flat' || days === 0) return '最新一日 持平';
  if (days === 1) return `最新一日 ${direction === 'buy' ? '買超' : '賣超'}`;
  return `連${direction === 'buy' ? '買' : '賣'} ${days} 日`;
}
