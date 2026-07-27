import { describe, expect, it } from 'vitest';
import { buildHeaderMap, parseAmount, parseTradeDate, splitCsvLine, splitCsvRows } from './csv';

describe('splitCsvLine', () => {
  it('以逗號分欄', () => {
    expect(splitCsvLine('0050,元大台灣50,現股')).toEqual(['0050', '元大台灣50', '現股']);
  });

  it('引號內的逗號不視為分隔符（券商的千分位數字）', () => {
    expect(splitCsvLine('0050,"1,000","606,824"')).toEqual(['0050', '1,000', '606,824']);
  });

  it('保留空欄位，使欄位位置不位移', () => {
    expect(splitCsvLine(',台股,,現股')).toEqual(['', '台股', '', '現股']);
  });
});

describe('splitCsvRows', () => {
  it('切分 CRLF 與 LF 換行並略過空白列', () => {
    expect(splitCsvRows('a,b\r\nc,d\n\n   \ne,f')).toEqual(['a,b', 'c,d', 'e,f']);
  });
});

describe('buildHeaderMap', () => {
  it('把標題名稱對應到欄位索引', () => {
    const map = buildHeaderMap(',成交日期,市場別,股票代號');

    expect(map.get('成交日期')).toBe(1);
    expect(map.get('股票代號')).toBe(3);
  });

  it('忽略標題前後空白', () => {
    expect(buildHeaderMap(' 股票代號 , 成交價 ').get('成交價')).toBe(1);
  });

  it('對不存在的標題回傳 undefined', () => {
    expect(buildHeaderMap('股票代號').get('不存在的欄位')).toBeUndefined();
  });
});

describe('parseAmount', () => {
  it('解析含千分位的數字', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('606,824')).toBe(606824);
  });

  it('解析小數與負數', () => {
    expect(parseAmount('101.1542')).toBe(101.1542);
    expect(parseAmount('-100,080')).toBe(-100080);
  });

  it('空值與非數字回傳 null，不靜默變成 NaN', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,0x0')).toBeNull();
  });
});

describe('parseTradeDate', () => {
  it('把券商的斜線日期正規化為 ISO 格式並去除前導空白', () => {
    expect(parseTradeDate('  2025/01/02')).toBe('2025-01-02');
    expect(parseTradeDate('2025-01-02')).toBe('2025-01-02');
  });

  it('補齊個位數的月份與日期', () => {
    expect(parseTradeDate('2025/1/2')).toBe('2025-01-02');
  });

  it('拒絕不存在的日期', () => {
    expect(parseTradeDate('2025/13/01')).toBeNull();
    expect(parseTradeDate('2025/02/30')).toBeNull();
  });

  it('拒絕空值與帶有小計字樣的日期', () => {
    expect(parseTradeDate('')).toBeNull();
    expect(parseTradeDate('  2025/01/02 小計')).toBeNull();
  });
});
