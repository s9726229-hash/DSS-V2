import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TechnicalTrendChart } from './TechnicalTrendChart';

describe('完整分析的價格走勢圖', () => {
  it('只呈現二十日收盤與月線，將籌碼走勢保留給獨立區塊', () => {
    render(
      <TechnicalTrendChart
        series={{
          drawable: true,
          min: 90,
          max: 110,
          points: Array.from({ length: 20 }, (_, index) => ({
            date: `2026-07-${String(index + 1).padStart(2, '0')}`,
            close: 100 + index,
            ma20: 102,
          })),
        }}
      />,
    );

    expect(screen.getByRole('img', { name: '近 20 個交易日收盤與月線趨勢' })).toBeInTheDocument();
    expect(screen.getByText('月線（MA20）')).toBeInTheDocument();
    expect(screen.queryByText('20 日均量')).not.toBeInTheDocument();
  });

  /*
   * 月線前段沒有值時，不能把有值的那幾天拉開撐滿整張圖——那會讓使用者以為
   * 二十天都算得出月線。空白的日子留白，與收盤線用同一組 X 座標。
   */
  it('月線只畫在算得出來的那幾天，X 座標與收盤線對齊', () => {
    const { container } = render(
      <TechnicalTrendChart
        series={{
          drawable: true,
          min: 90,
          max: 110,
          points: Array.from({ length: 20 }, (_, index) => ({
            date: `2026-07-${String(index + 1).padStart(2, '0')}`,
            close: 100 + index,
            // 只有 25 天收盤時，最後二十日裡只有第 15 天起算得出 MA20
            ma20: index >= 14 ? 101 + index : null,
          })),
        }}
      />,
    );

    const close = container.querySelector('.technical-trend__close')?.getAttribute('d') ?? '';
    const ma = container.querySelector('.technical-trend__ma')?.getAttribute('d') ?? '';

    // 20 點的間距為 360 / 19；第 15 個點（index 14）落在 265.26
    expect(close.startsWith('M0.00,')).toBe(true);
    expect(ma.startsWith('M265.26,')).toBe(true);
    expect(ma.split(',').length - 1).toBe(6);
  });

  /*
   * 價格是小數，不能沿用籌碼圖「至少一單位」的防呆：十幾塊錢的股票整個月
   * 常常波動不到一元，被硬拉成一元就會壓成一條貼底的平線。
   */
  it('低價股的小幅波動仍撐滿圖高', () => {
    const { container } = render(
      <TechnicalTrendChart
        series={{
          drawable: true,
          min: 9.5,
          max: 9.95,
          points: Array.from({ length: 20 }, (_, index) => ({
            date: `2026-07-${String(index + 1).padStart(2, '0')}`,
            close: 9.5 + (index * 0.45) / 19,
            ma20: null,
          })),
        }}
      />,
    );

    const close = container.querySelector('.technical-trend__close')?.getAttribute('d') ?? '';

    expect(close.startsWith('M0.00,116.00')).toBe(true);
    expect(close.endsWith(',0.00')).toBe(true);
  });
});
