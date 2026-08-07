import { describe, expect, it } from 'vitest';
import { applyCandidate, applyScenarioCandidate, classifyByProfile, clearScenarioBoundary, emptyProfile, isScenarioProfileEmpty, readEntry, readScenarioEntry, setScenarioManualBoundary } from './profile';

const AT = '2026-08-01T00:00:00.000Z';

function candidate(overrides: Partial<Parameters<typeof applyCandidate>[1]> = {}) {
  return {
    assetClass: 'stock' as const,
    metric: 'bias20' as const,
    band: 'pullback' as const,
    range: { min: null, max: -1.5 } as { min: number | null; max: number | null },
    runId: 'run:2026-08-01T00:00:00.000Z',
    evidence: 'worth-tracking' as const,
    despiteWeakEvidence: false,
    at: AT,
    ...overrides,
  };
}

describe('候選套用', () => {
  it('情境寫入不會改變 V1 通用 entries 或另一情境', () => {
    const next = applyScenarioCandidate(emptyProfile(), {
      ...candidate({ metric: 'bias20', band: 'normal', range: { min: -8, max: 3 } }),
      scenario: 'add-on',
      metric: 'relativeCost',
    });
    expect(readScenarioEntry(next, 'add-on', 'stock', 'relativeCost')).toMatchObject({
      lower: { value: -8 }, upper: { value: 3 },
    });
    expect(readScenarioEntry(next, 'establish', 'stock', 'relativeCost')).toEqual({ lower: null, upper: null });
    expect(next.entries).toEqual({});
  });
  it('加碼候選不會寫入既有通用 Profile', () => {
    const profile = applyScenarioCandidate(emptyProfile(), { ...candidate(), scenario: 'add-on' });

    expect(readEntry(profile, 'stock', 'bias20').lower).toBeNull();
    expect(readScenarioEntry(profile, 'add-on', 'stock', 'bias20').lower?.value).toBe(-1.5);
  });
  it('回檔下界寫入下界，來源與證據等級一併保留', () => {
    const profile = applyCandidate(emptyProfile(), candidate());
    const entry = readEntry(profile, 'stock', 'bias20');

    expect(entry.lower).toMatchObject({
      value: -1.5,
      origin: 'candidate',
      sourceRunId: 'run:2026-08-01T00:00:00.000Z',
      sourceEvidence: 'worth-tracking',
      appliedDespiteWeakEvidence: false,
      updatedAt: AT,
    });
    expect(entry.upper).toBeNull();
  });

  it('偏熱上界寫入上界', () => {
    const profile = applyCandidate(
      emptyProfile(),
      candidate({ band: 'overheated', range: { min: 15.78, max: null } }),
    );
    const entry = readEntry(profile, 'stock', 'bias20');

    expect(entry.upper?.value).toBe(15.78);
    expect(entry.lower).toBeNull();
  });

  /** 合理區本來就是兩端夾出來的，套用它等於同時接受這兩個數字。 */
  it('合理區同時寫入上下界', () => {
    const profile = applyCandidate(
      emptyProfile(),
      candidate({ band: 'normal', range: { min: -1.5, max: 15.78 } }),
    );
    const entry = readEntry(profile, 'stock', 'bias20');

    expect(entry.lower?.value).toBe(-1.5);
    expect(entry.upper?.value).toBe(15.78);
  });

  it('證據不足仍套用會留下永久標記', () => {
    const profile = applyCandidate(
      emptyProfile(),
      candidate({ evidence: 'insufficient-evidence', despiteWeakEvidence: true }),
    );

    expect(readEntry(profile, 'stock', 'bias20').lower).toMatchObject({
      sourceEvidence: 'insufficient-evidence',
      appliedDespiteWeakEvidence: true,
    });
  });

  it('個股與 ETF 互不影響', () => {
    const profile = applyCandidate(
      applyCandidate(emptyProfile(), candidate()),
      candidate({ assetClass: 'etf', range: { min: null, max: -8 } }),
    );

    expect(readEntry(profile, 'stock', 'bias20').lower?.value).toBe(-1.5);
    expect(readEntry(profile, 'etf', 'bias20').lower?.value).toBe(-8);
  });

  it('三個指標各自獨立', () => {
    const profile = applyCandidate(
      applyCandidate(emptyProfile(), candidate()),
      candidate({ metric: 'foreignFlow', range: { min: null, max: 0.2 } }),
    );

    expect(readEntry(profile, 'stock', 'bias20').lower?.value).toBe(-1.5);
    expect(readEntry(profile, 'stock', 'foreignFlow').lower?.value).toBe(0.2);
  });

  it('再次套用同一個邊界會覆蓋，並換上新的來源批次', () => {
    const first = applyCandidate(emptyProfile(), candidate());
    const second = applyCandidate(
      first,
      candidate({ range: { min: null, max: -2.2 }, runId: 'run:later', at: '2026-08-02T00:00:00.000Z' }),
    );
    const entry = readEntry(second, 'stock', 'bias20');

    expect(entry.lower).toMatchObject({
      value: -2.2,
      sourceRunId: 'run:later',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('沒有可用門檻的區間不能套用', () => {
    expect(() =>
      applyCandidate(emptyProfile(), candidate({ range: { min: null, max: null } })),
    ).toThrow();
  });

  it('不修改原本的 Profile', () => {
    const before = emptyProfile();
    applyCandidate(before, candidate());

    expect(readEntry(before, 'stock', 'bias20').lower).toBeNull();
  });
});

describe('情境手動門檻', () => {
  it('可設定、清除且不影響其他情境', () => {
    const set = setScenarioManualBoundary(emptyProfile(), {
      scenario: 'add-on', assetClass: 'stock', metric: 'relativeCost', side: 'lower',
      value: -5, at: AT,
    });
    expect(readScenarioEntry(set, 'add-on', 'stock', 'relativeCost').lower).toMatchObject({ value: -5, origin: 'manual' });
    expect(isScenarioProfileEmpty(set, 'add-on')).toBe(false);
    expect(isScenarioProfileEmpty(set, 'establish')).toBe(true);
    const cleared = clearScenarioBoundary(set, {
      scenario: 'add-on', assetClass: 'stock', metric: 'relativeCost', side: 'lower',
    });
    expect(isScenarioProfileEmpty(cleared, 'add-on')).toBe(true);
  });
});

describe('依 Profile 分類', () => {
  const both = applyCandidate(
    emptyProfile(),
    candidate({ band: 'normal', range: { min: -1.5, max: 15.78 } }),
  );

  it('低於等於下界是回檔側', () => {
    expect(classifyByProfile(-2, readEntry(both, 'stock', 'bias20'))).toBe('pullback');
    expect(classifyByProfile(-1.5, readEntry(both, 'stock', 'bias20'))).toBe('pullback');
  });

  it('高於等於上界是偏熱側', () => {
    expect(classifyByProfile(20, readEntry(both, 'stock', 'bias20'))).toBe('overheated');
    expect(classifyByProfile(15.78, readEntry(both, 'stock', 'bias20'))).toBe('overheated');
  });

  it('兩者之間是中間區', () => {
    expect(classifyByProfile(5, readEntry(both, 'stock', 'bias20'))).toBe('normal');
  });

  /**
   * 只有一端時不能宣稱「合理」——不知道另一端在哪，就不知道它算不算合理。
   * 寧可回未分類，也不要給一個沒有依據的分類。
   */
  it('只有下界時，超過下界的值仍是未分類', () => {
    const lowerOnly = readEntry(applyCandidate(emptyProfile(), candidate()), 'stock', 'bias20');

    expect(classifyByProfile(-2, lowerOnly)).toBe('pullback');
    expect(classifyByProfile(5, lowerOnly)).toBeNull();
  });

  it('只有上界時，低於上界的值仍是未分類', () => {
    const upperOnly = readEntry(
      applyCandidate(emptyProfile(), candidate({ band: 'overheated', range: { min: 15.78, max: null } })),
      'stock',
      'bias20',
    );

    expect(classifyByProfile(20, upperOnly)).toBe('overheated');
    expect(classifyByProfile(5, upperOnly)).toBeNull();
  });

  it('尚未設定任何門檻時一律未分類', () => {
    expect(classifyByProfile(5, readEntry(emptyProfile(), 'stock', 'bias20'))).toBeNull();
  });

  it('指標值為 null 時未分類', () => {
    expect(classifyByProfile(null, readEntry(both, 'stock', 'bias20'))).toBeNull();
  });
});
