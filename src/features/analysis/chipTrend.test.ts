import { describe, expect, it } from 'vitest';
import { recentTradingDays } from './chipTrend';

function series(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    net: index,
  }));
}

describe('完整分析的籌碼趨勢', () => {
  it('只保留最近 20 個交易日，並維持由舊到新的順序', () => {
    const visible = recentTradingDays(series(25));

    expect(visible).toHaveLength(20);
    expect(visible[0]?.date).toBe('2026-01-06');
    expect(visible.at(-1)?.date).toBe('2026-01-25');
  });

  it('資料少於 20 日時不補值也不改變資料', () => {
    const original = series(5);

    expect(recentTradingDays(original)).toEqual(original);
  });
});
