import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { importHoldingsSnapshot, importTransactions } from '../storage/portfolio';
import { AppShell } from './AppShell';

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('AppShell', () => {
  it('顯示五個主頁導覽', () => {
    render(<AppShell />);

    const nav = screen.getByRole('navigation');
    for (const label of ['今日 DSS', '歷史交易研究', 'Profile', '資料中心', '設定']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  // 今日 DSS 要先讀庫存與 Profile 才畫得出卡片，因此標題是非同步出現的
  it('預設顯示今日 DSS', async () => {
    render(<AppShell />);

    expect(
      await screen.findByRole('heading', { level: 1, name: '今日 DSS' }),
    ).toBeInTheDocument();
  });

  it('沒有庫存時，今日 DSS 指引使用者先去匯入', async () => {
    render(<AppShell />);

    expect(await screen.findByText(/尚未匯入庫存/)).toBeInTheDocument();
  });

  it('點擊導覽可切換到資料中心', async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole('button', { name: '資料中心' }));

    expect(screen.getByRole('heading', { level: 1, name: '資料中心' })).toBeInTheDocument();
  });

  it('標示目前所在頁面供輔助技術辨識', async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole('button', { name: '資料中心' }));

    expect(screen.getByRole('button', { name: '資料中心' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('尚未同步市場資料時，狀態列明確顯示未就緒而非空白', async () => {
    render(<AppShell />);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('市場資料');
    expect(status).toHaveTextContent('未就緒');
  });

  it('沒有庫存時同步按鈕停用，並說明原因', async () => {
    render(<AppShell />);

    const button = await screen.findByRole('button', { name: '同步市場資料' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('title', expect.stringContaining('不會發出網路請求'));
  });

  it('有庫存時同步按鈕可按，且按下後會發出請求', async () => {
    await importHoldingsSnapshot(
      [
        {
          stockId: '0050',
          stockName: '元大台灣50',
          tradeType: '現股',
          quantity: 1000,
          costPrice: 100,
          currentPrice: 105,
        },
      ],
      '2026-07-28',
      '2026-07-28T02:00:00.000Z',
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ msg: 'success', status: 200, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AppShell />);

    const button = await screen.findByRole('button', { name: '同步市場資料' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 檔已更新');
    });
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('有交易資料時狀態列顯示交易涵蓋的最後日期', async () => {
    await importTransactions(
      [
        {
          tradeDate: '2026-07-22',
          stockId: '2330',
          stockName: '台積電',
          side: 'buy',
          tradeType: '現股',
          quantity: 1000,
          price: 1100,
          fees: 1567,
          tax: 0,
          settlementDate: '2026-07-24',
          brokerReference: 'X00000001',
        },
      ],
      '2026-07-27T12:00:00.000Z',
    );

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2026-07-22');
    });
  });
});
