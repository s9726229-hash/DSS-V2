import type { AssetClass } from '../../research/snapshot';
import type { BandId, EvidenceLevel } from '../../research/walkForward';

export const ASSET_LABEL: Record<AssetClass, string> = { stock: '個股', etf: 'ETF' };

/**
 * 搜尋紀錄的表格一列一個指標，欄位卻是三個區間共用的，
 * 因此表頭不能用任一指標的專屬名稱（見 research/bandLabels）。
 * 這裡用中性的位置說法，實際名稱在研究結果頁依指標顯示。
 */
export const NEUTRAL_BAND_LABEL: Record<BandId, string> = {
  pullback: '低區',
  normal: '中區',
  overheated: '高區',
};

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  'worth-tracking': '值得繼續追蹤',
  preliminary: '初步觀察',
  'insufficient-data': '資料不足',
  'insufficient-evidence': '證據不足',
  'threshold-unstable': '門檻不穩定',
  'overlap-sensitive': '重疊敏感',
};

/** 只有「值得繼續追蹤」為中性墨色，其餘一律琥珀，避免看起來像可以採用。 */
export const EVIDENCE_TONE: Record<EvidenceLevel, 'neutral' | 'attention'> = {
  'worth-tracking': 'neutral',
  preliminary: 'attention',
  'insufficient-data': 'attention',
  'insufficient-evidence': 'attention',
  'threshold-unstable': 'attention',
  'overlap-sensitive': 'attention',
};
