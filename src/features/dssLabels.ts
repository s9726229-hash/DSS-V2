import type { Continuity, JointChipState } from '../dss/chip';
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

/** 法人張數。股轉張，帶正負號。 */
export function lots(shares: number): string {
  const value = shares / 1000;
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)} 張`;
}

export function continuityText({ direction, days }: Continuity): string {
  if (direction === 'flat' || days === 0) return '無連續';
  return `連${direction === 'buy' ? '買' : '賣'} ${days} 日`;
}
