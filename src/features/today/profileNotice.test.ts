import { describe, expect, it } from 'vitest';
import type { CardBand } from '../../dss/holdingCard';
import { profileRuleNotice } from './profileNotice';

function band(partial: Partial<CardBand>): CardBand {
  return { metric: 'bias20', value: 1, band: null, unverified: false, evidence: null, ...partial };
}

describe('卡片上的 Profile 規則提示', () => {
  it('四個指標都算得出來卻都沒門檻時，說整份規則都還沒設', () => {
    const bands = [
      band({ metric: 'bias20' }),
      band({ metric: 'foreignFlow' }),
      band({ metric: 'trustFlow' }),
      band({ metric: 'marginFlow' }),
    ];

    expect(profileRuleNotice(bands)).toBe('未設 Profile 規則');
  });

  /*
   * 資料不足的指標本來就不可能有判定，不該把它算成「已設規則」，
   * 否則只要有一項資料不足，畫面就永遠說不出「整份規則都還沒設」。
   */
  it('有指標資料不足時，其餘全都沒門檻仍算整份未設', () => {
    const bands = [
      band({ metric: 'bias20', value: null }),
      band({ metric: 'foreignFlow' }),
      band({ metric: 'trustFlow' }),
      band({ metric: 'marginFlow' }),
    ];

    expect(profileRuleNotice(bands)).toBe('未設 Profile 規則');
  });

  it('只有部分沒門檻時，說還差幾項', () => {
    const bands = [
      band({ metric: 'bias20', band: 'normal' }),
      band({ metric: 'foreignFlow' }),
      band({ metric: 'trustFlow' }),
      band({ metric: 'marginFlow', value: null }),
    ];

    expect(profileRuleNotice(bands)).toBe('尚有 2 項未設規則');
  });

  it('算得出來的指標都有門檻時不提示', () => {
    const bands = [
      band({ metric: 'bias20', band: 'normal' }),
      band({ metric: 'foreignFlow', band: 'pullback' }),
      band({ metric: 'trustFlow', value: null }),
      band({ metric: 'marginFlow', band: 'overheated' }),
    ];

    expect(profileRuleNotice(bands)).toBeNull();
  });

  /* 全部資料不足時，缺的是資料不是規則；這句話由資料不足的訊息負責。 */
  it('全部指標都資料不足時不提規則', () => {
    const bands = [band({ metric: 'bias20', value: null }), band({ metric: 'foreignFlow', value: null })];

    expect(profileRuleNotice(bands)).toBeNull();
  });
});
