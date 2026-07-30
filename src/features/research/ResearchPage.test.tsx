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
  it('沒有建立部位時引導先匯入交易明細', async () => {
    render(<ResearchPage />);

    expect(await screen.findByText(/請先到.*匯入交易明細/)).toBeInTheDocument();
  });

  it('讀數以 0 呈現而非空白', async () => {
    render(<ResearchPage />);

    const inventory = await screen.findByRole('region', { name: '研究樣本' });
    expect(within(inventory).getAllByText('0').length).toBeGreaterThan(0);
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

    const tabs = await screen.findByRole('navigation', { name: '研究指標' });
    for (const label of ['20MA 乖離率', '外資及陸資強度', '投信強度']) {
      expect(within(tabs).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('預設顯示 20MA 乖離率，並可切換指標', async () => {
    render(<ResearchPage />);

    const tabs = await screen.findByRole('navigation', { name: '研究指標' });
    expect(within(tabs).getByRole('button', { name: '20MA 乖離率' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(within(tabs).getByRole('button', { name: '投信強度' }));

    expect(within(tabs).getByRole('button', { name: '投信強度' })).toHaveAttribute(
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

describe('資料缺漏時', () => {
  it('提示哪些股票尚未回補價格資料', async () => {
    await importTransactions(
      [
        {
          tradeDate: '2026-03-02',
          stockId: '9999',
          stockName: '未回補',
          side: 'buy',
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

    render(<ResearchPage />);

    expect(await screen.findByText(/尚未回補價格資料/)).toBeInTheDocument();
  });
});
