import { render, screen, waitFor, within } from '@testing-library/react';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstitutionalRow, PriceRow } from '../../market/types';
import { DATABASE_NAME } from '../../storage/database';
import { writeCachedDataset } from '../../storage/marketCache';
import { importHoldingsSnapshot } from '../../storage/portfolio';
import { AnalysisPage } from './AnalysisPage';

const NOW = '2026-07-28T02:00:00.000Z';

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000);
    return day.toISOString().slice(0, 10);
  });
}

function prices(closes: number[]): PriceRow[] {
  return dates(closes.length).map((date, index) => ({
    date,
    stock_id: '2330',
    open: closes[index],
    max: closes[index],
    min: closes[index],
    close: closes[index],
    Trading_Volume: 1_000_000,
  }));
}

function institutional(priceRows: PriceRow[]): InstitutionalRow[] {
  return priceRows.slice(-5).flatMap((row) => [
    { date: row.date, stock_id: '2330', name: 'Foreign_Investor', buy: 300_000, sell: 100_000 },
    { date: row.date, stock_id: '2330', name: 'Investment_Trust', buy: 0, sell: 50_000 },
  ]);
}

async function seedHolding(stockId = '2330', stockName = '台積電') {
  await importHoldingsSnapshot(
    [{ stockId, stockName, tradeType: '現股', quantity: 1000, costPrice: 1000, currentPrice: 1100 }],
    '2026-07-28',
    NOW,
  );
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('沒有資料時', () => {
  it('沒有庫存時引導使用者先匯入', async () => {
    render(<AnalysisPage />);

    expect(await screen.findByText(/尚未匯入庫存/)).toBeInTheDocument();
  });

  it('有庫存但未同步時，兩個面板都明確標示資料不足', async () => {
    await seedHolding();

    render(<AnalysisPage />);

    const stock = await screen.findByRole('region', { name: '2330 分析' });
    expect(within(stock).getByText(/價格資料不足/)).toBeInTheDocument();
    expect(within(stock).getByText(/法人資料未就緒/)).toBeInTheDocument();
    expect(within(stock).getByText('尚未同步')).toBeInTheDocument();
  });
});

describe('有完整資料時', () => {
  beforeEach(async () => {
    await seedHolding();
    const priceRows = prices([...Array.from({ length: 59 }, () => 100), 120]);

    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '2330',
      rows: priceRows,
      tradeDate: priceRows[priceRows.length - 1].date,
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
      stockId: '2330',
      rows: institutional(priceRows),
      tradeDate: priceRows[priceRows.length - 1].date,
      retrievedAt: NOW,
    });
  });

  it('顯示均線與 Bias20', async () => {
    render(<AnalysisPage />);

    const technical = await screen.findByRole('region', { name: '技術面' });
    await waitFor(() => {
      expect(within(technical).getByText('120.00')).toBeInTheDocument();
    });
    expect(within(technical).getByText(/MA20/)).toBeInTheDocument();
    expect(within(technical).getByText(/^\+\d+\.\d+%$/)).toBeInTheDocument();
  });

  it('外資與投信分列顯示，不合併為單一結論', async () => {
    render(<AnalysisPage />);

    const chip = await screen.findByRole('region', { name: '籌碼面' });
    expect(within(chip).getByText('外資及陸資')).toBeInTheDocument();
    expect(within(chip).getByText('投信')).toBeInTheDocument();
  });

  it('外資買超、投信賣超時顯示為分歧', async () => {
    render(<AnalysisPage />);

    const chip = await screen.findByRole('region', { name: '籌碼面' });
    expect(await within(chip).findByText('外資與投信分歧')).toBeInTheDocument();
  });

  it('標明籌碼不覆寫技術面，避免被當成買賣訊號', async () => {
    render(<AnalysisPage />);

    const chip = await screen.findByRole('region', { name: '籌碼面' });
    expect(within(chip).getByText(/不合併計分/)).toBeInTheDocument();
  });

  it('沒有還原事件時不顯示還原說明', async () => {
    render(<AnalysisPage />);

    await screen.findByRole('region', { name: '技術面' });
    expect(screen.queryByText(/已還原/)).not.toBeInTheDocument();
  });
});

describe('權息與分割還原', () => {
  beforeEach(async () => {
    await seedHolding();
    const priceRows = prices(Array.from({ length: 60 }, () => 100));

    await writeCachedDataset({
      dataset: 'TaiwanStockPrice',
      stockId: '2330',
      rows: priceRows,
      tradeDate: priceRows[priceRows.length - 1].date,
      retrievedAt: NOW,
    });
    await writeCachedDataset({
      dataset: 'TaiwanStockDividendResult',
      stockId: '2330',
      rows: [
        {
          date: priceRows[priceRows.length - 5].date,
          stock_id: '2330',
          before_price: 99.2,
          after_price: 98.6,
        },
      ],
      tradeDate: priceRows[priceRows.length - 5].date,
      retrievedAt: NOW,
    });
  });

  it('列出已套用的還原事件', async () => {
    render(<AnalysisPage />);

    expect(await screen.findByText('已還原權息與分割')).toBeInTheDocument();
    expect(screen.getByText('除權息')).toBeInTheDocument();
    expect(screen.getByText('-0.60%')).toBeInTheDocument();
  });

  it('說明歷史價格已換算，與對帳單不會逐筆相同', async () => {
    render(<AnalysisPage />);

    expect(await screen.findByText(/與券商對帳單的成交價不會逐筆相同/)).toBeInTheDocument();
  });
});
