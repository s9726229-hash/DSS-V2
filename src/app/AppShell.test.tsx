import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../storage/database';
import { importHoldingsSnapshot, importTransactions } from '../storage/portfolio';
import { addWatch, emptyWatchlist } from '../watchlist/watchlist';
import { writeWatchlist } from '../watchlist/watchlistStore';
import { AppShell } from './AppShell';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 技術面至少要 60 筆才會有結果，籌碼面則要 5 個有對應價格的交易日。 */
function marketRows(): { prices: unknown[]; chips: unknown[] } {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 4, 1) + index * DAY_MS).toISOString().slice(0, 10),
  );

  return {
    prices: dates.map((date) => ({
      date,
      stock_id: '2330',
      open: 100,
      max: 101,
      min: 99,
      close: 100,
      Trading_Volume: 1000,
    })),
    chips: dates.slice(-5).flatMap((date) => [
      { date, stock_id: '2330', name: 'Foreign_Investor', buy: 200, sell: 100 },
      { date, stock_id: '2330', name: 'Investment_Trust', buy: 150, sell: 100 },
    ]),
  };
}

/** 依 dataset 回應對應內容，模擬 Worker。 */
function marketResponse(input: string): Response {
  const dataset = new URL(String(input)).searchParams.get('dataset');
  const { prices, chips } = marketRows();
  const data =
    dataset === 'TaiwanStockPrice'
      ? prices
      : dataset === 'TaiwanStockInstitutionalInvestorsBuySell'
        ? chips
        : dataset === 'TaiwanStockInfo'
          ? [{ stock_id: '2330', stock_name: '台積電', industry_category: '半導體業', type: 'twse' }]
          : [];

  return new Response(JSON.stringify({ msg: 'success', status: 200, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  /*
   * 狀態列與今日 DSS 各自持有狀態，兩邊沒有互通時會出現同一種災情：
   * 使用者按了同步卻「沒有數據」。以下兩條分別鎖住兩個方向的傳遞。
   */
  it('剛加入觀察標的後，不必重新整理就能同步', async () => {
    render(<AppShell />);

    const syncButton = await screen.findByRole('button', { name: '同步市場資料' });
    await waitFor(() => expect(syncButton).toBeDisabled());

    await userEvent.click(await screen.findByRole('button', { name: '管理觀察清單' }));
    await userEvent.type(screen.getByLabelText('股票代號'), '2330');
    await userEvent.click(screen.getByRole('button', { name: '加入觀察' }));

    await waitFor(() => expect(syncButton).toBeEnabled());
  });

  it('同步完成後，今日 DSS 的卡片立即重算，不必重新整理', async () => {
    await writeWatchlist(
      addWatch(emptyWatchlist(), {
        stockId: '2330',
        stockName: '台積電',
        at: '2026-07-28T02:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async (input: string) => marketResponse(input)));

    render(<AppShell />);

    // 同步之前快取是空的，卡片必須誠實說資料不足
    expect(await screen.findByText(/股價資料只有 0 筆/)).toBeInTheDocument();

    const button = await screen.findByRole('button', { name: '同步市場資料' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(await screen.findByText('資料完整')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('觀察標的只有代號時，同步會把名稱補回來', async () => {
    await writeWatchlist(
      addWatch(emptyWatchlist(), {
        stockId: '2330',
        stockName: '2330',
        at: '2026-07-28T02:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async (input: string) => marketResponse(input)));

    render(<AppShell />);

    const button = await screen.findByRole('button', { name: '同步市場資料' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(await screen.findByText('台積電')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /*
   * 卡片上十幾個數字全都同一個字級時，眼睛沒有落點。改版後只留一個放大的讀數，
   * 成本這類只在加減碼時才看的數字收進明細——收起不是刪除，點開仍在同一張卡上。
   */
  it('持股卡以報酬率為落點，成本明細預設收起', async () => {
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

    render(<AppShell />);

    expect(await screen.findByText('+5.00%')).toBeInTheDocument();

    const cost = screen.getByText(/成本 100\.00/);
    expect(cost).not.toBeVisible();

    await userEvent.click(screen.getByText('明細'));

    expect(cost).toBeVisible();
  });

  /*
   * 規格 L257：點擊圖卡在右側滑出詳情面板，持股另顯示成本與損益，
   * 且不把持倉資料混入 DSS 判讀——所以持倉必須是獨立一區並自己說明。
   */
  it('點擊持股卡滑出詳情，持倉獨立成區且標明不參與判讀', async () => {
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

    render(<AppShell />);

    await userEvent.click(await screen.findByRole('button', { name: /0050 元大台灣50 詳情/ }));

    const panel = await screen.findByRole('dialog', { name: /0050 元大台灣50 詳情/ });
    expect(within(panel).getByRole('region', { name: '持倉' })).toBeInTheDocument();
    expect(within(panel).getByText(/不參與 DSS 判讀/)).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'DSS 原因' })).toBeInTheDocument();
  });

  it('觀察卡的詳情不出現持倉資料', async () => {
    await writeWatchlist(
      addWatch(emptyWatchlist(), {
        stockId: '2330',
        stockName: '台積電',
        at: '2026-07-28T02:00:00.000Z',
      }),
    );

    render(<AppShell />);

    await userEvent.click(await screen.findByRole('button', { name: /2330 台積電 詳情/ }));

    const panel = await screen.findByRole('dialog', { name: /2330 台積電 詳情/ });
    expect(within(panel).queryByRole('region', { name: '持倉' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: '觀察' })).toBeInTheDocument();
  });

  it('按 Esc 可關閉詳情，鍵盤使用者不會被困住', async () => {
    await writeWatchlist(
      addWatch(emptyWatchlist(), {
        stockId: '2330',
        stockName: '台積電',
        at: '2026-07-28T02:00:00.000Z',
      }),
    );

    render(<AppShell />);

    await userEvent.click(await screen.findByRole('button', { name: /2330 台積電 詳情/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
