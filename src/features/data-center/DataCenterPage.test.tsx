import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME } from '../../storage/database';
import { readInventory } from '../../storage/inventory';
import { importTransactions, readTransactions } from '../../storage/portfolio';
import { DataCenterPage } from './DataCenterPage';

const TRANSACTION_HEADER =
  ',成交日期,市場別,股票代號,股票名稱,交易種類,買賣別,交易類別,成交數量,成交價,價金,手續費,交易稅,應收付帳款,融資金額/融券保證金,自備款擔保品,融資券利息,融券手續費,標借費,利息代扣稅款,二代健保補充費,損益,報酬率,交割日,幣別,,';

const TRANSACTION_ROW =
  ',  2026/03/02,台股,2330,台積電,普通,買,現股,"1,000",1100.00,"1,100,000",1567,0,"-1,101,567",0,0,0,0,0,0,0,0,,2026/03/04,台幣,台積電 現股 買,X00000001';

const HOLDINGS_HEADER =
  '下單,市場,股票代號,股票名稱,交易類別,昨日庫存,今日買進成交數量,今日賣出成交數量,合計庫存數量,可下單數量,成本金額,成本均價,現價,市值,買未入帳,賣未入帳,今日買進委託數量,今日賣出委託數量,幣別,單位換算率';

const HOLDINGS_ROW =
  ',台股,0050,元大台灣50,現股,"5,999",0,0,"5,999","5,999","606,824",101.1542,105.80,"634,694",0,0,0,0,台幣,1.00';

/** 以 UTF-8 BOM 建立檔案；Big5 解碼路徑已在 decode 的單元測試中涵蓋。 */
function csvFile(name: string, lines: string[]): File {
  return new File([`﻿${lines.join('\n')}`], name, { type: 'text/csv' });
}

function renderPage() {
  const onDataChanged = vi.fn();
  const view = render(<DataCenterPage inventory={null} onDataChanged={onDataChanged} />);
  return { ...view, onDataChanged };
}

async function renderPageWithInventory() {
  const inventory = await readInventory();
  return render(<DataCenterPage inventory={inventory} onDataChanged={vi.fn()} />);
}

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('本機存量', () => {
  it('資料庫全空時標示未就緒，不用 0 假裝正常', async () => {
    await renderPageWithInventory();

    const readout = screen.getByRole('region', { name: '本機存量' });
    expect(within(readout).getAllByText('未匯入').length).toBeGreaterThan(0);
    expect(within(readout).getByText('尚未同步')).toBeInTheDocument();
  });

  it('顯示交易筆數與涵蓋的日期範圍', async () => {
    await importTransactions(
      [
        {
          tradeDate: '2025-01-02',
          stockId: '2330',
          stockName: '台積電',
          side: 'buy',
          tradeType: '現股',
          quantity: 1000,
          price: 1100,
          fees: 1567,
          tax: 0,
          settlementDate: '2025-01-06',
          brokerReference: 'X00000001',
        },
      ],
      '2026-07-27T12:00:00.000Z',
    );

    await renderPageWithInventory();

    const readout = screen.getByRole('region', { name: '本機存量' });
    expect(within(readout).getByText('1')).toBeInTheDocument();
    expect(within(readout).getByText(/2025-01-02/)).toBeInTheDocument();
  });
});

describe('交易明細匯入', () => {
  it('選擇檔案後顯示欄位檢查、解析與比對三段結果', async () => {
    renderPage();

    await userEvent.upload(
      screen.getByLabelText('選擇交易明細檔案'),
      csvFile('交易明細.csv', [TRANSACTION_HEADER, TRANSACTION_ROW]),
    );

    const panel = await screen.findByRole('region', { name: '匯入交易明細' });
    await waitFor(() => {
      expect(within(panel).getByText('欄位齊備')).toBeInTheDocument();
    });
    expect(within(panel).getByText(/可匯入 1 筆/)).toBeInTheDocument();
    expect(within(panel).getByText(/新增 1 筆/)).toBeInTheDocument();
  });

  it('標題列缺少必要欄位時說明缺哪些欄位，且不提供匯入按鈕', async () => {
    renderPage();

    await userEvent.upload(
      screen.getByLabelText('選擇交易明細檔案'),
      csvFile('壞掉的檔.csv', [',成交日期,市場別,股票代號', TRANSACTION_ROW]),
    );

    const panel = await screen.findByRole('region', { name: '匯入交易明細' });
    await waitFor(() => {
      expect(within(panel).getByText(/缺少必要欄位/)).toBeInTheDocument();
    });
    expect(within(panel).getByText(/買賣別/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /確認匯入/ })).not.toBeInTheDocument();
  });

  it('個別列解析失敗時列出行號與原因', async () => {
    renderPage();
    const badRow = TRANSACTION_ROW.replace('  2026/03/02', '2026/13/02');

    await userEvent.upload(
      screen.getByLabelText('選擇交易明細檔案'),
      csvFile('交易明細.csv', [TRANSACTION_HEADER, TRANSACTION_ROW, badRow]),
    );

    const panel = await screen.findByRole('region', { name: '匯入交易明細' });
    await waitFor(() => {
      expect(within(panel).getByText(/略過 1 筆/)).toBeInTheDocument();
    });
    expect(within(panel).getByText(/成交日期無法解析/)).toBeInTheDocument();
  });

  it('確認匯入後寫入資料庫並回報結果', async () => {
    const { onDataChanged } = renderPage();

    await userEvent.upload(
      screen.getByLabelText('選擇交易明細檔案'),
      csvFile('交易明細.csv', [TRANSACTION_HEADER, TRANSACTION_ROW]),
    );

    const panel = await screen.findByRole('region', { name: '匯入交易明細' });
    const confirm = await within(panel).findByRole('button', { name: /確認匯入/ });
    await userEvent.click(confirm);

    await waitFor(async () => {
      expect(await readTransactions()).toHaveLength(1);
    });
    expect(onDataChanged).toHaveBeenCalled();
    expect(within(panel).getByText(/已寫入 1 筆/)).toBeInTheDocument();
  });

  it('重複匯入同一份檔案時回報全數已存在', async () => {
    renderPage();
    const file = () => csvFile('交易明細.csv', [TRANSACTION_HEADER, TRANSACTION_ROW]);

    await userEvent.upload(screen.getByLabelText('選擇交易明細檔案'), file());
    const panel = await screen.findByRole('region', { name: '匯入交易明細' });
    await userEvent.click(await within(panel).findByRole('button', { name: /確認匯入/ }));

    await userEvent.upload(screen.getByLabelText('選擇交易明細檔案'), file());

    await waitFor(() => {
      expect(within(panel).getByText(/新增 0 筆/)).toBeInTheDocument();
    });
    expect(within(panel).getByText(/已存在 1 筆/)).toBeInTheDocument();
  });
});

describe('庫存匯入', () => {
  it('顯示快照日期，讓使用者知道會寫入哪一天', async () => {
    renderPage();

    await userEvent.upload(
      screen.getByLabelText('選擇庫存檔案'),
      csvFile('股票庫存.csv', [HOLDINGS_HEADER, HOLDINGS_ROW]),
    );

    const panel = await screen.findByRole('region', { name: '匯入庫存' });
    await waitFor(() => {
      expect(within(panel).getByText(/快照日期/)).toBeInTheDocument();
    });
    expect(within(panel).getByText(/可匯入 1 檔/)).toBeInTheDocument();
  });
});

describe('備份', () => {
  it('提供完整備份與輕量備份兩種選項並說明差異', async () => {
    await renderPageWithInventory();

    const backup = screen.getByRole('region', { name: '備份與還原' });
    expect(within(backup).getByRole('button', { name: '完整備份' })).toBeInTheDocument();
    expect(within(backup).getByRole('button', { name: '輕量備份' })).toBeInTheDocument();
    expect(within(backup).getByText(/市場快取/)).toBeInTheDocument();
  });

  it('還原格式錯誤的檔案時說明原因', async () => {
    renderPage();

    await userEvent.upload(
      screen.getByLabelText('選擇備份檔還原'),
      new File(['{"version":99}'], 'backup.json', { type: 'application/json' }),
    );

    await waitFor(() => {
      expect(screen.getByText(/版本不符/)).toBeInTheDocument();
    });
  });
});
