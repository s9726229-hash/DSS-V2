import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstitutionalRow, PriceRow } from '../../market/types';
import { DATABASE_NAME } from '../../storage/database';
import { writeCachedDataset } from '../../storage/marketCache';
import { importTransactions } from '../../storage/portfolio';
import { ResearchPage } from './ResearchPage';

const NOW = '2026-07-28T02:00:00.000Z';

function tradeDay(index: number): string {
  return new Date(Date.UTC(2025, 8, 1) + index * 86_400_000).toISOString().slice(0, 10);
}

function priceRows(stockId: string, count: number): PriceRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: tradeDay(index),
    stock_id: stockId,
    open: 100,
    max: 100,
    min: 100,
    close: 100 + (index % 7),
    Trading_Volume: 1_000_000,
  }));
}

function chipRows(stockId: string, rows: PriceRow[]): InstitutionalRow[] {
  return rows.flatMap((row, index) => [
    { date: row.date, stock_id: stockId, name: 'Foreign_Investor', buy: 100 + index, sell: 50 },
    { date: row.date, stock_id: stockId, name: 'Investment_Trust', buy: 20, sell: 10 + index },
  ]);
}

/** 建立一檔在指定索引日買進的建立部位，並備妥足夠的前後資料。 */
async function seedStock(stockId: string, entryIndex: number) {
  const rows = priceRows(stockId, entryIndex + 40);

  await importTransactions(
    [
      {
        tradeDate: tradeDay(entryIndex),
        stockId,
        stockName: `測試${stockId}`,
        side: 'buy',
        tradeMethod: '普通',
        tradeType: '現股',
        quantity: 1000,
        price: 100,
        fees: 20,
        tax: 0,
        settlementDate: null,
        brokerReference: null,
      },
    ],
    NOW,
  );

  await writeCachedDataset({
    dataset: 'TaiwanStockSplitPrice',
    stockId,
    rows: [],
    tradeDate: null,
    retrievedAt: NOW,
    coverage: { startDate: tradeDay(entryIndex), endDate: tradeDay(entryIndex) },
  });
  await writeCachedDataset({
    dataset: 'TaiwanStockPrice',
    stockId,
    rows,
    tradeDate: rows[rows.length - 1].date,
    retrievedAt: NOW,
  });
  await writeCachedDataset({
    dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
    stockId,
    rows: chipRows(stockId, rows),
    tradeDate: rows[rows.length - 1].date,
    retrievedAt: NOW,
  });
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('沒有資料時', () => {
  it('提供建立部位、加碼與再進場三種研究情境', async () => {
    render(<ResearchPage />);

    const tabs = await screen.findByRole('tablist', { name: '研究情境' });
    expect(within(tabs).getByRole('tab', { name: '建立部位' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabs).getByRole('tab', { name: '加碼研究' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: '再進場研究' })).toBeInTheDocument();
  });

  it('沒有建立部位時引導先匯入交易明細', async () => {
    render(<ResearchPage />);

    expect(await screen.findByText(/請先到.*匯入交易明細/)).toBeInTheDocument();
  });

  it('讀數以 0 呈現而非空白', async () => {
    render(<ResearchPage />);

    const inventory = await screen.findByRole('region', { name: '研究樣本' });
    expect(within(inventory).getAllByText('0').length).toBeGreaterThan(0);
  });

  it('切換加碼研究後顯示相對均價分頁', async () => {
    render(<ResearchPage />);
    await userEvent.click(await screen.findByRole('tab', { name: '加碼研究' }));

    expect(await screen.findByRole('tab', { name: '相對均價' })).toBeInTheDocument();
  });

  it('切換加碼研究後使用加碼情境文案', async () => {
    render(<ResearchPage />);
    await userEvent.click(await screen.findByRole('tab', { name: '加碼研究' }));

    const inventory = await screen.findByRole('region', { name: '研究樣本' });
    expect(within(inventory).getByText('加碼')).toBeInTheDocument();
    expect(screen.getByText(/分析 2026 年起的加碼交易/)).toBeInTheDocument();
    expect(screen.getByText(/研究期間內沒有加碼/)).toBeInTheDocument();
    expect(screen.queryByText(/加碼、再進場與現沖不列入本輪分析/)).not.toBeInTheDocument();
  });

  it('切換再進場研究後使用再進場情境文案', async () => {
    render(<ResearchPage />);
    await userEvent.click(await screen.findByRole('tab', { name: '再進場研究' }));

    const inventory = await screen.findByRole('region', { name: '研究樣本' });
    expect(within(inventory).getByText('再進場')).toBeInTheDocument();
    expect(screen.getByText(/分析 2026 年起的再進場交易/)).toBeInTheDocument();
    expect(screen.getByText(/研究期間內沒有再進場/)).toBeInTheDocument();
  });

  it('帳本排除摘要顯示期初部位不明', async () => {
    await importTransactions(
      [
        {
          tradeDate: '2026-03-02', stockId: '9999', stockName: '測試', side: 'sell',
          tradeMethod: '普通', tradeType: '現股', quantity: 1000, price: 100,
          fees: 0, tax: 0, settlementDate: null, brokerReference: null,
        },
      ],
      NOW,
    );
    await writeCachedDataset({
      dataset: 'TaiwanStockSplitPrice', stockId: '9999', rows: [], tradeDate: null,
      retrievedAt: NOW, coverage: { startDate: '2026-03-02', endDate: '2026-03-02' },
    });

    render(<ResearchPage />);

    expect(await screen.findByText(/期初部位不明/)).toBeInTheDocument();
  });
});

describe('有建立部位時', () => {
  beforeEach(async () => {
    for (let index = 0; index < 6; index += 1) {
      await seedStock(`230${index}`, 150 + index * 3);
    }
  });

  it('顯示三個研究指標分頁', async () => {
    render(<ResearchPage />);

    const tabs = await screen.findByRole('tablist', { name: '研究指標' });
    for (const label of ['20MA 乖離率', '外資流向', '投信流向']) {
      expect(within(tabs).getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('預設顯示 20MA 乖離率，並可切換指標', async () => {
    render(<ResearchPage />);

    const tabs = await screen.findByRole('tablist', { name: '研究指標' });
    expect(within(tabs).getByRole('tab', { name: '20MA 乖離率' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(within(tabs).getByRole('tab', { name: '投信流向' }));

    expect(within(tabs).getByRole('tab', { name: '投信流向' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('個股與 ETF 分開呈現', async () => {
    render(<ResearchPage />);

    expect(await screen.findByRole('region', { name: '個股' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'ETF' })).toBeInTheDocument();
  });

  it('每個區間都顯示證據等級與原因', async () => {
    render(<ResearchPage />);

    const stock = await screen.findByRole('region', { name: '個股' });
    const band = within(stock).getByRole('article', { name: '回檔下界' });

    expect(
      within(band).getAllByText(/資料不足|初步觀察|證據不足|值得繼續追蹤|門檻不穩定|重疊敏感/)
        .length,
    ).toBeGreaterThan(0);
    expect(
      within(band).getByText(/未達|屬初步觀察|低於|值得繼續追蹤|暫不推薦|缺少可比較|尚未收斂/),
    ).toBeInTheDocument();
  });

  it('每個區間都列出翻轉樣本數，讓穩定度判定有依據可看', async () => {
    render(<ResearchPage />);

    const stock = await screen.findByRole('region', { name: '個股' });
    const band = within(stock).getByRole('article', { name: '回檔下界' });

    expect(within(band).getByText('翻轉')).toBeInTheDocument();
  });

  it('顯示樣本讀數', async () => {
    render(<ResearchPage />);

    const inventory = await screen.findByRole('region', { name: '研究樣本' });
    await waitFor(() => {
      expect(within(inventory).getAllByText('6').length).toBeGreaterThan(0);
    });
  });

  it('標明候選區間尚未套用且不產生買賣建議', async () => {
    render(<ResearchPage />);

    expect(await screen.findByText(/尚未套用到任何判定/)).toBeInTheDocument();
    expect(screen.getByText(/不產生買賣建議/)).toBeInTheDocument();
  });
});

describe('沒有檢查點時', () => {
  it('區間範圍明說尚無門檻，不印出無意義的符號', async () => {
    await seedStock('0050', 150);

    render(<ResearchPage />);

    const etf = await screen.findByRole('region', { name: 'ETF' });
    expect(within(etf).getAllByText('尚無可用門檻').length).toBe(3);
  });
});

describe('歷史研究的分頁', () => {
  it('不再顯示已移至系統怎麼算的計算流程', async () => {
    render(<ResearchPage />);

    await screen.findByText(/請先到.*匯入交易明細/);
    expect(screen.queryByRole('button', { name: '計算流程' })).not.toBeInTheDocument();
    expect(screen.queryByText('建立部位辨識')).not.toBeInTheDocument();
  });
});

describe('搜尋紀錄分頁', () => {
  it('沒有紀錄時說明何時會自動留下', async () => {
    render(<ResearchPage />);
    await screen.findByText(/請先到.*匯入交易明細/);

    await userEvent.click(screen.getByRole('button', { name: '搜尋紀錄' }));

    expect(await screen.findByText(/每次結果變動都會自動留下一筆/)).toBeInTheDocument();
  });

  it('研究執行後保存該次搜尋，並在紀錄中列出各指標與類別', async () => {
    for (let index = 0; index < 6; index += 1) {
      await seedStock(`230${index}`, 150 + index * 3);
    }

    render(<ResearchPage />);
    await screen.findByRole('region', { name: '個股' });

    await userEvent.click(screen.getByRole('button', { name: '搜尋紀錄' }));

    const runs = await screen.findAllByRole('region', { name: /搜尋紀錄 / });
    expect(runs).toHaveLength(1);
    expect(within(runs[0]).getAllByText('20MA 乖離率').length).toBeGreaterThan(0);
    expect(within(runs[0]).getAllByText('個股').length).toBeGreaterThan(0);
    expect(within(runs[0]).getAllByText('ETF').length).toBeGreaterThan(0);
  });

  it('重新開啟頁面不會因結果相同而重複累積紀錄', async () => {
    await seedStock('2330', 150);

    const first = render(<ResearchPage />);
    await screen.findByRole('region', { name: '個股' });
    first.unmount();

    render(<ResearchPage />);
    await screen.findByRole('region', { name: '個股' });
    await userEvent.click(screen.getByRole('button', { name: '搜尋紀錄' }));

    await waitFor(async () => {
      expect(await screen.findAllByRole('region', { name: /搜尋紀錄 / })).toHaveLength(1);
    });
  });
});

describe('資料缺漏時', () => {
  it('提示哪些股票尚未回補價格資料', async () => {
    await importTransactions(
      [
        {
          tradeDate: '2026-03-02',
          stockId: '9999',
          stockName: '未回補',
          side: 'buy',
          tradeMethod: '普通',
          tradeType: '現股',
          quantity: 1000,
          price: 100,
          fees: 20,
          tax: 0,
          settlementDate: null,
          brokerReference: null,
        },
      ],
      NOW,
    );
    await writeCachedDataset({
      dataset: 'TaiwanStockSplitPrice',
      stockId: '9999',
      rows: [],
      tradeDate: null,
      retrievedAt: NOW,
      coverage: { startDate: '2026-03-02', endDate: '2026-03-02' },
    });

    render(<ResearchPage />);

    expect(await screen.findByText(/尚未回補價格資料/)).toBeInTheDocument();
  });
});
