import { describe, expect, it } from 'vitest';
import { parseTransactionCsv } from './transactionCsv';

/** 實際券商匯出的標題列，結尾兩個欄位無標題（摘要與委託書號）。 */
const HEADER =
  ',成交日期,市場別,股票代號,股票名稱,交易種類,買賣別,交易類別,成交數量,成交價,價金,手續費,交易稅,應收付帳款,融資金額/融券保證金,自備款擔保品,融資券利息,融券手續費,標借費,利息代扣稅款,二代健保補充費,損益,報酬率,交割日,幣別,,';

const BUY_ROW =
  ',  2026/03/02,台股,2330,台積電,普通,買,現股,"1,000",1100.00,"1,100,000",1567,0,"-1,101,567",0,0,0,0,0,0,0,0,,2026/03/04,台幣,台積電 現股 買,X00000001';

const SELL_ROW =
  ',  2026/03/10,台股,0050,元大台灣50,普通,賣,現股,500,105.50,"52,750",75,158,"52,517",0,0,0,0,0,0,0,-26,-0.05%,2026/03/12,台幣,元大台灣50 現股 賣,X00000002';

const SUBTOTAL_ROW =
  ',  2026/03/02 小計,,,,,,,"1,000",1100.00,"1,100,000",1567,0,"-1,101,567",0,0,0,0,0,0,0,0,,,,,';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseTransactionCsv', () => {
  it('分開保留交易種類與交易類別', () => {
    const result = parseTransactionCsv(csv(BUY_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0]).toMatchObject({ tradeMethod: '普通', tradeType: '現股' });
  });

  it('解析買進列，保留交易類別與券商委託書號', () => {
    const result = parseTransactionCsv(csv(BUY_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      tradeDate: '2026-03-02',
      stockId: '2330',
      stockName: '台積電',
      side: 'buy',
      tradeMethod: '普通',
      tradeType: '現股',
      quantity: 1000,
      price: 1100,
      fees: 1567,
      tax: 0,
      settlementDate: '2026-03-04',
      brokerReference: 'X00000001',
    });
  });

  it('解析賣出列', () => {
    const result = parseTransactionCsv(csv(SELL_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0]).toMatchObject({
      stockId: '0050',
      side: 'sell',
      quantity: 500,
      price: 105.5,
      tax: 158,
    });
  });

  it('略過每日小計列，且不視為錯誤', () => {
    const result = parseTransactionCsv(csv(BUY_ROW, SUBTOTAL_ROW, SELL_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('標題列缺少必要欄位時整份拒絕，並指出缺哪些欄位', () => {
    const brokenHeader = ',成交日期,市場別,股票代號,股票名稱';
    const result = parseTransactionCsv([brokenHeader, BUY_ROW].join('\n'));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.missingColumns).toContain('買賣別');
    expect(result.missingColumns).toContain('成交價');
    expect(result.error).toContain('缺少必要欄位');
  });

  it('欄位順序改變時仍依標題正確對應，不會讀到錯誤欄位', () => {
    const swappedHeader =
      ',股票代號,成交日期,市場別,股票名稱,交易種類,買賣別,交易類別,成交數量,成交價,價金,手續費,交易稅,應收付帳款,融資金額/融券保證金,自備款擔保品,融資券利息,融券手續費,標借費,利息代扣稅款,二代健保補充費,損益,報酬率,交割日,幣別,,';
    const swappedRow =
      ',2330,  2026/03/02,台股,台積電,普通,買,現股,"1,000",1100.00,"1,100,000",1567,0,"-1,101,567",0,0,0,0,0,0,0,0,,2026/03/04,台幣,台積電 現股 買,X00000001';

    const result = parseTransactionCsv([swappedHeader, swappedRow].join('\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0]).toMatchObject({ stockId: '2330', tradeDate: '2026-03-02' });
  });

  it('數量無法解析的列列入略過清單並註明原因，不影響其他列', () => {
    const badRow = BUY_ROW.replace('"1,000"', '待確認');
    const result = parseTransactionCsv(csv(badRow, SELL_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ line: 2, reason: '成交數量無法解析' }]);
  });

  it('日期無法解析的列列入略過清單', () => {
    const badRow = BUY_ROW.replace('  2026/03/02', '2026/13/02');
    const result = parseTransactionCsv(csv(badRow));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.skipped).toEqual([{ line: 2, reason: '成交日期無法解析' }]);
  });

  it('買賣別無法辨識的列列入略過清單，不預設為買進', () => {
    const badRow = BUY_ROW.replace(',普通,買,現股,', ',普通,？,現股,');
    const result = parseTransactionCsv(csv(badRow));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([{ line: 2, reason: '買賣別無法辨識' }]);
  });

  it('交割日為空時記為 null', () => {
    const rowWithoutSettlement = BUY_ROW.replace(',2026/03/04,台幣,', ',,台幣,');
    const result = parseTransactionCsv(csv(rowWithoutSettlement));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0].settlementDate).toBeNull();
  });
});
