import type { AssetClass } from '../../research/snapshot';
import type { BandId, EvidenceLevel } from '../../research/walkForward';

export const ASSET_LABEL: Record<AssetClass, string> = { stock: '個股', etf: 'ETF' };

export const BAND_LABEL: Record<BandId, string> = {
  pullback: '回檔下界',
  normal: '合理區',
  overheated: '偏熱上界',
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
