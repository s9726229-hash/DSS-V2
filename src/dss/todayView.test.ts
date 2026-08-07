import { describe, expect, it } from 'vitest';
import { resolveTodayScenario } from './todayView';

const reliable = { shares: 1000, averageCost: 100, costReliable: true, everHeld: true };

describe('Today 情境', () => {
  it('可靠現股持有中使用加碼', () => {
    expect(resolveTodayScenario({ hasHolding: true, status: 'reliable', state: reliable })).toBe('add-on');
  });
  it('從未持有的觀察股使用建立部位', () => {
    expect(resolveTodayScenario({ hasHolding: false, status: undefined, state: undefined })).toBe('establish');
  });
  it('已完整出場的觀察股使用再進場', () => {
    expect(resolveTodayScenario({ hasHolding: false, status: 'reliable', state: { ...reliable, shares: 0, averageCost: null } })).toBe('reentry');
  });
  it('同時在庫存與觀察仍以加碼為準', () => {
    expect(resolveTodayScenario({ hasHolding: true, status: 'reliable', state: reliable })).toBe('add-on');
  });
  it('期初部位不明不套用 Profile', () => {
    expect(resolveTodayScenario({ hasHolding: true, status: 'opening-unknown', state: reliable })).toBeNull();
  });
});
