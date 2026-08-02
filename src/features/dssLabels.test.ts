import { describe, expect, it } from 'vitest';
import { METRIC_UNIT } from '../research/runResearch';
import { continuityText, lots, strengthText } from './dssLabels';

describe('強度的寫法', () => {
  /*
   * 強度是 5 日淨額（股）÷ 5 日平均量（股／日），所以單位是「日」。
   * 以前印成沒有單位的小數，看起來像個抽象分數，沒人讀得出它在說什麼。
   */
  it('帶著單位，讓數字自己說明是幾天的量', () => {
    expect(strengthText(0.36)).toBe('+0.36 天量');
    expect(strengthText(-0.36)).toBe('-0.36 天量');
  });

  /*
   * 實機上出現過 -40 張被印成「-0.00 天量」：那個負號是四捨五入的殘渣，
   * 看起來卻像有方向的資訊，而且整串像壞掉。
   */
  it('小到看不出來的量寫成約 0，不印出 -0.00', () => {
    expect(strengthText(0)).toBe('約 0 天量');
    expect(strengthText(-0.0001)).toBe('約 0 天量');
    expect(strengthText(0.004)).toBe('約 0 天量');
    expect(strengthText(-0.006)).toBe('-0.01 天量');
  });

  it('研究頁與 Profile 的門檻用同一個單位，不會兩處各講各的', () => {
    expect(METRIC_UNIT.foreignStrength).toBe(' 天量');
    expect(METRIC_UNIT.trustStrength).toBe(' 天量');
  });
});

describe('最近方向的寫法', () => {
  /*
   * 只有一天卻寫「連買 1 日」，會與同一行的 5 日淨額互相打架：
   * 「-18709 張（連買 1 日）」看起來像自相矛盾，其實是兩個不同期間。
   */
  it('只有一天時直說是最新一日，不寫成連買一日', () => {
    expect(continuityText({ direction: 'buy', days: 1 })).toBe('最新一日 買超');
    expect(continuityText({ direction: 'sell', days: 1 })).toBe('最新一日 賣超');
  });

  it('兩天以上才叫連續', () => {
    expect(continuityText({ direction: 'buy', days: 5 })).toBe('連買 5 日');
    expect(continuityText({ direction: 'sell', days: 2 })).toBe('連賣 2 日');
  });

  it('持平時明說最新一日持平，不留白', () => {
    expect(continuityText({ direction: 'flat', days: 0 })).toBe('最新一日 持平');
  });
});

describe('張數', () => {
  it('股轉張並帶正負號', () => {
    expect(lots(-18_709_000)).toBe('-18709 張');
    expect(lots(10_507_000)).toBe('+10507 張');
  });
});
