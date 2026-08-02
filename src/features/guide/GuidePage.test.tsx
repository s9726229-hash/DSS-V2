import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuidePage } from './GuidePage';

describe('系統怎麼算', () => {
  it('先說明今天的卡片如何產生，再顯示技術名詞', () => {
    render(<GuidePage />);

    expect(screen.getByRole('heading', { name: '今天的卡片怎麼來' })).toBeInTheDocument();
    expect(screen.getByText('有庫存？')).toBeInTheDocument();
  });

  it('集中說明歷史研究流程', () => {
    render(<GuidePage />);

    expect(screen.getByRole('heading', { name: '歷史研究怎麼來' })).toBeInTheDocument();
    expect(screen.getByText('建立部位辨識')).toBeInTheDocument();
  });

  it('清楚列出系統不做的事', () => {
    render(<GuidePage />);

    expect(screen.getByRole('heading', { name: '系統不做什麼' })).toBeInTheDocument();
    expect(screen.getByText(/不產生自動交易指令/)).toBeInTheDocument();
  });

  it('列出三條均線的台股慣稱', () => {
    render(<GuidePage />);

    expect(screen.getByText('MA5（週線）')).toBeInTheDocument();
    expect(screen.getByText('MA20（月線）')).toBeInTheDocument();
    expect(screen.getByText('MA60（季線）')).toBeInTheDocument();
  });

  it('說明 Bias20 的計算方式', () => {
    render(<GuidePage />);

    expect(screen.getByText(/（收盤 − MA20）÷ MA20 × 100%/)).toBeInTheDocument();
  });

  it('說明外資自營商不併入外資', () => {
    render(<GuidePage />);

    const chip = screen.getByRole('region', { name: '籌碼面', hidden: true });
    expect(within(chip).getByText(/外資自營商是獨立身分，不併入外資計算/)).toBeInTheDocument();
  });

  it('風險提醒明確標示不是賣出指令', () => {
    render(<GuidePage />);

    expect(screen.getByText(/不是賣出指令/)).toBeInTheDocument();
  });

  it('聯合狀態明確標示不形成評分也不覆寫技術面', () => {
    render(<GuidePage />);

    expect(screen.getByText(/不形成綜合評分，也不覆寫技術面結果/)).toBeInTheDocument();
  });

  it('列出本系統明確不做的事', () => {
    render(<GuidePage />);

    const nots = screen.getByRole('region', { name: '系統不做什麼' });
    expect(within(nots).getByText(/不把技術面與籌碼面合併成單一分數/)).toBeInTheDocument();
    expect(within(nots).getByText(/不因單一均線穿越顯示買進或賣出/)).toBeInTheDocument();
    expect(within(nots).getByText(/最終買賣由你判斷/)).toBeInTheDocument();
  });

  it('說明價格已還原及其影響', () => {
    render(<GuidePage />);

    expect(screen.getByText('價格已還原')).toBeInTheDocument();
    expect(screen.getByText(/資產並未減少/)).toBeInTheDocument();
    expect(screen.getByText(/與券商對帳單的成交價不會逐筆相同/)).toBeInTheDocument();
  });

  it('說明資料不足時寧可不判斷', () => {
    render(<GuidePage />);

    expect(screen.getByText(/寧可顯示「資料不足」/)).toBeInTheDocument();
  });
});
