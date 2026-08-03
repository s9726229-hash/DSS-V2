import type { CardBand } from '../../dss/holdingCard';

/**
 * 卡片上關於 Profile 規則的一句提示。
 *
 * 只把「算得出數值卻沒有門檻」算成未設規則：資料不足的指標本來就不可能有判定，
 * 拿它去湊總數的話，只要有任何一項資料不足，就永遠說不出「整份規則都還沒設」。
 * 全部指標都資料不足時不提規則——那時缺的是資料，由資料不足的訊息負責說明。
 */
export function profileRuleNotice(bands: readonly CardBand[]): string | null {
  const measured = bands.filter((band) => band.value !== null);
  const unset = measured.filter((band) => band.band === null).length;

  if (unset === 0) return null;
  return unset === measured.length ? '未設 Profile 規則' : `尚有 ${unset} 項未設規則`;
}
