import { describe, expect, it } from 'vitest';
import type { MarginRow } from '../market/types';
import { computeFlow } from './flow';
import { marginDailyChange, MARGIN_FLOW_THRESHOLDS } from './margin';

function row(date: string, today: number, yesterday: number): MarginRow {
  return {
    date,
    stock_id: '2330',
    MarginPurchaseTodayBalance: today,
    MarginPurchaseYesterdayBalance: yesterday,
  };
}

describe('融資餘額轉每日增減', () => {
  /*
   * 融資給的是餘額不是流量。實測台積電 2026-07-20：
   * 餘額 32548、前日 33373，差 -825；用 買進 931 − 賣出 1667 − 現償 89 也是 -825。
   */
  it('用今日餘額減前日餘額', () => {
    const daily = marginDailyChange([row('2026-07-20', 32_548, 33_373)]);

    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe('2026-07-20');
  });

  /*
   * FinMind 的融資是張、法人是股，差一千倍且不會有任何錯誤訊息。
   * 兩者要餵進同一支 computeFlow，因此在這裡就換算成股。
   */
  it('換算成股，與法人序列同一個單位', () => {
    const daily = marginDailyChange([row('2026-07-20', 32_548, 33_373)]);

    expect(daily[0].net).toBe(-825 * 1000);
  });

  it('由舊到新排序，與法人序列的方向一致', () => {
    const daily = marginDailyChange([
      row('2026-07-22', 30, 20),
      row('2026-07-20', 20, 10),
      row('2026-07-21', 25, 20),
    ]);

    expect(daily.map((day) => day.date)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
  });

  it('欄位缺漏導致算不出差值時整天略過，不以 0 代替', () => {
    const broken = { date: '2026-07-20', stock_id: '2330' } as unknown as MarginRow;

    expect(marginDailyChange([broken])).toEqual([]);
  });
});

describe('融資的中性門檻', () => {
  /*
   * 實測庫存的融資日變化中位數只有幾百張，最小的不到 100 張。
   * 沿用法人的 500 張會把大多數日子講成中性，等於這個指標沒有作用。
   */
  it('比法人寬鬆，否則小額變化全部變成中性', () => {
    expect(MARGIN_FLOW_THRESHOLDS.neutralFloor).toBeLessThan(500 * 1000);
  });

  it('法人門檻會誤判的融資變化，用融資門檻判得出方向', () => {
    const daily = marginDailyChange([
      row('2026-07-24', 1_100, 1_000),
      row('2026-07-25', 1_200, 1_100),
      row('2026-07-28', 1_300, 1_200),
      row('2026-07-29', 1_400, 1_300),
      row('2026-07-30', 1_500, 1_400),
      // 今日增加 200 張：法人門檻（500 張）會說中性，融資門檻（50 張）看得出是增加
      row('2026-07-31', 1_700, 1_500),
    ]);

    expect(computeFlow(daily)?.todayDirection).toBe('neutral');
    expect(computeFlow(daily, MARGIN_FLOW_THRESHOLDS)?.todayDirection).toBe('buy');
    expect(computeFlow(daily, MARGIN_FLOW_THRESHOLDS)?.change).toBe('buy-up');
  });
});
