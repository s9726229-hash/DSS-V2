import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCandidate, emptyProfile, readEntry, setManualBoundary } from '../profile/profile';
import { readProfile, writeProfile } from '../profile/profileStore';
import { DATABASE_NAME, openDssDatabase } from '../storage/database';
import { importHoldingsSnapshot, importTransactions } from '../storage/portfolio';
import type { ResearchRunRecord } from '../storage/types';
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

async function seedResearchRun(executedAt: string): Promise<void> {
  const db = await openDssDatabase();
  await db.put('researchRuns', {
    id: `run:${executedAt}`,
    executedAt,
    signature: `test:${executedAt}`,
    entryCount: 12,
    technicalCount: 12,
    chipCount: 12,
    completeCount: 10,
    results: {
      bias20: {
        stock: {
          bands: [
            {
              band: 'pullback',
              range: { min: null, max: -2 },
              evidence: 'worth-tracking',
              reason: '回檔側有可追蹤的驗證結果。',
            },
            {
              band: 'normal',
              range: { min: -2, max: 4 },
              evidence: 'worth-tracking',
              reason: '合理區有可追蹤的驗證結果。',
            },
          ],
        },
        etf: { bands: [] },
      },
    } as unknown as ResearchRunRecord['results'],
  });
  db.close();
}

async function seedResearchRunWithEvidence(
  evidence: ResearchRunRecord['results']['bias20']['stock']['bands'][number]['evidence'],
): Promise<void> {
  const db = await openDssDatabase();
  await db.put('researchRuns', {
    id: 'run:2026-08-05',
    executedAt: '2026-08-05T00:00:00.000Z',
    signature: `test:2026-08-05:${evidence}`,
    entryCount: 12,
    technicalCount: 12,
    chipCount: 12,
    completeCount: 10,
    results: {
      bias20: {
        stock: {
          bands: [
            {
              band: 'pullback',
              range: { min: null, max: -2 },
              evidence,
              reason: '回檔側測試證據。',
            },
            {
              band: 'normal',
              range: { min: -2, max: 4 },
              evidence,
              reason: '合理區測試證據。',
            },
          ],
        },
        etf: { bands: [] },
      },
    } as unknown as ResearchRunRecord['results'],
  });
  db.close();
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
  it('顯示 V1 的六個完成頁面導覽', () => {
    render(<AppShell />);

    const nav = screen.getByRole('navigation');
    for (const label of ['今日總覽', '完整分析', '判讀說明', '歷史研究', '目前規則', '資料中心']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('button', { name: '設定' })).not.toBeInTheDocument();
  });

  // 今日總覽要先讀庫存與 Profile 才畫得出卡片，因此標題是非同步出現的
  it('預設顯示今日總覽', async () => {
    render(<AppShell />);

    expect(
      await screen.findByRole('heading', { level: 1, name: '今日總覽' }),
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
  it('持股卡以報酬率與今日判讀為落點，成本改由詳情查看', async () => {
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

    expect(screen.getAllByText('資料不足').length).toBeGreaterThan(0);
    expect(screen.queryByText('明細')).not.toBeInTheDocument();
    expect(screen.getByText('庫存現價')).toBeInTheDocument();
    expect(screen.getByText('持有天數')).toBeInTheDocument();
    expect(screen.getByText('融資流向')).toBeInTheDocument();
  });

  it('目前規則將複核意義集中在表格上方，並以兩位小數呈現', async () => {
    const profile = applyCandidate(emptyProfile(), {
      assetClass: 'stock',
      metric: 'bias20',
      band: 'normal',
      range: { min: 0.5661903, max: 15.78477 },
      runId: 'run-2026-08-02',
      evidence: 'insufficient-data',
      despiteWeakEvidence: true,
      at: '2026-08-03T00:00:00.000Z',
    });
    await writeProfile(profile);

    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));

    const alert = await screen.findByRole('note', { name: '需要複核的規則' });
    expect(alert).toHaveTextContent('橘框代表需要複核');
    expect(alert).toHaveTextContent('研究證據未足');
    expect(alert).toHaveTextContent('仍套用');
    expect(screen.getAllByLabelText('門檻值')[0]).toHaveValue('0.57');
    expect(screen.getAllByLabelText('門檻值')[1]).toHaveValue('15.78');
    expect(screen.getAllByText('合理區')).toHaveLength(2);
    expect(screen.getAllByText('賣超側')).toHaveLength(4);
    expect(screen.getAllByText('買超側')).toHaveLength(4);
    expect(screen.getAllByRole('columnheader', { name: '一般' })).toHaveLength(2);
  });

  /*
   * 橘框與 ✎ ◷ ! 是同一組判準畫出來的，圖例就得跟著同一組出現，否則畫面上會有
   * 標記卻沒有任何解釋。手動門檻沒有證據等級，最容易掉進這個縫裡。
   */
  it('只有手動門檻時，複核圖例仍然出現', async () => {
    await writeProfile(
      setManualBoundary(emptyProfile(), {
        assetClass: 'stock',
        metric: 'bias20',
        side: 'lower',
        value: -5,
        at: '2026-08-03T00:00:00.000Z',
      }),
    );

    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));

    const note = await screen.findByRole('note', { name: '需要複核的規則' });
    expect(note).toHaveTextContent('自訂、未驗證');
  });

  it('目前規則預設使用最新研究，候選一開始都不勾選', async () => {
    await seedResearchRun('2026-08-04T00:00:00.000Z');
    await seedResearchRun('2026-08-05T00:00:00.000Z');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));

    expect(await screen.findByRole('heading', { name: '從研究加入' })).toBeInTheDocument();
    expect(screen.getByText('2026-08-05')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('外資流向、投信流向、融資流向');
    expect(screen.queryByLabelText('個股 融資流向 減少側')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '套用已選規則' })).toBeDisabled();
  });

  it('同一個股指標改選另一個區間時會取代原選擇', async () => {
    await seedResearchRun('2026-08-05T00:00:00.000Z');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));
    await userEvent.click(await screen.findByLabelText('個股 20MA 乖離率 回檔下界'));
    expect(screen.getByRole('button', { name: '套用已選規則' })).toBeEnabled();
    await userEvent.click(screen.getByLabelText('個股 20MA 乖離率 合理區'));

    expect(screen.getByLabelText('個股 20MA 乖離率 回檔下界')).not.toBeChecked();
    expect(screen.getByLabelText('個股 20MA 乖離率 合理區')).toBeChecked();
  });

  it('可一次選取每個指標的中性區，並保留其他區間未選', async () => {
    await seedResearchRun('2026-08-05T00:00:00.000Z');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));

    await userEvent.click(await screen.findByRole('button', { name: '選取各指標中性區' }));

    expect(screen.getByLabelText('個股 20MA 乖離率 回檔下界')).not.toBeChecked();
    expect(screen.getByLabelText('個股 20MA 乖離率 合理區')).toBeChecked();
    expect(screen.getByRole('button', { name: '套用已選規則' })).toBeEnabled();
  });

  it('再次點擊已選候選會取消選擇', async () => {
    await seedResearchRun('2026-08-05T00:00:00.000Z');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));

    const candidate = await screen.findByLabelText('個股 20MA 乖離率 回檔下界');
    await userEvent.click(candidate);
    await userEvent.click(candidate);

    expect(candidate).not.toBeChecked();
    expect(screen.getByRole('button', { name: '套用已選規則' })).toBeDisabled();
  });

  it('證據較弱的候選必須逐一確認後才能套用', async () => {
    await seedResearchRunWithEvidence('insufficient-data');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));
    await userEvent.click(await screen.findByLabelText('個股 20MA 乖離率 回檔下界'));
    await userEvent.click(screen.getByRole('button', { name: '套用已選規則' }));

    expect(screen.getByRole('button', { name: '套用' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('我仍要套用 個股 20MA 乖離率 回檔下界'));
    expect(screen.getByRole('button', { name: '套用' })).toBeEnabled();
  });

  it('只寫入確認的候選並保留研究來源，套用後清空選取', async () => {
    await seedResearchRunWithEvidence('insufficient-data');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));
    await userEvent.click(await screen.findByLabelText('個股 20MA 乖離率 回檔下界'));
    await userEvent.click(screen.getByRole('button', { name: '套用已選規則' }));
    await userEvent.click(screen.getByLabelText('我仍要套用 個股 20MA 乖離率 回檔下界'));
    await userEvent.click(screen.getByRole('button', { name: '套用' }));

    await waitFor(async () => {
      const profile = await readProfile();
      expect(readEntry(profile, 'stock', 'bias20').lower).toMatchObject({
        sourceRunId: 'run:2026-08-05',
        sourceEvidence: 'insufficient-data',
        appliedDespiteWeakEvidence: true,
      });
      expect(readEntry(profile, 'stock', 'bias20').upper).toBeNull();
    });
    expect(screen.getByLabelText('個股 20MA 乖離率 回檔下界')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '套用已選規則' })).toBeDisabled();
  });

  it('取消批次確認不會寫入 Profile，並保留原本選取', async () => {
    await seedResearchRunWithEvidence('worth-tracking');
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));
    const candidate = await screen.findByLabelText('個股 20MA 乖離率 回檔下界');
    await userEvent.click(candidate);
    await userEvent.click(screen.getByRole('button', { name: '套用已選規則' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(readEntry(await readProfile(), 'stock', 'bias20').lower).toBeNull();
    expect(candidate).toBeChecked();
  });

  it('確認清單顯示來源日期、候選門檻、證據與覆蓋差異', async () => {
    await seedResearchRunWithEvidence('insufficient-data');
    await writeProfile(
      setManualBoundary(emptyProfile(), {
        assetClass: 'stock',
        metric: 'bias20',
        side: 'lower',
        value: -1,
        at: '2026-08-04T00:00:00.000Z',
      }),
    );
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: '目前規則' }));
    await userEvent.click(await screen.findByLabelText('個股 20MA 乖離率 回檔下界'));
    await userEvent.click(screen.getByRole('button', { name: '套用已選規則' }));

    const dialog = screen.getByRole('dialog', { name: '確認套用已選規則' });
    expect(dialog).toHaveTextContent('研究日期2026-08-05');
    expect(dialog).toHaveTextContent('候選門檻下界 -2.00%');
    expect(dialog).toHaveTextContent('目前規則變更下界 -1.00% → -2.00%');
    expect(dialog).toHaveTextContent('資料不足');
    expect(
      within(dialog).getByText(/正在讀取庫存資料|目前沒有庫存可以比對/),
    ).toBeInTheDocument();
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
