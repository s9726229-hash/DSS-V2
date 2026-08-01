import { describe, expect, it } from 'vitest';
import {
  applyCandidate,
  boundaryConflict,
  clearBoundary,
  emptyProfile,
  hasUnverifiedBoundary,
  readEntry,
  setManualBoundary,
  type Profile,
} from './profile';

const AT = '2026-08-02T00:00:00.000Z';

function withCandidate(): Profile {
  return applyCandidate(emptyProfile(), {
    assetClass: 'stock',
    metric: 'bias20',
    band: 'normal',
    range: { min: -1.5, max: 15.78 },
    runId: 'run:test',
    evidence: 'worth-tracking',
    despiteWeakEvidence: false,
    at: '2026-08-01T00:00:00.000Z',
  });
}

describe('手動調整門檻', () => {
  it('手動寫入的邊界標為自訂，且不掛任何來源批次與證據等級', () => {
    const profile = setManualBoundary(emptyProfile(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
      value: -3,
      at: AT,
    });

    expect(readEntry(profile, 'stock', 'bias20').lower).toEqual({
      value: -3,
      origin: 'manual',
      sourceRunId: null,
      sourceEvidence: null,
      appliedDespiteWeakEvidence: false,
      updatedAt: AT,
    });
  });

  /** 手動改過就不再是那批研究的結論，來源必須斷開，否則畫面會謊稱它有驗證。 */
  it('改寫候選來的邊界會清掉原本的來源與證據', () => {
    const profile = setManualBoundary(withCandidate(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'upper',
      value: 20,
      at: AT,
    });
    const entry = readEntry(profile, 'stock', 'bias20');

    expect(entry.upper).toMatchObject({ value: 20, origin: 'manual', sourceRunId: null });
    // 沒被碰到的那一端維持原本的候選來源
    expect(entry.lower).toMatchObject({ origin: 'candidate', sourceRunId: 'run:test' });
  });

  it('清除邊界後回到未設定', () => {
    const profile = clearBoundary(withCandidate(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
    });
    const entry = readEntry(profile, 'stock', 'bias20');

    expect(entry.lower).toBeNull();
    expect(entry.upper?.value).toBe(15.78);
  });

  it('清除不存在的邊界不會出錯', () => {
    expect(() =>
      clearBoundary(emptyProfile(), { assetClass: 'etf', metric: 'trustStrength', side: 'upper' }),
    ).not.toThrow();
  });

  it('不修改原本的 Profile', () => {
    const before = withCandidate();
    setManualBoundary(before, {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
      value: -99,
      at: AT,
    });

    expect(readEntry(before, 'stock', 'bias20').lower?.value).toBe(-1.5);
  });

  it('個股與 ETF、各指標互不影響', () => {
    const profile = setManualBoundary(withCandidate(), {
      assetClass: 'etf',
      metric: 'foreignStrength',
      side: 'lower',
      value: 0.1,
      at: AT,
    });

    expect(readEntry(profile, 'stock', 'bias20').lower?.value).toBe(-1.5);
    expect(readEntry(profile, 'etf', 'foreignStrength').lower?.value).toBe(0.1);
  });
});

describe('門檻衝突', () => {
  it('下界高於上界時判為衝突', () => {
    const profile = setManualBoundary(withCandidate(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
      value: 20,
      at: AT,
    });

    expect(boundaryConflict(readEntry(profile, 'stock', 'bias20'))).toBe(true);
  });

  /** 兩端相等時三個區間退化成兩個，中間區永遠空著，等同於沒有定義。 */
  it('下界等於上界也是衝突', () => {
    const profile = setManualBoundary(withCandidate(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
      value: 15.78,
      at: AT,
    });

    expect(boundaryConflict(readEntry(profile, 'stock', 'bias20'))).toBe(true);
  });

  it('正常順序不算衝突', () => {
    expect(boundaryConflict(readEntry(withCandidate(), 'stock', 'bias20'))).toBe(false);
  });

  it('只設一端時無從衝突', () => {
    const onlyLower = setManualBoundary(emptyProfile(), {
      assetClass: 'stock',
      metric: 'bias20',
      side: 'lower',
      value: 5,
      at: AT,
    });

    expect(boundaryConflict(readEntry(onlyLower, 'stock', 'bias20'))).toBe(false);
    expect(boundaryConflict(readEntry(emptyProfile(), 'stock', 'bias20'))).toBe(false);
  });
});

describe('未驗證標示', () => {
  it('全部來自候選時沒有未驗證門檻', () => {
    expect(hasUnverifiedBoundary(withCandidate())).toBe(false);
  });

  it('只要有一個手動邊界就算含未驗證門檻', () => {
    const profile = setManualBoundary(withCandidate(), {
      assetClass: 'etf',
      metric: 'trustStrength',
      side: 'upper',
      value: 1,
      at: AT,
    });

    expect(hasUnverifiedBoundary(profile)).toBe(true);
  });

  it('空的 Profile 不算含未驗證門檻', () => {
    expect(hasUnverifiedBoundary(emptyProfile())).toBe(false);
  });
});
