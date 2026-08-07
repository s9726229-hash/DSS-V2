import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyScenarioCandidate, emptyProfile } from '../../profile/profile';
import { writeProfile } from '../../profile/profileStore';
import { DATABASE_NAME } from '../../storage/database';
import { writeCachedDataset } from '../../storage/marketCache';
import { importHoldingsSnapshot, importTransactions } from '../../storage/portfolio';
import { TodayPage } from './TodayPage';

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
  await importTransactions([{
    tradeDate: '2026-03-02', stockId: '2330', stockName: '測試', side: 'buy',
    tradeMethod: '普通', tradeType: '現股', quantity: 1000, price: 100,
    fees: 999, tax: 0, settlementDate: null, brokerReference: null,
  }], '2026-08-08T00:00:00.000Z');
  await importHoldingsSnapshot([{
    stockId: '2330', stockName: '測試', tradeType: '現股', quantity: 1000,
    costPrice: 101, currentPrice: 105,
  }], '2026-08-08', '2026-08-08T00:00:00.000Z');
  await writeCachedDataset({
    dataset: 'TaiwanStockSplitPrice', stockId: '2330', rows: [], tradeDate: null,
    retrievedAt: '2026-08-08T00:00:00.000Z',
    coverage: { startDate: '2026-03-02', endDate: '2026-03-02' },
  });
  await writeProfile(applyScenarioCandidate(emptyProfile(), {
    scenario: 'add-on', assetClass: 'stock', metric: 'relativeCost', band: 'normal',
    range: { min: -20, max: 0 }, runId: 'run:test', evidence: 'worth-tracking',
    despiteWeakEvidence: false, at: '2026-08-08T00:00:00.000Z',
  }));
});

describe('預計加碼價試算', () => {
  it('使用帳本均價試算且重新掛載後不保留輸入', async () => {
    const first = render(<TodayPage dataVersion={0} onWatchlistChanged={() => undefined} />);
    const input = await screen.findByRole('textbox', { name: '2330 預計加碼價' });
    await userEvent.type(input, '90');

    expect(screen.getByText('情境試算，不是交易建議')).toBeInTheDocument();
    expect(screen.getByText('-10.00%')).toBeInTheDocument();

    first.unmount();
    render(<TodayPage dataVersion={0} onWatchlistChanged={() => undefined} />);
    expect(await screen.findByRole('textbox', { name: '2330 預計加碼價' })).toHaveValue('');
  });
});
