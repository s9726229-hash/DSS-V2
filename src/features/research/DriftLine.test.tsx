import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DriftLine } from './DriftLine';

describe('門檻漂移', () => {
  it('顯示各檢查點門檻的最小、最大與幅度', () => {
    render(
      <DriftLine
        drift={{
          p25: { low: -1.11, high: 5.42, span: 6.53 },
          p75: { low: 8.2, high: 9.05, span: 0.85 },
        }}
        unit="%"
      />,
    );

    expect(screen.getByText(/P25 -1\.11 ～ \+5\.42（幅度 6\.53%）/)).toBeInTheDocument();
    expect(screen.getByText(/P75 \+8\.20 ～ \+9\.05（幅度 0\.85%）/)).toBeInTheDocument();
  });

  it('無單位的指標不加上百分比符號', () => {
    render(<DriftLine drift={{ p25: { low: 0.1, high: 0.4, span: 0.3 }, p75: null }} unit="" />);

    expect(screen.getByText(/P25 \+0\.10 ～ \+0\.40（幅度 0\.30）/)).toBeInTheDocument();
  });

  it('檢查點不足以判斷漂移時不顯示任何內容', () => {
    const { container } = render(<DriftLine drift={{ p25: null, p75: null }} unit="%" />);

    expect(container).toBeEmptyDOMElement();
  });
});
