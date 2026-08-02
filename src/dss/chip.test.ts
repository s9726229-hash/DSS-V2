import { describe, expect, it } from 'vitest';
import { CHIP_WINDOW_DAYS, computeChipSnapshot } from './chip';
import type { InstitutionalRow, PriceRow } from '../market/types';

const DATES = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'];

function volume(dates: string[], each = 1_000_000): PriceRow[] {
  return dates.map((date) => ({
    date,
    stock_id: '2330',
    open: 100,
    max: 100,
    min: 100,
    close: 100,
    Trading_Volume: each,
  }));
}

/** 為指定身分產生每日淨買賣超（正數為買超）。 */
function rows(name: string, netByDate: Record<string, number>): InstitutionalRow[] {
  return Object.entries(netByDate).map(([date, net]) => ({
    date,
    stock_id: '2330',
    name,
    buy: net > 0 ? net : 0,
    sell: net < 0 ? -net : 0,
  }));
}

function evenly(dates: string[], net: number): Record<string, number> {
  return Object.fromEntries(dates.map((date) => [date, net]));
}

describe('資料完整性', () => {
  it('法人資料不足五個交易日時標示為未就緒，不顯示中性', () => {
    const short = DATES.slice(0, 4);
    const result = computeChipSnapshot({
      institutional: [...rows('Foreign_Investor', evenly(short, 100)), ...rows('Investment_Trust', evenly(short, 100))],
      prices: volume(short),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-institutional-data');
    expect(result.lastAvailableDate).toBe('2026-07-17');
  });

  it('完全沒有法人資料時回報未就緒且無可用日期', () => {
    const result = computeChipSnapshot({ institutional: [], prices: volume(DATES) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.lastAvailableDate).toBeNull();
  });

  it('只有其中一方滿五日仍視為未就緒', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, 100)),
        ...rows('Investment_Trust', evenly(DATES.slice(0, 3), 100)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(false);
  });

  it('沒有對應成交量的法人日期不列入計算', () => {
    // 法人有五日，但價格只有四日可對應
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, 100)),
        ...rows('Investment_Trust', evenly(DATES, 100)),
      ],
      prices: volume(DATES.slice(0, 4)),
    });

    expect(result.ok).toBe(false);
  });
});

describe('外資與投信分別計算', () => {
  const base = {
    institutional: [
      ...rows('Foreign_Investor', evenly(DATES, 200_000)),
      ...rows('Investment_Trust', evenly(DATES, -50_000)),
    ],
    prices: volume(DATES),
  };

  it('各自計算五日淨買賣超', () => {
    const result = computeChipSnapshot(base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.fiveDayNet).toBe(1_000_000);
    expect(result.snapshot.trust.fiveDayNet).toBe(-250_000);
  });

  it('以五日平均成交量正規化為強度', () => {
    const result = computeChipSnapshot(base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.averageVolume).toBe(1_000_000);
    expect(result.snapshot.foreign.strength).toBeCloseTo(1, 6);
    expect(result.snapshot.trust.strength).toBeCloseTo(-0.25, 6);
  });

  it('外資自營商不併入外資', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, 100_000)),
        ...rows('Foreign_Dealer_Self', evenly(DATES, 900_000)),
        ...rows('Investment_Trust', evenly(DATES, 0)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.fiveDayNet).toBe(500_000);
  });

  it('自營商不影響投信', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, 0)),
        ...rows('Investment_Trust', evenly(DATES, 10_000)),
        ...rows('Dealer_self', evenly(DATES, 990_000)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.trust.fiveDayNet).toBe(50_000);
  });

  it('只取最近五個交易日', () => {
    const dates = ['2026-07-01', '2026-07-02', ...DATES];
    const net: Record<string, number> = { ...evenly(DATES, 100), '2026-07-01': 999_999, '2026-07-02': 999_999 };

    const result = computeChipSnapshot({
      institutional: [...rows('Foreign_Investor', net), ...rows('Investment_Trust', net)],
      prices: volume(dates),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.fiveDayNet).toBe(500);
    expect(result.snapshot.lastDate).toBe('2026-07-18');
  });
});

describe('連續性', () => {
  it('計算同方向連續天數與最後一日是否延續', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', {
          '2026-07-14': -100,
          '2026-07-15': 100,
          '2026-07-16': 100,
          '2026-07-17': 100,
          '2026-07-18': 100,
        }),
        ...rows('Investment_Trust', evenly(DATES, 100)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.continuity).toEqual({ direction: 'buy', days: 4 });
  });

  it('連續賣超以 sell 方向表示', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, -100)),
        ...rows('Investment_Trust', evenly(DATES, 100)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.continuity).toEqual({ direction: 'sell', days: 5 });
  });

  it('最後一日持平時連續天數為零', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', { ...evenly(DATES.slice(0, 4), 100), '2026-07-18': 0 }),
        ...rows('Investment_Trust', evenly(DATES, 100)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.continuity).toEqual({ direction: 'flat', days: 0 });
  });
});

describe('逐日淨額', () => {
  /*
   * 5 日合計分不出「連續買五天」與「賣四天最後一天翻多」，
   * 畫面要畫得出那個差別就必須拿得到逐日資料。
   */
  it('保留納入計算的五個交易日，由舊到新', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', {
          '2026-07-14': -100,
          '2026-07-15': -100,
          '2026-07-16': -100,
          '2026-07-17': -100,
          '2026-07-18': 300,
        }),
        ...rows('Investment_Trust', evenly(DATES, 100)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.foreign.daily.map((day) => day.date)).toEqual(DATES);
    expect(result.snapshot.foreign.daily.map((day) => day.net)).toEqual([
      -100, -100, -100, -100, 300,
    ]);
    // 合計是 -100，方向卻是最後一日翻買：兩件事必須都看得到
    expect(result.snapshot.foreign.fiveDayNet).toBe(-100);
    expect(result.snapshot.foreign.continuity).toEqual({ direction: 'buy', days: 1 });
  });

  it('只收有對應成交量的交易日，與強度用的期間一致', () => {
    const extra = ['2026-07-10', ...DATES];
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(extra, 100)),
        ...rows('Investment_Trust', evenly(extra, 100)),
      ],
      // 2026-07-10 沒有價格資料
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.foreign.daily.map((day) => day.date)).toEqual(DATES);
  });
});

describe('聯合狀態', () => {
  function joint(foreignNet: number, trustNet: number) {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, foreignNet)),
        ...rows('Investment_Trust', evenly(DATES, trustNet)),
      ],
      prices: volume(DATES),
    });
    if (!result.ok) throw new Error('expected ok');
    return result.snapshot.joint;
  }

  it('兩者同為買超時為同買', () => {
    expect(joint(200_000, 200_000)).toBe('both-accumulating');
  });

  it('兩者同為賣超時為同賣', () => {
    expect(joint(-200_000, -200_000)).toBe('both-distributing');
  });

  it('方向相反時為分歧', () => {
    expect(joint(200_000, -200_000)).toBe('divergent');
  });

  it('任一方持平時為無共識', () => {
    expect(joint(200_000, 0)).toBe('no-consensus');
  });

  it('聯合狀態只是顯示，不產生任何綜合評分', () => {
    const result = computeChipSnapshot({
      institutional: [
        ...rows('Foreign_Investor', evenly(DATES, 200_000)),
        ...rows('Investment_Trust', evenly(DATES, 200_000)),
      ],
      prices: volume(DATES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).not.toHaveProperty('score');
    expect(result.snapshot).not.toHaveProperty('total');
  });
});

describe('常數', () => {
  it('觀察窗為五個交易日', () => {
    expect(CHIP_WINDOW_DAYS).toBe(5);
  });
});
