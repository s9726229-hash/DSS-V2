import type { ResearchMetric } from './runResearch';
import type { BandId } from './walkForward';

/**
 * 區間名稱依指標而異。
 *
 * 「回檔／偏熱」講的是價格離均線多遠，套到法人強度上意思是錯的：
 * 強度的低端是法人在賣，不是價格回檔。三個指標共用同一組名稱會讓
 * 籌碼那兩頁一直寫著語意不對的標題。
 *
 * 引擎組判定原因時也用這一份，否則畫面說「買超側」而原因說「偏熱上界」，
 * 同一件事會出現兩種講法。
 */
export const BAND_LABEL: Record<ResearchMetric, Record<BandId, string>> = {
  bias20: {
    pullback: '回檔下界',
    normal: '合理區',
    overheated: '偏熱上界',
  },
  foreignStrength: {
    pullback: '賣超側',
    normal: '中性',
    overheated: '買超側',
  },
  trustStrength: {
    pullback: '賣超側',
    normal: '中性',
    overheated: '買超側',
  },
};

export function bandLabel(metric: ResearchMetric, band: BandId): string {
  return BAND_LABEL[metric][band];
}
