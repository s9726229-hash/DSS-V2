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
});
