import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { importTransactions } from '../storage/portfolio';
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

  it('預設顯示今日 DSS', () => {
    render(<AppShell />);

    expect(screen.getByRole('heading', { level: 1, name: '今日 DSS' })).toBeInTheDocument();
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
    expect(status).toHaveTextContent('價格資料');
    expect(status).toHaveTextContent('法人資料');
    expect(status).toHaveTextContent('未就緒');
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
