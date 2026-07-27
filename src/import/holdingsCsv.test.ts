import { describe, expect, it } from 'vitest';
import { parseHoldingsCsv } from './holdingsCsv';

/** 實際券商庫存報表的標題列。 */
const HEADER =
  '下單,市場,股票代號,股票名稱,交易類別,昨日庫存,今日買進成交數量,今日賣出成交數量,合計庫存數量,可下單數量,成本金額,成本均價,現價,市值,買未入帳,賣未入帳,今日買進委託數量,今日賣出委託數量,幣別,單位換算率';

const ROW_0050 =
  ',台股,0050,元大台灣50,現股,"5,999",0,0,"5,999","5,999","606,824",101.1542,105.80,"634,694",0,0,0,0,台幣,1.00';

const ROW_2330 =
  ',台股,2330,台積電,現股,"1,000",0,0,"1,000","1,000","1,100,000",1100.00,1145.00,"1,145,000",0,0,0,0,台幣,1.00';

const TOTAL_ROW = ',,,[TWD台幣]總計：,,,,,,,"1,706,824",,,"1,779,694",,,,,,';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseHoldingsCsv', () => {
  it('解析庫存列，取合計庫存數量與成本均價', () => {
    const result = parseHoldingsCsv(csv(ROW_0050));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      stockId: '0050',
      stockName: '元大台灣50',
      tradeType: '現股',
      quantity: 5999,
      costPrice: 101.1542,
      currentPrice: 105.8,
    });
  });

  it('略過檔尾的總計列，且不視為錯誤', () => {
    const result = parseHoldingsCsv(csv(ROW_0050, ROW_2330, TOTAL_ROW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('標題列缺少必要欄位時整份拒絕，並指出缺哪些欄位', () => {
    const result = parseHoldingsCsv(['下單,市場,股票代號,股票名稱', ROW_0050].join('\n'));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.missingColumns).toContain('合計庫存數量');
    expect(result.missingColumns).toContain('成本均價');
  });

  it('欄位順序改變時仍依標題正確對應', () => {
    const swappedHeader =
      '下單,市場,股票名稱,股票代號,交易類別,昨日庫存,今日買進成交數量,今日賣出成交數量,合計庫存數量,可下單數量,成本金額,成本均價,現價,市值,買未入帳,賣未入帳,今日買進委託數量,今日賣出委託數量,幣別,單位換算率';
    const swappedRow =
      ',台股,元大台灣50,0050,現股,"5,999",0,0,"5,999","5,999","606,824",101.1542,105.80,"634,694",0,0,0,0,台幣,1.00';

    const result = parseHoldingsCsv([swappedHeader, swappedRow].join('\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0]).toMatchObject({ stockId: '0050', stockName: '元大台灣50' });
  });

  it('庫存數量無法解析的列列入略過清單，不影響其他列', () => {
    // 合計庫存數量（第 9 欄）為非數值
    const badRow =
      ',台股,0050,元大台灣50,現股,"5,999",0,0,待確認,"5,999","606,824",101.1542,105.80,"634,694",0,0,0,0,台幣,1.00';
    const result = parseHoldingsCsv(csv(badRow, ROW_2330));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ line: 2, reason: '合計庫存數量無法解析' }]);
  });

  it('庫存數量為零的列不納入（已全數賣出）', () => {
    // 昨日庫存 1,000 於今日全數賣出，合計庫存數量為 0
    const soldOut =
      ',台股,2330,台積電,現股,"1,000",0,"1,000",0,0,"1,100,000",1100.00,1145.00,0,0,0,0,0,台幣,1.00';
    const result = parseHoldingsCsv(csv(soldOut));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(0);
  });
});
